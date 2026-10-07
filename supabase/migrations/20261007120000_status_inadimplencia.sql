-- Novo status de vistoria do cliente: "Inadimplência" (cinza, último da lista).
-- Aplicada em produção em 07/10/2026. Os status existentes não mudam.
alter table public.client_inspections drop constraint client_inspections_status_check;
alter table public.client_inspections add constraint client_inspections_status_check check (status = any (array[
  'Não agendado', 'Agendado', 'Remarcado', 'Revistoria', 'Revistoria Finalizada', 'Aprovado', 'Inadimplência'
]::text[]));
