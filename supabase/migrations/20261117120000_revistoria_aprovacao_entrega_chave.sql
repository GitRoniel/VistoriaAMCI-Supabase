-- Aprovação operacional da Revistoria · Cliente pela entrega da chave ao cliente.
--
-- Regra: quando o Controle de Chaves registra a entrega efetiva da chave ao cliente — movimentação de
-- transferência (ou regularização de chave perdida) com destino ao setor "cliente" ("Entregue para Cliente") —
-- a unidade que está na Revistoria · Cliente passa a "Aprovado" (status operacional), com a origem
-- "entrega_chave". Vale para Em andamento (com ou sem agendamento, com reprovações e pendências) e Agendado.
-- Nenhuma outra movimentação aciona a regra (cadastro, retirada, devolução, transferência entre setores,
-- Asstec, Produção, perda, ocorrência…), e devolver a chave depois não reabre nem reprova nada.
--
-- Três informações independentes:
--   • status operacional  → revistorias_cliente.status (Em andamento / Agendado / Aprovado)
--   • origem da aprovação → revistorias_cliente.aprovacao_origem ('tecnica' | 'entrega_chave'), aprovacao_em,
--                            entrega_mov_id (movimentação de entrega que encerrou a unidade)
--   • resultado técnico   → public.revistorias (agendamentos e resultados): NUNCA é alterado pela entrega.
--   • situação da chave   → public.chaves_unidades / chaves_movimentacoes (Controle de Chaves), sem mudança.
-- O agendamento em aberto (se houver), as reprovações, as pendências do checklist e a vistoria ficam como estão.
--
-- Histórico: evento imutável tipo "entrega_chave" em revistorias_eventos, com o retrato do momento da entrega
-- (status anterior, resultado da última revistoria, realizadas, reprovações, agendamento em aberto e pendências)
-- em revistorias_eventos.detalhes, ligado à movimentação por revistorias_eventos.chave_mov_id (único: a mesma
-- entrega nunca gera dois eventos nem duas aprovações).
--
-- Consistência: o gatilho roda dentro da mesma transação da movimentação (chaves_transferir / chaves_regularizar):
-- ou grava a entrega e a aprovação juntas, ou nenhuma. A linha da unidade fica travada (for update) durante a
-- atualização, então duas pessoas ao mesmo tempo não geram aprovação dupla. RLS e grants não mudam (as tabelas
-- continuam sem escrita direta; tudo passa pelas funções do banco).
--
-- Dados existentes: as unidades já Aprovadas recebem a origem 'tecnica'. As unidades na Revistoria · Cliente
-- (Em andamento / Agendado) cuja chave JÁ está com o cliente por uma movimentação de entrega registrada passam a
-- Aprovado pela mesma regra, com a data da entrega original e o evento marcado como aplicado na implantação.
-- Nada é apagado; nenhum resultado técnico, reprovação ou pendência muda.

-- ── 1) Origem da aprovação (revistorias_cliente) ───────────────────────────────
alter table public.revistorias_cliente
  add column if not exists aprovacao_origem text,
  add column if not exists aprovacao_em timestamptz,
  add column if not exists entrega_mov_id bigint;
alter table public.revistorias_cliente drop constraint if exists revistorias_cliente_aprovacao_origem_check;
alter table public.revistorias_cliente add constraint revistorias_cliente_aprovacao_origem_check
  check (aprovacao_origem is null or aprovacao_origem in ('tecnica', 'entrega_chave'));
comment on column public.revistorias_cliente.aprovacao_origem is
  'Origem do status operacional Aprovado: tecnica (última revistoria aprovada) ou entrega_chave (chave entregue ao cliente no Controle de Chaves, mesmo com reprovações ou pendências). Nulo quando não está Aprovado. O resultado técnico continua em public.revistorias.';
comment on column public.revistorias_cliente.aprovacao_em is 'Quando a unidade passou a Aprovado (na entrega: data/hora da entrega da chave).';
comment on column public.revistorias_cliente.entrega_mov_id is 'Movimentação do Controle de Chaves (chaves_movimentacoes.id) que entregou a chave ao cliente e encerrou a unidade.';

-- Mantém a origem coerente com o status em qualquer caminho (resultado, reabertura, planilha, correções):
-- passou a Aprovado sem origem informada = aprovação técnica; saiu de Aprovado (reabertura) = origem limpa
-- (o histórico de eventos continua com a aprovação anterior).
create or replace function private.revcli_aprovacao_origem()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.status = 'Aprovado' then
    if tg_op = 'INSERT' or old.status is distinct from 'Aprovado' or new.aprovacao_origem is null then
      new.aprovacao_origem := coalesce(new.aprovacao_origem, 'tecnica');
      new.aprovacao_em := coalesce(new.aprovacao_em, now());
    end if;
  else
    new.aprovacao_origem := null; new.aprovacao_em := null; new.entrega_mov_id := null;
  end if;
  return new;
