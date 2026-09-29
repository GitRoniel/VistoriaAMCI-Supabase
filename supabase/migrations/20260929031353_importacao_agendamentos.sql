-- Importação/Atualização de Agendamentos via Excel.
--
-- 1) Origem de cada informação da vistoria do cliente (MANUAL, PLANILHA ou SISTEMA).
-- 2) Histórico das importações e de cada alteração aplicada.
-- 3) Função única que aplica, em uma transação, somente o que o usuário confirmou na prévia.
--    A planilha nunca apaga valores e só altera um campo se ele ainda estiver igual ao que
--    foi mostrado na prévia (se alguém mudou no sistema nesse meio-tempo, o campo é pulado).

-- ── Origem dos dados ──────────────────────────────────────────────────────────
alter table public.client_inspections
  add column if not exists updated_source text not null default 'SISTEMA',
  add column if not exists field_sources jsonb not null default '{}'::jsonb;

alter table public.client_inspections
  drop constraint if exists client_inspections_updated_source_check,
  add constraint client_inspections_updated_source_check
    check (updated_source in ('MANUAL', 'PLANILHA', 'SISTEMA'));

comment on column public.client_inspections.updated_source is
  'Origem da última alteração: MANUAL (usuário no sistema), PLANILHA (importação) ou SISTEMA (carga inicial/automática).';
comment on column public.client_inspections.field_sources is
  'Origem por campo, ex.: {"inspection_date":"PLANILHA","status":"MANUAL"}. Prioridade: MANUAL > PLANILHA > SISTEMA.';

-- Registra a origem de cada campo alterado. A importação marca a transação com
-- app.change_source = 'PLANILHA'; qualquer outra edição de usuário vira MANUAL.
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
                           'reinspection_date', 'notes', 'sale_stage', 'technical_escort'] loop
    if (to_jsonb(new) -> f) is distinct from (to_jsonb(old) -> f) then
      changed := changed || jsonb_build_object(f, src);
    end if;
  end loop;

  -- Estas colunas são controladas só por este gatilho.
  new.field_sources := coalesce(old.field_sources, '{}'::jsonb) || changed;
  new.updated_source := case when changed = '{}'::jsonb then old.updated_source else src end;
  return new;
end;
$$;

drop trigger if exists client_inspections_12_source on public.client_inspections;
create trigger client_inspections_12_source
  before update on public.client_inspections
  for each row execute function private.track_inspection_source();

-- ── Histórico de importações ─────────────────────────────────────────────────
create table if not exists public.importacoes_agendamentos (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  user_id uuid references public.profiles (id) on delete set null default auth.uid(),
  user_email text not null default '',
  file_name text not null,
  project_ids bigint[] not null default '{}',
  total_rows integer not null default 0,
  updated_count integer not null default 0,
  unchanged_count integer not null default 0,
  new_count integer not null default 0,
  filled_fields integer not null default 0,
  conflicts_count integer not null default 0,
  conflicts_resolved integer not null default 0,
  conflicts_pending integer not null default 0,
  not_found_count integer not null default 0,
  not_in_sheet_count integer not null default 0,
  applied_changes integer not null default 0,
  skipped_changes integer not null default 0,
  result text not null default 'concluida' check (result in ('concluida', 'parcial', 'sem_alteracoes')),
  summary jsonb not null default '{}'::jsonb
);

create table if not exists public.importacoes_agendamentos_itens (
  id bigint generated always as identity primary key,
  import_id bigint not null references public.importacoes_agendamentos (id) on delete cascade,
  project_id bigint references public.projects (id) on delete cascade,
  unit_id bigint references public.units (id) on delete set null,
  row_number integer,
  unit_label text not null default '',
  client_name text not null default '',
  field text not null default '',
  old_value text not null default '',
  new_value text not null default '',
  action text not null check (action in ('preenchido', 'usado_planilha', 'mantido_sistema', 'conflito_pendente',
                                         'nao_encontrado', 'ignorado', 'alterado_no_sistema')),
  message text not null default ''
);

create index if not exists importacoes_agendamentos_created_idx on public.importacoes_agendamentos (created_at desc);
create index if not exists importacoes_agendamentos_itens_import_idx on public.importacoes_agendamentos_itens (import_id);
create index if not exists importacoes_agendamentos_itens_unit_idx on public.importacoes_agendamentos_itens (unit_id);
create index if not exists importacoes_agendamentos_itens_project_idx on public.importacoes_agendamentos_itens (project_id);

alter table public.importacoes_agendamentos enable row level security;
alter table public.importacoes_agendamentos_itens enable row level security;

