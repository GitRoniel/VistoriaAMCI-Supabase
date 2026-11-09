// Testes das regras da Revistoria · Cliente (rodam no `pnpm check`). As regras de gravação (entrada
// automática, ciclos, permissões, versão da tela, pedido repetido, histórico imutável, sincronização com a
// vistoria) ficam no banco e são testadas em scripts/db-tests/revistoria-cliente.
import assert from "node:assert/strict";
import * as M from "../src/modules/revistoria-cliente/model.js";
import { comparar as compararPlanilha, revInfo } from "../src/modules/vistorias/revistorias.js";

// 1) Cores padronizadas.
assert.equal(M.info("Aprovado").cor, "#2f9e5b");      // verde
assert.equal(M.EM_REVISTORIA.cor, "#e8842a");         // laranja (mesma cor do status Revistoria da vistoria)
assert.equal(M.info("Em andamento").cor, "#f2c14e");  // amarelo
assert.equal(M.info("Agendado").cor, "#2f6fdb");      // azul
assert.equal(M.info("").label, "Sem registro");       // cinza
assert.deepEqual(M.FILTROS.map((f) => f.label), ["Todos", "Aprovados", "Em Revistoria", "Em andamento", "Agendados"]);

// 2) Filtros rápidos nos dois contextos.
const un = [
  { id: "ap", vistoria: "ap", revistoria: "" },             // aprovada na 1ª vistoria
  { id: "rv-and", vistoria: "rv", revistoria: "Em andamento" },
  { id: "rv-ag", vistoria: "rv", revistoria: "Agendado" },
  { id: "rf-ok", vistoria: "rf", revistoria: "Aprovado" },  // revistoria aprovada
  { id: "na", vistoria: "na", revistoria: "" }
];
const f = (k, ctx) => un.filter((u) => M.passaFiltroRapido(k, u, ctx)).map((u) => u.id);
assert.deepEqual(f("todos", "vistoria"), ["ap", "rv-and", "rv-ag", "rf-ok", "na"]);
assert.deepEqual(f("aprovados", "vistoria"), ["ap", "rf-ok"]);
assert.deepEqual(f("em_revistoria", "vistoria"), ["rv-and", "rv-ag"]);
assert.deepEqual(f("em_andamento", "vistoria"), ["rv-and"]);
assert.deepEqual(f("agendados", "vistoria"), ["rv-ag"]);
assert.deepEqual(f("todos", "revistoria"), ["rv-and", "rv-ag", "rf-ok"]);
assert.deepEqual(f("aprovados", "revistoria"), ["rf-ok"]);
assert.deepEqual(f("em_revistoria", "revistoria"), ["rv-and", "rv-ag"]);

// 3) Situação da unidade: agendamento em aberto, realizadas (quantas vezes passou por revistoria), ciclo.
const ags = [
  { id: 1, numero: 1, status: "Reprovada", data: "2026-10-01", realizada_em: "2026-10-01", responsavel: "Ana" },
  { id: 2, numero: 2, status: "Cancelada", data: "2026-10-10" },
  { id: 3, numero: 3, status: "Agendada", data: "2026-11-12", horario: "09:30:00", responsavel: "Bruno" }
];
let s = M.situacao({ status: "Agendado", ciclo: 2, versao: 5 }, ags);
assert.equal(s.aberto.id, 3); assert.equal(s.realizadas, 1); assert.equal(s.lista.length, 3); assert.equal(s.ciclo, 2); assert.equal(s.versao, 5);
assert.equal(M.proxima(s), "2026-11-12");
assert.equal(M.situacao(null, ags).status, ""); assert.equal(M.situacao(null).info.label, "Sem registro");
s = M.situacao({ status: "Em andamento", ciclo: 2 }, ags);
assert.equal(s.aberto, null); assert.equal(s.ultima.id, 1);
assert.deepEqual(M.agendamento(ags[0]), { status: "Realizado", resultado: "Reprovada", aberto: false });
assert.equal(M.agendamento(ags[1]).status, "Cancelado");
assert.equal(M.agendamento(ags[2]).status, "Agendado");

