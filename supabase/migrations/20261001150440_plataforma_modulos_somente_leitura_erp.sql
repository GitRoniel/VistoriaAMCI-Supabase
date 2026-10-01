-- O navegador só lê os dados do ERP; gravação apenas pelo robô (funções security definer).
revoke insert, update, delete, truncate, references, trigger
  on table public.pedidos_registros_1187, public.pedidos_execucoes, public.pedidos_arquivos,
           public.pedidos_registros_atual, public.contratos_registros_549, public.contratos_registros_atual
  from authenticated;
