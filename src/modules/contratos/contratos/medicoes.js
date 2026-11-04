// Medições dos contratos (UAU XT › Controle de Medições, gravadas pelo robô em medicoes_registros).
//
// Regras (conferidas com os dados reais de 03/11/2026: 1.126 medições, 182 contratos):
//   • uma linha = uma medição; "total" e "subtotal" são valores DA medição, nunca acumulados;
//   • a medição pertence ao contrato empresa + obra + contrato (mesma chave do relatório 549),
//     nunca pelo nome do fornecedor (um fornecedor tem vários contratos);
//   • medição = número da medição dentro do contrato; a chave empresa-obra-contrato-medição não se repete;
//   • o "valor medido" do contrato no 549 é a soma do SubTotal de todas as medições do contrato (qualquer
//     status). A diferença aparece quando há medições fora do período importado: é mostrada, não somada;
//   • contrato sem medição importada não é tratado como "medido = 0": fica "sem medições importadas".

const num = (v) => (v == null || v === "" || Number.isNaN(Number(v)) ? 0 : Number(v));
export const TOLERANCIA = 0.05;   // centavos de arredondamento entre o 549 e a soma das medições

export const medContratoKey = (m) => `${m.empresa ?? ""}-${m.obra ?? ""}-${m.contrato ?? ""}`;

/** "2 - Medida" → "Medida". */
export const medStatusLabel = (s) => String(s || "").replace(/^\s*\d+\s*-\s*/, "").trim() || "Sem status";

function buildMedicao(r) {
  return {
    medicao: num(r.medicao), chave: r.chave,
    inicio: r.inicio_medicao || null, termino: r.termino_medicao || null,
    subtotal: num(r.subtotal), acrescimos: num(r.acrescimos), excedente: num(r.excedente),
    descontos: num(r.descontos), desc_medicao: num(r.desc_medicao), total: num(r.total),
    status: r.status || "", contratado: r.contratado || "", observacao: r.observacao || "",
    dt_aprovacao: r.dt_aprovacao || null, quem_aprovou: r.quem_aprovou || "",
    objeto: r.objeto || "", fornecedor: r.fornecedor || "", cod_fornecedor: r.cod_fornecedor,
    empresa: r.empresa, obra: r.obra, contrato: r.contrato, desc_obra: r.desc_obra || "", desc_empresa: r.desc_empresa || ""
  };
}

/** Agrupa as medições por contrato (sem repetir a mesma medição). */
export function groupMedicoes(rows) {
  const map = new Map(), vistas = new Set();
  for (const r of rows || []) {
    const chave = r.chave || `${medContratoKey(r)}-${r.medicao}`;
    if (vistas.has(chave)) continue;
    vistas.add(chave);
    const k = medContratoKey(r);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(buildMedicao({ ...r, chave }));
  }
  map.forEach((list) => list.sort((a, b) => a.medicao - b.medicao));
  return map;
}

/**
 * Liga as medições aos contratos do 549 (pela chave do contrato) e calcula o resumo de cada contrato.
 * Altera os contratos (c.medicoes, c.med) e devolve as medições que não acharam contrato.
 * @param {Array} contratos  saída de buildContratos
 * @param {Map|null} medMap  saída de groupMedicoes; null = medições indisponíveis
 */
export function attachMedicoes(contratos, medMap) {
  const usadas = new Set();
  for (const c of contratos) {
    const list = medMap ? medMap.get(c.key) || [] : null;
    if (list) usadas.add(c.key);
    c.medicoes = list || [];
    if (!medMap) { c.med = { fonte: false, n: 0 }; continue; }
    let acum = 0;
    c.medicoes.forEach((m) => { acum += m.subtotal; m.acumulado = acum; });
    const bruto = c.medicoes.reduce((t, m) => t + m.subtotal, 0);
    const liquido = c.medicoes.reduce((t, m) => t + m.total, 0);
    const descontos = c.medicoes.reduce((t, m) => t + m.descontos + m.desc_medicao, 0);
    const dif = c.medido - bruto;
    c.med = {
      fonte: true, n: c.medicoes.length, bruto, liquido, descontos, dif,
      // ok: a soma das medições fecha com o medido do contrato; dif: não fecha; sem: nenhuma medição importada
      situacao: !c.medicoes.length ? "sem" : Math.abs(dif) <= TOLERANCIA ? "ok" : "dif",
      ultima: c.medicoes.length ? c.medicoes[c.medicoes.length - 1] : null
    };
  }
  const semContrato = [];
  if (medMap) medMap.forEach((list, k) => { if (!usadas.has(k)) semContrato.push({ key: k, medicoes: list, ...list[0] }); });
  semContrato.sort((a, b) => String(a.obra).localeCompare(String(b.obra), "pt-BR") || num(a.contrato) - num(b.contrato));
  return semContrato;
}

/** A medição cai no período? (período da medição sobrepõe [de, ate]; datas "aaaa-mm-dd", vazias = sem limite) */
export function medicaoNoPeriodo(m, de, ate) {
  const ini = m.inicio || m.termino, fim = m.termino || m.inicio;
  if (!ini && !fim) return !de && !ate;
  if (de && fim < de) return false;
  if (ate && ini > ate) return false;
  return true;
}

/** Filtro de medições ativo? */
export const medFiltroAtivo = (f) => !!(f.medDe || f.medAte || String(f.medNum || "").trim());

/** A medição atende aos filtros de período e número? */
export function medicaoHit(m, f) {
  if (!medFiltroAtivo(f)) return false;
  const n = String(f.medNum || "").trim();
  if (n && String(m.medicao) !== n) return false;
  return medicaoNoPeriodo(m, f.medDe || "", f.medAte || "");
}

/** Totais das medições de uma lista de contratos (com filtro: só as medições que atendem). */
export function medTotals(contratos, f) {
  const ativo = medFiltroAtivo(f);
  let n = 0, bruto = 0, liquido = 0, divergentes = 0, semMed = 0;
  for (const c of contratos) {
    if (!c.med?.fonte) continue;
    if (c.med.situacao === "dif") divergentes++;
    if (c.med.situacao === "sem") semMed++;
    for (const m of c.medicoes) {
      if (ativo && !medicaoHit(m, f)) continue;
      n++; bruto += m.subtotal; liquido += m.total;
    }
  }
  return { n, bruto, liquido, divergentes, semMed, filtro: ativo };
}

/** "aaaa-mm-dd" → "mm/aaaa" por extenso curto ("set/2026"); período "01/09 a 30/09/2026". */
const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
export function fmtPeriodo(ini, fim) {
  const d = (s) => (s ? s.slice(0, 10).split("-") : null);
  const a = d(ini), b = d(fim);
  if (!a && !b) return "—";
  if (a && b && a[0] === b[0] && a[1] === b[1]) {
    if (a[2] === b[2]) return `${a[2]}/${a[1]}/${a[0]}`;
    return a[2] === "01" && Number(b[2]) >= 28 ? `${MESES[Number(a[1]) - 1]}/${a[0]}` : `${a[2]} a ${b[2]}/${a[1]}/${a[0]}`;
  }
  const f = (x) => (x ? `${x[2]}/${x[1]}/${x[0]}` : "…");
  return `${f(a)} a ${f(b)}`;
}
