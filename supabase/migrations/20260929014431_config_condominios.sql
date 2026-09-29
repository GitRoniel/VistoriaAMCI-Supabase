-- Configuração de condomínios: título (projects.name), descrição e ordem de
-- exibição na tela de seleção. Editável pelo administrador de cada condomínio.

alter table public.projects
  add column description text not null default '',
  add column sort_order integer not null default 100;

alter table public.projects
  add constraint projects_name_not_blank check (length(btrim(name)) > 0);

-- Valores atuais (antes fixos no frontend).
update public.projects
set sort_order = 1, description = 'Acompanhamento da obra e vistorias dos clientes.'
where slug = 'alto-do-jeriva';

update public.projects
set sort_order = 2, description = 'Vistorias dos clientes · 319 casas nos conjuntos A a R.'
where slug = 'alto-do-buriti';

-- Somente o admin do condomínio altera nome, descrição e ordem (slug e id ficam fixos).
create policy projects_update_admin
on public.projects
for update
to authenticated
using (private.is_project_admin(id))
with check (private.is_project_admin(id));

grant update (name, description, sort_order) on table public.projects to authenticated;
