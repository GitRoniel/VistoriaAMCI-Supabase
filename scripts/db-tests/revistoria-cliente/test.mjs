// Testes da Revistoria · Cliente no Postgres local: situação inicial (sem apagar nada), entrada automática
// pelo status da vistoria, agendar/remarcar/cancelar/resultado/reabrir, ciclos e histórico, permissões e RLS,
// tela desatualizada, pedido repetido, sincronização com a vistoria e com a planilha.
// Uso: scripts/db-tests/chaves/reset.sh 20261103180000 && node scripts/db-tests/revistoria-cliente/test.mjs
import pg from 'pg';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const cfg = { host: process.env.PGHOST || '/var/tmp', port: Number(process.env.PGPORT || 55432), user: 'postgres', database: 'amci' };
const MIG = resolve(import.meta.dirname, '../../../supabase/migrations/20261105120000_revistoria_cliente.sql');
const MIG2 = resolve(import.meta.dirname, '../../../supabase/migrations/20261109120000_revistoria_liberacao_execucao.sql');
const admin = new pg.Client(cfg); await admin.connect();
let fail = 0; const ok = (c, m) => { console.log((c ? '✔' : '✘') + ' ' + m); if (!c) fail++; };
const q = (sql, p) => admin.query(sql, p);
const U = {};
for (const nome of ['adm_j', 'rev_j', 'vis_j', 'adm_b', 'fora']) {
  const { rows } = await q(`insert into auth.users (email) values ($1) returning id`, [nome + '@rvc.teste']); U[nome] = rows[0].id;
}
const proj = async (slug) => (await q(`select id from projects where slug=$1`, [slug])).rows[0].id;
const PJ = await proj('alto-do-jeriva'), PB = await proj('alto-do-buriti');
await q(`insert into project_members (project_id,user_id,role) values ($1,$2,'admin'),($1,$3,'revistorias'),($1,$4,'visitante'),($5,$6,'admin')`, [PJ, U.adm_j, U.rev_j, U.vis_j, PB, U.adm_b]);
const unit = async (b, p, a, pid = PJ) => (await q(`select id from units where project_id=$1 and bloco=$2 and pav=$3 and apto=$4`, [pid, b, p, a])).rows[0].id;
async function as(user, sql, params) {
  const c = new pg.Client(cfg); await c.connect();
  try {
    await c.query('begin'); await c.query(`set local role authenticated`); await c.query(`select set_config('request.jwt.claim.sub', $1, true)`, [user]);
    const r = await c.query(sql, params); await c.query('commit'); return { rows: r.rows };
  } catch (e) { await c.query('rollback').catch(() => {}); return { error: e.message }; } finally { await c.end(); }
}
const rpc = (user, fn, args) => as(user, `select public.${fn}(${args.map((_, i) => '$' + (i + 1)).join(',')}) as r`, args).then((x) => (x.error ? x : { r: x.rows[0].r }));
const acomp = async (uid) => (await q(`select * from revistorias_cliente where unit_id=$1`, [uid])).rows[0] || null;
const ags = async (uid) => (await q(`select numero,status,data::text,left(horario::text,5) horario,responsavel,observacoes,realizada_em::text,resultado_obs,origem,ciclo from revistorias where unit_id=$1 order by numero`, [uid])).rows;
const evs = async (uid) => (await q(`select tipo,status_anterior,status_novo,ciclo,descricao,registrado_email from revistorias_eventos where unit_id=$1 order by id`, [uid])).rows;
const insp = async (uid) => (await q(`select status, reinspection_date::text rd, reinspection_responsible rr, version from client_inspections where unit_id=$1`, [uid])).rows[0];
const ver = async (uid) => Number((await acomp(uid))?.versao);
const agendar = (user, uid, data, resp, versao, o = {}) => rpc(user, 'revistoria_agendar', [uid, data, o.hora ?? '', resp, o.obs ?? '', versao, o.pedido ?? null]);
const resultado = (user, uid, res, quando, versao, o = {}) => rpc(user, 'revistoria_resultado', [uid, res, quando, o.resp ?? '', o.obs ?? '', versao, o.pedido ?? null]);
const hoje = (await q(`select (now() at time zone 'America/Sao_Paulo')::date::text d`)).rows[0].d;
const ontem = (await q(`select ((now() at time zone 'America/Sao_Paulo')::date - 1)::text d`)).rows[0].d;
const amanha = (await q(`select ((now() at time zone 'America/Sao_Paulo')::date + 1)::text d`)).rows[0].d;

