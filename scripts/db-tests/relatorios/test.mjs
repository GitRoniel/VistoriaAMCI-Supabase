// Conversão dos relatórios do Mobuss (migration 20261118120000): versões original/convertido, status por etapa,
// idempotência, falha sem perder a versão válida, histórico de reprocessamento, Storage, permissões e dicionário.
// Uso: scripts/db-tests/chaves/reset.sh 20261117120000 && node scripts/db-tests/relatorios/test.mjs
//      (o teste cria um relatório "antigo" e depois aplica a migration, para conferir o backfill)
import pg from 'pg';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chaveServico, PADRAO } from '../../../supabase/functions/relatorio-converter/conversor/dicionario.js';
const cfg = { host: process.env.PGHOST || '/var/tmp', port: Number(process.env.PGPORT || 55432), user: 'postgres', database: 'amci' };
const db = new pg.Client(cfg); await db.connect();
let fail = 0; const ok = (c, m) => { console.log((c ? '✔' : '✘') + ' ' + m); if (!c) fail++; };
const q = (sql, p) => db.query(sql, p);
const U = {};
for (const nome of ['adm', 'rev', 'vis', 'fora']) {
  const { rows } = await q(`insert into auth.users (email) values ($1) returning id`, [nome + '@conv.teste']); U[nome] = rows[0].id;
  await q(`insert into profiles (id,email,full_name) values ($1,$2,$3) on conflict (id) do update set email=excluded.email`, [U[nome], nome + '@conv.teste', nome]);
}
const PJ = Number((await q(`select id from projects where slug='alto-do-jeriva'`)).rows[0].id);
await q(`insert into project_members (project_id,user_id,role) values ($1,$2,'admin'),($1,$3,'revistorias'),($1,$4,'visitante')`, [PJ, U.adm, U.rev, U.vis]);
await q(`insert into client_inspections (unit_id) select id from units on conflict (unit_id) do nothing`);
async function as(user, sql, params, role = 'authenticated') {
  const c = new pg.Client(cfg); await c.connect();
  try {
    await c.query('begin'); await c.query(`set local role ${role}`); if (user) await c.query(`select set_config('request.jwt.claim.sub', $1, true)`, [user]);
    const r = await c.query(sql, params); await c.query('commit'); return { rows: r.rows };
  } catch (e) { await c.query('rollback').catch(() => {}); return { error: e.message, rows: [] }; } finally { await c.end(); }
}
const srv = (sql, p) => as(null, sql, p, 'service_role');
const unit = async (b, p, a) => Number((await q(`select id from units where project_id=$1 and bloco=$2 and pav=$3 and apto=$4`, [PJ, b, p, a])).rows[0].id);
const A106 = await unit('A', '1º', '06'), A107 = await unit('A', '1º', '07');
for (const u of [A106, A107]) await as(U.adm, `update client_inspections set status='Revistoria' where unit_id=$1`, [u]);
const registrar = async (uid, nome) => {
  const cam = `${PJ}/A/${uid}/${nome}.pdf`;
  await q(`insert into storage.objects (bucket_id,name,metadata) values ('revistorias-relatorios',$1,'{}')`, [cam]);
  const r = await as(U.rev, `select public.revistoria_relatorio_registrar($1,$2,$3,2355338,22,'{}'::jsonb) r`, [uid, cam, nome + '.pdf']);
  if (r.error) throw new Error(r.error);
  return Number(r.rows[0].r.relatorio.id);
};
// relatório enviado antes da migration
const ANTIGO = await registrar(A107, 'antigo');
const aplicada = (await q(`select to_regclass('public.revistorias_relatorios_versoes') t`)).rows[0].t;
if (!aplicada) {
  const dir = path.dirname(fileURLToPath(import.meta.url));
  await q(fs.readFileSync(path.join(dir, '../../../supabase/migrations/20261118120000_relatorio_conversao.sql'), 'utf8'));
  console.log('(migration 20261118120000 aplicada pelo teste)');
}
let r = await q(`select * from revistorias_relatorios_versoes where relatorio_id=$1`, [ANTIGO]);
ok(r.rows.length === 1 && r.rows[0].tipo === 'original' && r.rows[0].versao === 1 && r.rows[0].status === 'disponivel' && r.rows[0].caminho === `${PJ}/A/${A107}/antigo.pdf`,
  'backfill: relatório já enviado ganhou a versão original (v1, disponível, mesmo caminho)');
