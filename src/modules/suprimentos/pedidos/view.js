// Interface do Relatório de Pedidos: filtros, indicadores, gráficos e tabela agrupada por obra.
import { esc, fmtDateShort, fmtNum, debounce, highlight } from "../../../platform/core/utils.js";
import { ICON, toast } from "../../../platform/ui/shell.js";
import { createMultiSelect } from "../../../platform/ui/multiselect.js";
import { attachAutocomplete } from "../../../platform/ui/autocomplete.js";
import { DELIVERY, OC, kpis } from "./model.js";
import { STATUS_OPTIONS, emptyFilters, applyFilters, materialWords, materialHit, obraOptions, pedidoOptions, syncPedidosWithSolicitantes, pruneSelections } from "./filters.js";
import { renderCharts } from "./charts.js";

const SOL_PALETTE = ["#1F3D38", "#6B8040", "#A38F52", "#ED7A12", "#2980b9", "#8e44ad", "#16a085", "#d35400", "#c0392b", "#27ae60", "#2c3e50", "#7f8c8d", "#e67e22", "#1abc9c", "#9b59b6"];
const COMPACT_KEY = "amCompact";
const SEARCH = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>';
const CHEV = '<span class="pd-chev" aria-hidden="true"><svg viewBox="0 0 16 16"><polyline points="6,3 10,8 6,13"/></svg></span>';
const HOUSE = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1L1 6v9h5v-5h4v5h5V6z"/></svg>';

const statusBadge = (s) => s === DELIVERY.TOTAL ? '<span class="pf-badge b-ok">Entregue</span>'
  : s === DELIVERY.PARTIAL ? '<span class="pf-badge b-partial">Parcial</span>'
  : s === DELIVERY.PENDING ? '<span class="pf-badge b-danger">Pendente</span>'
  : '<span class="pf-badge b-muted">Cancelado</span>';
const ocBadge = (s) => s === OC.DONE ? '<span class="pf-badge b-ok">OC gerada</span>' : '<span class="pf-badge b-warn">OC pendente</span>';
const pctColor = (p) => (p >= 100 ? "#27ae60" : p >= 50 ? "#f39c12" : "#e74c3c");
const bar = (p) => `<div class="pf-bar"><div><i style="width:${p}%;background:${pctColor(p)}"></i></div><b style="color:${pctColor(p)}">${p}%</b></div>`;
const matPill = (m) => m.status === "ok" ? '<span class="pf-badge b-ok">OK</span>'
  : m.status === "parcial" ? '<span class="pf-badge b-partial">Parcial</span>'
  : m.status === "cancelado" ? '<span class="pf-badge b-muted">Cancelado</span>'
  : '<span class="pf-badge b-danger">Pendente</span>';

/**
 * Monta a página.
 * @param {HTMLElement} root
 * @param {{pedidos:Array, updatedText:string}} data
 */
