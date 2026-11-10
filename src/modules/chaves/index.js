// Aba "Controle de Chaves" das Vistorias: onde está a chave de cada unidade e quem é o responsável.
//
// Montada pela tela de Vistorias (www/index.html), que fornece o contexto (`host`): cliente Supabase,
// condomínio aberto, unidades (as mesmas do Mapa das Vistorias), status da vistoria de cada unidade
// (client_inspections, só leitura) e o papel do usuário. A situação vem de chaves_unidades, as chaves
// perdidas de chaves_ocorrencias e o histórico de chaves_movimentacoes (RLS por condomínio); toda
// gravação passa pelas funções chaves_* do banco.
// Fluxos: unidade → Transferir → setor → quem recebe → Confirmar
//         unidade → Marcar chave perdida → Solicitar chaveiro → Registrar cópia → Regularizar chave
import * as M from "./model.js";
import * as S from "./service.js";
import { info as rcInfo } from "../revistoria-cliente/model.js";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const FILTRO0 = () => ({ bloco: "ALL", apto: "", setor: [], vistoria: "", perdida: "" });
const pad = (n) => String(n).padStart(2, "0");
const fmtDH = (ts) => { if (!ts) return "—"; const d = new Date(ts); return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const novoPedido = () => (crypto.randomUUID ? crypto.randomUUID() : "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) => (c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))).toString(16)));
const pill = (setor, extra = "") => { const s = M.SETORES[setor] || M.SETORES.sem; return `<span class="ch-spill${extra}" style="--c:${s.cor};--b:${s.borda};--t:${s.texto}">${esc(s.label)}</span>`; };
// Status da Vistoria e da Revistoria · Cliente (só leitura: lidos das próprias tabelas pela tela de Vistorias).
const vistBadge = (c) => { const vc = host.vistoriaCor(c); return `<span class="ch-vpill" style="background:${vc.bg};color:${vc.tx};border-color:${vc.bd}">${esc(host.vistoriaLabel(c))}</span>`; };
const revBadge = (st) => { if (!st) return '<span class="ch-mut">—</span>'; const i = rcInfo(st); return `<span class="rc-badge sm" style="--c:${i.cor};--b:${i.borda}">${esc(i.label)}</span>`; };
const etapaPill = (etapa) => `<span class="ch-epill e-${etapa}">${esc(M.ETAPAS[etapa]?.label || etapa)}</span>`;
const SETA = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>`;
const ICONE = {
  transferir: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h14M14 4l4 4-4 4M20 16H6M10 12l-4 4 4 4"/></svg>`,
  historico: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/></svg>`,
  perdida: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="8" cy="15" r="4"/><path d="M10.8 12.2 17 6M3 3l18 18"/></svg>`,
  chaveiro: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18v3h3l6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.8-2.8z"/></svg>`,
  copia: `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M4 16V6a2 2 0 0 1 2-2h10"/></svg>`,
  regularizar: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>`
};
// Formulários do painel: botão que abre, botão de confirmar e campos.
const FORMS = {
  transferir: { botao: "Transferir", ok: "Confirmar transferência", setor: "Setor de destino", nome: "Responsável que está recebendo a chave", obs: false },
  perdida: { botao: "Marcar chave perdida", ok: "Confirmar chave perdida", nome: "Responsável pelo registro", obs: "Motivo da ocorrência (opcional)", obsPh: "Ex.: extraviada pelo cliente, quebrou na fechadura, não devolvida…", padraoNome: true },
  chaveiro: { botao: "Solicitar chaveiro", ok: "Confirmar solicitação", nome: "Quem solicitou o chaveiro", obs: "Observação (opcional)", obsPh: "Chaveiro, contato, previsão…", padraoNome: true },
  copia: { botao: "Registrar cópia", ok: "Confirmar cópia realizada", nome: "Responsável pelo registro da cópia", obs: "Observação (opcional)", obsPh: "Ex.: 2 cópias, testada na porta", padraoNome: true },
  regularizar: { botao: "Regularizar chave", ok: "Regularizar chave", setor: "Setor que ficará com a nova chave", nome: "Responsável que está recebendo a chave", obs: "Observação (opcional)", obsPh: "Ex.: chave encontrada, cópia entregue à Base" }
};

let host = null, root = null, projId = null, estado = "idle", erroMsg = "", dados = null, cancelar = null, filt = FILTRO0(), nomes = [];
let modo = "mapa", sit = new Map();
let pop = null, fundo = null, cur = null, painel = "", hist = null, ocupado = false, aviso = null, pedido = null, recarga = null;

/* ── dados ── */
async function carregar(silencioso = false) {
  if (!host?.sb || !host.project) return;
  const pid = host.project.id;
  if (!silencioso) { estado = "carregando"; pintar(); }
  try {
    const d = await S.carregarCondominio(host.sb, pid);
    if (pid !== host.project?.id) return;
    dados = d; estado = "ok"; erroMsg = "";
    const oc = new Map(d.ocorrencias.map((o) => [o.unit_id, o]));
    sit = new Map(d.unidades.map((r) => [r.unit_id, M.situacao(r, oc.get(r.unit_id))]));
    pintar();
    if (cur) pintarPopup();
    S.nomesUsados(host.sb, pid).then((n) => { nomes = n; }).catch(() => {});
  } catch (err) {
    console.error(err);
    estado = S.naoInstalado(err) ? "nao-instalado" : "erro"; erroMsg = err.message || "";
    pintar();
  }
}
function agendarRecarga() { clearTimeout(recarga); recarga = setTimeout(() => { carregar(true); if (cur && painel === "historico") carregarHistorico(); }, 400); }

function unidade(u) {
  const unitId = host.unitId(u.b, u.p, u.a);
  return { ...u, unitId, codigo: host.codigo(u.b, u.p, u.a), titulo: host.titulo(u.b, u.p, u.a), vistoria: host.vistoria(u.b, u.p, u.a), revistoria: host.revistoria?.(u.b, u.p, u.a) || "", situacao: sit.get(unitId) || M.situacao(null) };
}
const todasUnidades = () => host.units().filter((u) => host.unitId(u.b, u.p, u.a)).map(unidade);
const podeMovimentar = () => ["admin", "revistorias"].includes(host?.papel());
const perdasOk = () => dados?.perdasInstalado !== false;
const nomeUnidade = (u) => (host.casa() ? `Casa ${+u.a}` : `Apto ${u.codigo}`);
const localUnidade = (u) => (host.casa() ? `Conjunto ${u.b}` : `Bloco ${u.b} · ${host.grid().pavLabel[u.p] || u.p}`);
/** Ações disponíveis para a unidade (na ordem dos botões). */
function acoes(u) {
  if (!podeMovimentar()) return [];
  const o = u.situacao.perdida;
  if (o) return M.proximosPassos(o.etapa);
  return perdasOk() ? ["transferir", "perdida"] : ["transferir"];
}

/* ── tela ── */
function casca() {
  const projetos = host.projetos();
  const vist = host.vistoriaCodigos();
  root.innerHTML = `
    <div class="ch-top" id="chKpis"></div>
    <div class="clif ch-filters">
      <div class="ch-line">
        ${projetos.length > 1 ? `<label class="fx-field fx-sel ch-f-cond"><span>Condomínio</span><select id="chCond" aria-label="Condomínio">${projetos.map((p) => `<option value="${esc(p.id)}"${p.id === host.project.id ? " selected" : ""}>${esc(p.name)}</option>`).join("")}</select></label>` : ""}
        <label class="fx-field fx-sel"><span>${esc(host.grupo())}</span><select id="chBloco" aria-label="${esc(host.grupo())}"><option value="ALL">Todos</option>${host.grupos().map((b) => `<option value="${esc(b)}">${esc(b)}</option>`).join("")}</select></label>
        <label class="fx-field ch-f-apto"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg><input id="chApto" type="search" placeholder="${host.casa() ? "Casa" : "Unidade (ex.: 604 ou A604)"}" aria-label="Buscar unidade" autocomplete="off"></label>
        <label class="fx-field fx-sel"><span>Status</span><select id="chVist" aria-label="Status da vistoria"><option value="">Todos</option>${vist.map((c) => `<option value="${c}">${esc(host.vistoriaLabel(c))}</option>`).join("")}</select></label>
        <div class="modetog ch-modo" role="tablist" aria-label="Visualização"><button type="button" data-modo="mapa">Mapa</button><button type="button" data-modo="lista">Lista</button></div>
      </div>
      <div class="ch-line ch-chips">
        <span class="clif-lbl">Setor</span>
        ${M.STATUS_ORDEM.map((s) => `<button type="button" class="fchip ch-st" data-st="${s}" style="--c:${M.SETORES[s].borda}"><i></i>${M.SETORES[s].label}</button>`).join("")}
        ${perdasOk() ? `<span class="ch-sep" aria-hidden="true"></span><span class="clif-lbl">Chave perdida</span>
        ${[M.PERDIDAS_TODAS, "perdida", "chaveiro_solicitado", "copia_realizada"].map((e) => `<button type="button" class="fchip ch-pf" data-perd="${e}" style="--c:#b33636"><i></i>${e === M.PERDIDAS_TODAS ? "Todas pendentes" : M.ETAPAS[e].label}</button>`).join("")}` : ""}
        <span class="ch-count" id="chCount"></span>
        <button type="button" class="btn g ch-clear" id="chLimpar">Limpar</button>
      </div>
    </div>
    <div id="chGrid" class="ch-grid"></div>`;
  root.dataset.proj = String(host.project.id);
  root.dataset.perdas = String(perdasOk());
  const q = (id) => root.querySelector(id);
  q("#chCond")?.addEventListener("change", (e) => host.trocarCondominio(e.target.value));
  q("#chBloco").addEventListener("change", (e) => { filt.bloco = e.target.value; pintarConteudo(); });
  q("#chApto").addEventListener("input", (e) => { filt.apto = e.target.value.trim(); pintarConteudo(); });
  q("#chVist").addEventListener("change", (e) => { filt.vistoria = e.target.value; pintarConteudo(); });
  q("#chLimpar").addEventListener("click", () => { filt = FILTRO0(); sincronizarFiltros(); pintarConteudo(); });
  if (!root.dataset.ouvindo) { root.addEventListener("click", cliqueRaiz); root.dataset.ouvindo = "1"; }
}
function sincronizarFiltros() {
  const q = (id) => root.querySelector(id);
  if (!q("#chBloco")) return;
  q("#chBloco").value = filt.bloco; q("#chApto").value = filt.apto; q("#chVist").value = filt.vistoria;
  root.querySelectorAll(".ch-st").forEach((b) => b.classList.toggle("active", filt.setor.includes(b.dataset.st)));
  root.querySelectorAll(".ch-pf").forEach((b) => b.classList.toggle("active", filt.perdida === b.dataset.perd));
  root.querySelectorAll("[data-modo]").forEach((b) => { const on = b.dataset.modo === modo; b.classList.toggle("active", on); b.setAttribute("aria-selected", String(on)); });
}
function cliqueRaiz(e) {
  const u = e.target.closest("[data-chu]");
  if (u) { e.stopPropagation(); abrir(u.dataset.b, u.dataset.p, u.dataset.a, u, u.dataset.acao || ""); return; }
  const pf = e.target.closest(".ch-pf,[data-kpi-perd]");
  if (pf) { const v = pf.dataset.perd || M.PERDIDAS_TODAS; filt.perdida = filt.perdida === v ? "" : v; sincronizarFiltros(); pintarConteudo(); return; }
  const st = e.target.closest(".ch-st,[data-kpi]");
  if (st) { const s = st.dataset.st || st.dataset.kpi; filt.setor = st.matches("[data-kpi]") ? (filt.setor.length === 1 && filt.setor[0] === s ? [] : [s]) : filt.setor.includes(s) ? filt.setor.filter((x) => x !== s) : [...filt.setor, s]; sincronizarFiltros(); pintarConteudo(); return; }
  const md = e.target.closest("[data-modo]");
  if (md) { modo = md.dataset.modo; sincronizarFiltros(); pintarConteudo(); return; }
  if (e.target.closest("[data-retry]")) carregar(false);
}

function pintar() {
  if (!root || !host) return;
  if (estado === "carregando" && !dados) { root.innerHTML = `<div class="ch-state"><div class="ch-spin" aria-hidden="true"></div><b>Carregando as chaves…</b></div>`; delete root.dataset.proj; return; }
  if (estado === "nao-instalado") { root.innerHTML = `<div class="ch-state"><b>O novo Controle de Chaves ainda não foi instalado no banco.</b><span>Aplique a migration <code>20261103120000_chaves_transferencia_simples.sql</code> e recarregue.</span></div>`; delete root.dataset.proj; return; }
  if (estado === "erro" && !dados) { root.innerHTML = `<div class="ch-state"><b>Não foi possível carregar as chaves.</b><span>${esc(erroMsg)}</span><button type="button" class="btn g" data-retry>Tentar de novo</button></div>`; delete root.dataset.proj; root.onclick = (e) => { if (e.target.closest("[data-retry]")) carregar(false); }; return; }
  if (!dados) return;
  if (root.dataset.proj !== String(host.project.id) || root.dataset.perdas !== String(perdasOk())) { casca(); sincronizarFiltros(); }
  pintarConteudo();
}

function pintarConteudo() {
  const lista = todasUnidades();
  const vis = lista.filter((u) => M.passaFiltros(u, filt));
  const ok = new Set(vis.map((u) => u.unitId));
  const ind = M.indicadores(lista, dados.hoje);
  root.querySelector("#chKpis").innerHTML = M.STATUS_ORDEM.map((s) =>
    `<button type="button" class="ch-kpi${filt.setor.length === 1 && filt.setor[0] === s ? " on" : ""}" data-kpi="${s}" style="--c:${M.SETORES[s].borda}" title="Mostrar só ${esc(M.SETORES[s].label)}"><b>${ind[s]}</b><span>${M.SETORES[s].label}</span></button>`).join("") +
    (perdasOk() ? `<button type="button" class="ch-kpi k-perd${filt.perdida === M.PERDIDAS_TODAS ? " on" : ""}${ind.perdidas ? " alerta" : ""}" data-kpi-perd title="Chaves perdidas aguardando chaveiro, cópia ou regularização"><b>${ind.perdidas}</b><span>Chaves perdidas</span></button>` : "") +
    `<div class="ch-kpi k-hoje" title="Transferências registradas hoje no condomínio"><b>${ind.hoje}</b><span>Transferências hoje</span></div>`;
  root.querySelector("#chCount").textContent = ok.size !== lista.length ? `${ok.size} de ${lista.length} unidade(s)` : `${lista.length} unidade(s)`;
  root.querySelector("#chGrid").innerHTML = modo === "lista" ? htmlLista(vis) : htmlMapa(lista, ok);
}

function htmlMapa(lista, ok) {
  const porId = new Map(lista.map((u) => [`${u.b}|${u.p}|${u.a}`, u]));
  const btn = (b, p, a) => {
    const u = porId.get(`${b}|${p}|${a}`);
    if (!u) return `<span class="apt ch-u ch-void"></span>`;
    const st = u.situacao, s = M.SETORES[st.setor], o = st.perdida;
    const tip = [u.titulo, o ? `Chave perdida · ${M.ETAPAS[o.etapa].label}` : st.setor === "sem" ? "Chave: sem status" : `Chave: ${s.label}${st.responsavel ? " com " + st.responsavel : ""}`,
      st.movimentadoEm ? `desde ${fmtDH(st.movimentadoEm)}` : "", `Vistoria: ${host.vistoriaLabel(u.vistoria)}`, u.revistoria ? `Revistoria · Cliente: ${rcInfo(u.revistoria).label}` : ""].filter(Boolean).join(" · ");
    const cls = ["apt", "ch-u", o ? `lost e-${o.etapa}` : "", ok.has(u.unitId) ? "" : "off", cur?.unitId === u.unitId ? "is-sel" : ""].filter(Boolean).join(" ");
    return `<button type="button" class="${cls}" data-chu data-b="${esc(b)}" data-p="${esc(p)}" data-a="${esc(a)}" title="${esc(tip)}" aria-label="${esc(tip)}" style="background:${s.cor};color:${s.texto};border-color:${s.borda}">${esc(host.codigo(b, p, a))}</button>`;
  };
  const g = host.grid();
  let h;
  if (host.casa()) {
    const grupos = filt.bloco !== "ALL" ? [filt.bloco] : g.grupos;
    const cols = Array.from({ length: g.maxCasas }, (_, i) => i + 1);
    h = `<div class="gridscroll casa-scroll"><table class="mx casas ch-mx"><thead><tr><th class="corner">CONJ.</th>${cols.map((n) => `<th class="casah">${n}</th>`).join("")}</tr></thead><tbody>` +
      grupos.map((b) => `<tr><td class="pavh">${esc(b)}</td>${cols.map((n) => n <= (g.counts[b] || 0) ? `<td class="casa-cell">${btn(b, "", pad(n))}</td>` : `<td class="casa-void"></td>`).join("")}</tr>`).join("") + "</tbody></table></div>";
  } else if (filt.bloco !== "ALL") {
    h = `<div class="single ch-single"><div class="ch-single-h">${esc(host.grupo())} ${esc(filt.bloco)}</div>` + g.pavs.map((p) => `<div class="pavrow"><div class="pl">${esc(g.pavLabel[p])}</div><div class="pa">${g.apts.map((a) => btn(filt.bloco, p, a)).join("")}</div></div>`).join("") + "</div>";
  } else {
    h = `<div class="gridscroll"><table class="mx ch-mx"><thead><tr><th class="corner">PAV</th>${g.grupos.map((b) => `<th class="blkh">${esc(b)}</th>`).join("")}</tr></thead><tbody>` +
      g.pavs.map((p) => `<tr><td class="pavh">${esc(g.pavLabel[p].toUpperCase())}</td>${g.grupos.map((b) => `<td class="cell"><div class="apts">${g.apts.map((a) => btn(b, p, a)).join("")}</div></td>`).join("")}</tr>`).join("") + "</tbody></table></div>";
  }
  return h + `<div class="legend ch-legend">${M.STATUS_ORDEM.map((s) => `<div class="lg"><span class="sw" style="background:${M.SETORES[s].cor};border-color:${M.SETORES[s].borda}"></span>${M.SETORES[s].label}</div>`).join("")}
    ${perdasOk() ? `<div class="lg"><span class="sw ch-sw-lost"></span>Sem status · chave perdida (aguardando chaveiro, cópia ou regularização)</div>` : ""}
    <div class="lg ch-lg-dica">Toque na unidade para ver, transferir ou consultar o histórico</div>
    ${window.AmciCores ? `<button type="button" class="btn g ch-mini lg-cores" data-cores title="${host.papel() === "admin" ? "Personalizar as cores das legendas (vale para todos os módulos)" : "Ver as cores das legendas"}">${host.papel() === "admin" ? "Personalizar cores" : "Cores das legendas"}</button>` : ""}</div>`;
}

function htmlLista(vis) {
  if (!vis.length) return `<div class="clif-empty">Nenhuma unidade encontrada com esses filtros.</div>`;
  const g = host.grid(), gi = (b) => (g.grupos || []).indexOf(b), pi = (p) => -(g.pavs || []).indexOf(p);
  // lista: bloco a bloco, do térreo para cima (o mapa mostra o 6º pavimento no topo)
  vis = [...vis].sort((x, y) => gi(x.b) - gi(y.b) || pi(x.p) - pi(y.p) || String(x.a).localeCompare(String(y.a), "pt-BR", { numeric: true }));
  const linha = (u) => {
    const st = u.situacao, o = st.perdida, attrs = `data-chu data-b="${esc(u.b)}" data-p="${esc(u.p)}" data-a="${esc(u.a)}"`;
    const ac = acoes(u);
    const principal = o ? (ac.length ? `<button type="button" class="btn p ch-mini ch-mini-lost" ${attrs} data-acao="${ac[0]}">${FORMS[ac[0]].botao}</button>` : "")
      : ac.includes("transferir") ? `<button type="button" class="btn p ch-mini" ${attrs} data-acao="transferir">Transferir</button>` : "";
    return `<tr class="${cur?.unitId === u.unitId ? "is-sel" : ""}${o ? " lost" : ""}">
      <td class="ch-c-un"><b>${esc(host.casa() ? `Conj. ${u.b} · Casa ${+u.a}` : `Bloco ${u.b} · ${u.codigo}`)}</b></td>
      <td class="ch-c-vst">${vistBadge(u.vistoria)}</td>
      <td class="ch-c-rc">${revBadge(u.revistoria)}</td>
      <td class="ch-c-st">${pill(st.setor)}${o ? etapaPill(o.etapa) : ""}</td>
      <td class="ch-c-resp">${o ? `<span class="ch-mut">${o.responsavel_anterior ? `antes: ${esc(o.responsavel_anterior)}` : "—"}</span>` : esc(st.responsavel) || '<span class="ch-mut">—</span>'}</td>
      <td class="ch-c-dt">${st.movimentadoEm ? `${fmtDH(st.movimentadoEm)}${st.movimentadoPor ? `<small>${esc(st.movimentadoPor)}</small>` : ""}` : '<span class="ch-mut">—</span>'}</td>
      <td class="ch-c-ac">${principal}<button type="button" class="btn g ch-mini" ${attrs} data-acao="historico">Histórico</button></td>
    </tr>`;
  };
  return `<div class="gridscroll ch-tblw"><table class="ctbl ch-tbl"><thead><tr><th class="th-cli">Unidade</th><th>Status vistoria</th><th>Revistoria · Cliente</th><th>Setor atual</th><th class="th-cli">Responsável</th><th>Última movimentação</th><th>Ação</th></tr></thead><tbody>${vis.map(linha).join("")}</tbody></table></div>`;
}

/* ── painel da unidade ── */
function garantirPopup() {
  if (pop) return;
  fundo = document.createElement("div"); fundo.className = "pop-backdrop ch-backdrop"; document.body.appendChild(fundo);
  pop = document.createElement("div"); pop.className = "pop pp ch-pop"; pop.id = "chPop"; pop.setAttribute("role", "dialog"); pop.tabIndex = -1;
  document.body.appendChild(pop);
  fundo.addEventListener("click", () => fechar());
  pop.addEventListener("click", cliquePopup);
  const editou = (e) => { if (!e.target.closest(".ch-form") || ocupado) return; aviso = null; const m = pop.querySelector(".ch-msg"); if (m) { m.textContent = ""; m.className = "pp-hint ch-msg"; } mostrarResumo(); };
  pop.addEventListener("input", editou);
  pop.addEventListener("change", editou);
  pop.addEventListener("submit", (e) => { e.preventDefault(); enviar(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && pop.classList.contains("open")) fechar(); });
  // clique fora fecha (pelo caminho do evento: o alvo pode ter sido redesenhado dentro do painel)
  document.addEventListener("click", (e) => { const path = e.composedPath(); if (pop.classList.contains("open") && !path.includes(pop) && !path.some((n) => n.matches?.("[data-chu],.toast")) && !fundo.classList.contains("show")) fechar(); });
  addEventListener("resize", () => posicionar());
}
const folha = () => matchMedia("(max-width:720px)").matches;
function posicionar(ancora) {
  if (!pop?.classList.contains("open")) return;
  const sheet = folha(); pop.classList.toggle("sheet", sheet); fundo.classList.toggle("show", sheet);
  if (sheet) { pop.style.left = ""; pop.style.top = ""; return; }
  const t = ancora && ancora.isConnected ? ancora : root.querySelector(`.ch-u[data-b="${CSS.escape(cur.b)}"][data-p="${CSS.escape(cur.p)}"][data-a="${CSS.escape(cur.a)}"]`);
  const pw = pop.offsetWidth, ph = pop.offsetHeight;
  let x = (innerWidth - pw) / 2, y = (innerHeight - ph) / 2;
  if (t) { const r = t.getBoundingClientRect(); x = r.left; y = r.bottom + 6; if (x + pw > innerWidth - 8) x = innerWidth - pw - 8; if (y + ph > innerHeight - 8) y = r.top - ph - 6; if (y < 8) y = Math.max(8, innerHeight - ph - 8); }
  pop.style.left = Math.max(8, x) + "px"; pop.style.top = Math.max(8, y) + "px";
}
const preenchendo = () => !!FORMS[painel] && !!pop?.querySelector(".ch-form")?.dataset.dirty;
function abrir(b, p, a, ancora, acao = "") {
  if (cur && preenchendo() && !(cur.b === b && cur.p === p && cur.a === a) && !confirm("Descartar o registro em andamento?")) return;
  garantirPopup();
  const u = todasUnidades().find((x) => x.b === b && x.p === p && x.a === a);
  if (!u) return;
  const mesma = cur?.unitId === u.unitId;
  cur = { b, p, a, unitId: u.unitId };
  if (!mesma) { hist = null; aviso = null; pedido = null; }
  painel = FORMS[acao] && acoes(u).includes(acao) ? acao : acao === "historico" ? "historico" : mesma ? painel : "";
  if (FORMS[painel] && !pedido) pedido = novoPedido();
  pintarPopup();
  pop.classList.add("open"); posicionar(ancora);
  root.querySelectorAll(".is-sel").forEach((x) => x.classList.remove("is-sel")); if (ancora?.classList.contains("ch-u")) ancora.classList.add("is-sel");
  if (FORMS[painel]) focarForm(); else if (!folha()) pop.focus({ preventScroll: true });
  if (painel === "historico") carregarHistorico();
}
function focarForm() { const f = pop.querySelector(".ch-form"); (f?.querySelector('input[name="setor"]') || f?.querySelector("textarea,input"))?.focus({ preventScroll: true }); }
function fechar() {
  if (!pop?.classList.contains("open")) return;
  if (preenchendo() && !confirm("Descartar o registro em andamento?")) return;
  pop.classList.remove("open", "sheet"); fundo.classList.remove("show"); cur = null; painel = ""; pedido = null; aviso = null;
  root?.querySelectorAll(".is-sel").forEach((x) => x.classList.remove("is-sel"));
}
async function carregarHistorico() {
  const id = cur?.unitId; if (!id) return;
  try { const h = await S.historico(host.sb, id); if (cur?.unitId === id) { hist = h; pintarHistorico(); } }
  catch (err) { if (cur?.unitId === id) { hist = { erro: err.message }; pintarHistorico(); } }
}

/** Cartão da chave perdida: desde quando, quem identificou, motivo e as 4 etapas. */
function htmlPerdida(o) {
  const i = M.ETAPAS_ORDEM.indexOf(o.etapa);
  const quando = { perdida: o.registrado_em, chaveiro_solicitado: o.chaveiro_em, copia_realizada: o.copia_em };
  const quem = { perdida: o.identificado_por, chaveiro_solicitado: o.chaveiro_por, copia_realizada: o.copia_por };
  return `<div class="ch-lost-card" role="status">
      <div class="ch-lost-h">${ICONE.perdida}<b>Chave perdida · sem status</b>${etapaPill(o.etapa)}</div>
      <div class="ch-lost-t">Desde ${fmtDH(o.registrado_em)}${o.identificado_por ? ` · identificado por ${esc(o.identificado_por)}` : ""}${o.setor_anterior ? ` · estava com ${esc(M.setorLabel(o.setor_anterior))}${o.responsavel_anterior ? ` (${esc(o.responsavel_anterior)})` : ""}` : ""}</div>
      ${o.motivo ? `<div class="ch-lost-m">Motivo: ${esc(o.motivo)}</div>` : ""}
      <ol class="ch-steps">${M.ETAPAS_ORDEM.map((e, k) => `<li class="${k < i ? "done" : k === i ? "cur" : ""}"><i></i><span>${esc(M.ETAPAS[e].label)}</span>${quando[e] && k <= i ? `<small>${fmtDH(quando[e])}${quem[e] ? ` · ${esc(quem[e])}` : ""}</small>` : ""}</li>`).join("")}</ol>
    </div>`;
}

function pintarPopup() {
  if (!cur || !pop) return;
  const u = todasUnidades().find((x) => x.unitId === cur.unitId);
  if (!u) { fechar(); return; }
  const st = u.situacao, o = st.perdida, vc = host.vistoriaCor(u.vistoria), ac = acoes(u);
  if (FORMS[painel] && !ac.includes(painel)) { painel = ""; pedido = null; }   // ex.: outra pessoa já registrou este passo
  const lista = host.units(), i = lista.findIndex((x) => x.b === u.b && x.p === u.p && x.a === u.a);
  const prev = FORMS[painel] ? capturarForm() : null;
  pop.setAttribute("aria-label", `${nomeUnidade(u)} · Controle de chaves`);
  const botoes = [...ac.map((a) => `<button type="button" class="btn ${painel === a ? "p" : "g"} ch-act${a === "perdida" ? " ch-act-lost" : ""}" data-painel="${a}" aria-pressed="${painel === a}">${ICONE[a]}${FORMS[a].botao}</button>`),
    `<button type="button" class="btn ${painel === "historico" ? "p" : "g"} ch-act" data-painel="historico" aria-pressed="${painel === "historico"}">${ICONE.historico}Histórico</button>`].join("");
  pop.innerHTML = `
    <div class="pp-head">
      <div class="pp-title"><small>${esc(host.project.name)} · ${esc(localUnidade(u))}</small><strong>${esc(nomeUnidade(u))}</strong></div>
      <div class="pp-tools">
        <button type="button" class="pp-icon" data-nav="-1" ${i <= 0 ? "disabled" : ""} aria-label="Unidade anterior">‹</button>
        <button type="button" class="pp-icon" data-nav="1" ${i >= lista.length - 1 ? "disabled" : ""} aria-label="Próxima unidade">›</button>
        <button type="button" class="pp-icon" data-close aria-label="Fechar">×</button>
      </div>
    </div>
    <div class="pp-body ch-body">
      ${o ? htmlPerdida(o) : ""}
      <div class="ch-now">
        <div class="ch-now-st"><span>Setor atual</span>${pill(st.setor, " lg")}</div>
        <div><span>Responsável</span><b>${esc(st.responsavel) || "—"}</b></div>
        <div><span>Última movimentação</span><b>${st.movimentadoEm ? fmtDH(st.movimentadoEm) : "—"}</b>${st.movimentadoPor ? `<small>por ${esc(st.movimentadoPor)}</small>` : ""}</div>
        <div><span>Status da vistoria</span><b class="ch-vpill" style="background:${vc.bg};color:${vc.tx};border-color:${vc.bd}">${esc(host.vistoriaLabel(u.vistoria))}</b></div>
        ${host.revistoriaInstalada?.() ? `<div><span>Revistoria · Cliente</span>${revBadge(u.revistoria)}</div>` : ""}
      </div>
      <div class="ch-btns">${botoes}</div>
      ${!podeMovimentar() ? `<div class="pp-ro">Seu acesso a este condomínio é de consulta: transferências e chaves perdidas são registradas por administradores e pela equipe de revistorias.</div>` : ""}
      ${FORMS[painel] ? htmlForm(u, painel) : ""}
      ${painel === "historico" ? `<div class="ch-hist"><div class="pp-label">Histórico de movimentações</div><div id="chHist" class="ch-hist-body"></div></div>` : ""}
    </div>`;
  if (prev && prev.tipo === painel) restaurarForm(prev);
  if (FORMS[painel]) mostrarResumo();
  if (painel === "historico") pintarHistorico();
  if (aviso) mostrarAviso(aviso.msg, aviso.tipo);
}
function htmlForm(u, tipo) {
  const F = FORMS[tipo], st = u.situacao, usuario = host.usuario()?.nome || "";
  const setores = F.setor ? `<div class="pp-f pp-full"><span>${esc(F.setor)}</span><div class="ch-setores" role="radiogroup" aria-label="${esc(F.setor)}">${M.SETORES_DESTINO.map((s) =>
    `<label class="ch-setor" style="--c:${M.SETORES[s].cor}"><input type="radio" name="setor" value="${s}"><span><i></i>${M.SETORES[s].label}${tipo === "transferir" && st.setor === s ? "<small>atual</small>" : tipo === "regularizar" && st.perdida?.setor_anterior === s ? "<small>anterior</small>" : ""}</span></label>`).join("")}</div></div>` : "";
  const obs = F.obs ? `<label class="pp-f pp-full"><span>${esc(F.obs)}</span><textarea name="obs" rows="2" maxlength="500" placeholder="${esc(F.obsPh || "")}"></textarea></label>` : "";
  const nota = tipo === "perdida" ? `<p class="ch-nota pp-full">A unidade passa a <b>Sem status</b> e sai da responsabilidade de ${st.setor !== "sem" ? `<b>${esc(M.setorLabel(st.setor))}</b>${st.responsavel ? ` (${esc(st.responsavel)})` : ""}` : "qualquer setor"} até a chave ser regularizada. O status da vistoria não muda.</p>`
    : tipo === "regularizar" ? `<p class="ch-nota pp-full">A nova chave volta ao controle normal no setor escolhido. O histórico da ocorrência fica guardado.</p>` : "";
  return `<form class="ch-form" data-tipo="${tipo}" novalidate>
      ${obs && tipo === "perdida" ? obs : ""}${setores}
      <label class="pp-f pp-full"><span>${esc(F.nome)}</span><input name="responsavel" list="chNomes" placeholder="Nome" autocomplete="off" maxlength="80" value="${F.padraoNome ? esc(usuario) : ""}" required><datalist id="chNomes">${nomes.map((n) => `<option value="${esc(n)}"></option>`).join("")}</datalist></label>
      ${obs && tipo !== "perdida" ? obs : ""}
      ${F.setor ? `<div class="ch-resumo pp-full" aria-live="polite"></div>` : ""}
      ${nota}<p class="ch-nota pp-full ch-auto">Data, hora e usuário são registrados automaticamente.</p>
      <div class="pp-actions pp-full"><span class="pp-hint ch-msg" role="status"></span><button type="button" class="btn g" data-painel="">Cancelar</button><button type="submit" class="btn p${tipo === "perdida" ? " ch-btn-lost" : ""}"${ocupado ? " disabled" : ""}>${ocupado ? "Registrando…" : esc(F.ok)}</button></div>
    </form>`;
}
function capturarForm() {
  const f = pop?.querySelector(".ch-form"); if (!f) return null;
  return { tipo: f.dataset.tipo, setor: f.querySelector('input[name="setor"]:checked')?.value || "", responsavel: f.elements.responsavel?.value || "", obs: f.elements.obs?.value || "", dirty: !!f.dataset.dirty };
}
function restaurarForm(s) {
  const f = pop.querySelector(".ch-form"); if (!f) return;
  if (s.setor) { const r = f.querySelector(`input[name="setor"][value="${s.setor}"]`); if (r) r.checked = true; }
  f.elements.responsavel.value = s.responsavel; if (f.elements.obs) f.elements.obs.value = s.obs; if (s.dirty) f.dataset.dirty = "1";
}
/** Resumo do que será gravado: "CX (Pedro) → Asstec (Ana)". */
function mostrarResumo() {
  const f = pop?.querySelector(".ch-form"); if (!f) return;
  const v = capturarForm(); if (v.setor || v.obs.trim() || ((f.dataset.tipo === "transferir" || f.dataset.tipo === "regularizar") && v.responsavel.trim())) f.dataset.dirty = "1";
  const el = f.querySelector(".ch-resumo"); if (!el) return;
  const u = todasUnidades().find((x) => x.unitId === cur.unitId), st = u.situacao, nome = M.limparNome(v.responsavel);
  el.innerHTML = `${pill(st.setor)}${st.responsavel ? `<em>${esc(st.responsavel)}</em>` : st.perdida ? "<em>chave perdida</em>" : ""}${SETA}${v.setor ? pill(v.setor) : '<span class="ch-mut">setor</span>'}${nome ? `<em>${esc(nome)}</em>` : '<span class="ch-mut">quem recebe</span>'}`;
}
function pintarHistorico() {
  const el = pop?.querySelector("#chHist"); if (!el) return;
  if (!hist) { el.innerHTML = '<div class="ch-hist-empty">Carregando…</div>'; return; }
  if (hist.erro) { el.innerHTML = `<div class="ch-hist-empty">Não foi possível carregar o histórico.</div>`; return; }
  if (!hist.length) { el.innerHTML = '<div class="ch-hist-empty">Nenhuma movimentação registrada para esta unidade.</div>'; return; }
  el.innerHTML = `<ol class="ch-hist-l">${hist.map((m) => {
    const d = M.descreverMov(m);
    const rota = d.de ? `${pill(d.de)}${SETA}${pill(d.para)}` : d.para ? pill(d.para) : "";
    const quem = [d.recebeu ? `${esc(d.quemRotulo)}: <b>${esc(d.recebeu)}</b>` : "", d.anterior ? `Antes: ${esc(d.anterior)}` : ""].filter(Boolean).join(" · ");
    const cor = d.ocorrencia && m.tipo !== "regularizacao" ? "#b33636" : (M.SETORES[d.para] || M.SETORES.sem).borda;
    return `<li class="${d.ocorrencia ? "t-oc t-" + m.tipo : ""}" style="--c:${cor}"><div class="ch-h1"><b>${esc(d.titulo)}</b><span class="ch-rota">${rota}</span><time>${fmtDH(d.quando)}</time></div>
      ${quem ? `<div class="ch-h2">${quem}</div>` : ""}${d.obs && m.tipo !== "transferencia" ? `<div class="ch-h3">${m.tipo === "perda" ? "Motivo: " : ""}${esc(d.obs)}</div>` : ""}
      <div class="ch-h4">Registrado por ${esc(d.por)}</div></li>`;
  }).join("")}</ol>`;
}
function mostrarAviso(msg, tipo = "err") {
  aviso = { msg, tipo }; const el = pop?.querySelector(".ch-msg"); if (el) { el.textContent = msg; el.className = `pp-hint ch-msg ${tipo}`; }
}

function cliquePopup(e) {
  const t = e.target;
  if (t.closest("[data-close]")) { fechar(); return; }
  const nav = t.closest("[data-nav]");
  if (nav) {
    const l = host.units(), i = l.findIndex((x) => x.b === cur.b && x.p === cur.p && x.a === cur.a), n = l[i + Number(nav.dataset.nav)];
    if (n) { if (preenchendo() && !confirm("Descartar o registro em andamento?")) return; painel = ""; pop.querySelector(".ch-form")?.removeAttribute("data-dirty"); const anc = root.querySelector(`.ch-u[data-b="${CSS.escape(n.b)}"][data-p="${CSS.escape(n.p)}"][data-a="${CSS.escape(n.a)}"]`); abrir(n.b, n.p, n.a, anc); }
    return;
  }
  const pn = t.closest("[data-painel]");
  if (pn) {
    const alvo = pn.dataset.painel === painel ? "" : pn.dataset.painel;
    if (FORMS[painel] && alvo !== painel && preenchendo() && !confirm("Descartar o registro em andamento?")) return;
    painel = alvo; aviso = null; pedido = FORMS[painel] ? novoPedido() : null;
    pintarPopup(); posicionar();
    if (painel === "historico") carregarHistorico();
    if (FORMS[painel]) focarForm();
  }
}

async function enviar() {
  if (ocupado || !cur || !FORMS[painel]) return;
  const tipo = painel, u = todasUnidades().find((x) => x.unitId === cur.unitId), v = capturarForm(), nome = M.limparNome(v.responsavel);
  const erro = tipo === "transferir" ? M.validarTransferencia(v, u.situacao) : tipo === "regularizar" ? M.validarRegularizacao(v)
    : M.validarNome(v.responsavel, FORMS[tipo].nome.toLowerCase());
  if (erro) { mostrarAviso(erro); return; }
  // o mesmo pedido em novas tentativas (clique duplo, rede instável): o banco não grava duas vezes
  pedido = pedido || novoPedido();
  ocupado = true; mostrarAviso("Registrando…", "info");
  const f = pop.querySelector(".ch-form"), b0 = f.querySelector("[type=submit]"); b0.disabled = true; b0.textContent = "Registrando…";
  const args = { unitId: u.unitId, setor: v.setor, responsavel: nome, obs: v.obs.trim(), ultimaMov: u.situacao.ultimaMov, pedido };
  const fazer = { transferir: () => S.transferir(host.sb, args), perdida: () => S.marcarPerdida(host.sb, args), regularizar: () => S.regularizar(host.sb, args),
    chaveiro: () => S.andamento(host.sb, { ...args, etapa: "chaveiro_solicitado" }), copia: () => S.andamento(host.sb, { ...args, etapa: "copia_realizada" }) }[tipo];
  const msgOk = { transferir: `Chave transferida para ${M.setorLabel(v.setor)} · ${nome}`, perdida: "Chave registrada como perdida (sem status)", chaveiro: "Chaveiro solicitado",
    copia: "Cópia registrada", regularizar: `Chave regularizada: ${M.setorLabel(v.setor)} · ${nome}` }[tipo];
  try {
    await fazer();
    ocupado = false; pedido = null; aviso = null; painel = "historico"; hist = null;
    host.toast(msgOk);
    await carregar(true);
    pintarPopup(); carregarHistorico();
  } catch (err) {
    ocupado = false;
    const rede = /fetch|network|rede|failed/i.test(err.message || "");
    if (!rede) pedido = novoPedido();   // recusado pelo banco: a próxima tentativa é um novo pedido
    mostrarAviso(err.message || "Não foi possível registrar.");
    const b = pop.querySelector(".ch-form [type=submit]"); if (b) { b.disabled = false; b.textContent = FORMS[tipo].ok; }
    // ex.: outra pessoa movimentou a chave: mostra a situação atual (e o aviso, se o formulário continuar aberto)
    if (!rede) { const msg = aviso; await carregar(true); if (pop.querySelector(".ch-form") && msg) mostrarAviso(msg.msg, msg.tipo); else if (msg) host.toast(msg.msg); }
  }
}

/* ── API para a tela de Vistorias ── */
// Cores centralizadas: aplicadas nos setores e repintadas quando o Admin muda (inclusive em outro aparelho).
let ouvindoCores = false;
function coresMudaram(cfg) {
  M.aplicarCores(cfg);
  if (!root?.isConnected || !host) return;
  delete root.dataset.proj;   // chips e indicadores com as cores novas
  if (dados) pintar();
  if (cur && !preenchendo()) pintarPopup();
}
function abrirCores(e) {
  if (!e.target.closest("[data-cores]")) return;
  window.AmciCores?.abrirEditor({ admin: host?.papel() === "admin", aba: "setores", rotulos: Object.fromEntries(Object.entries(M.SETORES).map(([k, s]) => [k, s.label])) });
}

const api = {
  /** Mostra a aba (chamado ao abrir a aba Chaves). */
  show(h) {
    host = h; root = document.getElementById("chavesRoot");
    if (!root || !host.project) return;
    M.aplicarCores(window.AmciCores?.get());
    if (!ouvindoCores && window.AmciCores) { window.AmciCores.on(coresMudaram); ouvindoCores = true; }
    if (!root.dataset.ouveCores) { root.addEventListener("click", abrirCores); root.dataset.ouveCores = "1"; }   // não usar data-cores aqui: é o seletor do botão
    if (projId !== host.project.id) {
      cancelar?.(); cancelar = null; dados = null; filt = FILTRO0(); nomes = []; projId = host.project.id; estado = "idle"; sit = new Map(); delete root.dataset.proj;
      if (pop?.classList.contains("open")) { pop.querySelector(".ch-form")?.removeAttribute("data-dirty"); fechar(); }
    }
    if (!cancelar && host.sb) { try { cancelar = S.assinar(host.sb, projId, agendarRecarga); } catch { cancelar = null; } }
    if (!dados) carregar(false); else { pintar(); carregar(true); }
  },
  /** Esconde (troca de aba). */
  hide() { if (pop?.classList.contains("open")) fechar(); },
  /** Status da vistoria mudou (tempo real das vistorias): atualiza lista, filtros e painel. */
  vistoriaMudou() { if (dados && root?.isConnected && root.offsetParent) { pintarConteudo(); if (cur && !preenchendo()) pintarPopup(); } },
  /** Saiu do condomínio ou da conta. */
  reset() { cancelar?.(); cancelar = null; dados = null; projId = null; sit = new Map(); if (pop) { pop.querySelector(".ch-form")?.removeAttribute("data-dirty"); fechar(); } if (root) { root.innerHTML = ""; delete root.dataset.proj; } }
};
window.AmciChaves = api;
export default api;
