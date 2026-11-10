-- Cores centralizadas (administradas pelo Admin) e equipes de mão de obra.
--
-- Duas categorias independentes, cada uma com armazenamento e identificação próprios:
--   A) cores_legendas      cores das legendas operacionais (setores do Controle de Chaves: base, cx, asstec,
--                          producao, cliente, sem). Só existe linha para a cor personalizada; sem linha = cor padrão
--                          do aplicativo. Restaurar = apagar a linha de configuração (nenhum dado operacional).
--   B) equipes_execucao    cadastro das equipes/profissionais da Execução M.O. com identificador estável (id),
--                          nome, equipe, sigla, cor atual, cor padrão, ativa e ordem. As 4 equipes de hoje entram com
--                          os mesmos ids já gravados em revistorias_cliente.execucao (MOP_FELIPE…) e as mesmas cores.
--                          Equipe nova = nova linha (sem mudar o código). Renomear não muda o id nem a cor; desativar
--                          preserva histórico, cor e vínculos (não é possível apagar).
-- Execução finalizada (serviço da M.O. concluído): revistorias_cliente.execucao_finalizada_em/por, marcado pela
-- função revistoria_execucao_finalizar (admin e revistorias), com evento no histórico.
--
-- Segurança: leitura para usuários com acesso a algum condomínio; escrita só pelas funções, que conferem se o usuário
-- é administrador (private.is_any_admin, o mesmo critério do cadastro de condomínios). Só aditiva: nenhuma linha
-- operacional é alterada; a regra fixa de execução (check) vira chave estrangeira para o cadastro de equipes.

-- ── Leitura: usuário com acesso ativo a algum condomínio ─────────────────────
create or replace function private.is_any_member()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.project_members pm where pm.user_id = (select auth.uid()) and pm.active)
$$;
revoke all on function private.is_any_member() from public, anon;
grant execute on function private.is_any_member() to authenticated;

create or replace function private.cores_hex(p text)
returns text language plpgsql immutable set search_path = '' as $$
declare v text := lower(btrim(coalesce(p, '')));
begin
  if v !~ '^#[0-9a-f]{6}$' then raise exception 'Cor inválida (use #RRGGBB)'; end if;
  return v;
end $$;

create or replace function private.cores_admin()
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null or not private.is_any_admin() then
    raise exception 'Só administradores podem alterar as cores e as equipes' using errcode = '42501';
  end if;
end $$;
revoke all on function private.cores_admin() from public, anon, authenticated;

-- ── A) Cores das legendas operacionais ───────────────────────────────────────
create table if not exists public.cores_legendas (
  categoria text not null check (categoria in ('setor_chave')),
  chave text not null,
  cor text not null check (cor ~ '^#[0-9a-f]{6}$'),
  atualizado_em timestamptz not null default now(),
  atualizado_por uuid references public.profiles (id) on delete set null,
  atualizado_email text not null default '' check (char_length(atualizado_email) <= 320),
  primary key (categoria, chave),
  constraint cores_legendas_chave_check check (categoria <> 'setor_chave' or chave in ('base', 'cx', 'asstec', 'producao', 'cliente', 'sem'))
);
comment on table public.cores_legendas is
  'Cores personalizadas das legendas operacionais (categoria setor_chave: setores do Controle de Chaves). Usadas por todos os módulos que mostram esses setores. Sem linha = cor padrão. Escrita só por cores_legenda_salvar/cores_legenda_restaurar (administradores).';
alter table public.cores_legendas enable row level security;
revoke all on table public.cores_legendas from public, anon, authenticated;
grant select on table public.cores_legendas to authenticated;
drop policy if exists cores_legendas_select on public.cores_legendas;
create policy cores_legendas_select on public.cores_legendas for select to authenticated using (private.is_any_member());

