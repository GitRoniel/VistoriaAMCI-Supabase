// Aba Suprimentos › Relatório de Controle de Pedidos (montada pela página Relatórios).
// Fluxo: dados da última execução do relatório 1187 → regras (model) → tela (view).
import { esc, fmtDateTime, fmtDateShort } from "../../../platform/core/utils.js";
import { fetchPedidoRows, fetchUltimaExecucao } from "./service.js";
import { buildPedidos } from "./model.js";
import { mountPedidos } from "./view.js";

function updatedText(exec, rows) {
  if (!exec) return `Acompanhamento de materiais por obra · ${rows.toLocaleString("pt-BR")} itens do ERP.`;
  const periodo = exec.periodo_inicio && exec.periodo_fim ? ` · período ${fmtDateShort(exec.periodo_inicio)} a ${fmtDateShort(exec.periodo_fim)}` : "";
  return `Acompanhamento de materiais por obra · dados do ERP atualizados em <b>${esc(fmtDateTime(exec.finalizado_em))}</b>${periodo}.`;
}

export const suprimentosTab = {
  id: "suprimentos",
  module: "suprimentos",
  label: "Suprimentos",
  title: "Relatório de Controle de Pedidos",
  loading: "Carregando pedidos…",
  /** Busca e monta a aba em `root`. Devolve o subtítulo do cabeçalho. */
  async load(root) {
    const [rows, exec] = await Promise.all([fetchPedidoRows(), fetchUltimaExecucao()]);
    const pedidos = buildPedidos(rows);
    root.innerHTML = '<div id="pdRoot"></div>';
    if (!pedidos.length) {
      root.firstElementChild.innerHTML = '<div class="pf-empty">Nenhum pedido disponível. O relatório 1187 ainda não foi importado pelo robô.</div>';
    } else {
      mountPedidos(root.firstElementChild, { pedidos });
    }
    return updatedText(exec, rows.length);
  }
};
