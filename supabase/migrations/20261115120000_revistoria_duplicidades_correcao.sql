-- Correção de dados: revistorias aprovadas lançadas em duplicidade.
--
-- Origem: na aba Vistoria, mudar o status de "Revistoria Finalizada" para "Revistoria" reabre a revistoria
-- (novo ciclo) e voltar para "Revistoria Finalizada" registra de novo a revistoria aprovada. Em 10/11/2026 isso
-- aconteceu em 10 unidades (e já tinha acontecido no Apto A-601): a unidade continua Aprovada, mas fica com 2 ou 3
-- revistorias "realizadas" iguais (mesma data de realização) e com o ciclo aumentado sem nenhuma reprovação.
-- A partir desta versão a aba Vistoria não oferece mais o status "Revistoria Finalizada" (a conclusão fica na aba
-- Revistoria · Cliente), então o caminho que gerava a duplicidade foi fechado na tela.
--
-- O que esta migration faz (só nos casos que se encaixam na regra; nada é apagado):
--   • unidade Aprovada na Revistoria · Cliente cujo agendamento atual é uma revistoria Aprovada;
--   • outro agendamento da mesma unidade, também Aprovado, não anulado e com a MESMA data de realização
--     → é anulado (status Cancelada + anulado_em/email/motivo), exatamente como a ação "Anular" do administrador:
--       continua na tabela, sai das contagens e fica consultável no popup com o motivo;
--   • o agendamento atual recebe o horário do registro anulado quando ele não tinha horário e a data é a mesma;
--   • o ciclo volta ao do primeiro registro aprovado (o ciclo extra não teve reprovação);
--   • cada unidade corrigida ganha um evento "correcao" no histórico imutável (revistorias_eventos).
-- Idempotente: rodar de novo não encontra mais nada (os registros já estão anulados).
-- Não muda status de nenhuma unidade (continuam Aprovado / Revistoria Finalizada), nem permissões, RLS ou funções.

do $$
declare
  g record; v_mot text; v_hor time; v_ciclo smallint; v_desc text; v_n int := 0;
begin
  perform set_config('app.revcli', 'on', true);   -- sem gatilhos de sincronização durante a correção

  for g in
    select rc.id as rc_id, rc.project_id, rc.unit_id, rc.status, rc.ciclo as rc_ciclo,
           c.id as cur_id, c.numero as cur_num, c.data as cur_data, c.horario as cur_hor, c.ciclo as cur_ciclo, c.realizada_em,
           array_agg(d.id order by d.numero) as dup_ids,
           array_agg(d.numero order by d.numero) as dup_nums,
           min(d.ciclo) as dup_ciclo,
           (array_agg(d.horario order by d.numero desc) filter (where d.horario is not null and d.data = c.data))[1] as dup_hor
      from public.revistorias_cliente rc
      join public.revistorias c on c.id = rc.revistoria_id
      join public.revistorias d on d.unit_id = rc.unit_id and d.id <> c.id and d.anulado_em is null
                               and d.status = 'Aprovada' and d.realizada_em = c.realizada_em
     where rc.status = 'Aprovado' and c.status = 'Aprovada' and c.anulado_em is null
     group by rc.id, c.id
  loop
    v_mot := 'Registro em duplicidade: a mesma revistoria aprovada (realizada em ' || private.revcli_data_br(g.realizada_em) ||
             ') foi lançada de novo ao mudar o status na aba Vistoria. Fica valendo o agendamento nº ' || g.cur_num || '.';
    update public.revistorias
       set status = 'Cancelada', anulado_em = now(), anulado_email = 'correção de dados', anulado_motivo = left(v_mot, 500),
           atualizado_em = now()
     where id = any (g.dup_ids);

    v_hor := case when g.cur_hor is null then g.dup_hor else g.cur_hor end;
    v_ciclo := least(coalesce(g.cur_ciclo, g.rc_ciclo), coalesce(g.dup_ciclo, g.rc_ciclo), g.rc_ciclo);
    update public.revistorias set horario = v_hor, ciclo = v_ciclo, atualizado_em = now()
     where id = g.cur_id and (horario is distinct from v_hor or ciclo is distinct from v_ciclo);
    update public.revistorias_cliente set ciclo = v_ciclo, versao = versao + 1, atualizado_em = now()
     where id = g.rc_id and ciclo <> v_ciclo;

    v_desc := 'Correção de dados: agendamento(s) nº ' || array_to_string(g.dup_nums, ', ') ||
              ' anulado(s) por duplicidade da revistoria aprovada em ' || private.revcli_data_br(g.realizada_em) ||
              '; fica valendo o nº ' || g.cur_num ||
              case when g.cur_hor is null and v_hor is not null then ' (horário ' || left(v_hor::text, 5) || ' mantido do registro anterior)' else '' end ||
              case when v_ciclo <> g.rc_ciclo then '; ciclo ' || g.rc_ciclo || ' → ' || v_ciclo else '' end || '.';
    insert into public.revistorias_eventos (project_id, unit_id, revistoria_id, tipo, status_anterior, status_novo, ciclo,
                                            descricao, registrado_por, registrado_email)
    values (g.project_id, g.unit_id, g.cur_id, 'correcao', g.status, g.status, v_ciclo, left(v_desc, 900), null, 'correção de dados');
    v_n := v_n + 1;
  end loop;

  perform set_config('app.revcli', 'off', true);
  raise notice 'Unidades corrigidas: %', v_n;
end $$;
