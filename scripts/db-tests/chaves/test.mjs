// Testes do Controle de Chaves (transferência simples entre setores) no Postgres local:
// situação inicial a partir do modelo anterior, permissões, RLS, validações, cliques repetidos,
// concorrência, histórico imutável e condomínio arquivado.
// Uso: scripts/db-tests/chaves/reset.sh 20261024120000 && node scripts/db-tests/chaves/test.mjs
import pg from 'pg';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
const cfg = { host: process.env.PGHOST || '/var/tmp', port: Number(process.env.PGPORT || 55432), user: 'postgres', database: 'amci' };
const MIG = resolve(import.meta.dirname, '../../../supabase/migrations');
const admin = new pg.Client(cfg); await admin.connect();
let fail = 0; const ok = (c, m) => { console.log((c ? '✔' : '✘') + ' ' + m); if (!c) fail++; };
const q = (sql, p) => admin.query(sql, p);
const U = {};
for (const nome of ['adm_j', 'rev_j', 'vis_j', 'adm_b', 'fora']) {
  const { rows } = await q(`insert into auth.users (email) values ($1) returning id`, [nome + '@teste.com']); U[nome] = rows[0].id;
}
const proj = async (slug) => (await q(`select id from projects where slug=$1`, [slug])).rows[0].id;
const PJ = await proj('alto-do-jeriva'), PB = await proj('alto-do-buriti');
await q(`insert into project_members (project_id,user_id,role) values ($1,$2,'admin'),($1,$3,'revistorias'),($1,$4,'visitante'),($5,$6,'admin')`, [PJ, U.adm_j, U.rev_j, U.vis_j, PB, U.adm_b]);
const unit = async (b, p, a, pid = PJ) => (await q(`select id from units where project_id=$1 and bloco=$2 and pav=$3 and apto=$4`, [pid, b, p, a])).rows[0].id;
async function as(user, sql, params, client) {
  const c = client || new pg.Client(cfg); if (!client) await c.connect();
  try {
    await c.query('begin'); await c.query(`set local role authenticated`); await c.query(`select set_config('request.jwt.claim.sub', $1, true)`, [user]);
    const r = await c.query(sql, params); await c.query('commit'); return { rows: r.rows };
  } catch (e) { await c.query('rollback').catch(() => {}); return { error: e.message }; }
  finally { if (!client) await c.end(); }
}
const rpc = (user, fn, args) => as(user, `select public.${fn}(${args.map((_, i) => '$' + (i + 1)).join(',')}) as r`, args).then((x) => x.error ? x : { r: x.rows[0].r });
const transferir = (user, unitId, setor, resp, ultima, pedido = null) => rpc(user, 'chaves_transferir', [unitId, setor, resp, ultima, pedido]);
const atual = async (uid) => (await q(`select setor,responsavel,movimentado_em,movimentado_por,movimentacao_id from chaves_unidades where unit_id=$1`, [uid])).rows[0] || null;
const movs = async (uid) => (await q(`select * from chaves_movimentacoes where unit_id=$1 order by id`, [uid])).rows;
const total = async () => Number((await q(`select count(*) from chaves_movimentacoes`)).rows[0].count);

const A01 = await unit('A', 'T', '01'), A02 = await unit('A', 'T', '02'), A03 = await unit('A', 'T', '03'), A04 = await unit('A', 'T', '04');

console.log('— Modelo anterior (antes desta migration): cópias cadastradas e uma retirada');
let r = await rpc(U.adm_j, 'chaves_cadastrar', [A02, JSON.stringify([{ categoria: 'entrada', comodo: 1, copias: 2 }, { categoria: 'quarto', comodo: 1, copias: 1 }]), '', null]);
ok(r.r?.ok, 'cadastro antigo de 3 cópias');
const k = (await q(`select id from chaves where unit_id=$1 order by id`, [A02])).rows;
r = await rpc(U.rev_j, 'chaves_retirar', [A02, [k[0].id], 'cx', 'João Antigo', null, null, '', null]); ok(r.r?.ok, 'retirada antiga (CX com João Antigo)');
const movAntes = await total(), chavesAntes = Number((await q(`select count(*) from chaves`)).rows[0].count);