export function mountPedidos(root, { pedidos }) {
  const f = emptyFilters();
  const solicitantes = [...new Set(pedidos.map((p) => p.solicitante))].sort((a, b) => a.localeCompare(b, "pt-BR"));
  const solColor = new Map(solicitantes.map((u, i) => [u, SOL_PALETTE[i % SOL_PALETTE.length]]));
  const insumos = [...new Set(pedidos.flatMap((p) => p.materiais.map((m) => m.nome)))].sort();
  const fornecedores = [...new Set(pedidos.flatMap((p) => p.fornecedores))].filter((n) => n && n !== "********").sort();
  const expanded = new Set();
  let view = [], showCharts = false;
  let compact = false;
  try { compact = localStorage.getItem(COMPACT_KEY) === "1"; } catch { /* ignora */ }
  document.body.classList.toggle("compact", compact);

  root.innerHTML = `
    <section class="pf-kpis" id="pdKpis" aria-label="Indicadores"></section>
    <section class="fx pd-filters" id="pdFilters" aria-label="Filtros">
      <div class="fx-row">
        <label class="fx-search" id="pdOcWrap">${SEARCH}<input type="search" id="pdOc" placeholder="Ordem de compra" aria-label="Buscar ordem de compra"></label>
        <label class="fx-search pd-mat" id="pdMatWrap">${SEARCH}<input type="search" id="pdMat" placeholder="Material (palavras-chave): cabo flexível, tinta…" aria-label="Buscar material"></label>
        <label class="fx-search" id="pdFornWrap">${SEARCH}<input type="search" id="pdForn" placeholder="Fornecedor" aria-label="Buscar fornecedor"></label>
        <div class="fx-end">
          <span class="fx-count" id="pdCount"></span>
          <button class="pf-btn" id="pdClear" type="button">Limpar</button>
          <button class="pf-btn fx-more" id="pdMore" type="button" aria-expanded="false">Filtros <b class="fx-badge" id="pdBadge" hidden></b></button>
        </div>
      </div>
      <div class="fx-row pd-adv fx-adv" id="pdAdv">
        <label class="fx-field" id="pdIniWrap"><span>De</span><input type="date" id="pdIni" aria-label="Data do pedido a partir de"></label>
        <label class="fx-field" id="pdFimWrap"><span>Até</span><input type="date" id="pdFim" aria-label="Data do pedido até"></label>
        <div class="ms" id="pdObras"><button type="button" class="fx-field ms-btn"><span>Todas as obras</span></button></div>
        <label class="fx-field pd-status" id="pdStatusWrap"><span>Entrega</span><select id="pdStatus" aria-label="Status de entrega">${STATUS_OPTIONS.map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join("")}</select></label>
        <div class="ms" id="pdPeds"><button type="button" class="fx-field ms-btn"><span>Todos os pedidos</span></button></div>
      </div>
      <div class="fx-row pd-sol"><span class="fx-lbl">Solicitantes</span><div class="fx-scroll" id="pdSol"></div></div>
      <div class="fx-row fx-toggles pd-toggles">
        <div class="fx-toggles">
          <label class="pf-switch"><input type="checkbox" id="pdHide" checked><b></b>Ocultar pedidos totalmente entregues</label>
          <label class="pf-switch"><input type="checkbox" id="pdCompact"${compact ? " checked" : ""}><b></b>Modo compacto</label>
          <label class="pf-switch"><input type="checkbox" id="pdShowCharts"><b></b>Mostrar gráficos</label>
        </div>
        <button class="pf-btn pd-expand-all" id="pdExpandAll" type="button" aria-pressed="false"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg><span>Expandir todos</span></button>
      </div>
      <div class="pf-active" id="pdActive"></div>
    </section>
    <section class="pd-charts" id="pdCharts" hidden>
      <div class="pf-card pd-chart"><h3>Status de entrega</h3><div class="box"><canvas id="pdChartStatus"></canvas></div></div>
      <div class="pf-card pd-chart"><h3>Situação de OC</h3><div class="box"><canvas id="pdChartOC"></canvas></div></div>
      <div class="pf-card pd-chart wide"><h3>Pedidos por obra (top 10)</h3><div class="box"><canvas id="pdChartObra"></canvas></div></div>
    </section>
    <main id="pdList" aria-live="polite"></main>`;

  const $ = (id) => root.querySelector("#" + id);

  /* ── Solicitantes (chips coloridos) ── */
  const renderSolicitantes = () => {
    $("pdSol").innerHTML = `<button type="button" class="fchip fx-all${f.solicitantes.size ? "" : " active"}" data-sol="">Todos</button>` +
      solicitantes.map((u) => `<button type="button" class="fchip${f.solicitantes.has(u) ? " active" : ""}" data-sol="${esc(u)}" style="--c:${solColor.get(u)}"><i></i>${esc(u)}</button>`).join("");
  };
  $("pdSol").addEventListener("click", (e) => {
    const b = e.target.closest("[data-sol]"); if (!b) return;
    const u = b.dataset.sol;
    if (!u) f.solicitantes.clear(); else f.solicitantes.has(u) ? f.solicitantes.delete(u) : f.solicitantes.add(u);
    syncPedidosWithSolicitantes(pedidos, f);
    pruneSelections(pedidos, f);
    renderSolicitantes(); obrasMs.refresh(); pedsMs.refresh(); render();
  });

  /* ── Obras e pedidos (seleção múltipla) ── */
  const obrasMs = createMultiSelect($("pdObras"), {
    allLabel: "Todas as obras", searchPlaceholder: "Buscar obra…",
    getOptions: () => obraOptions(pedidos, f).map((o) => ({ key: o, label: o })),
    getSelected: () => f.obras,
    onChange: (sel) => { f.obras = sel; pruneSelections(pedidos, f); pedsMs.refresh(); render(); },
    summary: (sel) => !sel.size ? "Todas as obras" : sel.size === 1 ? `Obra ${[...sel][0]}` : `${sel.size} obras`
  });
  const pedsMs = createMultiSelect($("pdPeds"), {
    allLabel: "Todos os pedidos", searchPlaceholder: "Buscar pedido, obra, solicitante ou fornecedor…",
    getOptions: () => pedidoOptions(pedidos, f).map((p) => ({ key: p.key, tag: p.obra, label: "#" + p.pedido, sub: p.fornecedor || p.solicitante, search: `${p.pedido} ${p.obra} ${p.solicitante} ${p.fornecedor}` })),
    getSelected: () => f.pedidos,
    onChange: (sel) => { f.pedidos = sel; render(); },
    summary: (sel, total) => !sel.size || sel.size === total ? "Todos os pedidos" : `${sel.size} pedido(s): ` + [...sel].slice(0, 3).map((k) => "#" + k.split("-").pop()).join(", ") + (sel.size > 3 ? "…" : "")
  });

  /* ── Buscas (com sugestões) ── */
  const live = debounce(render, 220);
  $("pdOc").addEventListener("input", (e) => { f.oc = e.target.value; live(); });
  $("pdMat").addEventListener("input", (e) => { f.material = e.target.value; live(); });
  $("pdForn").addEventListener("input", (e) => { f.fornecedor = e.target.value; live(); });
  // O "x" e o Esc de campos de busca limpam o texto: mantém o filtro igual ao que está escrito.
  [["pdOc", "oc"], ["pdMat", "material"], ["pdForn", "fornecedor"]].forEach(([id, k]) =>
    $(id).addEventListener("search", (e) => { if (f[k] !== e.target.value) { f[k] = e.target.value; render(); } }));
  attachAutocomplete($("pdMat"), { getItems: () => insumos, onPick: (v) => { f.material = v; render(); } });
  attachAutocomplete($("pdForn"), { getItems: () => fornecedores, onPick: (v) => { f.fornecedor = v; render(); } });
  $("pdIni").addEventListener("change", (e) => { f.dtIni = e.target.value; render(); });
  $("pdFim").addEventListener("change", (e) => { f.dtFim = e.target.value; render(); });
  $("pdStatus").addEventListener("change", (e) => { f.status = e.target.value; render(); });
  $("pdHide").addEventListener("change", (e) => { f.ocultarEntregues = e.target.checked; render(); });
  $("pdCompact").addEventListener("change", (e) => {
    document.body.classList.toggle("compact", e.target.checked);
    try { localStorage.setItem(COMPACT_KEY, e.target.checked ? "1" : "0"); } catch { /* ignora */ }
  });
  $("pdShowCharts").addEventListener("change", (e) => {
    showCharts = e.target.checked; $("pdCharts").hidden = !showCharts;
    if (showCharts) renderCharts(view).catch(() => toast("Não foi possível carregar os gráficos."));
  });
  $("pdMore").addEventListener("click", (e) => {
    const open = !$("pdFilters").classList.contains("fx-open");
    $("pdFilters").classList.toggle("fx-open", open); e.currentTarget.setAttribute("aria-expanded", String(open));
  });
  $("pdClear").addEventListener("click", clearAll);
  $("pdExpandAll").addEventListener("click", () => {
    const all = view.length > 0 && view.every((p) => expanded.has(p.key));
    view.forEach((p) => (all ? expanded.delete(p.key) : expanded.add(p.key)));
    renderList();
  });

  /* ── Filtros ativos (com remoção individual) ── */
  const CLEAR = {
    sol: () => { f.solicitantes.clear(); syncPedidosWithSolicitantes(pedidos, f); renderSolicitantes(); },
    datas: () => { f.dtIni = f.dtFim = ""; $("pdIni").value = $("pdFim").value = ""; },
    obras: () => { f.obras.clear(); },
    peds: () => { f.pedidos.clear(); },
    oc: () => { f.oc = ""; $("pdOc").value = ""; },
    forn: () => { f.fornecedor = ""; $("pdForn").value = ""; },
    mat: () => { f.material = ""; $("pdMat").value = ""; }
  };
  $("pdActive").addEventListener("click", (e) => {
    const k = e.target.closest("[data-af]")?.dataset.af; if (!k) return;
    CLEAR[k](); obrasMs.refresh(); pedsMs.refresh(); render();
  });
  function renderActive() {
    const chips = [];
    const add = (k, label) => chips.push(`<span class="af"><span>${esc(label)}</span><button type="button" data-af="${k}" aria-label="Remover filtro ${esc(label)}">×</button></span>`);
    if (f.solicitantes.size) add("sol", [...f.solicitantes].join(", "));
    if (f.dtIni || f.dtFim) add("datas", `Período: ${f.dtIni ? fmtDateShort(f.dtIni) : "…"} a ${f.dtFim ? fmtDateShort(f.dtFim) : "…"}`);
    if (f.obras.size) add("obras", "Obra: " + (f.obras.size === 1 ? [...f.obras][0] : f.obras.size + " obras"));
    if (f.pedidos.size) add("peds", `${f.pedidos.size} pedido(s)`);
    if (f.oc.trim()) add("oc", "OC: " + f.oc.trim());
    if (f.fornecedor.trim()) add("forn", "Fornecedor: " + f.fornecedor.trim());
    if (f.material.trim()) add("mat", "Material: " + f.material.trim());
    $("pdActive").innerHTML = chips.length ? `<span class="af-lbl">Filtros ativos:</span>${chips.join("")}` : "";
    const adv = [f.dtIni, f.dtFim, f.obras.size, f.pedidos.size, f.status !== "abertos"].filter(Boolean).length;
    $("pdBadge").textContent = adv; $("pdBadge").hidden = !adv;
    [["pdIniWrap", f.dtIni], ["pdFimWrap", f.dtFim], ["pdOcWrap", f.oc.trim()], ["pdMatWrap", f.material.trim()], ["pdFornWrap", f.fornecedor.trim()], ["pdStatusWrap", f.status !== "abertos"]]
      .forEach(([id, on]) => $(id).classList.toggle("on", !!on));
  }

  function clearAll() {
    Object.assign(f, emptyFilters());
    ["pdOc", "pdMat", "pdForn", "pdIni", "pdFim"].forEach((id) => ($(id).value = ""));
    $("pdStatus").value = "abertos"; $("pdHide").checked = true;
    expanded.clear(); renderSolicitantes(); obrasMs.refresh(); pedsMs.refresh(); render();
  }

  /* ── Indicadores ── */
  function renderKpis() {
    const k = kpis(view);
    const card = (cls, label, v) => `<div class="pf-kpi ${cls}"><div class="kl">${label}</div><div class="kv">${v}</div></div>`;
    $("pdKpis").innerHTML = card("", "Total de pedidos", k.total) + card("gold", "Com OC emitida", k.comOC) + card("warn", "Sem OC", k.semOC) +
      card("ok", "Entregues", k.entregues) + card("blue", "Entrega parcial", k.parciais) + card("danger", "Pendente entrega", k.pendentes) + card("", "Obras", k.obras);
  }

  /* ── Tabela agrupada por obra ── */
  function materialsHTML(p, words) {
    return `<div class="pd-exp-in">
      <div class="pd-exp-h"><span>Descrição: <b>${esc(p.descricao)}</b></span>${p.fornecedor ? `<span>Fornecedor(es): <b>${esc(p.fornecedor)}</b></span>` : ""}${p.oc ? `<span>OC: <b>${esc(p.oc)}</b></span>` : ""}</div>
      <div class="pf-table-wrap"><table class="pf-tbl pd-mat-tbl"><thead><tr>
        <th class="l">Material</th><th>Ordem de compra</th><th>Qtd. solicitada</th><th>Qtd. entregue</th><th>Descartada</th><th>Saldo</th><th>% Entrega</th><th>Status</th>
      </tr></thead><tbody>${p.materiais.map((m) => {
        const oc = m.oc === "Pendente" ? '<span class="pd-oc-pend">Pendente</span>' : m.oc ? `<span class="pd-oc-tag">${esc(m.oc)}</span>` : "—";
        const qty = (n) => `<span class="pd-qty">${fmtNum(n)}${m.unidade ? `<small>${esc(m.unidade)}</small>` : ""}</span>`;
        return `<tr class="${materialHit(m, words) ? "hit" : ""}">
          <td class="pd-mat">${highlight(m.nome, words)}${m.codigo ? `<small>${esc(m.codigo)}${m.fornecedor ? " · " + esc(m.fornecedor) : ""}</small>` : ""}</td>
          <td>${oc}</td><td>${qty(m.sol)}</td><td>${qty(m.ent)}</td><td>${m.desc ? qty(m.desc) : "—"}</td><td>${m.saldo ? qty(m.saldo) : "—"}</td>
          <td>${bar(m.pct)}</td><td>${matPill(m)}</td></tr>`;
      }).join("")}</tbody></table></div></div>`;
  }

  function renderList() {
    const list = $("pdList");
    const words = materialWords(f);
    if (!view.length) { list.innerHTML = '<div class="pf-empty">Nenhum pedido encontrado com os filtros selecionados.</div>'; syncExpandAll(); return; }
    const byObra = new Map();
    view.forEach((p) => { if (!byObra.has(p.obra)) byObra.set(p.obra, []); byObra.get(p.obra).push(p); });
    let html = "";
    [...byObra.keys()].sort((a, b) => a.localeCompare(b, "pt-BR")).forEach((obra) => {
      const rows = byObra.get(obra);
      const n = (s) => rows.filter((p) => p.delivery_status === s).length;
      html += `<section class="pf-card pd-obra" aria-label="Obra ${esc(obra)}">
        <div class="pd-obra-h"><h2><span>${HOUSE}</span>${esc(obra)}</h2><small>${rows.length} pedido(s)</small></div>
        <div class="pf-table-wrap"><table class="pf-tbl pd-tbl"><thead><tr>
          <th style="width:30px"></th><th>Pedido</th><th>Solicitante</th><th class="l">Descrição do pedido</th><th>Itens</th><th>OC</th><th>Status OC</th><th>Status entrega</th><th>% Entrega</th><th>Dt. pedido</th><th>Prev. entrega</th><th class="l">Fornecedor</th>
        </tr></thead><tbody>${rows.map((p) => {
          const open = expanded.has(p.key);
          const c = solColor.get(p.solicitante) || "#6B8040";
          return `<tr class="pd-row${open ? " open" : ""}${p.oc_status !== OC.DONE ? " no-oc" : ""}" data-key="${esc(p.key)}" tabindex="0" aria-expanded="${open}">
            <td>${CHEV}</td>
            <td class="pd-ped">${p.pedido}</td>
            <td><span class="pd-sol-tag" style="--c:${c}">${esc(p.solicitante)}</span></td>
            <td class="pd-desc"><span class="pd-desc-b" title="${esc(p.descricao)}">${esc(p.descricao)}</span></td>
            <td>${p.n_itens}</td>
            <td>${p.oc ? `<span class="pd-oc" title="${esc(p.oc)}">${esc(p.oc)}</span>` : "—"}</td>
            <td>${ocBadge(p.oc_status)}</td>
            <td>${statusBadge(p.delivery_status)}</td>
            <td>${bar(p.pct)}</td>
            <td>${fmtDateShort(p.dt_pedido)}</td>
            <td>${fmtDateShort(p.dt_prev)}</td>
            <td class="l">${p.fornecedor ? `<span class="pd-forn" title="${esc(p.fornecedor)}">${esc(p.fornecedor)}</span>` : "—"}</td>
          </tr>${open ? `<tr class="pd-exp" data-exp="${esc(p.key)}"><td colspan="12">${materialsHTML(p, words)}</td></tr>` : ""}`;
        }).join("")}</tbody></table></div>
        <div class="pd-sum"><span class="g">Entregues: <b>${n(DELIVERY.TOTAL)}</b></span><span class="b">Parciais: <b>${n(DELIVERY.PARTIAL)}</b></span><span class="r">Pendentes: <b>${n(DELIVERY.PENDING)}</b></span><span>Total: <b>${rows.length}</b></span></div>
      </section>`;
    });
    list.innerHTML = html;
    syncExpandAll();
  }

  function syncExpandAll() {
    const all = view.length > 0 && view.every((p) => expanded.has(p.key));
    const b = $("pdExpandAll");
    b.setAttribute("aria-pressed", String(all));
    b.querySelector("span").textContent = all ? "Recolher todos" : "Expandir todos";
  }

  const toggleRow = (key) => { expanded.has(key) ? expanded.delete(key) : expanded.add(key); renderList(); root.querySelector(`tr.pd-row[data-key="${CSS.escape(key)}"]`)?.focus({ preventScroll: true }); };
  $("pdList").addEventListener("click", (e) => { const tr = e.target.closest("tr.pd-row"); if (tr) toggleRow(tr.dataset.key); });
  $("pdList").addEventListener("keydown", (e) => {
    const tr = e.target.closest("tr.pd-row"); if (!tr) return;
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleRow(tr.dataset.key); }
  });

  function render() {
    view = applyFilters(pedidos, f);
    // Busca por material: abre automaticamente os pedidos com itens encontrados (como no relatório antigo).
    const words = materialWords(f);
    if (words.length) view.forEach((p) => { if (p.materiais.some((m) => materialHit(m, words))) expanded.add(p.key); });
    $("pdCount").textContent = `${view.length} pedido(s)`;
    renderKpis(); renderActive(); renderList();
    if (showCharts) renderCharts(view).catch(() => {});
  }

  renderSolicitantes();
  render();
  return { render, filters: f };
}

export { ICON };