// ── Antes da migration: dados como em produção ──
await q(`insert into client_inspections (unit_id) select id from units where project_id=$1 on conflict (unit_id) do nothing`, [PJ]);
const A102 = await unit('A', '1º', '02'), A103 = await unit('A', '1º', '03'), A104 = await unit('A', '1º', '04'),
  A105 = await unit('A', '1º', '05'), A106 = await unit('A', '1º', '06'), A107 = await unit('A', '1º', '07'), A108 = await unit('A', '1º', '08');
await q(`update client_inspections set status='Revistoria', client_name='Cliente Teste' where unit_id = any($1)`, [[A102, A105, A106, A107]]);
await q(`update client_inspections set status='Revistoria Finalizada', reinspection_date='2026-10-20', reinspection_responsible='Bruno' where unit_id=$1`, [A103]);
await q(`update client_inspections set status='Aprovado' where unit_id=$1`, [A104]);
// revistoria da planilha já existente (agendada) numa unidade em Revistoria
await q(`insert into revistorias (project_id,unit_id,numero,status,data,horario) values ($1,$2,1,'Agendada','2026-11-10','09:00')`, [PJ, A106]);
const antes = { insp: (await q(`select count(*)::int n from client_inspections`)).rows[0].n, revs: (await q(`select count(*)::int n from revistorias`)).rows[0].n,
  audit: (await q(`select count(*)::int n from audit_log`)).rows[0].n };

console.log('— Migration e situação inicial');
await q(readFileSync(MIG, 'utf8'));
await q(readFileSync(MIG, 'utf8')); // de novo: não duplica nada
await q(readFileSync(MIG2, 'utf8')); await q(readFileSync(MIG2, 'utf8'));
ok((await q(`select count(*)::int n from client_inspections`)).rows[0].n === antes.insp, 'vistorias preservadas');
let a = await acomp(A102); ok(a?.status === 'Em andamento' && a.ciclo === 1, '9) A-102 (vistoria Revistoria) → Em andamento, ciclo 1');
ok(a.inspection_id === (await q(`select id from client_inspections where unit_id=$1`, [A102])).rows[0].id, 'ligada à vistoria original (client_inspections.id)');
a = await acomp(A103); let g = await ags(A103);
ok(a?.status === 'Aprovado' && g.length === 1 && g[0].status === 'Aprovada' && g[0].realizada_em === '2026-10-20' && g[0].responsavel === 'Bruno' && g[0].origem === 'VISTORIA',
  'A-103 (Revistoria Finalizada) → Aprovado, com a revistoria registrada a partir da vistoria (20/10, Bruno)');
ok((await acomp(A104)) === null && (await acomp(A108)) === null, 'unidades Aprovado / Não agendado não entram');
a = await acomp(A106); ok(a?.status === 'Agendado' && a.revistoria_id, 'A-106 com agendamento da planilha → Agendado');
ok((await q(`select count(*)::int n from revistorias_cliente`)).rows[0].n === 5, '7) uma linha por unidade, mesmo rodando a migration duas vezes');
ok((await q(`select count(*)::int n from revistorias_eventos where tipo='entrada'`)).rows[0].n === 5, 'evento de entrada para cada unidade (sem duplicar)');
ok((await insp(A103)).status === 'Revistoria Finalizada' && (await insp(A102)).status === 'Revistoria', 'status das vistorias não muda na migration');