revoke all on table public.importacoes_agendamentos from public, anon, authenticated;
revoke all on table public.importacoes_agendamentos_itens from public, anon, authenticated;
grant select on table public.importacoes_agendamentos to authenticated;
grant select on table public.importacoes_agendamentos_itens to authenticated;

-- Leitura: administradores dos condomínios envolvidos (e quem importou).
drop policy if exists importacoes_select_admin on public.importacoes_agendamentos;
create policy importacoes_select_admin on public.importacoes_agendamentos
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or exists (select 1 from unnest(project_ids) p(id) where private.is_project_admin(p.id))
  );

drop policy if exists importacoes_itens_select_admin on public.importacoes_agendamentos_itens;
create policy importacoes_itens_select_admin on public.importacoes_agendamentos_itens
  for select to authenticated
  using (
    (project_id is not null and private.is_project_admin(project_id))
    or (project_id is null and exists (
      select 1 from public.importacoes_agendamentos i
      where i.id = import_id and i.user_id = (select auth.uid())
    ))
  );
-- Sem políticas de escrita: gravação somente pela função abaixo.

-- ── Aplicação da importação ──────────────────────────────────────────────────
-- p_changes: [{unit_id, field, old, new, action ('preenchido'|'usado_planilha'), row, label, client}]
-- p_items:   [{project_id?, unit_id?, row, label, client, field, old, new, action, message}]
--            (decisões que não alteram o banco: mantido_sistema, conflito_pendente, nao_encontrado, ignorado)
create or replace function public.aplicar_importacao_agendamentos(
  p_file text,
  p_summary jsonb,
  p_changes jsonb,
  p_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  allowed text[] := array['client_name', 'inspection_date', 'inspection_time', 'responsible', 'status', 'notes', 'sale_stage'];
  v_projects bigint[];
  v_import bigint;
  v_unit bigint;
  v_rec public.client_inspections;
  v_cur jsonb;
  v_patch jsonb;
  ch jsonb;
  v_field text;
  v_now text;
  applied integer := 0;
  skipped integer := 0;
  touched integer := 0;
begin
  if uid is null then
    raise exception 'Sessão inválida.' using errcode = '42501';
  end if;
  if jsonb_typeof(coalesce(p_changes, '[]'::jsonb)) <> 'array' or jsonb_typeof(coalesce(p_items, '[]'::jsonb)) <> 'array' then
    raise exception 'Formato inválido.';
  end if;
  if jsonb_array_length(coalesce(p_changes, '[]'::jsonb)) > 20000 or jsonb_array_length(coalesce(p_items, '[]'::jsonb)) > 20000 then
    raise exception 'Importação grande demais.';
  end if;

  -- Condomínios afetados: das unidades alteradas e dos itens registrados.
  select coalesce(array_agg(distinct pid), '{}') into v_projects from (
    select u.project_id as pid
      from jsonb_array_elements(coalesce(p_changes, '[]'::jsonb)) c
      join public.units u on u.id = (c ->> 'unit_id')::bigint
    union
    select coalesce((i ->> 'project_id')::bigint, u.project_id)
      from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) i
      left join public.units u on u.id = (i ->> 'unit_id')::bigint
     where coalesce((i ->> 'project_id')::bigint, u.project_id) is not null
  ) s;

  if exists (select 1 from unnest(v_projects) p(id) where not private.is_project_admin(p.id)) then
    raise exception 'Somente administradores dos condomínios da planilha podem importar.' using errcode = '42501';
  end if;
  if exists (
    select 1 from jsonb_array_elements(coalesce(p_changes, '[]'::jsonb)) c
     where not ((c ->> 'field') = any (allowed))
        or coalesce(c ->> 'new', '') = ''
        or (c ->> 'action') not in ('preenchido', 'usado_planilha')
        or not exists (select 1 from public.units u where u.id = (c ->> 'unit_id')::bigint)
  ) then
    raise exception 'Alteração inválida: a importação não apaga valores nem altera campos fora do agendamento.';
  end if;

  insert into public.importacoes_agendamentos (
    user_email, file_name, project_ids, total_rows, updated_count, unchanged_count, new_count, filled_fields,
    conflicts_count, conflicts_resolved, conflicts_pending, not_found_count, not_in_sheet_count, summary
  ) values (
    coalesce((select email from public.profiles where id = uid), ''),
    left(coalesce(nullif(btrim(p_file), ''), 'planilha.xlsx'), 200),
    v_projects,
    coalesce((p_summary ->> 'total')::int, 0),
    coalesce((p_summary ->> 'updated')::int, 0),
    coalesce((p_summary ->> 'unchanged')::int, 0),
    coalesce((p_summary ->> 'new')::int, 0),
    coalesce((p_summary ->> 'filled')::int, 0),
    coalesce((p_summary ->> 'conflicts')::int, 0),
    coalesce((p_summary ->> 'resolved')::int, 0),
    coalesce((p_summary ->> 'pending')::int, 0),
    coalesce((p_summary ->> 'notFound')::int, 0),
    coalesce((p_summary ->> 'notInSheet')::int, 0),
    coalesce(p_summary, '{}'::jsonb)
  ) returning id into v_import;

  perform set_config('app.change_source', 'PLANILHA', true);

  for v_unit in
    select distinct (c ->> 'unit_id')::bigint from jsonb_array_elements(coalesce(p_changes, '[]'::jsonb)) c
  loop
    select * into v_rec from public.client_inspections where unit_id = v_unit for update;
    if not found then
      continue;
    end if;
    v_cur := to_jsonb(v_rec);
    v_patch := '{}'::jsonb;

    for ch in
      select c from jsonb_array_elements(p_changes) c where (c ->> 'unit_id')::bigint = v_unit
    loop
      v_field := ch ->> 'field';
      v_now := case v_field
                 when 'inspection_time' then coalesce(left(v_cur ->> v_field, 5), '')
                 else coalesce(v_cur ->> v_field, '')
               end;
      if v_now is distinct from coalesce(ch ->> 'old', '') then
        skipped := skipped + 1;
        insert into public.importacoes_agendamentos_itens
          (import_id, project_id, unit_id, row_number, unit_label, client_name, field, old_value, new_value, action, message)
        values (v_import, private.unit_project_id(v_unit), v_unit, (ch ->> 'row')::int, coalesce(ch ->> 'label', ''),
                coalesce(ch ->> 'client', ''), v_field, v_now, ch ->> 'new', 'alterado_no_sistema',
                'O valor mudou no sistema depois da prévia; nada foi alterado.');
      else
        v_patch := v_patch || jsonb_build_object(v_field, ch ->> 'new');
        applied := applied + 1;
        insert into public.importacoes_agendamentos_itens
          (import_id, project_id, unit_id, row_number, unit_label, client_name, field, old_value, new_value, action, message)
        values (v_import, private.unit_project_id(v_unit), v_unit, (ch ->> 'row')::int, coalesce(ch ->> 'label', ''),
                coalesce(ch ->> 'client', ''), v_field, v_now, ch ->> 'new', ch ->> 'action', coalesce(ch ->> 'message', ''));
      end if;
    end loop;

    if v_patch <> '{}'::jsonb then
      v_rec := jsonb_populate_record(v_rec, v_patch);
      update public.client_inspections
         set client_name = v_rec.client_name,
             inspection_date = v_rec.inspection_date,
             inspection_time = v_rec.inspection_time,
             responsible = v_rec.responsible,
             status = v_rec.status,
             notes = v_rec.notes,
             sale_stage = v_rec.sale_stage
       where id = v_rec.id;
      touched := touched + 1;
    end if;
  end loop;

  insert into public.importacoes_agendamentos_itens
    (import_id, project_id, unit_id, row_number, unit_label, client_name, field, old_value, new_value, action, message)
  select v_import,
         coalesce((i ->> 'project_id')::bigint, u.project_id),
         u.id,
         (i ->> 'row')::int,
         left(coalesce(i ->> 'label', ''), 200),
         left(coalesce(i ->> 'client', ''), 200),
         left(coalesce(i ->> 'field', ''), 60),
         left(coalesce(i ->> 'old', ''), 500),
         left(coalesce(i ->> 'new', ''), 500),
         i ->> 'action',
         left(coalesce(i ->> 'message', ''), 300)
    from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) i
    left join public.units u on u.id = (i ->> 'unit_id')::bigint;

  update public.importacoes_agendamentos
     set applied_changes = applied,
         skipped_changes = skipped,
         result = case
                    when applied = 0 then 'sem_alteracoes'
                    when skipped > 0 or coalesce((p_summary ->> 'pending')::int, 0) > 0 then 'parcial'
                    else 'concluida'
                  end,
         summary = summary || jsonb_build_object('records_updated', touched)
   where id = v_import;

  return jsonb_build_object('import_id', v_import, 'applied', applied, 'skipped', skipped, 'records', touched);
end;
$$;

revoke all on function public.aplicar_importacao_agendamentos(text, jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.aplicar_importacao_agendamentos(text, jsonb, jsonb, jsonb) to authenticated;
