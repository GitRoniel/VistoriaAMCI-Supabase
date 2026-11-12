// Central Offline: consulta ao servidor (Supabase, sempre com a sessão do usuário: RLS e permissões do Storage valem
// para tudo o que é listado e baixado) e o download controlado dos documentos.
import { catalogo, validarPdf, hex } from "./model.js";
import { checklistUnidade } from "../revistoria-cliente/model.js";

const BUCKET = "revistorias-relatorios";

async function todas(montar, tam = 1000) {
  const out = [];
  for (let de = 0; ; de += tam) {
    const { data, error } = await montar().range(de, de + tam - 1);
    if (error) throw error;
    out.push(...(data || []));
    if (!data || data.length < tam) return out;
  }
}

/** Condomínios do usuário (RLS: só os que ele acessa). */
export async function listarObras(sb) {
  const { data, error } = await sb.from("projects").select("id,name,slug").order("name", { ascending: true });
  if (error) throw error;
  return (data || []).map((p) => ({ id: Number(p.id), nome: p.name || p.slug || `Condomínio ${p.id}` }));
}

/** Catálogo do servidor para os condomínios + checklists por unidade (texto das pendências). */
export async function catalogoServidor(sb, obras) {
  const ids = obras.map((o) => o.id);
  if (!ids.length) return { docs: [], checklists: [] };
  const rels = await todas(() => sb.from("revistorias_relatorios").select("id,project_id,unit_id,caminho,nome_arquivo,tamanho,enviado_em,removido_em,convertido_id")
    .in("project_id", ids).order("id", { ascending: true }));
  const vivos = rels.filter((r) => !r.removido_em);
  const convIds = vivos.map((r) => r.convertido_id).filter(Boolean);
  const versoes = [];
  for (let i = 0; i < convIds.length; i += 200) {
    const parte = convIds.slice(i, i + 200);
    const { data, error } = await sb.from("revistorias_relatorios_versoes").select("id,relatorio_id,tipo,versao,status,caminho,tamanho,concluido_em,atualizado_em").in("id", parte);
    if (error) throw error;
    versoes.push(...(data || []));
  }
  const units = new Map();
  for (const pid of ids) {
    const linhas = await todas(() => sb.from("units").select("id,bloco,pav,apto").eq("project_id", pid).order("id", { ascending: true }));
    for (const u of linhas) units.set(Number(u.id), u);
  }
  const docs = catalogo(vivos, versoes, units, new Map(obras.map((o) => [o.id, o])));
  // checklist de pendências por unidade (mesma regra do relatório individual: sem repetidos, vale a cópia mais recente)
  const aps = await todas(() => sb.from("revistorias_apontamentos").select("id,project_id,unit_id,relatorio_id,ordem,texto,concluido").in("project_id", ids).order("id", { ascending: true }));
  const porUnidade = new Map();
  for (const a of aps) { if (!porUnidade.has(a.unit_id)) porUnidade.set(a.unit_id, []); porUnidade.get(a.unit_id).push(a); }
  const relsPorUnidade = new Map();
  for (const r of rels) { if (!relsPorUnidade.has(r.unit_id)) relsPorUnidade.set(r.unit_id, []); relsPorUnidade.get(r.unit_id).push(r); }
  const checklists = [...porUnidade.entries()].map(([unitId, lista]) => {
    const r = relsPorUnidade.get(unitId) || [], u = units.get(Number(unitId));
    const itens = checklistUnidade(lista, r).map((a) => ({ texto: a.texto, concluido: !!a.concluido }));
    return { unitId: Number(unitId), projectId: Number(lista[0].project_id), itens, atualizadoEm: new Date().toISOString(), bloco: u?.bloco || "" };
  });
  return { docs, checklists };
}

/** URLs assinadas (curtas) para baixar; em lote quando o cliente permite. */
async function assinar(sb, caminhos) {
  const st = sb.storage.from(BUCKET), out = new Map();
  if (typeof st.createSignedUrls === "function") {
    for (let i = 0; i < caminhos.length; i += 50) {
      const { data, error } = await st.createSignedUrls(caminhos.slice(i, i + 50), 900);
      if (error) throw error;
      for (const x of data || []) if (x?.signedUrl && !x.error) out.set(x.path, x.signedUrl);
    }
    return out;
  }
  for (const c of caminhos) { const { data } = await st.createSignedUrl(c, 900); if (data?.signedUrl) out.set(c, data.signedUrl); }
  return out;
}

