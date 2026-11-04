// Aba Contratos › Relatório de Controle de Contratos (montada pela página Relatórios).
// Fluxo: dados da última execução do relatório 549 → regras (model) → tela (view).
import { fetchContratoRows, fetchContratoKeys, fetchMedicaoRows, fetchUltimaExecucaoMedicoes, REPORT_ID } from "./service.js";
import { buildContratos, contratoKey, itemKey } from "./model.js";
import { groupMedicoes, attachMedicoes } from "./medicoes.js";
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
    // Contratos (549) e medições (Controle de Medições) em paralelo; sem medições a aba funciona como antes.
    const [rows, medRows, medExec] = await Promise.all([fetchContratoRows(), fetchMedicaoRows(), fetchUltimaExecucaoMedicoes()]);
    const contratos = buildContratos(rows);
    const semContrato = attachMedicoes(contratos, medRows ? groupMedicoes(medRows) : null);
    current = { contratos: new Set(rows.map(contratoKey)), itens: new Set(rows.map(itemKey)) };
    root.innerHTML = '<div id="ctRoot"></div>';
    if (!contratos.length) {
      root.firstElementChild.innerHTML = '<div class="pf-empty">Nenhum contrato disponível. O relatório 549 ainda não foi importado pelo robô.</div>';
    } else {
      mountContratos(root.firstElementChild, { contratos, semContrato, medInfo: { disponivel: !!medRows, exec: medExec, linhas: medRows?.length ?? 0 } });
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