create or replace function public.cores_legenda_salvar(p_categoria text, p_chave text, p_cor text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_cor text; r public.cores_legendas;
begin
  perform private.cores_admin();
  v_cor := private.cores_hex(p_cor);
  insert into public.cores_legendas (categoria, chave, cor, atualizado_por, atualizado_email)
  values (p_categoria, p_chave, v_cor, (select auth.uid()), coalesce((select email from public.profiles where id = (select auth.uid())), ''))
  on conflict (categoria, chave) do update
     set cor = excluded.cor, atualizado_em = now(), atualizado_por = excluded.atualizado_por, atualizado_email = excluded.atualizado_email
  returning * into r;
  return to_jsonb(r);
end $$;

-- p_chave nulo = restaurar todas as cores da categoria.
create or replace function public.cores_legenda_restaurar(p_categoria text, p_chave text default null)
returns integer language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  perform private.cores_admin();
  delete from public.cores_legendas where categoria = p_categoria and (p_chave is null or chave = p_chave);
  get diagnostics n = row_count;
  return n;
end $$;

-- ── B) Equipes de mão de obra ────────────────────────────────────────────────
create table if not exists public.equipes_execucao (
  id text primary key check (id ~ '^[A-Z][A-Z0-9_]{1,39}$'),
  grupo text not null check (char_length(btrim(grupo)) between 1 and 30),
  nome text not null check (char_length(btrim(nome)) between 2 and 60),
  sigla text not null check (char_length(btrim(sigla)) between 1 and 2),
  cor text not null check (cor ~ '^#[0-9a-f]{6}$'),
  cor_padrao text not null check (cor_padrao ~ '^#[0-9a-f]{6}$'),
  ativo boolean not null default true,
  ordem integer not null default 0,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  atualizado_por uuid references public.profiles (id) on delete set null,
  atualizado_email text not null default '' check (char_length(atualizado_email) <= 320)
);
create unique index if not exists equipes_execucao_nome_uniq on public.equipes_execucao (lower(btrim(grupo)), lower(btrim(nome)));
comment on table public.equipes_execucao is
  'Equipes/profissionais da Execução M.O. (id estável gravado em revistorias_cliente.execucao). Cor independente das cores das legendas. Não se apaga: desativar preserva histórico e cor. Escrita só por equipe_execucao_salvar/equipe_execucao_restaurar_cor (administradores).';
insert into public.equipes_execucao (id, grupo, nome, sigla, cor, cor_padrao, ordem) values
  ('MOP_FELIPE', 'M.O.P', 'Felipe', 'F', '#7b4fc9', '#7b4fc9', 1),
  ('MOP_RENATO', 'M.O.P', 'Renato', 'R', '#c2185b', '#c2185b', 2),
  ('EMP_OSCAR', 'EMP', 'Oscar', 'O', '#00838f', '#00838f', 3),
  ('EMP_NILSON', 'EMP', 'Nilson', 'N', '#8d5524', '#8d5524', 4)
on conflict (id) do nothing;
alter table public.equipes_execucao enable row level security;
revoke all on table public.equipes_execucao from public, anon, authenticated;
grant select on table public.equipes_execucao to authenticated;
drop policy if exists equipes_execucao_select on public.equipes_execucao;
create policy equipes_execucao_select on public.equipes_execucao for select to authenticated using (private.is_any_member());

-- Execução da unidade ligada ao cadastro (no lugar da lista fixa); a equipe não pode ser apagada nem trocar de id.
alter table public.revistorias_cliente drop constraint if exists revistorias_cliente_execucao_check;
alter table public.revistorias_cliente drop constraint if exists revistorias_cliente_execucao_fkey;
alter table public.revistorias_cliente add constraint revistorias_cliente_execucao_fkey
  foreign key (execucao) references public.equipes_execucao (id) on update restrict on delete restrict;
comment on column public.revistorias_cliente.execucao is 'Equipe que executa os serviços (public.equipes_execucao.id); nulo = não definida.';

-- Cria (p_id nulo) ou altera uma equipe. Ao criar, a cor escolhida vira a cor padrão dela.
create or replace function public.equipe_execucao_salvar(p_id text, p_grupo text, p_nome text, p_sigla text, p_cor text,
  p_ativo boolean default true)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r public.equipes_execucao; v_cor text; v_grupo text; v_nome text; v_sigla text; v_id text;
  v_email text := coalesce((select email from public.profiles where id = (select auth.uid())), '');