// 4) Indicadores e ordem (agendadas pela data mais próxima, depois em andamento e aprovadas).
const lista = [
  { b: "A", situacao: M.situacao({ status: "Aprovado" }, [{ numero: 1, status: "Aprovada" }]) },
  { b: "B", situacao: M.situacao({ status: "Agendado" }, [{ numero: 1, status: "Agendada", data: "2026-11-20" }]) },
  { b: "C", situacao: M.situacao({ status: "Em andamento" }, []) },
  { b: "D", situacao: M.situacao({ status: "Agendado" }, [{ numero: 1, status: "Reprovada" }, { numero: 2, status: "Agendada", data: "2026-11-05" }]) },
  { b: "E", situacao: M.situacao(null, []) }
];
assert.deepEqual(M.indicadores(lista, "2026-11-04"), { total: 4, "Em andamento": 1, Agendado: 2, Aprovado: 1, realizadas: 2, hoje: 0, semana: 1, liberados: 0 });
assert.deepEqual([...lista].sort((x, y) => M.comparar(x, y)).map((u) => u.b), ["D", "B", "C", "A", "E"]);

// 5) Filtros da aba: bloco, unidade/cliente e rápido.
const u = (b, codigo, cliente, st, vist = "rv") => ({ b, codigo, cliente, vistoria: vist, situacao: M.situacao(st ? { status: st } : null, []) });
const us = [u("A", "604", "João Silva", "Agendado"), u("B", "604", "Maria", "Em andamento"), u("B", "101", "Pedro", "Aprovado", "rf"), u("C", "101", "", null, "ap")];
const ff = (o) => us.filter((x) => M.passaFiltros(x, { bloco: "ALL", busca: "", rapido: "todos", ...o })).map((x) => x.b + x.codigo);
assert.deepEqual(ff({}), ["A604", "B604", "B101"]);   // sem registro não aparece na aba
assert.deepEqual(ff({ busca: "604" }), ["A604", "B604"]);
assert.deepEqual(ff({ busca: "a604" }), ["A604"]);
assert.deepEqual(ff({ busca: "joao" }), ["A604"]);
assert.deepEqual(ff({ bloco: "B", rapido: "em_revistoria" }), ["B604"]);
assert.deepEqual(ff({ rapido: "aprovados" }), ["B101"]);

// 6) Validações (o banco confere de novo).
const hoje = "2026-11-04";
assert.match(M.validarAgendamento({ data: "", responsavel: "Ana" }, hoje), /data/);
assert.match(M.validarAgendamento({ data: "2026-02-31", responsavel: "Ana" }, hoje), /inválida/);
assert.match(M.validarAgendamento({ data: "2026-11-10", responsavel: " " }, hoje), /responsável/);
assert.match(M.validarAgendamento({ data: "2026-11-10", horario: "9h", responsavel: "Ana" }, hoje), /Horário/);
assert.equal(M.validarAgendamento({ data: "2026-11-10", horario: "09:30", responsavel: "Ana" }, hoje), "");
assert.match(M.validarResultado({ resultado: "", realizada: hoje }, hoje), /resultado/);
assert.match(M.validarResultado({ resultado: "Aprovada", realizada: "2026-11-05" }, hoje), /futura/);
assert.match(M.validarResultado({ resultado: "Reprovada", realizada: hoje, obs: "" }, hoje), /pendências/);
assert.equal(M.validarResultado({ resultado: "Reprovada", realizada: hoje, obs: "Rejunte" }, hoje), "");
assert.equal(M.validarResultado({ resultado: "Aprovada", realizada: hoje }, hoje), "");
assert.match(M.validarReabrir("  "), /pendências/);
assert.deepEqual(M.acoes("Em andamento", true), ["agendar"]);
assert.deepEqual(M.acoes("Agendado", true), ["resultado", "remarcar", "cancelar"]);
assert.deepEqual(M.acoes("Aprovado", true), ["reabrir"]);
assert.deepEqual(M.acoes("Agendado", false), []);   // visitante só consulta

