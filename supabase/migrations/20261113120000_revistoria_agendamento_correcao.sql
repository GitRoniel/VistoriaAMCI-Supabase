-- Revistoria · Cliente: correção de agendamentos pelo ADMINISTRADOR do condomínio.
--
-- Motivo: um mesmo agendamento pode ficar registrado duas vezes (ex.: a vistoria voltou de Revistoria
-- Finalizada para Revistoria só para corrigir o horário e foi finalizada de novo: o sistema abriu um novo
-- ciclo e criou outro agendamento igual). Agora o administrador pode:
--   • corrigir data, horário, responsável e data da realização de um agendamento (revistoria_agendamento_corrigir);
--   • anular um agendamento lançado em duplicidade (revistoria_agendamento_anular).
-- Nada é apagado: o agendamento anulado continua na tabela (status Cancelada + anulado_em/por/motivo), sai das
-- contagens e das listas, e cada correção fica no histórico imutável (revistorias_eventos, tipo 'correcao') com o
-- antes e o depois. Só aditiva: 3 colunas novas, 1 tipo de evento, 2 funções; o restante não muda.
-- Segurança: SECURITY DEFINER com checagem de papel (private.project_role = 'admin'); tabelas continuam sem
-- escrita direta (RLS e grants inalterados).

-- ── 1) Agendamento anulado ───────────────────────────────────────────────────
alter table public.revistorias
  add column if not exists anulado_em timestamptz,
  add column if not exists anulado_email text not null default '',
  add column if not exists anulado_motivo text not null default '';
alter table public.revistorias drop constraint if exists revistorias_anulado_check;
alter table public.revistorias add constraint revistorias_anulado_check
  check (char_length(anulado_motivo) <= 500 and char_length(anulado_email) <= 320 and (anulado_em is null or status = 'Cancelada'));
comment on column public.revistorias.anulado_em is
  'Agendamento anulado pelo administrador (registro em duplicidade ou lançado por engano). Fica com status Cancelada, não conta como revistoria realizada e não aparece nas listas; o motivo e o status original ficam no histórico.';

-- ── 2) Tipo de evento "correcao" no histórico ────────────────────────────────
alter table public.revistorias_eventos drop constraint if exists revistorias_eventos_tipo_check;
alter table public.revistorias_eventos add constraint revistorias_eventos_tipo_check
  check (tipo in ('entrada', 'agendamento', 'remarcacao', 'cancelamento', 'resultado', 'reabertura', 'vistoria', 'planilha',
                  'liberacao', 'execucao', 'relatorio', 'correcao'));

-- Agendamento travado + conferência: administrador do condomínio e agendamento não anulado.
create or replace function private.revcli_agendamento_admin(p_revistoria_id bigint)
returns public.revistorias language plpgsql security definer set search_path = '' as $$
declare v public.revistorias;
begin
  select * into v from public.revistorias where id = p_revistoria_id;
  if not found then raise exception 'Agendamento não encontrado'; end if;
  perform 1 from public.units where id = v.unit_id for no key update;   -- uma alteração por unidade de cada vez
  if coalesce(private.project_role(v.project_id), '') <> 'admin' then
    raise exception 'Só administradores do condomínio podem corrigir agendamentos' using errcode = '42501';
  end if;
  select * into v from public.revistorias where id = p_revistoria_id for update;
  if v.anulado_em is not null then raise exception 'Este agendamento já foi anulado'; end if;
  return v;
end $$;
revoke all on function private.revcli_agendamento_admin(bigint) from public, anon, authenticated;

