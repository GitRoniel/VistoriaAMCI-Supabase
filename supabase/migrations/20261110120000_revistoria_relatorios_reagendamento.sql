-- Revistoria · Cliente e Vistoria: agendamento sem vistoriador obrigatório, reagendamento da vistoria
-- pelo popup e relatórios da revistoria (PDF no Storage + checklist de apontamentos).
--
-- 1) revistoria_agendar: o responsável (vistoriador) passa a ser opcional. Nada mais muda.
--    Importação da planilha (aplicar_importacao_agendamentos) ganha p_sincronizar_data: a importação feita
--    pela aba Revistoria · Cliente não altera nada da vistoria.
-- 2) Vistoria · Cliente: vistoria_reagendar muda só a data/horário da VISTORIA (client_inspections),
--    status Agendado/Remarcado → Remarcado, e guarda o agendamento anterior em
--    public.vistorias_reagendamentos (quem, quando, de/para, justificativa). Só administradores, como
--    a edição da vistoria hoje. Não toca nas revistorias.
-- 3) Relatórios: PDFs no Storage (bucket privado "revistorias-relatorios", caminho
--    <condomínio>/<bloco>/<apto>/<arquivo>.pdf, até 25 MB, só PDF); no banco só os metadados
--    (public.revistorias_relatorios). Leitura por URL assinada de quem tem acesso ao condomínio;
--    envio e remoção por admin e revistorias. Nada de PDF dentro das tabelas.
--    public.revistorias_apontamentos: checklist de cada relatório (marcar/desmarcar), sem alterar o PDF.
-- RLS: leitura por membro do condomínio; escrita só pelas funções. Não apaga nem altera dados existentes.

-- ── 1) Agendamento da revistoria sem responsável obrigatório ─────────────────
create or replace function public.revistoria_agendar(p_unit_id bigint, p_data date, p_horario text, p_responsavel text,
  p_observacoes text default '', p_versao bigint default null, p_pedido uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare a public.revistorias_cliente; rv public.revistorias; r jsonb; v_resp text := ''; v_obs text; v_hora time;
        v_ant text; v_tipo text := 'agendamento'; v_num smallint; v_antiga smallint;
begin
  r := private.revcli_repetido(p_pedido); if r is not null then return r; end if;
  if p_data is null then raise exception 'Informe a data da revistoria'; end if;
  if p_data < date '2020-01-01' or p_data > private.revcli_hoje() + 730 then raise exception 'Data da revistoria inválida'; end if;
  if coalesce(p_horario, '') <> '' then
    if p_horario !~ '^([01]\d|2[0-3]):[0-5]\d$' then raise exception 'Horário inválido (use HH:MM)'; end if;
    v_hora := p_horario::time;
  end if;
  -- vistoriador opcional: em branco = agendado pela equipe de revistorias sem vistoriador definido
  if btrim(coalesce(p_responsavel, '')) <> '' then v_resp := private.revcli_nome(p_responsavel, 'o responsável pela revistoria'); end if;
  v_obs := private.revcli_texto(p_observacoes);

  perform private.revcli_travar(p_unit_id);
  r := private.revcli_repetido(p_pedido); if r is not null then return r; end if;
  a := private.revcli_atual(p_unit_id, p_versao);
  if a.status = 'Aprovado' then
    raise exception 'A revistoria desta unidade já foi aprovada. Use "Reabrir" se houver novas pendências.';
  end if;
  perform set_config('app.revcli', 'on', true);
  v_ant := a.status;
  if a.status = 'Agendado' then   -- remarcação: o agendamento anterior fica no histórico
    update public.revistorias set status = 'Cancelada', resultado_obs = 'Remarcada para ' || private.revcli_data_br(p_data),
           atualizado_em = now(), atualizado_por = (select auth.uid())
     where unit_id = p_unit_id and status in ('Agendada', 'Em revistoria')
    returning numero into v_antiga;
    v_tipo := 'remarcacao';
  end if;
  select coalesce(max(numero), 0) + 1 into v_num from public.revistorias where unit_id = p_unit_id;
  if v_num > 99 then raise exception 'Limite de agendamentos da unidade atingido'; end if;
  insert into public.revistorias (project_id, unit_id, numero, status, data, horario, responsavel, observacoes, origem, ciclo,
                                  criado_por, atualizado_por)
  values (a.project_id, p_unit_id, v_num, 'Agendada', p_data, v_hora, v_resp, v_obs, 'SISTEMA', a.ciclo,
          (select auth.uid()), (select auth.uid()))
  returning * into rv;
  a := private.revcli_mudar(a.id, 'Agendado', a.ciclo, rv.id);
  perform private.revcli_evento(a, rv.id, v_tipo, v_ant,
    case when v_tipo = 'remarcacao' then 'Remarcada' || coalesce(' (agendamento nº ' || v_antiga || ' cancelado)', '') || ': '
         else 'Agendada: ' end ||
    private.revcli_data_br(p_data) || coalesce(' às ' || to_char(v_hora, 'HH24:MI'), '') ||
    case when v_resp <> '' then ' · Responsável: ' || v_resp else ' · sem vistoriador definido' end ||
    case when v_obs <> '' then ' · ' || v_obs else '' end, p_pedido);
  perform set_config('app.revcli', 'off', true);
  return jsonb_build_object('ok', true, 'acompanhamento', to_jsonb(a), 'revistoria', to_jsonb(rv));
end $$;

-- ── 1b) Importação da planilha só de revistorias ─────────────────────────────
-- aplicar_importacao_agendamentos ganha p_sincronizar_data (padrão true = igual a antes). A importação
-- feita pela aba Revistoria · Cliente envia false: só as revistorias mudam; a vistoria (inclusive a
-- "Data da revistoria" da unidade) fica intacta. Corpo idêntico ao de 20261027120000, fora essa condição.
drop function if exists public.aplicar_importacao_agendamentos(text, jsonb, jsonb, jsonb, jsonb);