begin
  perform private.cores_admin();
  v_cor := private.cores_hex(p_cor);
  v_grupo := btrim(regexp_replace(coalesce(p_grupo, ''), '\s+', ' ', 'g'));
  v_nome := btrim(regexp_replace(coalesce(p_nome, ''), '\s+', ' ', 'g'));
  v_sigla := upper(btrim(coalesce(p_sigla, '')));
  if char_length(v_grupo) not between 1 and 30 then raise exception 'Informe a equipe (até 30 caracteres)'; end if;
  if char_length(v_nome) not between 2 and 60 then raise exception 'Informe o nome do responsável (2 a 60 caracteres)'; end if;
  if char_length(v_sigla) not between 1 and 2 then raise exception 'Informe a sigla (1 ou 2 caracteres)'; end if;
  if exists (select 1 from public.equipes_execucao e where lower(btrim(e.grupo)) = lower(v_grupo) and lower(btrim(e.nome)) = lower(v_nome)
             and e.id is distinct from p_id) then
    raise exception 'Já existe a equipe % · % (reative-a em vez de criar outra)', v_grupo, v_nome;
  end if;
  if p_id is null then
    loop
      v_id := 'EQ_' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 8));
      exit when not exists (select 1 from public.equipes_execucao where id = v_id);
    end loop;
    insert into public.equipes_execucao (id, grupo, nome, sigla, cor, cor_padrao, ativo, ordem, atualizado_por, atualizado_email)
    values (v_id, v_grupo, v_nome, v_sigla, v_cor, v_cor, coalesce(p_ativo, true),
            coalesce((select max(ordem) from public.equipes_execucao), 0) + 1, (select auth.uid()), v_email)
    returning * into r;
  else
    update public.equipes_execucao
       set grupo = v_grupo, nome = v_nome, sigla = v_sigla, cor = v_cor, ativo = coalesce(p_ativo, ativo),
           atualizado_em = now(), atualizado_por = (select auth.uid()), atualizado_email = v_email
     where id = p_id returning * into r;
    if not found then raise exception 'Equipe não encontrada'; end if;
  end if;
  return to_jsonb(r);
end $$;

