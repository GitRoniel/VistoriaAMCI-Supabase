-- Alto do Buriti: segundo condomínio, com casas em vez de apartamentos.
-- Tudo continua ligado por projects.id (o "condomínio"): units.project_id e,
-- através de units, client_inspections / unit_stage_status. Nenhuma tabela nova
-- é criada; as políticas de RLS existentes já isolam os dados por condomínio.

-- Tipo da unidade: apartamento (bloco + pavimento + apto) ou casa (conjunto + número).
alter table public.units
  add column kind text not null default 'apartamento',
  add column pcd boolean not null default false;

alter table public.units
  add constraint units_kind_check check (kind in ('apartamento', 'casa'));

-- Casas não têm pavimento; apartamentos continuam obrigando o pavimento.
alter table public.units drop constraint units_pav_not_blank;
alter table public.units
  add constraint units_pav_not_blank check (kind = 'casa' or length(btrim(pav)) > 0);

-- Etapa comercial do cliente (ex.: "Escritura Registrada", "Distrato"),
-- importada da relação de vendas e exibida junto ao cliente.
alter table public.client_inspections
  add column sale_stage text not null default '';

insert into public.projects (slug, name)
values ('alto-do-buriti', 'Alto do Buriti')
on conflict (slug) do update set name = excluded.name;

-- 319 casas: conjuntos A a R, com a quantidade de casas de cada conjunto.
insert into public.units (project_id, bloco, pav, apto, kind)
select projects.id, conjuntos.conjunto, '', lpad(casa::text, 2, '0'), 'casa'
from public.projects
cross join (
  values
    ('A', 7), ('B', 42), ('C', 10), ('D', 10), ('E', 10), ('F', 10),
    ('G', 10), ('H', 53), ('I', 49), ('J', 7), ('K', 8), ('L', 47),
    ('M', 10), ('N', 10), ('O', 10), ('P', 10), ('Q', 10), ('R', 6)
) as conjuntos (conjunto, total)
cross join lateral generate_series(1, conjuntos.total) as casa
where projects.slug = 'alto-do-buriti'
on conflict (project_id, bloco, pav, apto) do nothing;

-- Casas adaptadas (PCD).
update public.units
set pcd = true
from public.projects
where units.project_id = projects.id
  and projects.slug = 'alto-do-buriti'
  and (units.bloco, units.apto) in (
    ('A', '01'), ('A', '04'), ('A', '05'), ('A', '06'), ('A', '07'),
    ('C', '06'), ('C', '07'), ('C', '08'), ('C', '09'), ('C', '10')
  );

-- Cada casa começa com a vistoria "Não agendado".
insert into public.client_inspections (unit_id)
select units.id
from public.units
join public.projects on projects.id = units.project_id
where projects.slug = 'alto-do-buriti'
on conflict (unit_id) do nothing;

-- Novos cadastros geram uma solicitação pendente em cada condomínio; o
-- administrador de cada um decide se libera o acesso.
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

  insert into public.access_requests (
    project_id,
    user_id,
    email,
    full_name,
    requested_role,
    status
  )
  select
    projects.id,
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    'visitante',
    'pending'
  from public.projects
  on conflict (project_id, user_id) do update
    set email = excluded.email,
        full_name = excluded.full_name,
        updated_at = now();

  return new;
end;
$$;

revoke all on function private.handle_new_auth_user() from public, anon, authenticated;

-- Os administradores ativos do Alto do Jerivá também administram o Alto do Buriti,
-- para que alguém possa liberar os primeiros acessos do novo condomínio.
insert into public.project_members (project_id, user_id, role, active, updated_by)
select buriti.id, members.user_id, 'admin', true, members.user_id
from public.project_members as members
join public.projects as jeriva on jeriva.id = members.project_id and jeriva.slug = 'alto-do-jeriva'
cross join public.projects as buriti
where buriti.slug = 'alto-do-buriti'
  and members.role = 'admin'
  and members.active
on conflict (project_id, user_id) do nothing;
