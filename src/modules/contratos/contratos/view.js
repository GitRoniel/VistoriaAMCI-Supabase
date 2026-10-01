// Interface do Relatório de Contratos: mesmos componentes e padrão de interação do Relatório de Pedidos.
// Hierarquia: Obra → Contrato (fornecedor/objeto, valores, status) → Itens/serviços (expansível).
import { esc, fmtNum, fmtMoney, normText, debounce, highlight } from "../../../platform/core/utils.js";
import { createMultiSelect } from "../../../platform/ui/multiselect.js";
import { attachAutocomplete } from "../../../platform/ui/autocomplete.js";
import { statusLabel, totals } from "./model.js";
import { emptyFilters, applyFilters, situacaoOptions, statusOptions, servicoWords, itemHit, obraOptions, contratoOptions, pruneSelections } from "./filters.js";

const COMPACT_KEY = "amCompact";
const SEARCH = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>';
const CHEV = '<span class="pd-chev" aria-hidden="true"><svg viewBox="0 0 16 16"><polyline points="6,3 10,8 6,13"/></svg></span>';

const pctColor = (p) => (p >= 100 ? "#27ae60" : p >= 50 ? "#f39c12" : "#e74c3c");
const bar = (p) => { const w = Math.max(0, Math.min(100, p)); return `<div class="pf-bar"><div><i style="width:${w}%;background:${pctColor(p)}"></i></div><b style="color:${pctColor(p)}">${p}%</b></div>`; };
const situacaoBadge = (s) => {
  const l = statusLabel(s), n = normText(l);
  const cls = /conclu/.test(n) ? "b-ok" : /cancel/.test(n) ? "b-muted" : /andamento/.test(n) ? "b-partial" : "b-warn";
  return `<span class="pf-badge ${cls}">${esc(l)}</span>`;
};
const statusTone = (s) => { const n = normText(statusLabel(s)); return /nao aprov|reprov/.test(n) ? "t-red" : /aditivo/.test(n) ? "t-orange" : /aprov/.test(n) ? "t-green" : "t-muted"; };
const money = (n, cls = "") => `<span class="ct-money${cls ? " " + cls : ""}">${fmtMoney(n)}</span>`;

/**
 * Monta a aba Contratos.
 * @param {HTMLElement} root
 * @param {{contratos:Array}} data
 */
