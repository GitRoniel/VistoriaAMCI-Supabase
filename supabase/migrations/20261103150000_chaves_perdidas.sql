-- Controle de Chaves: chave perdida / sem status e acompanhamento do chaveiro.
--
-- Uma unidade pode ter a chave marcada como perdida (extraviada ou indisponível) em qualquer situação
-- da vistoria: a ocorrência é independente de client_inspections, que nunca é alterado aqui.
-- Fluxo: Marcar chave perdida → Chaveiro solicitado → Cópia realizada → Regularizar chave.
--   - Ao marcar, a unidade fica "Sem status": o setor e o responsável anteriores deixam de valer
--     (ficam registrados na ocorrência e no histórico).
--   - Enquanto a ocorrência estiver aberta, a chave não pode ser transferida: só volta a um setor pela
--     regularização explícita (setor + quem recebe a nova chave).
--   - Cada passo grava uma linha no histórico imutável (chaves_movimentacoes), com usuário e horário.
-- Reaproveita chaves_unidades (situação atual) e chaves_movimentacoes (histórico); nada é apagado.
-- RLS e permissões iguais às transferências: leitura para membros do condomínio; admin e revistorias
-- registram; visitante só consulta. Escrita só pelas funções abaixo.

-- 1) Ocorrência de chave perdida (uma aberta por unidade; o andamento atualiza a mesma linha)
create table if not exists public.chaves_ocorrencias (
  id bigint generated always as identity primary key,
  project_id bigint not null references public.projects (id) on delete cascade,
  unit_id bigint not null references public.units (id) on delete cascade,
  etapa text not null default 'perdida'
    check (etapa in ('perdida', 'chaveiro_solicitado', 'copia_realizada', 'regularizada')),
  motivo text not null default '' check (char_length(motivo) <= 500),
  setor_anterior text check (setor_anterior is null or setor_anterior in ('base', 'cx', 'asstec', 'producao')),
  responsavel_anterior text not null default '',
  identificado_por text not null,
  registrado_em timestamptz not null default now(),
  registrado_email text not null default '',
  chaveiro_em timestamptz,
  chaveiro_por text not null default '',
  chaveiro_email text not null default '',
  chaveiro_obs text not null default '',
  copia_em timestamptz,
  copia_por text not null default '',
  copia_email text not null default '',
  copia_obs text not null default '',
  regularizada_em timestamptz,
  regularizada_setor text check (regularizada_setor is null or regularizada_setor in ('base', 'cx', 'asstec', 'producao')),
  regularizada_recebido_por text not null default '',
  regularizada_email text not null default '',
  atualizado_em timestamptz not null default now()
);
comment on table public.chaves_ocorrencias is
  'Controle de Chaves: chave perdida/extraviada da unidade e o andamento até a regularização (chaveiro, cópia, novo responsável).';
create unique index if not exists chaves_ocorrencias_uma_aberta on public.chaves_ocorrencias (unit_id) where etapa <> 'regularizada';
create index if not exists chaves_ocorrencias_project_idx on public.chaves_ocorrencias (project_id, etapa);

alter table public.chaves_ocorrencias enable row level security;
revoke all on table public.chaves_ocorrencias from public, anon, authenticated;
grant select on table public.chaves_ocorrencias to authenticated;
drop policy if exists chaves_ocorrencias_select_member on public.chaves_ocorrencias;
create policy chaves_ocorrencias_select_member on public.chaves_ocorrencias
  for select to authenticated using (private.project_role(project_id) is not null);

