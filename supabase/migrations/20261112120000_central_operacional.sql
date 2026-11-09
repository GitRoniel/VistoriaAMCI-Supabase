-- Central Operacional (Resumo Geral): Agenda Operacional unificada, Visão de Produtividade e
-- Central de Unidades, para todos os condomínios.
--
-- Só leitura. Nada aqui grava, apaga ou altera dados, status ou regras de transição.
--   · Funções SECURITY INVOKER: o RLS de cada tabela vale como hoje (cada pessoa vê só os condomínios
--     de que é membro). Indicadores são calculados no banco (consultas agregadas) e não no navegador.
--   · Única exceção: private.central_hist_vistoria (SECURITY DEFINER). O audit_log é legível só por
--     administradores; esta função devolve a membros do condomínio apenas a evolução de status, data,
--     horário e responsável da vistoria da unidade (o que eles já veem hoje, só que com o histórico).
--   · Pendências = apontamentos do checklist dos relatórios ativos da unidade, sem repetidos (mesma regra
--     de M.checklistUnidade no site: mesmo texto, sem diferença de maiúsculas, acentos ou espaços; vale a
--     cópia do relatório mais recente). Nenhum total é guardado: tudo é calculado dos registros originais.
-- Reverter: drop das funções/view/índices abaixo (não há dados novos).

-- ── Índices (consultas por data e linha do tempo da unidade) ──────────────────
create index if not exists audit_log_registro_idx on public.audit_log (table_name, record_id, id);
create index if not exists client_inspections_data_idx on public.client_inspections (inspection_date) where inspection_date is not null;
create index if not exists revistorias_data_idx on public.revistorias (data) where data is not null;
create index if not exists revistorias_apontamentos_relatorio_idx on public.revistorias_apontamentos (relatorio_id);

-- ── Pendências: chave de comparação e checklist sem repetidos ────────────────
create or replace function private.ap_chave(p_texto text)
returns text language sql immutable set search_path = '' as $$
  select btrim(regexp_replace(translate(lower(coalesce(p_texto, '')),
    'áàâãäåéèêëíìîïóòôõöúùûüçñý', 'aaaaaaeeeeiiiiooooouuuucny'), '\s+', ' ', 'g'))
$$;
grant execute on function private.ap_chave(text) to authenticated;

-- Data em que a pendência foi identificada: "Realizado" lido do PDF ou, sem ele, o envio do relatório.
create or replace function private.central_data_rel(p_resumo jsonb, p_enviado timestamptz)
returns date language sql immutable set search_path = '' as $$
  select coalesce(case when coalesce(p_resumo ->> 'realizado', '') ~ '^\d{4}-\d{2}-\d{2}$' then (p_resumo ->> 'realizado')::date end,
                  (p_enviado at time zone 'America/Sao_Paulo')::date)
$$;
grant execute on function private.central_data_rel(jsonb, timestamptz) to authenticated;

create or replace view public.central_checklist with (security_invoker = true) as
select distinct on (a.unit_id, private.ap_chave(a.texto))
       a.id, a.project_id, a.unit_id, a.relatorio_id, a.ordem, a.texto, a.concluido, a.concluido_em, a.concluido_email, a.criado_em,
       r.enviado_em, private.central_data_rel(r.resumo, r.enviado_em) as identificado_em, nullif(btrim(r.resumo ->> 'responsavel'), '') as identificado_por
  from public.revistorias_apontamentos a
  join public.revistorias_relatorios r on r.id = a.relatorio_id and r.removido_em is null
 where private.ap_chave(a.texto) <> ''
 order by a.unit_id, private.ap_chave(a.texto), r.enviado_em desc, a.relatorio_id desc, a.ordem desc, a.id desc;
comment on view public.central_checklist is
  'Checklist da unidade sem repetidos (relatórios ativos; vale a cópia mais recente). Base dos quantitativos de pendências da Lista, do relatório e da Central Operacional.';
grant select on public.central_checklist to authenticated;

-- Código da unidade como aparece na tela (A · 103, T03; casas = número).
create or replace function private.central_codigo(p_kind text, p_pav text, p_apto text)
returns text language sql immutable set search_path = '' as $$
  select case when p_kind = 'casa' then coalesce(nullif(ltrim(p_apto, '0'), ''), '0')
              else (case when upper(btrim(p_pav)) in ('T', 'TÉRREO', 'TERREO') then 'T' else regexp_replace(p_pav, '\D', '', 'g') end) || p_apto end
$$;
grant execute on function private.central_codigo(text, text, text) to authenticated;

