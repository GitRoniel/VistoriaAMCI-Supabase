-- Revistoria · Cliente: acompanhamento das revistorias pedidas pelo cliente, em aba própria.
--
-- 1) public.revistorias (já existia, vinda da planilha) passa a ser o registro de cada agendamento
--    de revistoria da unidade (nº 1, 2, 3…), também criado pelo site. Ganha responsável,
--    observações, data da realização, observação do resultado, ciclo e o status "Cancelada"
--    (agendamento desmarcado ou remarcado: fica no histórico). Nada existente é apagado.
--      status do agendamento: Agendada / Em revistoria (em aberto) · Cancelada · Aprovada / Reprovada
--      (realizada; o status é o resultado)
-- 2) public.revistorias_cliente: uma linha por unidade em acompanhamento (sem duplicar), ligada
--    ao condomínio, à unidade e à vistoria original (client_inspections). Situação:
--      Em andamento (aguardando agendamento) · Agendado · Aprovado
--    ciclo = nº do ciclo atual (cada reprovação ou reabertura começa um ciclo novo).
-- 3) public.revistorias_eventos: histórico imutável de cada mudança (quem, quando, de/para).
-- 4) Entrada automática: quando o status da vistoria passa a "Revistoria", a unidade entra na aba
--    como "Em andamento" (sem duplicar; se já estava Aprovada, começa um ciclo novo). Quando passa
--    a "Revistoria Finalizada" na aba Vistoria, a revistoria fica Aprovada.
-- 5) Funções (só admin e revistorias do condomínio; visitante só consulta):
--      revistoria_agendar   Em andamento → Agendado (ou remarca: o agendamento anterior fica Cancelada)
--      revistoria_cancelar  Agendado → Em andamento
--      revistoria_resultado Agendado → Aprovado (vistoria Revistoria → Revistoria Finalizada, com data e
--                           responsável da revistoria) ou Reprovado → Em andamento, ciclo novo
--      revistoria_reabrir   Aprovado → Em andamento, ciclo novo (vistoria Finalizada → Revistoria)
--    Todas conferem a versão da tela (p_versao) e o pedido repetido (p_pedido).
-- 6) A importação da planilha continua igual: as revistorias que ela cria/atualiza também
--    atualizam a situação da unidade na aba (sem mudar o status da vistoria).
-- Não altera políticas existentes nem dados das vistorias; os 213 apartamentos em Revistoria
-- entram como "Em andamento" e os em Revistoria Finalizada como "Aprovado" (com a revistoria
-- registrada a partir da data e do responsável que já estavam na vistoria).

-- ── 1) Agendamentos (public.revistorias) ─────────────────────────────────────
alter table public.revistorias
  add column if not exists ciclo smallint,
  add column if not exists responsavel text not null default '',
  add column if not exists observacoes text not null default '',
  add column if not exists realizada_em date,
  add column if not exists resultado_obs text not null default '';

alter table public.revistorias drop constraint if exists revistorias_status_check;
alter table public.revistorias add constraint revistorias_status_check
  check (status in ('Agendada', 'Em revistoria', 'Aprovada', 'Reprovada', 'Cancelada'));
alter table public.revistorias drop constraint if exists revistorias_origem_check;
alter table public.revistorias add constraint revistorias_origem_check
  check (origem in ('PLANILHA', 'SISTEMA', 'VISTORIA'));
alter table public.revistorias drop constraint if exists revistorias_textos_check;
alter table public.revistorias add constraint revistorias_textos_check
  check (char_length(responsavel) <= 80 and char_length(observacoes) <= 500 and char_length(resultado_obs) <= 500);
alter table public.revistorias drop constraint if exists revistorias_ciclo_check;
alter table public.revistorias add constraint revistorias_ciclo_check check (ciclo is null or ciclo between 1 and 99);

comment on table public.revistorias is
  'Agendamentos de revistoria da unidade (nº 1, 2…), do site (SISTEMA), da planilha (PLANILHA) ou da aba Vistoria (VISTORIA). Status: Agendada/Em revistoria (em aberto), Cancelada, Aprovada/Reprovada (realizada; status = resultado). Gravação só pelas funções revistoria_* e aplicar_importacao_agendamentos.';
comment on column public.revistorias.data is 'Data agendada da revistoria.';
comment on column public.revistorias.realizada_em is 'Data em que a revistoria foi realizada (com o resultado).';
comment on column public.revistorias.ciclo is 'Ciclo de acompanhamento (revistorias_cliente.ciclo) em que o agendamento foi feito.';