r = await q(`select conversao_status, convertido_id, caminho, tamanho, paginas from revistorias_relatorios where id=$1`, [ANTIGO]);
ok(r.rows[0].conversao_status === 'pendente' && r.rows[0].convertido_id === null && r.rows[0].paginas === 22, 'relatório antigo fica "pendente de conversão", dados preservados');
// novo envio cria o original pelo gatilho
const REL = await registrar(A106, 'mobuss-106');
r = await q(`select tipo, versao, status, caminho from revistorias_relatorios_versoes where relatorio_id=$1`, [REL]);
ok(r.rows.length === 1 && r.rows[0].tipo === 'original' && r.rows[0].caminho.endsWith('mobuss-106.pdf'), 'novo relatório: versão original criada automaticamente');
// permissões para pedir conversão
r = await as(U.vis, `select public.revistoria_conversao_solicitar($1,false)`, [REL]); ok(/não permite/.test(r.error || ''), 'visitante não pede conversão');
r = await as(U.fora, `select public.revistoria_conversao_solicitar($1,false)`, [REL]); ok(!!r.error, 'usuário de fora não pede conversão');
r = await as(U.rev, `select public.revistoria_conversao_solicitar($1,false) j`, [REL]);
const V1 = r.rows[0]?.j.versao; ok(!r.error && V1.tipo === 'convertido' && V1.versao === 1 && V1.status === 'aguardando', 'revistorias pede a conversão: versão convertida v1 aguardando ' + (r.error || ''));
r = await as(U.rev, `select public.revistoria_conversao_solicitar($1,false) j`, [REL]);
ok(r.rows[0]?.j.em_andamento === true && r.rows[0].j.versao.id === V1.id, 'pedido repetido devolve a mesma conversão (sem duplicar)');
ok(Number((await q(`select count(*) from revistorias_relatorios_versoes where relatorio_id=$1 and tipo='convertido'`, [REL])).rows[0].count) === 1, 'uma conversão em andamento por relatório');
// só o servidor avança etapas
r = await as(U.adm, `select public.revistoria_conversao_etapa($1,'extraindo')`, [V1.id]); ok(/permission denied/.test(r.error || ''), 'usuário (mesmo admin) não altera etapas');
r = await as(U.adm, `update revistorias_relatorios_versoes set status='disponivel' where id=$1`, [V1.id]); ok(!!r.error, 'sem escrita direta nas versões');
for (const e of ['processando', 'extraindo', 'organizando_fotos', 'gerando']) {
  r = await srv(`select public.revistoria_conversao_etapa($1,$2) j`, [V1.id, e]); ok(!r.error && r.rows[0].j.status === e, 'etapa ' + e);
}
ok((await q(`select conversao_status from revistorias_relatorios where id=$1`, [REL])).rows[0].conversao_status === 'gerando', 'o relatório mostra a etapa atual');
r = await srv(`select public.revistoria_conversao_etapa($1,'disponivel')`, [V1.id]); ok(/Etapa inválida/.test(r.error || ''), 'disponível não é uma etapa (só pela conclusão)');
// conclusão exige o arquivo no Storage e o caminho da versão
const cam1 = `${PJ}/conversoes/${REL}/v1.pdf`;
r = await srv(`select public.revistoria_conversao_concluir($1,$2,1000,10,'{"ncs":32,"fotos":39}'::jsonb,'mobuss-1')`, [V1.id, cam1]);
ok(/não foi encontrado/.test(r.error || ''), 'não marca disponível antes de o arquivo existir no Storage');
ok((await q(`select status from revistorias_relatorios_versoes where id=$1`, [V1.id])).rows[0].status === 'gerando', 'continua em geração');
await q(`insert into storage.objects (bucket_id,name,metadata) values ('revistorias-relatorios',$1,'{}')`, [cam1]);
r = await srv(`select public.revistoria_conversao_concluir($1,$2,1000,10,'{}'::jsonb,'')`, [V1.id, `${PJ}/A/${A106}/mobuss-106.pdf`]); ok(/Caminho/.test(r.error || ''), 'não aceita o caminho do original (nunca sobrescreve)');
r = await srv(`select public.revistoria_conversao_concluir($1,$2,2190424,10,'{"ncs":32,"fotos":39}'::jsonb,'mobuss-1') j`, [V1.id, cam1]);
ok(!r.error && r.rows[0].j.status === 'disponivel' && r.rows[0].j.paginas === 10, 'conversão concluída ' + (r.error || ''));
let rel = (await q(`select * from revistorias_relatorios where id=$1`, [REL])).rows[0];
ok(rel.convertido_id === String(V1.id) || Number(rel.convertido_id) === Number(V1.id), 'versão convertida vigente = v1');
ok(rel.conversao_status === 'disponivel' && rel.caminho.endsWith('mobuss-106.pdf'), 'original continua no mesmo caminho');
ok((await q(`select count(*) from revistorias_eventos where unit_id=$1 and descricao like 'Relatório compacto gerado (versão 1, 32 NCs, 39 fotos)%'`, [A106])).rows[0].count === '1', 'evento no histórico da unidade');
r = await srv(`select public.revistoria_conversao_falhar($1,'x')`, [V1.id]); ok(/encerrada/.test(r.error || ''), 'versão concluída não pode virar falha');
// sem reprocessar: não refaz
r = await as(U.rev, `select public.revistoria_conversao_solicitar($1,false) j`, [REL]); ok(r.rows[0]?.j.ja_convertido === true, 'relatório já convertido não é refeito sem pedir reprocessamento');
// reprocessar com falha: mantém a v1 válida
r = await as(U.rev, `select public.revistoria_conversao_solicitar($1,true) j`, [REL]);
const V2 = r.rows[0]?.j.versao; ok(V2?.versao === 2 && V2.status === 'aguardando', 'reprocessar abre a versão 2');
await srv(`select public.revistoria_conversao_etapa($1,'extraindo')`, [V2.id]);
r = await srv(`select public.revistoria_conversao_falhar($1,'Nenhuma não conformidade encontrada no PDF') j`, [V2.id]); ok(!r.error && r.rows[0].j.status === 'falha', 'falha registrada');
rel = (await q(`select * from revistorias_relatorios where id=$1`, [REL])).rows[0];
ok(Number(rel.convertido_id) === Number(V1.id) && rel.conversao_status === 'falha' && /Nenhuma/.test(rel.conversao_erro), 'falha mostra o erro e mantém a v1 válida como vigente');
// nova tentativa depois da falha; conversão "travada" vira falha por tempo
r = await as(U.rev, `select public.revistoria_conversao_solicitar($1,true) j`, [REL]); const V3 = r.rows[0]?.j.versao; ok(V3?.versao === 3, 'nova tentativa: versão 3');
await q(`update revistorias_relatorios_versoes set atualizado_em = now() - interval '10 minutes' where id=$1`, [V3.id]);
r = await as(U.rev, `select public.revistoria_conversao_solicitar($1,true) j`, [REL]); const V4 = r.rows[0]?.j.versao;
ok(V4?.versao === 4 && (await q(`select status, erro from revistorias_relatorios_versoes where id=$1`, [V3.id])).rows[0].status === 'falha', 'conversão parada há mais de 5 min vira falha (tempo esgotado) e abre a versão 4');
await q(`insert into storage.objects (bucket_id,name,metadata) values ('revistorias-relatorios',$1,'{}')`, [`${PJ}/conversoes/${REL}/v4.pdf`]);
r = await srv(`select public.revistoria_conversao_concluir($1,$2,2190000,10,'{"ncs":32,"fotos":39}'::jsonb,'mobuss-1') j`, [V4.id, `${PJ}/conversoes/${REL}/v4.pdf`]);
rel = (await q(`select * from revistorias_relatorios where id=$1`, [REL])).rows[0];
ok(!r.error && Number(rel.convertido_id) === Number(V4.id) && rel.conversao_status === 'disponivel' && rel.conversao_erro === '', 'v4 vira a vigente; erro anterior limpo');
r = await q(`select tipo, versao, status from revistorias_relatorios_versoes where relatorio_id=$1 order by tipo desc, versao`, [REL]);
ok(r.rows.map((x) => x.tipo[0] + x.versao + ':' + x.status).join() === 'o1:disponivel,c1:disponivel,c2:falha,c3:falha,c4:disponivel', 'histórico completo: ' + r.rows.map((x) => x.tipo[0] + x.versao + ':' + x.status).join());
ok((await q(`select count(*) from storage.objects where name=$1`, [cam1])).rows[0].count === '1', 'arquivo da v1 continua no Storage (histórico)');
// leitura: membros veem; de fora não
r = await as(U.vis, `select count(*)::int n from revistorias_relatorios_versoes where relatorio_id=$1`, [REL]); ok(r.rows[0]?.n === 5, 'visitante lê as versões');
r = await as(U.fora, `select count(*)::int n from revistorias_relatorios_versoes`); ok(r.rows[0]?.n === 0, 'usuário de fora não lê');
// Storage: usuário não grava na pasta das conversões
r = await as(U.rev, `insert into storage.objects (bucket_id,name,metadata) values ('revistorias-relatorios',$1,'{}')`, [`${PJ}/conversoes/${REL}/v9.pdf`]); ok(!!r.error, 'usuário não grava na pasta conversoes (só o servidor)');
r = await as(U.rev, `insert into storage.objects (bucket_id,name,metadata) values ('revistorias-relatorios',$1,'{}')`, [`${PJ}/A/${A106}/outro.pdf`]); ok(!r.error, 'envio do original continua permitido');
// relatório retirado não converte
await as(U.rev, `select public.revistoria_relatorio_remover($1)`, [ANTIGO]);
r = await as(U.rev, `select public.revistoria_conversao_solicitar($1,false)`, [ANTIGO]); ok(/não encontrado/.test(r.error || ''), 'relatório retirado não é convertido');
// ── dicionário ──
r = await as(U.vis, `select original, chave, curto from relatorio_servicos_dicionario order by id`);
ok(r.rows.length === 7 && r.rows.every((x) => x.chave === chaveServico(x.original)), 'membro lê o dicionário; chave do banco = chave do conversor');
ok(PADRAO.every((p) => r.rows.some((x) => x.chave === chaveServico(p.original) && x.curto === p.curto)), 'padrões do conversor semeados no banco');
ok((await q(`select private.relconv_chave('REVESTIMENTO - PISO/ PAREDE (CERÂMICO)') k`)).rows[0].k === chaveServico('REVESTIMENTO - PISO/PAREDE (CERÂMICO)'), 'espaços/acentos do Mobuss não atrapalham a equivalência');
r = await as(U.rev, `select public.relatorio_dicionario_salvar(null,'IMPERMEABILIZAÇÃO - BOX','Impermeabilização',true)`); ok(/administradores/.test(r.error || ''), 'só administradores alteram o dicionário');
r = await as(U.adm, `select public.relatorio_dicionario_salvar(null,'IMPERMEABILIZAÇÃO - BOX','Impermeabilização',true) j`); const NOVO = r.rows[0]?.j; ok(!r.error && NOVO.chave === 'impermeabilizacaobox', 'admin cadastra serviço novo');
r = await as(U.adm, `select public.relatorio_dicionario_salvar(null,'impermeabilizacao - box','Impermeab.',true) j`); ok(r.rows[0]?.j.id === NOVO.id && r.rows[0].j.curto === 'Impermeab.', 'mesmo serviço escrito diferente atualiza (sem duplicar)');
r = await as(U.adm, `select public.relatorio_dicionario_salvar($1,'ESQUADRIAS - PORTAS','x',true)`, [NOVO.id]); ok(/Já existe/.test(r.error || ''), 'não cria duas equivalências para o mesmo serviço');
r = await as(U.adm, `select public.relatorio_dicionario_salvar($1,'IMPERMEABILIZAÇÃO - BOX','Impermeabilização',false) j`, [NOVO.id]); ok(r.rows[0]?.j.ativo === false, 'desativar em vez de apagar');
r = await as(U.adm, `delete from relatorio_servicos_dicionario where id=$1`, [NOVO.id]); ok(!!r.error, 'sem exclusão direta');
r = await as(U.adm, `select public.relatorio_dicionario_salvar(null,'X','',true)`); ok(!!r.error, 'validação dos campos');
console.log(fail ? `\n${fail} falha(s)` : '\nTodos os testes de conversão passaram.');
await db.end(); process.exit(fail ? 1 : 0);
