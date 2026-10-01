// Regras do Relatório de Contratos com linhas no formato real do relatório 549.
import assert from "node:assert/strict";
import { buildContratos, dedupeRows, totals, statusLabel } from "../src/modules/contratos/contratos/model.js";
import { applyFilters, emptyFilters } from "../src/modules/contratos/contratos/filters.js";

const row = (o) => ({
  empresa: 18, desc_empresa: "ALTO DO BURITI - CONSTRUTORA", obra: "18PRE", desc_obra: "SERVICOS PRELIMINARES",
  objeto: "LOCAÇÃO DE EQUIPAMENTOS", fornecedor: "MANITUR", cod_fornecedor: 77, status: "1 - Aprovado", situacao: "0 - Andamento",
  desc_desconto: "SEM DESCONTOS", taxa_desconto: 0, ...o,
  chave_contrato: o.chave_contrato ?? `${o.empresa ?? 18}-${o.obra ?? "18PRE"}-${o.contrato}-${o.item}`
});
// Contrato 11: valores do contrato repetidos em todas as linhas; item 2 repetido pelo ERP.
const c11 = { contrato: 11, total_contrato: 1500, valor_medido: 900, saldo_contrato: 600 };
const rows = [
  row({ id: 1, ...c11, item: 1, servico: "CAMINHÃO MUNCK", unidade: "MÊS", qtde: 2, preco: 500, subtotal: 1000, qtde_medida: 1, valor_medido_item: 500, qtde_a_medir: 1, valor_a_medir: 500 }),
  row({ id: 2, ...c11, item: 2, servico: "LOCAÇÃO ANDAIME", unidade: "M2MES", qtde: 5, preco: 100, subtotal: 500, qtde_medida: 4, valor_medido_item: 400, qtde_a_medir: 1, valor_a_medir: 100 }),
  row({ id: 3, ...c11, item: 2, servico: "LOCAÇÃO ANDAIME", unidade: "M2MES", qtde: 5, preco: 100, subtotal: 500, qtde_medida: 4, valor_medido_item: 400, qtde_a_medir: 1, valor_a_medir: 100 }),
  // Mesmo número de contrato em outra obra/empresa: é outro contrato.
  row({ id: 4, empresa: 16, obra: "16OBA", desc_obra: "OBRA", contrato: 11, item: 1, servico: "CONCRETO FCK 25", unidade: "M3", qtde: 10, preco: 50, subtotal: 500,
    total_contrato: 500, valor_medido: 250, saldo_contrato: 250, qtde_medida: 10, valor_medido_item: 500, qtde_a_medir: 0, valor_a_medir: 0,
    fornecedor: "CONCRETEIRA X", status: "2 - Em Aditivo", situacao: "0 - Andamento", taxa_desconto: 0.05, desc_desconto: "RETENÇÃO CONTRATUAL" }),
  row({ id: 5, contrato: 12, item: 1, servico: "ESCAVADEIRA", qtde: 1, preco: 300, subtotal: 300, total_contrato: 300, valor_medido: 300, saldo_contrato: 0,
    qtde_medida: 1, valor_medido_item: 300, qtde_a_medir: 0, valor_a_medir: 0, situacao: "3 - Concluído" })
  ,
  // Contrato sem medição: o ERP deixa saldo_contrato vazio.
  row({ id: 6, contrato: 13, item: 1, servico: "CAMINHÃO PIPA", qtde: 4, preco: 100, subtotal: 400, total_contrato: 400, valor_medido: 0, saldo_contrato: null,
    qtde_medida: 0, valor_medido_item: 0, qtde_a_medir: 4, valor_a_medir: 400 })
];

assert.equal(dedupeRows(rows).length, 5, "linha repetida do item (mesma chave_contrato) sai");
const cs = buildContratos(rows);
assert.equal(cs.length, 4, "contrato = empresa + obra + contrato");
const semMed = cs.find((x) => x.key === "18-18PRE-13");
assert.ok(semMed.saldo === 400 && semMed.saldo_calc, "saldo vazio no ERP = total − medido");
const c = cs.find((x) => x.key === "18-18PRE-11");
assert.equal(c.n_itens, 2);
assert.equal(c.valor, 1500, "valor do contrato lido uma vez, não somado por item");
assert.equal(c.medido, 900); assert.equal(c.saldo, 600); assert.equal(c.pct, 60);
assert.equal(c.itens.reduce((t, i) => t + i.subtotal, 0), c.valor, "subtotais sem duplicadas fecham com o total do contrato");
assert.equal(c.itens[1].pct, 80);
const jer = cs.find((x) => x.key === "16-16OBA-11");
assert.equal(jer.medido, 250, "medido do contrato vem do ERP mesmo quando difere da soma dos itens");
assert.equal(jer.retencao, "RETENÇÃO CONTRATUAL 5%");
assert.equal(statusLabel("2 - Em Aditivo"), "Em Aditivo");

const t = totals(cs);
assert.deepEqual([t.contratos, t.valor, t.medido, t.saldo, t.obras], [4, 2700, 1450, 1250, 2], "totais somam cada contrato uma vez");

const f = emptyFilters();
assert.equal(applyFilters(cs, f).length, 3, "padrão: só contratos em aberto (concluído sai)");
assert.equal(applyFilters(cs, { ...f, situacao: "todas" }).length, 4);
assert.equal(applyFilters(cs, { ...f, situacao: "todas", status: "2 - Em Aditivo" }).length, 1);
assert.equal(applyFilters(cs, { ...f, servico: "andaime loc" }).length, 1, "serviço: todas as palavras, sem acento");
assert.equal(applyFilters(cs, { ...f, contrato: "11" }).length, 2);
assert.equal(applyFilters(cs, { ...f, contrato: "1" }).length, 3, "número do contrato por prefixo");
assert.equal(applyFilters(cs, { ...f, fornecedor: "concret" }).length, 1);
assert.equal(applyFilters(cs, { ...f, situacao: "todas", comSaldo: true }).length, 3);
assert.equal(applyFilters(cs, { ...f, obras: new Set(["16OBA"]) }).length, 1);

console.log("Regras do Relatório de Contratos verificadas.");