end $$;
drop trigger if exists revistorias_cliente_05_aprovacao on public.revistorias_cliente;
create trigger revistorias_cliente_05_aprovacao before insert or update on public.revistorias_cliente
for each row execute function private.revcli_aprovacao_origem();

-- ── 2) Evento "entrega_chave" no histórico imutável ────────────────────────────
alter table public.revistorias_eventos
  add column if not exists detalhes jsonb,
  add column if not exists chave_mov_id bigint;
alter table public.revistorias_eventos drop constraint if exists revistorias_eventos_tipo_check;
alter table public.revistorias_eventos add constraint revistorias_eventos_tipo_check
  check (tipo in ('entrada', 'agendamento', 'remarcacao', 'cancelamento', 'resultado', 'reabertura', 'vistoria', 'planilha',
                  'liberacao', 'execucao', 'relatorio', 'correcao', 'entrega_chave'));
create unique index if not exists revistorias_eventos_chave_mov_uniq on public.revistorias_eventos (chave_mov_id) where chave_mov_id is not null;
comment on column public.revistorias_eventos.detalhes is 'Retrato do momento (evento entrega_chave): status anterior, resultado técnico, realizadas, reprovações, agendamento em aberto e pendências.';
comment on column public.revistorias_eventos.chave_mov_id is 'Movimentação do Controle de Chaves que gerou o evento (entrega ao cliente). Única: a mesma entrega não gera dois eventos.';

-- ── 3) Regra: entrega da chave → Aprovado (origem entrega_chave) ───────────────
create or replace function private.revcli_entrega_chave(p_mov public.chaves_movimentacoes, p_retroativo boolean default false)
returns void language plpgsql security definer set search_path = '' as $$
declare a public.revistorias_cliente; v_ant text; v_ult public.revistorias; v_aberto public.revistorias;
  v_real int; v_rep int; v_pend int; v_ptot int; v_det jsonb; v_res text; v_desc text; v_muda boolean;