create or replace function public.aplicar_importacao_agendamentos(
  p_file text,
  p_summary jsonb,
  p_changes jsonb,
  p_items jsonb,
  p_revistorias jsonb default '[]'::jsonb,
  p_sincronizar_data boolean default true
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
    -- Importação só de revistorias (aba Revistoria · Cliente): não toca em nenhum dado da vistoria.
    if v_new_data is not null and coalesce(p_sincronizar_data, true) then
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

revoke all on function public.aplicar_importacao_agendamentos(text, jsonb, jsonb, jsonb, jsonb, boolean) from public, anon;
grant execute on function public.aplicar_importacao_agendamentos(text, jsonb, jsonb, jsonb, jsonb, boolean) to authenticated;

-- ── 2) Reagendamento da vistoria ─────────────────────────────────────────────
create table if not exists public.vistorias_reagendamentos (
  id bigint generated always as identity primary key,
  project_id bigint not null references public.projects (id) on delete cascade,
  unit_id bigint not null references public.units (id) on delete cascade,
  inspection_id bigint references public.client_inspections (id) on delete cascade,
  status_anterior text not null,
  data_anterior date,
  horario_anterior time,
  data_nova date not null,
  horario_nova time,
  observacao text not null default '' check (char_length(observacao) <= 500),
  registrado_por uuid references public.profiles (id) on delete set null,
  registrado_email text not null default '',
  registrado_em timestamptz not null default now()
);
comment on table public.vistorias_reagendamentos is
  'Vistoria · Cliente: histórico de cada reagendamento da vistoria feito pelo popup (data/horário anteriores e novos, justificativa, usuário). Gravação só por public.vistoria_reagendar.';
create index if not exists vistorias_reagendamentos_unit_idx on public.vistorias_reagendamentos (unit_id, registrado_em desc);
create index if not exists vistorias_reagendamentos_project_idx on public.vistorias_reagendamentos (project_id);
alter table public.vistorias_reagendamentos enable row level security;
revoke all on table public.vistorias_reagendamentos from public, anon, authenticated;
grant select on table public.vistorias_reagendamentos to authenticated;
drop policy if exists vistorias_reagendamentos_select_member on public.vistorias_reagendamentos;
create policy vistorias_reagendamentos_select_member on public.vistorias_reagendamentos
  for select to authenticated using (private.project_role(project_id) is not null);

