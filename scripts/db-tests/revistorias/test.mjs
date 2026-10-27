// Testes das revistorias no Postgres local: importação sem duplicar, atualização, permissões e RLS.
// Uso: bash scripts/db-tests/chaves/reset.sh && node scripts/db-tests/revistorias/test.mjs
import pg from 'pg';
const cfg = { host: process.env.PGHOST || '/var/tmp', port: Number(process.env.PGPORT || 55432), user: 'postgres', database: 'amci' };
const admin = new pg.Client(cfg); await admin.connect();
let fail = 0; const ok = (c, m) => { console.log((c ? '✔' : '✘') + ' ' + m); if (!c) fail++; };
const q = (sql, p) => admin.query(sql, p);
const U = {};
for (const nome of ['adm_j', 'rev_j', 'vis_j', 'adm_b', 'fora']) {
  const { rows } = await q(`insert into auth.users (email) values ($1) returning id`, [nome + '@rev.teste']); U[nome] = rows[0].id;
}
const proj = async (slug) => (await q(`select id from projects where slug=$1`, [slug])).rows[0].id;
const PJ = await proj('alto-do-jeriva'), PB = await proj('alto-do-buriti');
await q(`insert into project_members (project_id,user_id,role) values ($1,$2,'admin'),($1,$3,'revistorias'),($1,$4,'visitante'),($5,$6,'admin')`, [PJ, U.adm_j, U.rev_j, U.vis_j, PB, U.adm_b]);
const unit = async (b, p, a) => (await q(`select id from units where project_id=$1 and bloco=$2 and pav=$3 and apto=$4`, [PJ, b, p, a])).rows[0].id;
async function as(user, sql, params) {
  const c = new pg.Client(cfg); await c.connect();
  try {
    await c.query('begin'); await c.query(`set local role authenticated`); await c.query(`select set_config('request.jwt.claim.sub', $1, true)`, [user]);
    const r = await c.query(sql, params); await c.query('commit'); return { rows: r.rows };
  } catch (e) { await c.query('rollback').catch(() => {}); return { error: e.message }; } finally { await c.end(); }
}
const importar = (user, revs, changes = [], items = []) =>
  as(user, `select public.aplicar_importacao_agendamentos($1,$2,$3,$4,$5) as r`, ['teste.xlsx', JSON.stringify({ total: revs.length }), JSON.stringify(changes), JSON.stringify(items), JSON.stringify(revs)])
    .then((x) => (x.error ? x : { r: x.rows[0].r }));
const revs = async (uid) => (await q(`select numero,status,status_planilha,data::text,left(horario::text,5) horario from revistorias where unit_id=$1 order by numero`, [uid])).rows;
const insp = async (uid) => (await q(`select status, reinspection_date::text rd, field_sources from client_inspections where unit_id=$1`, [uid])).rows[0];

// o banco local não tem a carga de clientes: cria a vistoria (vazia) de cada unidade do Jerivá
await q(`insert into client_inspections (unit_id) select id from units where project_id=$1 on conflict (unit_id) do nothing`, [PJ]);
const A407 = await unit('A', '4º', '07'), A305 = await unit('A', '3º', '05'), A101 = await unit('A', '1º', '01');
// estado inicial: unidades reprovadas na vistoria (status "Revistoria"), como na planilha
await q(`update client_inspections set status='Revistoria', inspection_date='2026-08-17' where unit_id = any($1)`, [[A407, A305]]);
const nova = (unit_id, o, numero = 0) => ({ unit_id, row: 85, label: 'Bloco A · Apto 407', client: 'Teste', acao: 'nova', numero, novo: { status: '', status_planilha: '', data: '', horario: '', ...o } });
const atualizar = (unit_id, numero, esperado, o) => ({ unit_id, row: 85, label: 'Bloco A', client: 'Teste', acao: 'atualizar', numero, esperado, novo: { status: '', status_planilha: '', data: '', horario: '', ...o } });

console.log('— Permissões');
let r = await importar(U.vis_j, [nova(A407, { status: 'Agendada', data: '2026-10-22' })]); ok(/administradores/.test(r.error), 'visitante não importa');
r = await importar(U.rev_j, [nova(A407, { status: 'Agendada', data: '2026-10-22' })]); ok(/administradores/.test(r.error), 'revistorias não importa');
r = await importar(U.adm_b, [nova(A407, { status: 'Agendada', data: '2026-10-22' })]); ok(/administradores/.test(r.error), 'admin de outro condomínio não importa: ' + (r.error || JSON.stringify(r.r)));
r = await as(U.adm_j, `insert into revistorias (project_id,unit_id,numero,status) values ($1,$2,1,'Agendada')`, [PJ, A407]); ok(/permission denied/.test(r.error), 'escrita direta na tabela bloqueada');
ok((await revs(A407)).length === 0, 'nada gravado pelas tentativas negadas');

