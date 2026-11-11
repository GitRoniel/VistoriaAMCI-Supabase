// Chave com o cliente mantém a unidade Aprovada por entrega (migration 20261119120000): resultado técnico registrado
// depois (tela ou planilha) não tira a aprovação; correção das unidades reabertas (caso A-203 / A-408).
// Uso: scripts/db-tests/chaves/reset.sh 20261118120000 && node scripts/db-tests/revistoria-cliente/chave-cliente-reaprova.mjs
import pg from 'pg';
import fs from 'node:fs';
const cfg = { host: process.env.PGHOST || '/var/tmp', port: Number(process.env.PGPORT || 55432), user: 'postgres', database: 'amci' };
const db = new pg.Client(cfg); await db.connect();
let fail = 0; const ok = (c, m) => { console.log((c ? '✔' : '✘') + ' ' + m); if (!c) fail++; };
const q = (sql, p) => db.query(sql, p);
const U = {};
for (const nome of ['adm', 'rev']) {
  const { rows } = await q(`insert into auth.users (email) values ($1) returning id`, [nome + '@reaprova.teste']); U[nome] = rows[0].id;
  await q(`insert into profiles (id,email,full_name) values ($1,$2,$3) on conflict (id) do update set email=excluded.email`, [U[nome], nome + '@reaprova.teste', nome]);
}
const PJ = Number((await q(`select id from projects where slug='alto-do-jeriva'`)).rows[0].id);
await q(`insert into project_members (project_id,user_id,role) values ($1,$2,'admin'),($1,$3,'revistorias')`, [PJ, U.adm, U.rev]);
await q(`insert into client_inspections (unit_id) select id from units on conflict (unit_id) do nothing`);
const unit = async (b, p, a) => Number((await q(`select id from units where project_id=$1 and bloco=$2 and pav=$3 and apto=$4`, [PJ, b, p, a])).rows[0].id);
async function as(user, sql, params) {
  const c = new pg.Client(cfg); await c.connect();
  try {
    await c.query('begin'); await c.query(`set local role authenticated`); await c.query(`select set_config('request.jwt.claim.sub', $1, true)`, [user]);
    const r = await c.query(sql, params); await c.query('commit'); return { rows: r.rows };
  } catch (e) { await c.query('rollback').catch(() => {}); return { error: e.message, rows: [] }; } finally { await c.end(); }
}
const ver = async (u) => (await q(`select versao from revistorias_cliente where unit_id=$1`, [u])).rows[0]?.versao;
const ult = async (u) => (await q(`select movimentacao_id from chaves_unidades where unit_id=$1`, [u])).rows[0]?.movimentacao_id ?? null;
const vist = (u) => as(U.adm, `update client_inspections set status='Revistoria' where unit_id=$1`, [u]);
const agendar = async (u, d, user = U.rev) => as(user, `select public.revistoria_agendar($1,$2,'09:00','Levi','',$3,null)`, [u, d, await ver(u)]);
const resultado = async (u, r, d = '2026-11-03', user = U.rev) => as(user, `select public.revistoria_resultado($1,$2,$3,'Levi',$4,$5,null)`, [u, r, d, r === 'Reprovada' ? 'piso oco' : '', await ver(u)]);
const reabrir = async (u, user = U.rev) => as(user, `select public.revistoria_reabrir($1,'Ajustar que foi reprovado na revistoria',$2,null)`, [u, await ver(u)]);
const transferir = async (u, setor, resp = 'Cliente') => as(U.adm, `select public.chaves_transferir($1,$2,$3,$4,null)`, [u, setor, resp, await ult(u)]);
const rc = async (u) => (await q(`select status, ciclo, aprovacao_origem, entrega_mov_id from revistorias_cliente where unit_id=$1`, [u])).rows[0];
const tec = async (u) => (await q(`select numero, status, realizada_em::text from revistorias where unit_id=$1 and anulado_em is null order by numero`, [u])).rows;
const evs = async (u) => (await q(`select tipo, status_anterior, status_novo, descricao, detalhes, chave_mov_id, registrado_email from revistorias_eventos where unit_id=$1 order by id`, [u])).rows;

// ── situação de produção antes da migration: aprovada pela entrega, reaberta, agendada e reprovada ──
const A203 = await unit('A', '2º', '03'), A408 = await unit('A', '4º', '08'), BASE = await unit('A', '3º', '01');
for (const u of [A203, A408, BASE]) await vist(u);
await transferir(A203, 'cliente', 'Rodrigo'); await transferir(A408, 'cliente', 'Ana Carolina');
for (const u of [A203, A408]) {
  ok((await rc(u)).status === 'Aprovado', 'antes: aprovada pela entrega da chave');
  let r = await reabrir(u); ok(!r.error, 'antes: reaberta ' + (r.error || ''));
  r = await agendar(u, '2026-11-03'); ok(!r.error, 'antes: agendada ' + (r.error || ''));
  r = await resultado(u, 'Reprovada'); ok(!r.error, 'antes: reprovada ' + (r.error || ''));
  ok((await rc(u)).status === 'Em andamento', 'antes da correção: Em andamento (o problema relatado)');
}
// unidade com a chave na Base, reprovada: não pode mudar
await agendar(BASE, '2026-11-03'); await resultado(BASE, 'Reprovada');
const tecAntes = { a203: await tec(A203), a408: await tec(A408), base: await tec(BASE) };
const nEvAntes = (await evs(A203)).length;

