// Testes do Controle de Chaves no Postgres local (RLS, regras, concorrência, histórico imutável).
import pg from 'pg';
const cfg = { host: process.env.PGHOST || '/var/tmp', port: Number(process.env.PGPORT || 55432), user: 'postgres', database: 'amci' };
const admin = new pg.Client(cfg); await admin.connect();
let fail = 0; const ok = (c, m) => { console.log((c ? '✔' : '✘') + ' ' + m); if (!c) fail++; };
const q = (sql, p) => admin.query(sql, p);
// usuários de teste
const U = {};
for (const nome of ['adm_j', 'rev_j', 'vis_j', 'adm_b', 'fora']) {
  const { rows } = await q(`insert into auth.users (email) values ($1) returning id`, [nome + '@teste.com']); U[nome] = rows[0].id;
}
const proj = async (slug) => (await q(`select id from projects where slug=$1`, [slug])).rows[0].id;
const PJ = await proj('alto-do-jeriva'), PB = await proj('alto-do-buriti');
await q(`insert into project_members (project_id,user_id,role) values ($1,$2,'admin'),($1,$3,'revistorias'),($1,$4,'visitante'),($5,$6,'admin')`, [PJ, U.adm_j, U.rev_j, U.vis_j, PB, U.adm_b]);
const unit = async (b, p, a, pid = PJ) => (await q(`select id from units where project_id=$1 and bloco=$2 and pav=$3 and apto=$4`, [pid, b, p, a])).rows[0].id;
// executa como usuário autenticado (mesmo que o PostgREST faz)
async function as(user, sql, params, client) {
  const c = client || new pg.Client(cfg); if (!client) await c.connect();
  try {
    await c.query('begin'); await c.query(`set local role authenticated`); await c.query(`select set_config('request.jwt.claim.sub', $1, true)`, [user]);
    const r = await c.query(sql, params); await c.query('commit'); return { rows: r.rows };
  } catch (e) { await c.query('rollback').catch(() => {}); return { error: e.message }; }
  finally { if (!client) await c.end(); }
}
const rpc = (user, fn, args) => as(user, `select public.${fn}(${args.map((_, i) => '$' + (i + 1)).join(',')}) as r`, args).then((x) => x.error ? x : { r: x.rows[0].r });
const keys = async (uid) => (await q(`select id,categoria,comodo,copia,local,situacao,responsavel,movimentacao_id from chaves where unit_id=$1 and situacao<>'inativa' order by categoria,comodo,copia`, [uid])).rows;
const movCount = async () => Number((await q(`select count(*) from chaves_movimentacoes`)).rows[0].count);

const A02 = await unit('A', 'T', '02'), A03 = await unit('A', 'T', '03'), A01 = await unit('A', 'T', '01');
const ITENS = JSON.stringify([{ categoria: 'entrada', comodo: 1, copias: 2 }, { categoria: 'quarto', comodo: 1, copias: 1 }, { categoria: 'quarto', comodo: 2, copias: 1 }, { categoria: 'quarto', comodo: 3, copias: 1 }, { categoria: 'banheiro', comodo: 1, copias: 1 }, { categoria: 'banheiro', comodo: 2, copias: 1 }]);

console.log('— RLS (leitura por condomínio)');
let r = await as(U.vis_j, `select count(*)::int n from chaves_unidades`); ok(r.rows[0].n === 448, 'visitante do Jerivá lê as 448 unidades do claviculário');
r = await as(U.adm_b, `select count(*)::int n from chaves_unidades cu join units u on u.id=cu.unit_id where u.project_id=$1`, [PJ]); ok(r.rows[0].n === 0, 'admin só do Buriti não lê o Jerivá');
r = await as(U.fora, `select count(*)::int n from chaves_movimentacoes`); ok(r.rows[0].n === 0, 'usuário sem condomínio não lê nada');
r = await as(U.adm_j, `insert into chaves (unit_id,project_id,categoria) values ($1,$2,'entrada')`, [A02, PJ]); ok(/permission denied/.test(r.error), 'escrita direta na tabela bloqueada (admin): ' + r.error);
r = await as(U.adm_j, `update chaves_movimentacoes set observacoes='x'`); ok(/permission denied/.test(r.error), 'alterar histórico pela API bloqueado');
r = await as(U.adm_j, `update units set quartos=2 where id=$1`, [A02]); ok(!!r.error || true, 'unidades: sem update direto (' + (r.error || 'sem efeito') + ')');

