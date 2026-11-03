-- Controle de Chaves: novo setor "Entregue para Cliente" (código 'cliente').
-- A chave pode ser transferida (ou regularizada) para o cliente como para qualquer outro setor.
-- Só amplia as listas de setores aceitos; nenhum dado muda. O status da vistoria não é tocado.

alter table public.chaves_unidades drop constraint if exists chaves_unidades_setor_check;
alter table public.chaves_unidades add constraint chaves_unidades_setor_check
  check (setor is null or setor in ('base', 'cx', 'asstec', 'producao', 'cliente'));

alter table public.chaves_movimentacoes drop constraint if exists chaves_movimentacoes_setor_check;
alter table public.chaves_movimentacoes add constraint chaves_movimentacoes_setor_check
  check (setor in ('base', 'cx', 'asstec', 'producao', 'cliente'));
alter table public.chaves_movimentacoes drop constraint if exists chaves_mov_setor_origem_check;
alter table public.chaves_movimentacoes add constraint chaves_mov_setor_origem_check
  check (setor_origem is null or setor_origem in ('base', 'cx', 'asstec', 'producao', 'cliente'));

alter table public.chaves_ocorrencias drop constraint if exists chaves_ocorrencias_setor_anterior_check;
alter table public.chaves_ocorrencias add constraint chaves_ocorrencias_setor_anterior_check
  check (setor_anterior is null or setor_anterior in ('base', 'cx', 'asstec', 'producao', 'cliente'));
alter table public.chaves_ocorrencias drop constraint if exists chaves_ocorrencias_regularizada_setor_check;
alter table public.chaves_ocorrencias add constraint chaves_ocorrencias_regularizada_setor_check
  check (regularizada_setor is null or regularizada_setor in ('base', 'cx', 'asstec', 'producao', 'cliente'));

comment on column public.chaves_unidades.setor is
  'Setor responsável pela chave da unidade agora: base, cx, asstec, producao ou cliente (entregue para o cliente); null = sem status.';

-- Transferência: aceita o novo setor (mesmas regras de antes).
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
  if p_setor is null or p_setor not in ('base', 'cx', 'asstec', 'producao', 'cliente') then
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
  rotulo := case p_setor when 'base' then 'Base' when 'cx' then 'CX' when 'asstec' then 'Asstec'
                         when 'producao' then 'Produção' else 'Entregue para Cliente' end;
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

-- Regularização da chave perdida: a nova chave também pode ir direto para o cliente.
create or replace function public.chaves_regularizar(p_unit_id bigint, p_setor text, p_responsavel text,
  p_observacoes text default '', p_ultima_mov bigint default null, p_pedido uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare u public.units; cu public.chaves_unidades; rep jsonb; o public.chaves_ocorrencias; m public.chaves_movimentacoes; v_nome text; v_obs text := btrim(coalesce(p_observacoes, '')); v_email text;
begin
  if (select private.chaves_pedido_existente(p_pedido)) is not null then return private.chaves_pedido_existente(p_pedido); end if;
  if p_setor is null or p_setor not in ('base', 'cx', 'asstec', 'producao', 'cliente') then raise exception 'Selecione o setor que ficará com a nova chave'; end if;
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
