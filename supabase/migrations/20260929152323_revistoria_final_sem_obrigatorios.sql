-- "Revistoria Finalizada" deixa de exigir data e responsável da revistoria.
-- Os campos continuam existindo e podem ser preenchidos quando o usuário quiser.
drop trigger if exists client_inspections_16_revistoria_final on public.client_inspections;
drop function if exists private.require_reinspection_fields();
