// Controle de Chaves: leitura das tabelas (RLS por condomínio) e escrita pelas funções chaves_* do banco.
// Nenhuma chave de serviço no navegador: tudo com a sessão do usuário e as permissões do papel dele.

const PAGE = 1000;
async function todas(build, coluna = "id") {
  const out = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build().order(coluna, { ascending: true }).range(from, from + PAGE - 1);
    if (error) throw error;
    out.push(...(data || []));
    if (!data || data.length < PAGE) break;
  }
  return out;
}

/** Erro de "tabela/coluna inexistente": a migration do módulo ainda não foi aplicada. */
export const naoInstalado = (err) => ["42P01", "42703", "PGRST205", "PGRST204", "PGRST202"].includes(err?.code) ||
  /does not exist|could not find/i.test(err?.message || "");

/** Dados do condomínio: tipologia das unidades, cadastro, chaves e movimentações de hoje. */
export async function carregarCondominio(sb, projectId) {
  const inicioHoje = new Date(); inicioHoje.setHours(0, 0, 0, 0);
  const [unidades, cadastros, chaves, hoje] = await Promise.all([
    todas(() => sb.from("units").select("id,quartos").eq("project_id", projectId)),
    todas(() => sb.from("chaves_unidades").select("unit_id,tem_chaves,observacoes,origem").eq("project_id", projectId), "unit_id"),
    todas(() => sb.from("chaves").select("id,unit_id,categoria,comodo,copia,local,situacao,responsavel,retirada_em,previsao_devolucao,movimentacao_id").eq("project_id", projectId).neq("situacao", "inativa")),
    sb.from("chaves_movimentacoes").select("id", { count: "exact", head: true }).eq("project_id", projectId)
      .in("tipo", ["retirada", "devolucao", "transferencia"]).gte("registrado_em", inicioHoje.toISOString())
  ]);
  if (hoje.error) throw hoje.error;
  return { unidades, cadastros, chaves, movsHoje: hoje.count || 0 };
}

/** Histórico de uma unidade (mais recente primeiro). */
export async function historico(sb, unitId, limite = 60) {
  const { data, error } = await sb.from("chaves_movimentacoes")
    .select("id,tipo,setor,responsavel,recebido_por,data_hora,previsao_devolucao,chaves,quantidade,observacoes,registrado_email,registrado_em")
    .eq("unit_id", unitId).order("registrado_em", { ascending: false }).order("id", { ascending: false }).limit(limite);
  if (error) throw error;
  return data || [];
}

/** Nomes já usados (responsáveis e quem recebeu) para sugerir no formulário. */
export async function nomesUsados(sb, projectId) {
  const { data } = await sb.from("chaves_movimentacoes").select("responsavel,recebido_por")
    .eq("project_id", projectId).order("registrado_em", { ascending: false }).limit(400);
  const nomes = new Set();
  (data || []).forEach((m) => [m.responsavel, m.recebido_por].forEach((n) => String(n || "").split(",").map((x) => x.trim()).filter((x) => x.length > 1).forEach((x) => nomes.add(x))));
  return [...nomes].sort((a, b) => a.localeCompare(b, "pt-BR"));
}

async function rpc(sb, fn, args) {
  const { data, error } = await sb.rpc(fn, args);
  if (error) {
    const msg = String(error.message || "").replace(/^.*?ERROR:\s*/i, "");
    const e = new Error(naoInstalado(error) ? "O Controle de Chaves ainda não foi instalado no banco." : msg || "Não foi possível registrar.");
    e.code = error.code; throw e;
  }
  return data;
}

export const retirar = (sb, a) => rpc(sb, "chaves_retirar", { p_unit_id: a.unitId, p_chave_ids: a.ids, p_setor: a.setor, p_responsavel: a.responsavel,
  p_data_hora: a.dataHora, p_previsao: a.previsao || null, p_observacoes: a.obs || "", p_pedido: a.pedido });
export const transferir = (sb, a) => rpc(sb, "chaves_transferir", { p_unit_id: a.unitId, p_chave_ids: a.ids, p_setor: a.setor, p_responsavel: a.responsavel,
  p_data_hora: a.dataHora, p_previsao: a.previsao || null, p_observacoes: a.obs || "", p_pedido: a.pedido });
export const devolver = (sb, a) => rpc(sb, "chaves_devolver", { p_unit_id: a.unitId, p_chave_ids: a.ids, p_recebido_por: a.recebidoPor,
  p_data_hora: a.dataHora, p_observacoes: a.obs || "", p_responsavel: a.responsavel || "", p_pedido: a.pedido });
export const ocorrencia = (sb, a) => rpc(sb, "chaves_ocorrencia", { p_unit_id: a.unitId, p_texto: a.texto, p_extraviadas: a.ids || [],
  p_data_hora: a.dataHora || null, p_pedido: a.pedido });
export const cadastrar = (sb, a) => rpc(sb, "chaves_cadastrar", { p_unit_id: a.unitId, p_itens: a.itens, p_observacoes: a.obs || "", p_pedido: a.pedido });
export const definirTipologia = (sb, a) => rpc(sb, "chaves_definir_tipologia", { p_unit_ids: a.unitIds, p_quartos: a.quartos });

/** Tempo real: avisa quando outro usuário movimenta chaves do condomínio. */
export function assinar(sb, projectId, aoMudar) {
  const filtro = `project_id=eq.${projectId}`;
  const canal = sb.channel(`chaves-${projectId}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "chaves", filter: filtro }, aoMudar)
    .on("postgres_changes", { event: "*", schema: "public", table: "chaves_unidades", filter: filtro }, aoMudar)
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "chaves_movimentacoes", filter: filtro }, aoMudar)
    .subscribe();
  return () => sb.removeChannel(canal);
}
