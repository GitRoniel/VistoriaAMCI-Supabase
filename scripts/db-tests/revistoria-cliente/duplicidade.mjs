// Correção de dados das revistorias aprovadas em duplicidade (migration 20261115120000).
// Reproduz o caso real (status da vistoria Revistoria Finalizada → Revistoria → Revistoria Finalizada) e confere que
// a correção anula só os registros repetidos, sem apagar, sem mudar o status das unidades e sem tocar em quem
// não se encaixa na regra (reprovada no meio, datas diferentes, unidade em andamento).
// Uso: scripts/db-tests/chaves/reset.sh 20261114120000 && node scripts/db-tests/revistoria-cliente/duplicidade.mjs
import pg from 'pg';
import fs from 'node:fs';
const cfg = { host: process.env.PGHOST || '/var/tmp', port: Number(process.env.PGPORT || 55432), user: 'postgres', database: 'amci' };
const db = new pg.Client(cfg); await db.connect();
let fail = 0; const ok = (c, m) => { console.log((c ? '✔' : '✘') + ' ' + m); if (!c) fail++; };
const q = (sql, p) => db.query(sql, p);
const { rows: [{ id: ADM }] } = await q(`insert into auth.users (email) values ('adm@dup.teste') returning id`);
await q(`insert into profiles (id,email,full_name) values ($1,'adm@dup.teste','Adm') on conflict (id) do update set email=excluded.email`, [ADM]);
const PJ = Number((await q(`select id from projects where slug='alto-do-jeriva'`)).rows[0].id);
await q(`insert into project_members (project_id,user_id,role) values ($1,$2,'admin')`, [PJ, ADM]);
await q(`insert into client_inspections (unit_id) select id from units on conflict (unit_id) do nothing`);
const unit = async (b, p, a) => Number((await q(`select id from units where project_id=$1 and bloco=$2 and pav=$3 and apto=$4`, [PJ, b, p, a])).rows[0].id);
async function as(sql, params) {
  const c = new pg.Client(cfg); await c.connect();
  try {
    await c.query('begin'); await c.query(`set local role authenticated`); await c.query(`select set_config('request.jwt.claim.sub', $1, true)`, [ADM]);
    const r = await c.query(sql, params); await c.query('commit'); return r.rows;
  } finally { await c.end(); }
}
const vist = (u, st, data = '2026-10-20') => as(`update client_inspections set status=$2, reinspection_date=$3, reinspection_responsible='Levi' where unit_id=$1`, [u, st, data]);
const ags = async (u) => (await q(`select id, numero, status, ciclo, left(horario::text,5) horario, realizada_em::text real, anulado_em is not null anulado, anulado_motivo from revistorias where unit_id=$1 order by numero`, [u])).rows;
const ver = async (u) => (await q(`select versao from revistorias_cliente where unit_id=$1`, [u])).rows[0].versao;
const rc = async (u) => (await q(`select status, ciclo, revistoria_id, versao from revistorias_cliente where unit_id=$1`, [u])).rows[0];

// A) caso real: aprovada com horário pela aba Revistoria e depois repetida pela aba Vistoria (2x) → 3 registros
const A = await unit('A', '6º', '01');
await vist(A, 'Revistoria');
await as(`select public.revistoria_agendar($1,'2026-10-20','09:00','Levi','',$2,null)`, [A, await ver(A)]);
await as(`select public.revistoria_resultado($1,'Aprovada','2026-10-20','Levi','',$2,null)`, [A, await ver(A)]);
const rA = true;
await vist(A, 'Revistoria'); await vist(A, 'Revistoria Finalizada');
await vist(A, 'Revistoria'); await vist(A, 'Revistoria Finalizada');
// B) toggle simples (sem horário em nenhum)
const B = await unit('B', '2º', '05');
await vist(B, 'Revistoria'); await vist(B, 'Revistoria Finalizada'); await vist(B, 'Revistoria'); await vist(B, 'Revistoria Finalizada');
// C) reprovada e depois aprovada (ciclo legítimo) → nada muda
const C = await unit('C', '3º', '03');
await vist(C, 'Revistoria');
await as(`select public.revistoria_agendar($1,'2026-10-10','10:00','Levi','',$2,null)`, [C, await ver(C)]);
await as(`select public.revistoria_resultado($1,'Reprovada','2026-10-10','Levi','rejunte',$2,null)`, [C, await ver(C)]);
await as(`select public.revistoria_agendar($1,'2026-10-20','10:00','Levi','',$2,null)`, [C, await ver(C)]);
await as(`select public.revistoria_resultado($1,'Aprovada','2026-10-20','Levi','',$2,null)`, [C, await ver(C)]);
// D) duas aprovações em datas diferentes → não é duplicidade pela regra (fica para o administrador)
const D = await unit('D', '1º', '02');
await vist(D, 'Revistoria'); await vist(D, 'Revistoria Finalizada', '2026-10-15'); await vist(D, 'Revistoria'); await vist(D, 'Revistoria Finalizada', '2026-10-22');
// E) em andamento → nada muda
const E = await unit('E', '4º', '04');
await vist(E, 'Revistoria');

