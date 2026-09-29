-- 1) Responsável pela revistoria, separado do responsável da vistoria primária.
-- 2) "Revistoria Finalizada" exige data e responsável da revistoria (edições no sistema).
-- 3) Exclusão lógica de obra/condomínio (arquivar), com restauração e registro no log.

-- ── 1) Responsável pela revistoria ───────────────────────────────────────────
alter table public.client_inspections
  add column if not exists reinspection_responsible text not null default '';

comment on column public.client_inspections.reinspection_responsible is
  'Responsável pela revistoria. Não substitui "responsible" (responsável da vistoria primária).';

-- A origem por campo passa a acompanhar também o responsável da revistoria.
create or replace function private.track_inspection_source()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  src text := coalesce(
    nullif(current_setting('app.change_source', true), ''),
    case when (select auth.uid()) is null then 'SISTEMA' else 'MANUAL' end
  );
  changed jsonb := '{}'::jsonb;
  f text;
begin
  foreach f in array array['client_name', 'inspection_date', 'inspection_time', 'responsible', 'status',
                           'reinspection_date', 'reinspection_responsible', 'notes', 'sale_stage',
                           'technical_escort'] loop
    if (to_jsonb(new) -> f) is distinct from (to_jsonb(old) -> f) then
      changed := changed || jsonb_build_object(f, src);
    end if;
  end loop;

  new.field_sources := coalesce(old.field_sources, '{}'::jsonb) || changed;
  new.updated_source := case when changed = '{}'::jsonb then old.updated_source else src end;
  return new;
end;
$$;

-- ── 2) Finalizar revistoria exige data e responsável ─────────────────────────
-- Vale para quem edita no sistema: ao passar para "Revistoria Finalizada" ou ao
-- mexer na data/responsável de uma revistoria já finalizada. A importação da
-- planilha (app.change_source = 'PLANILHA') não traz esses campos e não é barrada.
create or replace function private.require_reinspection_fields()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'Revistoria Finalizada'
     and (select auth.uid()) is not null
     and coalesce(current_setting('app.change_source', true), '') <> 'PLANILHA'
     and (old.status is distinct from new.status
          or old.reinspection_date is distinct from new.reinspection_date
          or old.reinspection_responsible is distinct from new.reinspection_responsible)
     and (new.reinspection_date is null or btrim(new.reinspection_responsible) = '') then
    raise exception 'Para finalizar a revistoria, informe a data e o responsável pela revistoria.'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function private.require_reinspection_fields() from public, anon, authenticated;

drop trigger if exists client_inspections_16_revistoria_final on public.client_inspections;
create trigger client_inspections_16_revistoria_final
  before update on public.client_inspections
  for each row execute function private.require_reinspection_fields();

-- ── 3) Arquivar (excluir logicamente) obra ───────────────────────────────────
alter table public.projects
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by uuid references public.profiles (id) on delete set null;

comment on column public.projects.archived_at is
  'Quando a obra foi excluída (arquivada). Obras arquivadas somem de todas as telas; os dados ficam guardados para recuperação.';

alter table public.audit_log drop constraint if exists audit_log_action_check;
alter table public.audit_log
  add constraint audit_log_action_check
  check (action in ('INSERT', 'UPDATE', 'DELETE', 'ARCHIVE', 'RESTORE'));

-- Obra arquivada não concede papel a ninguém: projetos, unidades, vistorias,
-- cronogramas e logs dela deixam de aparecer em todas as consultas (RLS).
create or replace function private.project_role(p_project_id bigint)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select pm.role
  from public.project_members as pm
  join public.projects as p on p.id = pm.project_id
  where pm.project_id = p_project_id
    and pm.user_id = (select auth.uid())
    and pm.active
    and p.archived_at is null
  limit 1
$$;

-- Administrador da obra, mesmo arquivada (para restaurar e consultar arquivadas).
create or replace function private.is_project_admin_any_state(p_project_id bigint)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.project_members pm
     where pm.project_id = p_project_id
       and pm.user_id = (select auth.uid())
       and pm.active
       and pm.role = 'admin'
  )
$$;

revoke all on function private.is_project_admin_any_state(bigint) from public, anon;
grant execute on function private.is_project_admin_any_state(bigint) to authenticated;