export function mountContratos(root, { contratos }) {
  const f = emptyFilters();
  const servicos = [...new Set(contratos.flatMap((c) => c.itens.map((i) => i.servico)))].sort();
  const fornecedores = [...new Set(contratos.map((c) => c.fornecedor).filter(Boolean))].sort();
  const expanded = new Set();
  let view = [];
  const compact = document.body.classList.contains("compact");

  root.innerHTML = `
    <section class="pf-kpis" id="ctKpis" aria-label="Indicadores"></section>
    <section class="fx ct-filters" id="ctFilters" aria-label="Filtros">
      <div class="fx-row">
        <label class="fx-search" id="ctNumWrap">${SEARCH}<input type="search" id="ctNum" placeholder="Contrato (nº ou objeto)" aria-label="Buscar contrato"></label>
        <label class="fx-search ct-serv" id="ctServWrap">${SEARCH}<input type="search" id="ctServ" placeholder="Serviço / item (palavras-chave): concreto, locação…" aria-label="Buscar serviço"></label>
        <label class="fx-search" id="ctFornWrap">${SEARCH}<input type="search" id="ctForn" placeholder="Fornecedor" aria-label="Buscar fornecedor"></label>
        <div class="fx-end">
          <span class="fx-count" id="ctCount"></span>
          <button class="pf-btn" id="ctClear" type="button">Limpar</button>
          <button class="pf-btn fx-more" id="ctMore" type="button" aria-expanded="false">Filtros <b class="fx-badge" id="ctBadge" hidden></b></button>
        </div>
      </div>
      <div class="fx-row ct-adv fx-adv" id="ctAdv">
        <div class="ms" id="ctObras"><button type="button" class="fx-field ms-btn"><span>Todas as obras</span></button></div>
        <div class="ms" id="ctContratos"><button type="button" class="fx-field ms-btn"><span>Todos os contratos</span></button></div>
        <label class="fx-field ct-sel" id="ctSituacaoWrap"><span>Situação</span><select id="ctSituacao" aria-label="Situação do contrato">${situacaoOptions(contratos).map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join("")}</select></label>
        <label class="fx-field ct-sel" id="ctStatusWrap"><span>Status</span><select id="ctStatus" aria-label="Status do contrato">${statusOptions(contratos).map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join("")}</select></label>
      </div>
      <div class="fx-row fx-toggles pd-toggles">
        <div class="fx-toggles">
          <label class="pf-switch"><input type="checkbox" id="ctSaldo"><b></b>Somente com saldo a medir</label>
          <label class="pf-switch"><input type="checkbox" id="ctCompact" data-compact-toggle${compact ? " checked" : ""}><b></b>Modo compacto</label>
        </div>
        <button class="pf-btn pd-expand-all" id="ctExpandAll" type="button" aria-pressed="false"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg><span>Expandir todos</span></button>
      </div>
      <div class="pf-active" id="ctActive"></div>
    </section>
    <main id="ctList" aria-live="polite"></main>`;

  const $ = (id) => root.querySelector("#" + id);

  /* ── Obras e contratos (seleção múltipla) ── */
  const obrasMs = createMultiSelect($("ctObras"), {
    allLabel: "Todas as obras", searchPlaceholder: "Buscar obra…",
    getOptions: () => obraOptions(contratos).map((c) => ({ key: c.obra, label: c.obra, sub: c.obra_desc, search: `${c.obra} ${c.obra_desc} ${c.condominio}` })),
    getSelected: () => f.obras,
    onChange: (sel) => { f.obras = sel; pruneSelections(contratos, f); ctsMs.refresh(); render(); },
    summary: (sel) => !sel.size ? "Todas as obras" : sel.size === 1 ? `Obra ${[...sel][0]}` : `${sel.size} obras`
  });
  const ctsMs = createMultiSelect($("ctContratos"), {
    allLabel: "Todos os contratos", searchPlaceholder: "Buscar contrato, obra, fornecedor ou objeto…",
    getOptions: () => contratoOptions(contratos, f).map((c) => ({ key: c.key, tag: c.obra, label: "#" + c.contrato, sub: c.fornecedor || c.objeto, search: `${c.contrato} ${c.obra} ${c.fornecedor} ${c.objeto}` })),
    getSelected: () => f.contratos,
    onChange: (sel) => { f.contratos = sel; render(); },
    summary: (sel, total) => !sel.size || sel.size === total ? "Todos os contratos" : `${sel.size} contrato(s): ` + [...sel].slice(0, 3).map((k) => "#" + k.split("-").pop()).join(", ") + (sel.size > 3 ? "…" : "")
  });

  /* ── Buscas (com sugestões) ── */
  const live = debounce(render, 220);
  $("ctNum").addEventListener("input", (e) => { f.contrato = e.target.value; live(); });
  $("ctServ").addEventListener("input", (e) => { f.servico = e.target.value; live(); });
  $("ctForn").addEventListener("input", (e) => { f.fornecedor = e.target.value; live(); });
  [["ctNum", "contrato"], ["ctServ", "servico"], ["ctForn", "fornecedor"]].forEach(([id, k]) =>
    $(id).addEventListener("search", (e) => { if (f[k] !== e.target.value) { f[k] = e.target.value; render(); } }));
  attachAutocomplete($("ctServ"), { getItems: () => servicos, onPick: (v) => { f.servico = v; render(); } });
  attachAutocomplete($("ctForn"), { getItems: () => fornecedores, onPick: (v) => { f.fornecedor = v; render(); } });
  $("ctSituacao").addEventListener("change", (e) => { f.situacao = e.target.value; render(); });
  $("ctStatus").addEventListener("change", (e) => { f.status = e.target.value; render(); });
  $("ctSaldo").addEventListener("change", (e) => { f.comSaldo = e.target.checked; render(); });
  $("ctCompact").addEventListener("change", (e) => {
    document.body.classList.toggle("compact", e.target.checked);
    try { localStorage.setItem(COMPACT_KEY, e.target.checked ? "1" : "0"); } catch { /* ignora */ }
  });
  $("ctMore").addEventListener("click", (e) => {
    const open = !$("ctFilters").classList.contains("fx-open");
    $("ctFilters").classList.toggle("fx-open", open); e.currentTarget.setAttribute("aria-expanded", String(open));
  });
  $("ctClear").addEventListener("click", clearAll);
  $("ctExpandAll").addEventListener("click", () => {
    const all = view.length > 0 && view.every((c) => expanded.has(c.key));
    view.forEach((c) => (all ? expanded.delete(c.key) : expanded.add(c.key)));
    renderList();
  });

  /* ── Filtros ativos (com remoção individual) ── */
  const CLEAR = {
    obras: () => { f.obras.clear(); },
    cts: () => { f.contratos.clear(); },
    num: () => { f.contrato = ""; $("ctNum").value = ""; },
    forn: () => { f.fornecedor = ""; $("ctForn").value = ""; },
    serv: () => { f.servico = ""; $("ctServ").value = ""; },
    status: () => { f.status = "todos"; $("ctStatus").value = "todos"; },
    situacao: () => { f.situacao = "todas"; $("ctSituacao").value = "todas"; },
    saldo: () => { f.comSaldo = false; $("ctSaldo").checked = false; }
  };
  $("ctActive").addEventListener("click", (e) => {
    const k = e.target.closest("[data-af]")?.dataset.af; if (!k) return;
    CLEAR[k](); obrasMs.refresh(); ctsMs.refresh(); render();
  });
  function renderActive() {
    const chips = [];
    const add = (k, label) => chips.push(`<span class="af"><span>${esc(label)}</span><button type="button" data-af="${k}" aria-label="Remover filtro ${esc(label)}">×</button></span>`);
    if (f.obras.size) add("obras", "Obra: " + (f.obras.size === 1 ? [...f.obras][0] : f.obras.size + " obras"));
    if (f.contratos.size) add("cts", `${f.contratos.size} contrato(s)`);
    if (f.situacao !== "todas") add("situacao", "Situação: " + (f.situacao === "abertas" ? "em aberto" : statusLabel(f.situacao)));
    if (f.status !== "todos") add("status", "Status: " + statusLabel(f.status));
    if (f.comSaldo) add("saldo", "Com saldo a medir");
    if (f.contrato.trim()) add("num", "Contrato: " + f.contrato.trim());
    if (f.fornecedor.trim()) add("forn", "Fornecedor: " + f.fornecedor.trim());
    if (f.servico.trim()) add("serv", "Serviço: " + f.servico.trim());
    $("ctActive").innerHTML = chips.length ? `<span class="af-lbl">Filtros ativos:</span>${chips.join("")}` : "";
    const adv = [f.obras.size, f.contratos.size, f.status !== "todos", f.situacao !== "abertas"].filter(Boolean).length;
    $("ctBadge").textContent = adv; $("ctBadge").hidden = !adv;
    [["ctNumWrap", f.contrato.trim()], ["ctServWrap", f.servico.trim()], ["ctFornWrap", f.fornecedor.trim()], ["ctStatusWrap", f.status !== "todos"], ["ctSituacaoWrap", f.situacao !== "abertas"]]
      .forEach(([id, on]) => $(id).classList.toggle("on", !!on));
  }

  function clearAll() {
    Object.assign(f, emptyFilters());
    ["ctNum", "ctServ", "ctForn"].forEach((id) => ($(id).value = ""));
    $("ctSituacao").value = f.situacao; $("ctStatus").value = f.status; $("ctSaldo").checked = false;
    expanded.clear(); obrasMs.refresh(); ctsMs.refresh(); render();
  }

  /* ── Indicadores (cada contrato entra uma vez) ── */
  function renderKpis() {
    const k = totals(view);
    const card = (cls, label, v, title = "") => `<div class="pf-kpi ${cls}"${title ? ` title="${esc(title)}"` : ""}><div class="kl">${label}</div><div class="kv">${v}</div></div>`;
    $("ctKpis").innerHTML = card("", "Contratos", k.contratos) +
      card("gold", "Valor contratado", fmtMoney(k.valor, true), fmtMoney(k.valor)) +
      card("ok", "Valor medido", fmtMoney(k.medido, true), fmtMoney(k.medido)) +
      card("warn", "Saldo a medir", fmtMoney(k.saldo, true), fmtMoney(k.saldo)) +
      card("blue", "% medido", k.pct + "%") +
      card("", "Fornecedores", k.fornecedores) + card("", "Obras", k.obras);
  }

  /* ── Itens do contrato (expansível) ── */
  function itensHTML(c, words) {
    const head = c.retencao ? `<div class="ct-exp-h"><span class="ct-tag">${esc(c.retencao)}</span></div>` : "";
    return `<div class="pd-exp-in">${head}
      <table class="ct-it-tbl"><thead><tr>
        <th class="r">Item</th><th class="l">Serviço</th><th class="r">Qtde</th><th class="r">Preço</th><th class="r">Subtotal</th><th class="r">Medido</th><th class="r">A medir</th><th class="l">% medido</th>
      </tr></thead><tbody>${c.itens.map((i) => {
        const un = i.unidade ? `<small>${esc(i.unidade)}</small>` : "";
        const q = (n) => `<span class="pd-qty">${fmtNum(n)}${un}</span>`;
        return `<tr class="${itemHit(i, words) ? "hit" : ""}">
          <td class="i-n r">${esc(i.item ?? "")}</td>
          <td class="i-serv l">${highlight(i.servico, words)}${i.codigo ? `<small>${esc(i.codigo)}</small>` : ""}</td>
          <td class="i-v r" data-l="Qtde">${q(i.qtde)}</td>
          <td class="i-v r" data-l="Preço">${money(i.preco)}</td>
          <td class="i-v r i-sub" data-l="Subtotal">${money(i.subtotal)}</td>
          <td class="i-v r" data-l="Medido">${q(i.qtde_medida)}${money(i.valor_medido, "sub")}</td>
          <td class="i-v r i-am" data-l="A medir">${i.qtde_a_medir ? q(i.qtde_a_medir) + money(i.valor_a_medir, "sub") : '<span class="pd-nil">—</span>'}</td>
          <td class="i-pct l">${bar(i.pct)}</td></tr>`;
      }).join("")}</tbody></table></div>`;
  }

  // Totais da obra no cabeçalho do grupo (soma dos contratos, cada um uma vez).
  function obraTotals(rows) {
    const t = totals(rows);
    return `<span class="ct-st" title="${esc(fmtMoney(t.valor))}">Contratado <b>${fmtMoney(t.valor, true)}</b></span>` +
      `<span class="ct-st t-green" title="${esc(fmtMoney(t.medido))}">Medido <b>${fmtMoney(t.medido, true)}</b></span>` +
      `<span class="ct-st t-orange" title="${esc(fmtMoney(t.saldo))}">Saldo <b>${fmtMoney(t.saldo, true)}</b></span>` +
      `<span class="ct-st t-blue">% medido <b>${t.pct}%</b></span>`;
  }

  function renderList() {
    const list = $("ctList");
    const words = servicoWords(f);
    if (!view.length) { list.innerHTML = '<div class="pf-empty">Nenhum contrato encontrado com os filtros selecionados.</div>'; syncExpandAll(); return; }
    const byObra = new Map();
    view.forEach((c) => { if (!byObra.has(c.obra)) byObra.set(c.obra, []); byObra.get(c.obra).push(c); });
    let html = "";
    [...byObra.keys()].sort((a, b) => a.localeCompare(b, "pt-BR")).forEach((obra) => {
      const rows = byObra.get(obra);
      const first = rows[0];
      const itens = rows.reduce((t, c) => t + c.n_itens, 0);
      const cond = first.condominio.split(" - ")[0];
      html += `<section class="pf-card ct-obra" aria-label="Obra ${esc(obra)}">
        <header class="ct-obra-h">
          <div class="ct-obra-t"><span class="ct-obra-k">Obra</span><h2>${esc(obra)}</h2><span class="ct-obra-m">${esc([first.obra_desc, cond].filter(Boolean).join(" · "))}${first.obra_desc || cond ? " · " : ""}${rows.length} contrato(s) · ${itens} ${itens === 1 ? "item" : "itens"}</span></div>
          <div class="ct-obra-s">${obraTotals(rows)}</div>
        </header>
        <div class="pf-table-wrap"><table class="ct-tbl"><colgroup><col class="w-chev"><col class="w-ct"><col><col class="w-itens"><col class="w-val"><col class="w-med"><col class="w-val"><col class="w-st"></colgroup><thead><tr>
          <th aria-label="Expandir"></th><th class="l">Contrato</th><th class="l">Fornecedor · objeto</th><th class="r">Itens</th><th class="r">Valor do contrato</th><th class="l">Medido</th><th class="r">Saldo</th><th class="l">Situação · status</th>
        </tr></thead><tbody>${rows.map((c, i) => {
          const open = expanded.has(c.key);
          return `<tr class="ct-row${i % 2 ? " z" : ""}${open ? " open" : ""}" data-key="${esc(c.key)}" tabindex="0" aria-expanded="${open}">
            <td class="c-chev">${CHEV}</td>
            <td class="c-ct l"><b class="ct-num">#${esc(c.contrato)}</b>${c.cod_fornecedor ? `<span class="ct-cod">Forn. ${esc(c.cod_fornecedor)}</span>` : ""}</td>
            <td class="c-desc l"><span class="ct-forn"${c.fornecedor ? ` title="${esc(c.fornecedor)}"` : ""}>${c.fornecedor ? esc(c.fornecedor) : "Fornecedor não informado"}</span><span class="ct-obj"${c.objeto ? ` title="${esc(c.objeto)}"` : ""}>${c.objeto ? esc(c.objeto) : "Sem objeto"}</span></td>
            <td class="c-itens r" data-l="Itens">${c.n_itens}</td>
            <td class="c-val r" data-l="Valor">${money(c.valor, "strong")}</td>
            <td class="c-med l" data-l="Medido">${money(c.medido)}${bar(c.pct)}</td>
            <td class="c-saldo r" data-l="Saldo"${c.saldo_calc ? ' title="Contrato sem medição: saldo = valor do contrato − medido"' : ""}>${money(c.saldo, c.saldo < 0 ? "neg" : c.saldo > 0.005 ? "strong" : "")}</td>
            <td class="c-st l">${situacaoBadge(c.situacao)}<span class="ct-status ${statusTone(c.status)}">${esc(statusLabel(c.status))}</span></td>
          </tr>${open ? `<tr class="ct-exp" data-exp="${esc(c.key)}"><td colspan="8">${itensHTML(c, words)}</td></tr>` : ""}`;
        }).join("")}</tbody></table></div>
      </section>`;
    });
    list.innerHTML = html;
    syncExpandAll();
  }

  function syncExpandAll() {
    const all = view.length > 0 && view.every((c) => expanded.has(c.key));
    const b = $("ctExpandAll");
    b.setAttribute("aria-pressed", String(all));
    b.querySelector("span").textContent = all ? "Recolher todos" : "Expandir todos";
  }

  const toggleRow = (key) => { expanded.has(key) ? expanded.delete(key) : expanded.add(key); renderList(); root.querySelector(`tr.ct-row[data-key="${CSS.escape(key)}"]`)?.focus({ preventScroll: true }); };
  $("ctList").addEventListener("click", (e) => { const tr = e.target.closest("tr.ct-row"); if (tr) toggleRow(tr.dataset.key); });
  $("ctList").addEventListener("keydown", (e) => {
    const tr = e.target.closest("tr.ct-row"); if (!tr) return;
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleRow(tr.dataset.key); }
  });

  function render() {
    view = applyFilters(contratos, f);
    // Busca por serviço: abre os contratos com itens encontrados (mesmo comportamento da busca por material).
    const words = servicoWords(f);
    if (words.length) view.forEach((c) => { if (c.itens.some((i) => itemHit(i, words))) expanded.add(c.key); });
    $("ctCount").textContent = `${view.length} contrato(s)`;
    renderKpis(); renderActive(); renderList();
  }

  render();
  return { render, filters: f };
}
