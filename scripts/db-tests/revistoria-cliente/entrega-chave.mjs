// Aprovação operacional por entrega da chave ao cliente (migration 20261117120000).
// Cenários da especificação: pendente, não agendada, agendada, reprovada, várias reprovações, aprovada tecnicamente,
// transferências internas, retirada por equipe, devolução, regularização, reprocessamento, simultaneidade, planilha,
// reabertura, unidade fora da revistoria e dados existentes (aplicação retroativa). Nunca muda resultado técnico.
// Uso: scripts/db-tests/chaves/reset.sh 20261116120000 && node scripts/db-tests/revistoria-cliente/entrega-chave.mjs
import pg from 'pg';
import fs from 'node:fs';
const cfg = { host: process.env.PGHOST || '/var/tmp', port: Number(process.env.PGPORT || 55432), user: 'postgres', database: 'amci' };
const db = new pg.Client(cfg); await db.connect();
let fail = 0; const ok = (c, m) => { console.log((c ? '✔' : '✘') + ' ' + m); if (!c) fail++; };
const q = (sql, p) => db.query(sql, p);
const U = {};
for (const nome of ['adm', 'rev', 'vis']) {
  const { rows } = await q(`insert into auth.users (email) values ($1) returning id`, [nome + '@entrega.teste']); U[nome] = rows[0].id;
  await q(`insert into profiles (id,email,full_name) values ($1,$2,$3) on conflict (id) do update set email=excluded.email`, [U[nome], nome + '@entrega.teste', nome]);
}
const PJ = Number((await q(`select id from projects where slug='alto-do-jeriva'`)).rows[0].id);
await q(`insert into project_members (project_id,user_id,role) values ($1,$2,'admin'),($1,$3,'revistorias'),($1,$4,'visitante')`, [PJ, U.adm, U.rev, U.vis]);
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
const vist = (u, st = 'Revistoria') => as(U.adm, `update client_inspections set status=$2 where unit_id=$1`, [u, st]);
const agendar = async (u, d) => as(U.adm, `select public.revistoria_agendar($1,$2,'09:00','Levi','',$3,null)`, [u, d, await ver(u)]);
const resultado = async (u, r, d = '2026-10-20') => as(U.adm, `select public.revistoria_resultado($1,$2,$3,'Levi',$4,$5,null)`, [u, r, d, r === 'Reprovada' ? 'rejunte' : '', await ver(u)]);
const transferir = async (u, setor, resp = 'Cliente', user = U.adm) => as(user, `select public.chaves_transferir($1,$2,$3,$4,null)`, [u, setor, resp, await ult(u)]);
const rc = async (u) => (await q(`select status, ciclo, aprovacao_origem, aprovacao_em, entrega_mov_id, revistoria_id from revistorias_cliente where unit_id=$1`, [u])).rows[0];
const tec = async (u) => (await q(`select numero, status, realizada_em::text, anulado_em is not null anulado from revistorias where unit_id=$1 order by numero`, [u])).rows;
const evs = async (u, tipo = 'entrega_chave') => (await q(`select status_anterior, status_novo, descricao, detalhes, chave_mov_id, registrado_email from revistorias_eventos where unit_id=$1 and tipo=$2 order by id`, [u, tipo])).rows;
const ci = async (u) => (await q(`select status from client_inspections where unit_id=$1`, [u])).rows[0].status;

// ── antes da migration: unidade em revistoria com a chave já entregue ao cliente (aplicação retroativa) ──
const R1 = await unit('H', '1º', '01'), R2 = await unit('H', '1º', '02');
await vist(R1); await vist(R2);
await transferir(R1, 'cliente', 'Marcos');            // entregue: deve aprovar na implantação
await transferir(R2, 'cx', 'Jaqueline');              // na CX: não aprova
const r1mov = await ult(R1);
const MIG = process.env.MIG || new URL('../../../supabase/migrations/20261117120000_revistoria_aprovacao_entrega_chave.sql', import.meta.url);
await q(fs.readFileSync(MIG, 'utf8'));
let x = await rc(R1);
ok(x.status === 'Aprovado' && x.aprovacao_origem === 'entrega_chave' && Number(x.entrega_mov_id) === Number(r1mov), 'dados existentes: chave já com o cliente → Aprovado por entrega (retroativo)');
let e = await evs(R1); ok(e.length === 1 && e[0].detalhes.retroativo === true && e[0].registrado_email === 'migração' && /implantação/.test(e[0].descricao), 'evento retroativo identificado');
ok((await rc(R2)).status === 'Em andamento', 'dados existentes: chave na CX não aprova');

