// Regras de negócio do Relatório de Pedidos (sem acesso a tela nem ao Supabase).
//
// Transforma as linhas do relatório 1187 (uma por insumo) no mesmo formato que o HTML antigo
// recebia da planilha em /api/dados: um registro por pedido (obra + nº do pedido) com seus materiais.
//
// Mapeamento (planilha/HTML antigo → Supabase):
//   obra ............... obra
//   pedido ............. pedido
//   solicitante ........ quem
//   dt_pedido .......... dt_pedido (data)
//   dt_prev ............ dt_prevista_entrega (a mais próxima entre os itens com saldo; senão a maior)
//   oc ................. ordem_compra (todas as OCs distintas do pedido)
//   fornecedor ......... nome_fantasia, ou fornecedor quando não há nome fantasia (todos os distintos)
//   descrição (descMap)  observacao_pedido (a mais frequente no pedido; senão "Materiais diversos")
//   n_itens ............ quantidade de insumos (linhas) do pedido
//   materiais[].nome ... insumo  (+ cod_insumo e unidade)
//   materiais[].oc ..... ordem_compra; "Pendente" quando ainda há saldo e não há OC
//   materiais[].sol .... qtde_entregue + qtde_descartada + qtde_restante (total pedido)
//   materiais[].ent .... qtde_entregue
//   materiais[].saldo .. qtde_restante
//   materiais[].desc ... qtde_descartada (quantidade cancelada/descartada no ERP)
//   materiais[].pct .... entregue ÷ (entregue + restante); item todo descartado = cancelado
//   delivery_status .... sem saldo → ENTREGUE TOTALMENTE; com saldo e algo entregue → ENTREGUE
//                        PARCIALMENTE; com saldo e nada entregue → PENDENTE DE ENTREGA;
//                        todos os itens descartados → CANCELADO
//   oc_status .......... OC PENDENTE quando algum item com saldo ainda não tem OC; senão OC GERADA
//   pct ................ média do % de entrega dos itens não cancelados

export const DELIVERY = Object.freeze({
  TOTAL: "ENTREGUE TOTALMENTE",
  PARTIAL: "ENTREGUE PARCIALMENTE",
  PENDING: "PENDENTE DE ENTREGA",
  CANCELLED: "CANCELADO"
});
export const OC = Object.freeze({ DONE: "OC GERADA", PENDING: "OC PENDENTE" });
export const DEFAULT_DESC = "Materiais diversos";

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const day = (v) => (v ? String(v).slice(0, 10) : "");

function mostFrequent(values) {
  const count = new Map();
  values.forEach((v) => { const t = String(v || "").trim(); if (t) count.set(t, (count.get(t) || 0) + 1); });
  let best = "", n = 0;
  count.forEach((c, v) => { if (c > n) { best = v; n = c; } });
  return best;
}

/** Item (material) a partir de uma linha do relatório. */
export function buildMaterial(r) {
  const ent = num(r.qtde_entregue), saldo = num(r.qtde_restante), desc = num(r.qtde_descartada);
  const valid = ent + saldo;
  const cancelled = valid <= 0;
  const pct = cancelled ? 100 : Math.round((ent / valid) * 100);
  const oc = r.ordem_compra != null ? String(r.ordem_compra) : (saldo > 0 ? "Pendente" : "");
  const status = cancelled ? "cancelado" : saldo <= 0 ? "ok" : ent > 0 ? "parcial" : "pendente";
  return {
    nome: String(r.insumo || "").trim() || "(sem descrição)",
    codigo: r.cod_insumo || "",
    unidade: r.unidade || "",
    oc, sol: ent + desc + saldo, ent, saldo, desc, pct, status, cancelled,
    fornecedor: (r.nome_fantasia || r.fornecedor || "").trim(),
    dt_entrega: day(r.data_entrega),
    dt_prev: day(r.dt_prevista_entrega)
  };
}

const qtyKey = (r) => `${num(r.qtde_entregue)}|${num(r.qtde_restante)}|${num(r.qtde_descartada)}`;

/**
 * Remove as linhas duplicadas do relatório 1187.
 * Depois que a OC é emitida, o ERP continua listando a linha original do pedido (sem OC) além das
 * linhas por OC, com as mesmas quantidades. Em cada pedido + insumo, a linha sem OC é descartada
 * quando coincide com o total das linhas com OC ou com uma delas; o que sobrar sem OC é saldo
 * ainda não comprado (ex.: 200 com OC + 1 sem OC).
 */