console.log('— Aplica as migrations seguintes (inclusive a simplificação)');
for (const f of readdirSync(MIG).filter((f) => f > '20261024120000_controle_chaves.sql' && f.endsWith('.sql')).sort()) {
  if (/rls_erp|somente_leitura_erp|pedidos_observacoes_rls/.test(f)) continue;
  await q(readFileSync(resolve(MIG, f), 'utf8')); console.log('   aplicada', f);
}

console.log('— Situação inicial calculada do que já existia (nada apagado)');
let s = await atual(A02); ok(s.setor === 'cx' && s.responsavel === 'João Antigo' && s.movimentado_por === 'rev_j@teste.com', 'A-T02: chave retirada → CX com João Antigo (registrado por rev_j)');
s = await atual(A03); ok(s.setor === 'base' && s.responsavel === '' && !!s.movimentado_em, 'A-T03: "tem chave" no levantamento → Base');
s = await atual(A01); ok(s.setor === null, 'A-T01: sem chave no levantamento → sem status');
ok(await total() === movAntes, 'histórico preservado (' + movAntes + ' movimentações)');
ok(Number((await q(`select count(*) from chaves`)).rows[0].count) === chavesAntes, 'cópias do modelo anterior guardadas');
const cont = (await q(`select setor, count(*)::int n from chaves_unidades cu join units u on u.id=cu.unit_id where u.project_id=$1 group by 1 order by 1`, [PJ])).rows;
ok(cont.find((x) => x.setor === 'base')?.n === 344 && cont.find((x) => x.setor === 'cx')?.n === 1 && cont.find((x) => x.setor === null)?.n === 103, 'Jerivá: 344 Base + 1 CX + 103 sem status: ' + JSON.stringify(cont));
r = await as(U.adm_j, `select public.chaves_cadastrar($1,'[]'::jsonb,'',null)`, [A02]); ok(/does not exist/.test(r.error), 'funções do modelo anterior removidas (cadastro)');
r = await as(U.adm_j, `select public.chaves_retirar($1,array[1]::bigint[],'cx','x',null,null,'',null)`, [A02]); ok(/does not exist/.test(r.error), 'funções do modelo anterior removidas (retirada)');

console.log('— Permissões');
const ult = async (uid) => (await atual(uid))?.movimentacao_id ?? null;
r = await transferir(U.vis_j, A03, 'cx', 'Pedro', await ult(A03)); ok(/não permite/.test(r.error), 'visitante não transfere');
r = await transferir(U.adm_b, A03, 'cx', 'Pedro', await ult(A03)); ok(/não permite/.test(r.error), 'admin de outro condomínio não transfere');
r = await transferir(U.fora, A03, 'cx', 'Pedro', await ult(A03)); ok(/não permite/.test(r.error), 'usuário sem acesso não transfere');
r = await as(U.adm_j, `update chaves_unidades set setor='cx' where unit_id=$1`, [A03]); ok(/permission denied/.test(r.error), 'escrita direta na tabela bloqueada');
r = await as(U.adm_j, `insert into chaves_movimentacoes (project_id,unit_id,tipo,data_hora) values ($1,$2,'transferencia',now())`, [PJ, A03]); ok(/permission denied/.test(r.error), 'inserir no histórico pela API bloqueado');
ok((await atual(A03)).setor === 'base', 'nada mudou com as tentativas negadas');

