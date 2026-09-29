-- Importação de agendamentos: campos exclusivos do Atendimento ao Cliente ficam fora.
-- "Responsável pelo agendamento", "Observação" e "Etapa de Categoria Atendimento" da planilha
-- nunca alteram responsible, notes ou sale_stage. A função recusa qualquer alteração nesses
-- campos, mesmo que seja enviada diretamente pela API.
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
  -- Só o agendamento: cliente, data, horário e status. Responsável, observação e etapa são
  -- do Atendimento ao Cliente e nunca são alterados pela planilha.
  allowed text[] := array['client_name', 'inspection_date', 'inspection_time', 'status'];
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
             status = v_rec.status
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