const antes = {};
for (const [k, u] of Object.entries({ A, B, C, D, E })) antes[k] = { ags: await ags(u), rc: await rc(u) };
ok(antes.A.ags.filter((r) => r.status === 'Aprovada').length >= 2 && antes.A.rc.ciclo >= 2, `cenário A: ${antes.A.ags.length} registros aprovados, ciclo ${antes.A.rc.ciclo}`);
ok(antes.B.ags.length === 2 && antes.B.rc.ciclo === 2, 'cenário B: 2 aprovados, ciclo 2');
const totalAntes = Number((await q(`select count(*) from revistorias`)).rows[0].count);
const ciAntes = (await q(`select unit_id, status from client_inspections order by unit_id`)).rows;

const MIG = process.env.MIG || new URL('../../../supabase/migrations/20261115120000_revistoria_duplicidades_correcao.sql', import.meta.url);
await q(fs.readFileSync(MIG, 'utf8'));

const depois = {};
for (const [k, u] of Object.entries({ A, B, C, D, E })) depois[k] = { ags: await ags(u), rc: await rc(u) };
ok(Number((await q(`select count(*) from revistorias`)).rows[0].count) === totalAntes, 'nenhum agendamento apagado');
ok(JSON.stringify((await q(`select unit_id, status from client_inspections order by unit_id`)).rows) === JSON.stringify(ciAntes), 'status da vistoria de nenhuma unidade mudou');
for (const k of ['A', 'B']) {
  const d = depois[k], vivos = d.ags.filter((r) => !r.anulado), an = d.ags.filter((r) => r.anulado);
  ok(vivos.length === 1 && vivos[0].status === 'Aprovada' && Number(vivos[0].id) === Number(d.rc.revistoria_id), `${k}: fica 1 revistoria aprovada válida (a atual)`);
  ok(an.length === d.ags.length - 1 && an.every((r) => r.status === 'Cancelada' && /duplicidade/.test(r.anulado_motivo)), `${k}: ${an.length} registro(s) anulado(s) com motivo`);
  ok(d.rc.status === 'Aprovado' && d.rc.ciclo === 1 && vivos[0].ciclo === 1 && d.rc.versao > antes[k].rc.versao, `${k}: continua Aprovado, ciclo volta para 1`);
  const ev = (await q(`select descricao, registrado_email from revistorias_eventos where unit_id=$1 and tipo='correcao'`, [k === 'A' ? A : B])).rows;
  ok(ev.length === 1 && /duplicidade/.test(ev[0].descricao) && ev[0].registrado_email === 'correção de dados', `${k}: evento no histórico — ${ev[0]?.descricao}`);
}
if (rA) ok(depois.A.ags.find((r) => !r.anulado).horario === '09:00', 'A: horário do registro anulado mantido no atual');
for (const k of ['C', 'D', 'E']) ok(JSON.stringify(depois[k]) === JSON.stringify(antes[k]), `${k}: não se encaixa na regra, nada mudou`);
ok(depois.C.rc.ciclo === 2, 'C: ciclo 2 legítimo (houve reprovação) mantido');
// idempotente
await q(fs.readFileSync(MIG, 'utf8'));
ok(Number((await q(`select count(*) from revistorias_eventos where tipo='correcao'`)).rows[0].count) === 2, 'rodar de novo não muda nada');
await db.end();
console.log(fail ? `${fail} falha(s)` : 'tudo ok'); process.exit(fail ? 1 : 0);
