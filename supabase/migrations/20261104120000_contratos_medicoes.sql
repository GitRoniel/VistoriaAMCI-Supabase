-- Medições dos contratos (UAU XT › Controle de Medições, grade "Medição"), relatório 9002 do robô UAU-Sync.
-- Complementa o relatório 549 (contratos_registros_549): nada existente é alterado ou apagado.
--   • uma linha por medição e por carga (execução), com os valores originais do TXT (auditoria);
--   • chave da medição = empresa-obra-contrato-medição, única dentro de cada carga (sem duplicidade);
--   • a view medicoes_registros_atual devolve só a última carga com sucesso (mesmo padrão das outras);
--   • relação com o contrato: empresa + obra + contrato, igual ao 549 (nunca pelo nome do fornecedor);
--   • leitura só para quem tem o módulo Contratos; escrita só pela função medicoes_robo (token do robô).
create table if not exists public.medicoes_registros (
  id bigint generated always as identity primary key,
  execucao_id bigint not null references public.pedidos_execucoes(id) on delete cascade,
  chave text not null,                 -- empresa-obra-contrato-medicao
  empresa int not null,
  obra text not null,
  contrato int not null,
  medicao int not null,                -- "Código" da medição no UAU
  objeto text,
  contrato_txt text,                   -- texto original "514 - OBJETO"
  subtotal numeric,
  acrescimos numeric,
  excedente numeric,
  descontos numeric,
  desc_medicao numeric,
  total numeric,                       -- valor da medição (não acumulado)
  contratado text,
  observacao text,
  status text,                         -- "0 - Aberta", "1 - Aprovada", "2 - Medida"
  ultima text,                         -- "0 - Não" / "1 - Sim"
  dt_reajuste date,
  inicio_medicao date,
  termino_medicao date,
  dt_geracao date,
  quem text,
  dt_aprovacao date,
  quem_aprovou text,
  cod_fornecedor int,
  fornecedor text,
  desc_empresa text,
  desc_obra text,
  anexos int,
  origem text not null default 'UAU XT · Controle de Medições',
  importado_em timestamptz not null default now(),
  unique (execucao_id, chave)
);
create index if not exists medicoes_registros_contrato_idx on public.medicoes_registros (execucao_id, empresa, obra, contrato);

alter table public.medicoes_registros enable row level security;
drop policy if exists contratos_le_medicoes on public.medicoes_registros;
create policy contratos_le_medicoes on public.medicoes_registros
  for select to authenticated using (private.has_module('contratos'));
revoke all on table public.medicoes_registros from anon;
revoke all on table public.medicoes_registros from authenticated;
grant select on table public.medicoes_registros to authenticated;

create view public.medicoes_registros_atual with (security_invoker = true) as
  select m.* from public.medicoes_registros m
  where m.execucao_id = (select e.id from public.pedidos_execucoes e
                         where e.relatorio = 9002 and e.status = 'sucesso'
                         order by e.iniciado_em desc limit 1);
revoke all on table public.medicoes_registros_atual from anon;
revoke all on table public.medicoes_registros_atual from authenticated;
grant select on table public.medicoes_registros_atual to authenticated;

-- Gravação pelo robô (mesmo token das outras cargas). Reenvio do mesmo lote não duplica: on conflict.
create function public.medicoes_robo(p_token text, p_execucao_id bigint, p_linhas jsonb)
returns jsonb language plpgsql security definer set search_path to 'public', 'pg_temp' as $function$
declare v_n int;
begin
  if p_token is null or p_token <> (select token from private.robo_tokens where nome = 'uau') then
    raise exception 'token inválido' using errcode = '42501';
  end if;
  if not exists (select 1 from pedidos_execucoes where id = p_execucao_id and relatorio = 9002 and status = 'executando') then
    raise exception 'execução % não é uma carga de medições (9002) em andamento', p_execucao_id;
  end if;
  insert into medicoes_registros (execucao_id, chave, empresa, obra, contrato, medicao, objeto, contrato_txt, subtotal,
    acrescimos, excedente, descontos, desc_medicao, total, contratado, observacao, status, ultima, dt_reajuste,
    inicio_medicao, termino_medicao, dt_geracao, quem, dt_aprovacao, quem_aprovou, cod_fornecedor, fornecedor,
    desc_empresa, desc_obra, anexos)
  select p_execucao_id, r.chave, r.empresa, r.obra, r.contrato, r.medicao, r.objeto, r.contrato_txt, r.subtotal,
    r.acrescimos, r.excedente, r.descontos, r.desc_medicao, r.total, r.contratado, r.observacao, r.status, r.ultima,
    r.dt_reajuste, r.inicio_medicao, r.termino_medicao, r.dt_geracao, r.quem, r.dt_aprovacao, r.quem_aprovou,
    r.cod_fornecedor, r.fornecedor, r.desc_empresa, r.desc_obra, r.anexos
  from jsonb_populate_recordset(null::medicoes_registros, p_linhas) r
  on conflict (execucao_id, chave) do nothing;
  get diagnostics v_n = row_count;
  return jsonb_build_object('inseridas', v_n);
end;
$function$;
revoke all on function public.medicoes_robo(text, bigint, jsonb) from public, authenticated;
grant execute on function public.medicoes_robo(text, bigint, jsonb) to anon;
