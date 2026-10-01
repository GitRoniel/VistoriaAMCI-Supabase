// Filtros do Relatório de Pedidos (puro: estado → lista filtrada). Mesmas regras do HTML antigo.
import { normText } from "../../../platform/core/utils.js";
import { DELIVERY, isOpen } from "./model.js";

export const STATUS_OPTIONS = [
  ["abertos", "Apenas em aberto"],
  ["todos", "Todos os status"],
  [DELIVERY.PENDING, "Pendente de entrega"],
  [DELIVERY.PARTIAL, "Entregue parcialmente"],
  [DELIVERY.TOTAL, "Entregue totalmente"],
  [DELIVERY.CANCELLED, "Cancelado"]
];

export const emptyFilters = () => ({
  oc: "", material: "", fornecedor: "",
  dtIni: "", dtFim: "",
  obras: new Set(), pedidos: new Set(), solicitantes: new Set(),
  status: "abertos",
  ocultarEntregues: true
});

/** Palavras do filtro de material (todas precisam aparecer, sem acento). */
export const materialWords = (f) => normText(f.material.trim()).split(/\s+/).filter(Boolean);

export const materialHit = (m, words) => words.length > 0 && words.every((w) => normText(m.nome).includes(w) || normText(m.codigo).includes(w));

export function ocMatches(p, q) {
  return p.ocs.some((oc) => oc.toLowerCase().includes(q)) || p.materiais.some((m) => (m.oc || "").toLowerCase().includes(q));
}

export function applyFilters(pedidos, f) {
  const words = materialWords(f);
  const oc = f.oc.trim().toLowerCase();
  const forn = normText(f.fornecedor.trim());
  return pedidos.filter((p) => {
    if (f.dtIni && !(p.dt_pedido >= f.dtIni)) return false;
    if (f.dtFim && !(p.dt_pedido <= f.dtFim)) return false;
    if (f.obras.size && !f.obras.has(p.obra)) return false;
    if (f.status === "abertos" && !isOpen(p)) return false;
    if (f.status !== "abertos" && f.status !== "todos" && p.delivery_status !== f.status) return false;
    if (f.solicitantes.size && !f.solicitantes.has(p.solicitante)) return false;
    if (f.ocultarEntregues && p.delivery_status === DELIVERY.TOTAL) return false;
    if (f.pedidos.size && !f.pedidos.has(p.key)) return false;
    if (oc && !ocMatches(p, oc)) return false;
    if (forn && !p.fornecedores.some((n) => normText(n).includes(forn))) return false;
    if (words.length && !p.materiais.some((m) => materialHit(m, words))) return false;
    return true;
  });
}

/** Obras disponíveis (limitadas pelos solicitantes marcados, como no relatório antigo). */
export function obraOptions(pedidos, f) {
  const base = f.solicitantes.size ? pedidos.filter((p) => f.solicitantes.has(p.solicitante)) : pedidos;
  return [...new Set(base.map((p) => p.obra))].sort((a, b) => a.localeCompare(b, "pt-BR"));
}

/** Pedidos disponíveis no seletor (limitados por solicitantes e obras marcados). */
export function pedidoOptions(pedidos, f) {
  return pedidos.filter((p) => (!f.solicitantes.size || f.solicitantes.has(p.solicitante)) && (!f.obras.size || f.obras.has(p.obra)));
}

/** Ao trocar solicitantes, marca todos os pedidos deles (o usuário pode desmarcar depois). */
export function syncPedidosWithSolicitantes(pedidos, f) {
  f.pedidos = new Set(f.solicitantes.size ? pedidos.filter((p) => f.solicitantes.has(p.solicitante)).map((p) => p.key) : []);
}

/** Remove das seleções o que deixou de estar disponível. */
export function pruneSelections(pedidos, f) {
  const obras = new Set(obraOptions(pedidos, f));
  f.obras.forEach((o) => { if (!obras.has(o)) f.obras.delete(o); });
  if (f.obras.size) {
    const byKey = new Map(pedidos.map((p) => [p.key, p]));
    f.pedidos.forEach((k) => { const p = byKey.get(k); if (p && !f.obras.has(p.obra)) f.pedidos.delete(k); });
  }
}