-- ── 2) Acompanhamento por unidade ────────────────────────────────────────────
create table if not exists public.revistorias_cliente (
  id bigint generated always as identity primary key,
  project_id bigint not null references public.projects (id) on delete cascade,
  unit_id bigint not null unique references public.units (id) on delete cascade,
  inspection_id bigint unique references public.client_inspections (id) on delete set null,
  status text not null default 'Em andamento' check (status in ('Em andamento', 'Agendado', 'Aprovado')),
  ciclo smallint not null default 1 check (ciclo between 1 and 99),
  revistoria_id bigint references public.revistorias (id) on delete set null,
  entrou_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  atualizado_por uuid references public.profiles (id) on delete set null,
  atualizado_email text not null default '',
  versao bigint not null default 1
);
comment on table public.revistorias_cliente is
  'Revistoria · Cliente: situação de acompanhamento da unidade (Em andamento, Agendado, Aprovado). Uma linha por unidade, ligada à vistoria original. Gravação só pelas funções revistoria_* e pelos gatilhos de sincronização.';
comment on column public.revistorias_cliente.revistoria_id is 'Agendamento em aberto (Agendado) ou o último realizado.';
comment on column public.revistorias_cliente.versao is 'Muda a cada alteração: a tela envia a versão que mostrou (p_versao) para não sobrescrever outra pessoa.';
create index if not exists revistorias_cliente_project_idx on public.revistorias_cliente (project_id);

-- ── 3) Histórico imutável ────────────────────────────────────────────────────
create table if not exists public.revistorias_eventos (
  id bigint generated always as identity primary key,
  project_id bigint not null references public.projects (id) on delete cascade,
  unit_id bigint not null references public.units (id) on delete cascade,
  revistoria_id bigint references public.revistorias (id) on delete cascade,
  tipo text not null check (tipo in ('entrada', 'agendamento', 'remarcacao', 'cancelamento', 'resultado', 'reabertura', 'vistoria', 'planilha')),
  status_anterior text,
  status_novo text not null,
  ciclo smallint not null,
  descricao text not null default '' check (char_length(descricao) <= 900),
  registrado_por uuid references public.profiles (id) on delete set null,
  registrado_email text not null default '',
  registrado_em timestamptz not null default now(),
  pedido_id uuid unique
);
comment on table public.revistorias_eventos is
  'Revistoria · Cliente: histórico imutável (entrada, agendamento, remarcação, cancelamento, resultado, reabertura e mudanças vindas da vistoria ou da planilha).';
create index if not exists revistorias_eventos_unit_idx on public.revistorias_eventos (unit_id, registrado_em desc);
create index if not exists revistorias_eventos_project_idx on public.revistorias_eventos (project_id);

create or replace function private.revcli_historico_imutavel()
returns trigger language plpgsql set search_path = '' as $$
begin
  -- exclusão em cascata (unidade/condomínio/agendamento) vem de outro gatilho: profundidade > 1
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then return old; end if;
  raise exception 'O histórico de revistorias não pode ser alterado nem apagado';
end $$;
revoke all on function private.revcli_historico_imutavel() from public, anon, authenticated;
drop trigger if exists revistorias_eventos_imutavel on public.revistorias_eventos;
create trigger revistorias_eventos_imutavel before update or delete on public.revistorias_eventos
for each row execute function private.revcli_historico_imutavel();

-- ── Segurança: leitura por membro ativo do condomínio; escrita só pelas funções ──
alter table public.revistorias_cliente enable row level security;
alter table public.revistorias_eventos enable row level security;
revoke all on table public.revistorias_cliente, public.revistorias_eventos from public, anon, authenticated;
grant select on table public.revistorias_cliente, public.revistorias_eventos to authenticated;
drop policy if exists revistorias_cliente_select_member on public.revistorias_cliente;
create policy revistorias_cliente_select_member on public.revistorias_cliente
  for select to authenticated using (private.project_role(project_id) is not null);
drop policy if exists revistorias_eventos_select_member on public.revistorias_eventos;
create policy revistorias_eventos_select_member on public.revistorias_eventos
  for select to authenticated using (private.project_role(project_id) is not null);

-- ── Auxiliares ───────────────────────────────────────────────────────────────
create or replace function private.revcli_pode_editar(p_project bigint)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(private.project_role(p_project) in ('admin', 'revistorias'), false)
$$;

create or replace function private.revcli_hoje()
returns date language sql stable set search_path = '' as $$
  select (now() at time zone 'America/Sao_Paulo')::date
$$;

create or replace function private.revcli_email()
returns text language sql stable security definer set search_path = '' as $$
  select coalesce((select email from public.profiles where id = (select auth.uid())), '')
$$;

