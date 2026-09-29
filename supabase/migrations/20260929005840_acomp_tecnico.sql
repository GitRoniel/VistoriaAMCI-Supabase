-- Acompanhamento técnico da vistoria do cliente (vale para todos os condomínios).
-- Um único campo em client_inspections, usado pela Lista e pelo Mapa.
--   ''          -> não informado
--   engenheiro  -> Engenheiro
--   arquiteto   -> Arquiteto
--   nenhum      -> Sem Acomp. Técnico
alter table public.client_inspections
  add column technical_escort text not null default '';

alter table public.client_inspections
  add constraint client_inspections_technical_escort_check
  check (technical_escort in ('', 'engenheiro', 'arquiteto', 'nenhum'));