-- ── 1) Agenda Operacional ───────────────────────────────────────────────────
-- Vistorias (client_inspections: data/horário da vistoria) e revistorias (cada agendamento) no período,
-- sem duplicar: cada atividade aparece uma vez, com o seu tipo e o registro de origem (ref_id).
create or replace function public.central_agenda(p_de date, p_ate date, p_projetos bigint[] default null)
returns table (
  tipo text, ref_id bigint, project_id bigint, unit_id bigint, bloco text, pav text, apto text, unidade_tipo text, codigo text,
  cliente text, data date, horario text, responsavel text, status text, numero smallint, ciclo smallint,
  status_vistoria text, status_revistoria text, realizada_em date, aps_total int, aps_resolvidas int)
language sql stable security invoker set search_path = '' as $$
  with ativ as (
    select 'vistoria'::text as tipo, ci.id as ref_id, u.project_id, u.id as unit_id, u.bloco, u.pav, u.apto, u.kind,
           ci.client_name as cliente, ci.inspection_date as data, left(ci.inspection_time::text, 5) as horario,
           nullif(btrim(ci.responsible), '') as responsavel, ci.status, null::smallint as numero, null::smallint as ciclo,
           ci.status as status_vistoria, rc.status as status_revistoria, null::date as realizada_em
      from public.client_inspections ci
      join public.units u on u.id = ci.unit_id
      left join public.revistorias_cliente rc on rc.unit_id = u.id
     where ci.inspection_date between p_de and p_ate
       and (p_projetos is null or u.project_id = any (p_projetos))
    union all
    select 'revistoria', rv.id, u.project_id, u.id, u.bloco, u.pav, u.apto, u.kind,
           ci.client_name, rv.data, left(rv.horario::text, 5), nullif(btrim(rv.responsavel), ''), rv.status, rv.numero, rv.ciclo,
           ci.status, rc.status, rv.realizada_em
      from public.revistorias rv
      join public.units u on u.id = rv.unit_id
      left join public.client_inspections ci on ci.unit_id = u.id
      left join public.revistorias_cliente rc on rc.unit_id = u.id
     where rv.data between p_de and p_ate
       and (p_projetos is null or u.project_id = any (p_projetos))
  )
  select a.tipo, a.ref_id, a.project_id, a.unit_id, a.bloco, a.pav, a.apto, a.kind, private.central_codigo(a.kind, a.pav, a.apto),
         a.cliente, a.data, a.horario, a.responsavel, a.status, a.numero, a.ciclo, a.status_vistoria, a.status_revistoria, a.realizada_em,
         coalesce(ck.total, 0), coalesce(ck.resolvidas, 0)
    from ativ a
    left join lateral (select count(*)::int as total, count(*) filter (where c.concluido)::int as resolvidas
                         from public.central_checklist c where c.unit_id = a.unit_id) ck on true
   order by a.data, a.horario nulls last, a.project_id, a.bloco, a.pav, a.apto, a.tipo desc
$$;

-- Primeira e última data com atividade (para a rolagem saber até onde carregar).
create or replace function public.central_agenda_limites(p_projetos bigint[] default null)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object('min', least(v.mn, r.mn), 'max', greatest(v.mx, r.mx), 'hoje', (now() at time zone 'America/Sao_Paulo')::date)
    from (select min(ci.inspection_date) mn, max(ci.inspection_date) mx from public.client_inspections ci join public.units u on u.id = ci.unit_id
           where p_projetos is null or u.project_id = any (p_projetos)) v,
         (select min(rv.data) mn, max(rv.data) mx from public.revistorias rv
           where p_projetos is null or rv.project_id = any (p_projetos)) r
$$;

-- ── 2) Visão de Produtividade ───────────────────────────────────────────────
-- Regras (as mesmas do Resumo Geral e da Estatística Geral):
--   vistoriada = status Aprovado, Revistoria ou Revistoria Finalizada (1 registro por unidade: unidades únicas);
--   aprovada na 1ª vistoria = Aprovado; aprovada após revistoria = Revistoria Finalizada;
--   vistoria realizada no período = data da vistoria no período e unidade vistoriada;
--   revistoria realizada = agendamento Aprovada ou Reprovada, na data de realização (ou na data agendada);
--   atrasada = agendada para antes de hoje e ainda sem resultado (vistoria Agendado/Remarcado; revistoria
--   Agendada/Em revistoria).
-- Parâmetros de atenção (gargalos) vêm da tela e são configuráveis; não são regras do banco.
create or replace function public.central_produtividade(p_de date, p_ate date, p_projetos bigint[] default null,
  p_grao text default 'semana', p_dias_espera int default 15, p_dias_sem_atualizacao int default 30,
  p_dias_pendencia int default 30, p_min_pendencias int default 10)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_len int := greatest(1, p_ate - p_de + 1);
  v_ant_de date := p_de - greatest(1, p_ate - p_de + 1);
  v_ant_ate date := p_de - 1;
  v_grao text := case p_grao when 'dia' then 'day' when 'mes' then 'month' else 'week' end;
  v_res jsonb;
