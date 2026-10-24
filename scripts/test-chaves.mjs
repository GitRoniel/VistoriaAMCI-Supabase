// Testes das regras do Controle de Chaves (rodam no `pnpm check`).
// As regras do banco (permissões, disponibilidade, concorrência, histórico imutável) ficam nas funções
// chaves_* da migration; aqui ficam as regras da tela: situação da unidade, divergências, filtros e validações.
import assert from "node:assert/strict";
import { resumoUnidade, itensDaUnidade, cadastroSugerido, passaFiltros, indicadores, validarSaida, validarDevolucao, resumoChaves } from "../src/modules/chaves/model.js";

let id = 0;
const k = (o) => ({ id: ++id, categoria: "entrada", comodo: 1, copia: 1, local: "base", situacao: "ativa", responsavel: "", retirada_em: null, previsao_devolucao: null, ...o });
const agora = Date.parse("2026-10-24T12:00:00Z");
const chaves3Q = () => [k({ copia: 1 }), k({ copia: 2 }), k({ categoria: "quarto", comodo: 1 }), k({ categoria: "quarto", comodo: 2 }), k({ categoria: "quarto", comodo: 3 }),
  k({ categoria: "banheiro", comodo: 1 }), k({ categoria: "banheiro", comodo: 2 })];

// 1) Sem chaves: "sem status"; levantamento com chaves e sem quantidades: Base "a cadastrar".
assert.equal(resumoUnidade(null, [], 2, agora).status, "sem");
assert.equal(resumoUnidade({ tem_chaves: false }, [], 2, agora).status, "sem");
{ const r = resumoUnidade({ tem_chaves: true }, [], 3, agora); assert.equal(r.status, "base"); assert.ok(r.aCadastrar); assert.ok(!r.disponivel); }

// 2) Todas na Base: disponível; retirada parcial: setor + parcial; pendência pela previsão vencida.
{ const c = chaves3Q(); const r = resumoUnidade({ tem_chaves: true }, c, 3, agora);
  assert.deepEqual([r.status, r.total, r.naBase, r.disponivel, r.divergente], ["base", 7, 7, true, false]); }
{ const c = chaves3Q(); Object.assign(c[0], { local: "cx", responsavel: "João", retirada_em: "2026-10-24T10:00:00Z", previsao_devolucao: "2026-10-24T11:00:00Z" });
  const r = resumoUnidade({ tem_chaves: true }, c, 3, agora);
  assert.deepEqual([r.status, r.parcial, r.fora, r.pendente, r.atrasadas], ["cx", true, 1, true, 1]); assert.deepEqual(r.responsaveis, ["João"]); }
// mais de um setor: vale a retirada mais recente
{ const c = chaves3Q(); Object.assign(c[0], { local: "cx", retirada_em: "2026-10-24T08:00:00Z" }); Object.assign(c[2], { local: "producao", retirada_em: "2026-10-24T09:00:00Z" });
  const r = resumoUnidade({ tem_chaves: true }, c, 3, agora); assert.equal(r.status, "producao"); assert.deepEqual(r.setoresFora.sort(), ["cx", "producao"]); assert.ok(!r.pendente); }

// 3) Divergências: extravio, cadastro diferente da tipologia, sem chave de entrada.
{ const c = chaves3Q(); c[1].situacao = "extraviada"; const r = resumoUnidade({ tem_chaves: true }, c, 3, agora); assert.ok(r.divergente); assert.match(r.divergencias[0], /1 chave extraviada/); }
{ const r = resumoUnidade({ tem_chaves: true }, chaves3Q(), 2, agora); assert.match(r.divergencias.join(), /3 quartos para tipologia de 2/); }
{ const c = chaves3Q().filter((x) => x.categoria !== "entrada"); assert.match(resumoUnidade(null, c, 3, agora).divergencias.join(), /entrada/); }

