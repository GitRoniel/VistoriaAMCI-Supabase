-- Cadastro de condomínios: tipo (apartamentos/casas), cor de destaque, nomes alternativos
-- da planilha de Vendas e funções para criar o condomínio com todas as unidades e ajustar
-- a estrutura das casas. Tudo aditivo: Jerivá e Buriti continuam iguais.

alter table public.projects
  add column if not exists kind text not null default 'apartamentos',
  add column if not exists color text not null default '#1f4a3f',
  add column if not exists import_aliases text[] not null default '{}',
  add column if not exists created_by uuid references public.profiles (id) on delete set null;

alter table public.projects
  drop constraint if exists projects_kind_check,
  add constraint projects_kind_check check (kind in ('apartamentos', 'casas')),
  drop constraint if exists projects_color_check,
  add constraint projects_color_check check (color ~ '^#[0-9a-fA-F]{6}$');

comment on column public.projects.kind is 'apartamentos: 8 blocos (A–H) × Térreo + 6 pavimentos × 8 aptos; casas: conjuntos com quantidade variável de casas.';
comment on column public.projects.color is 'Cor de destaque do condomínio (#RRGGBB).';
comment on column public.projects.import_aliases is 'Outros nomes do condomínio na planilha de Vendas (comparados sem acento/maiúsculas).';

-- Condomínios existentes: mesmo tipo e mesmas cores que o site já usava.
update public.projects set kind = 'apartamentos', color = '#0b6fd4' where slug = 'alto-do-jeriva';
update public.projects set kind = 'casas', color = '#8e44ad' where slug = 'alto-do-buriti';

-- Administradores editam cor e nomes alternativos (tipo e estrutura só pelas funções abaixo).
grant update (name, description, sort_order, color, import_aliases) on table public.projects to authenticated;

-- ── Auxiliares ────────────────────────────────────────────────────────────────
create or replace function private.is_any_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.project_members pm
     where pm.user_id = (select auth.uid()) and pm.active and pm.role = 'admin'
  )
$$;

create or replace function private.condominio_key(p_text text)
returns text
language sql
immutable
set search_path = ''
as $$
  select btrim(regexp_replace(
    translate(lower(coalesce(p_text, '')), 'áàâãäéèêëíìîïóòôõöúùûüçñ', 'aaaaaeeeeiiiiooooouuuucn'),
    '[^a-z0-9]+', ' ', 'g'))
$$;

-- Valida {"A": 7, "B": 42, ...}: conjuntos de 1 ou 2 letras e 1 a 300 casas cada.
create or replace function private.validar_conjuntos(p_groups jsonb)
returns void
language plpgsql
immutable
set search_path = ''
as $$
declare
  k text;
  v jsonb;
begin
  if jsonb_typeof(p_groups) <> 'object' or p_groups = '{}'::jsonb then
    raise exception 'Informe ao menos um conjunto com a quantidade de casas.';
  end if;
  if (select count(*) from jsonb_object_keys(p_groups)) > 60 then
    raise exception 'Máximo de 60 conjuntos.';
  end if;
  for k, v in select * from jsonb_each(p_groups) loop
    if k !~ '^[A-Z]{1,2}$' then
      raise exception 'Conjunto inválido: %', k;
    end if;
    if jsonb_typeof(v) <> 'number' or (v::text)::numeric <> floor((v::text)::numeric)
       or (v::text)::int < 1 or (v::text)::int > 300 then
      raise exception 'Quantidade de casas inválida no conjunto % (use de 1 a 300).', k;
    end if;
  end loop;
end;
$$;