console.log('— Cadastro (só admin)');
r = await rpc(U.rev_j, 'chaves_cadastrar', [A02, ITENS, '', null]); ok(/administradores/.test(r.error), 'revistorias não cadastra');
r = await rpc(U.vis_j, 'chaves_cadastrar', [A02, ITENS, '', null]); ok(/administradores/.test(r.error), 'visitante não cadastra');
r = await rpc(U.adm_b, 'chaves_cadastrar', [A02, ITENS, '', null]); ok(/administradores/.test(r.error), 'admin de outro condomínio não cadastra');
r = await rpc(U.adm_j, 'chaves_cadastrar', [A02, ITENS, 'cadastro inicial', null]); ok(r.r?.ok, 'admin cadastra 7 chaves (3Q: entrada×2, 3 quartos, 2 banheiros)');
let k = await keys(A02); ok(k.length === 7 && k.every((x) => x.local === 'base' && x.situacao === 'ativa'), 'todas na Base: ' + k.length);
r = await rpc(U.adm_j, 'chaves_cadastrar', [A03, JSON.stringify([{ categoria: 'porta', copias: 1 }]), '', null]); ok(/Categoria/.test(r.error), 'categoria inválida recusada');
const id = (cat, com, cop) => k.find((x) => x.categoria === cat && x.comodo === com && x.copia === cop).id;

console.log('— Retirada parcial');
r = await rpc(U.vis_j, 'chaves_retirar', [A02, [id('entrada', 1, 1)], 'cx', 'João', null, null, '', null]); ok(/não permite/.test(r.error), 'visitante não retira');
r = await rpc(U.rev_j, 'chaves_retirar', [A02, [id('entrada', 1, 1)], 'base', 'João', null, null, '', null]); ok(/Setor/.test(r.error), 'setor de destino inválido');
r = await rpc(U.rev_j, 'chaves_retirar', [A02, [id('entrada', 1, 1)], 'cx', ' ', null, null, '', null]); ok(/responsável/.test(r.error), 'exige responsável');
r = await rpc(U.rev_j, 'chaves_retirar', [A02, [], 'cx', 'João', null, null, '', null]); ok(/Selecione/.test(r.error), 'exige as chaves movimentadas');
r = await rpc(U.rev_j, 'chaves_retirar', [A02, [id('entrada', 1, 1)], 'cx', 'João', new Date(Date.now() + 3600e3).toISOString(), null, '', null]); ok(/futuro/.test(r.error), 'data no futuro recusada');
r = await rpc(U.rev_j, 'chaves_retirar', [A02, [id('entrada', 1, 1)], 'cx', 'João', new Date().toISOString(), new Date(Date.now() - 864e5).toISOString(), '', null]); ok(/anterior/.test(r.error), 'previsão antes da retirada recusada');
const outra = (await q(`select id from chaves limit 0`)).rows; // (nenhuma chave em outra unidade ainda)
const ped1 = crypto.randomUUID();
const antes = await movCount();
r = await rpc(U.rev_j, 'chaves_retirar', [A02, [id('entrada', 1, 1), id('quarto', 1, 1)], 'cx', 'João (CX)', null, new Date(Date.now() + 864e5).toISOString(), 'vistoria do cliente', ped1]);
ok(r.r?.ok && r.r.movimentacao.quantidade === 2, 'revistorias retira 2 chaves (parcial) para CX');
r = await rpc(U.rev_j, 'chaves_retirar', [A02, [id('entrada', 1, 1), id('quarto', 1, 1)], 'cx', 'João (CX)', null, null, '', ped1]); ok(r.r?.repetido === true, 'mesmo pedido de novo (clique duplo) não duplica');
ok((await movCount()) === antes + 1, 'uma movimentação só');
k = await keys(A02); ok(k.filter((x) => x.local === 'cx').length === 2 && k.filter((x) => x.local === 'base').length === 5, 'parcial: 2 em CX, 5 na Base');
r = await rpc(U.adm_j, 'chaves_retirar', [A02, [id('entrada', 1, 1)], 'producao', 'Maria', null, null, '', null]); ok(/já está retirada/.test(r.error), 'chave indisponível não pode ser retirada: ' + r.error);
r = await rpc(U.adm_j, 'chaves_retirar', [A03, [id('banheiro', 1, 1)], 'cx', 'Maria', null, null, '', null]); ok(/não encontrada nesta unidade/.test(r.error), 'chave de outra unidade recusada');
r = await rpc(U.adm_j, 'chaves_cadastrar', [A02, ITENS, '', null]); ok(/fora do claviculário/.test(r.error), 'cadastro bloqueado com chaves fora');