console.log('— Validações');
r = await transferir(U.adm_j, A03, null, 'Pedro', await ult(A03)); ok(/setor de destino/.test(r.error), 'sem setor de destino: recusado');
r = await transferir(U.adm_j, A03, 'cozinha', 'Pedro', await ult(A03)); ok(/setor de destino/.test(r.error), 'setor inexistente: recusado');
r = await transferir(U.adm_j, A03, 'cx', '  ', await ult(A03)); ok(/responsável/.test(r.error), 'sem responsável: recusado');
r = await transferir(U.adm_j, A03, 'cx', 'P', await ult(A03)); ok(/responsável/.test(r.error), 'responsável com 1 letra: recusado');
r = await transferir(U.adm_j, A03, 'cx', 'x'.repeat(81), await ult(A03)); ok(/longo/.test(r.error), 'nome longo demais: recusado');

console.log('— Transferência');
const antes03 = await atual(A03);
r = await transferir(U.rev_j, A03, 'cx', '  Pedro   Silva ', antes03.movimentacao_id, '11111111-1111-4111-8111-111111111111');
ok(r.r?.ok, 'revistorias transfere Base → CX');
s = await atual(A03); ok(s.setor === 'cx' && s.responsavel === 'Pedro Silva' && s.movimentado_por === 'rev_j@teste.com' && String(s.movimentacao_id) === String(r.r.movimentacao.id), 'unidade atualizada: CX, Pedro Silva, quem registrou e quando');
let m = (await movs(A03)).at(-1);
ok(m.tipo === 'transferencia' && m.setor_origem === 'base' && m.setor === 'cx' && m.responsavel_anterior === '' && m.responsavel === 'Pedro Silva' && m.registrado_email === 'rev_j@teste.com' && !!m.data_hora, 'histórico: origem Base, destino CX, anterior, recebeu, usuário, data/hora');
const n1 = await total();
r = await transferir(U.rev_j, A03, 'cx', 'Pedro Silva', antes03.movimentacao_id, '11111111-1111-4111-8111-111111111111');
ok(r.r?.repetido && (await total()) === n1, 'clique repetido (mesmo pedido): devolve a mesma, não duplica');
r = await transferir(U.adm_j, A03, 'cx', 'pedro silva', (await atual(A03)).movimentacao_id); ok(/já está com/.test(r.error), 'mesmo setor e mesmo responsável: recusado');
r = await transferir(U.adm_j, A03, 'asstec', 'Ana', antes03.movimentacao_id); ok(/outra pessoa/.test(r.error), 'tela desatualizada (outra pessoa transferiu): recusado');
r = await transferir(U.adm_j, A03, 'cx', 'Marcos', (await atual(A03)).movimentacao_id); ok(r.r?.ok, 'mesmo setor, outro responsável: permitido');
r = await transferir(U.adm_j, A03, 'producao', 'Equipe Lucas', (await atual(A03)).movimentacao_id); ok(r.r?.ok, 'CX → Produção');
r = await transferir(U.adm_j, A03, 'base', 'Luciana', (await atual(A03)).movimentacao_id); ok(r.r?.ok, 'Produção → Base');
const h = await movs(A03);
ok(h.length === 5 && h.slice(1).map((x) => `${x.setor_origem}>${x.setor}:${x.responsavel_anterior}>${x.responsavel}`).join(' ') === 'base>cx:>Pedro Silva cx>cx:Pedro Silva>Marcos cx>producao:Marcos>Equipe Lucas producao>base:Equipe Lucas>Luciana',
  'histórico completo mantido após novas transferências: ' + h.slice(1).map((x) => `${x.setor_origem}>${x.setor}`).join(', '));
r = await transferir(U.adm_j, A01, 'base', 'Luciana', null); s = await atual(A01);
ok(r.r?.ok && s.setor === 'base' && (await movs(A01))[0].setor_origem === null, 'unidade sem status → Base (origem: sem status)');
r = await transferir(U.adm_j, A04, 'cx', 'Rita', 999999); ok(/outra pessoa/.test(r.error), 'última movimentação inventada: recusado');

