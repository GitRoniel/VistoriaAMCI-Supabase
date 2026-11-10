// Cores centralizadas e equipes de mão de obra (migration 20261114120000): duas categorias independentes,
// só administradores alteram, membros leem, equipes com id estável (renomear/desativar preserva cor e vínculos),
// execução ligada ao cadastro e "execução finalizada" com histórico.
// Uso: scripts/db-tests/chaves/reset.sh && node scripts/db-tests/cores/test.mjs
import pg from 'pg';
const cfg = { host: process.env.PGHOST || '/var/tmp', port: Number(process.env.PGPORT || 55432), user: 'postgres', database: 'amci' };
const db = new pg.Client(cfg); await db.connect();
let fail = 0; const ok = (c, m) => { console.log((c ? '✔' : '✘') + ' ' + m); if (!c) fail++; };
const q = (sql, p) => db.query(sql, p);
const U = {};
for (const nome of ['adm', 'adm_b', 'rev', 'vis', 'fora']) {
  const { rows } = await q(`insert into auth.users (email) values ($1) returning id`, [nome + '@cores.teste']); U[nome] = rows[0].id;
  await q(`insert into profiles (id,email,full_name) values ($1,$2,$3) on conflict (id) do update set email=excluded.email`, [U[nome], nome + '@cores.teste', nome]);
}
const PJ = Number((await q(`select id from projects where slug='alto-do-jeriva'`)).rows[0].id), PB = Number((await q(`select id from projects where slug='alto-do-buriti'`)).rows[0].id);
await q(`insert into project_members (project_id,user_id,role) values ($1,$2,'admin'),($1,$3,'revistorias'),($1,$4,'visitante'),($5,$6,'admin')`, [PJ, U.adm, U.rev, U.vis, PB, U.adm_b]);
await q(`insert into client_inspections (unit_id) select id from units on conflict (unit_id) do nothing`);
async function as(user, sql, params) {
  const c = new pg.Client(cfg); await c.connect();
  try {
    await c.query('begin'); await c.query(`set local role authenticated`); await c.query(`select set_config('request.jwt.claim.sub', $1, true)`, [user]);
    const r = await c.query(sql, params); await c.query('commit'); return { rows: r.rows };
  } catch (e) { await c.query('rollback').catch(() => {}); return { error: e.message, rows: [] }; } finally { await c.end(); }
}
// ── Categoria A: cores das legendas (setores) ──
let r = await as(U.vis, `select * from cores_legendas`); ok(!r.error && r.rows.length === 0, 'membro lê as cores (nenhuma personalizada ainda)');
r = await as(U.rev, `select public.cores_legenda_salvar('setor_chave','cx','#00aa55')`); ok(/administradores/.test(r.error || ''), 'perfil revistorias não altera cor de setor');
r = await as(U.vis, `select public.cores_legenda_salvar('setor_chave','cx','#00aa55')`); ok(/administradores/.test(r.error || ''), 'visitante não altera cor de setor');
r = await as(U.adm, `select public.cores_legenda_salvar('setor_chave','cx','#zz0000')`); ok(/Cor inválida/.test(r.error || ''), 'cor validada (#RRGGBB)');
r = await as(U.adm, `select public.cores_legenda_salvar('setor_chave','inexistente','#112233')`); ok(!!r.error, 'setor desconhecido rejeitado');
r = await as(U.adm, `select public.cores_legenda_salvar('setor_chave','cx','#00AA55') j`); ok(!r.error && r.rows[0].j.cor === '#00aa55', 'admin salva a cor do CX (normalizada)');
r = await as(U.adm_b, `select public.cores_legenda_salvar('setor_chave','cx','#118844') j`); ok(!r.error, 'admin de outro condomínio também administra (configuração central)');
r = await as(U.adm, `select public.cores_legenda_salvar('setor_chave','base','#123456')`);
ok(Number((await q(`select count(*) from cores_legendas`)).rows[0].count) === 2, 'sem duplicidade: uma linha por setor');
r = await as(U.vis, `select chave, cor from cores_legendas order by chave`); ok(r.rows.map((x) => x.chave + x.cor).join() === 'base#123456,cx#118844', 'outro usuário lê a cor salva');
r = await as(U.fora, `select * from cores_legendas`); ok(r.rows.length === 0, 'usuário sem condomínio não lê');
r = await as(U.adm, `insert into cores_legendas (categoria,chave,cor) values ('setor_chave','sem','#000000')`); ok(!!r.error, 'sem escrita direta na tabela');
r = await as(U.adm, `select public.cores_legenda_restaurar('setor_chave','cx') n`); ok(r.rows[0]?.n === 1, 'restaura só o CX');
r = await as(U.adm, `select public.cores_legenda_restaurar('setor_chave') n`); ok(r.rows[0]?.n === 1 && Number((await q(`select count(*) from cores_legendas`)).rows[0].count) === 0, 'restaura todas');
// ── Categoria B: equipes ──
r = await as(U.vis, `select id, cor, ativo from equipes_execucao order by ordem`);
ok(r.rows.map((x) => x.id).join() === 'MOP_FELIPE,MOP_RENATO,EMP_OSCAR,EMP_NILSON' && r.rows[0].cor === '#7b4fc9', 'equipes atuais com os mesmos ids e cores');
r = await as(U.rev, `select public.equipe_execucao_salvar(null,'M.O.P','Carlos','C','#3366ff',true)`); ok(/administradores/.test(r.error || ''), 'revistorias não cria equipe');
r = await as(U.adm, `select public.equipe_execucao_salvar(null,'M.O.P','Carlos','c','#3366FF',true) j`);
const C = r.rows[0]?.j; ok(!r.error && /^EQ_[0-9A-F]{8}$/.test(C.id) && C.cor === '#3366ff' && C.cor_padrao === '#3366ff' && C.sigla === 'C', 'admin cria equipe nova com id estável: ' + (C?.id || r.error));
r = await as(U.adm, `select public.equipe_execucao_salvar(null,'m.o.p',' carlos ','X','#000000',true)`); ok(/Já existe/.test(r.error || ''), 'não duplica equipe com o mesmo nome');
const unit = async (b, p, a) => Number((await q(`select id from units where project_id=$1 and bloco=$2 and pav=$3 and apto=$4`, [PJ, b, p, a])).rows[0].id);
const A103 = await unit('A', '1º', '03'), A104 = await unit('A', '1º', '04');
for (const u of [A103, A104]) await as(U.adm, `update client_inspections set status='Revistoria' where unit_id=$1`, [u]);
r = await as(U.rev, `select public.revistoria_execucao($1,$2,null,null)`, [A103, C.id]); ok(!r.error, 'unidade atribuída à equipe nova');
r = await as(U.rev, `select public.revistoria_execucao($1,'NAO_EXISTE',null,null)`, [A104]); ok(/equipes de execução ativas/.test(r.error || ''), 'equipe inexistente rejeitada');
r = await as(U.adm, `update revistorias_cliente set execucao='NAO_EXISTE' where unit_id=$1`, [A104]); ok(!!r.error, 'sem escrita direta');
r = await q(`update revistorias_cliente set execucao='NAO_EXISTE' where unit_id=$1`, [A104]).then(() => ({}), (e) => ({ error: e.message }));
ok(/foreign key|violates/.test(r.error || ''), 'chave estrangeira impede equipe que não existe');
// renomear: id e cor preservados
r = await as(U.adm, `select public.equipe_execucao_salvar($1,'M.O.P','Carlos Henrique','C','#3366ff',true) j`, [C.id]);
ok(!r.error && r.rows[0].j.id === C.id && r.rows[0].j.cor === '#3366ff', 'renomear preserva id e cor');
ok((await q(`select execucao from revistorias_cliente where unit_id=$1`, [A103])).rows[0].execucao === C.id, 'vínculo da unidade preservado');
// cor: alterar e restaurar padrão
r = await as(U.adm, `select public.equipe_execucao_salvar('MOP_FELIPE','M.O.P','Felipe','F','#00ff00',true) j`); ok(r.rows[0]?.j.cor === '#00ff00' && r.rows[0].j.cor_padrao === '#7b4fc9', 'cor alterada; padrão mantido');
r = await as(U.adm, `select public.equipe_execucao_restaurar_cor('MOP_FELIPE') j`); ok(r.rows[0]?.j.cor === '#7b4fc9', 'restaura a cor padrão');
// categorias independentes
await as(U.adm, `select public.cores_legenda_salvar('setor_chave','producao','#ff00ff')`);
ok((await q(`select count(*) from equipes_execucao where cor='#ff00ff'`)).rows[0].count === '0', 'cor de setor não altera equipe');
await as(U.adm, `select public.cores_legenda_restaurar('setor_chave')`);
// desativar: vínculo e cor preservados; não pode ser escolhida de novo
r = await as(U.adm, `select public.equipe_execucao_salvar($1,'M.O.P','Carlos Henrique','C','#3366ff',false) j`, [C.id]); ok(r.rows[0]?.j.ativo === false, 'equipe desativada');
ok((await q(`select execucao from revistorias_cliente where unit_id=$1`, [A103])).rows[0].execucao === C.id, 'unidade mantém a equipe desativada (histórico)');
r = await as(U.rev, `select public.revistoria_execucao($1,$2,null,null)`, [A104, C.id]); ok(/ativas/.test(r.error || ''), 'equipe desativada não pode ser escolhida');
r = await as(U.adm, `delete from equipes_execucao where id=$1`, [C.id]); ok(!!r.error, 'equipe não pode ser apagada');
const ev = (await q(`select descricao from revistorias_eventos where unit_id=$1 and tipo='execucao' order by id`, [A103])).rows.map((x) => x.descricao);
ok(/M\.O\.P · Carlos/.test(ev[0] || ''), 'histórico com o nome da equipe: ' + ev[0]);
// execução finalizada
r = await as(U.vis, `select public.revistoria_execucao_finalizar($1,true,null)`, [A103]); ok(!!r.error, 'visitante não finaliza');
r = await as(U.rev, `select public.revistoria_execucao_finalizar($1,true,null)`, [A104]); ok(/Defina a equipe/.test(r.error || ''), 'finalizar exige equipe');
r = await as(U.rev, `select public.revistoria_execucao_finalizar($1,true,null) j`, [A103]); ok(!r.error && r.rows[0].j.acompanhamento.execucao_finalizada_em, 'revistorias finaliza a execução');
const st = (await q(`select status, execucao_finalizada_por from revistorias_cliente where unit_id=$1`, [A103])).rows[0];
ok(st.status === 'Em andamento' && st.execucao_finalizada_por === 'rev@cores.teste', 'status da revistoria não muda; quem finalizou registrado');
r = await as(U.rev, `select public.revistoria_execucao_finalizar($1,true,null) j`, [A103]); ok(r.rows[0]?.j.sem_mudanca === true, 'finalizar de novo não duplica');
r = await as(U.adm, `select public.revistoria_execucao_finalizar($1,false,null)`, [A103]); ok(!r.error && !(await q(`select execucao_finalizada_em from revistorias_cliente where unit_id=$1`, [A103])).rows[0].execucao_finalizada_em, 'desmarcar finalização');
const evf = (await q(`select descricao from revistorias_eventos where unit_id=$1 and descricao like 'Execução %final%' order by id`, [A103])).rows.map((x) => x.descricao);
ok(evf.length === 2 && /concluído por M\.O\.P · Carlos Henrique/.test(evf[0]), 'histórico da finalização: ' + evf.join(' | '));
await db.end();
console.log(fail ? `${fail} FALHA(S)` : 'Cores e equipes: tudo ok');
process.exit(fail ? 1 : 0);
