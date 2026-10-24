-- Controle de Chaves (claviculário digital) integrado às vistorias dos condomínios.
--
-- Reutiliza: projects (condomínio), units (bloco/pavimento/apto, agora com a tipologia), profiles
-- (usuário), project_members (papel por condomínio) e client_inspections (status da vistoria, só
-- leitura: o módulo não grava nem copia o status). Tudo aditivo; nada existente é alterado ou apagado.
--
-- Novas tabelas:
--   chaves_unidades        cadastro da unidade no claviculário (levantamento: tem ou não chaves)
--   chaves                 uma linha por cópia física de chave (Entrada, Quarto n, Banheiro n) e onde
--                          ela está agora: Base (claviculário, disponível) ou com CX, Asstec ou Produção
--   chaves_movimentacoes   histórico imutável: cadastro, retirada, devolução, transferência, ocorrência
--
-- Escrita só pelas funções chaves_* (security definer), que conferem o papel no condomínio, travam as
-- chaves envolvidas (select … for update) e validam a disponibilidade de cada uma; o mesmo pedido
-- (pedido_id) nunca gera duas movimentações. Leitura: membros ativos do condomínio (RLS).
-- Papéis: admin cadastra chaves e tipologia e movimenta; revistorias movimenta; visitante só consulta.

-- 1) Tipologia da unidade (número de quartos). Null = não informada.
alter table public.units add column if not exists quartos smallint;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'units_quartos_check') then
    alter table public.units add constraint units_quartos_check check (quartos is null or quartos between 1 and 6);
  end if;
end $$;
comment on column public.units.quartos is 'Tipologia: número de quartos da unidade (null = não informada).';

-- Alto do Jerivá: finais 01, 04, 05 e 08 = 2 quartos; finais 02, 03, 06 e 07 = 3 quartos.
update public.units as u
   set quartos = case when u.apto in ('01', '04', '05', '08') then 2 else 3 end
  from public.projects as p
 where p.id = u.project_id and p.slug = 'alto-do-jeriva'
   and u.kind = 'apartamento' and u.quartos is null
   and u.apto in ('01', '02', '03', '04', '05', '06', '07', '08');

-- 2) Cadastro atual
create table if not exists public.chaves_unidades (
  unit_id bigint primary key references public.units (id) on delete cascade,
  project_id bigint not null references public.projects (id) on delete cascade,
  tem_chaves boolean not null default false,
  origem text not null default 'site',
  observacoes text not null default '',
  atualizado_em timestamptz not null default now(),
  atualizado_por uuid references public.profiles (id) on delete set null
);
comment on table public.chaves_unidades is
  'Controle de Chaves: situação de cadastro da unidade no claviculário (tem_chaves = há chaves na Base).';
create index if not exists chaves_unidades_project_idx on public.chaves_unidades (project_id);

create table if not exists public.chaves (
  id bigint generated always as identity primary key,
  unit_id bigint not null references public.units (id) on delete cascade,
  project_id bigint not null references public.projects (id) on delete cascade,
  categoria text not null check (categoria in ('entrada', 'quarto', 'banheiro')),
  comodo smallint not null default 1 check (comodo between 1 and 9),
  copia smallint not null default 1 check (copia between 1 and 20),
  local text not null default 'base' check (local in ('base', 'cx', 'asstec', 'producao')),
  situacao text not null default 'ativa' check (situacao in ('ativa', 'extraviada', 'inativa')),
  movimentacao_id bigint,
  responsavel text not null default '',
  retirada_em timestamptz,
  previsao_devolucao timestamptz,
  atualizado_em timestamptz not null default now(),
  constraint chaves_unica unique (unit_id, categoria, comodo, copia),
  constraint chaves_fora_da_base check ((local = 'base') = (movimentacao_id is null)),
  constraint chaves_so_ativa_sai check (local = 'base' or situacao = 'ativa')
);
comment on table public.chaves is
  'Controle de Chaves: uma linha por cópia física. local = base (disponível no claviculário) ou setor com a chave.';