console.log('— Concorrência');
const base02 = await ult(A02);
const [c1, c2] = await Promise.all([transferir(U.adm_j, A02, 'asstec', 'Ana', base02), transferir(U.rev_j, A02, 'producao', 'Bruno', base02)]);
ok([c1, c2].filter((x) => x.r?.ok).length === 1 && [c1, c2].some((x) => /outra pessoa/.test(x.error || '')), 'duas transferências ao mesmo tempo: só uma grava');
const n2 = await total(), ped = '22222222-2222-4222-8222-222222222222', b02 = await ult(A02);
const [d1, d2] = await Promise.all([transferir(U.adm_j, A02, 'base', 'Luciana', b02, ped), transferir(U.adm_j, A02, 'base', 'Luciana', b02, ped)]);
ok(d1.r?.ok && d2.r?.ok && (await total()) === n2 + 1, 'mesmo pedido enviado duas vezes ao mesmo tempo: uma movimentação');

console.log('— Chave perdida → chaveiro → cópia → regularização');
const perder = (user, unitId, quem, motivo, ultima, pedido = null) => rpc(user, 'chaves_marcar_perdida', [unitId, quem, motivo, ultima, pedido]);
const andamento = (user, unitId, etapa, quem, obs, ultima, pedido = null) => rpc(user, 'chaves_ocorrencia_andamento', [unitId, etapa, quem, obs, ultima, pedido]);
const regularizar = (user, unitId, setor, quem, obs, ultima, pedido = null) => rpc(user, 'chaves_regularizar', [unitId, setor, quem, obs, ultima, pedido]);
const ocorr = async (uid) => (await q(`select * from chaves_ocorrencias where unit_id=$1 order by id desc limit 1`, [uid])).rows[0];
await q(`insert into client_inspections (unit_id, status) values ($1,'Aprovado') on conflict (unit_id) do update set status='Aprovado'`, [A04]);
r = await transferir(U.adm_j, A04, 'asstec', 'Rita', await ult(A04)); ok(r.r?.ok, 'A-T04 com a Asstec (Rita), vistoria Aprovada');
r = await perder(U.vis_j, A04, 'Visitante', '', await ult(A04)); ok(/não permite/.test(r.error), 'visitante não marca chave perdida');
r = await perder(U.adm_b, A04, 'Outro', '', await ult(A04)); ok(/não permite/.test(r.error), 'admin de outro condomínio não marca');
r = await perder(U.rev_j, A04, ' ', '', await ult(A04)); ok(/responsável pelo registro/.test(r.error), 'sem responsável pelo registro: recusado');
r = await perder(U.rev_j, A04, 'Bruno', 'x', 1); ok(/outra pessoa/.test(r.error), 'tela desatualizada: recusado');
const pedP = '33333333-3333-4333-8333-333333333333', n3 = await total();
r = await perder(U.rev_j, A04, '  Bruno   Lima ', 'Chave quebrou na fechadura', await ult(A04), pedP); ok(r.r?.ok, 'revistorias marca a chave como perdida (motivo opcional informado)');
r = await perder(U.rev_j, A04, 'Bruno Lima', 'Chave quebrou na fechadura', await ult(A04), pedP); ok(r.r?.repetido && (await total()) === n3 + 1, 'clique repetido: não duplica');
s = await atual(A04); let o = await ocorr(A04);
ok(s.setor === null && (await q(`select responsavel, ocorrencia_id from chaves_unidades where unit_id=$1`, [A04])).rows[0].responsavel === '', 'unidade fica sem status (sem setor e sem responsável)');
ok(o.etapa === 'perdida' && o.setor_anterior === 'asstec' && o.responsavel_anterior === 'Rita' && o.identificado_por === 'Bruno Lima' && o.motivo === 'Chave quebrou na fechadura' && o.registrado_email === 'rev_j@teste.com', 'ocorrência: setor e responsável anteriores, quem identificou, motivo, usuário');
m = (await movs(A04)).at(-1); ok(m.tipo === 'perda' && m.setor === null && m.setor_origem === 'asstec' && m.responsavel_anterior === 'Rita' && String(m.ocorrencia_id) === String(o.id), 'histórico: perda registrada (de Asstec/Rita)');
ok((await q(`select status from client_inspections where unit_id=$1`, [A04])).rows[0].status === 'Aprovado', 'status da vistoria não muda');
r = await perder(U.adm_j, A04, 'Ana', '', await ult(A04)); ok(/já está registrada como perdida/.test(r.error), 'não abre segunda ocorrência na mesma unidade');
r = await transferir(U.adm_j, A04, 'cx', 'Pedro', await ult(A04)); ok(/registrada como perdida/.test(r.error), 'chave perdida não volta a um setor por transferência');
r = await andamento(U.vis_j, A04, 'chaveiro_solicitado', 'Xavier', '', await ult(A04)); ok(/não permite/.test(r.error), 'visitante não atualiza o andamento');
r = await andamento(U.adm_j, A04, 'chaveiro', 'Luciana', '', await ult(A04)); ok(/Etapa inválida/.test(r.error), 'etapa inválida recusada');
r = await andamento(U.adm_j, A04, 'chaveiro_solicitado', 'Luciana', 'Chaveiro Silva, previsão sexta', await ult(A04)); ok(r.r?.ok, 'chaveiro solicitado');
r = await andamento(U.adm_j, A04, 'chaveiro_solicitado', 'Luciana', '', await ult(A04)); ok(/já foi solicitado/.test(r.error), 'chaveiro não é solicitado duas vezes');
r = await andamento(U.rev_j, A04, 'copia_realizada', 'Bruno', '2 cópias', await ult(A04)); ok(r.r?.ok, 'cópia realizada');
r = await andamento(U.rev_j, A04, 'copia_realizada', 'Bruno', '', await ult(A04)); ok(/já foi registrada/.test(r.error), 'cópia não é registrada duas vezes');
ok((await atual(A04)).setor === null, 'continua sem status até regularizar');
r = await regularizar(U.adm_j, A04, null, 'Pedro', '', await ult(A04)); ok(/setor/.test(r.error), 'regularizar sem setor: recusado');
r = await regularizar(U.adm_j, A04, 'cx', '', '', await ult(A04)); ok(/responsável/.test(r.error), 'regularizar sem quem recebe: recusado');
r = await regularizar(U.adm_j, A04, 'cx', 'Pedro', 'Nova chave testada', await ult(A04)); ok(r.r?.ok, 'chave regularizada: CX com Pedro');
s = await atual(A04); o = await ocorr(A04);
ok(s.setor === 'cx' && s.responsavel === 'Pedro' && (await q(`select ocorrencia_id from chaves_unidades where unit_id=$1`, [A04])).rows[0].ocorrencia_id === null, 'unidade volta ao controle normal (CX, Pedro)');
ok(o.etapa === 'regularizada' && o.chaveiro_por === 'Luciana' && o.chaveiro_email === 'adm_j@teste.com' && o.chaveiro_obs.startsWith('Chaveiro Silva') && o.copia_por === 'Bruno' && !!o.copia_em
  && o.regularizada_setor === 'cx' && o.regularizada_recebido_por === 'Pedro' && !!o.regularizada_em, 'ocorrência completa: quem solicitou, cópia, quem recebeu, datas');
