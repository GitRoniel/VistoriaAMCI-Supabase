// Testes das regras da Central Operacional (rodam no `pnpm check`). As contagens do banco (agenda,
// produtividade, unidade, pesquisa, RLS) são testadas em scripts/db-tests/central.
import assert from "node:assert/strict";
import * as M from "../src/modules/central/model.js";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const H = "2026-11-12";
// Datas
assert.equal(M.somaDias("2026-12-30", 3), "2027-01-02");
assert.equal(M.diasEntre("2026-11-10", "2026-11-12"), 2);
assert.deepEqual(M.rotuloDia(H, H), { rel: "Hoje", data: "12/11/2026", passado: false, hoje: true });
assert.equal(M.rotuloDia("2026-11-13", H).rel, "Amanhã");
assert.equal(M.rotuloDia("2026-11-11", H).rel, "Ontem");
assert.equal(M.rotuloDia("2026-11-16", H).rel, "Segunda");

// Situação operacional sem mudar o status original
const v = (status, data = H) => ({ tipo: "vistoria", status, data });
const r = (status, data = H) => ({ tipo: "revistoria", status, data });
assert.equal(M.situacao(v("Agendado", "2026-11-13"), H), "agendada");
assert.equal(M.situacao(v("Remarcado", "2026-11-10"), H), "atrasada");
assert.equal(M.situacao(v("Agendado", H), H), "agendada");                 // hoje ainda não está atrasada
assert.equal(M.situacao(v("Aprovado"), H), "aprovada");
assert.equal(M.situacao(v("Revistoria"), H), "pendente");
assert.equal(M.situacao(v("Revistoria Finalizada"), H), "aprovada");
assert.equal(M.situacao(v("Inadimplência"), H), "outro");
assert.equal(M.situacao(r("Agendada", "2026-11-01"), H), "atrasada");
assert.equal(M.situacao(r("Em revistoria"), H), "andamento");
assert.equal(M.situacao(r("Reprovada"), H), "pendente");
assert.equal(M.situacao(r("Cancelada"), H), "cancelada");