-- 2) Situação atual aponta para a ocorrência aberta; histórico ganha os passos da ocorrência
alter table public.chaves_unidades add column if not exists ocorrencia_id bigint;
alter table public.chaves_movimentacoes add column if not exists ocorrencia_id bigint;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'chaves_unidades_ocorrencia_fk') then
    alter table public.chaves_unidades add constraint chaves_unidades_ocorrencia_fk
      foreign key (ocorrencia_id) references public.chaves_ocorrencias (id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'chaves_movimentacoes_ocorrencia_fk') then
    alter table public.chaves_movimentacoes add constraint chaves_movimentacoes_ocorrencia_fk
      foreign key (ocorrencia_id) references public.chaves_ocorrencias (id) on delete cascade;
  end if;
end $$;
comment on column public.chaves_unidades.ocorrencia_id is 'Ocorrência de chave perdida em aberto (null = chave sem ocorrência).';

alter table public.chaves_movimentacoes drop constraint if exists chaves_movimentacoes_tipo_check;
alter table public.chaves_movimentacoes add constraint chaves_movimentacoes_tipo_check check (tipo in (
  'cadastro', 'retirada', 'devolucao', 'transferencia', 'ocorrencia', 'perda', 'chaveiro', 'copia', 'regularizacao'));

-- 3) Helpers
create or replace function private.chaves_nome(p text, p_campo text)
returns text language plpgsql immutable set search_path = '' as $$
declare v text := btrim(regexp_replace(coalesce(p, ''), '\s+', ' ', 'g'));
begin
  if char_length(v) < 2 then raise exception 'Informe %', p_campo; end if;
  if char_length(v) > 80 then raise exception 'Nome muito longo (%)', p_campo; end if;
  return v;
end $$;
revoke all on function private.chaves_nome(text, text) from public, anon, authenticated;

-- Tela desatualizada: outra pessoa movimentou a chave depois que a tela foi aberta.
create or replace function private.chaves_conferir_atual(p_atual bigint, p_vista bigint)
returns void language plpgsql immutable set search_path = '' as $$
begin
  if p_atual is distinct from p_vista then
    raise exception 'A chave desta unidade acabou de ser movimentada por outra pessoa. Confira a situação atual e tente de novo.';
  end if;
end $$;
revoke all on function private.chaves_conferir_atual(bigint, bigint) from public, anon, authenticated;

-- Histórico (usuário e horário automáticos) + situação atual apontando para o novo registro.
create or replace function private.chaves_historico(p_u public.units, p_tipo text, p_setor text, p_setor_origem text,
  p_responsavel text, p_anterior text, p_obs text, p_ocorrencia bigint, p_pedido uuid)
returns public.chaves_movimentacoes language plpgsql security definer set search_path = '' as $$
declare m public.chaves_movimentacoes; v_email text;
begin
  select email into v_email from public.profiles where id = (select auth.uid());
  insert into public.chaves_movimentacoes (project_id, unit_id, tipo, setor, setor_origem, responsavel, responsavel_anterior,
                                           data_hora, observacoes, registrado_por, registrado_email, pedido_id, ocorrencia_id)
  values (p_u.project_id, p_u.id, p_tipo, p_setor, p_setor_origem, coalesce(p_responsavel, ''), coalesce(p_anterior, ''),
          now(), btrim(coalesce(p_obs, '')), (select auth.uid()), coalesce(v_email, ''), p_pedido, p_ocorrencia)
  returning * into m;
  update public.chaves_unidades set movimentado_em = m.data_hora, movimentado_por = m.registrado_email, movimentacao_id = m.id,
         atualizado_em = now(), atualizado_por = (select auth.uid())
   where unit_id = p_u.id;
  return m;
end $$;
revoke all on function private.chaves_historico(public.units, text, text, text, text, text, text, bigint, uuid) from public, anon, authenticated;

