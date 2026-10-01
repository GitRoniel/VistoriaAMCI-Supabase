-- Dados do ERP (relatórios 1187 e 549): antes qualquer usuário logado lia pedidos, contratos,
-- fornecedores, CPF/CNPJ e valores (inclusive cadastros ainda não aprovados). Agora a leitura
-- exige acesso ao módulo. O robô grava pelas funções pedidos_robo/contratos_robo (security
-- definer), então não é afetado.
alter policy "logados leem registros 1187" on public.pedidos_registros_1187 rename to suprimentos_le_registros_1187;
alter policy suprimentos_le_registros_1187 on public.pedidos_registros_1187 to authenticated using (private.has_module('suprimentos'));
alter policy "logados leem execucoes" on public.pedidos_execucoes rename to suprimentos_le_execucoes;
alter policy suprimentos_le_execucoes on public.pedidos_execucoes to authenticated using (private.has_module('suprimentos') or private.has_module('contratos'));
alter policy "logados leem arquivos" on public.pedidos_arquivos rename to suprimentos_le_arquivos;
alter policy suprimentos_le_arquivos on public.pedidos_arquivos to authenticated using (private.has_module('suprimentos'));
alter policy "leitura autenticados" on public.contratos_registros_549 rename to contratos_le_registros_549;
alter policy contratos_le_registros_549 on public.contratos_registros_549 to authenticated using (private.has_module('contratos'));