create or replace function private.log_project_event(p_project bigint, p_action text, p_old jsonb, p_new jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
begin
  insert into public.audit_log (project_id, actor_user_id, actor_email, table_name, record_id, action, old_data, new_data)
  values (p_project, uid, coalesce((select email from public.profiles where id = uid), ''),
          'projects', p_project, p_action, p_old, p_new);
end;
$$;

revoke all on function private.log_project_event(bigint, text, jsonb, jsonb) from public, anon, authenticated;

-- Números mostrados na confirmação antes de excluir.
create or replace function public.resumo_exclusao_condominio(p_project bigint)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null or not private.is_project_admin(p_project) then
    raise exception 'Somente administradores deste condomínio podem excluí-lo.' using errcode = '42501';
  end if;
  return (
    select jsonb_build_object(
      'name', p.name,
      'units', (select count(*) from public.units u where u.project_id = p.id),
      'inspections', (select count(*) from public.client_inspections ci
                        join public.units u on u.id = ci.unit_id
                       where u.project_id = p.id
                         and (ci.status <> 'Não agendado' or ci.client_name <> '' or ci.inspection_date is not null)),
      'members', (select count(*) from public.project_members pm where pm.project_id = p.id and pm.active))
    from public.projects p where p.id = p_project
  );
end;
$$;

create or replace function public.arquivar_condominio(p_project bigint, p_confirm_name text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  v_old public.projects;
  v_new public.projects;
begin
  if uid is null or not private.is_project_admin(p_project) then
    raise exception 'Somente administradores deste condomínio podem excluí-lo.' using errcode = '42501';
  end if;
  select * into v_old from public.projects where id = p_project for update;
  if not found or v_old.archived_at is not null then
    raise exception 'Condomínio não encontrado ou já excluído.';
  end if;
  if lower(btrim(regexp_replace(coalesce(p_confirm_name, ''), '\s+', ' ', 'g'))) <> lower(btrim(v_old.name)) then
    raise exception 'O nome digitado não confere com o nome da obra.';
  end if;

  update public.projects set archived_at = now(), archived_by = uid where id = p_project
  returning * into v_new;

  perform private.log_project_event(p_project, 'ARCHIVE', to_jsonb(v_old), to_jsonb(v_new));
  return jsonb_build_object('project_id', p_project, 'archived_at', v_new.archived_at);
end;
$$;

create or replace function public.restaurar_condominio(p_project bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  v_old public.projects;
  v_new public.projects;
begin
  if uid is null or not private.is_project_admin_any_state(p_project) then
    raise exception 'Somente administradores deste condomínio podem restaurá-lo.' using errcode = '42501';
  end if;
  select * into v_old from public.projects where id = p_project for update;
  if not found or v_old.archived_at is null then
    raise exception 'Condomínio não encontrado ou não está excluído.';
  end if;

  update public.projects set archived_at = null, archived_by = null where id = p_project
  returning * into v_new;

  perform private.log_project_event(p_project, 'RESTORE', to_jsonb(v_old), to_jsonb(v_new));
  return jsonb_build_object('project_id', p_project);
end;
$$;

-- Obras excluídas que o usuário administrava (para restaurar).
create or replace function public.listar_condominios_arquivados()
returns table (id bigint, name text, kind text, color text, archived_at timestamptz, archived_by_email text, units bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.name, p.kind, p.color, p.archived_at,
         coalesce((select pr.email from public.profiles pr where pr.id = p.archived_by), ''),
         (select count(*) from public.units u where u.project_id = p.id)
    from public.projects p
   where p.archived_at is not null
     and (select auth.uid()) is not null
     and private.is_project_admin_any_state(p.id)
   order by p.archived_at desc
$$;

revoke all on function public.resumo_exclusao_condominio(bigint) from public, anon;
revoke all on function public.arquivar_condominio(bigint, text) from public, anon;
revoke all on function public.restaurar_condominio(bigint) from public, anon;
revoke all on function public.listar_condominios_arquivados() from public, anon;
grant execute on function public.resumo_exclusao_condominio(bigint) to authenticated;
grant execute on function public.arquivar_condominio(bigint, text) to authenticated;
grant execute on function public.restaurar_condominio(bigint) to authenticated;
grant execute on function public.listar_condominios_arquivados() to authenticated;
