-- Revistorias importadas da planilha de Vistorias AMCI (colunas K, L e M do Relatório 854):
--   K = STATUS DA REVISTORIA, L = DATA DA REVISTORIA, M = HORÁRIO DO AGENDAMENTO REVISTORIA.
--
-- 1) public.revistorias: uma linha por revistoria da unidade (nº 1, 2, 3…), separada da vistoria.
--    O status da vistoria (client_inspections.status) nunca é alterado por uma revistoria.
-- 2) public.aplicar_importacao_agendamentos ganha p_revistorias (opcional). A mesma transação
--    da importação cria a revistoria nova ou atualiza a atual, sem duplicar:
--    - a revistoria é identificada pela unidade + número; uma linha só vira revistoria nova quando
--      a anterior já terminou (Aprovada/Reprovada) e a planilha traz outra data;
--    - só grava se a revistoria ainda estiver como na prévia (senão pula e registra);
--    - valor vazio na planilha nunca apaga dado.
--    A "Data da revistoria" da unidade (client_inspections.reinspection_date) acompanha a data da
--    revistoria quando está vazia ou igual à data anterior; se alguém a mudou no site, é mantida.
-- 0) Correção de segurança: private.is_project_admin (e as funções de edição por etapa) devolviam
--    NULL, e não false, para quem não é membro do condomínio. Nas políticas RLS isso já equivalia a
--    "não", mas nas funções que testam "if not private.is_project_admin(...)" (importação,
--    arquivar/excluir obra, estrutura do condomínio) um usuário logado sem acesso ao condomínio
--    passava pela verificação. Agora devolvem false.
-- Não altera dados existentes, políticas de client_inspections nem os demais campos da importação.

-- ── 0) Verificações de papel sempre true/false ───────────────────────────────
create or replace function private.is_project_admin(p_project_id bigint)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(private.project_role(p_project_id) = 'admin', false)
$$;

create or replace function private.can_edit_stage(p_unit_id bigint, p_stage text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(private.project_role(private.unit_project_id(p_unit_id)) in ('admin', p_stage), false)
$$;

create or replace function private.can_edit_schedule(p_project_id bigint, p_stage text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(private.project_role(p_project_id) in ('admin', p_stage), false)
$$;

-- ── 1) Revistorias ───────────────────────────────────────────────────────────
create table if not exists public.revistorias (
  id bigint generated always as identity primary key,
  project_id bigint not null references public.projects (id) on delete cascade,
  unit_id bigint not null references public.units (id) on delete cascade,
  numero smallint not null check (numero between 1 and 99),
  status text check (status in ('Agendada', 'Em revistoria', 'Aprovada', 'Reprovada')),
  status_planilha text not null default '' check (char_length(status_planilha) <= 80),
  data date,
  horario time,
  origem text not null default 'PLANILHA' check (origem in ('PLANILHA')),
  criado_import_id bigint references public.importacoes_agendamentos (id) on delete set null,
  atualizado_import_id bigint references public.importacoes_agendamentos (id) on delete set null,
  criado_em timestamptz not null default now(),
  criado_por uuid references public.profiles (id) on delete set null,
  atualizado_em timestamptz not null default now(),
  atualizado_por uuid references public.profiles (id) on delete set null,
  constraint revistorias_unidade_numero unique (unit_id, numero),
  constraint revistorias_nao_vazia check (status is not null or data is not null or horario is not null)
);

comment on table public.revistorias is
  'Revistorias da unidade (nº 1, 2…), importadas da planilha de Vistorias AMCI. Não substituem o status da vistoria (client_inspections.status). Gravação só por public.aplicar_importacao_agendamentos.';
comment on column public.revistorias.status is 'Status normalizado: Agendada, Em revistoria, Aprovada ou Reprovada (nulo quando a planilha traz um valor não reconhecido).';
comment on column public.revistorias.status_planilha is 'Texto original da coluna STATUS DA REVISTORIA.';

create index if not exists revistorias_project_idx on public.revistorias (project_id);

alter table public.revistorias enable row level security;
revoke all on table public.revistorias from public, anon, authenticated;
grant select on table public.revistorias to authenticated;

-- Leitura: quem tem acesso ao condomínio (mesma regra das vistorias). Sem políticas de escrita.
drop policy if exists revistorias_select_member on public.revistorias;
create policy revistorias_select_member on public.revistorias
  for select to authenticated
  using (private.project_role(project_id) is not null);

-- Tempo real (o mapa e a lista atualizam depois de uma importação).
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'revistorias') then
    alter publication supabase_realtime add table public.revistorias;
  end if;