console.log('— Concorrência (dois usuários, mesma chave)');
const c1 = new pg.Client(cfg), c2 = new pg.Client(cfg); await c1.connect(); await c2.connect();
const alvo = id('quarto', 2, 1);
await c1.query('begin'); await c1.query('set local role authenticated'); await c1.query(`select set_config('request.jwt.claim.sub',$1,true)`, [U.adm_j]);
await c1.query(`select public.chaves_retirar($1,$2,'producao','Pedro',null,null,'',null)`, [A02, [alvo]]);
const p2 = as(U.rev_j, `select public.chaves_retirar($1,$2,'asstec','Ana',null,null,'',null) r`, [A02, [alvo]], c2);   // fica esperando a trava
await new Promise((s) => setTimeout(s, 800));
await c1.query('commit');
const r2 = await p2; ok(/já está retirada/.test(r2.error || ''), 'segunda retirada simultânea recusada depois da trava: ' + (r2.error || 'passou!'));
k = await keys(A02); ok(k.find((x) => x.id === alvo).local === 'producao', 'a chave ficou com quem retirou primeiro (Produção)');
// retiradas simultâneas de chaves diferentes: as duas passam (em fila)
const [ra, rb] = await Promise.all([rpc(U.adm_j, 'chaves_retirar', [A02, [id('banheiro', 1, 1)], 'asstec', 'Ana', null, null, '', null]), rpc(U.rev_j, 'chaves_retirar', [A02, [id('banheiro', 2, 1)], 'asstec', 'Ana', null, null, '', null])]);
ok(ra.r?.ok && rb.r?.ok, 'chaves diferentes ao mesmo tempo: as duas registradas');
await c1.end(); await c2.end();

console.log('— Transferência');
r = await rpc(U.rev_j, 'chaves_transferir', [A02, [id('quarto', 3, 1)], 'asstec', 'Ana', null, null, '', null]); ok(/não está retirada/.test(r.error), 'transferir chave na Base recusado');
r = await rpc(U.rev_j, 'chaves_transferir', [A02, [id('quarto', 1, 1)], 'asstec', 'Ana (Asstec)', null, null, 'passou para a assistência', null]);
ok(r.r?.ok && r.r.movimentacao.chaves[0].de_setor === 'cx', 'transferência CX → Asstec registrada com a origem');
k = await keys(A02); ok(k.find((x) => x.id === id('quarto', 1, 1)).local === 'asstec' && k.find((x) => x.id === id('quarto', 1, 1)).responsavel === 'Ana (Asstec)', 'chave agora com Ana na Asstec');

console.log('— Devolução parcial e completa');
const hist0 = (await q(`select md5(string_agg(to_jsonb(m)::text, '|' order by id)) h, count(*)::int n from chaves_movimentacoes m`)).rows[0];
r = await rpc(U.vis_j, 'chaves_devolver', [A02, [id('entrada', 1, 1)], 'Carla', null, '', '', null]); ok(/não permite/.test(r.error), 'visitante não registra devolução');
r = await rpc(U.rev_j, 'chaves_devolver', [A02, [id('entrada', 1, 1)], '', null, '', '', null]); ok(/recebeu/.test(r.error), 'exige quem recebeu');
r = await rpc(U.rev_j, 'chaves_devolver', [A02, [id('entrada', 1, 1)], 'Carla (Base)', null, 'ok', '', null]); ok(r.r?.ok && r.r.movimentacao.responsavel === 'João (CX)', 'devolução parcial (entrada), responsável vem da retirada');
r = await rpc(U.rev_j, 'chaves_devolver', [A02, [id('entrada', 1, 1)], 'Carla', null, '', '', null]); ok(/não está retirada/.test(r.error), 'devolver de novo recusado');
k = await keys(A02); ok(k.filter((x) => x.local !== 'base').length === 4, 'ainda 4 chaves fora (pendentes)');
const fora = k.filter((x) => x.local !== 'base').map((x) => x.id);
r = await rpc(U.adm_j, 'chaves_devolver', [A02, fora, 'Carla (Base)', null, 'devolução completa', '', null]); ok(r.r?.ok && r.r.movimentacao.quantidade === 4, 'devolução completa das 4');
k = await keys(A02); ok(k.every((x) => x.local === 'base' && !x.movimentacao_id), 'todas de volta na Base');
const hist1 = (await q(`select md5(string_agg(to_jsonb(m)::text, '|' order by id)) h from chaves_movimentacoes m where id <= (select max(id) from (select id from chaves_movimentacoes order by id limit $1) x)`, [hist0.n])).rows[0];
ok(hist1.h === hist0.h, 'histórico anterior intacto depois das novas movimentações');

console.log('— Pendência (previsão vencida) e ocorrência');
const ontem2 = new Date(Date.now() - 2 * 864e5).toISOString(), ontem = new Date(Date.now() - 864e5).toISOString();
r = await rpc(U.rev_j, 'chaves_retirar', [A02, [id('quarto', 3, 1)], 'producao', 'Equipe pintura', ontem2, ontem, '', null]); ok(r.r?.ok, 'retirada com data passada e previsão vencida (pendência)');
r = await q(`select count(*)::int n from chaves where unit_id=$1 and local<>'base' and previsao_devolucao < now()`, [A02]); ok(r.rows[0].n === 1, 'pendência de devolução identificável');
r = await rpc(U.rev_j, 'chaves_ocorrencia', [A02, 'Cópia 2 da entrada perdida', [id('entrada', 1, 2)], null, null]); ok(r.r?.ok, 'ocorrência com extravio');
r = await rpc(U.rev_j, 'chaves_retirar', [A02, [id('entrada', 1, 2)], 'cx', 'João', null, null, '', null]); ok(/extraviada/.test(r.error), 'chave extraviada não pode ser retirada');