create or replace function public.equipe_execucao_restaurar_cor(p_id text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r public.equipes_execucao;
begin
  perform private.cores_admin();
  update public.equipes_execucao set cor = cor_padrao, atualizado_em = now(), atualizado_por = (select auth.uid()),
         atualizado_email = coalesce((select email from public.profiles where id = (select auth.uid())), '')
   where id = p_id returning * into r;
  if not found then raise exception 'Equipe não encontrada'; end if;
  return to_jsonb(r);
end $$;

-- Rótulo da equipe no histórico: vem do cadastro (o nome atual), não de uma lista fixa.
create or replace function private.revcli_exec_rotulo(p text)
returns text language sql stable security definer set search_path = '' as $$
  select coalesce((select e.grupo || ' · ' || e.nome from public.equipes_execucao e where e.id = p), 'sem execução definida')
$$;
revoke all on function private.revcli_exec_rotulo(text) from public, anon, authenticated;

-- ── Execução finalizada (serviço da M.O. concluído) ──────────────────────────
alter table public.revistorias_cliente
  add column if not exists execucao_finalizada_em timestamptz,
  add column if not exists execucao_finalizada_por text not null default '';
comment on column public.revistorias_cliente.execucao_finalizada_em is
  'Serviço da mão de obra concluído (marcado na Execução M.O.); nulo = não finalizado. Não muda o status da revistoria.';

-- Define (ou remove) a equipe: só equipes ativas podem ser escolhidas; a atual (mesmo desativada) continua valendo.
create or replace function public.revistoria_execucao(p_unit_id bigint, p_execucao text, p_anterior text default null,
  p_pedido uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare a public.revistorias_cliente; r jsonb; v_novo text := nullif(btrim(coalesce(p_execucao, '')), ''); v_ant text;
begin
  r := private.revcli_repetido(p_pedido); if r is not null then return r; end if;
  if v_novo is not null and not exists (select 1 from public.equipes_execucao e where e.id = v_novo and e.ativo) then
    raise exception 'Escolha uma das equipes de execução ativas';
  end if;
  perform private.revcli_travar(p_unit_id);
  r := private.revcli_repetido(p_pedido); if r is not null then return r; end if;
  a := private.revcli_linha(p_unit_id);
  v_ant := a.execucao;
  if v_ant is not distinct from v_novo then
    return jsonb_build_object('ok', true, 'sem_mudanca', true, 'acompanhamento', to_jsonb(a));
  end if;
  if v_ant is distinct from nullif(btrim(coalesce(p_anterior, '')), '') then
    raise exception 'A execução desta unidade acabou de ser alterada por outra pessoa (agora: %). Confira e tente de novo.',
      private.revcli_exec_rotulo(v_ant);
  end if;
  update public.revistorias_cliente
     set execucao = v_novo, execucao_em = now(), execucao_por = private.revcli_email(),
         atualizado_em = now(), atualizado_por = (select auth.uid()), atualizado_email = private.revcli_email()
   where id = a.id
  returning * into a;
  perform private.revcli_evento(a, null, 'execucao', a.status,
    case when v_novo is null then 'Execução removida' else 'Execução: ' || private.revcli_exec_rotulo(v_novo) end ||
    case when v_ant is not null then ' (antes: ' || private.revcli_exec_rotulo(v_ant) || ')' else '' end, p_pedido);
  return jsonb_build_object('ok', true, 'acompanhamento', to_jsonb(a));
end $$;

-- Marca (ou desmarca) o serviço da mão de obra como concluído. Mesma permissão de liberar/definir a equipe.
create or replace function public.revistoria_execucao_finalizar(p_unit_id bigint, p_finalizada boolean, p_pedido uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare a public.revistorias_cliente; r jsonb;
begin
  r := private.revcli_repetido(p_pedido); if r is not null then return r; end if;
  if p_finalizada is null then raise exception 'Informe se a execução está finalizada'; end if;
  perform private.revcli_travar(p_unit_id);
  r := private.revcli_repetido(p_pedido); if r is not null then return r; end if;
  a := private.revcli_linha(p_unit_id);
  if (a.execucao_finalizada_em is not null) = p_finalizada then
    return jsonb_build_object('ok', true, 'sem_mudanca', true, 'acompanhamento', to_jsonb(a));
  end if;
  if p_finalizada and a.execucao is null then raise exception 'Defina a equipe de execução antes de finalizar'; end if;
  update public.revistorias_cliente
     set execucao_finalizada_em = case when p_finalizada then now() end,
         execucao_finalizada_por = case when p_finalizada then private.revcli_email() else '' end,
         atualizado_em = now(), atualizado_por = (select auth.uid()), atualizado_email = private.revcli_email()
   where id = a.id
  returning * into a;
  perform private.revcli_evento(a, null, 'execucao', a.status,
    case when p_finalizada then 'Execução finalizada: serviço concluído por ' || private.revcli_exec_rotulo(a.execucao)
         else 'Execução reaberta (serviço não finalizado)' end, p_pedido);
  return jsonb_build_object('ok', true, 'acompanhamento', to_jsonb(a));
end $$;

revoke all on function public.cores_legenda_salvar(text, text, text) from public, anon;
revoke all on function public.cores_legenda_restaurar(text, text) from public, anon;
revoke all on function public.equipe_execucao_salvar(text, text, text, text, text, boolean) from public, anon;
revoke all on function public.equipe_execucao_restaurar_cor(text) from public, anon;
revoke all on function public.revistoria_execucao(bigint, text, text, uuid) from public, anon;
revoke all on function public.revistoria_execucao_finalizar(bigint, boolean, uuid) from public, anon;
grant execute on function public.cores_legenda_salvar(text, text, text) to authenticated;
grant execute on function public.cores_legenda_restaurar(text, text) to authenticated;
grant execute on function public.equipe_execucao_salvar(text, text, text, text, text, boolean) to authenticated;
grant execute on function public.equipe_execucao_restaurar_cor(text) to authenticated;
grant execute on function public.revistoria_execucao(bigint, text, text, uuid) to authenticated;
grant execute on function public.revistoria_execucao_finalizar(bigint, boolean, uuid) to authenticated;

-- ── Tempo real: telas abertas recebem a nova cor/equipe na hora ──────────────
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'cores_legendas') then
      alter publication supabase_realtime add table public.cores_legendas;
    end if;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'equipes_execucao') then
      alter publication supabase_realtime add table public.equipes_execucao;
    end if;
  end if;
end $$;