console.log('— Permissões e RLS');
let r = await agendar(U.vis_j, A102, amanha, 'Carla', await ver(A102)); ok(/não permite/.test(r.error), '10) visitante não agenda');
r = await agendar(U.adm_b, A102, amanha, 'Carla', await ver(A102)); ok(/não permite/.test(r.error), 'admin de outro condomínio não agenda');
r = await agendar(U.fora, A102, amanha, 'Carla', await ver(A102)); ok(/não permite/.test(r.error), 'usuário sem acesso não agenda');
r = await as(U.adm_j, `insert into revistorias_cliente (project_id,unit_id) values ($1,$2)`, [PJ, A108]); ok(/permission denied/.test(r.error), 'escrita direta em revistorias_cliente bloqueada');
r = await as(U.adm_j, `update revistorias_cliente set status='Aprovado' where unit_id=$1`, [A102]); ok(/permission denied/.test(r.error), 'update direto bloqueado');
r = await as(U.adm_j, `delete from revistorias_eventos`); ok(/permission denied/.test(r.error), 'apagar histórico bloqueado');
r = await as(U.vis_j, `select count(*)::int n from revistorias_cliente`); ok(r.rows?.[0].n === 5, 'visitante do condomínio lê a aba');
r = await as(U.adm_b, `select count(*)::int n from revistorias_cliente`); ok(r.rows?.[0].n === 0, 'outro condomínio não vê (isolamento por condomínio)');
r = await as(U.fora, `select count(*)::int n from revistorias_eventos`); ok(r.rows?.[0].n === 0, 'sem acesso não vê o histórico');
r = await q(`delete from revistorias_eventos where unit_id=$1`, [A102]).catch((e) => ({ error: e.message })); ok(/não pode ser alterado/.test(r.error), 'histórico imutável até para o dono do banco');

console.log('— Validações');
r = await agendar(U.rev_j, A102, null, 'Carla', await ver(A102)); ok(/data/.test(r.error), 'data obrigatória');
r = await agendar(U.rev_j, A102, amanha, ' ', await ver(A102)); ok(/responsável/.test(r.error), 'responsável obrigatório');
r = await agendar(U.rev_j, A102, amanha, 'Carla', await ver(A102), { hora: '25:00' }); ok(/Horário/.test(r.error), 'horário inválido recusado');
r = await agendar(U.rev_j, A102, amanha, 'Carla', 999); ok(/outra pessoa/.test(r.error), 'tela desatualizada (versão) recusada');
r = await agendar(U.rev_j, A108, amanha, 'Carla', 1); ok(/não está na Revistoria/.test(r.error), 'unidade fora da aba recusada');
r = await resultado(U.rev_j, A102, 'Aprovada', ontem, await ver(A102)); ok(/Agende/.test(r.error), 'resultado sem agendamento recusado');
ok((await ags(A102)).length === 0 && (await evs(A102)).length === 1, 'nada gravado pelas tentativas recusadas');

console.log('— Ciclo completo: agendar → reprovar → novo ciclo → remarcar → aprovar');
const p1 = '11111111-1111-4111-8111-111111111111';
r = await agendar(U.rev_j, A102, amanha, 'Carla', await ver(A102), { hora: '09:30', obs: 'Cliente pediu manhã', pedido: p1 });
a = await acomp(A102); ok(r.r?.ok && a.status === 'Agendado', '2) ao agendar → Agendado');
g = await ags(A102); ok(g.length === 1 && g[0].status === 'Agendada' && g[0].data === amanha && g[0].horario === '09:30' && g[0].responsavel === 'Carla' && g[0].origem === 'SISTEMA' && g[0].ciclo === 1, 'agendamento nº 1 com data, horário, responsável e observação');
r = await agendar(U.rev_j, A102, amanha, 'Carla', 1, { hora: '09:30', obs: 'Cliente pediu manhã', pedido: p1 });
ok(r.r?.repetido && (await ags(A102)).length === 1, 'clique repetido (mesmo pedido) não duplica');
r = await resultado(U.rev_j, A102, 'Aprovada', amanha, await ver(A102)); ok(/futura/.test(r.error), 'realização no futuro recusada');
r = await resultado(U.rev_j, A102, 'Reprovada', ontem, await ver(A102)); ok(/pendências/.test(r.error), 'reprovação exige descrever as pendências');
r = await resultado(U.rev_j, A102, 'Reprovada', ontem, await ver(A102), { obs: 'Rejunte do banheiro' });
a = await acomp(A102); ok(r.r?.ok && a.status === 'Em andamento' && a.ciclo === 2, '4) reprovada → Em andamento, ciclo 2');
g = await ags(A102); ok(g[0].status === 'Reprovada' && g[0].realizada_em === ontem && g[0].resultado_obs === 'Rejunte do banheiro', 'resultado registrado no agendamento nº 1 (data da realização e pendências)');
ok((await insp(A102)).status === 'Revistoria', 'vistoria continua em Revistoria após reprovação');
r = await agendar(U.adm_j, A102, amanha, 'Diego', await ver(A102));
r = await agendar(U.adm_j, A102, amanha, 'Elisa', await ver(A102), { hora: '14:00' });
g = await ags(A102); a = await acomp(A102);
ok(g.length === 3 && g[1].status === 'Cancelada' && /Remarcada/.test(g[1].resultado_obs) && g[2].status === 'Agendada' && g[2].responsavel === 'Elisa' && g[2].ciclo === 2 && a.status === 'Agendado',
  '5) remarcação: nº 2 fica Cancelada no histórico, nº 3 agendada (ciclo 2)');
