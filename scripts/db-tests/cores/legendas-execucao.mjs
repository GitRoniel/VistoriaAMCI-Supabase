// Legendas do mapa da Execução M.O. editáveis (migration 20261116120000): nova categoria "execucao_mapa" na mesma
// tabela cores_legendas, independente dos setores do Controle de Chaves; só administradores alteram; membros leem;
// itens fixos validados pelo banco; restaurar uma categoria não mexe na outra; equipes não mudam.
// Uso: scripts/db-tests/chaves/reset.sh && node scripts/db-tests/cores/legendas-execucao.mjs
import pg from 'pg';
const cfg = { host: process.env.PGHOST || '/var/tmp', port: Number(process.env.PGPORT || 55432), user: 'postgres', database: 'amci' };
const db = new pg.Client(cfg); await db.connect();
let fail = 0; const ok = (c, m) => { console.log((c ? '✔' : '✘') + ' ' + m); if (!c) fail++; };
const q = (sql, p) => db.query(sql, p);
const U = {};
for (const nome of ['adm', 'rev', 'vis', 'fora']) {
  const { rows } = await q(`insert into auth.users (email) values ($1) returning id`, [nome + '@legexec.teste']); U[nome] = rows[0].id;
  await q(`insert into profiles (id,email,full_name) values ($1,$2,$3) on conflict (id) do update set email=excluded.email`, [U[nome], nome + '@legexec.teste', nome]);
}
const PJ = Number((await q(`select id from projects where slug='alto-do-jeriva'`)).rows[0].id);
await q(`insert into project_members (project_id,user_id,role) values ($1,$2,'admin'),($1,$3,'revistorias'),($1,$4,'visitante')`, [PJ, U.adm, U.rev, U.vis]);
async function as(user, sql, params) {
  const c = new pg.Client(cfg); await c.connect();
  try {
    await c.query('begin'); await c.query(`set local role authenticated`); await c.query(`select set_config('request.jwt.claim.sub', $1, true)`, [user]);
    const r = await c.query(sql, params); await c.query('commit'); return { rows: r.rows };
  } catch (e) { await c.query('rollback').catch(() => {}); return { error: e.message, rows: [] }; } finally { await c.end(); }
}
const ITENS = ['sem_equipe', 'aprovado_sem_equipe', 'fora_revistoria', 'liberado', 'st_em_andamento', 'st_finalizado', 'st_agendado', 'st_aprovado'];
const eqAntes = (await q(`select id, cor from equipes_execucao order by id`)).rows;
let r = await as(U.rev, `select public.cores_legenda_salvar('execucao_mapa','sem_equipe','#ff8800')`); ok(/administradores/.test(r.error || ''), 'perfil revistorias não altera legenda da Execução M.O.');
r = await as(U.vis, `select public.cores_legenda_salvar('execucao_mapa','liberado','#ff8800')`); ok(/administradores/.test(r.error || ''), 'visitante não altera');
for (const [i, k] of ITENS.entries()) {
  const cor = '#' + (0x102030 + i * 0x111111).toString(16).padStart(6, '0');
  r = await as(U.adm, `select public.cores_legenda_salvar('execucao_mapa',$1,$2) j`, [k, cor.toUpperCase()]);
  if (r.error || r.rows[0].j.cor !== cor) ok(false, `admin salva ${k}: ${r.error}`);
}
ok(Number((await q(`select count(*) from cores_legendas where categoria='execucao_mapa'`)).rows[0].count) === ITENS.length, `admin altera individualmente os ${ITENS.length} itens da Execução M.O.`);
r = await as(U.adm, `select public.cores_legenda_salvar('execucao_mapa','inexistente','#112233')`); ok(!!r.error, 'item desconhecido rejeitado');
r = await as(U.adm, `select public.cores_legenda_salvar('execucao_mapa','base','#112233')`); ok(!!r.error, 'setor do Controle de Chaves não entra na categoria da Execução M.O.');
r = await as(U.adm, `select public.cores_legenda_salvar('outra','x','#112233')`); ok(!!r.error, 'categoria desconhecida rejeitada');
r = await as(U.adm, `select public.cores_legenda_salvar('setor_chave','cx','#00aa55')`); ok(!r.error, 'setor do Controle de Chaves continua editável');
r = await as(U.vis, `select categoria, chave, cor from cores_legendas where chave='sem_equipe'`); ok(r.rows.length === 1 && r.rows[0].cor === '#102030', 'outro usuário lê a cor salva (persistente)');
r = await as(U.fora, `select * from cores_legendas`); ok(r.rows.length === 0, 'usuário sem condomínio não lê');
r = await as(U.adm, `insert into cores_legendas (categoria,chave,cor) values ('execucao_mapa','liberado','#000000') on conflict do nothing`); ok(!!r.error, 'sem escrita direta na tabela');
r = await as(U.adm, `select public.cores_legenda_restaurar('execucao_mapa','liberado') n`); ok(r.rows[0]?.n === 1, 'restaura só o item Liberado');
r = await as(U.adm, `select public.cores_legenda_restaurar('execucao_mapa') n`);
const resto = (await q(`select categoria, chave from cores_legendas order by 1,2`)).rows.map((x) => x.categoria + ':' + x.chave).join();
ok(r.rows[0]?.n === ITENS.length - 1 && resto === 'setor_chave:cx', 'restaurar a Execução M.O. não mexe no Controle de Chaves: ' + resto);
r = await as(U.adm, `select public.cores_legenda_restaurar('setor_chave') n`);
ok(Number((await q(`select count(*) from cores_legendas`)).rows[0].count) === 0, 'restaurar os setores limpa só os setores');
ok(JSON.stringify((await q(`select id, cor from equipes_execucao order by id`)).rows) === JSON.stringify(eqAntes), 'cores das equipes não mudaram');
await db.end();
console.log(fail ? `${fail} falha(s)` : 'Legendas da Execução M.O.: tudo ok'); process.exit(fail ? 1 : 0);
