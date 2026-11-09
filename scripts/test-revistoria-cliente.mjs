// Testes das regras da Revistoria · Cliente (rodam no `pnpm check`). As regras de gravação (entrada
// automática, ciclos, permissões, versão da tela, pedido repetido, histórico imutável, sincronização com a
// vistoria) ficam no banco e são testadas em scripts/db-tests/revistoria-cliente.
import assert from "node:assert/strict";
import * as M from "../src/modules/revistoria-cliente/model.js";
import { comparar as compararPlanilha, revInfo } from "../src/modules/vistorias/revistorias.js";
import { extrair, mesmaUnidade } from "../src/modules/revistoria-cliente/relatorio.js";

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
assert.equal(M.validarAgendamento({ data: "2026-11-10", responsavel: " " }, hoje), "");   // vistoriador opcional
assert.match(M.validarAgendamento({ data: "2026-11-10", responsavel: "x".repeat(81) }, hoje), /longo/);
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

// 10) Rev. Reprovada: só quem teve revistoria realizada reprovada e ainda não foi aprovado (em andamento sem revistoria não conta).
const sit = (st, lista) => M.situacao({ status: st }, lista);
const rep1 = sit("Em andamento", [{ numero: 1, status: "Reprovada", realizada_em: "2026-10-01", resultado_obs: "Rejunte" }]);
const rep2 = sit("Agendado", [{ numero: 1, status: "Reprovada" }, { numero: 2, status: "Agendada", data: "2026-11-20" }]);
assert.equal(M.reprovada(rep1), true); assert.equal(M.reprovada(rep2), true);
assert.equal(M.reprovada(sit("Em andamento", [])), false);
assert.equal(M.reprovada(sit("Aprovado", [{ numero: 1, status: "Reprovada" }, { numero: 2, status: "Aprovada" }])), false);
assert.equal(M.reprovada(sit("Em andamento", [{ numero: 1, status: "Cancelada" }])), false);
assert.equal(M.ultimaReprovacao(rep1).resultado_obs, "Rejunte");
assert.ok(M.FILTROS_REVISTORIA.some((f) => f.key === "reprovada") && !M.FILTROS.some((f) => f.key === "reprovada"), "Rev. Reprovada só na aba Revistoria");

// 11) Data da revistoria, ordem por horário (igual à Vistoria) e status da chave, combinados com os demais filtros.
const uu = (id, st, lista, chave, extra = {}) => ({ b: "A", codigo: id, cliente: "", vistoria: "rv", chave, situacao: M.situacao({ status: st, ...extra }, lista) });
const lst = [
  uu("1", "Agendado", [{ numero: 1, status: "Agendada", data: "2026-11-20", horario: "14:00:00" }], { setor: "base" }, { liberado: true }),
  uu("2", "Agendado", [{ numero: 1, status: "Agendada", data: "2026-11-20", horario: "08:30:00" }], { setor: "cx" }),
  uu("3", "Agendado", [{ numero: 1, status: "Agendada", data: "2026-11-20" }], { setor: "sem" }),
  uu("4", "Agendado", [{ numero: 1, status: "Agendada", data: "2026-11-18", horario: "16:00:00" }], { setor: "base", perdida: { etapa: "perdida" } }),
  uu("5", "Em andamento", [{ numero: 1, status: "Reprovada", data: "2026-11-01", realizada_em: "2026-11-01" }], { setor: "cliente" }),
  uu("6", "Em andamento", [], { setor: "sem" })
];
const ordem = (hr) => [...lst].sort((x, y) => M.compararAgenda(x, y, hr)).map((u) => u.codigo).join(",");
assert.equal(ordem("asc"), "5,4,2,1,3,6");    // por data; no mesmo dia cedo → tarde; sem horário depois; sem data no fim
assert.equal(ordem("desc"), "5,4,1,2,3,6");
assert.deepEqual(M.agendaRevistoria(lst[4].situacao), { data: "2026-11-01", hora: "" });
const fl = (o) => lst.filter((x) => M.passaFiltros(x, { bloco: "ALL", busca: "", rapido: "todos", liberado: "", execucao: "", chave: "", data: "", ...o })).map((x) => x.codigo).join(",");
assert.equal(fl({ data: "2026-11-20" }), "1,2,3");
assert.equal(fl({ data: "2026-11-20", chave: "base" }), "1");
assert.equal(fl({ chave: "base" }), "1");                 // a chave perdida não conta como Base
assert.equal(fl({ chave: "perdida" }), "4");
assert.equal(fl({ chave: "sem" }), "3,6");
assert.equal(fl({ rapido: "reprovada" }), "5");
assert.equal(fl({ rapido: "reprovada", chave: "cliente" }), "5");
assert.equal(fl({ data: "2026-11-20", liberado: "sim", rapido: "agendados" }), "1");