create index if not exists chaves_project_idx on public.chaves (project_id);
create index if not exists chaves_unit_idx on public.chaves (unit_id);

create table if not exists public.chaves_movimentacoes (
  id bigint generated always as identity primary key,
  project_id bigint not null references public.projects (id) on delete cascade,
  unit_id bigint not null references public.units (id) on delete cascade,
  tipo text not null check (tipo in ('cadastro', 'retirada', 'devolucao', 'transferencia', 'ocorrencia')),
  setor text check (setor in ('base', 'cx', 'asstec', 'producao')),
  responsavel text not null default '',
  recebido_por text not null default '',
  data_hora timestamptz not null,
  previsao_devolucao timestamptz,
  chaves jsonb not null default '[]'::jsonb,
  quantidade integer not null default 0,
  observacoes text not null default '',
  registrado_por uuid references public.profiles (id) on delete set null,
  registrado_email text not null default '',
  registrado_em timestamptz not null default now(),
  pedido_id uuid unique
);
comment on table public.chaves_movimentacoes is
  'Controle de Chaves: histórico imutável (cada retirada, devolução, transferência, cadastro ou ocorrência é um registro).';
create index if not exists chaves_mov_unit_idx on public.chaves_movimentacoes (unit_id, registrado_em desc);
create index if not exists chaves_mov_project_idx on public.chaves_movimentacoes (project_id, registrado_em desc);

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'chaves_movimentacao_fk') then
    alter table public.chaves add constraint chaves_movimentacao_fk
      foreign key (movimentacao_id) references public.chaves_movimentacoes (id);
  end if;
end $$;

-- Histórico imutável: nenhuma alteração; exclusão só em cascata (unidade/condomínio apagados).
create or replace function private.chaves_historico_imutavel()
returns trigger language plpgsql set search_path = '' as $$
begin
  -- exclusão disparada por outra (cascata da unidade/condomínio) tem profundidade > 1
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then return old; end if;
  raise exception 'O histórico de chaves não pode ser alterado nem apagado';
end $$;
revoke all on function private.chaves_historico_imutavel() from public, anon, authenticated;
drop trigger if exists chaves_movimentacoes_imutavel on public.chaves_movimentacoes;
create trigger chaves_movimentacoes_imutavel
before update or delete on public.chaves_movimentacoes
for each row execute function private.chaves_historico_imutavel();

-- 3) Segurança: leitura por membro ativo do condomínio; escrita só pelas funções abaixo.
alter table public.chaves_unidades enable row level security;
alter table public.chaves enable row level security;
alter table public.chaves_movimentacoes enable row level security;
revoke all on table public.chaves_unidades, public.chaves, public.chaves_movimentacoes from anon, authenticated;
grant select on table public.chaves_unidades, public.chaves, public.chaves_movimentacoes to authenticated;

drop policy if exists chaves_unidades_select_member on public.chaves_unidades;
create policy chaves_unidades_select_member on public.chaves_unidades
  for select to authenticated using (private.project_role(project_id) is not null);
drop policy if exists chaves_select_member on public.chaves;
create policy chaves_select_member on public.chaves
  for select to authenticated using (private.project_role(project_id) is not null);
drop policy if exists chaves_mov_select_member on public.chaves_movimentacoes;
create policy chaves_mov_select_member on public.chaves_movimentacoes
  for select to authenticated using (private.project_role(project_id) is not null);

create or replace function private.chaves_pode_movimentar(p_project bigint)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(private.project_role(p_project) in ('admin', 'revistorias'), false)
$$;
create or replace function private.chaves_pode_cadastrar(p_project bigint)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(private.project_role(p_project) = 'admin', false)
$$;
revoke all on function private.chaves_pode_movimentar(bigint) from public, anon;
revoke all on function private.chaves_pode_cadastrar(bigint) from public, anon;
grant execute on function private.chaves_pode_movimentar(bigint) to authenticated;
grant execute on function private.chaves_pode_cadastrar(bigint) to authenticated;

