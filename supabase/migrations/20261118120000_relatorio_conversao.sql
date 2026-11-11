-- Conversor de relatórios do Mobuss → relatório compacto (Edge Function relatorio-converter).
--
-- 1) Versões do relatório (public.revistorias_relatorios_versoes): cada arquivo ligado ao mesmo registro de relatório
--    tem id, caminho no Storage, data, status e número de versão próprios.
--      • tipo 'original'   — o PDF do Mobuss enviado (versão 1; criado automaticamente; nunca é sobrescrito);
--      • tipo 'convertido' — cada geração do relatório compacto (v1, v2, …); reprocessar cria uma versão nova e
--        as anteriores ficam no histórico. A versão vigente é revistorias_relatorios.convertido_id.
--    Status das conversões: aguardando → processando → extraindo → organizando_fotos → gerando → disponivel | falha.
--    "disponivel" só é gravado depois de o arquivo existir no Storage; falha não troca a versão convertida válida.
-- 2) revistorias_relatorios ganha conversao_status / conversao_erro / conversao_em / convertido_id
--    ('pendente' = ainda sem versão convertida). Nada existente é apagado nem alterado (só colunas novas e backfill
--    das versões originais).
-- 3) Dicionário de serviços (public.relatorio_servicos_dicionario): nome longo do checklist → nome curto do
--    relatório. Leitura por membros; escrita só por administradores (relatorio_dicionario_salvar).
-- 4) RPCs: revistoria_conversao_solicitar (usuário com acesso de edição; uma conversão em andamento por relatório)
--    e revistoria_conversao_etapa / _concluir / _falhar (só a Edge Function, com service_role).
-- 5) Storage: as versões convertidas ficam no mesmo bucket privado, em <condomínio>/conversoes/<relatório>/vN.pdf;
--    só o servidor grava nessa pasta. Leitura por URL assinada, como o original.

-- ── 1) Versões ───────────────────────────────────────────────────────────────
create table if not exists public.revistorias_relatorios_versoes (
  id bigint generated always as identity primary key,
  project_id bigint not null references public.projects (id) on delete cascade,
  unit_id bigint not null references public.units (id) on delete cascade,
  relatorio_id bigint not null references public.revistorias_relatorios (id) on delete cascade,
  tipo text not null check (tipo in ('original', 'convertido')),
  versao integer not null check (versao between 1 and 1000),
  status text not null default 'aguardando'
    check (status in ('aguardando', 'processando', 'extraindo', 'organizando_fotos', 'gerando', 'disponivel', 'falha')),
  caminho text unique check (caminho is null or char_length(caminho) <= 400),
  tamanho bigint check (tamanho is null or tamanho between 0 and 52428800),
  paginas integer check (paginas is null or paginas between 0 and 2000),
  resumo jsonb not null default '{}'::jsonb check (jsonb_typeof(resumo) = 'object' and pg_column_size(resumo) <= 65536),
  erro text not null default '' check (char_length(erro) <= 2000),
  conversor text not null default '' check (char_length(conversor) <= 60),
  solicitado_por uuid references public.profiles (id) on delete set null,
  solicitado_email text not null default '',
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  concluido_em timestamptz,
  unique (relatorio_id, tipo, versao),
  constraint revistorias_relatorios_versoes_disponivel_ck check (status <> 'disponivel' or caminho is not null)
);
comment on table public.revistorias_relatorios_versoes is
  'Versões dos arquivos de um relatório da revistoria: o original do Mobuss (tipo original, nunca sobrescrito) e cada geração do relatório compacto (tipo convertido, v1, v2, …). Escrita só pelas funções revistoria_conversao_* e pelo gatilho do original.';
create index if not exists revistorias_relatorios_versoes_rel_idx on public.revistorias_relatorios_versoes (relatorio_id, tipo, versao desc);
create index if not exists revistorias_relatorios_versoes_project_idx on public.revistorias_relatorios_versoes (project_id);
-- uma conversão em andamento por relatório (idempotência contra cliques/envios repetidos)
create unique index if not exists revistorias_relatorios_versoes_andamento_uk on public.revistorias_relatorios_versoes (relatorio_id)
  where tipo = 'convertido' and status not in ('disponivel', 'falha');