/** Baixa um documento, confere a integridade e calcula o SHA-256. Lança erro com o motivo. */
export async function baixar(url, doc, sinal) {
  const r = await fetch(url, { signal: sinal, cache: "no-store", credentials: "omit" });
  if (!r.ok) throw new Error(r.status === 400 || r.status === 404 ? "arquivo não encontrado no servidor" : r.status === 403 ? "sem permissão para este arquivo" : `servidor respondeu ${r.status}`);
  const buf = await r.arrayBuffer();
  const v = validarPdf(new Uint8Array(buf), doc.tamanho);
  if (!v.ok) throw new Error(v.motivo);
  const hash = crypto?.subtle ? hex(await crypto.subtle.digest("SHA-256", buf)) : "";
  return { buf, hash };
}

/**
 * Executor dos downloads: fila persistida (store.fila), 2 ao mesmo tempo, pausa (termina os que estão em curso e
 * para), falhas registradas sem apagar a versão anterior; sem internet no meio = interrompido (o documento continua
 * na fila e é retomado depois). Cada documento concluído é verificado de novo lendo do
 * aparelho (hash) antes de contar como baixado.
 */
export function criarExecutor({ sb, store, aoProgresso = () => {}, simultaneos = 2 }) {
  let pausado = false, rodando = false, ctrl = null, interrompido = false;
  const estado = { total: 0, feitos: 0, falhas: 0, bytes: 0, bytesTotal: 0, atual: [] };
  async function executar(itens) {
    if (rodando) return estado;
    rodando = true; pausado = false; interrompido = false; ctrl = new AbortController();
    Object.assign(estado, { total: itens.length, feitos: 0, falhas: 0, bytes: 0, bytesTotal: itens.reduce((s, d) => s + (d.tamanho || 0), 0), atual: [], erros: [] });
    aoProgresso({ ...estado, fase: "iniciando" });
    try {
      const urls = await assinar(sb, [...new Set(itens.map((d) => d.caminho))]);
      const fila = [...itens];
      const trabalhador = async () => {
        while (fila.length && !pausado) {
          const d = fila.shift();
          estado.atual.push(d.id); aoProgresso({ ...estado, fase: "baixando" });
          try {
            const url = urls.get(d.caminho);
            if (!url) throw new Error("sem permissão ou arquivo indisponível no servidor");
            const { buf, hash } = await baixar(url, d, ctrl.signal);
            await store.guardar(d, buf, hash);
            const conf = await store.bytes(d.id);   // verificação lendo do aparelho
            if (!conf || conf.byteLength !== buf.byteLength) throw new Error("o aparelho não guardou o arquivo inteiro (espaço insuficiente?)");
            await store.tirarDaFila(d.id);
            estado.bytes += buf.byteLength;
            estado.feitos++;
          } catch (err) {
            // sem internet no meio do download (ou cancelado): não é falha do documento — fica na fila para retomar
            if (err?.name === "AbortError" || (typeof navigator !== "undefined" && navigator.onLine === false)) { fila.unshift(d); pausado = true; interrompido = true; }
            else {
              estado.falhas++; estado.feitos++; estado.erros.push({ id: d.id, erro: err?.message || String(err) });
              await store.falha(d, err?.message || err).catch(() => {});
              await store.tirarDaFila(d.id).catch(() => {});
            }
          } finally {
            estado.atual = estado.atual.filter((x) => x !== d.id);
            aoProgresso({ ...estado, fase: "baixando" });
          }
        }
      };
      await Promise.all(Array.from({ length: Math.max(1, simultaneos) }, trabalhador));
      aoProgresso({ ...estado, fase: interrompido ? "interrompido" : pausado ? "pausado" : "concluido" });
    } catch (err) {
      aoProgresso({ ...estado, fase: "erro", erro: err?.message || String(err) });
    } finally { rodando = false; }
    return estado;
  }
  return {
    executar,
    pausar() { pausado = true; },
    cancelarAgora() { pausado = true; ctrl?.abort(); },
    get rodando() { return rodando; }, get pausado() { return pausado; }
  };
}
