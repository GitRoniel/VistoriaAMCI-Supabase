// Aba Contratos › Relatório de Controle de Contratos (montada pela página Relatórios).
// Fluxo: dados da última execução do relatório 549 → regras (model) → tela (view).
import { fetchContratoRows, fetchContratoKeys, REPORT_ID } from "./service.js";
import { buildContratos, contratoKey, itemKey } from "./model.js";
import { mountContratos } from "./view.js";

let current = null;

export const contratosTab = {
  id: "contratos",
  module: "contratos",
  label: "Contratos",
  title: "Relatório de Controle de Contratos",
  loading: "Carregando contratos…",
  report: REPORT_ID,
  unit: "linhas do ERP",
  async load(root) {
    const rows = await fetchContratoRows();
    const contratos = buildContratos(rows);
    current = { contratos: new Set(rows.map(contratoKey)), itens: new Set(rows.map(itemKey)) };
    root.innerHTML = '<div id="ctRoot"></div>';
    if (!contratos.length) {
      root.firstElementChild.innerHTML = '<div class="pf-empty">Nenhum contrato disponível. O relatório 549 ainda não foi importado pelo robô.</div>';
    } else {
      mountContratos(root.firstElementChild, { contratos });
    }
    return "Contratos, medições e saldos por obra e fornecedor.";
  },
  /** Contratos e itens que não existiam na execução anterior (mesmas chaves do relatório). */
  async countNew(prevExecId) {
    const prev = await fetchContratoKeys(prevExecId);
    if (!prev || !current) return null;
    const pc = new Set(prev.map(contratoKey)), pi = new Set(prev.map(itemKey));
    return [
      { n: [...current.contratos].filter((k) => !pc.has(k)).length, label: "contratos novos" },
      { n: [...current.itens].filter((k) => !pi.has(k)).length, label: "itens novos" }
    ];
  }
};
