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

// ── Relatórios da revistoria (PDF no Storage privado; no banco só os metadados) e checklist ──
export const BUCKET = "revistorias-relatorios";
/** Relatórios ativos da unidade (mais recente primeiro). */
export async function relatorios(sb, unitId) {
  const { data, error } = await sb.from("revistorias_relatorios")
    .select("id,unit_id,revistoria_id,caminho,nome_arquivo,tamanho,paginas,resumo,enviado_em,enviado_email,removido_em")
    .eq("unit_id", unitId).order("enviado_em", { ascending: false }).order("id", { ascending: false });
  if (error) throw error;
  return (data || []).filter((r) => !r.removido_em);
}
/** Unidades do condomínio que têm relatório (para o botão Relatório da lista). */
export async function unidadesComRelatorio(sb, projectId) {
  const { data, error } = await sb.from("revistorias_relatorios").select("id,unit_id,removido_em").eq("project_id", projectId).limit(5000);
  if (error) throw error;
  return new Set((data || []).filter((r) => !r.removido_em).map((r) => r.unit_id));
}
export async function apontamentos(sb, relatorioId) {
  const { data, error } = await sb.from("revistorias_apontamentos")
    .select("id,relatorio_id,ordem,texto,concluido,concluido_em,concluido_email").eq("relatorio_id", relatorioId).order("ordem", { ascending: true });
  if (error) throw error;
  return data || [];
}
/** Envia o PDF ao Storage (sem sobrescrever) e registra os metadados; se o registro falhar, apaga o arquivo enviado. */
export async function enviarRelatorio(sb, a) {
  const up = await sb.storage.from(BUCKET).upload(a.caminho, a.arquivo, { contentType: "application/pdf", upsert: false, cacheControl: "3600" });
  if (up.error) { const e = new Error(/exceeded|too large|size/i.test(up.error.message || "") ? "Arquivo grande demais (máximo de 25 MB)." : up.error.message || "Não foi possível enviar o arquivo."); throw e; }
  try {
    return await rpc(sb, "revistoria_relatorio_registrar", { p_unit_id: a.unitId, p_caminho: a.caminho, p_nome: a.nome, p_tamanho: a.tamanho, p_paginas: a.paginas ?? null, p_resumo: a.resumo || {} });
  } catch (err) { await sb.storage.from(BUCKET).remove([a.caminho]).catch(() => {}); throw err; }
}
/** Retira o relatório e apaga o arquivo do Storage. */
export async function removerRelatorio(sb, id) {
  const r = await rpc(sb, "revistoria_relatorio_remover", { p_relatorio_id: id });
  if (r?.caminho) await sb.storage.from(BUCKET).remove([r.caminho]).catch(() => {});
  return r;
}
/** URL assinada e temporária (nunca link público permanente). */
export async function urlRelatorio(sb, caminho, { segundos = 600, baixar = "" } = {}) {
  const { data, error } = await sb.storage.from(BUCKET).createSignedUrl(caminho, segundos, baixar ? { download: baixar } : undefined);
  if (error) throw new Error(error.message || "Não foi possível abrir o relatório.");
  return data.signedUrl;
}
export const adicionarApontamentos = (sb, relatorioId, textos) => rpc(sb, "revistoria_apontamentos_adicionar", { p_relatorio_id: relatorioId, p_textos: textos });
export const marcarApontamento = (sb, id, concluido) => rpc(sb, "revistoria_apontamento_marcar", { p_id: id, p_concluido: concluido });
export const removerApontamento = (sb, id) => rpc(sb, "revistoria_apontamento_remover", { p_id: id });