begin
  if p_de is null or p_ate is null or p_ate < p_de then raise exception 'Período inválido'; end if;
  if p_ate - p_de > 1100 then raise exception 'Período longo demais (máximo de 3 anos)'; end if;

  with
  un as (
    select u.id as unit_id, u.project_id, u.bloco, u.pav, u.apto, u.kind, ci.status, ci.inspection_date,
           nullif(btrim(ci.responsible), '') as resp, ci.client_name, ci.updated_at, rc.status as rc_status, rc.entrou_em, rc.atualizado_em as rc_atualizado
      from public.units u
      left join public.client_inspections ci on ci.unit_id = u.id
      left join public.revistorias_cliente rc on rc.unit_id = u.id
     where p_projetos is null or u.project_id = any (p_projetos)
  ),
  rv as (
    select x.*, coalesce(x.realizada_em, x.data) as feita_em
      from public.revistorias x join un on un.unit_id = x.unit_id
  ),
  ck as (select c.* from public.central_checklist c join un on un.unit_id = c.unit_id),
  ckun as (select unit_id, count(*) as t, count(*) filter (where concluido) as r from ck group by unit_id),
  vist as (select * from un where status in ('Aprovado', 'Revistoria', 'Revistoria Finalizada')),
  -- atividades do período (vistorias pela data da vistoria; revistorias canceladas não contam)
  per_v as (select * from un where inspection_date between p_de and p_ate),
  per_r as (select * from rv where data between p_de and p_ate and status is distinct from 'Cancelada'),
  geral as (
    select jsonb_build_object(
      'unidades', (select count(*) from un),
      'vistoriadas', (select count(*) from vist),
      'aprovadas_1a', (select count(*) from un where status = 'Aprovado'),
      'em_revistoria', (select count(*) from un where status = 'Revistoria'),
      'rev_finalizadas', (select count(*) from un where status = 'Revistoria Finalizada'),
      'aguardando_vistoria', (select count(*) from un where status in ('Agendado', 'Remarcado')),
      'nao_agendadas', (select count(*) from un where coalesce(status, 'Não agendado') = 'Não agendado'),
      'processo', (select count(*) from un where status = 'Inadimplência'),
      'rc_em_andamento', (select count(*) from un where rc_status = 'Em andamento'),
      'rc_agendado', (select count(*) from un where rc_status = 'Agendado'),
      'rc_aprovado', (select count(*) from un where rc_status = 'Aprovado'),
      'pend_total', (select count(*) from ck),
      'pend_resolvidas', (select count(*) from ck where concluido),
      'unidades_com_pend', (select count(*) from ckun),
      'unidades_pend_abertas', (select count(*) from ckun where t > r)
    ) as j
  ),
  periodo as (
    select jsonb_build_object(
      'vist_agendadas', (select count(*) from per_v where coalesce(status, 'Não agendado') <> 'Não agendado'),
      'vist_realizadas', (select count(*) from per_v where status in ('Aprovado', 'Revistoria', 'Revistoria Finalizada')),
      'vist_aprovadas', (select count(*) from per_v where status = 'Aprovado'),
      'vist_atrasadas', (select count(*) from per_v where status in ('Agendado', 'Remarcado') and inspection_date < v_hoje),
      'rev_agendadas', (select count(*) from per_r),
      'rev_realizadas', (select count(*) from rv where status in ('Aprovada', 'Reprovada') and feita_em between p_de and p_ate),
      'rev_unidades', (select count(distinct unit_id) from rv where status in ('Aprovada', 'Reprovada') and feita_em between p_de and p_ate),
      'rev_aprovadas', (select count(*) from rv where status = 'Aprovada' and feita_em between p_de and p_ate),
      'rev_reprovadas', (select count(*) from rv where status = 'Reprovada' and feita_em between p_de and p_ate),
      'rev_atrasadas', (select count(*) from per_r where status in ('Agendada', 'Em revistoria') and data < v_hoje),
      'pend_identificadas', (select count(*) from ck where identificado_em between p_de and p_ate),
      'pend_resolvidas', (select count(*) from ck where concluido and (concluido_em at time zone 'America/Sao_Paulo')::date between p_de and p_ate),
      'ant_vist_realizadas', (select count(*) from un where inspection_date between v_ant_de and v_ant_ate and status in ('Aprovado', 'Revistoria', 'Revistoria Finalizada')),
      'ant_rev_realizadas', (select count(*) from rv where status in ('Aprovada', 'Reprovada') and feita_em between v_ant_de and v_ant_ate),
      'ant_pend_resolvidas', (select count(*) from ck where concluido and (concluido_em at time zone 'America/Sao_Paulo')::date between v_ant_de and v_ant_ate)
    ) as j
  ),
  baldes as (
    select g::date as ini from generate_series(date_trunc(v_grao, p_de::timestamp), p_ate::timestamp, ('1 ' || v_grao)::interval) g
  ),
  serie as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'ini', b.ini,
      'vistorias', (select count(*) from un where status in ('Aprovado', 'Revistoria', 'Revistoria Finalizada') and inspection_date between greatest(b.ini, p_de) and least((b.ini + ('1 ' || v_grao)::interval - interval '1 day')::date, p_ate)),
      'vist_aprovadas', (select count(*) from un where status = 'Aprovado' and inspection_date between greatest(b.ini, p_de) and least((b.ini + ('1 ' || v_grao)::interval - interval '1 day')::date, p_ate)),
      'revistorias', (select count(*) from rv where status in ('Aprovada', 'Reprovada') and feita_em between greatest(b.ini, p_de) and least((b.ini + ('1 ' || v_grao)::interval - interval '1 day')::date, p_ate)),
      'rev_aprovadas', (select count(*) from rv where status = 'Aprovada' and feita_em between greatest(b.ini, p_de) and least((b.ini + ('1 ' || v_grao)::interval - interval '1 day')::date, p_ate)),
      'pend_identificadas', (select count(*) from ck where identificado_em between greatest(b.ini, p_de) and least((b.ini + ('1 ' || v_grao)::interval - interval '1 day')::date, p_ate)),
      'pend_resolvidas', (select count(*) from ck where concluido and (concluido_em at time zone 'America/Sao_Paulo')::date between greatest(b.ini, p_de) and least((b.ini + ('1 ' || v_grao)::interval - interval '1 day')::date, p_ate))
    ) order by b.ini), '[]'::jsonb) as j from baldes b
  ),
  -- Por vistoriador: vistorias pelo Responsável da vistoria; revistorias pelo responsável do agendamento
  -- realizado (nomes comparados sem diferença de maiúsculas/espaços). Pendências: apontamentos do checklist
  -- das unidades que a pessoa vistoriou no período (identificadas na vistoria dela).
  pv as (
    select lower(btrim(resp)) as k, min(resp) as nome, count(*) as vistorias,
           count(*) filter (where status = 'Aprovado') as aprovadas,
           count(*) filter (where status in ('Revistoria', 'Revistoria Finalizada')) as reprovadas,
           coalesce(sum(ckun.t), 0) as pendencias, count(ckun.unit_id) as unidades_com_pend
      from un left join ckun on ckun.unit_id = un.unit_id
     where status in ('Aprovado', 'Revistoria', 'Revistoria Finalizada') and inspection_date between p_de and p_ate and resp is not null
     group by 1
  ),
  pva as (
    select lower(btrim(resp)) as k, count(*) as vistorias from un
     where status in ('Aprovado', 'Revistoria', 'Revistoria Finalizada') and inspection_date between v_ant_de and v_ant_ate and resp is not null group by 1
  ),
  pr as (
    select lower(btrim(responsavel)) as k, min(btrim(responsavel)) as nome, count(*) as revistorias,
           count(*) filter (where status = 'Aprovada') as rev_aprovadas, count(*) filter (where status = 'Reprovada') as rev_reprovadas
      from rv where status in ('Aprovada', 'Reprovada') and feita_em between p_de and p_ate and nullif(btrim(responsavel), '') is not null
     group by 1
  ),
  pra as (
    select lower(btrim(responsavel)) as k, count(*) as revistorias from rv
     where status in ('Aprovada', 'Reprovada') and feita_em between v_ant_de and v_ant_ate and nullif(btrim(responsavel), '') is not null group by 1
  ),
  pessoas as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'nome', coalesce(pv.nome, pr.nome), 'vistorias', coalesce(pv.vistorias, 0), 'aprovadas', coalesce(pv.aprovadas, 0),
      'reprovadas', coalesce(pv.reprovadas, 0), 'pendencias', coalesce(pv.pendencias, 0), 'unidades_com_pend', coalesce(pv.unidades_com_pend, 0),
      'revistorias', coalesce(pr.revistorias, 0), 'rev_aprovadas', coalesce(pr.rev_aprovadas, 0), 'rev_reprovadas', coalesce(pr.rev_reprovadas, 0),
      'ant_vistorias', coalesce(pva.vistorias, 0), 'ant_revistorias', coalesce(pra.revistorias, 0)
    ) order by coalesce(pv.vistorias, 0) + coalesce(pr.revistorias, 0) desc, coalesce(pv.nome, pr.nome)), '[]'::jsonb) as j
      from pv full join pr on pr.k = pv.k
      left join pva on pva.k = coalesce(pv.k, pr.k)
      left join pra on pra.k = coalesce(pv.k, pr.k)
  ),
  conds as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'project_id', p.project_id, 'unidades', p.unidades, 'vistoriadas', p.vistoriadas, 'aprovadas_1a', p.aprovadas_1a,
      'em_revistoria', p.em_revistoria, 'rev_finalizadas', p.rev_finalizadas, 'aguardando_vistoria', p.aguardando,
      'pend_total', coalesce(c.t, 0), 'pend_resolvidas', coalesce(c.r, 0),
      'vist_realizadas', p.vist_per, 'rev_realizadas', coalesce(rp.n, 0)
    ) order by p.project_id), '[]'::jsonb) as j
      from (select project_id, count(*) as unidades,
                   count(*) filter (where status in ('Aprovado', 'Revistoria', 'Revistoria Finalizada')) as vistoriadas,
                   count(*) filter (where status = 'Aprovado') as aprovadas_1a,
                   count(*) filter (where status = 'Revistoria') as em_revistoria,
                   count(*) filter (where status = 'Revistoria Finalizada') as rev_finalizadas,
                   count(*) filter (where status in ('Agendado', 'Remarcado')) as aguardando,
                   count(*) filter (where status in ('Aprovado', 'Revistoria', 'Revistoria Finalizada') and inspection_date between p_de and p_ate) as vist_per
              from un group by project_id) p
      left join (select project_id, count(*) as t, count(*) filter (where concluido) as r from ck group by project_id) c on c.project_id = p.project_id
      left join (select project_id, count(*) as n from rv where status in ('Aprovada', 'Reprovada') and feita_em between p_de and p_ate group by project_id) rp on rp.project_id = p.project_id
  ),
  -- ── Atenção (gargalos), sempre na situação atual ──
  ult_rev as (select unit_id, max(feita_em) filter (where status in ('Aprovada', 'Reprovada')) as ultima,
                     count(*) filter (where status = 'Reprovada') as reprovacoes,
                     bool_or(status in ('Agendada', 'Em revistoria')) as aberta
                from rv group by unit_id),
  aguard as (
    select un.*, v_hoje - coalesce(ur.ultima, (un.entrou_em at time zone 'America/Sao_Paulo')::date) as dias
      from un left join ult_rev ur on ur.unit_id = un.unit_id
     where un.rc_status = 'Em andamento' and not coalesce(ur.aberta, false)
  ),
  ultima_mov as (
    select un.*, greatest(un.updated_at, un.rc_atualizado,
             (select max(e.registrado_em) from public.revistorias_eventos e where e.unit_id = un.unit_id),
             (select max(c.concluido_em) from ck c where c.unit_id = un.unit_id)) as ult
      from un where un.status in ('Agendado', 'Remarcado', 'Revistoria', 'Inadimplência')
  ),
  atencao as (
    select jsonb_build_object(
      'aguardando_revistoria', jsonb_build_object('total', (select count(*) from aguard where dias >= p_dias_espera),
        'itens', (select coalesce(jsonb_agg(jsonb_build_object('unit_id', unit_id, 'project_id', project_id, 'bloco', bloco, 'pav', pav, 'apto', apto, 'kind', kind,
                  'codigo', private.central_codigo(kind, pav, apto), 'cliente', client_name, 'valor', dias) order by dias desc), '[]'::jsonb)
                  from (select * from aguard where dias >= p_dias_espera order by dias desc limit 30) s)),
      'muitas_pendencias', jsonb_build_object('total', (select count(*) from ckun where t - r >= p_min_pendencias),
        'itens', (select coalesce(jsonb_agg(jsonb_build_object('unit_id', un.unit_id, 'project_id', un.project_id, 'bloco', un.bloco, 'pav', un.pav, 'apto', un.apto, 'kind', un.kind,
                  'codigo', private.central_codigo(un.kind, un.pav, un.apto), 'cliente', un.client_name, 'valor', s.abertas, 'extra', s.t) order by s.abertas desc), '[]'::jsonb)
                  from (select unit_id, t, t - r as abertas from ckun where t - r >= p_min_pendencias order by t - r desc limit 30) s join un on un.unit_id = s.unit_id)),
      'reincidentes', jsonb_build_object('total', (select count(*) from ult_rev where reprovacoes >= 2),
        'itens', (select coalesce(jsonb_agg(jsonb_build_object('unit_id', un.unit_id, 'project_id', un.project_id, 'bloco', un.bloco, 'pav', un.pav, 'apto', un.apto, 'kind', un.kind,
                  'codigo', private.central_codigo(un.kind, un.pav, un.apto), 'cliente', un.client_name, 'valor', s.reprovacoes) order by s.reprovacoes desc), '[]'::jsonb)
                  from (select unit_id, reprovacoes from ult_rev where reprovacoes >= 2 order by reprovacoes desc limit 30) s join un on un.unit_id = s.unit_id)),
      'atrasadas', jsonb_build_object('total',
          (select count(*) from un where status in ('Agendado', 'Remarcado') and inspection_date < v_hoje)
          + (select count(*) from rv where status in ('Agendada', 'Em revistoria') and data < v_hoje),
        'itens', (select coalesce(jsonb_agg(x order by x ->> 'data'), '[]'::jsonb) from (
            select jsonb_build_object('unit_id', unit_id, 'project_id', project_id, 'bloco', bloco, 'pav', pav, 'apto', apto, 'kind', kind,
                   'codigo', private.central_codigo(kind, pav, apto), 'cliente', client_name, 'tipo', 'vistoria', 'data', inspection_date, 'valor', v_hoje - inspection_date) as x
              from un where status in ('Agendado', 'Remarcado') and inspection_date < v_hoje
            union all
            select jsonb_build_object('unit_id', un.unit_id, 'project_id', un.project_id, 'bloco', un.bloco, 'pav', un.pav, 'apto', un.apto, 'kind', un.kind,
                   'codigo', private.central_codigo(un.kind, un.pav, un.apto), 'cliente', un.client_name, 'tipo', 'revistoria', 'data', rv.data, 'valor', v_hoje - rv.data)
              from rv join un on un.unit_id = rv.unit_id where rv.status in ('Agendada', 'Em revistoria') and rv.data < v_hoje
            limit 60) s)),
      'sem_atualizacao', jsonb_build_object('total', (select count(*) from ultima_mov where ult < now() - make_interval(days => p_dias_sem_atualizacao)),
        'itens', (select coalesce(jsonb_agg(jsonb_build_object('unit_id', unit_id, 'project_id', project_id, 'bloco', bloco, 'pav', pav, 'apto', apto, 'kind', kind,
                  'codigo', private.central_codigo(kind, pav, apto), 'cliente', client_name, 'valor', v_hoje - (ult at time zone 'America/Sao_Paulo')::date, 'extra', status) order by ult), '[]'::jsonb)
                  from (select * from ultima_mov where ult < now() - make_interval(days => p_dias_sem_atualizacao) order by ult limit 30) s)),
      'pendencias_antigas', jsonb_build_object('total', (select count(*) from ck where not concluido and identificado_em <= v_hoje - p_dias_pendencia),
        'unidades', (select count(distinct unit_id) from ck where not concluido and identificado_em <= v_hoje - p_dias_pendencia),
        'itens', (select coalesce(jsonb_agg(jsonb_build_object('unit_id', un.unit_id, 'project_id', un.project_id, 'bloco', un.bloco, 'pav', un.pav, 'apto', un.apto, 'kind', un.kind,
                  'codigo', private.central_codigo(un.kind, un.pav, un.apto), 'cliente', un.client_name, 'valor', s.dias, 'extra', s.n) order by s.dias desc), '[]'::jsonb)
                  from (select unit_id, count(*) as n, v_hoje - min(identificado_em) as dias from ck where not concluido and identificado_em <= v_hoje - p_dias_pendencia
                         group by unit_id order by 3 desc limit 30) s join un on un.unit_id = s.unit_id))
    ) as j
  )
  select jsonb_build_object(
    'periodo', jsonb_build_object('de', p_de, 'ate', p_ate, 'dias', v_len, 'ant_de', v_ant_de, 'ant_ate', v_ant_ate, 'grao', coalesce(p_grao, 'semana'), 'hoje', v_hoje),
    'parametros', jsonb_build_object('dias_espera', p_dias_espera, 'dias_sem_atualizacao', p_dias_sem_atualizacao, 'dias_pendencia', p_dias_pendencia, 'min_pendencias', p_min_pendencias),
    'geral', (select j from geral), 'no_periodo', (select j from periodo), 'serie', (select j from serie),
    'vistoriadores', (select j from pessoas), 'condominios', (select j from conds), 'atencao', (select j from atencao))
    into v_res;
  return v_res;