create or replace function private.revcli_data_br(p date)
returns text language sql immutable set search_path = '' as $$
  select coalesce(to_char(p, 'DD/MM/YYYY'), 'sem data')
$$;

create or replace function private.revcli_nome(p text, p_campo text)
returns text language plpgsql immutable set search_path = '' as $$
declare v text := btrim(regexp_replace(coalesce(p, ''), '\s+', ' ', 'g'));
begin
  if char_length(v) < 2 then raise exception 'Informe %', p_campo; end if;
  if char_length(v) > 80 then raise exception 'Nome muito longo (máximo de 80 caracteres)'; end if;
  return v;
end $$;

create or replace function private.revcli_texto(p text, p_max int default 500)
returns text language plpgsql immutable set search_path = '' as $$
declare v text := btrim(coalesce(p, ''));
begin
  if char_length(v) > p_max then raise exception 'Observação muito longa (máximo de % caracteres)', p_max; end if;
  return v;
end $$;

-- Registra um evento no histórico.
create or replace function private.revcli_evento(p_a public.revistorias_cliente, p_rev bigint, p_tipo text,
  p_anterior text, p_descricao text, p_pedido uuid default null)
returns void language sql security definer set search_path = '' as $$
  insert into public.revistorias_eventos (project_id, unit_id, revistoria_id, tipo, status_anterior, status_novo, ciclo,
                                          descricao, registrado_por, registrado_email, pedido_id)
  values (p_a.project_id, p_a.unit_id, p_rev, p_tipo, p_anterior, p_a.status, p_a.ciclo, left(coalesce(p_descricao, ''), 900),
          (select auth.uid()), private.revcli_email(), p_pedido)
$$;

-- Acompanhamento da unidade (cria "Em andamento" se ainda não existir, sem duplicar) e trava a linha.
create or replace function private.revcli_garantir(p_unit_id bigint, p_descricao text)
returns public.revistorias_cliente language plpgsql security definer set search_path = '' as $$
declare a public.revistorias_cliente; v_pid bigint; v_insp bigint;
begin
  select * into a from public.revistorias_cliente where unit_id = p_unit_id for update;
  if found then return a; end if;
  select project_id into v_pid from public.units where id = p_unit_id;
  select id into v_insp from public.client_inspections where unit_id = p_unit_id;
  insert into public.revistorias_cliente (project_id, unit_id, inspection_id, status, ciclo, atualizado_por, atualizado_email)
  values (v_pid, p_unit_id, v_insp, 'Em andamento', 1, (select auth.uid()), private.revcli_email())
  on conflict (unit_id) do nothing;
  select * into a from public.revistorias_cliente where unit_id = p_unit_id for update;
  if a.versao = 1 and not exists (select 1 from public.revistorias_eventos where unit_id = p_unit_id) then
    perform private.revcli_evento(a, null, 'entrada', null, p_descricao);
  end if;
  return a;
end $$;

-- Atualiza a situação (versão + quem alterou) e devolve a linha nova.
create or replace function private.revcli_mudar(p_id bigint, p_status text, p_ciclo smallint, p_rev bigint)
returns public.revistorias_cliente language sql security definer set search_path = '' as $$
  update public.revistorias_cliente
     set status = p_status, ciclo = p_ciclo, revistoria_id = p_rev, versao = versao + 1,
         atualizado_em = now(), atualizado_por = (select auth.uid()), atualizado_email = private.revcli_email()
   where id = p_id
  returning *
$$;

-- Pedido repetido (clique duplo, reenvio após falha de rede): devolve a situação atual sem repetir.
create or replace function private.revcli_repetido(p_pedido uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('ok', true, 'repetido', true, 'acompanhamento', to_jsonb(a))
    from public.revistorias_eventos e join public.revistorias_cliente a on a.unit_id = e.unit_id
   where p_pedido is not null and e.pedido_id = p_pedido
   limit 1
$$;

-- Trava a unidade e confere a permissão (as funções chamam antes de ler a situação).
create or replace function private.revcli_travar(p_unit_id bigint)
returns bigint language plpgsql security definer set search_path = '' as $$
declare v_pid bigint;
begin
  select project_id into v_pid from public.units where id = p_unit_id for no key update;
  if not found then raise exception 'Unidade não encontrada'; end if;
  if not private.revcli_pode_editar(v_pid) then
    raise exception 'Seu acesso a este condomínio não permite alterar revistorias' using errcode = '42501';
  end if;
  return v_pid;
end $$;

-- Situação atual conferindo a versão que a tela mostrou.
create or replace function private.revcli_atual(p_unit_id bigint, p_versao bigint)
returns public.revistorias_cliente language plpgsql security definer set search_path = '' as $$
declare a public.revistorias_cliente;
begin
  select * into a from public.revistorias_cliente where unit_id = p_unit_id for update;
  if not found then
    raise exception 'Esta unidade não está na Revistoria · Cliente (o status da vistoria precisa ser Revistoria)';
  end if;
  if p_versao is distinct from a.versao then
    raise exception 'A revistoria desta unidade acabou de ser alterada por outra pessoa. Confira a situação atual e tente de novo.';
  end if;
  return a;
end $$;

-- ── 4) Sincronização ─────────────────────────────────────────────────────────
-- As funções revistoria_* ligam app.revcli durante a transação: os gatilhos abaixo não repetem
-- o que elas já registraram.