alter table public.revistorias_relatorios add column if not exists conversao_status text not null default 'pendente';
alter table public.revistorias_relatorios add column if not exists conversao_erro text not null default '';
alter table public.revistorias_relatorios add column if not exists conversao_em timestamptz;
alter table public.revistorias_relatorios add column if not exists convertido_id bigint
  references public.revistorias_relatorios_versoes (id) on delete set null;
alter table public.revistorias_relatorios drop constraint if exists revistorias_relatorios_conversao_status_check;
alter table public.revistorias_relatorios add constraint revistorias_relatorios_conversao_status_check
  check (conversao_status in ('pendente', 'aguardando', 'processando', 'extraindo', 'organizando_fotos', 'gerando', 'disponivel', 'falha'));
alter table public.revistorias_relatorios drop constraint if exists revistorias_relatorios_conversao_erro_check;
alter table public.revistorias_relatorios add constraint revistorias_relatorios_conversao_erro_check check (char_length(conversao_erro) <= 2000);
comment on column public.revistorias_relatorios.conversao_status is
  'Situação da última conversão para o relatório compacto: pendente (nunca convertido), aguardando, processando, extraindo, organizando_fotos, gerando, disponivel, falha. Com falha, convertido_id continua apontando para a última versão válida (se houver).';
comment on column public.revistorias_relatorios.convertido_id is 'Versão convertida vigente (aberta por padrão no visualizador). Nula = só o original.';

-- O original vira a versão 1 (tipo original) automaticamente, para relatórios novos e os já enviados.
create or replace function private.relconv_original()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.revistorias_relatorios_versoes (project_id, unit_id, relatorio_id, tipo, versao, status, caminho, tamanho, paginas,
                                                     solicitado_por, solicitado_email, criado_em, atualizado_em, concluido_em)
  values (new.project_id, new.unit_id, new.id, 'original', 1, 'disponivel', new.caminho, new.tamanho, new.paginas,
          new.enviado_por, new.enviado_email, new.enviado_em, new.enviado_em, new.enviado_em)
  on conflict do nothing;
  return new;
end $$;
drop trigger if exists revistorias_relatorios_original on public.revistorias_relatorios;
create trigger revistorias_relatorios_original after insert on public.revistorias_relatorios
  for each row execute function private.relconv_original();

insert into public.revistorias_relatorios_versoes (project_id, unit_id, relatorio_id, tipo, versao, status, caminho, tamanho, paginas,
                                                   solicitado_por, solicitado_email, criado_em, atualizado_em, concluido_em)
select r.project_id, r.unit_id, r.id, 'original', 1, 'disponivel', r.caminho, r.tamanho, r.paginas, r.enviado_por, r.enviado_email,
       r.enviado_em, r.enviado_em, r.enviado_em
  from public.revistorias_relatorios r
 where not exists (select 1 from public.revistorias_relatorios_versoes v where v.relatorio_id = r.id and v.tipo = 'original')
on conflict do nothing;

alter table public.revistorias_relatorios_versoes enable row level security;
revoke all on table public.revistorias_relatorios_versoes from public, anon, authenticated;
grant select on table public.revistorias_relatorios_versoes to authenticated;
drop policy if exists revistorias_relatorios_versoes_select_member on public.revistorias_relatorios_versoes;
create policy revistorias_relatorios_versoes_select_member on public.revistorias_relatorios_versoes
  for select to authenticated using (private.project_role(project_id) is not null);

-- ── 3) Dicionário de serviços ────────────────────────────────────────────────
-- Mesma chave do conversor (dicionario.js → chaveServico): sem acento, sem espaço/pontuação, minúsculas.
create or replace function private.relconv_chave(p text)
returns text language sql immutable set search_path = '' as $$
  select regexp_replace(translate(lower(coalesce(p, '')), 'áàâãäåéèêëíìîïóòôõöúùûüçñý', 'aaaaaaeeeeiiiiooooouuuucny'), '[^a-z0-9]', '', 'g')
$$;

