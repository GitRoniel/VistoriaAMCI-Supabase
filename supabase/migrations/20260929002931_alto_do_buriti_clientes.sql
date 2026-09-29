-- Vínculo dos clientes/proprietários às 319 casas do Alto do Buriti.
--
-- Esta migração foi aplicada diretamente no Supabase a partir da planilha de vendas
-- (conjunto + casa -> client_inspections.client_name e client_inspections.sale_stage).
-- O conteúdo contém dados pessoais e, por isso, não é versionado no Git
-- (mesma regra de data-import/*.csv no .gitignore). O arquivo existe apenas para
-- manter o histórico de migrações local alinhado com o projeto remoto.
select 1;