const v0 = (await insp(A102)).version;
r = await resultado(U.rev_j, A102, 'Aprovada', hoje, await ver(A102), { obs: 'Tudo certo' });
a = await acomp(A102); let i = await insp(A102);
ok(r.r?.ok && a.status === 'Aprovado', '3) aprovada → Aprovado');
ok(i.status === 'Revistoria Finalizada' && i.rd === hoje && i.rr === 'Elisa' && Number(i.version) === Number(v0) + 1, 'vistoria: Revistoria → Revistoria Finalizada com data e responsável da revistoria');
g = await ags(A102); ok(g.length === 3 && g[0].status === 'Reprovada' && g[1].status === 'Cancelada' && g[2].status === 'Aprovada', '6) histórico completo: reprovada, cancelada, aprovada');
ok((await ags(A102)).filter((x) => ['Aprovada', 'Reprovada'].includes(x.status)).length === 2, 'quantas vezes passou por revistoria: 2 realizadas');
let e = await evs(A102);
ok(e.map((x) => x.tipo).join(',') === 'entrada,agendamento,resultado,agendamento,remarcacao,resultado' && e.every((x) => x.tipo === 'entrada' || /@rvc\.teste$/.test(x.registrado_email)),
  'eventos com quem registrou: ' + e.map((x) => x.tipo).join(','));
r = await agendar(U.rev_j, A102, amanha, 'Carla', await ver(A102)); ok(/já foi aprovada/.test(r.error), 'aprovada não recebe agendamento novo');

console.log('— Reabrir (novas pendências) e mudanças vindas da vistoria');
r = await rpc(U.rev_j, 'revistoria_reabrir', [A102, '', await ver(A102), null]); ok(/pendências/.test(r.error), 'reabrir exige as pendências');
r = await rpc(U.rev_j, 'revistoria_reabrir', [A102, 'Infiltração na varanda', await ver(A102), null]);
a = await acomp(A102); ok(r.r?.ok && a.status === 'Em andamento' && a.ciclo === 3, 'reaberta → Em andamento, ciclo 3 (revistorias pode reabrir)');
ok((await insp(A102)).status === 'Revistoria', 'vistoria: Revistoria Finalizada → Revistoria');
r = await as(U.rev_j, `update client_inspections set status='Aprovado' where unit_id=$1`, [A102]); ok(/só pode finalizar/.test(r.error), 'papel Revistorias continua sem mudar status direto na vistoria');
r = await as(U.rev_j, `update client_inspections set status='Revistoria Finalizada' where unit_id=$1`, [A105]); ok(!r.error, 'papel Revistorias finaliza pela aba Vistoria (como antes)');
a = await acomp(A105); g = await ags(A105);
ok(a.status === 'Aprovado' && g.length === 1 && g[0].status === 'Aprovada' && g[0].origem === 'VISTORIA', 'Finalizada na aba Vistoria → Aprovado na Revistoria · Cliente');
r = await as(U.rev_j, `update client_inspections set status='Revistoria' where unit_id=$1`, [A105]); ok(/só pode finalizar/.test(r.error), 'Revistorias não desfaz direto pela vistoria (só pela reabertura)');
await as(U.adm_j, `update client_inspections set status='Revistoria' where unit_id=$1`, [A105]);
a = await acomp(A105); ok(a.status === 'Em andamento' && a.ciclo === 2, 'admin volta a vistoria para Revistoria → Em andamento, novo ciclo');
await as(U.adm_j, `update client_inspections set status='Revistoria' where unit_id=$1`, [A108]);
a = await acomp(A108); ok(a?.status === 'Em andamento' && a.ciclo === 1, '1) status Revistoria na vistoria → entra automaticamente como Em andamento');
await as(U.adm_j, `update client_inspections set status='Agendado' where unit_id=$1`, [A108]);
await as(U.adm_j, `update client_inspections set status='Revistoria' where unit_id=$1`, [A108]);
ok((await q(`select count(*)::int n from revistorias_cliente where unit_id=$1`, [A108])).rows[0].n === 1 && (await acomp(A108)).ciclo === 1, 'sair e voltar para Revistoria não duplica');
r = await rpc(U.rev_j, 'revistoria_cancelar', [A107, '', await ver(A107), null]); ok(/Não há revistoria agendada/.test(r.error), 'cancelar sem agendamento recusado');
await agendar(U.rev_j, A107, amanha, 'Carla', await ver(A107));
r = await rpc(U.rev_j, 'revistoria_cancelar', [A107, 'Cliente viajou', await ver(A107), null]);
a = await acomp(A107); g = await ags(A107); ok(r.r?.ok && a.status === 'Em andamento' && g[0].status === 'Cancelada' && g[0].resultado_obs === 'Cliente viajou', 'cancelar → Em andamento, agendamento Cancelada');