// ── migration ──
await q(fs.readFileSync(new URL('../../../supabase/migrations/20261119120000_revistoria_chave_cliente_reaprova.sql', import.meta.url), 'utf8'));
for (const [u, nome] of [[A203, 'A-203'], [A408, 'A-408']]) {
  const x = await rc(u);
  ok(x.status === 'Aprovado' && x.aprovacao_origem === 'entrega_chave' && Number(x.entrega_mov_id) === Number(await ult(u)), `${nome}: Aprovado por entrega da chave (marca de chave no mapa)`);
  const e = (await evs(u)).at(-1);
  ok(e.tipo === 'entrega_chave' && e.status_anterior === 'Em andamento' && e.detalhes.reaprovacao === true && e.registrado_email === 'correção' && e.chave_mov_id === null, `${nome}: evento de reaprovação no histórico`);
  ok(/reprovada na revistoria nº 1 de 03\/11\/2026/.test(e.descricao), `${nome}: descrição cita o resultado técnico preservado: ` + e.descricao.slice(0, 120));
}
ok(JSON.stringify(await tec(A203)) === JSON.stringify(tecAntes.a203) && JSON.stringify(await tec(A408)) === JSON.stringify(tecAntes.a408), 'resultado técnico (revistoria reprovada) intacto');
ok((await evs(A203)).length === nEvAntes + 1, 'histórico anterior preservado (só 1 evento novo)');
ok((await rc(BASE)).status === 'Em andamento' && JSON.stringify(await tec(BASE)) === JSON.stringify(tecAntes.base), 'chave na Base: reprovada continua Em andamento');
await q(fs.readFileSync(new URL('../../../supabase/migrations/20261119120000_revistoria_chave_cliente_reaprova.sql', import.meta.url), 'utf8'));
ok((await evs(A203)).length === nEvAntes + 1, 'migration aplicada de novo não duplica nada');

// ── regra daqui em diante (tela) ──
const N1 = await unit('A', '5º', '01');
await vist(N1); await transferir(N1, 'cliente', 'Fulano');
await reabrir(N1);
ok((await rc(N1)).status === 'Em andamento', 'reabrir continua possível (ação própria)');
await agendar(N1, '2026-11-10');
ok((await rc(N1)).status === 'Agendado', 'agendar continua possível: fica Agendado até o resultado');
let r = await resultado(N1, 'Reprovada', '2026-11-10');
let x = await rc(N1);
ok(!r.error && x.status === 'Aprovado' && x.aprovacao_origem === 'entrega_chave', 'resultado Reprovada com a chave com o cliente → volta a Aprovado por entrega ' + (r.error || ''));
ok((await tec(N1)).at(-1).status === 'Reprovada', 'reprovação gravada como resultado técnico');
const tiposN1 = (await evs(N1)).map((e) => e.tipo).join(',');
ok(/resultado,entrega_chave$/.test(tiposN1), 'histórico: resultado e, em seguida, a reaprovação: ' + tiposN1);
// aprovada tecnicamente com a chave com o cliente: continua aprovada técnica (sem evento extra)
const N2 = await unit('A', '5º', '02'); await vist(N2); await transferir(N2, 'cliente'); await reabrir(N2); await agendar(N2, '2026-11-10');
r = await resultado(N2, 'Aprovada', '2026-11-10'); x = await rc(N2);
ok(!r.error && x.status === 'Aprovado' && x.aprovacao_origem === 'tecnica' && !(await evs(N2)).slice(-1)[0].detalhes?.reaprovacao, 'resultado Aprovada: aprovação técnica, sem reaprovação');
// chave devolvida à obra antes do resultado: segue a regra normal
const N3 = await unit('A', '5º', '03'); await vist(N3); await transferir(N3, 'cliente'); await reabrir(N3); await transferir(N3, 'base', 'Obra');
await agendar(N3, '2026-11-10'); await resultado(N3, 'Reprovada', '2026-11-10');
ok((await rc(N3)).status === 'Em andamento', 'chave devolvida antes do resultado: reprovada fica Em andamento');
// planilha (revistoria reprovada via importação) com a chave com o cliente
const N4 = await unit('A', '5º', '04'); await vist(N4); await transferir(N4, 'cliente'); await reabrir(N4); await agendar(N4, '2026-11-10');
await q(`update revistorias set status='Reprovada', realizada_em='2026-11-10' where unit_id=$1 and status='Agendada'`, [N4]);
x = await rc(N4);
ok(x.status === 'Aprovado' && x.aprovacao_origem === 'entrega_chave', 'planilha: reprovada com a chave com o cliente → Aprovado por entrega');
// permissões: a função interna não é chamável pelo usuário
r = await as(U.adm, `select private.revcli_reaprovar_entrega($1,'x')`, [N3]);
ok(!!r.error, 'função interna não exposta a usuários');

console.log(fail ? `\n${fail} falha(s)` : '\nChave com o cliente: todos os testes passaram.');
await db.end(); process.exit(fail ? 1 : 0);