-- 4) Marcar chave como perdida / sem status
create or replace function public.chaves_marcar_perdida(p_unit_id bigint, p_identificado_por text, p_motivo text default '',
  p_ultima_mov bigint default null, p_pedido uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare u public.units; cu public.chaves_unidades; rep jsonb; o public.chaves_ocorrencias; m public.chaves_movimentacoes; v_nome text; v_motivo text := btrim(coalesce(p_motivo, ''));
begin
  if (select private.chaves_pedido_existente(p_pedido)) is not null then return private.chaves_pedido_existente(p_pedido); end if;
  v_nome := private.chaves_nome(p_identificado_por, 'o responsável pelo registro');
  if char_length(v_motivo) > 500 then raise exception 'Motivo muito longo (máximo de 500 caracteres)'; end if;
  -- trava a unidade, confere permissão, pedido repetido (chamada simultânea) e tela desatualizada
  u := private.chaves_unidade(p_unit_id);
  if not private.chaves_pode_movimentar(u.project_id) then
    raise exception 'Seu acesso a este condomínio não permite registrar ocorrências de chave';
  end if;
  rep := private.chaves_pedido_existente(p_pedido); if rep is not null then return rep; end if;
  select * into cu from public.chaves_unidades where unit_id = u.id;
  perform private.chaves_conferir_atual(cu.movimentacao_id, p_ultima_mov);
  if cu.ocorrencia_id is not null then raise exception 'A chave desta unidade já está registrada como perdida'; end if;
  insert into public.chaves_ocorrencias (project_id, unit_id, motivo, setor_anterior, responsavel_anterior, identificado_por, registrado_email)
  values (u.project_id, u.id, v_motivo, cu.setor, coalesce(cu.responsavel, ''), v_nome,
          coalesce((select email from public.profiles where id = (select auth.uid())), ''))
  returning * into o;
  m := private.chaves_historico(u, 'perda', null, cu.setor, v_nome, cu.responsavel, v_motivo, o.id, p_pedido);
  update public.chaves_unidades set setor = null, responsavel = '', ocorrencia_id = o.id where unit_id = u.id;
  return jsonb_build_object('ok', true, 'movimentacao', to_jsonb(m), 'ocorrencia', to_jsonb(o));
end $$;

-- 5) Andamento: chaveiro solicitado ou cópia realizada (atualiza a mesma ocorrência)
create or replace function public.chaves_ocorrencia_andamento(p_unit_id bigint, p_etapa text, p_responsavel text,
  p_observacoes text default '', p_ultima_mov bigint default null, p_pedido uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare u public.units; cu public.chaves_unidades; rep jsonb; o public.chaves_ocorrencias; m public.chaves_movimentacoes; v_nome text; v_obs text := btrim(coalesce(p_observacoes, '')); v_email text;
begin
  if (select private.chaves_pedido_existente(p_pedido)) is not null then return private.chaves_pedido_existente(p_pedido); end if;
  if p_etapa is null or p_etapa not in ('chaveiro_solicitado', 'copia_realizada') then raise exception 'Etapa inválida'; end if;
  v_nome := private.chaves_nome(p_responsavel, case p_etapa when 'chaveiro_solicitado' then 'quem solicitou o chaveiro' else 'o responsável pela cópia' end);
  if char_length(v_obs) > 500 then raise exception 'Observação muito longa (máximo de 500 caracteres)'; end if;
  -- trava a unidade, confere permissão, pedido repetido (chamada simultânea) e tela desatualizada
  u := private.chaves_unidade(p_unit_id);
  if not private.chaves_pode_movimentar(u.project_id) then
    raise exception 'Seu acesso a este condomínio não permite registrar ocorrências de chave';
  end if;
  rep := private.chaves_pedido_existente(p_pedido); if rep is not null then return rep; end if;
  select * into cu from public.chaves_unidades where unit_id = u.id;
  perform private.chaves_conferir_atual(cu.movimentacao_id, p_ultima_mov);
  select * into o from public.chaves_ocorrencias where id = cu.ocorrencia_id for update;
  if not found then raise exception 'Não há chave perdida registrada nesta unidade'; end if;
  if p_etapa = 'chaveiro_solicitado' and o.etapa <> 'perdida' then raise exception 'O chaveiro já foi solicitado para esta chave'; end if;
  if p_etapa = 'copia_realizada' and o.etapa = 'copia_realizada' then raise exception 'A cópia já foi registrada'; end if;
  select email into v_email from public.profiles where id = (select auth.uid());
  if p_etapa = 'chaveiro_solicitado' then
    update public.chaves_ocorrencias set etapa = p_etapa, chaveiro_em = now(), chaveiro_por = v_nome, chaveiro_email = coalesce(v_email, ''),
           chaveiro_obs = v_obs, atualizado_em = now() where id = o.id returning * into o;
  else
    update public.chaves_ocorrencias set etapa = p_etapa, copia_em = now(), copia_por = v_nome, copia_email = coalesce(v_email, ''),
           copia_obs = v_obs, atualizado_em = now() where id = o.id returning * into o;
  end if;
  m := private.chaves_historico(u, case p_etapa when 'chaveiro_solicitado' then 'chaveiro' else 'copia' end, null, null, v_nome, '', v_obs, o.id, p_pedido);
  return jsonb_build_object('ok', true, 'movimentacao', to_jsonb(m), 'ocorrencia', to_jsonb(o));
end $$;

-- 6) Regularizar: a nova chave vai para um setor e um responsável; a unidade volta ao controle normal
create or replace function public.chaves_regularizar(p_unit_id bigint, p_setor text, p_responsavel text,
  p_observacoes text default '', p_ultima_mov bigint default null, p_pedido uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare u public.units; cu public.chaves_unidades; rep jsonb; o public.chaves_ocorrencias; m public.chaves_movimentacoes; v_nome text; v_obs text := btrim(coalesce(p_observacoes, '')); v_email text;
begin
  if (select private.chaves_pedido_existente(p_pedido)) is not null then return private.chaves_pedido_existente(p_pedido); end if;
  if p_setor is null or p_setor not in ('base', 'cx', 'asstec', 'producao') then raise exception 'Selecione o setor que ficará com a nova chave'; end if;
  v_nome := private.chaves_nome(p_responsavel, 'o responsável que está recebendo a chave');
  if char_length(v_obs) > 500 then raise exception 'Observação muito longa (máximo de 500 caracteres)'; end if;
  -- trava a unidade, confere permissão, pedido repetido (chamada simultânea) e tela desatualizada
  u := private.chaves_unidade(p_unit_id);
  if not private.chaves_pode_movimentar(u.project_id) then
    raise exception 'Seu acesso a este condomínio não permite registrar ocorrências de chave';
  end if;
  rep := private.chaves_pedido_existente(p_pedido); if rep is not null then return rep; end if;
  select * into cu from public.chaves_unidades where unit_id = u.id;
  perform private.chaves_conferir_atual(cu.movimentacao_id, p_ultima_mov);
  select * into o from public.chaves_ocorrencias where id = cu.ocorrencia_id for update;
  if not found then raise exception 'Não há chave perdida registrada nesta unidade'; end if;
  select email into v_email from public.profiles where id = (select auth.uid());
  update public.chaves_ocorrencias set etapa = 'regularizada', regularizada_em = now(), regularizada_setor = p_setor,
         regularizada_recebido_por = v_nome, regularizada_email = coalesce(v_email, ''), atualizado_em = now()
   where id = o.id returning * into o;
  m := private.chaves_historico(u, 'regularizacao', p_setor, null, v_nome, '', v_obs, o.id, p_pedido);
  update public.chaves_unidades set setor = p_setor, responsavel = v_nome, ocorrencia_id = null, tem_chaves = true where unit_id = u.id;
  return jsonb_build_object('ok', true, 'movimentacao', to_jsonb(m), 'ocorrencia', to_jsonb(o));
end $$;

-- 7) Transferência: chave perdida só volta a um setor pela regularização
create or replace function public.chaves_transferir(
  p_unit_id bigint,
  p_setor text,
  p_responsavel text,
  p_ultima_mov bigint default null,
  p_pedido uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  u public.units;
  cu public.chaves_unidades;
  m public.chaves_movimentacoes;
  r jsonb;
  v_resp text := btrim(regexp_replace(coalesce(p_responsavel, ''), '\s+', ' ', 'g'));
  v_email text;
  rotulo text;
begin
  r := private.chaves_pedido_existente(p_pedido); if r is not null then return r; end if;
  if p_setor is null or p_setor not in ('base', 'cx', 'asstec', 'producao') then
    raise exception 'Selecione o setor de destino';
  end if;
  if char_length(v_resp) < 2 then raise exception 'Informe o responsável que está recebendo a chave'; end if;
  if char_length(v_resp) > 80 then raise exception 'Nome do responsável muito longo'; end if;

  u := private.chaves_unidade(p_unit_id);   -- cria a linha da unidade se preciso e a trava
  if not private.chaves_pode_movimentar(u.project_id) then
    raise exception 'Seu acesso a este condomínio não permite transferir chaves';
  end if;
  -- pedido gravado por uma chamada simultânea que terminou enquanto esta esperava a trava
  r := private.chaves_pedido_existente(p_pedido); if r is not null then return r; end if;

  select * into cu from public.chaves_unidades where unit_id = u.id;
  if cu.movimentacao_id is distinct from p_ultima_mov then
    raise exception 'A chave desta unidade acabou de ser movimentada por outra pessoa. Confira a situação atual e tente de novo.';
  end if;
  if cu.ocorrencia_id is not null then
    raise exception 'A chave desta unidade está registrada como perdida. Use "Regularizar chave" quando a nova cópia estiver pronta.';
  end if;
  rotulo := case p_setor when 'base' then 'Base' when 'cx' then 'CX' when 'asstec' then 'Asstec' else 'Produção' end;
  if cu.setor is not distinct from p_setor and lower(cu.responsavel) = lower(v_resp) then
    raise exception 'A chave já está com % (%)', cu.responsavel, rotulo;
  end if;

  select email into v_email from public.profiles where id = (select auth.uid());
  insert into public.chaves_movimentacoes (project_id, unit_id, tipo, setor, setor_origem, responsavel, responsavel_anterior,
                                           data_hora, registrado_por, registrado_email, pedido_id)
  values (u.project_id, u.id, 'transferencia', p_setor, cu.setor, v_resp, coalesce(cu.responsavel, ''),
          now(), (select auth.uid()), coalesce(v_email, ''), p_pedido)
  returning * into m;

  update public.chaves_unidades
     set setor = p_setor, responsavel = v_resp, movimentado_em = m.data_hora, movimentado_por = m.registrado_email,
         movimentacao_id = m.id, tem_chaves = true, atualizado_em = now(), atualizado_por = (select auth.uid())
   where unit_id = u.id
  returning * into cu;

  return jsonb_build_object('ok', true, 'movimentacao', to_jsonb(m), 'unidade', to_jsonb(cu));
end;
$$;

revoke all on function public.chaves_marcar_perdida(bigint, text, text, bigint, uuid) from public, anon;
revoke all on function public.chaves_ocorrencia_andamento(bigint, text, text, text, bigint, uuid) from public, anon;
revoke all on function public.chaves_regularizar(bigint, text, text, text, bigint, uuid) from public, anon;
grant execute on function public.chaves_marcar_perdida(bigint, text, text, bigint, uuid) to authenticated;
grant execute on function public.chaves_ocorrencia_andamento(bigint, text, text, text, bigint, uuid) to authenticated;
grant execute on function public.chaves_regularizar(bigint, text, text, text, bigint, uuid) to authenticated;

-- 8) Tempo real
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'chaves_ocorrencias') then
    alter publication supabase_realtime add table public.chaves_ocorrencias;
  end if;
end $$;