// 4) Itens por categoria com as cópias; sugestão de cadastro pela tipologia (sem presumir quantidades iguais).
{ const it = itensDaUnidade(chaves3Q()); assert.deepEqual(it.map((x) => `${x.rotulo}:${x.total}`), ["Entrada:2", "Quarto 1:1", "Quarto 2:1", "Quarto 3:1", "Banheiro 1:1", "Banheiro 2:1"]); }
{ const s = cadastroSugerido(2, []); assert.deepEqual(s.map((x) => `${x.categoria}${x.comodo}x${x.copias}`), ["entrada1x1", "quarto1x1", "quarto2x1", "banheiro1x1"]); }
{ const s = cadastroSugerido(3, chaves3Q()); assert.equal(s.find((x) => x.categoria === "entrada").copias, 2); assert.equal(s.filter((x) => x.categoria === "quarto").length, 3); }

// 5) Filtros e indicadores.
const U = (o) => ({ bloco: "A", pav: "1º", apto: "02", codigo: "102", quartos: 3, vistoria: "ap", ...o });
{ const disp = U({ resumo: resumoUnidade({ tem_chaves: true }, chaves3Q(), 3, agora) });
  const c = chaves3Q(); Object.assign(c[0], { local: "asstec", retirada_em: "2026-10-23T10:00:00Z", previsao_devolucao: "2026-10-23T18:00:00Z" });
  const pend = U({ apto: "03", codigo: "103", vistoria: "rv", resumo: resumoUnidade({ tem_chaves: true }, c, 3, agora) });
  const sem = U({ bloco: "B", apto: "01", codigo: "101", quartos: 2, vistoria: "na", resumo: resumoUnidade(null, [], 2, agora) });
  const f0 = { bloco: "ALL", apto: "", status: [], tipologia: "ALL", vistoria: [], situacao: "", rapido: "" };
  const so = (f) => [disp, pend, sem].filter((u) => passaFiltros(u, { ...f0, ...f })).map((u) => u.bloco + u.codigo);
  assert.deepEqual(so({ situacao: "pendente" }), ["A103"]);
  assert.deepEqual(so({ situacao: "disponivel" }), ["A102"]);
  assert.deepEqual(so({ status: ["asstec"] }), ["A103"]);
  assert.deepEqual(so({ status: ["sem"] }), ["B101"]);
  assert.deepEqual(so({ tipologia: "2" }), ["B101"]);
  assert.deepEqual(so({ apto: "a102" }), ["A102"]);
  assert.deepEqual(so({ bloco: "B" }), ["B101"]);
  assert.deepEqual(so({ rapido: "aprovada-disponivel" }), ["A102"]);
  assert.deepEqual(so({ rapido: "aguardando" }), ["A103", "B101"]);
  const ind = indicadores([disp, pend, sem], 4);
  assert.deepEqual([ind.total, ind.disponiveis, ind.retiradas, ind.pendentes, ind.semStatus, ind.movsHoje], [3, 1, 1, 1, 1, 4]); }

// 6) Validações antes da confirmação (o banco valida de novo).
assert.match(validarSaida({ ids: [], setor: "cx", responsavel: "João", dataHora: "2026-10-24T11:00:00Z" }, agora), /Selecione/);
assert.match(validarSaida({ ids: [1], setor: "base", responsavel: "João", dataHora: "2026-10-24T11:00:00Z" }, agora), /setor/);
assert.match(validarSaida({ ids: [1], setor: "cx", responsavel: " ", dataHora: "2026-10-24T11:00:00Z" }, agora), /responsável/);
assert.match(validarSaida({ ids: [1], setor: "cx", responsavel: "João", dataHora: "2026-10-25T11:00:00Z" }, agora), /futuro/);
assert.match(validarSaida({ ids: [1], setor: "cx", responsavel: "João", dataHora: "2026-10-24T11:00:00Z", previsao: "2026-10-24T10:00:00Z" }, agora), /anterior/);
assert.equal(validarSaida({ ids: [1], setor: "producao", responsavel: "João", dataHora: "2026-10-24T11:00:00Z", previsao: "2026-10-25T10:00:00Z" }, agora), "");
assert.match(validarDevolucao({ ids: [1], recebidoPor: "", dataHora: "2026-10-24T11:00:00Z" }, agora), /recebeu/);
assert.equal(validarDevolucao({ ids: [1], recebidoPor: "Carla", dataHora: "2026-10-24T11:00:00Z" }, agora), "");
assert.equal(resumoChaves(chaves3Q()), "Entrada (2), Quarto 1, Quarto 2, Quarto 3, Banheiro 1, Banheiro 2");

console.log("Regras do Controle de Chaves verificadas.");
