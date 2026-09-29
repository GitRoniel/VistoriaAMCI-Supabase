-- Status "Revistoria Finalizada" e papel "Revistorias".
--
-- Papéis por condomínio passam a ser: admin, revistorias e visitante.
-- (acab, inst, qual e astec deixam de existir; não havia usuários com eles.)
--
-- O papel "revistorias" só pode alterar unidades em "Revistoria" (ou já
-- "Revistoria Finalizada") dos condomínios em que está liberado, e a única
-- mudança de status permitida é Revistoria -> Revistoria Finalizada. Além do
-- status, pode ajustar apenas a data da revistoria e as observações.

alter table public.client_inspections drop constraint client_inspections_status_check;
alter table public.client_inspections
  add constraint client_inspections_status_check
  check (status in (
    'Não agendado', 'Agendado', 'Remarcado', 'Revistoria', 'Revistoria Finalizada', 'Aprovado'
  ));

update public.project_members
set role = 'visitante'
where role in ('acab', 'inst', 'qual', 'astec');

alter table public.project_members drop constraint project_members_role_check;
alter table public.project_members
  add constraint project_members_role_check
  check (role in ('admin', 'revistorias', 'visitante'));

create policy client_inspections_update_revistorias
on public.client_inspections
for update
to authenticated
using (
  private.project_role(private.unit_project_id(unit_id)) = 'revistorias'
  and status in ('Revistoria', 'Revistoria Finalizada')
)
with check (
  private.project_role(private.unit_project_id(unit_id)) = 'revistorias'
  and status in ('Revistoria', 'Revistoria Finalizada')
);

create or replace function private.enforce_revistorias_changes()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if (select auth.uid()) is null
     or private.project_role(private.unit_project_id(old.unit_id)) is distinct from 'revistorias' then
    return new;
  end if;

  if new.status is distinct from old.status
     and not (old.status = 'Revistoria' and new.status = 'Revistoria Finalizada') then
    raise exception 'o papel Revistorias só pode finalizar revistorias';
  end if;

  if new.client_name is distinct from old.client_name
     or new.inspection_date is distinct from old.inspection_date
     or new.inspection_time is distinct from old.inspection_time
     or new.responsible is distinct from old.responsible
     or new.sale_stage is distinct from old.sale_stage
     or new.technical_escort is distinct from old.technical_escort then
    raise exception 'o papel Revistorias só altera status, data da revistoria e observações';
  end if;

  return new;
end;
$$;

revoke all on function private.enforce_revistorias_changes() from public, anon, authenticated;

create trigger client_inspections_15_revistorias
before update on public.client_inspections
for each row execute function private.enforce_revistorias_changes();
