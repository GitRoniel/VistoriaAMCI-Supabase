-- Observações dos pedidos (public.pedidos_observacoes, relatório 9001): mesma regra das demais
-- tabelas do ERP de Suprimentos (ver 20261001150432_plataforma_modulos_rls_erp e
-- 20261001150440_plataforma_modulos_somente_leitura_erp).
--   • leitura só para quem tem o módulo Suprimentos (antes: qualquer usuário autenticado);
--   • nenhuma escrita pelo navegador. O robô grava pela função observacoes_robo (security definer,
--     protegida por token), que não é afetada.
-- Aplicada em produção em 03/10/2026. A política antiga "leitura autenticados" foi alterada para a
-- mesma condição (alter policy) e pode ser removida; o efeito é o mesmo.
alter policy "leitura autenticados" on public.pedidos_observacoes
  using (private.has_module('suprimentos'));

do $$ begin
  if not exists (select 1 from pg_policy where polrelid = 'public.pedidos_observacoes'::regclass and polname = 'suprimentos_le_observacoes') then
    create policy suprimentos_le_observacoes on public.pedidos_observacoes
      for select to authenticated using (private.has_module('suprimentos'));
  end if;
end $$;

revoke insert, update, delete, truncate, references, trigger
  on table public.pedidos_observacoes, public.pedidos_observacoes_atual
  from authenticated;