begin
  if p_mov.setor is distinct from 'cliente' or p_mov.tipo not in ('transferencia', 'regularizacao') then return; end if;
  select * into a from public.revistorias_cliente where unit_id = p_mov.unit_id for update;
  if not found then return; end if;                                                       -- unidade fora da Revistoria
  if exists (select 1 from public.revistorias_eventos where chave_mov_id = p_mov.id) then return; end if;  -- já processada
  -- chave que já estava com o cliente (nova movimentação dentro do mesmo setor) numa unidade já aprovada: nada muda
  if a.status = 'Aprovado' and p_mov.setor_origem = 'cliente' then return; end if;

  select * into v_ult from public.revistorias where unit_id = a.unit_id and anulado_em is null and status in ('Aprovada', 'Reprovada')
   order by numero desc limit 1;
  select * into v_aberto from public.revistorias where unit_id = a.unit_id and anulado_em is null and status in ('Agendada', 'Em revistoria')
   order by numero desc limit 1;
  select count(*) filter (where status in ('Aprovada', 'Reprovada')), count(*) filter (where status = 'Reprovada')
    into v_real, v_rep from public.revistorias where unit_id = a.unit_id and anulado_em is null;
  select count(*) filter (where not concluido), count(*) into v_pend, v_ptot from public.central_checklist where unit_id = a.unit_id;
  v_res := case when v_ult.id is not null then v_ult.status
                when v_aberto.id is not null then 'Aguardando realização'
                else 'Não realizada' end;
  v_ant := a.status;
  v_muda := a.status <> 'Aprovado';
  v_det := jsonb_build_object(
    'origem', 'entrega_chave', 'retroativo', p_retroativo, 'aprovou', v_muda,
    'chave_mov_id', p_mov.id, 'entregue_em', p_mov.data_hora, 'entregue_a', nullif(p_mov.responsavel, ''),
    'setor_origem', p_mov.setor_origem, 'registrado_email', p_mov.registrado_email,
    'status_anterior', v_ant, 'aprovacao_anterior', a.aprovacao_origem, 'ciclo', a.ciclo,
    'resultado_tecnico', v_res,
    'ultima_revistoria', case when v_ult.id is null then null else jsonb_build_object('id', v_ult.id, 'numero', v_ult.numero,
       'status', v_ult.status, 'realizada_em', v_ult.realizada_em, 'responsavel', v_ult.responsavel) end,
    'agendamento_aberto', case when v_aberto.id is null then null else jsonb_build_object('id', v_aberto.id, 'numero', v_aberto.numero,
       'data', v_aberto.data, 'horario', v_aberto.horario) end,
    'realizadas', v_real, 'reprovacoes', v_rep, 'pendencias_abertas', v_pend, 'pendencias_total', v_ptot);

  if v_muda then
    update public.revistorias_cliente
       set status = 'Aprovado', aprovacao_origem = 'entrega_chave', aprovacao_em = p_mov.data_hora, entrega_mov_id = p_mov.id,
           versao = versao + 1, atualizado_em = now(), atualizado_por = p_mov.registrado_por,
           atualizado_email = case when p_retroativo then 'migração' else p_mov.registrado_email end
     where id = a.id
    returning * into a;
  end if;

  v_desc := 'Chave entregue ao cliente' || coalesce(' (' || nullif(p_mov.responsavel, '') || ')', '') ||
            ' em ' || to_char(p_mov.data_hora at time zone 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI') ||
            case when v_muda then '. Unidade aprovada por entrega da chave (' || v_ant || ' → Aprovado)'
                 else '. A unidade já estava aprovada (aprovação técnica mantida)' end ||
            '. Resultado técnico preservado: ' ||
            case when v_ult.id is not null then lower(v_ult.status) || ' na revistoria nº ' || v_ult.numero || coalesce(' de ' || private.revcli_data_br(v_ult.realizada_em), '')
                 when v_aberto.id is not null then 'aguardando realização (agendada para ' || private.revcli_data_br(v_aberto.data) || ')'
                 else 'revistoria não realizada' end ||
            '. Realizadas: ' || v_real || ' · reprovações: ' || v_rep || ' · pendências em aberto: ' || v_pend || coalesce(' de ' || nullif(v_ptot, 0), '') ||
            case when p_retroativo then '. Aplicado na implantação da regra (entrega já registrada no Controle de Chaves).' else '.' end;
  insert into public.revistorias_eventos (project_id, unit_id, revistoria_id, tipo, status_anterior, status_novo, ciclo,
                                          descricao, registrado_por, registrado_email, detalhes, chave_mov_id)
  values (a.project_id, a.unit_id, coalesce(v_aberto.id, v_ult.id, a.revistoria_id), 'entrega_chave', v_ant, a.status, a.ciclo,
          left(v_desc, 900), p_mov.registrado_por, case when p_retroativo then 'migração' else p_mov.registrado_email end, v_det, p_mov.id);
end $$;
revoke all on function private.revcli_entrega_chave(public.chaves_movimentacoes, boolean) from public, anon, authenticated;

create or replace function private.revcli_chave_movimentada()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform private.revcli_entrega_chave(new, false);
  return null;
end $$;
drop trigger if exists chaves_movimentacoes_30_revistoria on public.chaves_movimentacoes;
create trigger chaves_movimentacoes_30_revistoria after insert on public.chaves_movimentacoes
for each row when (new.setor = 'cliente' and new.tipo in ('transferencia', 'regularizacao'))
execute function private.revcli_chave_movimentada();

-- ── 4) Planilha de vistorias não reabre unidade encerrada pela entrega da chave ─
create or replace function private.revcli_revistoria_mudou()
returns trigger language plpgsql security definer set search_path = '' as $$
declare a public.revistorias_cliente; v_novo text; v_ciclo smallint; v_ant text;
begin
  if coalesce(current_setting('app.revcli', true), '') = 'on' then return null; end if;
  if tg_op = 'UPDATE' and new.status is not distinct from old.status then return null; end if;
  -- só o agendamento mais recente define a situação
  if exists (select 1 from public.revistorias where unit_id = new.unit_id and numero > new.numero) then return null; end if;
  -- unidade encerrada pela entrega da chave ao cliente: o agendamento muda, a situação operacional não
  if exists (select 1 from public.revistorias_cliente where unit_id = new.unit_id and status = 'Aprovado' and aprovacao_origem = 'entrega_chave') then return null; end if;

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

-- ── 5) Dados existentes ────────────────────────────────────────────────────────
-- Unidades já Aprovadas: aprovação técnica (data = realização da revistoria atual, ou a última atualização).
update public.revistorias_cliente rc
   set aprovacao_origem = 'tecnica',
       aprovacao_em = coalesce((select (r.realizada_em::timestamp at time zone 'America/Sao_Paulo') from public.revistorias r where r.id = rc.revistoria_id), rc.atualizado_em)
 where rc.status = 'Aprovado' and rc.aprovacao_origem is null;

-- Unidades na Revistoria cuja chave já está com o cliente por uma movimentação de entrega registrada.
do $$
declare m public.chaves_movimentacoes; n int := 0;
begin
  for m in
    select mv.* from public.chaves_unidades cu
      join public.chaves_movimentacoes mv on mv.id = cu.movimentacao_id
      join public.revistorias_cliente rc on rc.unit_id = cu.unit_id
     where cu.setor = 'cliente' and mv.setor = 'cliente' and mv.tipo in ('transferencia', 'regularizacao')
       and rc.status in ('Em andamento', 'Agendado')
     order by mv.id
  loop
    perform private.revcli_entrega_chave(m, true); n := n + 1;
  end loop;
  raise notice 'Unidades aprovadas por entrega de chave (já entregues): %', n;
end $$;

alter table public.revistorias_cliente drop constraint if exists revistorias_cliente_aprovacao_coerente;
alter table public.revistorias_cliente add constraint revistorias_cliente_aprovacao_coerente
  check ((status = 'Aprovado') = (aprovacao_origem is not null) and (aprovacao_origem = 'entrega_chave' or entrega_mov_id is null));