end $$;

-- ── 3) Central de Unidades ──────────────────────────────────────────────────
-- Histórico de campos da vistoria (status, data, horário, responsável) a partir do audit_log, para quem
-- é membro do condomínio da unidade. Não devolve nenhum outro campo do registro auditado.
create or replace function private.central_hist_vistoria(p_unit_id bigint)
returns table (registrado_em timestamptz, registrado_email text, origem text, status_anterior text, status_novo text,
  data_anterior date, data_nova date, horario_anterior text, horario_novo text, responsavel_anterior text, responsavel_novo text)
language sql stable security definer set search_path = '' as $$
  select a.created_at, a.actor_email, nullif(a.new_data ->> 'updated_source', ''),
         a.old_data ->> 'status', a.new_data ->> 'status',
         nullif(a.old_data ->> 'inspection_date', '')::date, nullif(a.new_data ->> 'inspection_date', '')::date,
         left(a.old_data ->> 'inspection_time', 5), left(a.new_data ->> 'inspection_time', 5),
         nullif(btrim(a.old_data ->> 'responsible'), ''), nullif(btrim(a.new_data ->> 'responsible'), '')
    from public.client_inspections ci
    join public.audit_log a on a.table_name = 'client_inspections' and a.record_id = ci.id
   where ci.unit_id = p_unit_id
     and private.project_role(private.unit_project_id(p_unit_id)) is not null
     and ((a.old_data ->> 'status') is distinct from (a.new_data ->> 'status')
       or (a.old_data ->> 'inspection_date') is distinct from (a.new_data ->> 'inspection_date')
       or (a.old_data ->> 'inspection_time') is distinct from (a.new_data ->> 'inspection_time')
       or nullif(btrim(a.old_data ->> 'responsible'), '') is distinct from nullif(btrim(a.new_data ->> 'responsible'), ''))
   order by a.id
