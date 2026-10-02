// Aba Suprimentos › Relatório de Controle de Pedidos (montada pela página Relatórios).
// Fluxo: dados da última execução do relatório 1187 → regras (model) → tela (view).
import { fmtDateShort } from "../../../platform/core/utils.js";
import { fetchPedidoRows, fetchUltimaExecucao, fetchPedidoKeys, REPORT_ID } from "./service.js";
import { buildPedidos } from "./model.js";
import { mountPedidos } from "./view.js";

function subtitleText(exec, rows) {
  const periodo = exec?.periodo_inicio && exec?.periodo_fim ? ` · período ${fmtDateShort(exec.periodo_inicio)} a ${fmtDateShort(exec.periodo_fim)}` : "";
  return `Acompanhamento de materiais por obra${periodo || ` · ${rows.toLocaleString("pt-BR")} itens do ERP`}.`;
}

let currentKeys = null;

export const suprimentosTab = {
  id: "suprimentos",
  module: "suprimentos",
  label: "Suprimentos",
  title: "Relatório de Controle de Pedidos",
  loading: "Carregando pedidos…",
  report: REPORT_ID,
  unit: "linhas do ERP",
  /** Busca e monta a aba em `root`. Devolve o subtítulo do cabeçalho. */
  async load(root) {
    const [rows, exec] = await Promise.all([fetchPedidoRows(), fetchUltimaExecucao()]);
    const pedidos = buildPedidos(rows);
    currentKeys = new Set(pedidos.map((p) => p.key));
    root.innerHTML = '<div id="pdRoot"></div>';
    if (!pedidos.length) {
      root.firstElementChild.innerHTML = '<div class="pf-empty">Nenhum pedido disponível. O relatório 1187 ainda não foi importado pelo robô.</div>';
    } else {
      mountPedidos(root.firstElementChild, { pedidos });
    }
    return subtitleText(exec, rows.length);
  },
  /** Pedidos que não existiam na execução anterior (mesma chave obra-pedido do relatório). */
  async countNew(prevExecId) {
    const prev = await fetchPedidoKeys(prevExecId);
    if (!prev || !currentKeys) return null;
    return [{ n: [...currentKeys].filter((k) => !prev.has(k)).length, label: "pedidos novos" }];
  }
};
