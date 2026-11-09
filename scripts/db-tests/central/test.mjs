// Testes da Central Operacional (Resumo Geral) no Postgres local: agenda unificada sem duplicar atividades,
// produtividade (unidades únicas × atividades, período anterior, vistoriadores), pendências sem repetidos,
// atenção (gargalos), central da unidade (linha do tempo da vistoria para membros) e RLS (cada um vê só os
// seus condomínios). Somente leitura: nada é gravado pelas funções da central.
// Uso: scripts/db-tests/chaves/reset.sh && node scripts/db-tests/central/test.mjs
import pg from 'pg';
const cfg = { host: process.env.PGHOST || '/var/tmp', port: Number(process.env.PGPORT || 55432), user: 'postgres', database: 'amci' };
const admin = new pg.Client(cfg); await admin.connect();
let fail = 0; const ok = (c, m) => { console.log((c ? '✔' : '✘') + ' ' + m); if (!c) fail++; };
const q = (sql, p) => admin.query(sql, p);
const U = {};
for (const nome of ['adm_j', 'rev_j', 'vis_j', 'adm_b']) {
  const { rows } = await q(`insert into auth.users (email) values ($1) returning id`, [nome + '@central.teste']); U[nome] = rows[0].id;
  await q(`insert into profiles (id,email,full_name) values ($1,$2,$3) on conflict (id) do update set email=excluded.email`, [U[nome], nome + '@central.teste', nome]);
}
const proj = async (slug) => (await q(`select id from projects where slug=$1`, [slug])).rows[0].id;
const PJ = Number(await proj('alto-do-jeriva')), PB = Number(await proj('alto-do-buriti'));
await q(`insert into project_members (project_id,user_id,role) values ($1,$2,'admin'),($1,$3,'revistorias'),($1,$4,'visitante'),($5,$6,'admin')`, [PJ, U.adm_j, U.rev_j, U.vis_j, PB, U.adm_b]);
await q(`insert into client_inspections (unit_id) select id from units on conflict (unit_id) do nothing`);
const unit = async (b, p, a, pid = PJ) => Number((await q(`select id from units where project_id=$1 and bloco=$2 and pav=$3 and apto=$4`, [pid, b, p, a])).rows[0].id);
async function as(user, sql, params) {
  const c = new pg.Client(cfg); await c.connect();
  try {
    await c.query('begin'); await c.query(`set local role authenticated`); await c.query(`select set_config('request.jwt.claim.sub', $1, true)`, [user]);
    const r = await c.query(sql, params); await c.query('commit'); return { rows: r.rows };
  } catch (e) { await c.query('rollback').catch(() => {}); return { error: e.message, rows: [] }; } finally { await c.end(); }
}
const D = async (n) => (await q(`select ((now() at time zone 'America/Sao_Paulo')::date + $1::int)::text d`, [n])).rows[0].d;
const hoje = await D(0);
// Vistorias (como o site grava: atualização do registro da unidade; o audit_log guarda o histórico)
const vist = async (uid, status, data, resp, hora = '09:00') => as(U.adm_j, `update client_inspections set status=$2, inspection_date=$3, inspection_time=$4, responsible=$5 where unit_id=$1`, [uid, status, data, hora || null, resp]);
const A103 = await unit('A', '1º', '03'), A104 = await unit('A', '1º', '04'), A203 = await unit('A', '2º', '03'), A204 = await unit('A', '2º', '04');
const B103 = await unit('B', '1º', '03'), B104 = await unit('B', '1º', '04'), C103 = await unit('C', '1º', '03');
await vist(A103, 'Agendado', await D(-20), 'Eduarda');
await vist(A103, 'Revistoria', await D(-20), 'Eduarda');              // reprovada na 1ª vistoria → entra na Revistoria
await vist(A104, 'Aprovado', await D(-19), 'Eduarda');
await vist(A203, 'Revistoria', await D(-18), 'emilton ');             // mesmo vistoriador escrito diferente
await vist(A204, 'Agendado', await D(-2), 'Emilton', '14:00');         // atrasada (não realizada)
await vist(B103, 'Agendado', hoje, 'Eduarda', '10:30');                // hoje
await vist(B104, 'Remarcado', await D(3), 'Gabriel', '');              // futura sem horário
await vist(C103, 'Aprovado', await D(-45), 'Gabriel');                 // período anterior
const ver = async (uid) => Number((await q(`select versao from revistorias_cliente where unit_id=$1`, [uid])).rows[0].versao);
const rpc = (user, sql, p) => as(user, sql, p);
// Revistoria de A103: agendada, reprovada, nova agendada (futura); A203: agendada atrasada; e uma cancelada (remarcação)
let r = await rpc(U.rev_j, `select public.revistoria_agendar($1,$2,'08:00','Rejane','',$3,null)`, [A103, await D(-5), await ver(A103)]); ok(!r.error, 'agendou revistoria A103 ' + (r.error || ''));
r = await rpc(U.rev_j, `select public.revistoria_resultado($1,'Reprovada',$2,'Rejane','pendências',$3,null)`, [A103, await D(-5), await ver(A103)]); ok(!r.error, 'reprovou A103 ' + (r.error || ''));
r = await rpc(U.rev_j, `select public.revistoria_agendar($1,$2,'08:00','Vanilla','',$3,null)`, [A103, await D(-1), await ver(A103)]);
r = await rpc(U.rev_j, `select public.revistoria_resultado($1,'Reprovada',$2,'Vanilla','de novo',$3,null)`, [A103, await D(-1), await ver(A103)]); ok(!r.error, 'segunda reprovação A103');
r = await rpc(U.rev_j, `select public.revistoria_agendar($1,$2,'','','',$3,null)`, [A103, await D(5), await ver(A103)]); ok(!r.error, 'nova revistoria A103 sem vistoriador');
r = await rpc(U.rev_j, `select public.revistoria_agendar($1,$2,'15:00','Rejane','',$3,null)`, [A203, await D(-3), await ver(A203)]);
r = await rpc(U.rev_j, `select public.revistoria_agendar($1,$2,'16:00','Rejane','',$3,null)`, [A203, await D(-2), await ver(A203)]); ok(!r.error, 'remarcou A203 (a anterior fica Cancelada)');
// Relatório + checklist de A103 (2 relatórios, 1 item repetido entre eles)
const rel = async (uid, nome) => {
  const cam = `${PJ}/A/${uid}/${nome}.pdf`;
  await q(`insert into storage.objects (bucket_id,name,metadata) values ('revistorias-relatorios',$1,'{}')`, [cam]);
  return (await rpc(U.rev_j, `select public.revistoria_relatorio_registrar($1,$2,$3,1000,1,$4::jsonb) r`, [uid, cam, nome + '.pdf', JSON.stringify({ realizado: await D(-20), responsavel: 'Eduarda Ferreira' })])).rows[0].r.relatorio.id;
};
const R1 = await rel(A103, 'r1'), R2 = await rel(A103, 'r2');
await rpc(U.rev_j, `select public.revistoria_apontamentos_adicionar($1,$2::jsonb)`, [R1, JSON.stringify(['Sala · piso oco', 'Cozinha · rejunte', 'Quarto · porta'])]);
await rpc(U.rev_j, `select public.revistoria_apontamentos_adicionar($1,$2::jsonb)`, [R2, JSON.stringify(['COZINHA ·  Rejunte', 'Banho · ralo'])]);
const ap = async (rid, t) => (await q(`select id from revistorias_apontamentos where relatorio_id=$1 and texto like $2`, [rid, t])).rows[0].id;
await rpc(U.rev_j, `select public.revistoria_apontamento_marcar($1,true)`, [await ap(R1, 'Sala%')]);
await rpc(U.rev_j, `select public.revistoria_apontamento_marcar($1,true)`, [await ap(R2, 'COZINHA%')]);

