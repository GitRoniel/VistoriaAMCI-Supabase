// Revistoria · Cliente: escrita pelas funções revistoria_* do banco (permissão, versão da tela e pedido
// repetido conferidos lá) e leitura do histórico (RLS por condomínio). A situação e os agendamentos de
// todas as unidades são carregados pela tela de Vistorias (www/index.html) junto com as vistorias e
// chegam aqui pelo `host`, já atualizados em tempo real.
// Nenhuma chave de serviço no navegador: tudo com a sessão do usuário.

export const naoInstalado = (err) => ["42P01", "42703", "42883", "PGRST205", "PGRST204", "PGRST202"].includes(err?.code) ||
  /does not exist|could not find/i.test(err?.message || "");

/** Histórico da unidade (mais recente primeiro). */
export async function eventos(sb, unitId, limite = 120) {
  const { data, error } = await sb.from("revistorias_eventos")
    .select("id,revistoria_id,tipo,status_anterior,status_novo,ciclo,descricao,registrado_email,registrado_em")
    .eq("unit_id", unitId).order("registrado_em", { ascending: false }).order("id", { ascending: false }).limit(limite);
  if (error) throw error;
  return data || [];
}

/** Responsáveis já usados nas revistorias do condomínio (sugestões do formulário). */
export async function responsaveis(sb, projectId) {
  const { data } = await sb.from("revistorias").select("responsavel").eq("project_id", projectId).neq("responsavel", "").limit(1000);
  return [...new Set((data || []).map((r) => String(r.responsavel || "").trim()).filter((x) => x.length > 1))].sort((a, b) => a.localeCompare(b, "pt-BR"));
}

async function rpc(sb, fn, args) {
  const { data, error } = await sb.rpc(fn, args);
  if (error) {
    const msg = String(error.message || "").replace(/^.*?ERROR:\s*/i, "");
    const e = new Error(naoInstalado(error) ? "Esta função ainda não foi instalada no banco." : msg || "Não foi possível registrar.");
    e.code = error.code; throw e;
  }
  return data;
}
export const agendar = (sb, a) => rpc(sb, "revistoria_agendar", { p_unit_id: a.unitId, p_data: a.data, p_horario: a.horario || "", p_responsavel: a.responsavel,
  p_observacoes: a.obs || "", p_versao: a.versao, p_pedido: a.pedido });
export const cancelar = (sb, a) => rpc(sb, "revistoria_cancelar", { p_unit_id: a.unitId, p_motivo: a.obs || "", p_versao: a.versao, p_pedido: a.pedido });
export const resultado = (sb, a) => rpc(sb, "revistoria_resultado", { p_unit_id: a.unitId, p_resultado: a.resultado, p_realizada_em: a.realizada,
  p_responsavel: a.responsavel || "", p_observacoes: a.obs || "", p_versao: a.versao, p_pedido: a.pedido });
export const reabrir = (sb, a) => rpc(sb, "revistoria_reabrir", { p_unit_id: a.unitId, p_motivo: a.obs || "", p_versao: a.versao, p_pedido: a.pedido });
/** Libera (true) ou retira a liberação (false) para a execução dos serviços. */
export const liberar = (sb, a) => rpc(sb, "revistoria_liberar", { p_unit_id: a.unitId, p_liberado: a.liberado, p_pedido: a.pedido });
/** Define quem executa (null = remove); anterior = o que a tela mostrava. */
export const execucao = (sb, a) => rpc(sb, "revistoria_execucao", { p_unit_id: a.unitId, p_execucao: a.execucao || null, p_anterior: a.anterior || null, p_pedido: a.pedido });
