// Central Offline: regras puras (sem tela, sem IndexedDB e sem Supabase), usadas pela página (www/offline.js) e
// pelos testes (scripts/test-offline.mjs).
//
// Documentos disponíveis offline = os arquivos que existem de fato no servidor (Supabase Storage, bucket privado
// revistorias-relatorios), por relatório da Revistoria · Cliente:
//   • "original"   — o PDF do Mobuss enviado (revistorias_relatorios.caminho; nunca é sobrescrito);
//   • "convertido" — o relatório compacto vigente (revistorias_relatorios.convertido_id → versão disponível).
// As fotos e anexos ficam dentro desses PDFs (o compacto embute as fotos), então o PDF guardado abre completo.
// Junto com cada unidade vai o checklist de pendências (revistorias_apontamentos) em texto, para consulta offline.
// Os demais "relatórios" do aplicativo (Suprimentos, Contratos, painéis) são telas montadas na hora a partir do
// banco, não arquivos — por isso não entram aqui.

export const TIPOS = {
  convertido: { key: "convertido", label: "Relatório compacto", curto: "Compacto" },
  original: { key: "original", label: "Relatório Mobuss (original)", curto: "Original Mobuss" }
};
/** O que baixar: os dois tipos por padrão (o compacto é o mais usado; o original é o documento completo do Mobuss). */
export const SELECAO_PADRAO = Object.freeze({ convertido: true, original: true });

const pad = (n) => String(n).padStart(2, "0");
export const fmtData = (ts) => { if (!ts) return "—"; const d = new Date(ts); return Number.isNaN(+d) ? "—" : `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`; };
export const fmtDataHora = (ts) => { if (!ts) return "—"; const d = new Date(ts); return Number.isNaN(+d) ? "—" : `${fmtData(ts)} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
export function fmtBytes(n) {
  n = Number(n) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${Math.max(1, Math.round(n / 1024))} KB`;
  if (n < 1073741824) return `${(n / 1048576).toFixed(n >= 104857600 ? 0 : 1).replace(".", ",")} MB`;
  return `${(n / 1073741824).toFixed(1).replace(".", ",")} GB`;
}
/** Unidade no padrão das outras telas: "A · 604" (térreo T01), "Conj. B · Casa 3" nos condomínios de casas. */
export function rotuloUnidade(u) {
  if (!u) return "—";
  if (!u.pav) return `${u.bloco} · Casa ${+u.apto || u.apto}`;
  const p = String(u.pav).replace(/[^\dT]/gi, "") || u.pav;
  return `${u.bloco} · ${/^t/i.test(String(u.pav)) ? "T" + u.apto : p + u.apto}`;
}

/**
 * Catálogo do servidor (o que o usuário pode baixar, já filtrado pelo RLS na consulta).
 * @param rels     linhas de revistorias_relatorios (id, project_id, unit_id, caminho, nome_arquivo, tamanho, enviado_em, removido_em, convertido_id)
 * @param versoes  linhas de revistorias_relatorios_versoes (id, relatorio_id, tipo, versao, status, caminho, tamanho, concluido_em, atualizado_em)
 * @param units    Map/obj unit_id → { bloco, pav, apto }
 * @param projetos Map/obj project_id → { id, nome }
 */