console.log('— Concorrência');
const vA = await ver(A107);
const [c1, c2] = await Promise.all([agendar(U.rev_j, A107, amanha, 'Fábio', vA), agendar(U.adm_j, A107, amanha, 'Gabi', vA)]);
ok([c1, c2].filter((x) => x.r?.ok).length === 1 && [c1, c2].some((x) => /outra pessoa/.test(x.error || '')), 'duas pessoas ao mesmo tempo: só uma grava');
ok((await ags(A107)).filter((x) => x.status === 'Agendada').length === 1, 'um único agendamento em aberto');

console.log('— Planilha (importação) também atualiza a situação, sem mexer na vistoria');
await agendar(U.adm_j, A106, amanha, 'Carla', await ver(A106)); // remarca o da planilha
const n106 = (await ags(A106)).length;
r = await as(U.adm_j, `select public.aplicar_importacao_agendamentos($1,$2,$3,$4,$5) r`, ['t.xlsx', '{}', '[]', '[]',
  JSON.stringify([{ unit_id: A106, row: 2, label: 'A-106', client: 'X', acao: 'atualizar', numero: n106, esperado: { status: 'Agendada', data: amanha, horario: '' }, novo: { status: 'Aprovada', status_planilha: 'APROVADA', data: '', horario: '' } }])]);
a = await acomp(A106); ok(!r.error && a.status === 'Aprovado', 'planilha marca Aprovada → Aprovado: ' + (r.error || ''));
ok((await insp(A106)).status === 'Revistoria', 'importação não muda o status da vistoria');
ok((await evs(A106)).some((x) => x.tipo === 'planilha'), 'evento "planilha" no histórico');

