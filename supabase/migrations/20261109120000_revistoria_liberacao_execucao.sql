-- Revistoria · Cliente: liberação para execução e equipe/responsável da execução.
--
-- Reaproveita public.revistorias_cliente (uma linha por unidade em acompanhamento, já com RLS,
-- tempo real e histórico): sem tabela nova e sem registro duplicado.
--   liberado      unidade liberada para a execução dos serviços de revistoria (sim/não)
--   execucao      quem executa: MOP_FELIPE, MOP_RENATO (equipe M.O.P), EMP_OSCAR, EMP_NILSON (equipe EMP)
--   *_em / *_por  quando e quem alterou (e-mail)
-- Gravação só pelas funções abaixo (admin e revistorias do condomínio; visitante só consulta), com
-- pedido repetido (p_pedido) e, na execução, conferência do valor que a tela mostrava (p_anterior).
-- Cada mudança entra no histórico (revistorias_eventos: tipos "liberacao" e "execucao").
-- Não muda a situação (Em andamento / Agendado / Aprovado) nem a versão usada pelos agendamentos.

alter table public.revistorias_cliente
  add column if not exists liberado boolean not null default false,
  add column if not exists liberado_em timestamptz,
  add column if not exists liberado_por text not null default '',
  add column if not exists execucao text,
  add column if not exists execucao_em timestamptz,
  add column if not exists execucao_por text not null default '';

alter table public.revistorias_cliente drop constraint if exists revistorias_cliente_execucao_check;
alter table public.revistorias_cliente add constraint revistorias_cliente_execucao_check
  check (execucao is null or execucao in ('MOP_FELIPE', 'MOP_RENATO', 'EMP_OSCAR', 'EMP_NILSON'));

comment on column public.revistorias_cliente.liberado is 'Unidade liberada para a execução dos serviços de revistoria.';
comment on column public.revistorias_cliente.execucao is 'Quem executa os serviços: MOP_FELIPE, MOP_RENATO (equipe M.O.P), EMP_OSCAR, EMP_NILSON (equipe EMP); nulo = não definido.';

alter table public.revistorias_eventos drop constraint if exists revistorias_eventos_tipo_check;
alter table public.revistorias_eventos add constraint revistorias_eventos_tipo_check
  check (tipo in ('entrada', 'agendamento', 'remarcacao', 'cancelamento', 'resultado', 'reabertura', 'vistoria', 'planilha',
                  'liberacao', 'execucao'));

create or replace function private.revcli_exec_rotulo(p text)
returns text language sql immutable set search_path = '' as $$
  select case p when 'MOP_FELIPE' then 'M.O.P · Felipe' when 'MOP_RENATO' then 'M.O.P · Renato'
                when 'EMP_OSCAR' then 'EMP · Oscar' when 'EMP_NILSON' then 'EMP · Nilson' else 'sem execução definida' end
$$;

-- Unidade em acompanhamento, travada (depois de revcli_travar).
create or replace function private.revcli_linha(p_unit_id bigint)
returns public.revistorias_cliente language plpgsql security definer set search_path = '' as $$
declare a public.revistorias_cliente;
begin
  select * into a from public.revistorias_cliente where unit_id = p_unit_id for update;
  if not found then
    raise exception 'Esta unidade não está na Revistoria · Cliente (o status da vistoria precisa ser Revistoria)';
  end if;
  return a;
end $$;

-- Libera (ou retira a liberação) para a execução dos serviços.
create or replace function public.revistoria_liberar(p_unit_id bigint, p_liberado boolean, p_pedido uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare a public.revistorias_cliente; r jsonb;
begin
  r := private.revcli_repetido(p_pedido); if r is not null then return r; end if;
  if p_liberado is null then raise exception 'Informe se a unidade está liberada'; end if;
  perform private.revcli_travar(p_unit_id);
  r := private.revcli_repetido(p_pedido); if r is not null then return r; end if;
  a := private.revcli_linha(p_unit_id);
  if a.liberado = p_liberado then   -- já está assim (outra pessoa ou outro aparelho): nada a gravar
    return jsonb_build_object('ok', true, 'sem_mudanca', true, 'acompanhamento', to_jsonb(a));
  end if;
  update public.revistorias_cliente
     set liberado = p_liberado, liberado_em = now(), liberado_por = private.revcli_email(),
         atualizado_em = now(), atualizado_por = (select auth.uid()), atualizado_email = private.revcli_email()
   where id = a.id
  returning * into a;
  perform private.revcli_evento(a, null, 'liberacao', a.status,
    case when p_liberado then 'Liberada para a execução dos serviços' else 'Liberação para execução retirada' end, p_pedido);
  return jsonb_build_object('ok', true, 'acompanhamento', to_jsonb(a));
end $$;

-- Define (ou remove, com nulo) quem executa; p_anterior = o que a tela mostrava.
create or replace function public.revistoria_execucao(p_unit_id bigint, p_execucao text, p_anterior text default null,
  p_pedido uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare a public.revistorias_cliente; r jsonb; v_novo text := nullif(btrim(coalesce(p_execucao, '')), ''); v_ant text;
begin
  r := private.revcli_repetido(p_pedido); if r is not null then return r; end if;
  if v_novo is not null and v_novo not in ('MOP_FELIPE', 'MOP_RENATO', 'EMP_OSCAR', 'EMP_NILSON') then
    raise exception 'Escolha uma das opções de execução';
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

revoke all on function private.revcli_exec_rotulo(text) from public, anon, authenticated;
revoke all on function private.revcli_linha(bigint) from public, anon, authenticated;
revoke all on function public.revistoria_liberar(bigint, boolean, uuid) from public, anon;
revoke all on function public.revistoria_execucao(bigint, text, text, uuid) from public, anon;
grant execute on function public.revistoria_liberar(bigint, boolean, uuid) to authenticated;
grant execute on function public.revistoria_execucao(bigint, text, text, uuid) to authenticated;