console.log('— Validação');
r = await importar(U.adm_j, [nova(A407, { status: 'Cancelada' })]); ok(/Revistoria inválida/.test(r.error), 'status fora da lista recusado');
r = await importar(U.adm_j, [nova(A407, { data: '28/10/2026' })]); ok(/Revistoria inválida/.test(r.error), 'data em formato errado recusada');
r = await importar(U.adm_j, [nova(A407, { data: '2026-02-31' })]); ok(!!r.error, 'data impossível recusada: ' + r.error);
r = await importar(U.adm_j, [nova(A407, {})]); ok(/Revistoria inválida/.test(r.error), 'revistoria vazia recusada');
ok((await q(`select count(*)::int n from importacoes_agendamentos`)).rows[0].n === 0, 'importação recusada não deixa registro');

console.log('— 1ª importação: com revistoria, sem revistoria e vistoria intacta');
r = await importar(U.adm_j, [nova(A407, { status: 'Aprovada', status_planilha: 'APROVADA', data: '2026-10-22', horario: '09:00' }),
  nova(A305, { status: 'Agendada', status_planilha: 'AGENDADA ', data: '2026-10-28', horario: '16:30' })]);
ok(r.r?.revistorias_novas === 2 && r.r.applied === 8, 'cria 2 revistorias (3 campos cada + data da unidade): ' + JSON.stringify(r.r));
let v = await revs(A407); ok(v.length === 1 && v[0].numero === 1 && v[0].status === 'Aprovada' && v[0].data === '2026-10-22' && v[0].horario === '09:00' && v[0].status_planilha === 'APROVADA', 'A-407: nº 1 Aprovada 22/10 09:00');
let i = await insp(A407); ok(i.status === 'Revistoria', 'status da vistoria NÃO é alterado pela revistoria');
ok(i.rd === '2026-10-22' && i.field_sources.reinspection_date === 'PLANILHA', 'Data da revistoria da unidade preenchida (origem PLANILHA)');
ok((await revs(A101)).length === 0 && (await insp(A101)).rd === null, 'unidade sem revistoria fica sem revistoria');

console.log('— 2ª importação da mesma planilha: sem duplicidade');
r = await importar(U.adm_j, [nova(A407, { status: 'Aprovada', data: '2026-10-22', horario: '09:00' })]);
ok(r.r?.revistorias_novas === 0 && r.r.revistorias_puladas === 1, 'pedido de "nova" com a prévia desatualizada é pulado');
ok((await revs(A407)).length === 1, 'continua 1 revistoria');
const itens = (await q(`select action,message from importacoes_agendamentos_itens where import_id=(select max(id) from importacoes_agendamentos)`)).rows;
ok(itens.some((x) => x.action === 'alterado_no_sistema'), 'registrado como "alterado no sistema"');
ok((await q(`select result from importacoes_agendamentos order by id desc limit 1`)).rows[0].result === 'sem_alteracoes', 'importação sem alterações');

console.log('— Atualização da revistoria em andamento (reagendamento e status)');
const esperado305 = { status: 'Agendada', data: '2026-10-28', horario: '16:30' };
r = await importar(U.adm_j, [atualizar(A305, 1, esperado305, { status: 'Agendada', data: '2026-11-03', horario: '10:30' })]);
v = await revs(A305); ok(r.r?.revistorias_atualizadas === 1 && v.length === 1 && v[0].data === '2026-11-03' && v[0].horario === '10:30', 'reagendada: mesma revistoria nº 1 com nova data/horário');
ok((await insp(A305)).rd === '2026-11-03', 'Data da revistoria da unidade acompanha o reagendamento');
r = await importar(U.adm_j, [atualizar(A305, 1, esperado305, { status: 'Aprovada' })]);
ok(r.r?.revistorias_puladas === 1 && (await revs(A305))[0].status === 'Agendada', 'prévia desatualizada: não altera');
r = await importar(U.adm_j, [atualizar(A305, 1, { status: 'Agendada', data: '2026-11-03', horario: '10:30' }, { status: 'Reprovada', status_planilha: 'REPROVADA' })]);
v = await revs(A305); ok(v[0].status === 'Reprovada' && v[0].data === '2026-11-03' && v[0].horario === '10:30', 'status atualizado; data e horário vazios na planilha não apagam');