$$;
revoke all on function private.central_hist_vistoria(bigint) from public, anon;
grant execute on function private.central_hist_vistoria(bigint) to authenticated;

-- Tudo da unidade numa chamada (somente os registros dela). null = unidade inexistente ou sem acesso.
create or replace function public.central_unidade(p_unit_id bigint)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select case when u.id is null then null else jsonb_build_object(
    'unidade', jsonb_build_object('id', u.id, 'project_id', u.project_id, 'projeto', p.name, 'bloco', u.bloco, 'pav', u.pav, 'apto', u.apto,
                                  'kind', u.kind, 'pcd', u.pcd, 'codigo', private.central_codigo(u.kind, u.pav, u.apto)),
    'vistoria', (select to_jsonb(x) from (select ci.id, ci.status, ci.client_name, ci.inspection_date, left(ci.inspection_time::text, 5) as inspection_time,
                   ci.responsible, ci.reinspection_date, ci.reinspection_responsible, ci.notes, ci.sale_stage, ci.technical_escort,
                   ci.updated_at, ci.updated_source from public.client_inspections ci where ci.unit_id = u.id) x),
    'revistoria', (select to_jsonb(rc) from public.revistorias_cliente rc where rc.unit_id = u.id),
    'agendamentos', (select coalesce(jsonb_agg(to_jsonb(rv) order by rv.numero), '[]'::jsonb) from public.revistorias rv where rv.unit_id = u.id),
    'eventos', (select coalesce(jsonb_agg(to_jsonb(e) order by e.registrado_em, e.id), '[]'::jsonb) from public.revistorias_eventos e where e.unit_id = u.id),
    'reagendamentos', (select coalesce(jsonb_agg(to_jsonb(g) order by g.registrado_em), '[]'::jsonb) from public.vistorias_reagendamentos g where g.unit_id = u.id),
    'historico_vistoria', (select coalesce(jsonb_agg(to_jsonb(h) order by h.registrado_em), '[]'::jsonb) from private.central_hist_vistoria(u.id) h),
    'relatorios', (select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'caminho', r.caminho, 'nome_arquivo', r.nome_arquivo, 'tamanho', r.tamanho,
                    'paginas', r.paginas, 'resumo', r.resumo, 'enviado_em', r.enviado_em, 'enviado_email', r.enviado_email,
                    'removido_em', r.removido_em, 'identificado_em', private.central_data_rel(r.resumo, r.enviado_em)) order by r.enviado_em), '[]'::jsonb)
                    from public.revistorias_relatorios r where r.unit_id = u.id),
    'apontamentos', (select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'relatorio_id', a.relatorio_id, 'ordem', a.ordem, 'texto', a.texto,
                    'concluido', a.concluido, 'concluido_em', a.concluido_em, 'concluido_email', a.concluido_email, 'criado_em', a.criado_em,
                    'chave', private.ap_chave(a.texto)) order by a.relatorio_id, a.ordem, a.id), '[]'::jsonb)
                    from public.revistorias_apontamentos a where a.unit_id = u.id),
    'checklist', (select coalesce(jsonb_agg(c.id), '[]'::jsonb) from public.central_checklist c where c.unit_id = u.id)
  ) end
  from (select 1) d
  left join public.units u on u.id = p_unit_id
  left join public.projects p on p.id = u.project_id