create table if not exists public.relatorio_servicos_dicionario (
  id bigint generated always as identity primary key,
  original text not null check (char_length(btrim(original)) between 2 and 200),
  chave text not null unique,
  curto text not null check (char_length(btrim(curto)) between 1 and 80),
  ativo boolean not null default true,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  atualizado_email text not null default ''
);
comment on table public.relatorio_servicos_dicionario is
  'Equivalência dos nomes de serviço do checklist do Mobuss para o nome curto do relatório compacto. Serviço sem equivalência mantém o nome original. Escrita só por relatorio_dicionario_salvar (administradores); desativar em vez de apagar.';
insert into public.relatorio_servicos_dicionario (original, chave, curto) values
  ('REVESTIMENTO - PISO/PAREDE (CERÂMICO)', private.relconv_chave('REVESTIMENTO - PISO/PAREDE (CERÂMICO)'), 'Cerâmica'),
  ('REVESTIMENTO - PAREDE/TETO (SKIN COAT)', private.relconv_chave('REVESTIMENTO - PAREDE/TETO (SKIN COAT)'), 'Skin Coat'),
  ('REVESTIMENTO - PISO (LAMINADO)', private.relconv_chave('REVESTIMENTO - PISO (LAMINADO)'), 'Piso Laminado'),
  ('SISTEMA ELÉTRICO - TOMADAS', private.relconv_chave('SISTEMA ELÉTRICO - TOMADAS'), 'Tomadas'),
  ('SISTEMA HIDRÁULICO - LOUÇAS E METAIS', private.relconv_chave('SISTEMA HIDRÁULICO - LOUÇAS E METAIS'), 'Louças e Metais'),
  ('ESQUADRIAS - PORTAS', private.relconv_chave('ESQUADRIAS - PORTAS'), 'Portas'),
  ('ESQUADRIAS - JANELA', private.relconv_chave('ESQUADRIAS - JANELA'), 'Janelas')
on conflict (chave) do nothing;

alter table public.relatorio_servicos_dicionario enable row level security;
revoke all on table public.relatorio_servicos_dicionario from public, anon, authenticated;
grant select on table public.relatorio_servicos_dicionario to authenticated;
drop policy if exists relatorio_servicos_dicionario_select on public.relatorio_servicos_dicionario;
create policy relatorio_servicos_dicionario_select on public.relatorio_servicos_dicionario
  for select to authenticated using (private.is_any_member());

-- p_id nulo = nova equivalência (ou atualiza a existente com o mesmo nome original).
create or replace function public.relatorio_dicionario_salvar(p_id bigint, p_original text, p_curto text, p_ativo boolean default true)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_orig text := btrim(regexp_replace(coalesce(p_original, ''), '\s+', ' ', 'g'));
        v_curto text := btrim(regexp_replace(coalesce(p_curto, ''), '\s+', ' ', 'g'));
        v_chave text; d public.relatorio_servicos_dicionario; v_email text;
begin
  if (select auth.uid()) is null or not private.is_any_admin() then
    raise exception 'Só administradores podem alterar o dicionário de serviços' using errcode = '42501';
  end if;
  v_chave := private.relconv_chave(v_orig);
  if char_length(v_orig) < 2 or v_chave = '' then raise exception 'Informe o nome do serviço como aparece no Mobuss'; end if;
  if char_length(v_orig) > 200 then raise exception 'Nome do serviço muito longo (máximo de 200 caracteres)'; end if;
  if v_curto = '' then raise exception 'Informe o nome curto'; end if;
  if char_length(v_curto) > 80 then raise exception 'Nome curto muito longo (máximo de 80 caracteres)'; end if;
  v_email := coalesce((select email from public.profiles where id = (select auth.uid())), '');
  if p_id is null then
    insert into public.relatorio_servicos_dicionario (original, chave, curto, ativo, atualizado_email)
    values (v_orig, v_chave, v_curto, coalesce(p_ativo, true), v_email)
    on conflict (chave) do update set original = excluded.original, curto = excluded.curto, ativo = excluded.ativo,
                                      atualizado_em = now(), atualizado_email = excluded.atualizado_email
    returning * into d;
  else
    if exists (select 1 from public.relatorio_servicos_dicionario where chave = v_chave and id <> p_id) then
      raise exception 'Já existe uma equivalência para este serviço';
    end if;
    update public.relatorio_servicos_dicionario
       set original = v_orig, chave = v_chave, curto = v_curto, ativo = coalesce(p_ativo, true), atualizado_em = now(), atualizado_email = v_email
     where id = p_id returning * into d;
    if not found then raise exception 'Equivalência não encontrada'; end if;
  end if;
  return to_jsonb(d);
