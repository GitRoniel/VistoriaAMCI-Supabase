-- Revistoria · Cliente: unidade com a chave ENTREGUE AO CLIENTE continua Aprovada (por entrega de chave) mesmo quando
-- uma revistoria técnica é registrada depois.
--
-- Caso real (11/11/2026): A-203 e A-408 tinham sido aprovadas pela entrega da chave. Para lançar a revistoria reprovada
-- de 03/11, a equipe usou "Reabrir" → agendou → registrou "Reprovada". A reabertura limpa a origem da aprovação e o
-- resultado reprovado leva a unidade a "Em andamento"; com isso o status e a marca de chave entregue (canto superior
-- esquerdo do mapa) sumiram, embora a chave continue com o cliente.
--
-- Regra: ao registrar o resultado de uma revistoria (tela ou planilha) numa unidade cuja chave está, no Controle de
-- Chaves, com o setor "Entregue para Cliente", a reprovação/aprovação fica gravada como RESULTADO TÉCNICO (revistorias,
-- ciclo e histórico intactos) e a situação operacional volta a "Aprovado" com origem "entrega_chave".
--   • Agendar continua possível (fica "Agendado" até o resultado); "Reabrir" continua sendo a ação própria para
--     reabrir — só o lançamento do resultado é que devolve a aprovação por entrega.
--   • Evento "entrega_chave" no histórico, marcado como reaprovação (detalhes.reaprovacao = true), sem repetir o
--     vínculo com a movimentação (chave_mov_id é único por entrega).
-- Dados: as unidades que hoje estão fora de "Aprovado" com a chave com o cliente e sem agendamento em aberto
-- (A-203 e A-408) são reaprovadas pela mesma função. Nada é apagado; resultados técnicos não mudam.

create or replace function private.revcli_reaprovar_entrega(p_unit_id bigint, p_origem text default 'resultado')
returns boolean language plpgsql security definer set search_path = '' as $$
declare a public.revistorias_cliente; ch public.chaves_unidades; mv public.chaves_movimentacoes; v_ult public.revistorias;
  v_ant text; v_rep int; v_real int; v_pend int; v_ptot int; v_desc text;
begin
  select * into a from public.revistorias_cliente where unit_id = p_unit_id for update;
  if not found or a.status = 'Aprovado' then return false; end if;
  select * into ch from public.chaves_unidades where unit_id = p_unit_id;
  if not found or ch.setor is distinct from 'cliente' then return false; end if;
  -- revistoria agendada e ainda não realizada: aguarda o resultado
  if exists (select 1 from public.revistorias where unit_id = p_unit_id and anulado_em is null and status in ('Agendada', 'Em revistoria')) then return false; end if;
  select * into mv from public.chaves_movimentacoes where id = ch.movimentacao_id;
  select * into v_ult from public.revistorias where unit_id = p_unit_id and anulado_em is null and status in ('Aprovada', 'Reprovada')
   order by numero desc limit 1;
  select count(*) filter (where status in ('Aprovada', 'Reprovada')), count(*) filter (where status = 'Reprovada')
    into v_real, v_rep from public.revistorias where unit_id = p_unit_id and anulado_em is null;
  select count(*) filter (where not concluido), count(*) into v_pend, v_ptot from public.central_checklist where unit_id = p_unit_id;
  v_ant := a.status;
  update public.revistorias_cliente
     set status = 'Aprovado', aprovacao_origem = 'entrega_chave', aprovacao_em = coalesce(mv.data_hora, now()), entrega_mov_id = mv.id,
         versao = versao + 1, atualizado_em = now(),
         atualizado_email = case when p_origem = 'correcao' then 'correção' else atualizado_email end
   where id = a.id returning * into a;
  v_desc := 'Chave com o cliente' || coalesce(' (' || nullif(ch.responsavel, '') || ')', '') ||
            coalesce(' desde ' || to_char(mv.data_hora at time zone 'America/Sao_Paulo', 'DD/MM/YYYY'), '') ||
            ': unidade mantida como Aprovada por entrega da chave (' || v_ant || ' → Aprovado). Resultado técnico preservado: ' ||
            case when v_ult.id is not null then lower(v_ult.status) || ' na revistoria nº ' || v_ult.numero || coalesce(' de ' || private.revcli_data_br(v_ult.realizada_em), '')
                 else 'revistoria não realizada' end ||
            '. Realizadas: ' || v_real || ' · reprovações: ' || v_rep || ' · pendências em aberto: ' || v_pend || coalesce(' de ' || nullif(v_ptot, 0), '') ||
            case when p_origem = 'correcao' then '. Correção de dados de 11/11/2026 (unidade reaberta para lançar a revistoria).' else '.' end;
  insert into public.revistorias_eventos (project_id, unit_id, revistoria_id, tipo, status_anterior, status_novo, ciclo,
                                          descricao, registrado_por, registrado_email, detalhes, chave_mov_id)
  values (a.project_id, a.unit_id, coalesce(v_ult.id, a.revistoria_id), 'entrega_chave', v_ant, 'Aprovado', a.ciclo, left(v_desc, 900),
          (select auth.uid()), case when p_origem = 'correcao' then 'correção' else private.revcli_email() end,
          jsonb_build_object('origem', 'entrega_chave', 'reaprovacao', true, 'motivo', p_origem, 'chave_mov_id', mv.id,
            'entregue_em', mv.data_hora, 'entregue_a', nullif(ch.responsavel, ''), 'status_anterior', v_ant,
            'resultado_tecnico', coalesce(v_ult.status, 'Não realizada'), 'ultima_revistoria', case when v_ult.id is null then null else
              jsonb_build_object('id', v_ult.id, 'numero', v_ult.numero, 'status', v_ult.status, 'realizada_em', v_ult.realizada_em, 'responsavel', v_ult.responsavel) end,
            'realizadas', v_real, 'reprovacoes', v_rep, 'pendencias_abertas', v_pend, 'pendencias_total', v_ptot),
          null);
  return true;
end $$;
revoke all on function private.revcli_reaprovar_entrega(bigint, text) from public, anon, authenticated;

-- Depois do resultado (tela: evento "resultado"; planilha: evento "planilha"), se a chave está com o cliente.
create or replace function private.revcli_resultado_chave_cliente()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform private.revcli_reaprovar_entrega(new.unit_id, new.tipo);
  return null;
end $$;
revoke all on function private.revcli_resultado_chave_cliente() from public, anon, authenticated;
drop trigger if exists revistorias_eventos_40_chave_cliente on public.revistorias_eventos;
create trigger revistorias_eventos_40_chave_cliente after insert on public.revistorias_eventos
for each row when (new.tipo in ('resultado', 'planilha') and new.status_novo is distinct from 'Aprovado')
execute function private.revcli_resultado_chave_cliente();

-- Dados atuais: unidades com a chave com o cliente, fora de "Aprovado" e sem agendamento em aberto.
do $$
declare r record; n int := 0;
begin
  for r in select rc.unit_id from public.revistorias_cliente rc join public.chaves_unidades ch on ch.unit_id = rc.unit_id
            where ch.setor = 'cliente' and rc.status <> 'Aprovado' loop
    if private.revcli_reaprovar_entrega(r.unit_id, 'correcao') then n := n + 1; end if;
  end loop;
  raise notice 'Unidades reaprovadas por entrega da chave: %', n;
end $$;
