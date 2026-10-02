// Acesso ao Supabase do Relatório de Contratos.
//
// Fonte: tabela public.contratos_registros_549 (relatório 549 do ERP, gravado pelo robô).
// Cada execução grava uma "foto" completa; a view public.contratos_registros_atual devolve só as
// linhas da última execução com sucesso. Uma linha = um item (serviço) de um contrato.
// A leitura exige acesso ao módulo Contratos (RLS: private.has_module('contratos')).
import { getSupabase, fetchAllPages } from "../../../platform/core/supabase.js";

export const SOURCE_VIEW = "contratos_registros_atual";
export const SOURCE_TABLE = "contratos_registros_549";
export const REPORT_ID = 549;

// Somente as colunas usadas pela tela.
const COLUMNS = [
  "id", "empresa", "desc_empresa", "obra", "desc_obra", "contrato", "objeto",
  "total_contrato", "valor_medido", "saldo_contrato", "cod_fornecedor", "fornecedor",
  "item", "cod_servico", "servico", "unidade", "qtde", "preco", "subtotal",
  "qtde_medida", "valor_medido_item", "qtde_a_medir", "valor_a_medir",
  "desc_desconto", "taxa_desconto", "status", "situacao", "chave_contrato"
].join(",");

/** Linhas (itens) de todos os contratos da última execução do relatório. */
export async function fetchContratoRows() {
  const supabase = getSupabase();
  if (!supabase) throw new Error("Configuração do Supabase indisponível.");
  return fetchAllPages(() => supabase.from(SOURCE_VIEW).select(COLUMNS).order("id", { ascending: true }));
}

/** Última execução com sucesso do relatório 549 (data de atualização). */
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

/** Contratos e itens gravados numa execução anterior: para contar o que é novo na última atualização. */
export async function fetchContratoKeys(execucaoId) {
  const supabase = getSupabase();
  if (!supabase || !execucaoId) return null;
  return fetchAllPages(() => supabase.from(SOURCE_TABLE).select("empresa,obra,contrato,item,chave_contrato").eq("execucao_id", execucaoId).order("id", { ascending: true }));
}