-- Rótulo legível de uma chave (para o histórico).
create or replace function private.chaves_rotulo(p_categoria text, p_comodo smallint, p_copia smallint)
returns text language sql immutable set search_path = '' as $$
  select case p_categoria when 'entrada' then 'Entrada' when 'quarto' then 'Quarto ' || p_comodo
              else 'Banheiro ' || p_comodo end || ' · cópia ' || p_copia
$$;

-- Unidade travada + contexto (condomínio arquivado não tem papel: project_role devolve null).
create or replace function private.chaves_unidade(p_unit_id bigint)
returns public.units language plpgsql security definer set search_path = '' as $$
declare u public.units;
begin
  select * into u from public.units where id = p_unit_id;
  if not found then raise exception 'Unidade não encontrada'; end if;
  insert into public.chaves_unidades (unit_id, project_id) values (u.id, u.project_id) on conflict (unit_id) do nothing;
  perform 1 from public.chaves_unidades where unit_id = u.id for update;   -- serializa operações da unidade
  return u;
end $$;
revoke all on function private.chaves_unidade(bigint) from public, anon, authenticated;

-- Grava uma movimentação (com usuário e horário automáticos).
create or replace function private.chaves_registrar(
  p_unit public.units, p_tipo text, p_setor text, p_responsavel text, p_recebido text, p_data timestamptz,
  p_previsao timestamptz, p_chaves jsonb, p_obs text, p_pedido uuid)
returns public.chaves_movimentacoes language plpgsql security definer set search_path = '' as $$
declare m public.chaves_movimentacoes; v_email text;
begin
  select email into v_email from public.profiles where id = (select auth.uid());
  insert into public.chaves_movimentacoes (project_id, unit_id, tipo, setor, responsavel, recebido_por, data_hora,
    previsao_devolucao, chaves, quantidade, observacoes, registrado_por, registrado_email, pedido_id)
  values (p_unit.project_id, p_unit.id, p_tipo, p_setor, btrim(coalesce(p_responsavel, '')), btrim(coalesce(p_recebido, '')),
    coalesce(p_data, now()), p_previsao, coalesce(p_chaves, '[]'::jsonb), jsonb_array_length(coalesce(p_chaves, '[]'::jsonb)),
    btrim(coalesce(p_obs, '')), (select auth.uid()), coalesce(v_email, ''), p_pedido)
  returning * into m;
  return m;
end $$;
revoke all on function private.chaves_registrar(public.units, text, text, text, text, timestamptz, timestamptz, jsonb, text, uuid) from public, anon, authenticated;

-- Pedido repetido (clique duplo, nova tentativa de rede): devolve a movimentação já gravada.
create or replace function private.chaves_pedido_existente(p_pedido uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('ok', true, 'repetido', true, 'movimentacao', to_jsonb(m))
    from public.chaves_movimentacoes m where p_pedido is not null and m.pedido_id = p_pedido
$$;
revoke all on function private.chaves_pedido_existente(uuid) from public, anon, authenticated;

-- Trava e confere as chaves pedidas (todas da unidade e ativas).
create or replace function private.chaves_travar(p_unit_id bigint, p_ids bigint[])
returns setof public.chaves language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  if p_ids is null or cardinality(p_ids) = 0 then raise exception 'Selecione as chaves movimentadas'; end if;
  select count(*) into n from (select distinct unnest(p_ids)) x;
  if n <> cardinality(p_ids) then raise exception 'Chave repetida na seleção'; end if;
  return query select * from public.chaves c where c.id = any(p_ids) and c.unit_id = p_unit_id order by c.id for update;
  get diagnostics n = row_count;
  if n <> cardinality(p_ids) then raise exception 'Chave não encontrada nesta unidade'; end if;
end $$;
revoke all on function private.chaves_travar(bigint, bigint[]) from public, anon, authenticated;

-- 4) Operações