// ── Agenda ──
const ag = await as(U.vis_j, `select * from public.central_agenda($1,$2,null)`, [await D(-30), await D(30)]);
ok(!ag.error, 'agenda: visitante consulta ' + (ag.error || ''));
const chaves = ag.rows.map((x) => x.tipo + ':' + x.ref_id);
ok(new Set(chaves).size === chaves.length, `agenda sem atividades duplicadas (${chaves.length})`);
const vs = ag.rows.filter((x) => x.tipo === 'vistoria'), rs = ag.rows.filter((x) => x.tipo === 'revistoria');
ok(vs.length === 6, 'agenda: 6 vistorias no período (C103 fica fora: −45 dias) ' + vs.length);
ok(rs.length === 5 && rs.filter((x) => x.status === 'Cancelada').length === 1, 'agenda: 5 revistorias, 1 cancelada pela remarcação ' + rs.map((x) => x.status).join(','));
const a103 = ag.rows.find((x) => Number(x.unit_id) === A103 && x.tipo === 'vistoria');
ok(a103.aps_total === 4 && a103.aps_resolvidas === 2, `pendências da unidade sem repetido: 4 (2 resolvidas) → ${a103.aps_total}/${a103.aps_resolvidas}`);
ok(a103.codigo === '103' && a103.status_revistoria === 'Agendado', 'código da unidade e status da revistoria na atividade');
ok(ag.rows[0].data <= ag.rows.at(-1).data, 'ordenada por data');
const lim = await as(U.vis_j, `select public.central_agenda_limites(null) r`);
ok(lim.rows[0].r.min === await D(-45) && lim.rows[0].r.max === await D(5), 'limites da agenda: ' + JSON.stringify(lim.rows[0].r));
// ── Produtividade ──
const pr = (await as(U.vis_j, `select public.central_produtividade($1,$2,null,'semana') r`, [await D(-30), hoje])).rows[0]?.r;
ok(!!pr, 'produtividade: visitante consulta');
const g = pr.geral, np = pr.no_periodo;
ok(g.vistoriadas === 4 && g.aprovadas_1a === 2 && g.em_revistoria === 2 && g.aguardando_vistoria === 3, `geral (unidades únicas): vistoriadas 4, aprovadas 2, em revistoria 2, aguardando 3 → ${g.vistoriadas}/${g.aprovadas_1a}/${g.em_revistoria}/${g.aguardando_vistoria}`);
ok(g.pend_total === 4 && g.pend_resolvidas === 2 && g.unidades_com_pend === 1, 'pendências gerais sem repetidos (4, 2 resolvidas, 1 unidade)');
ok(np.vist_realizadas === 3 && np.vist_aprovadas === 1 && np.vist_atrasadas === 1, `período: 3 vistorias realizadas (1 aprovada), 1 atrasada → ${np.vist_realizadas}/${np.vist_aprovadas}/${np.vist_atrasadas}`);
ok(np.rev_realizadas === 2 && np.rev_unidades === 1 && np.rev_reprovadas === 2, 'período: 2 revistorias realizadas em 1 unidade (atividades × unidades únicas)');
ok(np.rev_atrasadas === 1, 'revistoria atrasada (A203; a cancelada não conta) ' + np.rev_atrasadas);
ok(np.ant_vist_realizadas === 1, 'período anterior: 1 vistoria (C103)');
const soma = (k) => pr.serie.reduce((n, b) => n + b[k], 0);
ok(soma('vistorias') === np.vist_realizadas && soma('revistorias') === np.rev_realizadas && soma('pend_resolvidas') === np.pend_resolvidas, 'série (semana) soma os mesmos totais do período');
const ed = pr.vistoriadores.find((p) => /eduarda/i.test(p.nome)), em = pr.vistoriadores.find((p) => /emilton/i.test(p.nome)), rj = pr.vistoriadores.find((p) => /rejane/i.test(p.nome));
ok(ed && ed.vistorias === 2 && ed.aprovadas === 1 && ed.reprovadas === 1 && ed.pendencias === 4, 'Eduarda: 2 vistorias, 1 aprovada, 1 reprovada, 4 pendências identificadas');
ok(em && em.vistorias === 1, 'Emilton: "emilton " e "Emilton" são a mesma pessoa; a agendada (atrasada) não conta como realizada');
ok(rj && rj.revistorias === 1 && rj.vistorias === 0, 'Rejane: 1 revistoria realizada (como responsável do agendamento)');
const cj = pr.condominios.find((c) => c.project_id === PJ);
ok(cj && cj.vistoriadas === 4 && cj.pend_total === 4 && cj.rev_realizadas === 2, 'por condomínio (Jerivá)');
const at = pr.atencao;
ok(at.atrasadas.total === 2 && at.atrasadas.itens.length === 2, 'atenção: 2 atividades atrasadas (1 vistoria, 1 revistoria)');
ok(at.reincidentes.total === 1 && at.reincidentes.itens[0].unit_id === A103, 'atenção: A103 com reprovações recorrentes');
const pr2 = (await as(U.vis_j, `select public.central_produtividade($1,$2,null,'mes',15,30,10,2) r`, [await D(-30), hoje])).rows[0].r;
ok(pr2.atencao.muitas_pendencias.total === 1 && pr2.atencao.pendencias_antigas.total === 2 && pr2.atencao.pendencias_antigas.unidades === 1, 'atenção com parâmetros configuráveis (≥2 abertas; abertas há ≥10 dias)');
ok((await as(U.vis_j, `select public.central_produtividade($1,$2,null) r`, [hoje, await D(-5)])).error, 'período inválido é recusado');
// ── Central da unidade e pesquisa ──
const cu = (await as(U.vis_j, `select public.central_unidade($1) r`, [A103])).rows[0].r;
ok(cu && cu.unidade.codigo === '103' && cu.agendamentos.length === 3 && cu.relatorios.length === 2 && cu.apontamentos.length === 5 && cu.checklist.length === 4, 'central da unidade: agendamentos, relatórios, apontamentos (originais) e checklist (sem repetidos)');
ok(cu.historico_vistoria.length >= 2 && cu.historico_vistoria.some((h) => h.status_anterior === 'Agendado' && h.status_novo === 'Revistoria'), 'linha do tempo da vistoria para o visitante (via função): ' + cu.historico_vistoria.length);
ok(Object.keys(cu.historico_vistoria[0]).every((k) => ['registrado_em', 'registrado_email', 'origem', 'status_anterior', 'status_novo', 'data_anterior', 'data_nova', 'horario_anterior', 'horario_novo', 'responsavel_anterior', 'responsavel_novo'].includes(k)), 'histórico só com status, data, horário e responsável');
ok((await as(U.vis_j, `select count(*)::int n from audit_log`)).rows[0].n === 0, 'visitante continua sem ler o audit_log direto (RLS preservado)');
ok(cu.eventos.length > 0 && cu.revistoria.status === 'Agendado', 'eventos e situação da revistoria');
const bus = await as(U.vis_j, `select * from public.central_buscar('a 103')`);
ok(Number(bus.rows[0]?.unit_id) === A103 && bus.rows[0].aps_total === 4, 'pesquisa "a 103" → A103 primeiro');
ok((await as(U.vis_j, `select * from public.central_buscar('bloco b apto 104')`)).rows[0]?.unit_id == B104, 'pesquisa "bloco b apto 104"');
await q(`update client_inspections set client_name='Maria José da Silva' where unit_id=$1`, [B103]);
ok((await as(U.vis_j, `select * from public.central_buscar('jose silva')`)).rows.length === 0 && (await as(U.vis_j, `select * from public.central_buscar('josé da')`)).rows[0]?.unit_id == B103, 'pesquisa por cliente (sem diferença de acento)');
// ── RLS: admin do Buriti não vê nada do Jerivá ──
ok((await as(U.adm_b, `select * from public.central_agenda($1,$2,null)`, [await D(-30), await D(30)])).rows.length === 0, 'RLS: outro condomínio não vê a agenda do Jerivá');
ok((await as(U.adm_b, `select public.central_unidade($1) r`, [A103])).rows[0].r === null, 'RLS: central da unidade de outro condomínio = vazio');
ok((await as(U.adm_b, `select * from public.central_buscar('103')`)).rows.every((x) => Number(x.project_id) === PB), 'RLS: pesquisa só nos condomínios do usuário');
ok((await as(U.adm_b, `select * from private.central_hist_vistoria($1)`, [A103])).rows.length === 0, 'RLS: histórico da vistoria de outro condomínio = vazio');
ok((await as(U.adm_b, `select public.central_produtividade($1,$2,null) r`, [await D(-30), hoje])).rows[0].r.geral.vistoriadas === 0, 'RLS: produtividade só com os condomínios do usuário');
// ── Nada gravado ──
const antes = (await q(`select (select count(*) from revistorias) + (select count(*) from revistorias_eventos) + (select count(*) from audit_log) n`)).rows[0].n;
await as(U.adm_j, `select public.central_produtividade($1,$2,null) r`, [await D(-30), hoje]); await as(U.adm_j, `select public.central_unidade($1)`, [A103]);
ok((await q(`select (select count(*) from revistorias) + (select count(*) from revistorias_eventos) + (select count(*) from audit_log) n`)).rows[0].n === antes, 'funções da central não gravam nada');
await admin.end();
console.log(fail ? `\n${fail} FALHA(S)` : '\nCentral Operacional: todos os testes de banco passaram.');
process.exit(fail ? 1 : 0);