-- ── 3) Corrigir data, horário, responsável e data da realização ──────────────
-- O status não muda (para isso continuam Remarcar, Cancelar, Registrar resultado e Reabrir).
create or replace function public.revistoria_agendamento_corrigir(p_revistoria_id bigint, p_data date, p_horario text,
  p_responsavel text, p_realizada_em date, p_motivo text, p_pedido uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v public.revistorias; n public.revistorias; a public.revistorias_cliente; r jsonb; v_hor time; v_resp text; v_mot text;
  v_real date; v_hoje date := private.revcli_hoje(); v_mud text[] := '{}';
begin
  r := private.revcli_repetido(p_pedido); if r is not null then return r; end if;
  v := private.revcli_agendamento_admin(p_revistoria_id);
  r := private.revcli_repetido(p_pedido); if r is not null then return r; end if;
  v_mot := private.revcli_texto(p_motivo);
  if char_length(v_mot) < 3 then raise exception 'Informe o motivo da correção'; end if;
  if p_data is null or p_data < date '2020-01-01' or p_data > v_hoje + 730 then raise exception 'Data da revistoria inválida'; end if;
  if nullif(btrim(coalesce(p_horario, '')), '') is not null then
    if btrim(p_horario) !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then raise exception 'Horário inválido (use HH:MM)'; end if;
    v_hor := btrim(p_horario)::time;
  end if;
  v_resp := btrim(regexp_replace(coalesce(p_responsavel, ''), '\s+', ' ', 'g'));
  if char_length(v_resp) > 80 then raise exception 'Nome muito longo (máximo de 80 caracteres)'; end if;
  if v_resp <> '' then v_resp := private.revcli_nome(v_resp, 'o responsável'); end if;
  v_real := v.realizada_em;
  if v.status in ('Aprovada', 'Reprovada') then
    if p_realizada_em is null then raise exception 'Informe a data em que a revistoria foi realizada'; end if;
    if p_realizada_em < date '2020-01-01' or p_realizada_em > v_hoje then raise exception 'Data da realização inválida (não pode ser futura)'; end if;
    v_real := p_realizada_em;
  end if;

  if v.data is distinct from p_data then v_mud := v_mud || ('data ' || private.revcli_data_br(v.data) || ' → ' || private.revcli_data_br(p_data)); end if;
  if v.horario is distinct from v_hor then
    v_mud := v_mud || ('horário ' || coalesce(left(v.horario::text, 5), 'sem horário') || ' → ' || coalesce(left(v_hor::text, 5), 'sem horário'));
  end if;
  if coalesce(v.responsavel, '') <> v_resp then
    v_mud := v_mud || ('responsável ' || coalesce(nullif(v.responsavel, ''), '—') || ' → ' || coalesce(nullif(v_resp, ''), '—'));
  end if;
  if v.realizada_em is distinct from v_real then
    v_mud := v_mud || ('realizada em ' || private.revcli_data_br(v.realizada_em) || ' → ' || private.revcli_data_br(v_real));
  end if;
  if cardinality(v_mud) = 0 then raise exception 'Nada foi alterado'; end if;

  perform set_config('app.revcli', 'on', true);
  update public.revistorias
     set data = p_data, horario = v_hor, responsavel = v_resp, realizada_em = v_real,
         atualizado_em = now(), atualizado_por = (select auth.uid())
   where id = v.id returning * into n;
  -- a situação da unidade não muda; a versão sobe para quem estiver com a tela aberta recarregar antes de gravar
  select * into a from public.revistorias_cliente where unit_id = v.unit_id for update;
  if not found then raise exception 'Esta unidade não está na Revistoria · Cliente'; end if;
  a := private.revcli_mudar(a.id, a.status, a.ciclo, a.revistoria_id);
  perform private.revcli_evento(a, v.id, 'correcao', a.status,
    'Agendamento nº ' || v.numero || ' corrigido pelo administrador: ' || array_to_string(v_mud, '; ') || '. Motivo: ' || v_mot, p_pedido);
  perform set_config('app.revcli', 'off', true);
  return jsonb_build_object('ok', true, 'revistoria', to_jsonb(n), 'acompanhamento', to_jsonb(a));
end $$;

-- ── 4) Anular agendamento em duplicidade ─────────────────────────────────────
-- Só revistorias realizadas (Aprovada/Reprovada) que não sejam a mais recente nem a atual da unidade: a atual
-- define a situação (para ela continuam Cancelar/Reabrir) e a importação da planilha só mexe na mais recente.
create or replace function public.revistoria_agendamento_anular(p_revistoria_id bigint, p_motivo text, p_pedido uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v public.revistorias; a public.revistorias_cliente; r jsonb; v_mot text;
begin
  r := private.revcli_repetido(p_pedido); if r is not null then return r; end if;
  v := private.revcli_agendamento_admin(p_revistoria_id);
  r := private.revcli_repetido(p_pedido); if r is not null then return r; end if;
  v_mot := private.revcli_texto(p_motivo);
  if char_length(v_mot) < 3 then raise exception 'Informe o motivo (ex.: registro em duplicidade)'; end if;
  if v.status not in ('Aprovada', 'Reprovada') then
    raise exception 'Só revistorias realizadas podem ser anuladas (para agendamentos em aberto use Cancelar ou Remarcar)';
  end if;
  select * into a from public.revistorias_cliente where unit_id = v.unit_id for update;
  if not found then raise exception 'Esta unidade não está na Revistoria · Cliente'; end if;
  if a.revistoria_id = v.id then
    raise exception 'Este é o agendamento atual da unidade e não pode ser anulado. Corrija os dados dele ou anule o outro registro.';
  end if;
  if not exists (select 1 from public.revistorias x where x.unit_id = v.unit_id and x.numero > v.numero) then
    raise exception 'O agendamento mais recente não pode ser anulado. Corrija os dados dele ou anule o registro anterior.';
  end if;

  perform set_config('app.revcli', 'on', true);
  update public.revistorias
     set status = 'Cancelada', anulado_em = now(), anulado_email = left(private.revcli_email(), 320), anulado_motivo = v_mot,
         atualizado_em = now(), atualizado_por = (select auth.uid())
   where id = v.id;
  a := private.revcli_mudar(a.id, a.status, a.ciclo, a.revistoria_id);
  perform private.revcli_evento(a, v.id, 'correcao', a.status,
    'Agendamento nº ' || v.numero || ' anulado pelo administrador (era ' || lower(v.status) ||
    coalesce(' em ' || private.revcli_data_br(coalesce(v.realizada_em, v.data)), '') ||
    coalesce(' · ' || nullif(v.responsavel, ''), '') || '). Motivo: ' || v_mot, p_pedido);
  perform set_config('app.revcli', 'off', true);
  return jsonb_build_object('ok', true, 'acompanhamento', to_jsonb(a));
end $$;

revoke all on function public.revistoria_agendamento_corrigir(bigint, date, text, text, date, text, uuid) from public, anon;
revoke all on function public.revistoria_agendamento_anular(bigint, text, uuid) from public, anon;
grant execute on function public.revistoria_agendamento_corrigir(bigint, date, text, text, date, text, uuid) to authenticated;
grant execute on function public.revistoria_agendamento_anular(bigint, text, uuid) to authenticated;

-- ── 5) Central Operacional: agendamentos anulados fora da agenda ─────────────
-- (as contagens já ignoram status Cancelada; aqui só deixam de aparecer na lista de cancelados)
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
       and rv.anulado_em is null
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
revoke all on function public.central_agenda(date, date, bigint[]) from public, anon;
grant execute on function public.central_agenda(date, date, bigint[]) to authenticated;