// 7) Histórico.
assert.equal(M.descreverEvento({ tipo: "resultado", status_novo: "Em andamento", status_anterior: "Agendado" }).titulo, "Revistoria reprovada");
assert.equal(M.descreverEvento({ tipo: "resultado", status_novo: "Aprovado" }).titulo, "Revistoria aprovada");
assert.equal(M.descreverEvento({ tipo: "entrada", status_novo: "Em andamento", registrado_email: "migração" }).por, "situação inicial");

// 8) Planilha: agendamento Cancelado na aba + nova data na planilha = revistoria nova (sem duplicar a cancelada).
assert.equal(revInfo("Cancelada").label, "Cancelada");
const it = compararPlanilha({ numero: 2, status: "Cancelada", data: "2026-10-10" }, { status: "Agendada", statusOriginal: "AGENDADA", data: "2026-11-12", hora: "" });
assert.equal(it.rev.acao, "nova"); assert.equal(it.rev.numero, 2);

// 9) Liberação e execução: filtros combinados (rápido + liberado + execução) e cores próprias.
assert.deepEqual(M.EXECUCOES.map((e) => `${e.equipe}/${e.responsavel}`), ["M.O.P/Felipe", "M.O.P/Renato", "EMP/Oscar", "EMP/Nilson"]);
assert.ok(M.EXECUCOES.every((e) => !Object.values(M.STATUS).some((st) => st.cor === e.cor) && e.cor !== M.EM_REVISTORIA.cor), "cores de execução diferentes das de status");
assert.equal(new Set(M.EXECUCOES.map((e) => e.cor)).size, 4);
const ue = (id, st, liberado, execucao) => ({ b: "A", codigo: id, cliente: "", vistoria: "rv", situacao: M.situacao({ status: st, liberado, execucao }, []) });
const ues = [ue("1", "Em andamento", true, "MOP_FELIPE"), ue("2", "Em andamento", false, "MOP_RENATO"), ue("3", "Agendado", true, "EMP_OSCAR"),
  ue("4", "Agendado", true, null), ue("5", "Aprovado", false, "EMP_NILSON"), ue("6", "Em andamento", true, "XYZ")];
const fe = (o) => ues.filter((x) => M.passaFiltros(x, { bloco: "ALL", busca: "", rapido: "todos", liberado: "", execucao: "", ...o })).map((x) => x.codigo).join(",");
assert.equal(fe({ liberado: "sim" }), "1,3,4,6");
assert.equal(fe({ liberado: "nao" }), "2,5");
assert.equal(fe({ execucao: "MOP_FELIPE" }), "1");
assert.equal(fe({ execucao: "MOP_RENATO" }), "2");
assert.equal(fe({ execucao: "EMP_OSCAR" }), "3");
assert.equal(fe({ execucao: "EMP_NILSON" }), "5");
assert.equal(fe({ execucao: "equipe:M.O.P" }), "1,2");
assert.equal(fe({ execucao: "equipe:EMP" }), "3,5");
assert.equal(fe({ execucao: "sem" }), "4,6");                 // valor desconhecido conta como sem execução
assert.equal(fe({ liberado: "sim", execucao: "equipe:EMP", rapido: "agendados" }), "3");   // filtros juntos, sem conflito
assert.equal(fe({ liberado: "nao", rapido: "em_andamento" }), "2");
assert.equal(M.indicadores(ues).liberados, 4);
assert.equal(M.execRotulo("EMP_OSCAR"), "EMP · Oscar"); assert.equal(M.execRotulo(null), "Sem execução");
assert.equal(M.descreverEvento({ tipo: "liberacao", descricao: "Liberada para a execução dos serviços", status_novo: "Agendado" }).titulo, "Liberada para execução");
assert.equal(M.descreverEvento({ tipo: "liberacao", descricao: "Liberação para execução retirada", status_novo: "Agendado" }).titulo, "Liberação retirada");

console.log("Regras da Revistoria · Cliente verificadas.");