ok((await movs(A04)).map((x) => x.tipo).join(',') === 'cadastro,transferencia,perda,chaveiro,copia,regularizacao', 'histórico mantém transferência anterior + todos os passos: ' + (await movs(A04)).map((x) => x.tipo).join(','));
r = await transferir(U.adm_j, A04, 'base', 'Luciana', await ult(A04)); ok(r.r?.ok, 'depois de regularizada, a chave volta a ser transferida');
r = await perder(U.adm_j, A04, 'Luciana', '', await ult(A04)); ok(r.r?.ok, 'nova perda na mesma unidade: nova ocorrência');
r = await regularizar(U.adm_j, A04, 'base', 'Luciana', 'Chave encontrada', await ult(A04)); ok(r.r?.ok && (await atual(A04)).setor === 'base', 'regularizar direto (chave encontrada)');
r = await perder(U.adm_j, A01, 'Luciana', 'Nunca teve chave', await ult(A01)); ok(r.r?.ok && (await ocorr(A01)).setor_anterior === 'base', 'qualquer unidade pode ter a chave marcada como perdida');
r = await as(U.vis_j, `select count(*)::int n from chaves_ocorrencias`); ok(r.rows[0].n === 3, 'visitante lê as ocorrências');
r = await as(U.adm_b, `select count(*)::int n from chaves_ocorrencias o join units u on u.id=o.unit_id where u.project_id=$1`, [PJ]); ok(r.rows[0].n === 0, 'admin só do Buriti não lê as ocorrências do Jerivá');
r = await as(U.adm_j, `update chaves_ocorrencias set etapa='regularizada'`); ok(/permission denied/.test(r.error), 'alterar ocorrência pela API bloqueado');