-- Cadastro / ajuste das chaves da unidade: p_itens = [{"categoria":"entrada","comodo":1,"copias":2}, …]
-- (quantidades por unidade: nada é presumido igual para todas). Só com todas as chaves na Base.
create or replace function public.chaves_cadastrar(p_unit_id bigint, p_itens jsonb, p_observacoes text default '', p_pedido uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare u public.units; it jsonb; v_cat text; v_com smallint; v_cop int; k int; v_lista jsonb; m public.chaves_movimentacoes; r jsonb;
begin
  r := private.chaves_pedido_existente(p_pedido); if r is not null then return r; end if;
  u := private.chaves_unidade(p_unit_id);
  if not private.chaves_pode_cadastrar(u.project_id) then raise exception 'Somente administradores do condomínio cadastram chaves'; end if;
  if jsonb_typeof(coalesce(p_itens, 'null'::jsonb)) <> 'array' then raise exception 'Informe as chaves da unidade'; end if;
  if exists (select 1 from public.chaves where unit_id = u.id and situacao = 'ativa' and local <> 'base') then
    raise exception 'Há chaves fora do claviculário: registre a devolução antes de alterar o cadastro';
  end if;
  for it in select * from jsonb_array_elements(p_itens) loop
    v_cat := it ->> 'categoria'; v_com := coalesce((it ->> 'comodo')::smallint, 1); v_cop := coalesce((it ->> 'copias')::int, 0);
    if v_cat not in ('entrada', 'quarto', 'banheiro') then raise exception 'Categoria de chave inválida: %', v_cat; end if;
    if v_com < 1 or v_com > 9 or v_cop < 0 or v_cop > 20 then raise exception 'Quantidade inválida para %', v_cat; end if;
  end loop;
  -- tudo que não estiver na lista fica inativo; o que estiver é ativado/criado até a quantidade pedida
  update public.chaves c set situacao = 'inativa', atualizado_em = now()
   where c.unit_id = u.id and c.situacao <> 'inativa'
     and not exists (select 1 from jsonb_array_elements(p_itens) e
                      where e ->> 'categoria' = c.categoria and coalesce((e ->> 'comodo')::smallint, 1) = c.comodo
                        and c.copia <= coalesce((e ->> 'copias')::int, 0));
  for it in select * from jsonb_array_elements(p_itens) loop
    v_cat := it ->> 'categoria'; v_com := coalesce((it ->> 'comodo')::smallint, 1); v_cop := coalesce((it ->> 'copias')::int, 0);
    for k in 1 .. v_cop loop
      insert into public.chaves (unit_id, project_id, categoria, comodo, copia)
      values (u.id, u.project_id, v_cat, v_com, k)
      on conflict (unit_id, categoria, comodo, copia) do update
        set situacao = 'ativa', local = 'base', movimentacao_id = null, responsavel = '', retirada_em = null,
            previsao_devolucao = null, atualizado_em = now();
    end loop;
  end loop;
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'categoria', categoria, 'comodo', comodo, 'copia', copia,
           'rotulo', private.chaves_rotulo(categoria, comodo, copia)) order by categoria, comodo, copia), '[]'::jsonb)
    into v_lista from public.chaves where unit_id = u.id and situacao = 'ativa';
  update public.chaves_unidades set tem_chaves = jsonb_array_length(v_lista) > 0, atualizado_em = now(),
         atualizado_por = (select auth.uid()) where unit_id = u.id;
  m := private.chaves_registrar(u, 'cadastro', 'base', '', '', now(), null, v_lista, p_observacoes, p_pedido);
  return jsonb_build_object('ok', true, 'movimentacao', to_jsonb(m));
end $$;

