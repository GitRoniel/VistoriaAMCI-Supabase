// Aba Contratos › Relatório de Controle de Contratos (montada pela página Relatórios).
// Fluxo: dados da última execução do relatório 549 → regras (model) → tela (view).
import { esc, fmtDateTime } from "../../../platform/core/utils.js";
import { fetchContratoRows, fetchUltimaExecucao } from "./service.js";
import { buildContratos } from "./model.js";
import { mountContratos } from "./view.js";

function updatedText(exec, n) {
  const base = "Contratos, medições e saldos por obra e fornecedor";
  if (!exec) return `${base} · ${n.toLocaleString("pt-BR")} itens do ERP.`;
  return `${base} · dados do ERP atualizados em <b>${esc(fmtDateTime(exec.finalizado_em))}</b>.`;
}

export const contratosTab = {
  id: "contratos",
  module: "contratos",
  label: "Contratos",
  title: "Relatório de Controle de Contratos",
  loading: "Carregando contratos…",
  async load(root) {
    const [rows, exec] = await Promise.all([fetchContratoRows(), fetchUltimaExecucao()]);
    const contratos = buildContratos(rows);
    root.innerHTML = '<div id="ctRoot"></div>';
    if (!contratos.length) {
      root.firstElementChild.innerHTML = '<div class="pf-empty">Nenhum contrato disponível. O relatório 549 ainda não foi importado pelo robô.</div>';
    } else {
      mountContratos(root.firstElementChild, { contratos });
    }
    return updatedText(exec, rows.length);
  }
};