// ── cenários ──
const C = {};
for (const [k, b, p, a] of [['pend', 'A', '1º', '01'], ['agend', 'A', '1º', '02'], ['rep', 'A', '1º', '03'], ['rep2', 'A', '1º', '04'], ['aprov', 'A', '1º', '05'], ['interna', 'A', '1º', '06'], ['devol', 'A', '1º', '07'], ['regul', 'A', '1º', '08'], ['fora', 'B', '1º', '01'], ['simul', 'B', '1º', '02'], ['reab', 'B', '1º', '03'], ['plan', 'B', '1º', '04']]) C[k] = await unit(b, p, a);
for (const k of Object.keys(C)) if (k !== 'fora') await vist(C[k]);
// preparação técnica
await agendar(C.agend, '2026-12-01');
await agendar(C.rep, '2026-10-20'); await resultado(C.rep, 'Reprovada');
for (const d of ['2026-10-10', '2026-10-20']) { await agendar(C.rep2, d); await resultado(C.rep2, 'Reprovada', d); }
await agendar(C.aprov, '2026-10-20'); await resultado(C.aprov, 'Aprovada');
await agendar(C.plan, '2026-12-05');
const tecAntes = {}; for (const k of Object.keys(C)) tecAntes[k] = await tec(C[k]);
ok((await rc(C.aprov)).aprovacao_origem === 'tecnica', 'aprovação pela revistoria = origem técnica');