-- Ciclo do agendamento criado fora das funções (planilha).
create or replace function private.revcli_ciclo_padrao()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.ciclo is null then
    new.ciclo := coalesce((select ciclo from public.revistorias_cliente where unit_id = new.unit_id), 1);
  end if;
  return new;
end $$;
drop trigger if exists revistorias_10_ciclo on public.revistorias;
create trigger revistorias_10_ciclo before insert on public.revistorias
for each row execute function private.revcli_ciclo_padrao();

-- Status da vistoria → situação da revistoria.
create or replace function private.revcli_vistoria_mudou()
returns trigger language plpgsql security definer set search_path = '' as $$
declare a public.revistorias_cliente; v_rev bigint; v_ant text; v_num smallint; v_hoje date := private.revcli_hoje();
begin
  if coalesce(current_setting('app.revcli', true), '') = 'on' then return null; end if;
  if tg_op = 'UPDATE' and new.status is not distinct from old.status then return null; end if;
  if new.status not in ('Revistoria', 'Revistoria Finalizada') then return null; end if;

  perform set_config('app.revcli', 'on', true);
  if new.status = 'Revistoria' then
    a := private.revcli_garantir(new.unit_id, 'Entrou na Revistoria · Cliente: status da vistoria passou para Revistoria');
    if a.status = 'Aprovado' then
      v_ant := a.status;
      a := private.revcli_mudar(a.id, 'Em andamento', (a.ciclo + 1)::smallint, a.revistoria_id);
      perform private.revcli_evento(a, null, 'vistoria', v_ant, 'Status da vistoria voltou para Revistoria: novo ciclo de revistoria');
    end if;
  else
    a := private.revcli_garantir(new.unit_id, 'Entrou na Revistoria · Cliente: revistoria finalizada na aba Vistoria');
    if a.status <> 'Aprovado' then
      v_ant := a.status;
      if a.status = 'Agendado' and a.revistoria_id is not null then
        update public.revistorias
           set status = 'Aprovada', realizada_em = coalesce(new.reinspection_date, v_hoje),
               responsavel = coalesce(nullif(left(btrim(new.reinspection_responsible), 80), ''), responsavel),
               resultado_obs = 'Revistoria finalizada na aba Vistoria', atualizado_em = now(), atualizado_por = (select auth.uid())
         where id = a.revistoria_id and status in ('Agendada', 'Em revistoria')
        returning id into v_rev;
      end if;
      if v_rev is null then
        select coalesce(max(numero), 0) + 1 into v_num from public.revistorias where unit_id = new.unit_id;
        insert into public.revistorias (project_id, unit_id, numero, status, data, realizada_em, responsavel, resultado_obs,
                                        origem, ciclo, criado_por, atualizado_por)
        values (a.project_id, new.unit_id, v_num, 'Aprovada', new.reinspection_date, coalesce(new.reinspection_date, v_hoje),
                left(btrim(coalesce(new.reinspection_responsible, '')), 80), 'Revistoria finalizada na aba Vistoria',
                'VISTORIA', a.ciclo, (select auth.uid()), (select auth.uid()))
        returning id into v_rev;
      end if;
      a := private.revcli_mudar(a.id, 'Aprovado', a.ciclo, v_rev);
      perform private.revcli_evento(a, v_rev, 'vistoria', v_ant, 'Revistoria finalizada na aba Vistoria' ||
        coalesce(' em ' || private.revcli_data_br(new.reinspection_date), '') ||
        coalesce(' · Responsável: ' || nullif(btrim(new.reinspection_responsible), ''), ''));
    end if;
  end if;
  perform set_config('app.revcli', 'off', true);
  return null;
end $$;
drop trigger if exists client_inspections_30_revistoria_cliente on public.client_inspections;
create trigger client_inspections_30_revistoria_cliente after insert or update of status on public.client_inspections
for each row execute function private.revcli_vistoria_mudou();

