// Testes das regras do Controle de Chaves (rodam no `pnpm check`).
// As regras do banco (permissões, setor e responsável obrigatórios, concorrência, pedido repetido,
// histórico imutável) ficam na função chaves_transferir e são testadas em scripts/db-tests/chaves.
import assert from "node:assert/strict";
import { situacao, passaFiltros, indicadores, validarTransferencia, descreverMov, limparNome, SETORES_DESTINO, setorLabel } from "../src/modules/chaves/model.js";

// 1) Situação atual: sem linha ou sem setor = "Sem status".
assert.equal(situacao(null).setor, "sem");
assert.equal(situacao({ setor: null }).setor, "sem");
assert.deepEqual(situacao({ setor: "cx", responsavel: "João", movimentado_em: "2026-11-03T13:00:00Z", movimentado_por: "a@x.com", movimentacao_id: 9 }),
  { setor: "cx", responsavel: "João", movimentadoEm: "2026-11-03T13:00:00Z", movimentadoPor: "a@x.com", ultimaMov: 9 });
assert.deepEqual(SETORES_DESTINO, ["base", "cx", "asstec", "producao"]);
assert.equal(setorLabel("producao"), "Produção"); assert.equal(setorLabel(null), "Sem status");

// 2) Filtros: bloco, setor (vários), status da vistoria e busca da unidade.
const u = (b, codigo, setor, vistoria = "ag") => ({ b, codigo, vistoria, situacao: situacao(setor ? { setor } : null) });
const lista = [u("A", "101", "base"), u("A", "604", "cx", "ap"), u("B", "604", null), u("B", "102", "producao", "rv")];
const f = (o) => lista.filter((x) => passaFiltros(x, { bloco: "ALL", apto: "", setor: [], vistoria: "", ...o })).map((x) => x.b + x.codigo);
assert.deepEqual(f({}), ["A101", "A604", "B604", "B102"]);
assert.deepEqual(f({ bloco: "B" }), ["B604", "B102"]);
assert.deepEqual(f({ setor: ["sem", "producao"] }), ["B604", "B102"]);
assert.deepEqual(f({ vistoria: "ap" }), ["A604"]);
assert.deepEqual(f({ apto: "604" }), ["A604", "B604"]);
assert.deepEqual(f({ apto: "a604" }), ["A604"]);
assert.deepEqual(f({ apto: "B 102" }), ["B102"]);

// 3) Indicadores por setor.
assert.deepEqual(indicadores(lista, 3), { total: 4, hoje: 3, base: 1, cx: 1, asstec: 0, producao: 1, sem: 1 });

// 4) Transferência: setor de destino e responsável obrigatórios; não repete a situação atual.
assert.match(validarTransferencia({ setor: "", responsavel: "Ana" }), /setor de destino/);
assert.match(validarTransferencia({ setor: "cozinha", responsavel: "Ana" }), /setor de destino/);
assert.match(validarTransferencia({ setor: "cx", responsavel: "  " }), /responsável/);
assert.match(validarTransferencia({ setor: "cx", responsavel: "x".repeat(81) }), /longo/);
assert.match(validarTransferencia({ setor: "cx", responsavel: " joão " }, situacao({ setor: "cx", responsavel: "João" })), /já está com João/);
assert.equal(validarTransferencia({ setor: "cx", responsavel: "Pedro" }, situacao({ setor: "cx", responsavel: "João" })), "");
assert.equal(validarTransferencia({ setor: "base", responsavel: "Luciana" }, situacao(null)), "");
assert.equal(limparNome("  Pedro   Silva "), "Pedro Silva");

// 5) Histórico: transferência (origem → destino, quem recebeu, quem estava) e registros antigos.
{ const d = descreverMov({ tipo: "transferencia", setor_origem: "base", setor: "cx", responsavel: "Pedro", responsavel_anterior: "Luciana", data_hora: "t", registrado_email: "a@x.com" });
  assert.deepEqual([d.titulo, d.de, d.para, d.recebeu, d.anterior, d.por], ["Transferência", "base", "cx", "Pedro", "Luciana", "a@x.com"]); }
assert.equal(descreverMov({ tipo: "transferencia", setor_origem: null, setor: "base", responsavel: "Ana" }).de, "sem");
{ const d = descreverMov({ tipo: "cadastro", setor: "base", registrado_email: "planilha", observacoes: "Levantamento inicial (planilha)" });
  assert.deepEqual([d.titulo, d.de, d.para, d.por], ["Levantamento inicial", null, "base", "planilha de levantamento"]); }
{ const d = descreverMov({ tipo: "devolucao", setor: "base", responsavel: "João", recebido_por: "Luciana", registrado_email: "b@x.com" });
  assert.deepEqual([d.titulo, d.recebeu, d.anterior], ["Devolução", "Luciana", "João"]); }

console.log("Regras do Controle de Chaves verificadas.");
