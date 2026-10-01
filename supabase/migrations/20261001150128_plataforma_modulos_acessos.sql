-- Plataforma: acesso por módulo (Suprimentos, Contratos).
-- Vistorias continua com o controle por condomínio (project_members); os novos módulos usam
-- module_members. Para incluir um módulo no futuro, acrescente-o ao check de "module".
create table if not exists public.module_members (
  user_id uuid not null references public.profiles (id) on delete cascade,
  module text not null check (module in ('suprimentos', 'contratos')),
  role text not null default 'leitor' check (role in ('leitor', 'admin')),
  active boolean not null default true,
  granted_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, module)
);
comment on table public.module_members is
  'Acesso aos módulos da plataforma além de Vistorias. leitor: consulta; admin: consulta e libera acessos do módulo.';
create table if not exists public.module_access_log (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  actor_user_id uuid references public.profiles (id) on delete set null,
  actor_email text not null default '',
  target_user_id uuid references public.profiles (id) on delete set null,
  target_email text not null default '',
  module text not null,
  action text not null check (action in ('conceder', 'alterar', 'retirar')),
  role text
);
alter table public.module_members enable row level security;
alter table public.module_access_log enable row level security;
-- Escrita só pelas funções de gestão de acesso.
revoke all on table public.module_members from anon, authenticated;
revoke all on table public.module_access_log from anon, authenticated;
grant select on table public.module_members to authenticated;
grant select on table public.module_access_log to authenticated;
create or replace function private.has_module(p_module text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.module_members mm
     where mm.user_id = (select auth.uid()) and mm.module = p_module and mm.active)
$$;
create or replace function private.is_module_admin(p_module text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.module_members mm
     where mm.user_id = (select auth.uid()) and mm.module = p_module and mm.active and mm.role = 'admin')
$$;
revoke all on function private.has_module(text) from public, anon;
revoke all on function private.is_module_admin(text) from public, anon;
grant execute on function private.has_module(text) to authenticated;
grant execute on function private.is_module_admin(text) to authenticated;
-- Cada um vê os próprios acessos; o administrador do módulo vê todos daquele módulo.
create policy module_members_select on public.module_members
  for select to authenticated
  using (user_id = (select auth.uid()) or private.is_module_admin(module));
create policy module_access_log_select on public.module_access_log
  for select to authenticated
  using (private.is_module_admin(module));
-- Acesso inicial: dono da plataforma como administrador dos dois módulos.
insert into public.module_members (user_id, module, role, active)
select p.id, m.module, 'admin', true
  from public.profiles p
 cross join (values ('suprimentos'), ('contratos')) as m(module)
 where lower(p.email) in ('roniellwilker@gmail.com', 'roniell.sousa@altomangueiral.com')
on conflict (user_id, module) do nothing;
