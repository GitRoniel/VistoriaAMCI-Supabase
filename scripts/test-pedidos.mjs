// Testes das regras do Relatório de Pedidos (rodam no `pnpm check`).
// Casos baseados em situações reais do relatório 1187 (valores simplificados).
import assert from "node:assert/strict";
import { buildPedidos, dedupeRows, kpis, DELIVERY, OC } from "../src/modules/suprimentos/pedidos/model.js";
import { applyFilters, emptyFilters, obraOptions, syncPedidosWithSolicitantes } from "../src/modules/suprimentos/pedidos/filters.js";

let id = 0;
const row = (o) => ({ id: ++id, obra: "06CS", pedido: 3, ordem_compra: null, cod_insumo: "I1", insumo: "CABO DE COBRE FLEXÍVEL", unidade: "M",
  qtde_entregue: 0, qtde_descartada: 0, qtde_restante: 0, dt_pedido: "2026-08-27T13:04:36", quem: "MAURICIO",
  dt_prevista_entrega: "2026-09-17", data_entrega: null, fornecedor: null, nome_fantasia: null, observacao_pedido: null, ...o });

// 1) Linha sem OC repetida depois da compra é descartada; saldo sem OC que sobra é mantido.
{
  const rows = [
    row({ cod_insumo: "A", qtde_entregue: 600 }),
    row({ cod_insumo: "A", ordem_compra: 8, qtde_entregue: 600, fornecedor: "MUNDIAL CENTER", nome_fantasia: "MUNDIAL" }),
    row({ obra: "15POS", pedido: 5, cod_insumo: "B", qtde_restante: 1 }),
    row({ obra: "15POS", pedido: 5, cod_insumo: "B", qtde_restante: 200 }),
    row({ obra: "15POS", pedido: 5, cod_insumo: "B", ordem_compra: 17, qtde_restante: 200 }),
    // item dividido em duas OCs + linha original com o total
    row({ obra: "18OBA", pedido: 9, cod_insumo: "C", qtde_entregue: 10, qtde_restante: 5 }),
    row({ obra: "18OBA", pedido: 9, cod_insumo: "C", ordem_compra: 1, qtde_entregue: 10 }),
    row({ obra: "18OBA", pedido: 9, cod_insumo: "C", ordem_compra: 2, qtde_restante: 5 })
  ];
  const kept = dedupeRows(rows);
  assert.equal(kept.length, 5, "remove só as linhas sem OC que repetem a compra");
  assert.ok(kept.some((r) => r.cod_insumo === "B" && r.ordem_compra == null && r.qtde_restante === 1), "mantém o saldo ainda sem OC");
  const [a, b, c] = ["06CS-3", "15POS-5", "18OBA-9"].map((k) => buildPedidos(rows).find((p) => p.key === k));
  assert.equal(a.delivery_status, DELIVERY.TOTAL); assert.equal(a.oc_status, OC.DONE); assert.equal(a.n_itens, 1); assert.equal(a.fornecedor, "MUNDIAL");
  assert.equal(b.delivery_status, DELIVERY.PENDING); assert.equal(b.oc_status, OC.PENDING, "saldo sem OC deixa a OC pendente");
  assert.equal(c.delivery_status, DELIVERY.PARTIAL); assert.equal(c.oc, "1, 2"); assert.equal(c.pct, 50);
}

// 2) Quantidade descartada: não conta como saldo; item todo descartado = cancelado.
{
  const ps = buildPedidos([
    row({ obra: "18OBA", pedido: 278, cod_insumo: "T", ordem_compra: 345, qtde_entregue: 150, qtde_descartada: 200 }),
    row({ obra: "16PRE", pedido: 25, cod_insumo: "AV", ordem_compra: 36, qtde_descartada: 5 })
  ]);
  const t = ps.find((p) => p.pedido === 278), cancel = ps.find((p) => p.pedido === 25);
  assert.equal(t.delivery_status, DELIVERY.TOTAL);
  assert.deepEqual([t.materiais[0].sol, t.materiais[0].ent, t.materiais[0].desc, t.materiais[0].saldo, t.materiais[0].pct], [350, 150, 200, 0, 100]);
  assert.equal(cancel.delivery_status, DELIVERY.CANCELLED);
  assert.equal(cancel.materiais[0].status, "cancelado");
}