// 12) Relatório da unidade (PDF do sistema da construtora): apontamentos = itens Reprovados, com ambiente,
//     observação (texto quebrado juntado pela coluna) e nº da não conformidade. Dados fictícios.
const tx = (str, x, y, w = 60) => ({ str, x, y, w });
const pags = [
  { itens: [tx("RELATÓRIO DE ENTREGA DA UNIDADE", 8, 812), tx("BL C - APT 204 (TESTE >> BLOCO C >> 2º PAVIMENTO)", 9, 793),
    tx("Realizado", 34, 367), tx("10/09/2026 09:16", 78, 367), tx("Não Conformidades 2", 276, 367),
    tx("COZINHA", 12, 305), tx("Vistoria do Cliente | CHECKLIST VISTORIA CLIENTE", 12, 293),
    tx("Nr", 14, 271), tx("Descrição", 161, 271), tx("Resposta", 392, 271), tx("Observação", 492, 271),
    tx("1", 12, 246), tx("10/09/2026", 77, 246), tx("REVESTIMENTO - PISO", 161, 246), tx("Reprovado", 392, 247), tx("Peça oca 3", 490, 247), tx("pontos", 490, 235),
    tx("2", 12, 220), tx("10/09/2026", 77, 220), tx("SISTEMA ELÉTRICO - TOMADAS", 161, 220), tx("Aprovado", 392, 221),
    tx("Gerado:", 8, 39)] },
  { itens: [tx("Não Conformidade 71", 25, 763), tx("Descrição", 27, 690),
    tx("Não Conformidade criada automaticamente a partir do item REVESTIMENTO - PISO, do Formulário CHECKLIST VISTORIA CLIENTE.", 27, 679), tx("Peça oca", 27, 668),
    tx("Resumo das Ações", 27, 652),
    tx("QUARTO", 12, 471), tx("Vistoria do Cliente | CHECKLIST VISTORIA CLIENTE", 12, 459),
    tx("1", 12, 412), tx("10/09/2026", 77, 412), tx("ESQUADRIAS - PORTAS", 161, 412), tx("Reprovado", 392, 413),
    tx("Não Conformidade 72", 25, 380), tx("Descrição", 27, 360),
    tx("Não Conformidade criada automaticamente a partir do item ESQUADRIAS - PORTAS, do Formulário CHECKLIST VISTORIA CLIENTE localizado na", 27, 349),
    tx("QUARTO regulagem da porta", 27, 338), tx("Resumo das Ações", 27, 320),
    tx("Fulano de Tal", 101, 295, 120), tx("Responsável", 139, 284, 45), tx("Cliente", 418, 284, 30)] }
];
const rel = extrair(pags);
assert.deepEqual(rel.unidade, { bloco: "C", apto: "204", texto: "BL C - APT 204" });
assert.equal(rel.realizado, "2026-09-10"); assert.equal(rel.naoConformidades, 2); assert.equal(rel.responsavel, "Fulano de Tal");
assert.deepEqual(rel.apontamentos.map((a) => a.texto), ["COZINHA · REVESTIMENTO - PISO: Peça oca 3 pontos (NC 71)", "QUARTO · ESQUADRIAS - PORTAS: regulagem da porta (NC 72)"]);
assert.equal(mesmaUnidade(rel.unidade, "C", "204"), true); assert.equal(mesmaUnidade(rel.unidade, "C", "205"), false); assert.equal(mesmaUnidade(null, "C", "204"), null);