console.log('— Leitura (RLS) e histórico imutável');
r = await as(U.vis_j, `select count(*)::int n from chaves_unidades`); ok(r.rows[0].n >= 448, 'visitante do Jerivá lê a situação das unidades');
r = await as(U.vis_j, `select count(*)::int n from chaves_movimentacoes where unit_id=$1`, [A03]); ok(r.rows[0].n === 5, 'visitante lê o histórico');
r = await as(U.adm_b, `select count(*)::int n from chaves_unidades cu join units u on u.id=cu.unit_id where u.project_id=$1`, [PJ]); ok(r.rows[0].n === 0, 'admin só do Buriti não lê o Jerivá');
r = await as(U.fora, `select count(*)::int n from chaves_movimentacoes`); ok(r.rows[0].n === 0, 'usuário sem condomínio não lê nada');
r = await q(`update chaves_movimentacoes set responsavel='x' where unit_id=$1`, [A03]).then(() => ({})).catch((e) => ({ error: e.message })); ok(/não pode ser alterado/.test(r.error), 'nem o dono do banco altera o histórico');
r = await q(`delete from chaves_movimentacoes where unit_id=$1`, [A03]).then(() => ({})).catch((e) => ({ error: e.message })); ok(/não pode ser alterado/.test(r.error), 'nem apaga');

console.log('— Buriti (casas) e condomínio arquivado');
const C1 = await unit('A', '', '01', PB);
r = await transferir(U.adm_b, C1, 'cx', 'Carla', null); ok(r.r?.ok && (await atual(C1)).setor === 'cx', 'casa do Buriti sem cadastro prévio: transfere (cria a situação da unidade)');
await q(`update projects set archived_at=now() where id=$1`, [PJ]);
r = await transferir(U.adm_j, A04, 'cx', 'Rita', await ult(A04)); ok(/não permite/.test(r.error), 'obra arquivada: ninguém transfere');
r = await as(U.vis_j, `select count(*)::int n from chaves_unidades`); ok(r.rows[0].n === 0, 'obra arquivada: nada visível');
await q(`update projects set archived_at=null where id=$1`, [PJ]);
const pt = (await q(`insert into projects (slug,name) values ('teste-chaves','Teste') returning id`)).rows[0].id;
const ut = (await q(`insert into units (project_id,bloco,pav,apto) values ($1,'Z','T','01') returning id`, [pt])).rows[0].id;
await q(`insert into project_members (project_id,user_id,role) values ($1,$2,'admin')`, [pt, U.adm_j]);
await transferir(U.adm_j, ut, 'cx', 'X Teste', null);
r = await q(`delete from units where id=$1`, [ut]).then(() => ({ ok: true })).catch((e) => ({ error: e.message })); ok(r.ok, 'apagar a unidade apaga em cascata a situação e o histórico dela ' + (r.error || ''));

await admin.end();
console.log(fail ? `\n${fail} falha(s)` : '\nOK');
process.exit(fail ? 1 : 0);
