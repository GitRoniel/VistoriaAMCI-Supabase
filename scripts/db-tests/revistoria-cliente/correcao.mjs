// Correção de agendamentos pelo administrador (migration 20261113120000): corrigir dados e anular registro em
// duplicidade, sem apagar nada; histórico imutável; só administradores; regras de segurança (atual/mais recente).
// Reproduz o caso real: vistoria Revistoria Finalizada → Revistoria → Revistoria Finalizada (para corrigir o
// horário) criou um 2º ciclo e um 2º agendamento igual.
// Uso: scripts/db-tests/chaves/reset.sh && node scripts/db-tests/revistoria-cliente/correcao.mjs
import pg from 'pg';
const cfg = { host: process.env.PGHOST || '/var/tmp', port: Number(process.env.PGPORT || 55432), user: 'postgres', database: 'amci' };
const db = new pg.Client(cfg); await db.connect();
let fail = 0; const ok = (c, m) => { console.log((c ? '✔' : '✘') + ' ' + m); if (!c) fail++; };
const q = (sql, p) => db.query(sql, p);
const U = {};
for (const nome of ['adm', 'rev', 'vis', 'adm_b']) {
  const { rows } = await q(`insert into auth.users (email) values ($1) returning id`, [nome + '@correcao.teste']); U[nome] = rows[0].id;
  await q(`insert into profiles (id,email,full_name) values ($1,$2,$3) on conflict (id) do update set email=excluded.email`, [U[nome], nome + '@correcao.teste', nome]);
}
const PJ = Number((await q(`select id from projects where slug='alto-do-jeriva'`)).rows[0].id), PB = Number((await q(`select id from projects where slug='alto-do-buriti'`)).rows[0].id);
await q(`insert into project_members (project_id,user_id,role) values ($1,$2,'admin'),($1,$3,'revistorias'),($1,$4,'visitante'),($5,$6,'admin')`, [PJ, U.adm, U.rev, U.vis, PB, U.adm_b]);
await q(`insert into client_inspections (unit_id) select id from units on conflict (unit_id) do nothing`);
const unit = async (b, p, a) => Number((await q(`select id from units where project_id=$1 and bloco=$2 and pav=$3 and apto=$4`, [PJ, b, p, a])).rows[0].id);
async function as(user, sql, params) {
  const c = new pg.Client(cfg); await c.connect();
  try {
    await c.query('begin'); await c.query(`set local role authenticated`); await c.query(`select set_config('request.jwt.claim.sub', $1, true)`, [user]);
    const r = await c.query(sql, params); await c.query('commit'); return { rows: r.rows };
  } catch (e) { await c.query('rollback').catch(() => {}); return { error: e.message, rows: [] }; } finally { await c.end(); }
}
const A601 = await unit('A', '6º', '01');
const vist = (st, extra = {}) => as(U.adm, `update client_inspections set status=$2, reinspection_date=$3, reinspection_responsible='Levi' where unit_id=$1`, [A601, st, extra.data || '2026-10-20']);
await vist('Revistoria'); await vist('Revistoria Finalizada');        // 1º ciclo aprovado (sem horário)
await vist('Revistoria'); await vist('Revistoria Finalizada');        // voltou só para corrigir → 2º ciclo, agendamento repetido
const ags = async () => (await q(`select id, numero, status, data::text, left(horario::text,5) horario, responsavel, realizada_em::text, anulado_em, anulado_motivo from revistorias where unit_id=$1 order by numero`, [A601])).rows;
let L = await ags();
ok(L.length === 2 && L.every((r) => r.status === 'Aprovada'), 'cenário: 2 agendamentos aprovados para a mesma revistoria');
const [N1, N2] = L.map((r) => Number(r.id));
const rc = async () => (await q(`select status, ciclo, revistoria_id, versao from revistorias_cliente where unit_id=$1`, [A601])).rows[0];
const rc0 = await rc();
const nEv = async () => Number((await q(`select count(*) from revistorias_eventos where unit_id=$1`, [A601])).rows[0].count);
const ev0 = await nEv();

// ── corrigir ──
const corr = (u, id, o = {}) => as(u, `select public.revistoria_agendamento_corrigir($1,$2,$3,$4,$5,$6,$7) r`,
  [id, o.data ?? '2026-10-20', o.horario ?? '09:00', o.resp ?? 'Levi', o.real ?? '2026-10-20', o.motivo ?? 'horário não informado', o.pedido ?? null]);