-- Agendamento criado/alterado pela planilha → situação da revistoria (o status da vistoria não muda).
create or replace function private.revcli_revistoria_mudou()
returns trigger language plpgsql security definer set search_path = '' as $$
declare a public.revistorias_cliente; v_novo text; v_ciclo smallint; v_ant text;
begin
  if coalesce(current_setting('app.revcli', true), '') = 'on' then return null; end if;
  if tg_op = 'UPDATE' and new.status is not distinct from old.status then return null; end if;
  -- só o agendamento mais recente define a situação
  if exists (select 1 from public.revistorias where unit_id = new.unit_id and numero > new.numero) then return null; end if;

  perform set_config('app.revcli', 'on', true);
  a := private.revcli_garantir(new.unit_id, 'Entrou na Revistoria · Cliente pela planilha de vistorias');
  v_novo := case when new.status in ('Agendada', 'Em revistoria') then 'Agendado' when new.status = 'Aprovada' then 'Aprovado' else 'Em andamento' end;
  v_ciclo := a.ciclo + case when new.status = 'Reprovada' and coalesce(new.ciclo, a.ciclo) = a.ciclo then 1 else 0 end;
  if v_novo is distinct from a.status or v_ciclo <> a.ciclo or a.revistoria_id is distinct from new.id then
    v_ant := a.status;
    a := private.revcli_mudar(a.id, v_novo, v_ciclo, new.id);
    perform private.revcli_evento(a, new.id, 'planilha', v_ant, 'Planilha de vistorias: revistoria nº ' || new.numero || ' ' ||
      lower(coalesce(new.status, 'sem status')) || coalesce(' · ' || private.revcli_data_br(new.data), ''));
  end if;
  perform set_config('app.revcli', 'off', true);
  return null;
end $$;
drop trigger if exists revistorias_30_revistoria_cliente on public.revistorias;
create trigger revistorias_30_revistoria_cliente after insert or update of status on public.revistorias
for each row execute function private.revcli_revistoria_mudou();

-- O papel Revistorias só finaliza revistorias na aba Vistoria; a reabertura pela Revistoria · Cliente
-- (novas pendências) devolve a vistoria de Revistoria Finalizada para Revistoria.
create or replace function private.enforce_revistorias_changes()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (select auth.uid()) is null
     or private.project_role(private.unit_project_id(old.unit_id)) is distinct from 'revistorias' then
    return new;
  end if;

  if new.status is distinct from old.status
     and not (old.status = 'Revistoria' and new.status = 'Revistoria Finalizada')
     and not (old.status = 'Revistoria Finalizada' and new.status = 'Revistoria'
              and coalesce(current_setting('app.revcli', true), '') = 'on') then
    raise exception 'o papel Revistorias só pode finalizar revistorias';
  end if;

  if new.client_name is distinct from old.client_name
     or new.inspection_date is distinct from old.inspection_date
     or new.inspection_time is distinct from old.inspection_time
     or new.responsible is distinct from old.responsible
     or new.sale_stage is distinct from old.sale_stage
     or new.technical_escort is distinct from old.technical_escort then
    raise exception 'o papel Revistorias só altera status, data da revistoria e observações';
  end if;

  return new;
end;
$$;

