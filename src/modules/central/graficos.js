// Gráficos simples em HTML/CSS (sem biblioteca): barras agrupadas por período, eixo único, grade discreta,
// dica ao passar o mouse/tocar (data-tip, o mesmo componente dos gráficos do Resumo Geral), legenda sempre
// presente e tabela com os números (acessibilidade e leitura exata).
// Cores categóricas validadas (scripts/validate_palette.js do guia de visualização):
//   Vistorias #2f6fdb · Revistorias #e8842a  |  Identificadas #7b5cd6 · Resolvidas #0097a7
import { escala, rotuloBalde, fmtD } from "./model.js";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const SERIES = {
  vistorias: { key: "vistorias", label: "Vistorias", cor: "#2f6fdb" },
  revistorias: { key: "revistorias", label: "Revistorias", cor: "#e8842a" },
  vist_aprovadas: { key: "vist_aprovadas", label: "Vistorias aprovadas", cor: "#2f6fdb" },
  rev_aprovadas: { key: "rev_aprovadas", label: "Revistorias aprovadas", cor: "#e8842a" },
  pend_identificadas: { key: "pend_identificadas", label: "Identificadas", cor: "#7b5cd6" },
  pend_resolvidas: { key: "pend_resolvidas", label: "Resolvidas", cor: "#0097a7" }
};
const periodoBalde = (ini, grao) => (grao === "mes" ? rotuloBalde(ini, "mes") : grao === "semana" ? `semana de ${fmtD(ini)}` : fmtD(ini));

/**
 * Barras agrupadas. baldes: [{ini, <serie>: n}], series: chaves de SERIES.
 * Rótulos do eixo X espaçados para não se sobreporem; números exatos na dica e na tabela.
 */
export function barras({ id, titulo, baldes, series, grao, vazio = "Sem registros no período.", classe = "" }) {
  const ss = series.map((k) => SERIES[k]);
  const max = Math.max(0, ...baldes.flatMap((b) => ss.map((s) => b[s.key] || 0)));
  const tot = Object.fromEntries(ss.map((s) => [s.key, baldes.reduce((n, b) => n + (b[s.key] || 0), 0)]));
  const leg = `<div class="cg-leg">${ss.map((s) => `<span><i style="--c:${s.cor}"></i>${esc(s.label)} <b>${tot[s.key]}</b></span>`).join("")}</div>`;
  if (!baldes.length || !max) return `<figure class="cg ${esc(classe)}" id="${esc(id)}"><figcaption>${esc(titulo)}</figcaption>${leg}<div class="cg-vazio">${esc(vazio)}</div></figure>`;
  const { max: topo, passo } = escala(max, 4);
  const grade = [];
  for (let v = 0; v <= topo; v += passo) grade.push(v);
  const cada = Math.max(1, Math.ceil(baldes.length / 10));
  const cols = baldes.map((b, i) => {
    const per = periodoBalde(b.ini, grao);
    const barrasHtml = ss.map((s) => {
      const v = b[s.key] || 0, h = (v / topo) * 100;
      return `<i class="cg-b${v ? "" : " zero"}" style="--c:${s.cor};height:${v ? Math.max(h, 1.5) : 0}%" data-tip="${esc(`${per} · ${s.label}: ${v}`)}" tabindex="${v ? 0 : -1}"></i>`;
    }).join("");
    return `<div class="cg-col"><div class="cg-bars">${barrasHtml}</div><span class="cg-x">${i % cada === 0 ? esc(rotuloBalde(b.ini, grao)) : ""}</span></div>`;
  }).join("");
  const tabela = `<details class="cg-tab"><summary>Ver tabela</summary><div class="cg-tw"><table><thead><tr><th>Período</th>${ss.map((s) => `<th>${esc(s.label)}</th>`).join("")}</tr></thead><tbody>${
    baldes.map((b) => `<tr><td>${esc(periodoBalde(b.ini, grao))}</td>${ss.map((s) => `<td>${b[s.key] || 0}</td>`).join("")}</tr>`).join("")}</tbody></table></div></details>`;
  return `<figure class="cg ${esc(classe)}" id="${esc(id)}" role="group" aria-label="${esc(titulo)}"><figcaption>${esc(titulo)}</figcaption>${leg}
    <div class="cg-area" style="--n:${grade.length - 1}">
      <div class="cg-y">${grade.slice().reverse().map((v) => `<span>${v}</span>`).join("")}</div>
      <div class="cg-plot"><div class="cg-grid">${grade.map(() => "<i></i>").join("")}</div><div class="cg-cols">${cols}</div></div>
    </div>${tabela}</figure>`;
}
/** Barra horizontal de proporção (ex.: % de resolução) com o número escrito ao lado. */
export function proporcao(v, total, cor = "#0097a7") {
  const p = total ? Math.round((v / total) * 100) : 0;
  return `<span class="cg-prop" title="${v} de ${total}"><i style="--c:${cor};width:${p}%"></i></span>`;
}