-- Retirada (total ou parcial): cada chave precisa estar ativa e na Base.
create or replace function public.chaves_retirar(p_unit_id bigint, p_chave_ids bigint[], p_setor text, p_responsavel text,
  p_data_hora timestamptz default null, p_previsao timestamptz default null, p_observacoes text default '', p_pedido uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare u public.units; c public.chaves; v_lista jsonb := '[]'::jsonb; m public.chaves_movimentacoes; r jsonb; v_data timestamptz;
begin
  r := private.chaves_pedido_existente(p_pedido); if r is not null then return r; end if;
  u := private.chaves_unidade(p_unit_id);
  if not private.chaves_pode_movimentar(u.project_id) then raise exception 'Seu acesso a este condomínio não permite movimentar chaves'; end if;
  if p_setor not in ('cx', 'asstec', 'producao') then raise exception 'Setor de destino inválido'; end if;
  if length(btrim(coalesce(p_responsavel, ''))) < 2 then raise exception 'Informe o responsável pela retirada'; end if;
  v_data := coalesce(p_data_hora, now());
  if v_data > now() + interval '10 minutes' then raise exception 'A data da retirada não pode estar no futuro'; end if;
  if p_previsao is not null and p_previsao < v_data then raise exception 'A previsão de devolução é anterior à retirada'; end if;
  for c in select * from private.chaves_travar(u.id, p_chave_ids) loop
    if c.situacao <> 'ativa' then
      raise exception 'A chave % está registrada como %', private.chaves_rotulo(c.categoria, c.comodo, c.copia), c.situacao;
    end if;
    if c.local <> 'base' then
      raise exception 'A chave % já está retirada (% com %). Use a transferência.', private.chaves_rotulo(c.categoria, c.comodo, c.copia),
        case c.local when 'cx' then 'CX' when 'asstec' then 'Asstec' else 'Produção' end, nullif(c.responsavel, '');
    end if;
    v_lista := v_lista || jsonb_build_object('id', c.id, 'categoria', c.categoria, 'comodo', c.comodo, 'copia', c.copia,
      'rotulo', private.chaves_rotulo(c.categoria, c.comodo, c.copia));
  end loop;
  m := private.chaves_registrar(u, 'retirada', p_setor, p_responsavel, '', v_data, p_previsao, v_lista, p_observacoes, p_pedido);
  update public.chaves set local = p_setor, movimentacao_id = m.id, responsavel = m.responsavel, retirada_em = v_data,
         previsao_devolucao = p_previsao, atualizado_em = now()
   where id = any(p_chave_ids);
  return jsonb_build_object('ok', true, 'movimentacao', to_jsonb(m));
end $$;

-- Transferência: chaves já retiradas passam a outro setor/responsável sem voltar à Base.
create or replace function public.chaves_transferir(p_unit_id bigint, p_chave_ids bigint[], p_setor text, p_responsavel text,
  p_data_hora timestamptz default null, p_previsao timestamptz default null, p_observacoes text default '', p_pedido uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare u public.units; c public.chaves; v_lista jsonb := '[]'::jsonb; m public.chaves_movimentacoes; r jsonb; v_data timestamptz;
begin
  r := private.chaves_pedido_existente(p_pedido); if r is not null then return r; end if;
  u := private.chaves_unidade(p_unit_id);
  if not private.chaves_pode_movimentar(u.project_id) then raise exception 'Seu acesso a este condomínio não permite movimentar chaves'; end if;
  if p_setor not in ('cx', 'asstec', 'producao') then raise exception 'Setor de destino inválido'; end if;
  if length(btrim(coalesce(p_responsavel, ''))) < 2 then raise exception 'Informe o novo responsável'; end if;
  v_data := coalesce(p_data_hora, now());
  if v_data > now() + interval '10 minutes' then raise exception 'A data da transferência não pode estar no futuro'; end if;
  if p_previsao is not null and p_previsao < v_data then raise exception 'A previsão de devolução é anterior à transferência'; end if;
  for c in select * from private.chaves_travar(u.id, p_chave_ids) loop
    if c.situacao <> 'ativa' or c.local = 'base' then
      raise exception 'A chave % não está retirada: use a retirada', private.chaves_rotulo(c.categoria, c.comodo, c.copia);
    end if;
    v_lista := v_lista || jsonb_build_object('id', c.id, 'categoria', c.categoria, 'comodo', c.comodo, 'copia', c.copia,
      'rotulo', private.chaves_rotulo(c.categoria, c.comodo, c.copia), 'de_setor', c.local, 'de_responsavel', c.responsavel,
      'de_movimentacao', c.movimentacao_id);
  end loop;
  m := private.chaves_registrar(u, 'transferencia', p_setor, p_responsavel, '', v_data, p_previsao, v_lista, p_observacoes, p_pedido);
  update public.chaves set local = p_setor, movimentacao_id = m.id, responsavel = m.responsavel, retirada_em = v_data,
         previsao_devolucao = p_previsao, atualizado_em = now()
   where id = any(p_chave_ids);
  return jsonb_build_object('ok', true, 'movimentacao', to_jsonb(m));
end $$;

-- Devolução (total ou parcial) à Base.
create or replace function public.chaves_devolver(p_unit_id bigint, p_chave_ids bigint[], p_recebido_por text,
  p_data_hora timestamptz default null, p_observacoes text default '', p_responsavel text default '', p_pedido uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare u public.units; c public.chaves; v_lista jsonb := '[]'::jsonb; m public.chaves_movimentacoes; r jsonb; v_data timestamptz; v_quem text := '';
begin
  r := private.chaves_pedido_existente(p_pedido); if r is not null then return r; end if;
  u := private.chaves_unidade(p_unit_id);
  if not private.chaves_pode_movimentar(u.project_id) then raise exception 'Seu acesso a este condomínio não permite movimentar chaves'; end if;
  if length(btrim(coalesce(p_recebido_por, ''))) < 2 then raise exception 'Informe quem recebeu as chaves'; end if;
  v_data := coalesce(p_data_hora, now());
  if v_data > now() + interval '10 minutes' then raise exception 'A data da devolução não pode estar no futuro'; end if;
  for c in select * from private.chaves_travar(u.id, p_chave_ids) loop
    if c.situacao <> 'ativa' or c.local = 'base' then
      raise exception 'A chave % não está retirada', private.chaves_rotulo(c.categoria, c.comodo, c.copia);
    end if;
    if v_data < c.retirada_em then raise exception 'A devolução é anterior à retirada da chave %', private.chaves_rotulo(c.categoria, c.comodo, c.copia); end if;
    v_quem := case when v_quem = '' then c.responsavel when position(c.responsavel in v_quem) > 0 then v_quem else v_quem || ', ' || c.responsavel end;
    v_lista := v_lista || jsonb_build_object('id', c.id, 'categoria', c.categoria, 'comodo', c.comodo, 'copia', c.copia,
      'rotulo', private.chaves_rotulo(c.categoria, c.comodo, c.copia), 'de_setor', c.local, 'de_responsavel', c.responsavel,
      'de_movimentacao', c.movimentacao_id, 'previsao', c.previsao_devolucao);
  end loop;
  m := private.chaves_registrar(u, 'devolucao', 'base', coalesce(nullif(btrim(p_responsavel), ''), v_quem), p_recebido_por,
         v_data, null, v_lista, p_observacoes, p_pedido);
  update public.chaves set local = 'base', movimentacao_id = null, responsavel = '', retirada_em = null,
         previsao_devolucao = null, atualizado_em = now()
   where id = any(p_chave_ids);
  return jsonb_build_object('ok', true, 'movimentacao', to_jsonb(m));
end $$;

-- Ocorrência: anotação no histórico; opcionalmente marca chaves como extraviadas (divergência).
create or replace function public.chaves_ocorrencia(p_unit_id bigint, p_texto text, p_extraviadas bigint[] default '{}',
  p_data_hora timestamptz default null, p_pedido uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare u public.units; c public.chaves; v_lista jsonb := '[]'::jsonb; m public.chaves_movimentacoes; r jsonb;
begin
  r := private.chaves_pedido_existente(p_pedido); if r is not null then return r; end if;
  u := private.chaves_unidade(p_unit_id);
  if not private.chaves_pode_movimentar(u.project_id) then raise exception 'Seu acesso a este condomínio não permite registrar ocorrências'; end if;
  if length(btrim(coalesce(p_texto, ''))) < 3 then raise exception 'Descreva a ocorrência'; end if;
  if coalesce(cardinality(p_extraviadas), 0) > 0 then
    for c in select * from private.chaves_travar(u.id, p_extraviadas) loop
      if c.situacao <> 'ativa' then raise exception 'A chave % não está ativa', private.chaves_rotulo(c.categoria, c.comodo, c.copia); end if;
      v_lista := v_lista || jsonb_build_object('id', c.id, 'categoria', c.categoria, 'comodo', c.comodo, 'copia', c.copia,
        'rotulo', private.chaves_rotulo(c.categoria, c.comodo, c.copia), 'extraviada', true, 'de_setor', c.local, 'de_responsavel', c.responsavel);
    end loop;
  end if;
  m := private.chaves_registrar(u, 'ocorrencia', null, '', '', coalesce(p_data_hora, now()), null, v_lista, p_texto, p_pedido);
  if coalesce(cardinality(p_extraviadas), 0) > 0 then
    update public.chaves set situacao = 'extraviada', local = 'base', movimentacao_id = null, responsavel = '',
           retirada_em = null, previsao_devolucao = null, atualizado_em = now()
     where id = any(p_extraviadas);
  end if;
  return jsonb_build_object('ok', true, 'movimentacao', to_jsonb(m));
end $$;

-- Tipologia (número de quartos) de uma ou mais unidades do mesmo condomínio; registrada no log de auditoria.
create or replace function public.chaves_definir_tipologia(p_unit_ids bigint[], p_quartos smallint)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_projects bigint[]; v_email text; n int;
begin
  if p_quartos is not null and (p_quartos < 1 or p_quartos > 6) then raise exception 'Tipologia inválida'; end if;
  select array_agg(distinct project_id) into v_projects from public.units where id = any(p_unit_ids);
  if v_projects is null then raise exception 'Unidade não encontrada'; end if;
  if cardinality(v_projects) <> 1 or not private.chaves_pode_cadastrar(v_projects[1]) then
    raise exception 'Somente administradores do condomínio definem a tipologia';
  end if;
  select email into v_email from public.profiles where id = (select auth.uid());
  insert into public.audit_log (project_id, actor_user_id, actor_email, table_name, record_id, action, old_data, new_data)
  select u.project_id, (select auth.uid()), coalesce(v_email, ''), 'units', u.id, 'UPDATE',
         jsonb_build_object('quartos', u.quartos), jsonb_build_object('quartos', p_quartos)
    from public.units u where u.id = any(p_unit_ids) and u.quartos is distinct from p_quartos;
  update public.units set quartos = p_quartos where id = any(p_unit_ids) and quartos is distinct from p_quartos;
  get diagnostics n = row_count;
  return jsonb_build_object('ok', true, 'alteradas', n);
end $$;

revoke all on function public.chaves_cadastrar(bigint, jsonb, text, uuid) from public, anon;
revoke all on function public.chaves_retirar(bigint, bigint[], text, text, timestamptz, timestamptz, text, uuid) from public, anon;
revoke all on function public.chaves_transferir(bigint, bigint[], text, text, timestamptz, timestamptz, text, uuid) from public, anon;
revoke all on function public.chaves_devolver(bigint, bigint[], text, timestamptz, text, text, uuid) from public, anon;
revoke all on function public.chaves_ocorrencia(bigint, text, bigint[], timestamptz, uuid) from public, anon;
revoke all on function public.chaves_definir_tipologia(bigint[], smallint) from public, anon;
grant execute on function public.chaves_cadastrar(bigint, jsonb, text, uuid) to authenticated;
grant execute on function public.chaves_retirar(bigint, bigint[], text, text, timestamptz, timestamptz, text, uuid) to authenticated;
grant execute on function public.chaves_transferir(bigint, bigint[], text, text, timestamptz, timestamptz, text, uuid) to authenticated;
grant execute on function public.chaves_devolver(bigint, bigint[], text, timestamptz, text, text, uuid) to authenticated;
grant execute on function public.chaves_ocorrencia(bigint, text, bigint[], timestamptz, uuid) to authenticated;
grant execute on function public.chaves_definir_tipologia(bigint[], smallint) to authenticated;

-- 5) Carga inicial do Alto do Jerivá (planilha "Levantamento Inicial", 448 unidades):
--    "Tem chave SIM" = chaves na Base (345 unidades); "NÃO" = sem status (103). As quantidades por
--    categoria não constam da planilha (coluna vazia) e são cadastradas por unidade no módulo.
--    Cada letra é uma unidade, na ordem Térreo, 1º … 6º pav. × aptos 01 … 08 (S = tem chave).
with levantamento (bloco, unidades) as (values
    ('A', 'NSSSSSSSSSSNSSSSSSNNNSNSSNSNNSSSSSSSSSSSSSSSSSSSSSSNSSNS'),
    ('B', 'SSSSSSSSNSNNSNSNSSSSSSSSSNSSNNSSNNSSNSNNNSSNSSSNNNNNNSNN'),
    ('C', 'NNSNNSNNSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSS'),
    ('D', 'NNNNNNNNNNNSSNSSSSSSSSSSSSSSSSSSSSSSSNSNSSSSSNSSSSNSSNSN'),
    ('E', 'SSSNNSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSS'),
    ('F', 'SSSSSSNSSSSSSSSSSSSSSSNSSSSSSSSSSSSSSNSSNSSSNNSSSSSSSSSS'),
    ('G', 'NNNSSNNSNSSNSSSSSSSSSSSSNSSSSSSSSSSSSSSSSSSSSSSSSSSSNSSS'),
    ('H', 'SNNNNNNNNSNSSSNNSNNSNSSNSSNSSSNNSNSSNSSNNNSNSNNSSSSNSNSS')

), unidades as (
  select l.bloco, p.pav, lpad(a::text, 2, '0') as apto,
         substr(l.unidades, (p.i - 1) * 8 + a, 1) = 'S' as tem
    from levantamento l
   cross join (values (1, 'T'), (2, '1º'), (3, '2º'), (4, '3º'), (5, '4º'), (6, '5º'), (7, '6º')) as p (i, pav)
   cross join generate_series(1, 8) as a
)
insert into public.chaves_unidades (unit_id, project_id, tem_chaves, origem, observacoes)
select un.id, un.project_id, x.tem, 'planilha',
       case when x.tem then 'Levantamento inicial: unidade com chaves (quantidades a cadastrar).'
            else 'Levantamento inicial: unidade sem chaves.' end
  from unidades x
  join public.projects p on p.slug = 'alto-do-jeriva'
  join public.units un on un.project_id = p.id and un.bloco = x.bloco and un.pav = x.pav and un.apto = x.apto
on conflict (unit_id) do nothing;

-- registro do levantamento no histórico de cada unidade com chaves
insert into public.chaves_movimentacoes (project_id, unit_id, tipo, setor, data_hora, observacoes, registrado_email)
select cu.project_id, cu.unit_id, 'cadastro', 'base', now(),
       'Levantamento inicial (planilha): unidade com chaves na Base. Quantidades a cadastrar.', 'planilha'
  from public.chaves_unidades cu
 where cu.origem = 'planilha' and cu.tem_chaves
   and not exists (select 1 from public.chaves_movimentacoes m where m.unit_id = cu.unit_id);

-- 6) Tempo real: a tela atualiza quando outro usuário movimenta chaves.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'chaves') then
      alter publication supabase_realtime add table public.chaves;
    end if;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'chaves_unidades') then
      alter publication supabase_realtime add table public.chaves_unidades;
    end if;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'chaves_movimentacoes') then
      alter publication supabase_realtime add table public.chaves_movimentacoes;
    end if;
  end if;
end $$;