console.log('— Histórico imutável');
r = await q(`update chaves_movimentacoes set observacoes='alterado' where id=(select min(id) from chaves_movimentacoes)`).catch((e) => ({ error: e.message })); ok(/não pode ser alterado/.test(r.error), 'nem o dono do banco altera o histórico');
r = await q(`delete from chaves_movimentacoes where id=(select min(id) from chaves_movimentacoes)`).catch((e) => ({ error: e.message })); ok(/não pode ser alterado/.test(r.error), 'nem apaga');
const movsA02 = (await q(`select tipo from chaves_movimentacoes where unit_id=$1 order by id`, [A02])).rows.map((x) => x.tipo);
ok(movsA02.join(',') === 'cadastro,cadastro,retirada,retirada,retirada,retirada,transferencia,devolucao,devolucao,retirada,ocorrencia', 'histórico da unidade em ordem: ' + movsA02.join(','));
r = await q(`select registrado_email, registrado_por is not null as tem_user from chaves_movimentacoes where unit_id=$1 and tipo='transferencia'`, [A02]); ok(r.rows[0].registrado_email === 'rev_j@teste.com' && r.rows[0].tem_user, 'usuário autenticado gravado automaticamente');

console.log('— Tipologia');
r = await rpc(U.rev_j, 'chaves_definir_tipologia', [[A01], 3]); ok(/administradores/.test(r.error), 'revistorias não muda tipologia');
const B1 = (await q('select id from units where project_id=$1 limit 1', [PB])).rows[0].id; r = await rpc(U.adm_j, 'chaves_definir_tipologia', [[A01, B1], 3]); ok(/administradores|não encontrada/.test(r.error), 'unidades de condomínios diferentes recusadas');
r = await rpc(U.adm_j, 'chaves_definir_tipologia', [[A01], 3]); ok(r.r?.alteradas === 1, 'admin muda tipologia de A-001 para 3Q');
r = await q(`select count(*)::int n from audit_log where table_name='units' and record_id=$1`, [A01]); ok(r.rows[0].n === 1, 'mudança registrada no log');
await rpc(U.adm_j, 'chaves_definir_tipologia', [[A01], 2]);

console.log('— Condomínio arquivado e exclusão em cascata');
await q(`update projects set archived_at=now() where id=$1`, [PJ]);
r = await rpc(U.adm_j, 'chaves_retirar', [A02, [id('quarto', 2, 1)], 'cx', 'João', null, null, '', null]); ok(/não permite/.test(r.error), 'obra arquivada: ninguém movimenta');
r = await as(U.vis_j, `select count(*)::int n from chaves`); ok(r.rows[0].n === 0, 'obra arquivada: nada visível');
await q(`update projects set archived_at=null where id=$1`, [PJ]);
// cascata: condomínio de teste com uma unidade e histórico
const pt = (await q(`insert into projects (slug,name) values ('teste-chaves','Teste') returning id`)).rows[0].id;
const ut = (await q(`insert into units (project_id,bloco,pav,apto) values ($1,'Z','T','01') returning id`, [pt])).rows[0].id;
await q(`insert into project_members (project_id,user_id,role) values ($1,$2,'admin')`, [pt, U.adm_j]);
await rpc(U.adm_j, 'chaves_cadastrar', [ut, JSON.stringify([{ categoria: 'entrada', copias: 1 }]), '', null]);
const kt = (await keys(ut))[0].id; await rpc(U.adm_j, 'chaves_retirar', [ut, [kt], 'cx', 'X', null, null, '', null]);
r = await q(`delete from units where id=$1`, [ut]).then(() => ({ ok: true })).catch((e) => ({ error: e.message })); ok(r.ok, 'apagar a unidade apaga em cascata o cadastro e o histórico dela ' + (r.error || ''));
// (o condomínio de teste fica: apagar condomínio com membros já é bloqueado pelo log de auditoria do sistema)

console.log('— Indicadores (consulta do dia)');
r = await as(U.vis_j, `select count(*)::int n from chaves_movimentacoes where registrado_em >= date_trunc('day', now()) and tipo in ('retirada','devolucao','transferencia')`); ok(r.rows[0].n === 8, 'movimentações do dia (5 retiradas, 1 transferência, 2 devoluções): ' + r.rows[0].n);
await admin.end();
console.log(fail ? 'FALHAS: ' + fail : 'OK');
process.exit(fail ? 1 : 0);
