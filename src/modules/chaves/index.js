// Aba "Controle de Chaves" das Vistorias: claviculário digital por condomínio.
//
// Montada pela tela de Vistorias (www/index.html), que fornece o contexto (`host`): cliente Supabase,
// condomínio aberto, layout das unidades (o mesmo do Mapa das Vistorias), status da vistoria de cada
// unidade (client_inspections, só leitura) e o papel do usuário. Os dados de chaves vêm das tabelas
// chaves_* (RLS por condomínio); toda gravação passa pelas funções chaves_* do banco, que validam
// permissão, disponibilidade de cada chave e concorrência. Nada recarrega a página.
import * as M from "./model.js";
import * as S from "./service.js";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const FILTRO0 = () => ({ bloco: "ALL", apto: "", status: [], tipologia: "ALL", vistoria: [], situacao: "", rapido: "" });
const pad = (n) => String(n).padStart(2, "0");
const localInput = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
const fmtDH = (ts) => { if (!ts) return "—"; const d = new Date(ts); return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${String(d.getFullYear()).slice(2)} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const ISO = (v) => (v ? new Date(v).toISOString() : null);
const novoPedido = () => (crypto.randomUUID ? crypto.randomUUID() : "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) => (c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))).toString(16)));

let host = null, root = null, projId = null, estado = "idle", erroMsg = "", dados = null, cancelar = null, filt = FILTRO0(), nomes = [];
let idx = { quartos: new Map(), cad: new Map(), chaves: new Map() };
let pop = null, fundo = null, cur = null, aba = "", sel = new Set(), hist = null, ocupado = false, aviso = "";
let recarga = null;

/* ── dados ── */
async function carregar(silencioso = false) {
  if (!host?.sb || !host.project) return;
  const pid = host.project.id;
  if (!silencioso) { estado = "carregando"; pintar(); }
  try {
    const d = await S.carregarCondominio(host.sb, pid);
    if (pid !== host.project?.id) return;
    dados = d; estado = "ok"; erroMsg = "";
    idx = { quartos: new Map(d.unidades.map((u) => [u.id, u.quartos])), cad: new Map(d.cadastros.map((c) => [c.unit_id, c])), chaves: new Map() };
    d.chaves.forEach((k) => { if (!idx.chaves.has(k.unit_id)) idx.chaves.set(k.unit_id, []); idx.chaves.get(k.unit_id).push(k); });
    pintar();
    if (cur) pintarPopup(false);
    S.nomesUsados(host.sb, pid).then((n) => { nomes = n; }).catch(() => {});
  } catch (err) {
    console.error(err);
    estado = S.naoInstalado(err) ? "nao-instalado" : "erro"; erroMsg = err.message || "";
    pintar();
  }
}
function agendarRecarga() { clearTimeout(recarga); recarga = setTimeout(() => carregar(true), 400); }

function unidade(u) {
  const unitId = host.unitId(u.b, u.p, u.a);
  const chaves = idx.chaves.get(unitId) || [];
  const quartos = idx.quartos.get(unitId) ?? null;
  return { ...u, unitId, bloco: u.b, pav: u.p, apto: u.a, codigo: host.codigo(u.b, u.p, u.a), quartos, chaves,
    cadastro: idx.cad.get(unitId) || null, vistoria: host.vistoria(u.b, u.p, u.a),
    resumo: M.resumoUnidade(idx.cad.get(unitId), chaves, quartos) };
}
const todasUnidades = () => host.units().filter((u) => host.unitId(u.b, u.p, u.a)).map(unidade);
const pode = { mover: () => ["admin", "revistorias"].includes(host?.papel()), cadastrar: () => host?.papel() === "admin" };

/* ── tela ── */
function casca() {
  const projetos = host.projetos();
  const vist = host.vistoriaCodigos();
  root.innerHTML = `
    <div class="ch-top" id="chKpis"></div>
    <div class="ch-alert" id="chAlert" hidden></div>
    <div class="clif ch-filters">
      <div class="ch-line">
        ${projetos.length > 1 ? `<label class="fx-field fx-sel ch-f-cond"><span>Condomínio</span><select id="chCond" aria-label="Condomínio">${projetos.map((p) => `<option value="${esc(p.id)}"${p.id === host.project.id ? " selected" : ""}>${esc(p.name)}</option>`).join("")}</select></label>` : ""}
        <label class="fx-field fx-sel"><span>${esc(host.grupo())}</span><select id="chBloco" aria-label="${esc(host.grupo())}"><option value="ALL">Todos</option>${host.grupos().map((b) => `<option value="${esc(b)}">${esc(b)}</option>`).join("")}</select></label>
        <label class="fx-field ch-f-apto"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg><input id="chApto" type="search" inputmode="text" placeholder="${host.casa() ? "Casa" : "Apto (ex.: 604 ou A604)"}" aria-label="Buscar unidade" autocomplete="off"></label>
        ${host.casa() ? "" : `<label class="fx-field fx-sel"><span>Tipologia</span><select id="chTipo"><option value="ALL">Todas</option><option value="2">2 quartos</option><option value="3">3 quartos</option><option value="ni">Não informada</option></select></label>`}
        <label class="fx-field fx-sel"><span>Vistoria</span><select id="chVist"><option value="">Todos</option>${vist.map((c) => `<option value="${c}">${esc(host.vistoriaLabel(c))}</option>`).join("")}</select></label>
        <label class="fx-field fx-sel"><span>Chaves</span><select id="chSit"><option value="">Todas</option>${Object.entries(M.SITUACOES).map(([k, l]) => `<option value="${k}">${esc(l)}</option>`).join("")}</select></label>
      </div>
      <div class="ch-line ch-chips">
        <span class="clif-lbl">Setor</span>
        ${M.STATUS_ORDEM.map((s) => `<button type="button" class="fchip ch-st" data-st="${s}" style="--c:${M.SETORES[s].borda}"><i></i>${M.SETORES[s].label}</button>`).join("")}
        <span class="ch-sep" aria-hidden="true"></span>
        <button type="button" class="fchip ch-rap" data-rap="aprovada-disponivel">Aprovadas com chaves disponíveis</button>
        <button type="button" class="fchip ch-rap" data-rap="aguardando">Aguardando vistoria ou revistoria</button>
        <span class="ch-count" id="chCount"></span>
        <button type="button" class="btn g ch-clear" id="chLimpar">Limpar</button>
      </div>
    </div>
    <div id="chGrid" class="ch-grid"></div>
    <div class="legend ch-legend">
      ${M.STATUS_ORDEM.map((s) => `<div class="lg"><span class="sw" style="background:${M.SETORES[s].cor};border-color:${M.SETORES[s].borda}"></span>${M.SETORES[s].label}</div>`).join("")}
      <div class="lg"><span class="ch-mk pend"></span>Devolução pendente</div>
      <div class="lg"><span class="ch-mk div"></span>Divergência</div>
      <div class="lg"><span class="ch-mk parc"></span>Retirada parcial</div>
      <div class="lg"><span class="ch-mk cad"></span>Quantidades a cadastrar</div>
      <div class="lg"><span class="ch-mk vb"></span>Barra inferior: status da vistoria</div>
    </div>`;
  root.dataset.proj = String(host.project.id);
  const q = (id) => root.querySelector(id);
  q("#chCond")?.addEventListener("change", (e) => host.trocarCondominio(e.target.value));
  q("#chBloco").addEventListener("change", (e) => { filt.bloco = e.target.value; pintarMapa(); });
  q("#chApto").addEventListener("input", (e) => { filt.apto = e.target.value.trim(); pintarMapa(); });
  q("#chTipo")?.addEventListener("change", (e) => { filt.tipologia = e.target.value; pintarMapa(); });
  q("#chVist").addEventListener("change", (e) => { filt.vistoria = e.target.value ? [e.target.value] : []; pintarMapa(); });
  q("#chSit").addEventListener("change", (e) => { filt.situacao = e.target.value; pintarMapa(); });
  q("#chLimpar").addEventListener("click", () => { filt = FILTRO0(); sincronizarFiltros(); pintarMapa(); });
  root.addEventListener("click", cliqueRaiz);
}
function sincronizarFiltros() {
  const q = (id) => root.querySelector(id);
  if (!q("#chBloco")) return;
  q("#chBloco").value = filt.bloco; q("#chApto").value = filt.apto; if (q("#chTipo")) q("#chTipo").value = filt.tipologia;
  q("#chVist").value = filt.vistoria[0] || ""; q("#chSit").value = filt.situacao;
  root.querySelectorAll(".ch-st").forEach((b) => b.classList.toggle("active", filt.status.includes(b.dataset.st)));
  root.querySelectorAll(".ch-rap").forEach((b) => b.classList.toggle("active", filt.rapido === b.dataset.rap));
}
function cliqueRaiz(e) {
  const u = e.target.closest("[data-chu]");
  if (u) { e.stopPropagation(); abrir(u.dataset.b, u.dataset.p, u.dataset.a, u); return; }
  const st = e.target.closest(".ch-st");
  if (st) { const s = st.dataset.st; filt.status = filt.status.includes(s) ? filt.status.filter((x) => x !== s) : [...filt.status, s]; sincronizarFiltros(); pintarMapa(); return; }
  const rap = e.target.closest(".ch-rap");
  if (rap) { filt.rapido = filt.rapido === rap.dataset.rap ? "" : rap.dataset.rap; sincronizarFiltros(); pintarMapa(); return; }
  const kpi = e.target.closest("[data-kpi]");
  if (kpi) { filt = { ...FILTRO0(), situacao: kpi.dataset.kpi }; sincronizarFiltros(); pintarMapa(); root.querySelector("#chGrid")?.scrollIntoView({ behavior: "smooth", block: "start" }); return; }
  if (e.target.closest("[data-retry]")) carregar(false);
}

function pintar() {
  if (!root || !host) return;
  if (estado === "carregando" && !dados) { root.innerHTML = `<div class="ch-state"><div class="ch-spin" aria-hidden="true"></div><b>Carregando o claviculário…</b></div>`; delete root.dataset.proj; return; }
  if (estado === "nao-instalado") { root.innerHTML = `<div class="ch-state"><b>O Controle de Chaves ainda não foi instalado no banco.</b><span>Aplique a migration <code>20261024120000_controle_chaves.sql</code> (supabase db push) e recarregue.</span></div>`; delete root.dataset.proj; return; }
  if (estado === "erro" && !dados) { root.innerHTML = `<div class="ch-state"><b>Não foi possível carregar as chaves.</b><span>${esc(erroMsg)}</span><button type="button" class="btn g" data-retry>Tentar de novo</button></div>`; delete root.dataset.proj; root.onclick = (e) => { if (e.target.closest("[data-retry]")) carregar(false); }; return; }
  if (!dados) return;
  if (root.dataset.proj !== String(host.project.id)) { casca(); sincronizarFiltros(); }
  pintarMapa();
}

function pintarMapa() {
  const lista = todasUnidades();
  const ok = new Set(lista.filter((u) => M.passaFiltros(u, filt)).map((u) => u.unitId));
  const ind = M.indicadores(lista, dados.movsHoje);
  const k = (id, n, l, cls = "", tip = "") => `<button type="button" class="ch-kpi${cls}"${id ? ` data-kpi="${id}"` : ""} title="${esc(tip || l)}"><b>${n}</b><span>${l}</span></button>`;
  root.querySelector("#chKpis").innerHTML =
    k("", ind.total, host.casa() ? "Casas" : "Apartamentos", " k-total", "Unidades cadastradas no condomínio") +
    k("disponivel", ind.disponiveis, "Todas as chaves na Base", " k-base") +
    k("retirada", ind.retiradas, "Com chaves retiradas", " k-ret") +
    k("pendente", ind.pendentes, "Devoluções pendentes", ind.pendentes ? " k-alert" : "", "Previsão de devolução vencida") +
    k("sem", ind.semStatus, "Sem status", " k-sem") +
    k("", ind.movsHoje, "Movimentações hoje", " k-hoje", "Retiradas, devoluções e transferências registradas hoje");
  const al = root.querySelector("#chAlert");
  const partes = [];
  if (ind.pendentes) partes.push(`<button type="button" data-kpi="pendente"><b>${ind.pendentes}</b> ${ind.pendentes > 1 ? "unidades com devolução pendente" : "unidade com devolução pendente"}</button>`);
  if (ind.divergentes) partes.push(`<button type="button" data-kpi="divergencia"><b>${ind.divergentes}</b> ${ind.divergentes > 1 ? "unidades com divergência" : "unidade com divergência"}</button>`);
  if (ind.aCadastrar) partes.push(`<button type="button" data-kpi="cadastrar"><b>${ind.aCadastrar}</b> com quantidades a cadastrar</button>`);
  al.hidden = !partes.length;
  al.innerHTML = partes.length ? `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 2 21h20L12 3z"/><path d="M12 10v5M12 18h.01"/></svg>${partes.join("<span>·</span>")}` : "";
  const filtrando = ok.size !== lista.length;
  root.querySelector("#chCount").textContent = filtrando ? `${ok.size} de ${lista.length} unidade(s)` : `${lista.length} unidade(s)`;
  const porId = new Map(lista.map((u) => [`${u.b}|${u.p}|${u.a}`, u]));
  const btn = (b, p, a) => {
    const u = porId.get(`${b}|${p}|${a}`);
    if (!u) return `<span class="apt ch-u ch-void"></span>`;
    const r = u.resumo, s = M.SETORES[r.status], vc = host.vistoriaCor(u.vistoria);
    const bg = r.parcial ? `linear-gradient(135deg,${s.cor} 0 58%,${M.SETORES.base.cor} 58% 100%)` : s.cor;
    const tip = [host.titulo(b, p, a), `Chaves: ${s.label}${r.parcial ? " (parcial)" : ""}${r.aCadastrar ? " · quantidades a cadastrar" : r.total ? ` · ${r.naBase}/${r.total} na Base` : ""}`,
      r.pendente ? "Devolução pendente" : "", r.divergente ? "Divergência: " + r.divergencias.join("; ") : "", `Vistoria: ${host.vistoriaLabel(u.vistoria)}`].filter(Boolean).join(" · ");
    const cls = ["apt", "ch-u", r.pendente ? "pend" : "", r.divergente ? "div" : "", r.aCadastrar ? "cad" : "", ok.has(u.unitId) ? "" : "off", cur?.unitId === u.unitId ? "is-sel" : ""].filter(Boolean).join(" ");
    return `<button type="button" class="${cls}" data-chu data-b="${esc(b)}" data-p="${esc(p)}" data-a="${esc(a)}" title="${esc(tip)}" aria-label="${esc(tip)}" style="background:${bg};color:${s.texto};border-color:${s.borda}">${esc(host.casa() ? +a : a)}<i class="vb" style="background:${vc.bg};border-color:${vc.bd}"></i></button>`;
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
  root.querySelector("#chGrid").innerHTML = h;
}

/* ── popup ── */
function garantirPopup() {
  if (pop) return;
  fundo = document.createElement("div"); fundo.className = "pop-backdrop ch-backdrop"; document.body.appendChild(fundo);
  pop = document.createElement("div"); pop.className = "pop pp ch-pop"; pop.id = "chPop"; pop.setAttribute("role", "dialog"); pop.tabIndex = -1;
  document.body.appendChild(pop);
  fundo.addEventListener("click", () => fechar());
  pop.addEventListener("click", cliquePopup);
  pop.addEventListener("input", (e) => { if (e.target.closest(".ch-form")) aviso = ""; });
  pop.addEventListener("change", mudancaPopup);
  pop.addEventListener("submit", (e) => { e.preventDefault(); enviar(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && pop.classList.contains("open") && !document.querySelector(".ch-dlg[open]")) fechar(); });
  // clique fora fecha (pelo caminho do evento: o alvo pode ter sido redesenhado dentro do popup)
  document.addEventListener("click", (e) => { const path = e.composedPath(); if (pop.classList.contains("open") && !path.includes(pop) && !path.some((n) => n.matches?.("[data-chu],.ch-dlg,.toast")) && !fundo.classList.contains("show")) fechar(); });
  addEventListener("resize", () => posicionar());
}
const folha = () => matchMedia("(max-width:720px)").matches;
function posicionar(ancora) {
  if (!pop?.classList.contains("open")) return;
  const sheet = folha(); pop.classList.toggle("sheet", sheet); fundo.classList.toggle("show", sheet);
  if (sheet) { pop.style.left = ""; pop.style.top = ""; return; }
  const t = ancora && ancora.isConnected ? ancora : root.querySelector(`[data-chu][data-b="${CSS.escape(cur.b)}"][data-p="${CSS.escape(cur.p)}"][data-a="${CSS.escape(cur.a)}"]`);
  const pw = pop.offsetWidth, ph = pop.offsetHeight;
  let x = (innerWidth - pw) / 2, y = (innerHeight - ph) / 2;
  if (t) { const r = t.getBoundingClientRect(); x = r.left; y = r.bottom + 6; if (x + pw > innerWidth - 8) x = innerWidth - pw - 8; if (y + ph > innerHeight - 8) y = r.top - ph - 6; if (y < 8) y = Math.max(8, innerHeight - ph - 8); }
  pop.style.left = Math.max(8, x) + "px"; pop.style.top = Math.max(8, y) + "px";
}
function abrir(b, p, a, ancora) {
  if (cur && dirty() && !confirm("Há um registro em andamento nesta unidade. Descartar?")) return;
  garantirPopup();
  const u = todasUnidades().find((x) => x.b === b && x.p === p && x.a === a);
  if (!u) return;
  cur = { b, p, a, unitId: u.unitId }; sel = new Set(); hist = null; aviso = "";
  aba = abaPadrao(u);
  pintarPopup(true);
  pop.classList.add("open"); posicionar(ancora);
  root.querySelectorAll(".ch-u.is-sel").forEach((x) => x.classList.remove("is-sel")); ancora?.classList.add("is-sel");
  if (!folha()) pop.focus({ preventScroll: true });
  carregarHistorico();
}
function fechar() {
  if (!pop?.classList.contains("open")) return;
  if (dirty() && !confirm("Há um registro em andamento nesta unidade. Descartar?")) return;
  pop.classList.remove("open", "sheet"); fundo.classList.remove("show"); cur = null; sel = new Set();
  root?.querySelectorAll(".ch-u.is-sel").forEach((x) => x.classList.remove("is-sel"));
}
const dirty = () => !!pop?.querySelector(".ch-form[data-dirty]");
function abaPadrao(u) {
  const r = u.resumo;
  if ((r.aCadastrar || (!r.total && !r.extraviadas)) && pode.cadastrar()) return "cadastro";
  if (r.fora && (r.pendente || !r.naBase)) return "devolver";
  if (r.naBase) return "retirar";
  if (r.fora) return "devolver";
  return pode.cadastrar() ? "cadastro" : "historico";
}
async function carregarHistorico() {
  const id = cur?.unitId; if (!id) return;
  try { const h = await S.historico(host.sb, id); if (cur?.unitId === id) { hist = h; pintarHistorico(); } }
  catch (err) { if (cur?.unitId === id) { hist = { erro: err.message }; pintarHistorico(); } }
}

function pintarPopup(reset) {
  if (!cur || !pop) return;
  const u = todasUnidades().find((x) => x.unitId === cur.unitId);
  if (!u) { fechar(); return; }
  const r = u.resumo, s = M.SETORES[r.status], itens = M.itensDaUnidade(u.chaves);
  const lista = host.units(), i = lista.findIndex((x) => x.b === u.b && x.p === u.p && x.a === u.a);
  const vc = host.vistoriaCor(u.vistoria), vi = host.vistoriaInfo(u.b, u.p, u.a);
  const kicker = `${esc(host.project.name)} · ${host.casa() ? `Conjunto ${esc(u.b)}` : `Bloco ${esc(u.b)} · ${esc(host.grid().pavLabel[u.p] || u.p)}`}`;
  const nome = host.casa() ? `Casa ${+u.a}` : `Apto ${esc(u.codigo)}`;
  const tipoSel = pode.cadastrar() && !host.casa()
    ? `<select class="ch-tipo-sel" data-tipologia aria-label="Tipologia"><option value=""${u.quartos ? "" : " selected"}>Não informada</option>${[1, 2, 3, 4].map((n) => `<option value="${n}"${u.quartos === n ? " selected" : ""}>${n} quarto${n > 1 ? "s" : ""}</option>`).join("")}</select>`
    : `<b>${esc(M.tipologiaLabel(u.quartos))}</b>`;
  const statusTxt = r.aCadastrar ? "Na Base · quantidades a cadastrar" : r.status === "sem" ? "Sem status (nenhuma chave cadastrada)"
    : r.fora ? `${r.fora} de ${r.total} retirada${r.fora > 1 ? "s" : ""} · ${r.setoresFora.map((x) => M.SETORES[x].label).join(", ")}${r.responsaveis.length ? " com " + r.responsaveis.join(", ") : ""}`
    : `${r.total} chave${r.total > 1 ? "s" : ""} na Base`;
  const alertas = [
    r.pendente ? `<div class="ch-warn"><b>Devolução pendente:</b> ${r.atrasadas} chave(s) com previsão vencida${r.proxPrevisao ? ` (desde ${fmtDH(r.proxPrevisao)})` : ""}.</div>` : "",
    r.divergente ? `<div class="ch-warn div"><b>Divergência:</b> ${esc(r.divergencias.join("; "))}.</div>` : ""
  ].join("");
  const prevForm = !reset ? capturarForm() : null;
  pop.setAttribute("aria-label", `${nome} · Controle de chaves`);
  pop.innerHTML = `
    <div class="pp-head">
      <div class="pp-title"><small>${kicker}</small><strong>${nome}</strong></div>
      <div class="pp-tools">
        <button type="button" class="pp-icon" data-nav="-1" ${i <= 0 ? "disabled" : ""} aria-label="Unidade anterior">‹</button>
        <button type="button" class="pp-icon" data-nav="1" ${i >= lista.length - 1 ? "disabled" : ""} aria-label="Próxima unidade">›</button>
        <button type="button" class="pp-icon" data-close aria-label="Fechar">×</button>
      </div>
    </div>
    <div class="pp-body ch-body">
      <div class="ch-id">
        <div><span>Tipologia</span>${tipoSel}</div>
        <div><span>Vistoria</span><b class="ch-vpill" style="background:${vc.bg};color:${vc.tx};border-color:${vc.bd}">${esc(host.vistoriaLabel(u.vistoria))}</b>${vi?.data_vistoria ? `<small>${esc(host.fmtData(vi.data_vistoria))}</small>` : ""}</div>
        <div class="ch-id-st"><span>Chaves</span><b class="ch-spill" style="background:${s.cor};color:${s.texto};border-color:${s.borda}">${s.label}${r.parcial ? " · parcial" : ""}</b><small>${esc(statusTxt)}</small></div>
      </div>
      ${alertas}
      <div class="pp-label">Chaves da unidade</div>
      ${itens.length ? `<div class="ch-itens">${itens.map((it) => `<div class="ch-item ${it.situacao}"><span class="ch-item-n">${esc(it.rotulo)}</span><span class="ch-copias">${it.copias.map((k) => chipChave(k, null)).join("")}</span><span class="ch-item-s">${it.total ? `${it.base}/${it.total} na Base` : "extraviada"}</span></div>`).join("")}</div>`
        : `<div class="ch-empty">${r.aCadastrar ? "O levantamento indica chaves na Base, mas as quantidades ainda não foram cadastradas." : "Nenhuma chave cadastrada para esta unidade."}${pode.cadastrar() ? " Use a aba Cadastro." : ""}</div>`}
      ${painelAcoes(u, r)}
      <details class="ch-hist" open><summary class="pp-label">Histórico de movimentações</summary><div id="chHist" class="ch-hist-body"></div></details>
    </div>`;
  if (prevForm) restaurarForm(prevForm);
  pintarHistorico();
  if (aviso) mostrarAviso(aviso);
}
function chipChave(k, modo) {
  const s = M.SETORES[k.situacao === "ativa" ? k.local : "sem"];
  const tip = `${M.rotuloChave(k, true)} · ${k.situacao === "extraviada" ? "extraviada" : k.local === "base" ? "na Base" : `${s.label} com ${k.responsavel || "—"}${k.previsao_devolucao ? ` · devolução prevista ${fmtDH(k.previsao_devolucao)}` : ""}`}`;
  const atras = k.local !== "base" && k.previsao_devolucao && new Date(k.previsao_devolucao) < new Date();
  if (!modo) return `<span class="ch-chip${k.situacao === "extraviada" ? " lost" : ""}${atras ? " late" : ""}" title="${esc(tip)}" style="--c:${s.cor};--b:${s.borda};--t:${s.texto}">${k.copia}</span>`;
  return `<label class="ch-pick${atras ? " late" : ""}" title="${esc(tip)}" style="--c:${s.cor};--b:${s.borda}"><input type="checkbox" value="${k.id}"${sel.has(k.id) ? " checked" : ""}><span>${esc(M.rotuloChave(k))}<small>${[k.copia > 1 || modo === "all" ? `cópia ${k.copia}` : "", k.local !== "base" ? `${M.SETORES[k.local].label}${k.responsavel ? " · " + esc(k.responsavel) : ""}` : ""].filter(Boolean).join(" · ")}</small></span></label>`;
}
function painelAcoes(u, r) {
  if (!pode.mover()) return `<div class="pp-ro">Seu acesso a este condomínio é de consulta: retiradas e devoluções são registradas por administradores e pela equipe de revistorias.</div>`;
  const ativas = u.chaves.filter((k) => k.situacao === "ativa").sort(M.ordenarChaves);
  const naBase = ativas.filter((k) => k.local === "base"), fora = ativas.filter((k) => k.local !== "base");
  const tabs = [["retirar", "Retirar", naBase.length], ["devolver", "Devolver", fora.length], ["transferir", "Transferir", fora.length], ["ocorrencia", "Ocorrência", true]];
  if (pode.cadastrar()) tabs.push(["cadastro", "Cadastro", true]);
  if (!tabs.some(([id, , ok]) => id === aba && ok)) aba = (tabs.find(([, , ok]) => ok) || ["ocorrencia"])[0];
  const pick = (ks, modo) => ks.length ? `<div class="ch-picks"><button type="button" class="pp-chip ch-all" data-all>Selecionar todas</button>${ks.map((k) => chipChave(k, modo)).join("")}</div>` : "";
  const setor = (nome = "setor") => `<div class="pp-f pp-full"><span>Setor de destino</span><div class="ch-setores" role="radiogroup">${M.SETORES_DESTINO.map((s) => `<label class="ch-setor" style="--c:${M.SETORES[s].cor}"><input type="radio" name="${nome}" value="${s}"><span><i></i>${M.SETORES[s].label}</span></label>`).join("")}</div></div>`;
  const dl = `<datalist id="chNomes">${nomes.map((n) => `<option value="${esc(n)}"></option>`).join("")}</datalist>`;
  const quando = (rotulo, nome = "data") => `<label class="pp-f"><span>${rotulo}</span><input type="datetime-local" name="${nome}" value="${localInput()}" max="${localInput(new Date(Date.now() + 5 * 60e3))}" required></label>`;
  const obs = `<label class="pp-f pp-full"><span>Observações</span><textarea name="obs" rows="2" placeholder="Motivo, combinados, ocorrências…"></textarea></label>`;
  let corpo = "";
  if (aba === "retirar") corpo = `<div class="pp-f pp-full"><span>Chaves a retirar (disponíveis na Base)</span>${pick(naBase, "base")}</div>${setor()}
      <label class="pp-f pp-full"><span>Responsável pela retirada</span><input name="responsavel" list="chNomes" placeholder="Nome de quem retira" autocomplete="off" required>${dl}</label>
      ${quando("Data e hora da retirada")}${quando("Previsão de devolução", "previsao").replace(` value="${localInput()}"`, "").replace(" required", "").replace(/ max="[^"]*"/, "")}${obs}`;
  else if (aba === "devolver") corpo = `<div class="pp-f pp-full"><span>Chaves devolvidas</span>${pick(fora, "fora")}</div>
      <label class="pp-f"><span>Recebido por</span><input name="recebido" list="chNomes" value="${esc(host.usuario().nome || "")}" autocomplete="off" required>${dl}</label>
      ${quando("Data e hora da devolução")}${obs}`;
  else if (aba === "transferir") corpo = `<div class="pp-f pp-full"><span>Chaves transferidas (sem voltar à Base)</span>${pick(fora, "fora")}</div>${setor()}
      <label class="pp-f pp-full"><span>Novo responsável</span><input name="responsavel" list="chNomes" autocomplete="off" required>${dl}</label>
      ${quando("Data e hora")}${quando("Previsão de devolução", "previsao").replace(` value="${localInput()}"`, "").replace(" required", "").replace(/ max="[^"]*"/, "")}${obs}`;
  else if (aba === "ocorrencia") corpo = `<label class="pp-f pp-full"><span>Ocorrência</span><textarea name="texto" rows="3" placeholder="Ex.: cópia quebrada, chave não confere com a porta, extravio…" required></textarea></label>
      ${ativas.length ? `<div class="pp-f pp-full"><span>Marcar como extraviadas (opcional)</span>${pick(ativas, "all")}</div>` : ""}`;
  else if (aba === "cadastro") corpo = formCadastro(u);
  const botao = { retirar: "Registrar retirada", devolver: "Registrar devolução", transferir: "Registrar transferência", ocorrencia: "Registrar ocorrência", cadastro: "Salvar cadastro" }[aba];
  return `<div class="ch-acoes">
      <div class="ch-tabs" role="tablist">${tabs.map(([id, l, okTab]) => `<button type="button" role="tab" class="ch-tab${aba === id ? " active" : ""}" data-aba="${id}" aria-selected="${aba === id}" ${okTab ? "" : "disabled"}>${l}${id === "devolver" && r.pendente ? ' <i class="ch-dot"></i>' : ""}</button>`).join("")}</div>
      <form class="ch-form pp-form" data-aba="${aba}" novalidate>${corpo}
        <div class="pp-actions pp-full"><span class="pp-hint ch-msg" role="status"></span><button type="submit" class="btn p"${ocupado ? " disabled" : ""}>${ocupado ? "Registrando…" : botao}</button></div>
      </form></div>`;
}
function formCadastro(u) {
  const sug = M.cadastroSugerido(u.quartos, u.chaves);
  const q = sug.filter((x) => x.categoria === "quarto"), b = sug.filter((x) => x.categoria === "banheiro"), e = sug.find((x) => x.categoria === "entrada");
  const linha = (x) => `<label class="ch-cad-l"><span>${esc(M.rotuloChave(x))}</span><input type="number" min="0" max="20" name="c-${x.categoria}-${x.comodo}" value="${x.copias}" inputmode="numeric" aria-label="Cópias de ${esc(M.rotuloChave(x))}"></label>`;
  return `<div class="pp-full ch-cad">
      <p class="ch-cad-h">Quantidade de cópias de cada chave. ${u.quartos ? `Tipologia: ${M.tipologiaLabel(u.quartos)}.` : "Tipologia não informada."} Só é possível alterar com todas as chaves na Base.</p>
      <div class="ch-cad-g"><div class="ch-cad-col"><b>Entrada</b>${linha(e)}</div>
        <div class="ch-cad-col"><b>Quartos <span class="ch-cad-n"><button type="button" data-cad="quarto" data-d="-1" aria-label="Menos um quarto">−</button><em>${q.length}</em><button type="button" data-cad="quarto" data-d="1" aria-label="Mais um quarto">+</button></span></b>${q.map(linha).join("")}</div>
        <div class="ch-cad-col"><b>Banheiros <span class="ch-cad-n"><button type="button" data-cad="banheiro" data-d="-1" aria-label="Menos um banheiro">−</button><em>${b.length}</em><button type="button" data-cad="banheiro" data-d="1" aria-label="Mais um banheiro">+</button></span></b>${b.map(linha).join("")}</div></div>
    </div><label class="pp-f pp-full"><span>Observações</span><textarea name="obs" rows="2" placeholder="Ex.: conferido no claviculário em 24/10"></textarea></label>`;
}
function capturarForm() {
  const f = pop?.querySelector(".ch-form"); if (!f || !f.dataset.dirty) return null;
  const v = {}; f.querySelectorAll("input,textarea,select").forEach((el) => { if (!el.name) return; v[el.name + (el.type === "radio" ? ":" + el.value : "")] = el.type === "radio" || el.type === "checkbox" ? el.checked : el.value; });
  return { aba: f.dataset.aba, v };
}
function restaurarForm(s) {
  const f = pop.querySelector(".ch-form"); if (!f || f.dataset.aba !== s.aba) return;
  f.querySelectorAll("input,textarea,select").forEach((el) => { const k = el.name + (el.type === "radio" ? ":" + el.value : ""); if (!(k in s.v)) return; if (el.type === "radio" || el.type === "checkbox") el.checked = s.v[k]; else el.value = s.v[k]; });
  f.dataset.dirty = "1";
}
function pintarHistorico() {
  const el = pop?.querySelector("#chHist"); if (!el) return;
  if (!hist) { el.innerHTML = '<div class="ch-hist-empty">Carregando…</div>'; return; }
  if (hist.erro) { el.innerHTML = `<div class="ch-hist-empty">Não foi possível carregar o histórico.</div>`; return; }
  if (!hist.length) { el.innerHTML = '<div class="ch-hist-empty">Nenhuma movimentação registrada.</div>'; return; }
  el.innerHTML = `<ol class="ch-hist-l">${hist.map((m) => {
    const s = m.setor ? M.SETORES[m.setor] : null;
    const quem = m.tipo === "devolucao" ? `${m.responsavel ? esc(m.responsavel) + " → " : ""}recebido por <b>${esc(m.recebido_por)}</b>` : m.responsavel ? `<b>${esc(m.responsavel)}</b>` : "";
    const ch = Array.isArray(m.chaves) && m.chaves.length ? M.resumoChaves(m.chaves) : "";
    const extra = m.tipo === "transferencia" && m.chaves?.[0]?.de_setor ? ` (de ${M.SETORES[m.chaves[0].de_setor]?.label || ""})` : "";
    return `<li class="t-${m.tipo}"><div class="ch-h1"><b>${M.TIPOS_MOV[m.tipo] || m.tipo}</b>${s && m.tipo !== "cadastro" ? `<span class="ch-hs" style="--c:${s.cor}">${s.label}${extra}</span>` : ""}<time>${fmtDH(m.data_hora)}</time></div>
      ${quem || ch ? `<div class="ch-h2">${quem}${quem && ch ? " · " : ""}${esc(ch)}${m.quantidade > 1 ? ` <small>(${m.quantidade} chaves)</small>` : ""}</div>` : ""}
      ${m.previsao_devolucao ? `<div class="ch-h3">Devolução prevista: ${fmtDH(m.previsao_devolucao)}</div>` : ""}
      ${m.observacoes ? `<div class="ch-h3">${esc(m.observacoes)}</div>` : ""}
      <div class="ch-h4">Registrado por ${esc(m.registrado_email || "sistema")} em ${fmtDH(m.registrado_em)}</div></li>`;
  }).join("")}</ol>`;
}
function mostrarAviso(msg, tipo = "err") {
  aviso = msg; const el = pop?.querySelector(".ch-msg"); if (el) { el.textContent = msg; el.className = `pp-hint ch-msg ${tipo}`; }
}

function cliquePopup(e) {
  const t = e.target;
  if (t.closest("[data-close]")) { fechar(); return; }
  const nav = t.closest("[data-nav]");
  if (nav) { const l = host.units(), i = l.findIndex((x) => x.b === cur.b && x.p === cur.p && x.a === cur.a), n = l[i + Number(nav.dataset.nav)]; if (n) { if (dirty() && !confirm("Descartar o registro em andamento?")) return; pop.querySelector(".ch-form")?.removeAttribute("data-dirty"); const anc = root.querySelector(`[data-chu][data-b="${CSS.escape(n.b)}"][data-p="${CSS.escape(n.p)}"][data-a="${CSS.escape(n.a)}"]`); abrir(n.b, n.p, n.a, anc); } return; }
  const tab = t.closest("[data-aba]:not(form)");
  if (tab && !tab.disabled) { if (dirty() && !confirm("Descartar o registro em andamento?")) return; aba = tab.dataset.aba; sel = new Set(); aviso = ""; pintarPopup(true); return; }
  if (t.closest("[data-all]")) { const box = t.closest(".ch-picks"); const cbs = [...box.querySelectorAll("input[type=checkbox]")]; const todos = cbs.every((c) => c.checked); cbs.forEach((c) => { c.checked = !todos; c.checked ? sel.add(+c.value) : sel.delete(+c.value); }); marcarSujo(); return; }
  const cad = t.closest("[data-cad]");
  if (cad) { ajustarCadastro(cad.dataset.cad, Number(cad.dataset.d)); return; }
}
function marcarSujo() { pop.querySelector(".ch-form")?.setAttribute("data-dirty", "1"); }
async function mudancaPopup(e) {
  const t = e.target;
  if (t.matches(".ch-pick input")) { t.checked ? sel.add(+t.value) : sel.delete(+t.value); }
  if (t.closest(".ch-form")) marcarSujo();
  if (t.matches("[data-tipologia]")) {
    const n = t.value ? Number(t.value) : null, u = todasUnidades().find((x) => x.unitId === cur.unitId);
    if (!(await confirmar("Alterar a tipologia?", `<p>${esc(host.titulo(u.b, u.p, u.a))}: de <b>${esc(M.tipologiaLabel(u.quartos))}</b> para <b>${esc(M.tipologiaLabel(n))}</b>.</p>`, "Alterar"))) { t.value = u.quartos || ""; return; }
    try { await S.definirTipologia(host.sb, { unitIds: [cur.unitId], quartos: n }); idx.quartos.set(cur.unitId, n); host.toast("Tipologia atualizada"); pintarMapa(); pintarPopup(false); }
    catch (err) { t.value = u.quartos || ""; host.toast(err.message); }
  }
}
function ajustarCadastro(cat, d) {
  const f = pop.querySelector(".ch-form"); const col = [...f.querySelectorAll(".ch-cad-col")].find((c) => c.querySelector(`[data-cad="${cat}"]`));
  const linhas = col.querySelectorAll(".ch-cad-l"); const n = linhas.length + d;
  if (n < 0 || n > 9) return;
  if (d < 0 && linhas.length) linhas[linhas.length - 1].remove();
  if (d > 0) col.insertAdjacentHTML("beforeend", `<label class="ch-cad-l"><span>${cat === "quarto" ? "Quarto" : "Banheiro"} ${n}</span><input type="number" min="0" max="20" name="c-${cat}-${n}" value="1" inputmode="numeric"></label>`);
  col.querySelector("em").textContent = n; marcarSujo();
}

/* ── confirmação e envio ── */
function confirmar(titulo, html, ok = "Confirmar") {
  return new Promise((resolve) => {
    const d = document.createElement("dialog"); d.className = "ch-dlg";
    d.innerHTML = `<form method="dialog"><h3>${esc(titulo)}</h3>${html}<div class="ch-dlg-act"><button value="cancelar" class="btn g">Cancelar</button><button value="ok" class="btn p">${esc(ok)}</button></div></form>`;
    document.body.appendChild(d);
    d.addEventListener("close", () => { resolve(d.returnValue === "ok"); d.remove(); });
    d.showModal(); d.querySelector('button[value="ok"]').focus();
  });
}
async function enviar() {
  if (ocupado || !cur) return;
  const f = pop.querySelector(".ch-form"), fd = new FormData(f), u = todasUnidades().find((x) => x.unitId === cur.unitId);
  const ids = [...sel].filter((id) => u.chaves.some((k) => k.id === id));
  const chavesSel = u.chaves.filter((k) => ids.includes(k.id));
  const lista = chavesSel.length ? `<p class="ch-dlg-l">${esc(M.resumoChaves(chavesSel))}</p>` : "";
  const local = host.titulo(u.b, u.p, u.a);
  let erro = "", titulo = "", html = "", fn = null, args = null, okMsg = "";
  const base = { unitId: u.unitId, obs: fd.get("obs") || "" };
  if (aba === "retirar" || aba === "transferir") {
    args = { ...base, ids, setor: fd.get("setor"), responsavel: String(fd.get("responsavel") || "").trim(), dataHora: ISO(fd.get("data")), previsao: ISO(fd.get("previsao")) };
    erro = M.validarSaida(args);
    titulo = aba === "retirar" ? "Confirmar retirada?" : "Confirmar transferência?";
    html = `<p>${esc(local)} → <b>${esc(M.SETORES[args.setor]?.label || "")}</b> com <b>${esc(args.responsavel)}</b>, ${fmtDH(args.dataHora)}${args.previsao ? `; devolução prevista ${fmtDH(args.previsao)}` : ""}.</p>${lista}`;
    fn = aba === "retirar" ? S.retirar : S.transferir; okMsg = aba === "retirar" ? "Retirada registrada" : "Transferência registrada";
  } else if (aba === "devolver") {
    args = { ...base, ids, recebidoPor: String(fd.get("recebido") || "").trim(), dataHora: ISO(fd.get("data")) };
    erro = M.validarDevolucao(args);
    const resta = u.chaves.filter((k) => k.situacao === "ativa" && k.local !== "base").length - ids.length;
    titulo = "Confirmar devolução?";
    html = `<p>${esc(local)}: recebido por <b>${esc(args.recebidoPor)}</b> em ${fmtDH(args.dataHora)}.</p>${lista}${resta > 0 ? `<p class="ch-dlg-w">Devolução parcial: ${resta} chave(s) continuam fora.</p>` : ""}`;
    fn = S.devolver; okMsg = resta > 0 ? "Devolução parcial registrada" : "Devolução registrada";
  } else if (aba === "ocorrencia") {
    args = { ...base, texto: String(fd.get("texto") || "").trim(), ids };
    if (args.texto.length < 3) erro = "Descreva a ocorrência.";
    titulo = "Registrar ocorrência?"; html = `<p>${esc(local)}: ${esc(args.texto)}</p>${ids.length ? `<p class="ch-dlg-w">Marcar como extraviadas: ${esc(M.resumoChaves(chavesSel))}</p>` : ""}`;
    fn = S.ocorrencia; okMsg = "Ocorrência registrada";
  } else if (aba === "cadastro") {
    const itens = []; f.querySelectorAll(".ch-cad-l input").forEach((i) => { const [, cat, com] = i.name.split("-"); const n = Math.max(0, Math.min(20, parseInt(i.value, 10) || 0)); itens.push({ categoria: cat, comodo: Number(com), copias: n }); });
    const total = itens.reduce((s, x) => s + x.copias, 0);
    if (!itens.some((x) => x.categoria === "entrada" && x.copias > 0) && total > 0) erro = "Informe ao menos uma cópia da chave de entrada (ou zere tudo).";
    args = { ...base, itens };
    titulo = "Salvar cadastro das chaves?";
    html = `<p>${esc(local)}: ${total} chave(s) — ${esc(itens.filter((x) => x.copias).map((x) => `${M.rotuloChave(x)} ×${x.copias}`).join(", ") || "nenhuma")}.</p>`;
    fn = S.cadastrar; okMsg = "Cadastro das chaves salvo";
  }
  if (erro) { mostrarAviso(erro); return; }
  if (!(await confirmar(titulo, html))) return;
  // o mesmo pedido_id se repetir a tentativa: o banco não grava duas vezes
  f.dataset.pedido = f.dataset.pedido || novoPedido(); args.pedido = f.dataset.pedido;
  ocupado = true; mostrarAviso("Registrando…", "info"); f.querySelector("[type=submit]").disabled = true;
  try {
    await fn(host.sb, args);
    ocupado = false; sel = new Set(); aviso = "";
    f.removeAttribute("data-dirty");
    host.toast(okMsg);
    await carregar(true);
    hist = null; pintarPopup(true); carregarHistorico();
  } catch (err) {
    ocupado = false; f.querySelector("[type=submit]").disabled = false;
    // a resposta do banco é a regra (ex.: chave já retirada por outro usuário): mostra e atualiza a tela
    mostrarAviso(err.message || "Não foi possível registrar.");
    if (!/fetch|network|rede/i.test(err.message || "")) { delete f.dataset.pedido; carregar(true); }
  }
}

/* ── API para a tela de Vistorias ── */
const api = {
  /** Mostra a aba (chamado ao abrir a aba Chaves). */
  show(h) {
    host = h; root = document.getElementById("chavesRoot");
    if (!root || !host.project) return;
    if (projId !== host.project.id) {
      cancelar?.(); cancelar = null; dados = null; filt = FILTRO0(); nomes = []; projId = host.project.id; estado = "idle"; delete root.dataset.proj;
      if (pop?.classList.contains("open")) { pop.querySelector(".ch-form")?.removeAttribute("data-dirty"); fechar(); }
    }
    if (!cancelar && host.sb) { try { cancelar = S.assinar(host.sb, projId, agendarRecarga); } catch { cancelar = null; } }
    if (!dados) carregar(false); else { pintar(); carregar(true); }
  },
  /** Esconde (troca de aba): fecha o popup sem perder o registro em andamento por engano. */
  hide() { if (pop?.classList.contains("open")) fechar(); },
  /** Status da vistoria mudou (tempo real das vistorias): atualiza cores e popup. */
  vistoriaMudou() { if (dados && root?.isConnected && root.offsetParent) { pintarMapa(); if (cur) pintarPopup(false); } },
  /** Saiu do condomínio ou da conta. */
  reset() { cancelar?.(); cancelar = null; dados = null; projId = null; if (pop) { pop.querySelector(".ch-form")?.removeAttribute("data-dirty"); fechar(); } if (root) { root.innerHTML = ""; delete root.dataset.proj; } }
};
window.AmciChaves = api;
export default api;