create or replace function public.vistoria_reagendar(p_unit_id bigint, p_data date, p_horario text, p_observacao text default '',
  p_version bigint default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare ci public.client_inspections; v_pid bigint; v_hora time; v_obs text := btrim(coalesce(p_observacao, '')); h public.vistorias_reagendamentos;
begin
  if p_data is null then raise exception 'Informe a nova data da vistoria'; end if;
  if p_data < date '2020-01-01' or p_data > private.revcli_hoje() + 730 then raise exception 'Data da vistoria inválida'; end if;
  if coalesce(p_horario, '') <> '' then
    if p_horario !~ '^([01]\d|2[0-3]):[0-5]\d$' then raise exception 'Horário inválido (use HH:MM)'; end if;
    v_hora := p_horario::time;
  end if;
  if char_length(v_obs) > 500 then raise exception 'Observação muito longa (máximo de 500 caracteres)'; end if;
  select project_id into v_pid from public.units where id = p_unit_id;
  if v_pid is null then raise exception 'Unidade não encontrada'; end if;
  if not private.is_project_admin(v_pid) then
    raise exception 'Somente administradores reagendam a vistoria' using errcode = '42501';
  end if;
  select * into ci from public.client_inspections where unit_id = p_unit_id for update;
  if not found then raise exception 'Vistoria da unidade não encontrada'; end if;
  if p_version is not null and ci.version <> p_version then
    raise exception 'A vistoria desta unidade acabou de ser alterada por outra pessoa. Confira e tente de novo.';
  end if;
  if ci.status not in ('Agendado', 'Remarcado') then
    raise exception 'Só uma vistoria agendada ou remarcada pode ser reagendada (status atual: %)', ci.status;
  end if;
  if ci.inspection_date is not distinct from p_data and ci.inspection_time is not distinct from v_hora then
    raise exception 'A nova data e o novo horário são iguais aos atuais';
  end if;
  insert into public.vistorias_reagendamentos (project_id, unit_id, inspection_id, status_anterior, data_anterior, horario_anterior,
                                               data_nova, horario_nova, observacao, registrado_por, registrado_email)
  values (v_pid, p_unit_id, ci.id, ci.status, ci.inspection_date, ci.inspection_time, p_data, v_hora, v_obs,
          (select auth.uid()), private.revcli_email())
  returning * into h;
  update public.client_inspections set inspection_date = p_data, inspection_time = v_hora, status = 'Remarcado'
   where id = ci.id
  returning * into ci;
  return jsonb_build_object('ok', true, 'vistoria', to_jsonb(ci), 'reagendamento', to_jsonb(h));
end $$;

-- ── 3) Relatórios da revistoria (Storage) e checklist ────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('revistorias-relatorios', 'revistorias-relatorios', false, 26214400, array['application/pdf'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- Condomínio dono do arquivo (1ª pasta do caminho); nulo se o caminho não seguir o padrão.
create or replace function private.revrel_projeto(p_nome text)
returns bigint language sql immutable set search_path = '' as $$
  select case when split_part(p_nome, '/', 1) ~ '^\d{1,18}$' then split_part(p_nome, '/', 1)::bigint end
$$;
grant execute on function private.revrel_projeto(text) to authenticated;
-- usadas nas políticas do Storage (rodam com o papel do usuário): só dizem o papel dele no condomínio
grant execute on function private.revcli_pode_editar(bigint) to authenticated;

drop policy if exists revistorias_relatorios_ler on storage.objects;
create policy revistorias_relatorios_ler on storage.objects for select to authenticated
  using (bucket_id = 'revistorias-relatorios' and private.project_role(private.revrel_projeto(name)) is not null);
drop policy if exists revistorias_relatorios_enviar on storage.objects;
create policy revistorias_relatorios_enviar on storage.objects for insert to authenticated
  with check (bucket_id = 'revistorias-relatorios' and private.revcli_pode_editar(private.revrel_projeto(name))
              and lower(name) like '%.pdf');
drop policy if exists revistorias_relatorios_apagar on storage.objects;
create policy revistorias_relatorios_apagar on storage.objects for delete to authenticated
  using (bucket_id = 'revistorias-relatorios' and private.revcli_pode_editar(private.revrel_projeto(name)));

create table if not exists public.revistorias_relatorios (
  id bigint generated always as identity primary key,
  project_id bigint not null references public.projects (id) on delete cascade,
  unit_id bigint not null references public.units (id) on delete cascade,
  revistoria_id bigint references public.revistorias (id) on delete set null,
  caminho text not null unique check (char_length(caminho) <= 400),
  nome_arquivo text not null default '' check (char_length(nome_arquivo) <= 200),
  tamanho bigint check (tamanho is null or tamanho between 0 and 26214400),
  paginas integer check (paginas is null or paginas between 0 and 2000),
  resumo jsonb not null default '{}'::jsonb check (pg_column_size(resumo) <= 8192),
  enviado_em timestamptz not null default now(),
  enviado_por uuid references public.profiles (id) on delete set null,
  enviado_email text not null default '',
  removido_em timestamptz,
  removido_email text not null default ''
);
comment on column public.revistorias_relatorios.resumo is 'Dados lidos do PDF ao enviar (unidade, data realizada, responsável, nº de não conformidades); o PDF não é alterado.';
comment on table public.revistorias_relatorios is
  'Relatórios (PDF) da revistoria por unidade: só metadados; o arquivo fica no Storage (bucket revistorias-relatorios). removido_em = retirado (o arquivo é apagado do Storage).';
create index if not exists revistorias_relatorios_unit_idx on public.revistorias_relatorios (unit_id, enviado_em desc);
create index if not exists revistorias_relatorios_project_idx on public.revistorias_relatorios (project_id);

create table if not exists public.revistorias_apontamentos (
  id bigint generated always as identity primary key,
  project_id bigint not null references public.projects (id) on delete cascade,
  unit_id bigint not null references public.units (id) on delete cascade,
  relatorio_id bigint references public.revistorias_relatorios (id) on delete cascade,
  ordem integer not null default 1,
  texto text not null check (char_length(texto) between 1 and 600),
  concluido boolean not null default false,
  concluido_em timestamptz,
  concluido_email text not null default '',
  criado_em timestamptz not null default now(),
  criado_email text not null default ''
);
comment on table public.revistorias_apontamentos is
  'Checklist dos apontamentos do relatório da revistoria (marcar/desmarcar). Não altera o PDF original.';
create index if not exists revistorias_apontamentos_unit_idx on public.revistorias_apontamentos (unit_id, relatorio_id, ordem);

alter table public.revistorias_relatorios enable row level security;
alter table public.revistorias_apontamentos enable row level security;
revoke all on table public.revistorias_relatorios, public.revistorias_apontamentos from public, anon, authenticated;
grant select on table public.revistorias_relatorios, public.revistorias_apontamentos to authenticated;
drop policy if exists revistorias_relatorios_select_member on public.revistorias_relatorios;
create policy revistorias_relatorios_select_member on public.revistorias_relatorios
  for select to authenticated using (private.project_role(project_id) is not null);
drop policy if exists revistorias_apontamentos_select_member on public.revistorias_apontamentos;
create policy revistorias_apontamentos_select_member on public.revistorias_apontamentos
  for select to authenticated using (private.project_role(project_id) is not null);

alter table public.revistorias_eventos drop constraint if exists revistorias_eventos_tipo_check;
alter table public.revistorias_eventos add constraint revistorias_eventos_tipo_check
  check (tipo in ('entrada', 'agendamento', 'remarcacao', 'cancelamento', 'resultado', 'reabertura', 'vistoria', 'planilha',
                  'liberacao', 'execucao', 'relatorio'));

-- Registra o PDF já enviado ao Storage (caminho do condomínio da unidade, arquivo existente, sem duplicar).
create or replace function public.revistoria_relatorio_registrar(p_unit_id bigint, p_caminho text, p_nome text default '',
  p_tamanho bigint default null, p_paginas integer default null, p_resumo jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_pid bigint; a public.revistorias_cliente; rel public.revistorias_relatorios; v_nome text := left(btrim(coalesce(p_nome, '')), 200);
begin
  v_pid := private.revcli_travar(p_unit_id);
  a := private.revcli_linha(p_unit_id);
  if coalesce(p_caminho, '') !~ ('^' || v_pid || '/[^/]+/[^/]+/[^/]+\.pdf$') then raise exception 'Caminho do arquivo inválido'; end if;
  if not exists (select 1 from storage.objects where bucket_id = 'revistorias-relatorios' and name = p_caminho) then
    raise exception 'O arquivo não foi encontrado no armazenamento. Envie de novo.';
  end if;
  select * into rel from public.revistorias_relatorios where caminho = p_caminho;
  if found then return jsonb_build_object('ok', true, 'repetido', true, 'relatorio', to_jsonb(rel)); end if;
  if jsonb_typeof(coalesce(p_resumo, '{}'::jsonb)) <> 'object' or pg_column_size(coalesce(p_resumo, '{}'::jsonb)) > 8192 then
    raise exception 'Resumo do relatório inválido';
  end if;
  insert into public.revistorias_relatorios (project_id, unit_id, revistoria_id, caminho, nome_arquivo, tamanho, paginas, resumo, enviado_por, enviado_email)
  values (v_pid, p_unit_id, a.revistoria_id, p_caminho, v_nome, p_tamanho, p_paginas, coalesce(p_resumo, '{}'::jsonb), (select auth.uid()), private.revcli_email())
  returning * into rel;
  perform private.revcli_evento(a, a.revistoria_id, 'relatorio', a.status, 'Relatório anexado: ' || coalesce(nullif(v_nome, ''), 'PDF'));
  return jsonb_build_object('ok', true, 'relatorio', to_jsonb(rel));
end $$;

-- Retira o relatório (o arquivo é apagado do Storage pela tela, com a política de remoção).
create or replace function public.revistoria_relatorio_remover(p_relatorio_id bigint)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare rel public.revistorias_relatorios; a public.revistorias_cliente;
begin
  select * into rel from public.revistorias_relatorios where id = p_relatorio_id;
  if not found or rel.removido_em is not null then raise exception 'Relatório não encontrado'; end if;
  perform private.revcli_travar(rel.unit_id);
  update public.revistorias_relatorios set removido_em = now(), removido_email = private.revcli_email() where id = rel.id returning * into rel;
  select * into a from public.revistorias_cliente where unit_id = rel.unit_id;
  if found then perform private.revcli_evento(a, null, 'relatorio', a.status, 'Relatório retirado: ' || coalesce(nullif(rel.nome_arquivo, ''), 'PDF')); end if;
  return jsonb_build_object('ok', true, 'caminho', rel.caminho);
end $$;

-- Checklist: adiciona itens (lista de textos), marca/desmarca e remove.
create or replace function public.revistoria_apontamentos_adicionar(p_relatorio_id bigint, p_textos jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare rel public.revistorias_relatorios; v_ordem int; n int := 0; t text;
begin
  if jsonb_typeof(coalesce(p_textos, '[]'::jsonb)) <> 'array' or jsonb_array_length(p_textos) = 0 then raise exception 'Informe os apontamentos'; end if;
  if jsonb_array_length(p_textos) > 300 then raise exception 'Apontamentos demais de uma vez (máximo de 300)'; end if;
  select * into rel from public.revistorias_relatorios where id = p_relatorio_id and removido_em is null;
  if not found then raise exception 'Relatório não encontrado'; end if;
  perform private.revcli_travar(rel.unit_id);
  select coalesce(max(ordem), 0) into v_ordem from public.revistorias_apontamentos where relatorio_id = rel.id;
  for t in select btrim(regexp_replace(x, '\s+', ' ', 'g')) from jsonb_array_elements_text(p_textos) x loop
    continue when t = '';
    if char_length(t) > 600 then raise exception 'Apontamento muito longo (máximo de 600 caracteres)'; end if;
    v_ordem := v_ordem + 1; n := n + 1;
    insert into public.revistorias_apontamentos (project_id, unit_id, relatorio_id, ordem, texto, criado_email)
    values (rel.project_id, rel.unit_id, rel.id, v_ordem, t, private.revcli_email());
  end loop;
  if n = 0 then raise exception 'Informe os apontamentos'; end if;
  return jsonb_build_object('ok', true, 'adicionados', n);
end $$;

create or replace function public.revistoria_apontamento_marcar(p_id bigint, p_concluido boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare ap public.revistorias_apontamentos;
begin
  select * into ap from public.revistorias_apontamentos where id = p_id;
  if not found then raise exception 'Apontamento não encontrado'; end if;
  perform private.revcli_travar(ap.unit_id);
  update public.revistorias_apontamentos
     set concluido = coalesce(p_concluido, false),
         concluido_em = case when coalesce(p_concluido, false) then now() end,
         concluido_email = case when coalesce(p_concluido, false) then private.revcli_email() else '' end
   where id = p_id returning * into ap;
  return jsonb_build_object('ok', true, 'apontamento', to_jsonb(ap));
end $$;

create or replace function public.revistoria_apontamento_remover(p_id bigint)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare ap public.revistorias_apontamentos;
begin
  select * into ap from public.revistorias_apontamentos where id = p_id;
  if not found then raise exception 'Apontamento não encontrado'; end if;
  perform private.revcli_travar(ap.unit_id);
  delete from public.revistorias_apontamentos where id = p_id;
  return jsonb_build_object('ok', true);
end $$;

revoke all on function private.revrel_projeto(text) from public, anon;
do $$
declare f text;
begin
  foreach f in array array[
    'public.vistoria_reagendar(bigint, date, text, text, bigint)',
    'public.revistoria_relatorio_registrar(bigint, text, text, bigint, integer, jsonb)',
    'public.revistoria_relatorio_remover(bigint)',
    'public.revistoria_apontamentos_adicionar(bigint, jsonb)',
    'public.revistoria_apontamento_marcar(bigint, boolean)',
    'public.revistoria_apontamento_remover(bigint)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

-- Tempo real: checklist, relatórios e reagendamentos aparecem em outros aparelhos.
do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['revistorias_relatorios', 'revistorias_apontamentos', 'vistorias_reagendamentos'] loop
      if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;