-- ── 5) Funções da aba ────────────────────────────────────────────────────────
-- Agenda (ou remarca) a revistoria: data e responsável obrigatórios.
create or replace function public.revistoria_agendar(p_unit_id bigint, p_data date, p_horario text, p_responsavel text,
  p_observacoes text default '', p_versao bigint default null, p_pedido uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare a public.revistorias_cliente; rv public.revistorias; r jsonb; v_resp text; v_obs text; v_hora time;
        v_ant text; v_tipo text := 'agendamento'; v_num smallint; v_antiga smallint;
begin
  r := private.revcli_repetido(p_pedido); if r is not null then return r; end if;
  if p_data is null then raise exception 'Informe a data da revistoria'; end if;
  if p_data < date '2020-01-01' or p_data > private.revcli_hoje() + 730 then raise exception 'Data da revistoria inválida'; end if;
  if coalesce(p_horario, '') <> '' then
    if p_horario !~ '^([01]\d|2[0-3]):[0-5]\d$' then raise exception 'Horário inválido (use HH:MM)'; end if;
    v_hora := p_horario::time;
  end if;
  v_resp := private.revcli_nome(p_responsavel, 'o responsável pela revistoria');
  v_obs := private.revcli_texto(p_observacoes);

  perform private.revcli_travar(p_unit_id);
  r := private.revcli_repetido(p_pedido); if r is not null then return r; end if;
  a := private.revcli_atual(p_unit_id, p_versao);
  if a.status = 'Aprovado' then
    raise exception 'A revistoria desta unidade já foi aprovada. Use "Reabrir" se houver novas pendências.';
  end if;
  perform set_config('app.revcli', 'on', true);
  v_ant := a.status;
  if a.status = 'Agendado' then   -- remarcação: o agendamento anterior fica no histórico
    update public.revistorias set status = 'Cancelada', resultado_obs = 'Remarcada para ' || private.revcli_data_br(p_data),
           atualizado_em = now(), atualizado_por = (select auth.uid())
     where unit_id = p_unit_id and status in ('Agendada', 'Em revistoria')
    returning numero into v_antiga;
    v_tipo := 'remarcacao';
  end if;
  select coalesce(max(numero), 0) + 1 into v_num from public.revistorias where unit_id = p_unit_id;
  if v_num > 99 then raise exception 'Limite de agendamentos da unidade atingido'; end if;
  insert into public.revistorias (project_id, unit_id, numero, status, data, horario, responsavel, observacoes, origem, ciclo,
                                  criado_por, atualizado_por)
  values (a.project_id, p_unit_id, v_num, 'Agendada', p_data, v_hora, v_resp, v_obs, 'SISTEMA', a.ciclo,
          (select auth.uid()), (select auth.uid()))
  returning * into rv;
  a := private.revcli_mudar(a.id, 'Agendado', a.ciclo, rv.id);
  perform private.revcli_evento(a, rv.id, v_tipo, v_ant,
    case when v_tipo = 'remarcacao' then 'Remarcada' || coalesce(' (agendamento nº ' || v_antiga || ' cancelado)', '') || ': '
         else 'Agendada: ' end ||
    private.revcli_data_br(p_data) || coalesce(' às ' || to_char(v_hora, 'HH24:MI'), '') || ' · Responsável: ' || v_resp ||
    case when v_obs <> '' then ' · ' || v_obs else '' end, p_pedido);
  perform set_config('app.revcli', 'off', true);
  return jsonb_build_object('ok', true, 'acompanhamento', to_jsonb(a), 'revistoria', to_jsonb(rv));
end $$;

-- Cancela o agendamento em aberto: volta para Em andamento.
create or replace function public.revistoria_cancelar(p_unit_id bigint, p_motivo text default '', p_versao bigint default null,
  p_pedido uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare a public.revistorias_cliente; r jsonb; v_obs text; v_rev bigint; v_num smallint;
begin
  r := private.revcli_repetido(p_pedido); if r is not null then return r; end if;
  v_obs := private.revcli_texto(p_motivo);
  perform private.revcli_travar(p_unit_id);
  r := private.revcli_repetido(p_pedido); if r is not null then return r; end if;
  a := private.revcli_atual(p_unit_id, p_versao);
  if a.status <> 'Agendado' then raise exception 'Não há revistoria agendada para cancelar'; end if;
  perform set_config('app.revcli', 'on', true);
  update public.revistorias set status = 'Cancelada', resultado_obs = coalesce(nullif(v_obs, ''), 'Agendamento cancelado'),
         atualizado_em = now(), atualizado_por = (select auth.uid())
   where unit_id = p_unit_id and status in ('Agendada', 'Em revistoria')
  returning id, numero into v_rev, v_num;
  a := private.revcli_mudar(a.id, 'Em andamento', a.ciclo, v_rev);
  perform private.revcli_evento(a, v_rev, 'cancelamento', 'Agendado',
    'Agendamento' || coalesce(' nº ' || v_num, '') || ' cancelado' || case when v_obs <> '' then ': ' || v_obs else '' end, p_pedido);
  perform set_config('app.revcli', 'off', true);
  return jsonb_build_object('ok', true, 'acompanhamento', to_jsonb(a));
end $$;

-- Resultado da revistoria realizada: Aprovada (→ Aprovado) ou Reprovada (→ Em andamento, ciclo novo).
create or replace function public.revistoria_resultado(p_unit_id bigint, p_resultado text, p_realizada_em date,
  p_responsavel text default '', p_observacoes text default '', p_versao bigint default null, p_pedido uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare a public.revistorias_cliente; rv public.revistorias; r jsonb; v_obs text; v_resp text; v_ant text;
        ci public.client_inspections; v_vist text := '';
begin
  r := private.revcli_repetido(p_pedido); if r is not null then return r; end if;
  if p_resultado is null or p_resultado not in ('Aprovada', 'Reprovada') then raise exception 'Escolha o resultado da revistoria'; end if;
  if p_realizada_em is null then raise exception 'Informe a data em que a revistoria foi realizada'; end if;
  if p_realizada_em > private.revcli_hoje() then raise exception 'A data da realização não pode ser futura'; end if;
  if p_realizada_em < date '2020-01-01' then raise exception 'Data da realização inválida'; end if;
  v_obs := private.revcli_texto(p_observacoes);
  if p_resultado = 'Reprovada' and char_length(v_obs) < 3 then raise exception 'Descreva as pendências encontradas na revistoria'; end if;
  if btrim(coalesce(p_responsavel, '')) <> '' then v_resp := private.revcli_nome(p_responsavel, 'o responsável pela revistoria'); end if;

  perform private.revcli_travar(p_unit_id);
  r := private.revcli_repetido(p_pedido); if r is not null then return r; end if;
  a := private.revcli_atual(p_unit_id, p_versao);
  if a.status <> 'Agendado' then raise exception 'Agende a revistoria antes de registrar o resultado'; end if;
  perform set_config('app.revcli', 'on', true);
  update public.revistorias set status = p_resultado, realizada_em = p_realizada_em, responsavel = coalesce(v_resp, responsavel),
         resultado_obs = v_obs, atualizado_em = now(), atualizado_por = (select auth.uid())
   where unit_id = p_unit_id and status in ('Agendada', 'Em revistoria')
  returning * into rv;
  if rv.id is null then raise exception 'Agendamento em aberto não encontrado. Recarregue a página.'; end if;
  v_ant := a.status;
  if p_resultado = 'Aprovada' then
    a := private.revcli_mudar(a.id, 'Aprovado', a.ciclo, rv.id);
    -- Vistoria: Revistoria → Revistoria Finalizada, com a data e o responsável da revistoria.
    select * into ci from public.client_inspections where unit_id = p_unit_id for update;
    if found and ci.status = 'Revistoria' then
      update public.client_inspections set status = 'Revistoria Finalizada', reinspection_date = p_realizada_em,
             reinspection_responsible = rv.responsavel
       where id = ci.id;
      v_vist := ' · Vistoria: Revistoria Finalizada';
    end if;
  else
    a := private.revcli_mudar(a.id, 'Em andamento', (a.ciclo + 1)::smallint, rv.id);
  end if;
  perform private.revcli_evento(a, rv.id, 'resultado', v_ant,
    'Revistoria nº ' || rv.numero || ' ' || lower(p_resultado) || ' em ' || private.revcli_data_br(p_realizada_em) ||
    case when rv.responsavel <> '' then ' · Responsável: ' || rv.responsavel else '' end ||
    case when v_obs <> '' then ' · ' || v_obs else '' end ||
    case when p_resultado = 'Reprovada' then ' · Novo ciclo (' || a.ciclo || 'º)' else '' end || v_vist, p_pedido);
  perform set_config('app.revcli', 'off', true);
  return jsonb_build_object('ok', true, 'acompanhamento', to_jsonb(a), 'revistoria', to_jsonb(rv));
end $$;

-- Novas pendências depois da aprovação: novo ciclo, Em andamento.
create or replace function public.revistoria_reabrir(p_unit_id bigint, p_motivo text, p_versao bigint default null,
  p_pedido uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare a public.revistorias_cliente; r jsonb; v_obs text; ci public.client_inspections; v_vist text := '';
begin
  r := private.revcli_repetido(p_pedido); if r is not null then return r; end if;
  v_obs := private.revcli_texto(p_motivo);
  if char_length(v_obs) < 3 then raise exception 'Descreva as novas pendências'; end if;
  perform private.revcli_travar(p_unit_id);
  r := private.revcli_repetido(p_pedido); if r is not null then return r; end if;
  a := private.revcli_atual(p_unit_id, p_versao);
  if a.status <> 'Aprovado' then raise exception 'Só uma revistoria aprovada pode ser reaberta'; end if;
  perform set_config('app.revcli', 'on', true);
  a := private.revcli_mudar(a.id, 'Em andamento', (a.ciclo + 1)::smallint, a.revistoria_id);
  select * into ci from public.client_inspections where unit_id = p_unit_id for update;
  if found and ci.status = 'Revistoria Finalizada' then
    update public.client_inspections set status = 'Revistoria' where id = ci.id;
    v_vist := ' · Vistoria: Revistoria';
  end if;
  perform private.revcli_evento(a, null, 'reabertura', 'Aprovado', 'Reaberta com novas pendências: ' || v_obs ||
    ' · Novo ciclo (' || a.ciclo || 'º)' || v_vist, p_pedido);
  perform set_config('app.revcli', 'off', true);
  return jsonb_build_object('ok', true, 'acompanhamento', to_jsonb(a));
end $$;

-- Permissões das funções
do $$
declare f text;
begin
  foreach f in array array[
    'private.revcli_pode_editar(bigint)', 'private.revcli_hoje()', 'private.revcli_email()', 'private.revcli_data_br(date)',
    'private.revcli_nome(text, text)', 'private.revcli_texto(text, integer)',
    'private.revcli_evento(public.revistorias_cliente, bigint, text, text, text, uuid)',
    'private.revcli_garantir(bigint, text)', 'private.revcli_mudar(bigint, text, smallint, bigint)',
    'private.revcli_repetido(uuid)', 'private.revcli_travar(bigint)', 'private.revcli_atual(bigint, bigint)',
    'private.revcli_ciclo_padrao()', 'private.revcli_vistoria_mudou()', 'private.revcli_revistoria_mudou()'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
  foreach f in array array[
    'public.revistoria_agendar(bigint, date, text, text, text, bigint, uuid)',
    'public.revistoria_cancelar(bigint, text, bigint, uuid)',
    'public.revistoria_resultado(bigint, text, date, text, text, bigint, uuid)',
    'public.revistoria_reabrir(bigint, text, bigint, uuid)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

-- ── Tempo real ───────────────────────────────────────────────────────────────
do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['revistorias_cliente', 'revistorias_eventos'] loop
      if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;

-- ── Situação inicial (sem apagar nada) ───────────────────────────────────────
do $$
declare v_hoje date := private.revcli_hoje();
begin
  perform set_config('app.revcli', 'on', true);
  -- Vistoria em Revistoria → Em andamento; Revistoria Finalizada → Aprovado.
  insert into public.revistorias_cliente (project_id, unit_id, inspection_id, status, ciclo, atualizado_email)
  select u.project_id, ci.unit_id, ci.id, case when ci.status = 'Revistoria Finalizada' then 'Aprovado' else 'Em andamento' end, 1, 'migração'
    from public.client_inspections ci join public.units u on u.id = ci.unit_id
   where ci.status in ('Revistoria', 'Revistoria Finalizada')
  on conflict (unit_id) do nothing;

  -- Revistoria Finalizada sem agendamento registrado: a revistoria aprovada com a data e o responsável da vistoria.
  insert into public.revistorias (project_id, unit_id, numero, status, data, realizada_em, responsavel, resultado_obs, origem, ciclo)
  select u.project_id, ci.unit_id, 1, 'Aprovada', ci.reinspection_date, ci.reinspection_date,
         left(btrim(coalesce(ci.reinspection_responsible, '')), 80), 'Revistoria finalizada na aba Vistoria (registro anterior)', 'VISTORIA', 1
    from public.client_inspections ci join public.units u on u.id = ci.unit_id
   where ci.status = 'Revistoria Finalizada'
     and not exists (select 1 from public.revistorias r where r.unit_id = ci.unit_id);

  -- Unidades que já tinham revistorias da planilha (fora de Revistoria/Finalizada): situação pela mais recente.
  insert into public.revistorias_cliente (project_id, unit_id, inspection_id, status, ciclo, atualizado_email)
  select r.project_id, r.unit_id, ci.id,
         case when r.status in ('Agendada', 'Em revistoria') then 'Agendado' when r.status = 'Aprovada' then 'Aprovado' else 'Em andamento' end,
         1, 'migração'
    from (select distinct on (unit_id) * from public.revistorias order by unit_id, numero desc) r
    left join public.client_inspections ci on ci.unit_id = r.unit_id
  on conflict (unit_id) do nothing;

  update public.revistorias r set ciclo = 1 where r.ciclo is null;
  -- Agendamento atual de cada unidade
  update public.revistorias_cliente a
     set revistoria_id = (select r.id from public.revistorias r where r.unit_id = a.unit_id order by r.numero desc limit 1)
   where a.revistoria_id is null;
  -- Situação Agendado para quem já tinha agendamento em aberto
  update public.revistorias_cliente a set status = 'Agendado'
   where a.status = 'Em andamento'
     and exists (select 1 from public.revistorias r where r.id = a.revistoria_id and r.status in ('Agendada', 'Em revistoria'));

  insert into public.revistorias_eventos (project_id, unit_id, revistoria_id, tipo, status_anterior, status_novo, ciclo, descricao, registrado_email)
  select a.project_id, a.unit_id, a.revistoria_id, 'entrada', null, a.status, a.ciclo,
         'Situação inicial da Revistoria · Cliente (status da vistoria: ' || coalesce(ci.status, '—') || ')', 'migração'
    from public.revistorias_cliente a left join public.client_inspections ci on ci.id = a.inspection_id
   where not exists (select 1 from public.revistorias_eventos e where e.unit_id = a.unit_id);
  perform set_config('app.revcli', 'off', true);
end $$;