export function catalogo(rels, versoes, units, projetos) {
  const ver = new Map((versoes || []).map((v) => [v.id, v]));
  const un = units instanceof Map ? units : new Map(Object.entries(units || {}).map(([k, v]) => [Number(k), v]));
  const pj = projetos instanceof Map ? projetos : new Map(Object.entries(projetos || {}).map(([k, v]) => [Number(k), v]));
  const out = [];
  for (const r of rels || []) {
    if (r.removido_em || !r.caminho) continue;
    const u = un.get(r.unit_id) || null, p = pj.get(r.project_id) || null;
    const base = { relatorioId: r.id, projectId: r.project_id, obra: p?.nome || `Condomínio ${r.project_id}`, unitId: r.unit_id,
      bloco: u?.bloco || "", unidade: rotuloUnidade(u), nomeArquivo: r.nome_arquivo || "" };
    out.push({ ...base, id: `original:${r.id}`, tipo: "original", caminho: r.caminho, tamanho: Number(r.tamanho) || 0,
      versao: `orig:${r.caminho}`, data: r.enviado_em || "" });
    const v = r.convertido_id ? ver.get(r.convertido_id) : null;
    if (v && v.status === "disponivel" && v.caminho) {
      out.push({ ...base, id: `convertido:${r.id}`, tipo: "convertido", caminho: v.caminho, tamanho: Number(v.tamanho) || 0,
        versao: `v${v.versao}:${v.caminho}`, data: v.concluido_em || v.atualizado_em || r.enviado_em || "" });
    }
  }
  return out.sort((a, b) => a.obra.localeCompare(b.obra, "pt-BR") || String(a.bloco).localeCompare(String(b.bloco), "pt-BR", { numeric: true })
    || a.unidade.localeCompare(b.unidade, "pt-BR", { numeric: true }) || a.relatorioId - b.relatorioId || (a.tipo === "convertido" ? -1 : 1));
}
/** Recorte do catálogo: tipos escolhidos, condomínio(s), bloco. */
export function selecionar(docs, { tipos = SELECAO_PADRAO, projetos = null, bloco = "" } = {}) {
  const pj = projetos ? new Set([].concat(projetos).map(Number)) : null;
  return (docs || []).filter((d) => tipos[d.tipo] && (!pj || pj.has(Number(d.projectId))) && (!bloco || d.bloco === bloco));
}

/**
 * Compara o que está no aparelho com o catálogo do servidor.
 * local: docs guardados ({ id, versaoOk, status }); versaoOk = versão do arquivo válido guardado (fica mesmo se
 *        a atualização seguinte falhar, para nunca trocar um arquivo bom por um incompleto).
 * @returns {{ novos, atualizados, sincronizados, removidos, falhas }} — removidos = guardados que não estão mais
 *          disponíveis ao usuário (apagados no servidor ou sem permissão): devem sair do aparelho.
 */
export function diferenca(local, servidor) {
  const loc = new Map((local || []).map((d) => [d.id, d]));
  const srv = new Map((servidor || []).map((d) => [d.id, d]));
  const out = { novos: [], atualizados: [], sincronizados: [], removidos: [], falhas: [] };
  for (const d of srv.values()) {
    const l = loc.get(d.id);
    if (!l?.versaoOk) out.novos.push(d);                       // nenhuma cópia válida no aparelho
    else if (l.versaoOk !== d.versao) out.atualizados.push(d);  // há cópia válida, mas de outra versão
    else out.sincronizados.push(d);
    if (l?.status === "falha") out.falhas.push(d);
  }
  for (const l of loc.values()) if (!srv.has(l.id)) out.removidos.push(l);
  return out;
}
/** O que precisa baixar (novos + atualizados), sem repetir o que já está atualizado. */
export const aBaixar = (dif) => [...dif.novos, ...dif.atualizados];

/**
 * Integridade do PDF baixado: tamanho igual ao do servidor (quando conhecido), cabeçalho %PDF- no início e
 * marcador %%EOF no fim. Arquivo incompleto/cortado ou página de erro (HTML/JSON) não passa.
 * @param {Uint8Array} b
 */
export function validarPdf(b, tamanhoEsperado = 0) {
  if (!b || !b.length) return { ok: false, motivo: "arquivo vazio" };
  if (tamanhoEsperado && b.length !== Number(tamanhoEsperado)) return { ok: false, motivo: `tamanho diferente do servidor (${b.length} de ${tamanhoEsperado} bytes)` };
  const ini = latin1(b.subarray(0, Math.min(b.length, 1024)));
  if (!ini.includes("%PDF-")) return { ok: false, motivo: "não é um PDF (o servidor devolveu outra coisa)" };
  const fim = latin1(b.subarray(Math.max(0, b.length - 2048)));
  if (!fim.includes("%%EOF")) return { ok: false, motivo: "PDF incompleto (download interrompido)" };
  return { ok: true, motivo: "" };
}
const latin1 = (u8) => { let s = ""; for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]); return s; };
export const hex = (buf) => [...new Uint8Array(buf)].map((x) => x.toString(16).padStart(2, "0")).join("");

