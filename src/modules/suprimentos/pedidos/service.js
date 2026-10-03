// Acesso ao Supabase do Relatório de Pedidos.
//
// Fonte: tabela public.pedidos_registros_1187 (relatório 1187 do ERP, gravado pelo robô).
// Cada execução do robô grava uma "foto" completa; a view public.pedidos_registros_atual
// devolve só as linhas da última execução com sucesso (evita duplicar pedidos entre execuções).
// A leitura exige acesso ao módulo Suprimentos (RLS: private.has_module('suprimentos')).
import { getSupabase, fetchAllPages } from "../../../platform/core/supabase.js";

export const SOURCE_VIEW = "pedidos_registros_atual";
export const SOURCE_TABLE = "pedidos_registros_1187";
export const REPORT_ID = 1187;

// Somente as colunas usadas pela tela (CPF/CNPJ, valores e demais campos não são baixados).
const COLUMNS = [
  "id", "obra", "pedido", "ordem_compra", "cod_insumo", "insumo", "unidade",
  "qtde_entregue", "qtde_descartada", "qtde_restante",
  "dt_pedido", "quem", "dt_prevista_entrega", "data_entrega",
  "fornecedor", "nome_fantasia", "observacao_pedido"
].join(",");

/** Linhas (itens) de todos os pedidos da última execução do relatório. */
export async function fetchPedidoRows() {
  const supabase = getSupabase();
  if (!supabase) throw new Error("Configuração do Supabase indisponível.");
  return fetchAllPages(() => supabase.from(SOURCE_VIEW).select(COLUMNS).order("id", { ascending: true }));
}

// Observações dos pedidos (cabeçalho do pedido no ERP): public.pedidos_observacoes, gravada pelo robô
// (relatório 9001). A view pedidos_observacoes_atual traz só a última execução com sucesso; uma linha por
// empresa + obra + pedido. Ligação com o relatório: obra + pedido (mesma chave dos pedidos da tela).
export const OBS_VIEW = "pedidos_observacoes_atual";

/** Observações por pedido: Map("OBRA-PEDIDO" → texto). Falha na leitura não impede o relatório. */
export async function fetchObservacoes() {
  const supabase = getSupabase();
  if (!supabase) return new Map();
  try {
    const rows = await fetchAllPages(() => supabase.from(OBS_VIEW).select("id,obra,pedido,observacao")
      .not("observacao", "is", null).order("id", { ascending: true }));
    const map = new Map();
    rows.forEach((r) => { const t = String(r.observacao || "").trim(); if (t && r.obra != null && r.pedido != null) map.set(`${r.obra}-${r.pedido}`, t); });
    return map;
  } catch (err) {
    console.warn("Observações dos pedidos indisponíveis:", err);
    return new Map();
  }
}

/** Última execução com sucesso do relatório (data de atualização e período coberto). */
export async function fetchUltimaExecucao() {
  const supabase = getSupabase();
  if (!supabase) return null;
  const { data, error } = await supabase.from("pedidos_execucoes")
    .select("id,finalizado_em,periodo_inicio,periodo_fim,linhas")
    .eq("relatorio", REPORT_ID).eq("status", "sucesso")
    .order("iniciado_em", { ascending: false }).limit(1).maybeSingle();
  if (error) return null;
  return data;
}

/** Pedidos (obra + nº) gravados numa execução anterior: para contar o que é novo na última atualização. */
export async function fetchPedidoKeys(execucaoId) {
  const supabase = getSupabase();
  if (!supabase || !execucaoId) return null;
  const rows = await fetchAllPages(() => supabase.from(SOURCE_TABLE).select("obra,pedido").eq("execucao_id", execucaoId).order("id", { ascending: true }));
  return new Set(rows.map((r) => `${r.obra}-${r.pedido}`));
}