// 3) Descrição, previsão e indicadores.
{
  const ps = buildPedidos([
    row({ obra: "E01", pedido: 51, cod_insumo: "X", ordem_compra: 50, qtde_restante: 2, observacao_pedido: "REPOSIÇÃO DE ESTOQUE", dt_prevista_entrega: "2026-03-20" }),
    row({ obra: "E01", pedido: 51, cod_insumo: "Y", ordem_compra: 50, qtde_entregue: 1, observacao_pedido: "REPOSIÇÃO DE ESTOQUE", dt_prevista_entrega: "2026-03-10" }),
    row({ obra: "E01", pedido: 52, cod_insumo: "Z", qtde_restante: 3, quem: "REGIS" })
  ]);
  const p51 = ps.find((p) => p.pedido === 51), p52 = ps.find((p) => p.pedido === 52);
  assert.equal(p51.descricao, "REPOSIÇÃO DE ESTOQUE");
  assert.equal(p52.descricao, "Materiais diversos");
  assert.equal(p51.dt_prev, "2026-03-20", "previsão: a do item que ainda tem saldo");
  assert.equal(p51.dt_pedido, "2026-08-27");
  assert.deepEqual(kpis(ps), { total: 2, comOC: 1, semOC: 1, entregues: 0, parciais: 1, pendentes: 1, obras: 1 });
}

// 4) Filtros: em aberto por padrão, material sem acento (todas as palavras), OC dos itens, solicitantes.
{
  const ps = buildPedidos([
    row({ obra: "A", pedido: 1, cod_insumo: "1", insumo: "CABO DE COBRE FLEXÍVEL", ordem_compra: 10, qtde_restante: 5, quem: "ANA", fornecedor: "CONDOR ATACADISTA", nome_fantasia: "CONDOR" }),
    row({ obra: "A", pedido: 2, cod_insumo: "2", insumo: "TINTA ACRÍLICA", ordem_compra: 11, qtde_entregue: 5, quem: "BIA" }),
    row({ obra: "B", pedido: 1, cod_insumo: "3", insumo: "CIMENTO", qtde_restante: 76, quem: "BIA", dt_pedido: "2026-04-22T16:15:19" })
  ]);
  const f = emptyFilters();
  assert.deepEqual(applyFilters(ps, f).map((p) => p.key), ["A-1", "B-1"], "padrão: só em aberto");
  f.status = "todos"; f.ocultarEntregues = false;
  assert.equal(applyFilters(ps, f).length, 3);
  assert.deepEqual(applyFilters(ps, { ...f, material: "flexivel cobre" }).map((p) => p.key), ["A-1"]);
  assert.deepEqual(applyFilters(ps, { ...f, oc: "11" }).map((p) => p.key), ["A-2"]);
  assert.deepEqual(applyFilters(ps, { ...f, fornecedor: "condor" }).map((p) => p.key), ["A-1"]);
  assert.deepEqual(applyFilters(ps, { ...f, dtIni: "2026-04-01", dtFim: "2026-05-01" }).map((p) => p.key), ["B-1"]);
  f.solicitantes = new Set(["BIA"]);
  assert.deepEqual(obraOptions(ps, f), ["A", "B"]);
  syncPedidosWithSolicitantes(ps, f);
  assert.deepEqual([...f.pedidos].sort(), ["A-2", "B-1"], "marcar solicitante marca os pedidos dele");
}

console.log("Regras do Relatório de Pedidos verificadas.");