end $$;

-- ── 4) Conversão ─────────────────────────────────────────────────────────────
-- Pede a conversão (usuário com acesso de edição de revistorias no condomínio). Idempotente: se já houver uma
-- conversão em andamento (atualizada há menos de 5 min), devolve a mesma; uma parada há mais tempo é marcada como
-- falha (tempo esgotado) e uma nova versão é aberta. Sem p_reprocessar, um relatório já convertido não é refeito.
create or replace function public.revistoria_conversao_solicitar(p_relatorio_id bigint, p_reprocessar boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare rel public.revistorias_relatorios; v public.revistorias_relatorios_versoes; n int;
begin
  select * into rel from public.revistorias_relatorios where id = p_relatorio_id;
  if not found or rel.removido_em is not null then raise exception 'Relatório não encontrado'; end if;
  perform private.revcli_travar(rel.unit_id);
  select * into rel from public.revistorias_relatorios where id = p_relatorio_id for update;
  select * into v from public.revistorias_relatorios_versoes
   where relatorio_id = rel.id and tipo = 'convertido' and status not in ('disponivel', 'falha');
  if found then
    if v.atualizado_em > now() - interval '5 minutes' then
      return jsonb_build_object('ok', true, 'em_andamento', true, 'versao', to_jsonb(v));
    end if;
    update public.revistorias_relatorios_versoes
       set status = 'falha', erro = 'A conversão anterior não terminou (tempo esgotado). Uma nova tentativa foi iniciada.', atualizado_em = now()
     where id = v.id;
  end if;
  if not coalesce(p_reprocessar, false) and rel.convertido_id is not null then
    select * into v from public.revistorias_relatorios_versoes where id = rel.convertido_id;
    return jsonb_build_object('ok', true, 'ja_convertido', true, 'versao', to_jsonb(v));
  end if;
  select coalesce(max(versao), 0) + 1 into n from public.revistorias_relatorios_versoes where relatorio_id = rel.id and tipo = 'convertido';
  insert into public.revistorias_relatorios_versoes (project_id, unit_id, relatorio_id, tipo, versao, status, solicitado_por, solicitado_email)
  values (rel.project_id, rel.unit_id, rel.id, 'convertido', n, 'aguardando', (select auth.uid()), private.revcli_email())
  returning * into v;
  update public.revistorias_relatorios set conversao_status = 'aguardando', conversao_erro = '', conversao_em = now() where id = rel.id;
  return jsonb_build_object('ok', true, 'versao', to_jsonb(v));
end $$;

-- Etapas intermediárias (só o servidor). Não mexe em versões já concluídas.
create or replace function public.revistoria_conversao_etapa(p_versao_id bigint, p_status text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v public.revistorias_relatorios_versoes;
begin
  if p_status not in ('processando', 'extraindo', 'organizando_fotos', 'gerando') then raise exception 'Etapa inválida'; end if;
  update public.revistorias_relatorios_versoes set status = p_status, atualizado_em = now()
   where id = p_versao_id and tipo = 'convertido' and status not in ('disponivel', 'falha')
  returning * into v;
  if not found then raise exception 'Conversão não encontrada ou já encerrada'; end if;
  update public.revistorias_relatorios set conversao_status = p_status, conversao_em = now() where id = v.relatorio_id;
  return to_jsonb(v);
end $$;

-- Conclusão: só depois de o arquivo estar no Storage, no caminho da versão. Passa a ser a versão vigente.
create or replace function public.revistoria_conversao_concluir(p_versao_id bigint, p_caminho text, p_tamanho bigint,
  p_paginas integer, p_resumo jsonb default '{}'::jsonb, p_conversor text default '')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v public.revistorias_relatorios_versoes; a public.revistorias_cliente;
begin
  select * into v from public.revistorias_relatorios_versoes where id = p_versao_id and tipo = 'convertido' for update;
  if not found then raise exception 'Conversão não encontrada'; end if;
  if v.status in ('disponivel', 'falha') then raise exception 'Conversão já encerrada'; end if;
  if coalesce(p_caminho, '') <> (v.project_id || '/conversoes/' || v.relatorio_id || '/v' || v.versao || '.pdf') then
    raise exception 'Caminho do arquivo convertido inválido';
  end if;
  if not exists (select 1 from storage.objects where bucket_id = 'revistorias-relatorios' and name = p_caminho) then
    raise exception 'O arquivo convertido não foi encontrado no armazenamento';
  end if;
  if jsonb_typeof(coalesce(p_resumo, '{}'::jsonb)) <> 'object' or pg_column_size(coalesce(p_resumo, '{}'::jsonb)) > 65536 then
    raise exception 'Resumo da conversão inválido';
  end if;
  update public.revistorias_relatorios_versoes
     set status = 'disponivel', caminho = p_caminho, tamanho = p_tamanho, paginas = p_paginas, resumo = coalesce(p_resumo, '{}'::jsonb),
         conversor = left(coalesce(p_conversor, ''), 60), erro = '', atualizado_em = now(), concluido_em = now()
   where id = v.id returning * into v;
  update public.revistorias_relatorios set convertido_id = v.id, conversao_status = 'disponivel', conversao_erro = '', conversao_em = now()
   where id = v.relatorio_id;
  select * into a from public.revistorias_cliente where unit_id = v.unit_id;
  if found then
    perform private.revcli_evento(a, null, 'relatorio', a.status,
      'Relatório compacto gerado (versão ' || v.versao || ', ' || coalesce(v.resumo ->> 'ncs', '?') || ' NCs, '
      || coalesce(v.resumo ->> 'fotos', '?') || ' fotos)');
  end if;
  return to_jsonb(v);
end $$;

-- Falha: o original e a versão convertida vigente (se houver) ficam como estão.
create or replace function public.revistoria_conversao_falhar(p_versao_id bigint, p_erro text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v public.revistorias_relatorios_versoes; v_erro text := left(coalesce(nullif(btrim(p_erro), ''), 'Falha na conversão'), 2000);
begin
  update public.revistorias_relatorios_versoes set status = 'falha', erro = v_erro, atualizado_em = now(), concluido_em = now()
   where id = p_versao_id and tipo = 'convertido' and status not in ('disponivel', 'falha')
  returning * into v;
  if not found then raise exception 'Conversão não encontrada ou já encerrada'; end if;
  update public.revistorias_relatorios set conversao_status = 'falha', conversao_erro = v_erro, conversao_em = now() where id = v.relatorio_id;
  return to_jsonb(v);
end $$;

-- ── 5) Storage: a pasta "conversoes" é só do servidor ───────────────────────
drop policy if exists revistorias_relatorios_enviar on storage.objects;
create policy revistorias_relatorios_enviar on storage.objects for insert to authenticated
  with check (bucket_id = 'revistorias-relatorios' and private.revcli_pode_editar(private.revrel_projeto(name))
              and lower(name) like '%.pdf' and split_part(name, '/', 2) <> 'conversoes');

-- ── Permissões das funções ───────────────────────────────────────────────────
revoke all on function private.relconv_original() from public, anon, authenticated;
revoke all on function private.relconv_chave(text) from public, anon;
grant execute on function private.relconv_chave(text) to authenticated, service_role;
revoke all on function public.relatorio_dicionario_salvar(bigint, text, text, boolean) from public, anon;
grant execute on function public.relatorio_dicionario_salvar(bigint, text, text, boolean) to authenticated;
revoke all on function public.revistoria_conversao_solicitar(bigint, boolean) from public, anon;
grant execute on function public.revistoria_conversao_solicitar(bigint, boolean) to authenticated;
do $$
declare f text;
begin
  foreach f in array array[
    'public.revistoria_conversao_etapa(bigint, text)',
    'public.revistoria_conversao_concluir(bigint, text, bigint, integer, jsonb, text)',
    'public.revistoria_conversao_falhar(bigint, text)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;

-- ── Tempo real: a tela acompanha as etapas da conversão ──────────────────────
do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['revistorias_relatorios_versoes', 'relatorio_servicos_dicionario'] loop
      if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;
