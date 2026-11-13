// Modo offline de UM relatório (tela do relatório da unidade, aba Revistoria · Cliente): mostra se o compacto e o
// original Mobuss já estão guardados neste aparelho e permite baixar, atualizar ou remover só este relatório.
// Usa o MESMO armazenamento da Central Offline (IndexedDB por usuário, mesmos ids e versões do catálogo), então o que
// é guardado aqui aparece na Central como "Disponível offline" e entra na sincronização — e vice-versa.
// Download por URL assinada temporária (RLS/Storage valem); conferência do PDF e troca atômica de versão (store.js).
import * as O from "./model.js";
import { abrirBanco } from "./store.js";
import { assinar, baixar } from "./sync.js";

const bancos = new Map();
function banco(userId) {
  if (!userId) return Promise.reject(new Error("Entre na sua conta para usar o modo offline."));
  if (!bancos.has(userId)) bancos.set(userId, abrirBanco(String(userId)).catch((e) => { bancos.delete(userId); throw e; }));
  return bancos.get(userId);
}

/**
 * Documentos deste relatório no formato do catálogo da Central (mesmos ids/versões): compacto vigente e original.
 * @param rel     linha de revistorias_relatorios (id, project_id, unit_id, caminho, nome_arquivo, tamanho, enviado_em, convertido_id)
 * @param versoes linhas de revistorias_relatorios_versoes da unidade
 * @param ctx     { projectId, unitId, obra, bloco, pav, apto }
 */
export function docsDoRelatorio(rel, versoes, { projectId, unitId, obra, bloco, pav, apto }) {
  if (!rel) return [];
  const r = { ...rel, project_id: Number(rel.project_id ?? projectId), unit_id: rel.unit_id ?? unitId };
  const units = new Map([[r.unit_id, { bloco, pav, apto }]]);
  const projetos = new Map([[Number(r.project_id), { id: Number(r.project_id), nome: obra }]]);
  return O.catalogo([r], (versoes || []).filter((v) => v.relatorio_id === rel.id && v.tipo === "convertido"), units, projetos);
}

/** Situação de cada documento no aparelho: Map id → { key, label, local } (O.situacaoDoc). */
export async function estado(userId, docs) {
  const store = await banco(userId);
  const out = new Map();
  for (const d of docs) { const local = await store.doc(d.id); out.set(d.id, { ...O.situacaoDoc(d, local, false), local: local || null }); }
  return out;
}

/**
 * Baixa e guarda os documentos (só os que faltam ou mudaram) + as pendências da unidade para consulta offline.
 * @returns { ok: n, erros: [{ id, erro }] }
 */
export async function guardar({ sb, userId, docs, checklist = null }) {
  const store = await banco(userId);
  const res = { ok: 0, erros: [] };
  if (!docs.length) return res;
  const urls = await assinar(sb, [...new Set(docs.map((d) => d.caminho))]);
  for (const d of docs) {
    try {
      const url = urls.get(d.caminho);
      if (!url) throw new Error("sem permissão ou arquivo indisponível no servidor");
      const { buf, hash } = await baixar(url, d);
      await store.guardar(d, buf, hash);
      const conf = await store.bytes(d.id);   // verificação lendo do aparelho
      if (!conf || conf.byteLength !== buf.byteLength) throw new Error("o aparelho não guardou o arquivo inteiro (espaço insuficiente?)");
      res.ok++;
    } catch (err) {
      const msg = err?.message || String(err);
      res.erros.push({ id: d.id, erro: msg });
      await store.falha(d, msg).catch(() => {});   // a versão válida anterior (se houver) continua guardada
    }
  }
  if (checklist) await store.salvarChecklists([checklist]).catch(() => {});
  try { await navigator.storage?.persist?.(); } catch { /* opcional */ }
  return res;
}

/** Remove os documentos só deste aparelho (nada muda no servidor). */
export async function remover(userId, ids) {
  const store = await banco(userId);
  await store.remover(ids);
}