-- ── Cadastro ─────────────────────────────────────────────────────────────────
-- Cria o condomínio, todas as unidades e as vistorias vazias numa única transação.
-- Quem cadastra e todos os demais administradores recebem acesso de administrador.
create or replace function public.criar_condominio(
  p_name text,
  p_kind text,
  p_color text,
  p_groups jsonb default null,
  p_description text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  v_name text := btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g'));
  v_slug text;
  v_base text;
  v_n integer := 1;
  v_project bigint;
  v_units integer;
begin
  if uid is null or not private.is_any_admin() then
    raise exception 'Somente administradores podem cadastrar condomínios.' using errcode = '42501';
  end if;
  if length(v_name) < 3 or length(v_name) > 80 then
    raise exception 'Informe o nome do condomínio (3 a 80 caracteres).';
  end if;
  if p_kind not in ('apartamentos', 'casas') then
    raise exception 'Tipo inválido.';
  end if;
  if coalesce(p_color, '') !~ '^#[0-9a-fA-F]{6}$' then
    raise exception 'Cor inválida.';
  end if;
  if exists (select 1 from public.projects p where private.condominio_key(p.name) = private.condominio_key(v_name)) then
    raise exception 'Já existe um condomínio com o nome "%".', v_name;
  end if;
  if p_kind = 'casas' then
    perform private.validar_conjuntos(p_groups);
  end if;

  v_base := coalesce(nullif(replace(private.condominio_key(v_name), ' ', '-'), ''), 'condominio');
  v_slug := v_base;
  while exists (select 1 from public.projects where slug = v_slug) loop
    v_n := v_n + 1;
    v_slug := v_base || '-' || v_n;
  end loop;

  insert into public.projects (slug, name, description, sort_order, kind, color, created_by)
  values (v_slug, v_name, left(btrim(coalesce(p_description, '')), 160),
          coalesce((select max(sort_order) from public.projects), 0) + 10, p_kind, lower(p_color), uid)
  returning id into v_project;

  if p_kind = 'apartamentos' then
    -- Mesmo modelo do Alto do Jerivá: blocos A–H, Térreo + 1º ao 6º, aptos 01–08 (448 unidades).
    insert into public.units (project_id, bloco, pav, apto, kind)
    select v_project, b, p, lpad(a::text, 2, '0'), 'apartamento'
      from unnest(array['A','B','C','D','E','F','G','H']) b
     cross join unnest(array['T','1º','2º','3º','4º','5º','6º']) p
     cross join generate_series(1, 8) a;
  else
    insert into public.units (project_id, bloco, pav, apto, kind)
    select v_project, g.key, '', lpad(n::text, 2, '0'), 'casa'
      from jsonb_each(p_groups) g
     cross join lateral generate_series(1, (g.value::text)::int) n;
  end if;

  insert into public.client_inspections (unit_id)
  select u.id from public.units u where u.project_id = v_project;
  get diagnostics v_units = row_count;

  insert into public.project_members (project_id, user_id, role, active, updated_by)
  select v_project, a.user_id, 'admin', true, uid
    from (
      select uid as user_id
      union
      select pm.user_id from public.project_members pm where pm.active and pm.role = 'admin'
    ) a
  on conflict (project_id, user_id) do nothing;

  return jsonb_build_object('project_id', v_project, 'slug', v_slug, 'units', v_units);
end;
$$;

-- ── Estrutura das casas ──────────────────────────────────────────────────────
-- Acrescenta conjuntos/casas e remove as que saíram, mas bloqueia a remoção de
-- qualquer casa que já tenha dados cadastrados (cliente, data, status, etc.).
create or replace function public.atualizar_estrutura_condominio(p_project bigint, p_groups jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_kind text;
  v_blocked text;
  v_added integer := 0;
  v_removed integer := 0;
begin
  if (select auth.uid()) is null or not private.is_project_admin(p_project) then
    raise exception 'Somente administradores deste condomínio podem alterar a estrutura.' using errcode = '42501';
  end if;
  select kind into v_kind from public.projects where id = p_project for update;
  if v_kind is distinct from 'casas' then
    raise exception 'A estrutura só pode ser ajustada em condomínios de casas.';
  end if;
  perform private.validar_conjuntos(p_groups);

  -- Casas que saem da estrutura (conjunto removido ou número acima da nova quantidade).
  select string_agg('Conj. ' || r.bloco || ' casa ' || ltrim(r.apto, '0'), ', ' order by r.bloco, r.apto)
    into v_blocked
    from (
      select u.bloco, u.apto
        from public.units u
        join public.client_inspections ci on ci.unit_id = u.id
       where u.project_id = p_project
         and not (case when p_groups ? u.bloco and u.apto ~ '^[0-9]+$' then u.apto::int <= (p_groups ->> u.bloco)::int else false end)
         and (ci.client_name <> '' or ci.inspection_date is not null or ci.inspection_time is not null
              or ci.status <> 'Não agendado' or ci.responsible <> '' or ci.notes <> ''
              or ci.reinspection_date is not null or ci.sale_stage <> '' or ci.technical_escort <> '')
       order by u.bloco, u.apto
       limit 30
    ) r;
  if v_blocked is not null then
    raise exception 'Não é possível remover casas com dados cadastrados: %', v_blocked;
  end if;

  delete from public.units u
   where u.project_id = p_project
     and not (case when p_groups ? u.bloco and u.apto ~ '^[0-9]+$' then u.apto::int <= (p_groups ->> u.bloco)::int else false end);
  get diagnostics v_removed = row_count;

  with novas as (
    insert into public.units (project_id, bloco, pav, apto, kind)
    select p_project, g.key, '', lpad(n::text, 2, '0'), 'casa'
      from jsonb_each(p_groups) g
     cross join lateral generate_series(1, (g.value::text)::int) n
     where not exists (
       select 1 from public.units u
        where u.project_id = p_project and u.bloco = g.key and u.apto = lpad(n::text, 2, '0'))
    returning id
  )
  insert into public.client_inspections (unit_id) select id from novas;
  get diagnostics v_added = row_count;

  return jsonb_build_object('added', v_added, 'removed', v_removed,
    'total', (select count(*) from public.units where project_id = p_project));
end;
$$;

revoke all on function public.criar_condominio(text, text, text, jsonb, text) from public, anon;
revoke all on function public.atualizar_estrutura_condominio(bigint, jsonb) from public, anon;
grant execute on function public.criar_condominio(text, text, text, jsonb, text) to authenticated;
grant execute on function public.atualizar_estrutura_condominio(bigint, jsonb) to authenticated;
revoke all on function private.is_any_admin() from public, anon;
grant execute on function private.is_any_admin() to authenticated;
