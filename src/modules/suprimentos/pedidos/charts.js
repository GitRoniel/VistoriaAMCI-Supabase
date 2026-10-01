// Gráficos do relatório (Chart.js carregado só quando o usuário liga "Mostrar gráficos").
import { DELIVERY, OC } from "./model.js";
import { isDark } from "../../../platform/core/theme.js";

const CHART_JS = "https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js";
let loading = null;
const charts = {};

function loadChartJs() {
  if (window.Chart) return Promise.resolve();
  if (!loading) {
    loading = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = CHART_JS; s.async = true; s.onload = resolve; s.onerror = () => { loading = null; reject(new Error("Chart.js indisponível")); };
      document.head.appendChild(s);
    });
  }
  return loading;
}

function draw(id, config) {
  const el = document.getElementById(id);
  if (!el) return;
  charts[id]?.destroy();
  charts[id] = new window.Chart(el, config);
}

/** Desenha os três gráficos do relatório antigo: status de entrega, situação de OC e pedidos por obra (top 10). */
export async function renderCharts(pedidos) {
  await loadChartJs();
  const text = isDark() ? "#cfd9d3" : "#44524a", grid = isDark() ? "#3a423c" : "#eceff0";
  const legend = { position: "right", labels: { boxWidth: 10, padding: 8, font: { size: 11 }, color: text } };
  const donut = (labels, data, colors) => ({
    type: "doughnut",
    data: { labels, datasets: [{ data, backgroundColor: colors, borderWidth: 0 }] },
    options: { responsive: true, maintainAspectRatio: false, cutout: "60%", plugins: { legend } }
  });
  const c = (s) => pedidos.filter((p) => p.delivery_status === s).length;
  draw("pdChartStatus", donut(["Entregue", "Parcial", "Pendente"], [c(DELIVERY.TOTAL), c(DELIVERY.PARTIAL), c(DELIVERY.PENDING)], ["#6B8040", "#A38F52", "#c0392b"]));
  const comOc = pedidos.filter((p) => p.oc_status === OC.DONE).length;
  draw("pdChartOC", donut(["OC gerada", "OC pendente"], [comOc, pedidos.length - comOc], ["#1F3D38", "#ED7A12"]));
  const byObra = new Map();
  pedidos.forEach((p) => byObra.set(p.obra, (byObra.get(p.obra) || 0) + 1));
  const top = [...byObra.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  draw("pdChartObra", {
    type: "bar",
    data: { labels: top.map((o) => o[0]), datasets: [{ data: top.map((o) => o[1]), backgroundColor: "#6B8040", borderRadius: 4 }] },
    options: {
      responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { font: { size: 10 }, color: text }, grid: { display: false } },
        y: { beginAtZero: true, ticks: { font: { size: 10 }, color: text, precision: 0 }, grid: { color: grid } }
      }
    }
  });
}