// Execução: botões de filtro rápido (um por vez; clicar de novo limpa) — não atribuem nada.
assert.deepEqual(M.BOTOES_EXECUCAO.map((b) => b.label), ["M.O.P – Felipe", "M.O.P – Renato", "EMP – Oscar", "EMP – Nilson"]);
assert.equal(M.alternarExecucao("", "EMP_OSCAR"), "EMP_OSCAR");
assert.equal(M.alternarExecucao("EMP_OSCAR", "EMP_OSCAR"), "");
assert.equal(M.alternarExecucao("EMP_OSCAR", "MOP_FELIPE"), "MOP_FELIPE");
assert.equal(M.passaExecucao("EMP_OSCAR", "EMP_OSCAR"), true); assert.equal(M.passaExecucao("EMP_OSCAR", "EMP_NILSON"), false); assert.equal(M.passaExecucao("", null), true);

// Apontamentos: fonte única (relatório individual e Lista), sem repetidos, sem 100% quando vazio.
{
  const rels = [{ id: 1, unit_id: 9, enviado_em: "2026-11-01T10:00:00Z" }, { id: 2, unit_id: 9, enviado_em: "2026-11-08T10:00:00Z" },
    { id: 3, unit_id: 9, enviado_em: "2026-11-09T10:00:00Z", removido_em: "2026-11-09T11:00:00Z" }];
  const aps = [
    { id: 10, unit_id: 9, relatorio_id: 1, ordem: 1, texto: "Sala · piso oco", concluido: true },
    { id: 11, unit_id: 9, relatorio_id: 1, ordem: 2, texto: "Cozinha · rejunte", concluido: false },
    { id: 20, unit_id: 9, relatorio_id: 2, ordem: 1, texto: "  COZINHA ·  Rejunte ", concluido: true },  // repetido: vale o mais recente
    { id: 21, unit_id: 9, relatorio_id: 2, ordem: 2, texto: "Quarto · porta", concluido: false },
    { id: 30, unit_id: 9, relatorio_id: 3, ordem: 1, texto: "Banheiro · ralo", concluido: false }       // relatório removido: fora
  ];
  const ck = M.checklistUnidade(aps, rels);
  assert.deepEqual(ck.map((a) => a.id), [10, 20, 21]);
  assert.deepEqual(M.resumoApontamentos(ck), { total: 3, resolvidas: 2, pct: 67 });
  assert.deepEqual(M.resumoApontamentos([]), { total: 0, resolvidas: 0, pct: null });
  const pu = M.resumoPorUnidade([...aps, { id: 40, unit_id: 5, relatorio_id: 4, ordem: 1, texto: "x", concluido: true }],
    [...rels, { id: 4, unit_id: 5, enviado_em: "2026-11-02T10:00:00Z" }, { id: 6, unit_id: 7, enviado_em: "2026-11-02T10:00:00Z" }]);
  assert.deepEqual(pu.get(9), { relatorios: 2, total: 3, resolvidas: 2, pct: 67 });
  assert.deepEqual(pu.get(5), { relatorios: 1, total: 1, resolvidas: 1, pct: 100 });
  assert.deepEqual(pu.get(7), { relatorios: 1, total: 0, resolvidas: 0, pct: null });   // relatório sem apontamentos: "—"
  assert.equal(pu.has(8), false);                                                          // sem relatório: "—"
  // Novo PDF: os itens já existentes não duplicam e mantêm a resolução; repetidos no próprio PDF entram uma vez.
  const conf = M.conferirExtraidos(["sala · PISO oco", "Varanda · guarda-corpo", "Varanda · guarda-corpo", ""], ck);
  assert.deepEqual(conf.map((c) => [c.usar, !!c.existente, c.repetido]), [[false, true, false], [true, false, false], [false, false, true], [false, false, false]]);
  assert.equal(conf[0].existente.concluido, true);
}

console.log("Regras da Revistoria · Cliente verificadas.");
