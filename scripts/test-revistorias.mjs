// Testes das regras de revistoria da importação (rodam no `pnpm check`).
// A gravação (sem duplicar, sem apagar, só admin) é testada no banco em scripts/db-tests/revistorias.
import assert from "node:assert/strict";
import { statusDaPlanilha, comparar, resumo, codigoFiltro, rotulo, ultima, SEM_REVISTORIA } from "../src/modules/vistorias/revistorias.js";

// 1) Coluna K: valores da planilha real (com espaços e caixa variados) e desconhecidos.
assert.deepEqual(statusDaPlanilha("AGENDADA "), { status: "Agendada", original: "AGENDADA" });
assert.equal(statusDaPlanilha("APROVADA").status, "Aprovada");
assert.equal(statusDaPlanilha("REPROVADA").status, "Reprovada");
assert.equal(statusDaPlanilha("em revistoria").status, "Em revistoria");
assert.equal(statusDaPlanilha("em vistoria").status, "Em revistoria");
assert.equal(statusDaPlanilha("CHEGOU ").status, "Em revistoria");
assert.deepEqual(statusDaPlanilha(""), { status: "", original: "" });
assert.deepEqual(statusDaPlanilha(null), { status: "", original: "" });
assert.equal(statusDaPlanilha("cancelada").invalid, "cancelada");

const sheet = (o) => ({ status: "", statusOriginal: "", statusInvalido: "", data: "", dataInvalida: "", hora: "", horaInvalida: "", ...o });
const ag = sheet({ status: "Agendada", statusOriginal: "AGENDADA", data: "2026-10-28", hora: "16:30" });

// 2) Linha sem revistoria: nada; só valores inválidos: item ignorado.
assert.equal(comparar(null, sheet({})), null);
assert.equal(comparar(null, sheet({ dataInvalida: "31/02/2026" })).kind, "invalid");

// 3) Primeira revistoria: nova (nº 1), também preenche a Data da revistoria da unidade.
{ const it = comparar(null, ag, "");
  assert.equal(it.kind, "fill"); assert.equal(it.rev.acao, "nova"); assert.equal(it.rev.numero, 0);
  assert.deepEqual(it.rev.novo, { status: "Agendada", status_planilha: "AGENDADA", data: "2026-10-28", horario: "16:30" });
  assert.match(it.nota, /Primeira revistoria/); assert.match(it.nota, /Também preenche/); assert.match(it.next, /^Nova · nº 1 · Agendada · 28\/10\/2026 · 16:30$/); }

// 4) Mesma planilha importada de novo: sem alteração (não duplica).
const r1 = { numero: 1, status: "Agendada", data: "2026-10-28", horario: "16:30:00" };
assert.equal(comparar(r1, ag, "2026-10-28").kind, "same");

// 5) Revistoria em andamento: status e reagendamento atualizam a mesma revistoria (nº 1).
{ const it = comparar(r1, sheet({ status: "Aprovada", statusOriginal: "APROVADA", data: "2026-10-28", hora: "16:30" }), "2026-10-28");
  assert.equal(it.kind, "update"); assert.equal(it.rev.acao, "atualizar"); assert.equal(it.rev.numero, 1);
  assert.deepEqual(it.rev.esperado, { status: "Agendada", data: "2026-10-28", horario: "16:30" }); assert.deepEqual(it.rev.campos, ["status"]); }
{ const it = comparar(r1, sheet({ status: "Agendada", data: "2026-11-03", hora: "10:30" }), "2026-10-28");
  assert.equal(it.kind, "update"); assert.deepEqual(it.rev.campos, ["data", "horario"]); assert.match(it.nota, /Também preenche/); }
// data da unidade alterada no site: mantida (só avisa)
{ const it = comparar(r1, sheet({ data: "2026-11-03" }), "2026-10-30"); assert.match(it.nota, /será mantida/); }
// planilha com status vazio não apaga o status do sistema
{ const it = comparar(r1, sheet({ data: "2026-11-03" }), "2026-10-28"); assert.equal(it.rev.novo.status, ""); assert.match(it.next, /Agendada · 03\/11\/2026 · 16:30/); }
// só preenche o que estava vazio: fill
{ const it = comparar({ numero: 1, status: "Agendada", data: "2026-10-28", horario: null }, sheet({ hora: "09:00" }), ""); assert.equal(it.kind, "fill"); }

// 6) Reprovada + nova data: revistoria nº 2 (a nº 1 fica no histórico); mesma data: atualiza a nº 1 com decisão.
const rep = { numero: 1, status: "Reprovada", data: "2026-10-20", horario: "09:00" };
{ const it = comparar(rep, ag, "2026-10-20"); assert.equal(it.rev.acao, "nova"); assert.equal(it.rev.numero, 1); assert.match(it.next, /nº 2/); assert.match(it.nota, /nº 1 fica no histórico/); assert.match(it.nota, /Também preenche/); }
{ const it = comparar(rep, sheet({ status: "Aprovada", data: "2026-10-20" }), "2026-10-20"); assert.equal(it.kind, "conflict"); assert.equal(it.rev.acao, "atualizar"); }

// 7) Revistoria aprovada alterada pela planilha: conflito (não muda sem decisão).
assert.equal(comparar({ numero: 1, status: "Aprovada", data: "2026-10-22", horario: "09:00" }, ag, "").kind, "conflict");

// 8) Valores inválidos no meio: importa o que é válido e avisa.
{ const it = comparar(null, sheet({ statusInvalido: "cancelada", data: "2026-10-28" }));
  assert.equal(it.kind, "fill"); assert.equal(it.rev.novo.status, ""); assert.equal(it.rev.novo.status_planilha, "cancelada"); assert.equal(it.avisos.length, 1); }

// 9) Indicadores e filtro pela revistoria mais recente.
const lista = [{ numero: 1, status: "Reprovada" }, { numero: 2, status: "Agendada" }];
assert.equal(ultima(lista).numero, 2);
assert.deepEqual(resumo([lista, [{ numero: 1, status: "Aprovada" }], [], [{ numero: 1, status: null }]]),
  { total: 3, semStatus: 1, Agendada: 1, "Em revistoria": 0, Aprovada: 1, Reprovada: 0 });
assert.equal(codigoFiltro(lista), "Agendada"); assert.equal(codigoFiltro([]), SEM_REVISTORIA); assert.equal(codigoFiltro([{ numero: 1, status: null }]), "");
assert.equal(rotulo({ numero: 2, status: "Aprovada", data: "2026-10-22", horario: "09:00:00" }), "nº 2 · Aprovada · 22/10/2026 · 09:00");

console.log("Regras de revistoria: ok");