$$;

-- Pesquisa global de unidades (condomínio, bloco, apartamento ou cliente), só nos condomínios do usuário.
create or replace function public.central_buscar(p_q text, p_projetos bigint[] default null, p_limite int default 30)
returns table (unit_id bigint, project_id bigint, projeto text, bloco text, pav text, apto text, unidade_tipo text, codigo text,
  cliente text, status_vistoria text, status_revistoria text, aps_total int, aps_resolvidas int, relevancia int)
language sql stable security invoker set search_path = '' as $$
  with q as (
    select btrim(coalesce(p_q, '')) as txt,
           upper(regexp_replace(coalesce(p_q, ''), '[\s·\-_/.]+', '', 'g')) as cod,
           upper(regexp_replace(regexp_replace(coalesce(p_q, ''), '(?i)\m(bloco|bl|apto|apt|ap|casa|conj|conjunto|unidade)\M', '', 'g'), '[\s·\-_/.]+', '', 'g')) as cod2
  ),
  base as (
    select u.id, u.project_id, p.name as projeto, u.bloco, u.pav, u.apto, u.kind, private.central_codigo(u.kind, u.pav, u.apto) as codigo,
           ci.client_name, ci.status, rc.status as rc_status
      from public.units u
      join public.projects p on p.id = u.project_id
      left join public.client_inspections ci on ci.unit_id = u.id
      left join public.revistorias_cliente rc on rc.unit_id = u.id
     where p.archived_at is null and (p_projetos is null or u.project_id = any (p_projetos))
  ),
  m as (
    select b.*, case
             when upper(b.bloco || b.codigo) in (q.cod, q.cod2) then 100
             when upper(b.codigo) in (q.cod, q.cod2) then 90
             when upper(b.bloco || b.codigo) like q.cod2 || '%' and length(q.cod2) >= 2 then 70
             when upper(b.codigo) like q.cod2 || '%' and length(q.cod2) >= 2 then 60
             when length(q.txt) >= 3 and private.ap_chave(b.client_name) like '%' || private.ap_chave(q.txt) || '%' then 50
             when length(q.txt) >= 3 and private.ap_chave(b.projeto) like '%' || private.ap_chave(q.txt) || '%' then 10
             else 0 end as rel
      from base b, q
     where length(q.txt) >= 1
  )
  select m.id, m.project_id, m.projeto, m.bloco, m.pav, m.apto, m.kind, m.codigo, m.client_name, m.status, m.rc_status,
         coalesce(ck.total, 0), coalesce(ck.resolvidas, 0), m.rel
    from m
    left join lateral (select count(*)::int as total, count(*) filter (where c.concluido)::int as resolvidas
                         from public.central_checklist c where c.unit_id = m.id) ck on true
   where m.rel > 0
   order by m.rel desc, m.projeto, m.bloco, m.pav, m.apto
   limit least(greatest(coalesce(p_limite, 30), 1), 100)
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'public.central_agenda(date, date, bigint[])',
    'public.central_agenda_limites(bigint[])',
    'public.central_produtividade(date, date, bigint[], text, int, int, int, int)',
    'public.central_unidade(bigint)',
    'public.central_buscar(text, bigint[], int)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
