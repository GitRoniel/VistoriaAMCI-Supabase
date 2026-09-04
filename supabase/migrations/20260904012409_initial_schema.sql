-- Vistorias AMCI: Supabase data model, authorization and realtime.
-- Apply with `supabase db push` after linking the remote project.

create schema if not exists private;
revoke all on schema private from public;

create table public.projects (
  id bigint generated always as identity primary key,
  slug text not null unique,
  name text not null,
  created_at timestamptz not null default now(),
  constraint projects_slug_format check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$')
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index profiles_email_lower_idx on public.profiles (lower(email));

create table public.project_members (
  project_id bigint not null references public.projects(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null,
  primary key (project_id, user_id),
  constraint project_members_role_check
    check (role in ('admin', 'acab', 'inst', 'qual', 'astec', 'visitante'))
);

create index project_members_user_id_idx on public.project_members (user_id);
create index project_members_updated_by_idx on public.project_members (updated_by);
create index project_members_active_user_project_idx
  on public.project_members (user_id, project_id)
  where active;

create table public.units (
  id bigint generated always as identity primary key,
  project_id bigint not null references public.projects(id) on delete cascade,
  bloco text not null,
  pav text not null,
  apto text not null,
  created_at timestamptz not null default now(),
  constraint units_location_unique unique (project_id, bloco, pav, apto),
  constraint units_bloco_not_blank check (length(btrim(bloco)) > 0),
  constraint units_pav_not_blank check (length(btrim(pav)) > 0),
  constraint units_apto_not_blank check (length(btrim(apto)) > 0)
);

create index units_project_id_idx on public.units (project_id);

create table public.unit_stage_status (
  id bigint generated always as identity primary key,
  unit_id bigint not null references public.units(id) on delete cascade,
  stage text not null,
  status text not null default 'Não iniciado',
  version bigint not null default 1,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null,
  constraint unit_stage_status_unique unique (unit_id, stage),
  constraint unit_stage_status_stage_check check (stage in ('acab', 'inst', 'qual', 'astec')),
  constraint unit_stage_status_value_check check (
    status in (
      'Não iniciado',
      'Em andamento',
      'Liberado p/ Próxima Etapa',
      'Pendências Revisórias',
      'Revistoriado',
      'Finalizado',
      'Liberado / Aprovado',
      'Reprovado'
    )
  ),
  constraint unit_stage_status_version_positive check (version > 0)
);

create index unit_stage_status_unit_id_idx on public.unit_stage_status (unit_id);
create index unit_stage_status_updated_by_idx on public.unit_stage_status (updated_by);

create table public.client_inspections (
  id bigint generated always as identity primary key,
  unit_id bigint not null unique references public.units(id) on delete cascade,
  client_name text not null default '',
  inspection_date date,
  inspection_time time,
  responsible text not null default '',
  status text not null default 'Não agendado',
  reinspection_date date,
  notes text not null default '',
  version bigint not null default 1,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null,
  constraint client_inspections_status_check
    check (status in ('Não agendado', 'Agendado', 'Remarcado', 'Revistoria', 'Aprovado')),
  constraint client_inspections_version_positive check (version > 0)
);

create index client_inspections_updated_by_idx on public.client_inspections (updated_by);

create table public.floor_schedule (
  id bigint generated always as identity primary key,
  project_id bigint not null references public.projects(id) on delete cascade,
  bloco text not null,
  pav text not null,
  stage text not null,
  planned_date date,
  released_date date,
  version bigint not null default 1,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null,
  constraint floor_schedule_unique unique (project_id, bloco, pav, stage),
  constraint floor_schedule_stage_check check (stage in ('acab', 'inst', 'qual', 'astec')),
  constraint floor_schedule_version_positive check (version > 0)
);

create index floor_schedule_project_id_idx on public.floor_schedule (project_id);
create index floor_schedule_updated_by_idx on public.floor_schedule (updated_by);

create table public.audit_log (
  id bigint generated always as identity primary key,
  project_id bigint not null references public.projects(id) on delete cascade,
  actor_user_id uuid references public.profiles(id) on delete set null,
  actor_email text not null default '',
  table_name text not null,
  record_id bigint,
  action text not null,
  old_data jsonb,
  new_data jsonb,
  created_at timestamptz not null default now(),
  constraint audit_log_action_check check (action in ('INSERT', 'UPDATE', 'DELETE'))
);

create index audit_log_project_created_idx on public.audit_log (project_id, created_at desc);
create index audit_log_actor_user_id_idx on public.audit_log (actor_user_id);

create or replace function private.project_role(p_project_id bigint)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select pm.role
  from public.project_members as pm
  where pm.project_id = p_project_id
    and pm.user_id = (select auth.uid())
    and pm.active
  limit 1
$$;

create or replace function private.unit_project_id(p_unit_id bigint)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select u.project_id
  from public.units as u
  where u.id = p_unit_id
$$;

create or replace function private.can_access_unit(p_unit_id bigint)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.project_role(private.unit_project_id(p_unit_id)) is not null
$$;

create or replace function private.is_project_admin(p_project_id bigint)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.project_role(p_project_id) = 'admin'
$$;

create or replace function private.can_edit_stage(p_unit_id bigint, p_stage text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.project_role(private.unit_project_id(p_unit_id)) in ('admin', p_stage)
$$;

create or replace function private.can_edit_schedule(p_project_id bigint, p_stage text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.project_role(p_project_id) in ('admin', p_stage)
$$;

revoke all on all functions in schema private from public, anon;
grant usage on schema private to authenticated;
grant execute on function private.project_role(bigint) to authenticated;
grant execute on function private.unit_project_id(bigint) to authenticated;
grant execute on function private.can_access_unit(bigint) to authenticated;
grant execute on function private.is_project_admin(bigint) to authenticated;
grant execute on function private.can_edit_stage(bigint, text) to authenticated;
grant execute on function private.can_edit_schedule(bigint, text) to authenticated;

create or replace function private.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data ->> 'full_name', '')
  )
  on conflict (id) do update
    set email = excluded.email,
        full_name = excluded.full_name,
        updated_at = now();
  return new;
end;
$$;

revoke all on function private.handle_new_auth_user() from public, anon, authenticated;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function private.handle_new_auth_user();

insert into public.profiles (id, email, full_name)
select
  u.id,
  coalesce(u.email, ''),
  coalesce(u.raw_user_meta_data ->> 'full_name', '')
from auth.users as u
on conflict (id) do update
  set email = excluded.email,
      full_name = excluded.full_name,
      updated_at = now();

create or replace function private.touch_profile()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create or replace function private.touch_versioned_record()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.version := old.version + 1;
  new.updated_at := now();
  new.updated_by := (select auth.uid());
  return new;
end;
$$;

create or replace function private.prevent_status_identity_change()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.id is distinct from old.id
     or new.unit_id is distinct from old.unit_id
     or new.stage is distinct from old.stage then
    raise exception 'id, unit_id and stage cannot be changed';
  end if;
  return new;
end;
$$;

create or replace function private.prevent_inspection_identity_change()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.id is distinct from old.id or new.unit_id is distinct from old.unit_id then
    raise exception 'id and unit_id cannot be changed';
  end if;
  return new;
end;
$$;

create or replace function private.enforce_schedule_columns()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_role text;
begin
  if (select auth.uid()) is null then
    return new;
  end if;

  current_role := private.project_role(old.project_id);
  if current_role = 'admin' then
    return new;
  end if;

  if current_role is distinct from old.stage
     or new.id is distinct from old.id
     or new.project_id is distinct from old.project_id
     or new.bloco is distinct from old.bloco
     or new.pav is distinct from old.pav
     or new.stage is distinct from old.stage
     or new.planned_date is distinct from old.planned_date then
    raise exception 'this role may only change released_date for its own stage';
  end if;

  return new;
end;
$$;

create trigger profiles_touch_updated_at
before update on public.profiles
for each row execute function private.touch_profile();

create trigger project_members_touch_updated_at
before update on public.project_members
for each row execute function private.touch_profile();

create trigger unit_stage_status_10_identity
before update on public.unit_stage_status
for each row execute function private.prevent_status_identity_change();

create trigger unit_stage_status_20_touch
before update on public.unit_stage_status
for each row execute function private.touch_versioned_record();

create trigger client_inspections_10_identity
before update on public.client_inspections
for each row execute function private.prevent_inspection_identity_change();

create trigger client_inspections_20_touch
before update on public.client_inspections
for each row execute function private.touch_versioned_record();

create trigger floor_schedule_10_permissions
before update on public.floor_schedule
for each row execute function private.enforce_schedule_columns();

create trigger floor_schedule_20_touch
before update on public.floor_schedule
for each row execute function private.touch_versioned_record();

create or replace function private.audit_row()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  source_row jsonb;
  target_project_id bigint;
  actor_id uuid;
  target_record_id bigint;
  actor_address text;
begin
  source_row := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  target_record_id := nullif(source_row ->> 'id', '')::bigint;
  actor_id := coalesce(
    (select auth.uid()),
    nullif(source_row ->> 'updated_by', '')::uuid
  );

  if tg_table_name in ('unit_stage_status', 'client_inspections') then
    target_project_id := private.unit_project_id((source_row ->> 'unit_id')::bigint);
  else
    target_project_id := (source_row ->> 'project_id')::bigint;
  end if;

  select p.email into actor_address
  from public.profiles as p
  where p.id = actor_id;

  insert into public.audit_log (
    project_id,
    actor_user_id,
    actor_email,
    table_name,
    record_id,
    action,
    old_data,
    new_data
  ) values (
    target_project_id,
    actor_id,
    coalesce(actor_address, ''),
    tg_table_name,
    target_record_id,
    tg_op,
    case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end,
    case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end
  );

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

revoke all on function private.touch_profile() from public, anon, authenticated;
revoke all on function private.touch_versioned_record() from public, anon, authenticated;
revoke all on function private.prevent_status_identity_change() from public, anon, authenticated;
revoke all on function private.prevent_inspection_identity_change() from public, anon, authenticated;
revoke all on function private.enforce_schedule_columns() from public, anon, authenticated;
revoke all on function private.audit_row() from public, anon, authenticated;

create trigger unit_stage_status_audit
after update on public.unit_stage_status
for each row execute function private.audit_row();

create trigger client_inspections_audit
after update on public.client_inspections
for each row execute function private.audit_row();

create trigger floor_schedule_audit
after update on public.floor_schedule
for each row execute function private.audit_row();

create trigger project_members_audit
after insert or update or delete on public.project_members
for each row execute function private.audit_row();

alter table public.projects enable row level security;
alter table public.profiles enable row level security;
alter table public.project_members enable row level security;
alter table public.units enable row level security;
alter table public.unit_stage_status enable row level security;
alter table public.client_inspections enable row level security;
alter table public.floor_schedule enable row level security;
alter table public.audit_log enable row level security;

create policy profiles_select_self
on public.profiles
for select
to authenticated
using (id = (select auth.uid()));

create policy projects_select_member
on public.projects
for select
to authenticated
using (private.project_role(id) is not null);

create policy project_members_select_self
on public.project_members
for select
to authenticated
using (user_id = (select auth.uid()) and active);

create policy units_select_member
on public.units
for select
to authenticated
using (private.project_role(project_id) is not null);

create policy unit_stage_status_select_member
on public.unit_stage_status
for select
to authenticated
using (private.can_access_unit(unit_id));

create policy unit_stage_status_insert_editor
on public.unit_stage_status
for insert
to authenticated
with check (private.can_edit_stage(unit_id, stage));

create policy unit_stage_status_update_editor
on public.unit_stage_status
for update
to authenticated
using (private.can_edit_stage(unit_id, stage))
with check (private.can_edit_stage(unit_id, stage));

create policy client_inspections_select_member
on public.client_inspections
for select
to authenticated
using (private.can_access_unit(unit_id));

create policy client_inspections_insert_admin
on public.client_inspections
for insert
to authenticated
with check (private.is_project_admin(private.unit_project_id(unit_id)));

create policy client_inspections_update_admin
on public.client_inspections
for update
to authenticated
using (private.is_project_admin(private.unit_project_id(unit_id)))
with check (private.is_project_admin(private.unit_project_id(unit_id)));

create policy floor_schedule_select_member
on public.floor_schedule
for select
to authenticated
using (private.project_role(project_id) is not null);

create policy floor_schedule_insert_admin
on public.floor_schedule
for insert
to authenticated
with check (private.is_project_admin(project_id));

create policy floor_schedule_update_editor
on public.floor_schedule
for update
to authenticated
using (private.can_edit_schedule(project_id, stage))
with check (private.can_edit_schedule(project_id, stage));

create policy audit_log_select_admin
on public.audit_log
for select
to authenticated
using (private.is_project_admin(project_id));

revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;

grant select on table
  public.projects,
  public.profiles,
  public.project_members,
  public.units,
  public.unit_stage_status,
  public.client_inspections,
  public.floor_schedule,
  public.audit_log
to authenticated;

grant insert, update on table
  public.unit_stage_status,
  public.client_inspections,
  public.floor_schedule
to authenticated;

grant usage, select on all sequences in schema public to authenticated;

insert into public.projects (slug, name)
values ('alto-do-jeriva', 'Alto do Jerivá')
on conflict (slug) do update set name = excluded.name;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'unit_stage_status'
  ) then
    alter publication supabase_realtime add table public.unit_stage_status;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'client_inspections'
  ) then
    alter publication supabase_realtime add table public.client_inspections;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'floor_schedule'
  ) then
    alter publication supabase_realtime add table public.floor_schedule;
  end if;
end
$$;