console.log('— Revistoria reprovada + nova data: nº 2');
await q(`update client_inspections set reinspection_date='2026-11-04' where unit_id=$1`, [A305]); // alterada "no site"
r = await importar(U.adm_j, [nova(A305, { status: 'Agendada', data: '2026-11-20', horario: '08:00' }, 1)]);
v = await revs(A305); ok(r.r?.revistorias_novas === 1 && v.length === 2 && v[0].status === 'Reprovada' && v[1].numero === 2 && v[1].status === 'Agendada', 'nº 1 preservada e nº 2 criada');
ok((await insp(A305)).rd === '2026-11-04', 'Data da revistoria alterada no site é mantida');
ok((await q(`select count(*)::int n from importacoes_agendamentos_itens where unit_id=$1 and field='reinspection_date' and action='mantido_sistema'`, [A305])).rows[0].n === 1, 'registrado como "mantido do sistema"');

console.log('— Leitura (RLS) e compatibilidade');
r = await as(U.vis_j, `select count(*)::int n from revistorias`); ok(r.rows?.[0].n === 3, 'visitante do Jerivá lê as revistorias');
r = await as(U.adm_b, `select count(*)::int n from revistorias`); ok(r.rows?.[0].n === 0, 'admin só do Buriti não lê as revistorias do Jerivá');
r = await as(U.adm_j, `select public.aplicar_importacao_agendamentos($1,$2,$3,$4) as r`, ['antiga.xlsx', '{}', JSON.stringify([{ unit_id: A101, field: 'client_name', old: '', new: 'Cliente Novo', action: 'preenchido', row: 2 }]), '[]']);
ok(r.rows?.[0].r.applied === 1, 'chamada antiga (4 parâmetros, sem revistorias) continua funcionando');
r = await as(U.adm_j, `select public.aplicar_importacao_agendamentos($1,$2,$3,$4) as r`, ['x.xlsx', '{}', JSON.stringify([{ unit_id: A101, field: 'reinspection_date', old: '', new: '2026-10-01', action: 'preenchido' }]), '[]']);
ok(/Alteração inválida/.test(r.error), 'p_changes continua sem aceitar campos fora do agendamento');
r = await as(U.vis_j, `delete from revistorias`); ok(/permission denied/.test(r.error), 'apagar revistorias pela API bloqueado');

console.log('— Usuário logado sem acesso ao condomínio (correção de is_project_admin)');
r = await importar(U.fora, [nova(A101, { status: 'Agendada', data: '2026-10-22' })]); ok(/administradores/.test(r.error), 'não importa revistorias');
r = await as(U.fora, `select public.aplicar_importacao_agendamentos($1,$2,$3,$4) as r`, ['x.xlsx', '{}', JSON.stringify([{ unit_id: A101, field: 'client_name', old: 'Cliente Novo', new: 'Invasor', action: 'usado_planilha' }]), '[]']);
ok(/administradores/.test(r.error), 'não aplica importação de agendamentos');
r = await as(U.fora, `select public.resumo_exclusao_condominio($1) r`, [PJ]); ok(/Somente administradores/.test(r.error), 'não vê o resumo de exclusão da obra');
r = await as(U.fora, `select public.arquivar_condominio($1, 'Alto do Jerivá') r`, [PJ]); ok(/Somente administradores/.test(r.error), 'não arquiva a obra');
r = await as(U.adm_b, `select public.arquivar_condominio($1, 'Alto do Jerivá') r`, [PJ]); ok(/Somente administradores/.test(r.error), 'admin de outro condomínio não arquiva a obra');
ok((await q(`select archived_at from projects where id=$1`, [PJ])).rows[0].archived_at === null && (await insp(A101)).status !== undefined, 'obra continua ativa');
r = await as(U.adm_j, `select private.is_project_admin($1) a, private.is_project_admin($2) b, private.can_edit_schedule($2, 'acab') c`, [PJ, PB]);
ok(r.rows?.[0].a === true && r.rows[0].b === false && r.rows[0].c === false, 'is_project_admin/can_edit_* devolvem true/false (nunca nulo)');

await admin.end();
console.log(fail ? `\n${fail} falha(s)` : '\nTodos os testes passaram.');
process.exit(fail ? 1 : 0);