export function dedupeRows(rows) {
  const groups = new Map();
  (rows || []).forEach((r) => {
    const k = `${r.obra}|${r.pedido}|${r.cod_insumo || r.insumo}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  });
  const out = [];
  groups.forEach((list) => {
    const withOc = list.filter((r) => r.ordem_compra != null);
    const withoutOc = list.filter((r) => r.ordem_compra == null);
    out.push(...withOc);
    if (!withOc.length) { out.push(...withoutOc); return; }
    const total = qtyKey({
      qtde_entregue: withOc.reduce((s, r) => s + num(r.qtde_entregue), 0),
      qtde_restante: withOc.reduce((s, r) => s + num(r.qtde_restante), 0),
      qtde_descartada: withOc.reduce((s, r) => s + num(r.qtde_descartada), 0)
    });
    const singles = withOc.map(qtyKey);
    let totalUsed = false;
    withoutOc.forEach((r) => {
      const k = qtyKey(r);
      if (!totalUsed && k === total) { totalUsed = true; return; }
      const i = singles.indexOf(k);
      if (i >= 0) { singles.splice(i, 1); return; }
      out.push(r);
    });
  });
  return out.sort((a, b) => (a.id ?? 0) - (b.id ?? 0));
}

/**
 * Agrupa as linhas do relatório em pedidos (chave: OBRA-PEDIDO).
 * `observacoes` (opcional): Map("OBRA-PEDIDO" → observação do pedido, de pedidos_observacoes). Quando existe,
 * é a descrição do pedido; senão vale a observação mais frequente das linhas do relatório 1187.
 */
export function buildPedidos(rows, observacoes = null) {
  const groups = new Map();
  dedupeRows(rows).forEach((r) => {
    if (r.obra == null || r.pedido == null) return;
    const key = `${r.obra}-${r.pedido}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  });

  const pedidos = [];
  groups.forEach((list, key) => {
    const first = list[0];
    const materiais = list.map(buildMaterial).sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
    const ativos = materiais.filter((m) => !m.cancelled);
    const saldo = ativos.reduce((s, m) => s + m.saldo, 0);
    const entregue = ativos.reduce((s, m) => s + m.ent, 0);

    let delivery;
    if (!ativos.length) delivery = DELIVERY.CANCELLED;
    else if (saldo <= 0) delivery = DELIVERY.TOTAL;
    else if (entregue > 0) delivery = DELIVERY.PARTIAL;
    else delivery = DELIVERY.PENDING;

    const ocs = [...new Set(list.map((r) => r.ordem_compra).filter((v) => v != null))].sort((a, b) => a - b).map(String);
    const ocPendente = materiais.some((m) => m.oc === "Pendente");
    const fornecedores = [...new Set(materiais.map((m) => m.fornecedor).filter(Boolean))].sort((a, b) => a.localeCompare(b, "pt-BR"));
    const prevAbertos = materiais.filter((m) => !m.cancelled && m.saldo > 0 && m.dt_prev).map((m) => m.dt_prev).sort();
    const prevTodos = materiais.map((m) => m.dt_prev).filter(Boolean).sort();
    const pct = ativos.length ? Math.round(ativos.reduce((s, m) => s + m.pct, 0) / ativos.length) : 100;

    pedidos.push({
      key,
      obra: String(first.obra),
      pedido: Number(first.pedido),
      solicitante: String(first.quem || "").trim() || "—",
      dt_pedido: day(first.dt_pedido),
      dt_prev: prevAbertos[0] || prevTodos[prevTodos.length - 1] || "",
      n_itens: materiais.length,
      oc: ocs.join(", "),
      ocs,
      oc_status: ocPendente ? OC.PENDING : OC.DONE,
      delivery_status: delivery,
      pct,
      fornecedor: fornecedores.join(" · "),
      fornecedores,
      ...descricaoPedido(observacoes?.get(key), mostFrequent(list.map((r) => r.observacao_pedido))),
      materiais
    });
  });

  return pedidos.sort((a, b) => a.obra.localeCompare(b.obra, "pt-BR") || a.pedido - b.pedido);
}

/** Descrição exibida: observação do pedido (tabela de observações) ou a do relatório; a outra fica como nota. */
function descricaoPedido(obs, rel) {
  const o = String(obs || "").trim(), r = String(rel || "").trim();
  const descricao = o || r || DEFAULT_DESC;
  const nota = o && r && o.toLocaleUpperCase("pt-BR") !== r.toLocaleUpperCase("pt-BR") ? r : "";
  return { descricao, descricao_obs: !!o, nota };
}

/** Pedido ainda em aberto (nem entregue totalmente nem cancelado). */
export const isOpen = (p) => p.delivery_status === DELIVERY.PARTIAL || p.delivery_status === DELIVERY.PENDING;

/** Indicadores do topo (mesmos do relatório antigo). */
export function kpis(pedidos) {
  const count = (fn) => pedidos.filter(fn).length;
  return {
    total: pedidos.length,
    comOC: count((p) => p.oc_status === OC.DONE),
    semOC: count((p) => p.oc_status !== OC.DONE),
    entregues: count((p) => p.delivery_status === DELIVERY.TOTAL),
    parciais: count((p) => p.delivery_status === DELIVERY.PARTIAL),
    pendentes: count((p) => p.delivery_status === DELIVERY.PENDING),
    obras: new Set(pedidos.map((p) => p.obra)).size
  };
}
