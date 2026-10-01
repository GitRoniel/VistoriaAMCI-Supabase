// Regras do Relatório de Contratos: linhas do ERP (uma por item) → contratos agrupados.
//
// Identificação (conferida nos dados reais do relatório 549):
//   • contrato = empresa + obra + contrato   (o número do contrato se repete entre obras/empresas)
//   • item     = chave_contrato               ("empresa-obra-contrato-item")
// O ERP às vezes repete a mesma linha do item (mesma chave_contrato, mesmos valores):
// fica só uma, senão o subtotal do contrato dobra.
//
// Valores do contrato (total_contrato, valor_medido, saldo_contrato), fornecedor, objeto, status e
// situação vêm repetidos em todas as linhas do contrato: são lidos UMA vez por contrato, nunca somados
// por item. Em alguns contratos o valor medido do contrato difere da soma dos itens (retenções e
// medições do ERP), por isso o resumo usa sempre o valor do contrato.
// Contratos sem nenhuma medição vêm com saldo_contrato vazio: o saldo é total_contrato − valor_medido
// (mesma relação que vale para todos os contratos com saldo preenchido).

const num = (v) => (v == null || v === "" || Number.isNaN(Number(v)) ? 0 : Number(v));

/** "1 - Aprovado" → "Aprovado" (o código numérico do ERP fica só para ordenar). */
export const statusLabel = (s) => String(s || "").replace(/^\s*\d+\s*-\s*/, "").trim() || "Sem status";

export const contratoKey = (r) => `${r.empresa ?? ""}-${r.obra ?? ""}-${r.contrato ?? ""}`;
export const itemKey = (r) => r.chave_contrato || `${contratoKey(r)}-${r.item ?? ""}`;

/** Remove linhas repetidas do mesmo item (mesma chave_contrato). Mantém a primeira (menor id). */
export function dedupeRows(rows) {
  const seen = new Set();
  return [...rows].sort((a, b) => num(a.id) - num(b.id)).filter((r) => {
    const k = itemKey(r);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function buildItem(r) {
  const qtde = num(r.qtde), medida = num(r.qtde_medida);
  return {
    item: r.item, codigo: r.cod_servico || "", servico: r.servico || "Serviço sem descrição", unidade: r.unidade || "",
    qtde, preco: num(r.preco), subtotal: num(r.subtotal),
    qtde_medida: medida, valor_medido: num(r.valor_medido_item),
    qtde_a_medir: num(r.qtde_a_medir), valor_a_medir: num(r.valor_a_medir),
    pct: qtde > 0 ? Math.round((medida / qtde) * 100) : 0
  };
}

/**
 * Agrupa as linhas em contratos.
 * @returns {Array<object>} contratos ordenados por obra e número
 */
export function buildContratos(rows) {
  const map = new Map();
  for (const r of dedupeRows(rows)) {
    const key = contratoKey(r);
    let c = map.get(key);
    if (!c) {
      const valor = num(r.total_contrato), medido = num(r.valor_medido);
      c = {
        key, empresa: r.empresa, condominio: r.desc_empresa || "", obra: r.obra || "—", obra_desc: r.desc_obra || "",
        contrato: r.contrato, objeto: r.objeto || "", fornecedor: r.fornecedor || "", cod_fornecedor: r.cod_fornecedor,
        status: r.status || "", situacao: r.situacao || "",
        // Contrato ainda sem medição: o ERP deixa saldo_contrato vazio. Nos demais, saldo = total − medido.
        valor, medido, saldo: r.saldo_contrato == null ? valor - medido : num(r.saldo_contrato), saldo_calc: r.saldo_contrato == null,
        pct: valor > 0 ? Math.round((medido / valor) * 100) : 0,
        retencao: num(r.taxa_desconto) > 0 ? `${r.desc_desconto || "Retenção"} ${Math.round(num(r.taxa_desconto) * 1000) / 10}%` : "",
        itens: []
      };
      map.set(key, c);
    }
    c.itens.push(buildItem(r));
  }
  const list = [...map.values()];
  list.forEach((c) => {
    c.itens.sort((a, b) => num(a.item) - num(b.item));
    c.n_itens = c.itens.length;
    c.itens_a_medir = c.itens.filter((i) => i.qtde_a_medir > 0).length;
  });
  return list.sort((a, b) => a.obra.localeCompare(b.obra, "pt-BR") || num(a.contrato) - num(b.contrato));
}

/** Totais de uma lista de contratos (cada contrato entra uma vez). */
export function totals(contratos) {
  const sum = (k) => contratos.reduce((t, c) => t + c[k], 0);
  const valor = sum("valor"), medido = sum("medido");
  return {
    contratos: contratos.length, valor, medido, saldo: sum("saldo"),
    pct: valor > 0 ? Math.round((medido / valor) * 100) : 0,
    obras: new Set(contratos.map((c) => c.obra)).size,
    fornecedores: new Set(contratos.map((c) => c.fornecedor).filter(Boolean)).size
  };
}

/** Contagem por situação (rótulo sem código), na ordem do código do ERP. */
export function countBy(contratos, field) {
  const m = new Map();
  [...contratos].sort((a, b) => a[field].localeCompare(b[field], "pt-BR")).forEach((c) => m.set(c[field], (m.get(c[field]) || 0) + 1));
  return m;
}
