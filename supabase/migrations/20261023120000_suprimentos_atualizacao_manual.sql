-- Suprimentos: execução manual do robô UAU-Sync (Relatório 1187) pelo administrador do módulo.
-- Cada pedido feito pelo botão "Atualizar relatório agora" vira uma linha aqui, com quem pediu, quando,
-- a execução do GitHub Actions disparada e o resultado. Só a função suprimentos-atualizar grava
-- (com a chave de serviço, depois de conferir que quem chamou é administrador de Suprimentos).
-- Não altera as tabelas do robô (pedidos_execucoes etc.), o agendamento nem as políticas existentes.
create table if not exists public.robo_execucoes_manuais (
  id bigint generated always as identity primary key,
  modulo text not null default 'suprimentos' check (modulo in ('suprimentos')),
  relatorios text not null,
  status text not null default 'aguardando' check (status in ('aguardando', 'executando', 'concluido', 'erro')),
  solicitado_por uuid references public.profiles (id) on delete set null,
  solicitado_email text not null default '',
  solicitado_em timestamptz not null default now(),
  iniciado_em timestamptz,
  finalizado_em timestamptz,
  github_run_id bigint,
  github_run_url text,
  detalhe text,
  atualizado_em timestamptz not null default now()
);
comment on table public.robo_execucoes_manuais is
  'Execuções manuais do robô UAU-Sync pedidas no site (botão "Atualizar relatório agora"). Gravação só pela função suprimentos-atualizar.';

-- Uma execução manual ativa por vez (protege contra cliques duplicados e pedidos simultâneos).
create unique index if not exists robo_execucoes_manuais_uma_ativa
  on public.robo_execucoes_manuais (modulo) where status in ('aguardando', 'executando');
create index if not exists robo_execucoes_manuais_recentes
  on public.robo_execucoes_manuais (modulo, solicitado_em desc);

alter table public.robo_execucoes_manuais enable row level security;
revoke all on table public.robo_execucoes_manuais from anon, authenticated;
grant select on table public.robo_execucoes_manuais to authenticated;
-- Só o administrador do módulo lê o registro; ninguém grava pela API (sem políticas de escrita).
create policy suprimentos_admin_le_execucoes_manuais on public.robo_execucoes_manuais
  for select to authenticated
  using (private.is_module_admin(modulo));