end;
$$;

-- ── 2) Importação ────────────────────────────────────────────────────────────
-- A versão anterior (4 parâmetros) é substituída por esta, com p_revistorias opcional:
-- chamadas sem revistorias continuam funcionando igual.
drop function if exists public.aplicar_importacao_agendamentos(text, jsonb, jsonb, jsonb);

-- p_revistorias: [{unit_id, row, label, client, acao ('nova'|'atualizar'), numero,
--                  esperado: {status, data, horario}, novo: {status, status_planilha, data, horario}}]
--   nova:      numero = maior número que a unidade tinha na prévia (0 = nenhuma revistoria)
--   atualizar: numero = revistoria a atualizar; esperado = como ela estava na prévia
create or replace function public.aplicar_importacao_agendamentos(
  p_file text,
  p_summary jsonb,
  p_changes jsonb,
  p_items jsonb,
  p_revistorias jsonb default '[]'::jsonb
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
  rev_status text[] := array['Agendada', 'Em revistoria', 'Aprovada', 'Reprovada'];
  v_revs jsonb := coalesce(p_revistorias, '[]'::jsonb);
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
  -- revistorias
  rv jsonb;
  v_nv jsonb;
  v_last public.revistorias;
  v_row public.revistorias;
  v_old_data date;
  v_new_data date;
  v_reinsp date;
  v_label text;
  v_client text;
  v_line integer;
  v_pid bigint;
  v_msg text;
  f text;
  v_old text;
  v_new text;
  rev_new integer := 0;
  rev_upd integer := 0;
  rev_skip integer := 0;
  rev_units bigint[] := '{}';      -- unidades com vistoria ou revistoria alterada
  v_rev_units bigint[] := '{}';    -- unidades com revistoria criada/atualizada
begin
  if uid is null then
    raise exception 'Sessão inválida.' using errcode = '42501';
  end if;
  if jsonb_typeof(coalesce(p_changes, '[]'::jsonb)) <> 'array' or jsonb_typeof(coalesce(p_items, '[]'::jsonb)) <> 'array'
     or jsonb_typeof(v_revs) <> 'array' then
    raise exception 'Formato inválido.';
  end if;
  if jsonb_array_length(coalesce(p_changes, '[]'::jsonb)) > 20000 or jsonb_array_length(coalesce(p_items, '[]'::jsonb)) > 20000
     or jsonb_array_length(v_revs) > 20000 then
    raise exception 'Importação grande demais.';
  end if;

  -- Condomínios afetados: das unidades alteradas, das revistorias e dos itens registrados.
  select coalesce(array_agg(distinct pid), '{}') into v_projects from (
    select u.project_id as pid
      from jsonb_array_elements(coalesce(p_changes, '[]'::jsonb)) c
      join public.units u on u.id = (c ->> 'unit_id')::bigint
    union
    select u.project_id
      from jsonb_array_elements(v_revs) r
      join public.units u on u.id = (r ->> 'unit_id')::bigint
    union
    select coalesce((i ->> 'project_id')::bigint, u.project_id)
      from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) i
      left join public.units u on u.id = (i ->> 'unit_id')::bigint
     where coalesce((i ->> 'project_id')::bigint, u.project_id) is not null
  ) s;

  if exists (select 1 from unnest(v_projects) p(id) where private.is_project_admin(p.id) is not true) then
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
  -- Revistorias: unidade existente, ação conhecida, status da lista e data/horário no formato certo.
  if exists (
    select 1 from jsonb_array_elements(v_revs) r
     where (r ->> 'acao') is null or (r ->> 'acao') not in ('nova', 'atualizar')
        or jsonb_typeof(r -> 'novo') is distinct from 'object'
        or coalesce(r ->> 'numero', '') !~ '^\d{1,2}$'
        or ((r ->> 'acao') = 'atualizar' and ((r ->> 'numero')::int < 1 or jsonb_typeof(r -> 'esperado') is distinct from 'object'))
        or coalesce(r -> 'novo' ->> 'status', '') not in ('', 'Agendada', 'Em revistoria', 'Aprovada', 'Reprovada')
        or coalesce(r -> 'novo' ->> 'data', '') !~ '^(|20\d{2}-\d{2}-\d{2})$'
        or coalesce(r -> 'novo' ->> 'horario', '') !~ '^(|([01]\d|2[0-3]):[0-5]\d)$'
        or char_length(coalesce(r -> 'novo' ->> 'status_planilha', '')) > 80
        or (coalesce(r -> 'novo' ->> 'status', '') = '' and coalesce(r -> 'novo' ->> 'data', '') = ''
            and coalesce(r -> 'novo' ->> 'horario', '') = '')
        or not exists (select 1 from public.units u where u.id = (r ->> 'unit_id')::bigint)
  ) then
    raise exception 'Revistoria inválida: confira status, data e horário.';
  end if;
  -- Datas impossíveis (ex.: 31/02) são recusadas aqui, antes de gravar qualquer coisa.
  perform (r -> 'novo' ->> 'data')::date from jsonb_array_elements(v_revs) r where coalesce(r -> 'novo' ->> 'data', '') <> '';

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
      rev_units := array_append(rev_units, v_unit);
    end if;
  end loop;

  -- ── Revistorias ──
  for rv in select r from jsonb_array_elements(v_revs) r loop
    v_unit := (rv ->> 'unit_id')::bigint;
    v_pid := private.unit_project_id(v_unit);
    v_nv := rv -> 'novo';
    v_label := left(coalesce(rv ->> 'label', ''), 200);
    v_client := left(coalesce(rv ->> 'client', ''), 200);
    v_line := nullif(rv ->> 'row', '')::int;
    -- Uma unidade por vez: duas importações simultâneas não criam a mesma revistoria duas vezes.
    perform 1 from public.units where id = v_unit for no key update;
    select * into v_last from public.revistorias where unit_id = v_unit order by numero desc limit 1;
    v_old_data := v_last.data;

    if (rv ->> 'acao') = 'nova' then
      if coalesce(v_last.numero, 0) <> (rv ->> 'numero')::int then
        rev_skip := rev_skip + 1; skipped := skipped + 1;
        insert into public.importacoes_agendamentos_itens
          (import_id, project_id, unit_id, row_number, unit_label, client_name, field, old_value, new_value, action, message)
        values (v_import, v_pid, v_unit, v_line, v_label, v_client, 'revistoria', '', '', 'alterado_no_sistema',
                'As revistorias desta unidade mudaram depois da prévia; nada foi alterado.');
        continue;
      end if;
      insert into public.revistorias (project_id, unit_id, numero, status, status_planilha, data, horario,
                                      criado_import_id, atualizado_import_id, criado_por, atualizado_por)
      values (v_pid, v_unit, coalesce(v_last.numero, 0) + 1,
              nullif(v_nv ->> 'status', ''), left(coalesce(v_nv ->> 'status_planilha', ''), 80),
              nullif(v_nv ->> 'data', '')::date, nullif(v_nv ->> 'horario', '')::time,
              v_import, v_import, uid, uid)
      returning * into v_row;
      rev_new := rev_new + 1;
      v_msg := 'Revistoria nº ' || v_row.numero || ' (nova)';
      foreach f in array array['status', 'data', 'horario'] loop
        v_new := case f when 'status' then coalesce(v_row.status, '') when 'data' then coalesce(v_row.data::text, '')
                        else coalesce(left(v_row.horario::text, 5), '') end;
        if v_new <> '' then
          applied := applied + 1;
          insert into public.importacoes_agendamentos_itens
            (import_id, project_id, unit_id, row_number, unit_label, client_name, field, old_value, new_value, action, message)
          values (v_import, v_pid, v_unit, v_line, v_label, v_client, 'revistoria.' || f, '', v_new, 'preenchido', v_msg);
        end if;
      end loop;
    else
      -- Atualiza só se for a revistoria mais recente e ainda estiver como na prévia.
      if v_last.id is null or v_last.numero <> (rv ->> 'numero')::int
         or coalesce(v_last.status, '') <> coalesce(rv -> 'esperado' ->> 'status', '')
         or coalesce(v_last.data::text, '') <> coalesce(rv -> 'esperado' ->> 'data', '')
         or coalesce(left(v_last.horario::text, 5), '') <> coalesce(rv -> 'esperado' ->> 'horario', '') then
        rev_skip := rev_skip + 1; skipped := skipped + 1;
        insert into public.importacoes_agendamentos_itens
          (import_id, project_id, unit_id, row_number, unit_label, client_name, field, old_value, new_value, action, message)
        values (v_import, v_pid, v_unit, v_line, v_label, v_client, 'revistoria', '', '', 'alterado_no_sistema',
                'A revistoria mudou depois da prévia; nada foi alterado.');
        continue;
      end if;
      update public.revistorias
         set status = coalesce(nullif(v_nv ->> 'status', ''), status),
             status_planilha = case when coalesce(v_nv ->> 'status', '') <> '' then left(coalesce(v_nv ->> 'status_planilha', ''), 80)
                                    else status_planilha end,
             data = coalesce(nullif(v_nv ->> 'data', '')::date, data),
             horario = coalesce(nullif(v_nv ->> 'horario', '')::time, horario),
             atualizado_import_id = v_import,
             atualizado_por = uid,
             atualizado_em = now()
       where id = v_last.id
      returning * into v_row;
      v_msg := 'Revistoria nº ' || v_row.numero;
      foreach f in array array['status', 'data', 'horario'] loop
        v_old := case f when 'status' then coalesce(v_last.status, '') when 'data' then coalesce(v_last.data::text, '')
                        else coalesce(left(v_last.horario::text, 5), '') end;
        v_new := case f when 'status' then coalesce(v_row.status, '') when 'data' then coalesce(v_row.data::text, '')
                        else coalesce(left(v_row.horario::text, 5), '') end;
        if v_new <> v_old then
          applied := applied + 1;
          insert into public.importacoes_agendamentos_itens
            (import_id, project_id, unit_id, row_number, unit_label, client_name, field, old_value, new_value, action, message)
          values (v_import, v_pid, v_unit, v_line, v_label, v_client, 'revistoria.' || f, v_old, v_new,
                  case when v_old = '' then 'preenchido' else 'usado_planilha' end, v_msg);
        end if;
      end loop;
      rev_upd := rev_upd + 1;
    end if;
    rev_units := array_append(rev_units, v_unit);
    v_rev_units := array_append(v_rev_units, v_unit);

    -- Data da revistoria da unidade: acompanha a revistoria se estiver vazia ou igual à data anterior.
    v_new_data := v_row.data;
    if v_new_data is not null then
      select reinspection_date into v_reinsp from public.client_inspections where unit_id = v_unit for update;
      if found and v_reinsp is distinct from v_new_data then
        if v_reinsp is null or v_reinsp = v_old_data then
          update public.client_inspections set reinspection_date = v_new_data where unit_id = v_unit;
          applied := applied + 1;
          insert into public.importacoes_agendamentos_itens
            (import_id, project_id, unit_id, row_number, unit_label, client_name, field, old_value, new_value, action, message)
          values (v_import, v_pid, v_unit, v_line, v_label, v_client, 'reinspection_date', coalesce(v_reinsp::text, ''),
                  v_new_data::text, case when v_reinsp is null then 'preenchido' else 'usado_planilha' end, v_msg);
        else
          insert into public.importacoes_agendamentos_itens
            (import_id, project_id, unit_id, row_number, unit_label, client_name, field, old_value, new_value, action, message)
          values (v_import, v_pid, v_unit, v_line, v_label, v_client, 'reinspection_date', v_reinsp::text, v_new_data::text,
                  'mantido_sistema', 'A data da revistoria da unidade foi alterada no sistema e foi mantida.');
        end if;
      end if;
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
         summary = summary || jsonb_build_object('records_updated', touched,
                                                 'unidades_atualizadas', (select count(distinct x) from unnest(rev_units) x),
                                                 'revistorias_novas', rev_new,
                                                 'revistorias_atualizadas', rev_upd, 'revistorias_puladas', rev_skip)
   where id = v_import;

  return jsonb_build_object('import_id', v_import, 'applied', applied, 'skipped', skipped, 'records', touched,
                            'revistorias_novas', rev_new, 'revistorias_atualizadas', rev_upd,
                            'revistorias_puladas', rev_skip,
                            'unidades_revistoria', (select count(distinct x) from unnest(v_rev_units) x),
                            'unidades_atualizadas', (select count(distinct x) from unnest(rev_units) x));
end;
$$;

revoke all on function public.aplicar_importacao_agendamentos(text, jsonb, jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.aplicar_importacao_agendamentos(text, jsonb, jsonb, jsonb, jsonb) to authenticated;
