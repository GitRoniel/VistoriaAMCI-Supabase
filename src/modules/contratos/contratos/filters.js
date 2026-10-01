// Filtros do Relatório de Contratos (puro: estado → lista filtrada).
import { normText } from "../../../platform/core/utils.js";
import { statusLabel } from "./model.js";

/** Situações encerradas no ERP (o restante conta como "em aberto"). */
const isClosed = (c) => /conclu|cancel/.test(normText(statusLabel(c.situacao)));
export const isOpen = (c) => !isClosed(c);

export const emptyFilters = () => ({
  contrato: "", servico: "", fornecedor: "",
  obras: new Set(), contratos: new Set(),
  status: "todos",
  situacao: "abertas",
  comSaldo: false
});

/** Opções de situação/status a partir dos dados reais (valor original do ERP → rótulo). */
export function situacaoOptions(contratos) {
  const vals = [...new Set(contratos.map((c) => c.situacao))].sort((a, b) => a.localeCompare(b, "pt-BR"));
  return [["abertas", "Em aberto"], ["todas", "Todas as situações"], ...vals.map((v) => [v, statusLabel(v)])];
}
export function statusOptions(contratos) {
  const vals = [...new Set(contratos.map((c) => c.status))].sort((a, b) => a.localeCompare(b, "pt-BR"));
  return [["todos", "Todos os status"], ...vals.map((v) => [v, statusLabel(v)])];
}

/** Palavras do filtro de serviço/item (todas precisam aparecer, sem acento). */
export const servicoWords = (f) => normText(f.servico.trim()).split(/\s+/).filter(Boolean);
export const itemHit = (i, words) => words.length > 0 && words.every((w) => normText(i.servico).includes(w) || normText(i.codigo).includes(w));

/** Contrato: número exato/prefixo ou trecho do objeto. */
function contratoMatches(c, q) {
  if (/^\d+$/.test(q)) return String(c.contrato).startsWith(q);
  return normText(c.objeto).includes(normText(q)) || String(c.contrato).includes(q);
}

export function applyFilters(contratos, f) {
  const words = servicoWords(f);
  const ct = f.contrato.trim();
  const forn = normText(f.fornecedor.trim());
  return contratos.filter((c) => {
    if (f.obras.size && !f.obras.has(c.obra)) return false;
    if (f.contratos.size && !f.contratos.has(c.key)) return false;
    if (f.status !== "todos" && c.status !== f.status) return false;
    if (f.situacao === "abertas" && !isOpen(c)) return false;
    if (f.situacao !== "abertas" && f.situacao !== "todas" && c.situacao !== f.situacao) return false;
    if (f.comSaldo && !(c.saldo > 0.005)) return false;
    if (ct && !contratoMatches(c, ct)) return false;
    if (forn && !normText(c.fornecedor).includes(forn)) return false;
    if (words.length && !c.itens.some((i) => itemHit(i, words))) return false;
    return true;
  });
}

export const obraOptions = (contratos) => {
  const m = new Map();
  contratos.forEach((c) => { if (!m.has(c.obra)) m.set(c.obra, c); });
  return [...m.values()].sort((a, b) => a.obra.localeCompare(b.obra, "pt-BR"));
};

/** Contratos disponíveis no seletor (limitados pelas obras marcadas). */
export const contratoOptions = (contratos, f) => contratos.filter((c) => !f.obras.size || f.obras.has(c.obra));

/** Remove dos contratos marcados os que saíram das obras selecionadas. */
export function pruneSelections(contratos, f) {
  if (!f.obras.size) return;
  const byKey = new Map(contratos.map((c) => [c.key, c]));
  f.contratos.forEach((k) => { const c = byKey.get(k); if (c && !f.obras.has(c.obra)) f.contratos.delete(k); });
}
