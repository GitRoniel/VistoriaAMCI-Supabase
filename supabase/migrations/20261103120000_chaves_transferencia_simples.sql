-- Controle de Chaves simplificado: a chave da unidade é acompanhada como um todo, por setor.
--
-- Antes: cadastro de cada cópia (entrada, quartos, banheiros), retirada/devolução com conferência de
-- quantidades, ocorrências e tipologia. Agora: cada unidade do Mapa das Vistorias tem um setor
-- responsável (Base, CX, Asstec ou Produção) e um responsável pela chave; a única operação é
-- "Transferir para outro setor", registrada no histórico.
--
-- Reaproveita a estrutura existente, sem apagar dados:
--   chaves_unidades        passa a guardar a situação atual da unidade (setor, responsável, última
--                          movimentação e quem a registrou); sem linha ou sem setor = "Sem status"
--   chaves_movimentacoes   continua sendo o histórico imutável; ganha setor de origem e responsável
--                          anterior. Movimentações antigas (levantamento da planilha etc.) ficam como estão.
--   chaves                 cadastro por cópia de chave: deixa de ser usado; as linhas ficam guardadas
--                          (somente leitura) e servem só para calcular a situação inicial abaixo.
-- Permissões e RLS não mudam: leitura para membros do condomínio; admin e revistorias transferem;
-- visitante só consulta. Escrita só pela função chaves_transferir.

-- 1) Situação atual por unidade
alter table public.chaves_unidades
  add column if not exists setor text,
  add column if not exists responsavel text not null default '',
  add column if not exists movimentado_em timestamptz,
  add column if not exists movimentado_por text not null default '',
  add column if not exists movimentacao_id bigint;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'chaves_unidades_setor_check') then
    alter table public.chaves_unidades add constraint chaves_unidades_setor_check
      check (setor is null or setor in ('base', 'cx', 'asstec', 'producao'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'chaves_unidades_movimentacao_fk') then
    alter table public.chaves_unidades add constraint chaves_unidades_movimentacao_fk
      foreign key (movimentacao_id) references public.chaves_movimentacoes (id) on delete set null;
  end if;
end $$;
comment on column public.chaves_unidades.setor is 'Setor responsável pela chave da unidade agora (null = sem status).';
comment on column public.chaves_unidades.responsavel is 'Pessoa responsável pela chave agora (quem recebeu na última transferência).';
comment on column public.chaves_unidades.movimentado_em is 'Data e hora da última movimentação.';
comment on column public.chaves_unidades.movimentado_por is 'E-mail de quem registrou a última movimentação.';

-- 2) Histórico: de onde veio e com quem estava
alter table public.chaves_movimentacoes
  add column if not exists setor_origem text,
  add column if not exists responsavel_anterior text not null default '';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'chaves_mov_setor_origem_check') then
    alter table public.chaves_movimentacoes add constraint chaves_mov_setor_origem_check
      check (setor_origem is null or setor_origem in ('base', 'cx', 'asstec', 'producao'));
  end if;
end $$;
comment on column public.chaves_movimentacoes.setor_origem is 'Transferência: setor de onde a chave saiu (null = sem status).';
comment on column public.chaves_movimentacoes.responsavel_anterior is 'Transferência: quem estava com a chave antes.';
comment on table public.chaves is
  'Controle de Chaves (modelo anterior, por cópia de chave): não é mais usado; guardado só para consulta.';

-- 3) Situação inicial de cada unidade, a partir do que já está registrado:
--    chave retirada no modelo anterior → setor/responsável da retirada mais recente;
--    chaves na Base ou "tem chave" no levantamento da planilha → Base; senão, sem status.
update public.chaves_unidades as cu
   set setor = s.setor, responsavel = s.responsavel, movimentado_em = s.quando,
       movimentado_por = s.por, movimentacao_id = s.mov
  from (
    select cu2.unit_id,
           case when f.unit_id is not null then f.local
                when cu2.tem_chaves or b.unit_id is not null then 'base' end as setor,
           coalesce(f.responsavel, '') as responsavel,
           coalesce(f.retirada_em, ult.data_hora) as quando,
           coalesce(mf.registrado_email, ult.registrado_email, '') as por,
           coalesce(f.movimentacao_id, ult.id) as mov
      from public.chaves_unidades cu2
      left join lateral (
        select k.unit_id, k.local, k.responsavel, k.retirada_em, k.movimentacao_id
          from public.chaves k
         where k.unit_id = cu2.unit_id and k.situacao = 'ativa' and k.local <> 'base'
         order by k.retirada_em desc nulls last, k.id desc limit 1) f on true
      left join lateral (
        select k.unit_id from public.chaves k where k.unit_id = cu2.unit_id and k.situacao = 'ativa' limit 1) b on true
      left join lateral (
        select m.id, m.data_hora, m.registrado_email from public.chaves_movimentacoes m
         where m.unit_id = cu2.unit_id order by m.registrado_em desc, m.id desc limit 1) ult on true
      left join public.chaves_movimentacoes mf on mf.id = f.movimentacao_id
  ) s
 where s.unit_id = cu.unit_id and cu.setor is null and cu.movimentacao_id is null;

-- 4) Funções do modelo anterior saem (cadastro de cópias, retirada/devolução com conferência,
--    ocorrência e tipologia). A coluna units.quartos e os dados ficam.
drop function if exists public.chaves_cadastrar(bigint, jsonb, text, uuid);
drop function if exists public.chaves_retirar(bigint, bigint[], text, text, timestamptz, timestamptz, text, uuid);
drop function if exists public.chaves_transferir(bigint, bigint[], text, text, timestamptz, timestamptz, text, uuid);
drop function if exists public.chaves_devolver(bigint, bigint[], text, timestamptz, text, text, uuid);
drop function if exists public.chaves_ocorrencia(bigint, text, bigint[], timestamptz, uuid);
drop function if exists public.chaves_definir_tipologia(bigint[], smallint);
drop function if exists private.chaves_travar(bigint, bigint[]);
drop function if exists private.chaves_registrar(public.units, text, text, text, text, timestamptz, timestamptz, jsonb, text, uuid);

-- 5) Transferir para outro setor.
--    p_ultima_mov: última movimentação que a tela mostrava (null = nenhuma). Se outra pessoa
--    transferiu a chave nesse meio-tempo, nada é gravado e a tela é atualizada.
--    p_pedido: identificador do envio; o mesmo pedido (clique duplo, nova tentativa) nunca grava duas vezes.
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

revoke all on function public.chaves_transferir(bigint, text, text, bigint, uuid) from public, anon;
grant execute on function public.chaves_transferir(bigint, text, text, bigint, uuid) to authenticated;