let r = await corr(U.rev, N2); ok(/administradores/.test(r.error || ''), 'perfil revistorias não corrige: ' + r.error);
r = await corr(U.vis, N2); ok(/administradores/.test(r.error || ''), 'visitante não corrige');
r = await corr(U.adm_b, N2); ok(/administradores/.test(r.error || ''), 'admin de outro condomínio não corrige');
r = await corr(U.adm, N2, { motivo: '' }); ok(/motivo/.test(r.error || ''), 'motivo obrigatório');
r = await corr(U.adm, N2, { horario: '25:00' }); ok(/Horário inválido/.test(r.error || ''), 'horário validado');
r = await corr(U.adm, N2, { real: '2099-01-01' }); ok(/futura/.test(r.error || ''), 'realização não pode ser futura');
r = await corr(U.adm, N2); ok(!r.error, 'admin corrige o horário do nº 2 (atual): ' + (r.error || 'ok'));
r = await corr(U.adm, N2); ok(/Nada foi alterado/.test(r.error || ''), 'sem mudança: avisa e não grava');
const ped = '11111111-1111-4111-8111-111111111111';
r = await corr(U.adm, N1, { horario: '09:00', pedido: ped }); ok(!r.error, 'admin corrige o horário do nº 1: ' + (r.error || 'ok'));
L = await ags(); ok(L[0].horario === '09:00' && L[0].status === 'Aprovada', 'nº 1 com horário, status mantido');
r = await corr(U.adm, N1, { horario: '10:00', pedido: ped }); ok(!r.error && r.rows[0].r.repetido === true, 'pedido repetido não grava de novo');
L = await ags(); ok(L[0].horario === '09:00', 'repetição ignorada');
const evC = (await q(`select tipo, descricao, status_novo from revistorias_eventos where unit_id=$1 and tipo='correcao' order by id`, [A601])).rows;
ok(evC.length === 2 && /nº 1 corrigido/.test(evC[1].descricao) && /horário sem horário → 09:00/.test(evC[1].descricao) && /Motivo: horário não informado/.test(evC[1].descricao), 'histórico com antes/depois e motivo: ' + evC[1]?.descricao);
const rc1 = await rc(); ok(rc1.status === rc0.status && rc1.ciclo === rc0.ciclo && Number(rc1.revistoria_id) === N2 && Number(rc1.versao) === Number(rc0.versao) + 2, 'situação não muda; versão sobe a cada correção');

// ── anular ──
const anul = (u, id, motivo = 'registro em duplicidade do nº 2') => as(u, `select public.revistoria_agendamento_anular($1,$2,null) r`, [id, motivo]);
r = await anul(U.rev, N1); ok(/administradores/.test(r.error || ''), 'perfil revistorias não anula');
r = await anul(U.adm, N2); ok(/atual da unidade/.test(r.error || ''), 'não anula o agendamento atual: ' + r.error);
r = await anul(U.adm, N1, ''); ok(/motivo/.test(r.error || ''), 'anular pede motivo');
r = await anul(U.adm, N1); ok(!r.error, 'admin anula o nº 1: ' + (r.error || 'ok'));
L = await ags(); ok(L.length === 2 && L[0].status === 'Cancelada' && L[0].anulado_em && L[0].anulado_motivo === 'registro em duplicidade do nº 2', 'nº 1 continua guardado, anulado, com motivo');
ok(L[1].status === 'Aprovada', 'nº 2 intacto');
const rc2 = await rc(); ok(rc2.status === 'Aprovado' && Number(rc2.revistoria_id) === N2, 'unidade continua Aprovado (o gatilho de status não reagiu)');
r = await anul(U.adm, N1); ok(/já foi anulado/.test(r.error || ''), 'não anula duas vezes');
r = await corr(U.adm, N1, { horario: '08:00' }); ok(/já foi anulado/.test(r.error || ''), 'anulado não se corrige');
const evA = (await q(`select descricao from revistorias_eventos where unit_id=$1 and tipo='correcao' order by id desc limit 1`, [A601])).rows[0];
ok(/nº 1 anulado/.test(evA.descricao) && /era aprovada em 20\/10\/2026 · Levi/.test(evA.descricao), 'histórico guarda o status original: ' + evA.descricao);
ok(await nEv() === ev0 + 3, 'três eventos de correção (2 correções + 1 anulação), nenhum outro');
r = await as(U.adm, `delete from revistorias_eventos where unit_id=$1`, [A601]); ok(!!r.error, 'histórico continua imutável/sem escrita direta');
r = await as(U.adm, `update revistorias set anulado_em=null where id=$1`, [N1]); ok(!!r.error, 'sem escrita direta na tabela de agendamentos');
// mais recente que não é o atual (agendamento cancelado depois): ainda assim não se anula
const A602 = await unit('A', '6º', '02');
await as(U.adm, `update client_inspections set status='Revistoria' where unit_id=$1`, [A602]);
const ver = async (u) => Number((await q(`select versao from revistorias_cliente where unit_id=$1`, [u])).rows[0].versao);
await as(U.adm, `select public.revistoria_agendar($1,'2026-11-01','08:00','Rejane','',$2,null)`, [A602, await ver(A602)]);
await as(U.adm, `select public.revistoria_resultado($1,'Reprovada','2026-11-01','Rejane','pendências',$2,null)`, [A602, await ver(A602)]);
const R602 = Number((await q(`select id from revistorias where unit_id=$1 order by numero desc limit 1`, [A602])).rows[0].id);
r = await anul(U.adm, R602); ok(/atual da unidade|mais recente/.test(r.error || ''), 'reprovada mais recente não se anula: ' + r.error);
// agenda da Central não mostra o anulado
const ag = (await as(U.adm, `select tipo, ref_id from public.central_agenda('2026-10-01','2026-10-31',array[$1::bigint])`, [PJ])).rows;
ok(!ag.some((x) => Number(x.ref_id) === N1) && ag.some((x) => Number(x.ref_id) === N2), 'Central: anulado fora da agenda, o válido continua');
const pr = (await as(U.adm, `select public.central_produtividade('2026-10-01','2026-10-31',array[$1::bigint]) j`, [PJ])).rows[0].j;
ok(pr.no_periodo.rev_realizadas === 1, 'Central: produtividade conta 1 revistoria realizada (era 2): ' + pr.no_periodo.rev_realizadas);
await db.end();
console.log(fail ? `${fail} FALHA(S)` : 'Correção de agendamentos: tudo ok');
process.exit(fail ? 1 : 0);