// Indicadores: cada atividade uma vez, canceladas fora, unidades únicas à parte
const ag = [
  { tipo: "vistoria", ref_id: 1, unit_id: 10, project_id: 1, bloco: "A", codigo: "103", status: "Aprovado", data: "2026-11-10", responsavel: "Eduarda", cliente: "Maria", projeto: "Jerivá" },
  { tipo: "vistoria", ref_id: 2, unit_id: 11, project_id: 1, bloco: "A", codigo: "104", status: "Agendado", data: "2026-11-11", responsavel: "eduarda ", projeto: "Jerivá" },
  { tipo: "revistoria", ref_id: 3, unit_id: 10, project_id: 1, bloco: "A", codigo: "103", status: "Reprovada", data: "2026-11-11", responsavel: "Rejane", projeto: "Jerivá" },
  { tipo: "revistoria", ref_id: 4, unit_id: 10, project_id: 1, bloco: "A", codigo: "103", status: "Cancelada", data: "2026-11-12", responsavel: "Rejane", projeto: "Jerivá" },
  { tipo: "revistoria", ref_id: 5, unit_id: 12, project_id: 2, bloco: "B", codigo: "35", unidade_tipo: "casa", status: "Agendada", data: "2026-11-14", responsavel: "", projeto: "Buriti" }
];
const k = M.indicadores(ag, H);
assert.deepEqual([k.total, k.vistoria, k.revistoria, k.concluidas, k.aprovada, k.pendente, k.atrasada, k.agendada, k.unidades], [4, 2, 2, 2, 1, 1, 1, 1, 3]);
// Filtros combináveis
const F = (o) => ({ ...M.FILTRO0(), ...o });
const vis = (f) => ag.filter((a) => M.passaFiltros(a, F(f), H)).map((a) => a.ref_id);
assert.deepEqual(vis({}), [1, 2, 3, 5]);                                   // canceladas escondidas por padrão
assert.deepEqual(vis({ canceladas: true }), [1, 2, 3, 4, 5]);
assert.deepEqual(vis({ status: "cancelada" }), [4]);
assert.deepEqual(vis({ tipo: "revistoria" }), [3, 5]);
assert.deepEqual(vis({ status: "concluidas" }), [1, 3]);
assert.deepEqual(vis({ status: "atrasada" }), [2]);
assert.deepEqual(vis({ resp: "Eduarda" }), [1, 2]);                        // maiúsculas/espaços não importam
assert.deepEqual(vis({ resp: "(sem responsável)" }), [5]);
assert.deepEqual(vis({ projetos: ["2"] }), [5]);
assert.deepEqual(vis({ bloco: "1|A", tipo: "vistoria" }), [1, 2]);
assert.deepEqual(vis({ busca: "a 103" }), [1, 3]);
assert.deepEqual(vis({ busca: "bloco a apto 104" }), [2]);
assert.deepEqual(vis({ busca: "maria" }), [1]);
assert.deepEqual(vis({ busca: "B35" }), [5]);
// Indicador clicado aplica o filtro e clicar de novo limpa
let f = M.filtroDoKpi("atrasada", F({}));
assert.equal(f.status, "atrasada"); assert.equal(M.filtroDoKpi("atrasada", f).status, "");
assert.equal(M.filtroDoKpi("revistoria", F({})).tipo, "revistoria");
assert.deepEqual([M.filtroDoKpi("total", F({ tipo: "vistoria", status: "aprovada" })).tipo, M.filtroDoKpi("total", F({ status: "aprovada" })).status], ["", ""]);
// Agrupamento por dia (hoje sempre aparece, mesmo sem atividade)
const dias = M.porDia(ag.filter((a) => a.data !== H), H, "2026-11-05", "2026-11-30");
assert.deepEqual(dias.map((d) => [d.data, d.itens.length]), [["2026-11-10", 1], ["2026-11-11", 2], [H, 0], ["2026-11-14", 1]]);
assert.deepEqual(M.responsaveis(ag), ["(sem responsável)", "Eduarda", "Rejane"]);
assert.deepEqual(M.janelaInicial(H), { de: "2026-11-05", ate: "2026-12-03" });
assert.deepEqual(M.proximaJanela("2026-12-03"), { de: "2026-12-04", ate: "2026-12-24" });
assert.deepEqual(M.janelaAnterior("2026-11-05"), { de: "2026-10-15", ate: "2026-11-04" });

// Produtividade
assert.deepEqual(M.periodo("30d", H), { de: "2026-10-14", ate: H });
assert.deepEqual(M.periodo("mes", H), { de: "2026-11-01", ate: H });
assert.equal(M.graoSugerido("2026-11-01", "2026-11-30"), "dia");
assert.equal(M.graoSugerido("2026-08-01", "2026-11-30"), "semana");
assert.equal(M.graoSugerido("2026-01-01", "2026-11-30"), "mes");
assert.equal(M.pct(1, 3), 33.3); assert.equal(M.pct(0, 0), null); assert.equal(M.fmtPct(null), "—"); assert.equal(M.fmtPct(66.7), "66,7%");
assert.deepEqual(M.variacao(12, 10), { txt: "+20%", dir: "up" });
assert.deepEqual(M.variacao(5, 0), { txt: "novo", dir: "up" });
assert.equal(M.variacao(0, 0), null);
assert.deepEqual(M.escala(37), { max: 40, passo: 10 });
assert.deepEqual(M.escala(3), { max: 3, passo: 1 }); assert.deepEqual(M.escala(1), { max: 1, passo: 1 });
assert.equal(M.rotuloBalde("2026-11-01", "mes"), "nov/26");