// 1) revistoria pendente / não agendada
await transferir(C.pend, 'cliente', 'Sra. Ana');
x = await rc(C.pend); e = await evs(C.pend);
ok(x.status === 'Aprovado' && x.aprovacao_origem === 'entrega_chave', 'pendente/não agendada + entrega → Aprovado (entrega de chave)');
ok(e.length === 1 && e[0].status_anterior === 'Em andamento' && e[0].detalhes.resultado_tecnico === 'Não realizada' && e[0].detalhes.realizadas === 0, 'evento: resultado técnico "Não realizada", 0 realizadas');
ok(e[0].registrado_email === 'adm@entrega.teste' && e[0].detalhes.entregue_a === 'Sra. Ana' && !!e[0].detalhes.entregue_em, 'evento: usuário, data/hora e quem recebeu');
ok(await ci(C.pend) === 'Revistoria', 'status da vistoria não muda (não vira Revistoria Finalizada)');
// 2) agendada e não realizada
await transferir(C.agend, 'cliente');
x = await rc(C.agend); e = await evs(C.agend); let t = await tec(C.agend);
ok(x.status === 'Aprovado' && x.aprovacao_origem === 'entrega_chave', 'agendada + entrega → Aprovado');
ok(t.length === 1 && t[0].status === 'Agendada' && e[0].detalhes.resultado_tecnico === 'Aguardando realização' && e[0].detalhes.agendamento_aberto?.data === '2026-12-01', 'agendamento preservado; resultado técnico "Aguardando realização"');
// 3) última reprovada
await transferir(C.rep, 'cliente');
x = await rc(C.rep); e = await evs(C.rep);
ok(x.status === 'Aprovado' && x.aprovacao_origem === 'entrega_chave' && Number(x.ciclo) === 2, 'reprovada + entrega → Aprovado (ciclo preservado)');
ok(JSON.stringify(await tec(C.rep)) === JSON.stringify(tecAntes.rep) && e[0].detalhes.resultado_tecnico === 'Reprovada' && /reprovada na revistoria nº 1/.test(e[0].descricao), 'resultado técnico continua Reprovada');
// 4) várias reprovações
await transferir(C.rep2, 'cliente');
e = await evs(C.rep2);
ok((await rc(C.rep2)).status === 'Aprovado' && e[0].detalhes.reprovacoes === 2 && e[0].detalhes.realizadas === 2 && JSON.stringify(await tec(C.rep2)) === JSON.stringify(tecAntes.rep2), 'várias reprovações + entrega → Aprovado; reprovações preservadas (2)');
// 5) aprovada tecnicamente
await transferir(C.aprov, 'cliente');
x = await rc(C.aprov); e = await evs(C.aprov);
ok(x.status === 'Aprovado' && x.aprovacao_origem === 'tecnica' && !x.entrega_mov_id, 'aprovada tecnicamente + entrega → continua aprovação técnica');
ok(e.length === 1 && e[0].detalhes.aprovou === false && /já estava aprovada/.test(e[0].descricao), 'entrega registrada no histórico sem trocar a origem');
// 6) transferências internas e retirada por equipe
for (const s of ['cx', 'producao', 'asstec', 'base']) await transferir(C.interna, s, 'Equipe ' + s);
ok((await rc(C.interna)).status === 'Em andamento' && (await evs(C.interna)).length === 0, 'transferências internas (CX, Produção, Asstec, Base) não alteram');
// 7) devolução à obra depois da entrega
await transferir(C.devol, 'cliente'); const devAntes = await rc(C.devol);
await transferir(C.devol, 'base', 'Obra');
x = await rc(C.devol);
ok(x.status === 'Aprovado' && x.aprovacao_origem === 'entrega_chave' && x.entrega_mov_id === devAntes.entrega_mov_id && (await evs(C.devol)).length === 1, 'devolução à obra: continua Aprovado, origem e histórico preservados');
ok((await q(`select setor from chaves_unidades where unit_id=$1`, [C.devol])).rows[0].setor === 'base', 'situação atual da chave segue a movimentação (Base)');
// 8) regularização (chave perdida encontrada e entregue ao cliente)
await as(U.adm, `select public.chaves_marcar_perdida($1,'Luciana','não achada',$2,null)`, [C.regul, await ult(C.regul)]);
ok((await rc(C.regul)).status === 'Em andamento', 'perda não aprova');
let rr = await as(U.adm, `select public.chaves_regularizar($1,'cliente','Cliente','achada e entregue',$2,null)`, [C.regul, await ult(C.regul)]);
ok(!rr.error && (await rc(C.regul)).aprovacao_origem === 'entrega_chave', 'regularização com entrega ao cliente → Aprovado: ' + (rr.error || 'ok'));
// 9) unidade fora da revistoria
await transferir(C.fora, 'cliente');
ok(!(await rc(C.fora)), 'unidade fora da Revistoria: nada é criado');
// 10) reprocessamento (mesma movimentação)
const movPend = (await rc(C.pend)).entrega_mov_id;
await q(`select private.revcli_entrega_chave(m, false) from chaves_movimentacoes m where id=$1`, [movPend]);
await q(`select private.revcli_entrega_chave(m, true) from chaves_movimentacoes m where id=$1`, [movPend]);
ok((await evs(C.pend)).length === 1 && Number((await rc(C.pend)).entrega_mov_id) === Number(movPend), 'reprocessar a mesma entrega não duplica evento nem aprovação');
const nova = await transferir(C.pend, 'cliente', 'Outra pessoa');
ok((await evs(C.pend)).length === 1, 'nova movimentação dentro do próprio setor Cliente não gera outra aprovação: ' + (nova.error || 'ok'));
// 11) simultaneidade: duas pessoas entregam a mesma chave ao mesmo tempo
const m0 = await ult(C.simul);
const [s1, s2] = await Promise.all([as(U.adm, `select public.chaves_transferir($1,'cliente','Ana Paula',$2,null)`, [C.simul, m0]), as(U.rev, `select public.chaves_transferir($1,'cliente','Bia Souza',$2,null)`, [C.simul, m0])]);
ok([s1, s2].filter((r) => !r.error).length === 1 && (await evs(C.simul)).length === 1 && (await rc(C.simul)).status === 'Aprovado', 'simultâneo: uma entrega vale, um evento, uma aprovação');
// 12) reabertura explícita depois da entrega
await transferir(C.reab, 'cliente');
rr = await as(U.adm, `select public.revistoria_reabrir($1,'cliente reclamou de vazamento',$2,null)`, [C.reab, await ver(C.reab)]);
x = await rc(C.reab);
ok(!rr.error && x.status === 'Em andamento' && x.aprovacao_origem === null && (await evs(C.reab)).length === 1, 'reabrir (ação própria) volta a Em andamento e mantém o evento da entrega: ' + (rr.error || 'ok'));
// 13) planilha de vistorias não reabre unidade encerrada pela entrega
await transferir(C.plan, 'cliente');
await q(`update revistorias set status='Reprovada', realizada_em='2026-12-05' where unit_id=$1 and status='Agendada'`, [C.plan]);
x = await rc(C.plan);
ok(x.status === 'Aprovado' && x.aprovacao_origem === 'entrega_chave', 'planilha atualiza o agendamento sem reabrir a unidade entregue');
// 14) resultado técnico nunca alterado pela entrega
for (const k of ['pend', 'agend', 'rep', 'rep2', 'aprov', 'interna', 'devol', 'regul', 'reab']) if (JSON.stringify(await tec(C[k])) !== JSON.stringify(tecAntes[k])) ok(false, `resultado técnico mudou em ${k}`);
ok(true, 'nenhum agendamento/resultado técnico alterado pela entrega (todas as unidades)');
// 15) permissões, leitura e escrita
rr = await as(U.vis, `select private.revcli_entrega_chave(m, false) from chaves_movimentacoes m limit 1`); ok(!!rr.error, 'usuário não chama a regra diretamente');
rr = await as(U.vis, `update revistorias_cliente set status='Aprovado', aprovacao_origem='entrega_chave' where unit_id=$1`, [C.interna]); ok(!!rr.error || (await rc(C.interna)).status === 'Em andamento', 'sem escrita direta na Revistoria');
rr = await as(U.vis, `select detalhes from revistorias_eventos where tipo='entrega_chave' and unit_id=$1`, [C.rep]); ok(rr.rows.length === 1 && rr.rows[0].detalhes.reprovacoes === 1, 'membro do condomínio lê o evento com os detalhes');
rr = await as(U.vis, `update revistorias_eventos set descricao='x' where tipo='entrega_chave'`); ok(!!rr.error, 'histórico imutável');
const inc = await q(`select count(*) from revistorias_cliente where (status='Aprovado') <> (aprovacao_origem is not null)`);
ok(Number(inc.rows[0].count) === 0, 'toda unidade Aprovada tem origem; nenhuma outra tem');
await db.end();
console.log(fail ? `${fail} falha(s)` : 'Entrega de chave: tudo ok'); process.exit(fail ? 1 : 0);