/**
 * Situação de uma obra no aparelho (relatório de preparação).
 * @param selecionados docs do servidor escolhidos para a obra
 * @param guardados    Map id → doc local
 * @param fila         ids ainda na fila (pendentes)
 */
export function situacaoObra(selecionados, guardados, fila = new Set()) {
  const r = { total: 0, ok: 0, desatualizados: 0, pendentes: 0, falhas: 0, bytes: 0, listaFalhas: [] };
  for (const d of selecionados || []) {
    r.total++;
    const l = guardados.get(d.id);
    if (l?.status === "ok" && l.versaoOk === d.versao) { r.ok++; r.bytes += l.bytes || 0; continue; }
    if (l?.status === "ok") { r.desatualizados++; r.bytes += l.bytes || 0; }
    if (l?.status === "falha" && !fila.has(d.id)) { r.falhas++; r.listaFalhas.push({ ...d, erro: l.erro || "falha no download" }); continue; }
    if (!(l?.status === "ok")) r.pendentes++;
  }
  r.preparada = r.total > 0 && r.ok === r.total;
  r.estado = !r.total ? "vazia" : r.preparada ? "preparada" : r.falhas ? "falha" : r.desatualizados && !r.pendentes ? "atualizacao" : r.ok || r.desatualizados ? "parcial" : "nao_preparada";
  return r;
}
export const ESTADOS_OBRA = {
  preparada: { label: "Obra preparada para uso offline", cor: "#268a4d" },
  atualizacao: { label: "Atualização disponível", cor: "#2459b5" },
  parcial: { label: "Preparação incompleta", cor: "#b9770e" },
  falha: { label: "Falha no download", cor: "#b33636" },
  nao_preparada: { label: "Não preparada", cor: "#6f7a74" },
  vazia: { label: "Sem documentos", cor: "#6f7a74" }
};
/** Situação de um documento na lista. */
export function situacaoDoc(srv, local, naFila = false) {
  if (naFila && local?.status !== "ok") return { key: "baixando", label: "Na fila de download" };
  if (!local) return { key: "online", label: "Só no servidor" };
  if (local.status === "falha" && !local.versaoOk) return { key: "falha", label: "Falha no download" };
  if (!srv) return { key: "removido", label: "Não está mais disponível" };
  if (local.versaoOk && local.versaoOk !== srv.versao) return { key: "atualizacao", label: "Atualização disponível" };
  if (local.status === "falha") return { key: "falha", label: "Falha ao atualizar (versão anterior guardada)" };
  return { key: "ok", label: "Disponível offline" };
}

/** Estimativa de espaço: bytes a baixar × 1,05 (folga) comparado com o espaço livre informado pelo navegador. */
export function cabe(bytesNecessarios, estimativa) {
  if (!estimativa || !estimativa.quota) return { conhecido: false, cabe: true, livre: null };
  const livre = Math.max(0, estimativa.quota - (estimativa.usage || 0));
  return { conhecido: true, cabe: bytesNecessarios * 1.05 <= livre, livre };
}

/** Chave do banco local por usuário (isolamento entre contas no mesmo aparelho). */
export const nomeBanco = (userId) => `amci-offline:${userId}`;
/** Usuário da sessão guardada no aparelho (sem rede e sem tocar no token): o "user" do objeto salvo pelo Supabase. */
export function usuarioDaSessao(texto) {
  try {
    const j = JSON.parse(texto || "null");
    const u = j?.user || j?.currentSession?.user || null;
    return u?.id ? { id: String(u.id), email: u.email || "" } : null;
  } catch { return null; }
}