// Central de Unidades: situação geral, pendências (sem repetidos, reincidência, histórico) e linha do tempo
assert.equal(M.situacaoGeral({ status: "Revistoria" }, { status: "Agendado" }).label, "Em revistoria · agendada");
assert.equal(M.situacaoGeral({ status: "Revistoria Finalizada" }, { status: "Aprovado" }).label, "Aprovada após revistoria");
const d = {
  relatorios: [{ id: 1, enviado_em: "2026-10-20T10:00:00Z", identificado_em: "2026-10-20", resumo: { responsavel: "Eduarda" } },
    { id: 2, enviado_em: "2026-11-02T10:00:00Z", identificado_em: "2026-11-01", resumo: {} },
    { id: 3, enviado_em: "2026-11-03T10:00:00Z", identificado_em: "2026-11-03", removido_em: "2026-11-04T10:00:00Z", resumo: {} }],
  apontamentos: [
    { id: 11, relatorio_id: 1, ordem: 1, texto: "Sala · piso", chave: "sala · piso", concluido: true, concluido_em: "2026-11-05T12:00:00Z", concluido_email: "obra@x" },
    { id: 12, relatorio_id: 1, ordem: 2, texto: "Cozinha · rejunte", chave: "cozinha · rejunte", concluido: false },
    { id: 21, relatorio_id: 2, ordem: 1, texto: "COZINHA · Rejunte", chave: "cozinha · rejunte", concluido: true, concluido_em: "2026-11-06T12:00:00Z", concluido_email: "obra@x" },
    { id: 31, relatorio_id: 3, ordem: 1, texto: "Banho · ralo", chave: "banho · ralo", concluido: false }],
  checklist: [11, 21],
  historico_vistoria: [{ registrado_em: "2026-10-01T10:00:00Z", status_anterior: "Não agendado", status_novo: "Agendado", data_anterior: null, data_nova: "2026-10-20", horario_anterior: null, horario_novo: "09:00", registrado_email: "adm@x" },
    { registrado_em: "2026-10-20T15:00:00Z", status_anterior: "Agendado", status_novo: "Revistoria", data_anterior: "2026-10-20", data_nova: "2026-10-20", horario_anterior: "09:00", horario_novo: "09:00" }],
  eventos: [{ registrado_em: "2026-10-20T15:00:01Z", tipo: "entrada", descricao: "Entrou", ciclo: 1 }, { registrado_em: "2026-11-02T10:00:00Z", tipo: "relatorio", descricao: "x" },
    { registrado_em: "2026-11-08T10:00:00Z", tipo: "resultado", descricao: "Reprovada: x", ciclo: 1 }],
  reagendamentos: [], agendamentos: [{ numero: 1, status: "Reprovada", data: "2026-11-08" }, { numero: 2, status: "Agendada", data: "2026-11-20" }, { numero: 3, status: "Cancelada", data: "2026-11-19" }],
  vistoria: { status: "Revistoria", inspection_date: "2026-10-20", inspection_time: "09:00", responsible: "Eduarda" }
};
const pd = M.pendencias(d);
assert.deepEqual([pd.total, pd.abertas.length, pd.resolvidas.length, pd.historico.length, pd.reincidentes, pd.pct], [2, 0, 2, 2, 1, 100]);
assert.deepEqual(pd.historico.map((a) => [a.id, a.motivo]), [[12, "repetido em relatório mais recente"], [31, "relatório retirado"]]);
assert.equal(pd.resolvidas.find((a) => a.id === 21).reincidencia, 2);
assert.equal(pd.resolvidas.find((a) => a.id === 11).identificado_por, "Eduarda");
const tl = M.linhaDoTempo(d);
assert.deepEqual(tl.map((e) => e.titulo), ["Vistoria agendada", "Relatório anexado · pendências identificadas", "Vistoria realizada · encaminhada para revistoria", "Entrou na Revistoria",
  "Relatório anexado · pendências identificadas", "Relatório anexado · pendências identificadas", "Relatório retirado", "Pendências resolvidas", "Pendências resolvidas", "Revistoria realizada · reprovada"]);
assert.ok(tl.every((e, i) => i === 0 || e.quando >= tl[i - 1].quando), "linha do tempo em ordem cronológica");
const g = M.agendamentosUnidade(d, H);
assert.deepEqual([g.futuros.length, g.realizados.length, g.cancelados.length], [1, 2, 1]);
assert.equal(M.ultimaAtividade(d, tl).titulo, "Revistoria realizada · reprovada");