console.log('— Liberação e execução (20261109120000)');
const lib = (user, uid, v, pedido = null) => rpc(user, 'revistoria_liberar', [uid, v, pedido]);
const exe = (user, uid, v, ant, pedido = null) => rpc(user, 'revistoria_execucao', [uid, v, ant, pedido]);
a = await acomp(A107); ok(a.liberado === false && a.execucao === null, 'unidades começam não liberadas e sem execução');
r = await lib(U.vis_j, A107, true); ok(/não permite/.test(r.error), 'visitante não libera');
r = await exe(U.adm_b, A107, 'MOP_FELIPE', null); ok(/não permite/.test(r.error), 'admin de outro condomínio não define execução');
r = await as(U.adm_j, `update revistorias_cliente set liberado=true where unit_id=$1`, [A107]); ok(/permission denied/.test(r.error), 'update direto da liberação bloqueado');
r = await lib(U.rev_j, A104, true); ok(/não está na Revistoria/.test(r.error), 'unidade fora da aba recusada');
const vAntes = await ver(A107);
const pl = '22222222-2222-4222-8222-222222222222';
r = await lib(U.rev_j, A107, true, pl); a = await acomp(A107);
ok(r.r?.ok && a.liberado === true && /@rvc\.teste$/.test(a.liberado_por) && a.liberado_em, 'revistorias libera: liberado, com quem e quando');
ok(Number(a.versao) === vAntes && a.status === 'Agendado', 'liberar não muda a situação nem a versão dos agendamentos');
r = await lib(U.rev_j, A107, true, pl); ok(r.r?.repetido, 'pedido repetido não duplica');
r = await lib(U.adm_j, A107, true); ok(r.r?.sem_mudanca, 'liberar o que já está liberado: nada a gravar');
r = await exe(U.adm_j, A107, 'XYZ', null); ok(/opções/.test(r.error), 'execução fora da lista recusada');
r = await exe(U.adm_j, A107, 'MOP_FELIPE', null); a = await acomp(A107); ok(r.r?.ok && a.execucao === 'MOP_FELIPE', 'execução: M.O.P · Felipe');
r = await exe(U.rev_j, A107, 'EMP_OSCAR', null); ok(/outra pessoa/.test(r.error) && (await acomp(A107)).execucao === 'MOP_FELIPE', 'tela desatualizada (anterior diferente) recusada');
r = await exe(U.rev_j, A107, 'EMP_OSCAR', 'MOP_FELIPE'); ok((await acomp(A107)).execucao === 'EMP_OSCAR', 'troca para EMP · Oscar');
r = await exe(U.rev_j, A107, null, 'EMP_OSCAR'); ok((await acomp(A107)).execucao === null, 'remove a execução');
await exe(U.rev_j, A107, 'EMP_NILSON', null); await lib(U.rev_j, A107, false);
a = await acomp(A107); ok(a.liberado === false && a.execucao === 'EMP_NILSON', 'retira a liberação; execução continua');
e = await evs(A107); const ev2 = e.filter((x) => ['liberacao', 'execucao'].includes(x.tipo));
ok(ev2.length === 6 && ev2.some((x) => /antes: M\.O\.P · Felipe/.test(x.descricao)), 'histórico com cada liberação/execução: ' + ev2.length);
r = await as(U.vis_j, `select count(*)::int n from revistorias_cliente where liberado or execucao is not null`); ok(r.rows?.[0].n === 1, 'visitante lê liberação e execução');
r = await agendar(U.rev_j, A107, amanha, 'Fábio', await ver(A107)); ok(!r.error || /aprovada/.test(r.error), 'agendamentos seguem funcionando: ' + (r.error || 'ok'));
ok((await q(`select count(*)::int n from revistorias_cliente`)).rows[0].n === (await q(`select count(distinct unit_id)::int n from revistorias_cliente`)).rows[0].n, 'sem linha duplicada por unidade');

console.log('— Dados antigos e cascata');
ok((await q(`select count(*)::int n from revistorias where origem='PLANILHA'`)).rows[0].n === antes.revs, 'revistoria antiga da planilha preservada');
ok((await q(`select count(*)::int n from audit_log`)).rows[0].n > antes.audit, 'mudanças na vistoria continuam no registro de logs');
const pTmp = (await q(`insert into projects (slug,name) values ('tmp-rvc','Tmp') returning id`)).rows[0].id;
const uTmp = (await q(`insert into units (project_id,bloco,pav,apto) values ($1,'A','T','01') returning id`, [pTmp])).rows[0].id;
await q(`insert into client_inspections (unit_id,status) values ($1,'Revistoria')`, [uTmp]);
ok((await acomp(uTmp))?.status === 'Em andamento', 'vistoria nova já em Revistoria entra na aba');
r = await q(`delete from projects where id=$1`, [pTmp]).then(() => ({}), (x) => ({ error: x.message }));
ok(!r.error && !(await acomp(uTmp)), 'excluir condomínio apaga em cascata (histórico incluso): ' + (r.error || ''));

console.log(fail ? `\n${fail} FALHA(S)` : '\nTodos os testes passaram.');
await admin.end();
process.exit(fail ? 1 : 0);