// Agenda: Hoje em diante (padrão), Histórico (mais recente primeiro) e Período
assert.deepEqual(M.janelaFutura(H), { de: H, ate: M.somaDias(H, M.JANELA) }, "hoje em diante começa hoje");
assert.deepEqual(M.janelaHistorico(H), { de: "2026-10-13", ate: "2026-11-11" }, "histórico termina ontem");
assert.equal(M.validarPeriodoAgenda("2026-11-01", "2026-11-30"), "");
assert.match(M.validarPeriodoAgenda("2026-11-30", "2026-11-01"), /inválido/);
assert.match(M.validarPeriodoAgenda("2025-01-01", "2026-11-30"), /até 366 dias/);
assert.deepEqual(M.periodoAgenda("", "", H), { de: "2026-10-13", ate: H }, "período inválido usa os últimos 30 dias");
const hist = [v("Aprovado", "2026-11-01"), r("Aprovada", "2026-11-10"), v("Agendado", "2026-11-05")];
assert.deepEqual(M.porDia(hist, H, "2026-10-13", "2026-11-11", true).map((d) => d.data), ["2026-11-10", "2026-11-05", "2026-11-01"], "histórico do mais recente para o mais antigo");
assert.deepEqual(M.porDia(hist, H, "2026-10-13", "2026-11-11").map((d) => d.data), ["2026-11-01", "2026-11-05", "2026-11-10"]);
assert.equal(M.indicadores([v("Agendado", H), r("Agendada", H), v("Agendado", "2026-11-13")], H).hoje, 2, "indicador Hoje");
assert.deepEqual(M.kpisAgenda("futuro").map((k) => k.key), ["total", "hoje", "vistoria", "revistoria"]);
assert.ok(M.kpisAgenda("historico").some((k) => k.key === "atrasada") && !M.kpisAgenda("futuro").some((k) => k.key === "atrasada"));
assert.deepEqual(M.MODOS_AGENDA.map((m) => m.key), ["futuro", "historico", "periodo"]);

// Estático: só leitura no banco e integração na tela
const root = resolve(import.meta.dirname, "..");
const mig = await readFile(resolve(root, "supabase/migrations/20261112120000_central_operacional.sql"), "utf8");
assert.doesNotMatch(mig, /\b(insert into|update public\.|delete from|drop table|alter table|create table|create policy|drop policy)\b/i, "Central: migration só de leitura (sem tabela, política ou escrita).");
assert.equal((mig.match(/^language .*security definer/gim) || []).length, 1, "Central: só o histórico da vistoria é SECURITY DEFINER.");
assert.match(mig, /private\.project_role\(private\.unit_project_id\(p_unit_id\)\) is not null/, "Histórico da vistoria só para membros do condomínio.");
const html = await readFile(resolve(root, "www/index.html"), "utf8");
assert.ok(html.includes('id="centralRoot"') && html.includes('id="centralOv"') && html.includes('src="./central.js"'), "Central montada no Resumo Geral e na tela inicial.");
assert.ok(html.includes("centralHost(false),true)"), "Resumo Geral abre no Panorama ao entrar na aba.");
assert.ok(html.includes("Panorama de Vistorias") && html.includes("Panorama de Revistorias"), "Panorama separado em Vistorias e Revistorias.");
const ctIdx = await readFile(resolve(root, "src/modules/central/index.js"), "utf8");
assert.ok(ctIdx.indexOf('key: "panorama"') < ctIdx.indexOf('key: "agenda"') && ctIdx.indexOf('key: "agenda"') < ctIdx.indexOf('key: "produtividade"'), "Ordem: Panorama, Agenda, Produtividade.");
// Mapas com a numeração da lista (pavimento + apto), só na apresentação
assert.ok(html.includes("${unitCode(b,p,a)}</button>") && !html.includes('${LAYOUT.kind==="casa"?+a:a}</button>'), "Mapa da Vistoria com a numeração completa.");
for (const m of ["revistoria-cliente", "chaves"]) {
  const src = await readFile(resolve(root, `src/modules/${m}/index.js`), "utf8");
  assert.ok(src.includes("${esc(host.codigo(b, p, a))}") && !src.includes("${esc(host.casa() ? +a : a)}"), `Mapa (${m}) com a numeração completa.`);
}
console.log("Regras da Central Operacional verificadas.");
