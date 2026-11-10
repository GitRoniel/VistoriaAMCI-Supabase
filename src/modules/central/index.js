// Central Operacional (Resumo Geral): Agenda Operacional unificada, Visão de Produtividade e Central de Unidades,
// para todos os condomínios do usuário. Montada pela tela de Vistorias (www/index.html) em dois lugares: na aba
// Resumo Geral do condomínio e na tela inicial (Central Operacional). Só leitura: as alterações continuam nas
// abas Vistoria · Cliente e Revistoria · Cliente; aqui tudo vem das funções central_* do banco (RLS valendo).
//
// host = { sb, projetos(): [{id,nome,cor,pronto}], hoje(), toast(msg), usuarioId(), vistoriaInfo(statusTexto),
//          abrirNaVistoria(unidade), abrirNaRevistoria(unidade), panorama?: { el, mostrar() } }
import * as M from "./model.js";
import * as S from "./service.js";
import { pintarProdutividade } from "./produtividade.js";
import { abrirUnidade, fecharUnidade, recentes as recentesDe } from "./unidade.js";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
// Ordem da página: Panorama (Vistorias e Revistorias) → Agenda Operacional → Produtividade; Unidades é a pesquisa.
const ABAS = [
  { key: "panorama", label: "Panorama", ic: '<path d="M3 3v18h18"/><path d="M7 15l4-4 3 3 5-6"/>' },
  { key: "agenda", label: "Agenda Operacional", ic: '<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M16 2v4M8 2v4M3 10h18M8 14h3M8 17h6"/>' },
  { key: "produtividade", label: "Produtividade", ic: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>' },
  { key: "unidades", label: "Unidades", ic: '<path d="M3 21V8l9-5 9 5v13"/><path d="M9 21v-7h6v7"/>' }
];

let host = null, root = null, aba = "panorama", filt = M.FILTRO0();
// Agenda: "futuro" (Hoje em diante, padrão ao abrir), "historico" (antes de hoje, do mais recente para o mais
// antigo) ou "periodo" (datas escolhidas). O histórico nunca se mistura com a agenda do dia a dia.
let agModo = "futuro", agPer = { de: "", ate: "" };
let dados = [], janela = null, lim = null, carregando = "", erro = "", semFuncao = false, obs = null, cancelarRT = null, recarga = null, pedido = 0;
let unid = { q: "", res: null, carregando: false, t: null, pedido: 0 };
const prefs = { prod: null };

/* ── preferências por usuário (filtros persistentes) ── */
const chavePrefs = () => `amci.central.${host?.usuarioId?.() || "anon"}`;
function lerPrefs() {
  try {
    const p = JSON.parse(localStorage.getItem(chavePrefs()) || "{}");
    if (p.aba && ABAS.some((a) => a.key === p.aba)) aba = p.aba;
    if (p.filt) filt = { ...M.FILTRO0(), ...p.filt, busca: "" };
    prefs.prod = p.prod || null;
    const validos = new Set(host.projetos().map((x) => String(x.id)));
    filt.projetos = (filt.projetos || []).map(String).filter((id) => validos.has(id));
  } catch { /* navegador sem armazenamento: usa o padrão */ }
}
export function salvarPrefs() {
  try { localStorage.setItem(chavePrefs(), JSON.stringify({ aba, filt: { ...filt, busca: "" }, prod: prefs.prod })); } catch { /* sem armazenamento */ }
}
const projeto = (id) => host.projetos().find((p) => String(p.id) === String(id)) || null;
const nomeProj = (id) => projeto(id)?.nome || "—";
const corProj = (id) => projeto(id)?.cor || "#1f4a3f";
const rotuloUn = (a) => (a.unidade_tipo === "casa" || a.kind === "casa" ? `Conj. ${a.bloco} · Casa ${a.codigo}` : `Bloco ${a.bloco} · ${a.codigo}`);

/* ── casca ── */
function casca() {
  const temPan = !!host.panorama;
  root.innerHTML = `<div class="ct">
    <div class="ct-top">
      <div class="ct-tabs" role="tablist" aria-label="Central Operacional">${ABAS.filter((a) => a.key !== "panorama" || temPan).map((a) =>
        `<button type="button" role="tab" data-ct-aba="${a.key}"><svg viewBox="0 0 24 24" aria-hidden="true">${a.ic}</svg><span>${esc(a.label)}</span></button>`).join("")}</div>
      <label class="ct-gsearch"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg><input type="search" id="ctGBusca" placeholder="Buscar unidade, bloco ou cliente em todos os condomínios" autocomplete="off" aria-label="Buscar unidade em todos os condomínios"></label>
    </div>
    <div class="ct-proj" id="ctProj" role="group" aria-label="Condomínios"></div>
    <div id="ctBody" class="ct-body"></div>
  </div>`;
  root.dataset.montado = "1";
}
function pintarProjetos() {
  const el = root.querySelector("#ctProj"); if (!el) return;
  const ps = host.projetos();
  el.hidden = aba === "panorama" || ps.length < 2;
  el.innerHTML = `<span class="ct-lbl">Condomínios</span><button type="button" class="fchip fx-all${filt.projetos.length ? "" : " active"}" data-ct-proj="" style="--c:#1f4a3f">Todos</button>` +
    ps.map((p) => `<button type="button" class="fchip${filt.projetos.includes(String(p.id)) ? " active" : ""}" data-ct-proj="${esc(p.id)}" style="--c:${esc(p.cor)}"><i></i>${esc(p.nome)}</button>`).join("");
}
function pintar() {
  if (!root || !host) return;
  if (!root.dataset.montado || !root.querySelector(".ct")) casca();
  root.querySelectorAll("[data-ct-aba]").forEach((b) => { const on = b.dataset.ctAba === aba; b.classList.toggle("on", on); b.setAttribute("aria-selected", String(on)); });
  pintarProjetos();
  const body = root.querySelector("#ctBody");
  if (host.panorama?.el) host.panorama.el.hidden = aba !== "panorama";
  body.hidden = aba === "panorama";
  if (aba === "panorama") { host.panorama?.mostrar?.(); return; }
  if (semFuncao) { body.innerHTML = `<div class="ct-vazio"><b>A Central Operacional ainda não foi instalada no banco.</b><span>Aplique a migration <code>20261112120000_central_operacional.sql</code>.</span></div>`; return; }
  if (aba === "agenda") pintarAgenda(body);
  else if (aba === "produtividade") pintarProdutividade(body, ctxProd());
  else pintarUnidades(body);
}
function ctxProd() {
  return { host, projetos: filt.projetos, prefs, salvar: salvarPrefs, abrirUnidade: (id) => abrirUnidade(host, id),
    filtrarProjeto: (id) => { filt.projetos = id ? [String(id)] : []; salvarPrefs(); pintar(); recarregarAgenda(); },
    naoInstalado: () => { semFuncao = true; pintar(); } };
}

/* ── Agenda Operacional ── */
async function carregar(intervalo, modo = "trocar") {
  const meu = ++pedido;
  carregando = modo; erro = "";
  if (modo === "trocar") pintarListaAgenda();
  try {
    if (!lim || modo === "trocar") lim = await S.limites(host.sb, filt.projetos).catch(() => lim);
    const linhas = await S.agenda(host.sb, intervalo.de, intervalo.ate, filt.projetos);
    if (meu !== pedido) return;
    const novos = (linhas || []).map((a) => ({ ...a, projeto: nomeProj(a.project_id) }));
    if (modo === "trocar" || modo === "recarregar") { dados = novos; janela = { ...intervalo }; }
    else if (modo === "depois") { dados = dados.concat(novos); janela = { de: janela.de, ate: intervalo.ate }; }
    else if (modo === "antes") { dados = novos.concat(dados); janela = { de: intervalo.de, ate: janela.ate }; }
  } catch (err) {
    if (meu !== pedido) return;
    if (S.naoInstalado(err)) { semFuncao = true; carregando = ""; pintar(); return; }
    erro = err.message || "Não foi possível carregar a agenda.";
  }
  carregando = "";
  const box = root?.querySelector("#ctAg"), pos = box?.scrollTop || 0;
  pintarListaAgenda();
  const b2 = root?.querySelector("#ctAg");
  if (b2) b2.scrollTop = modo === "trocar" ? 0 : pos;   // novos dias entram no fim da lista: a posição não muda
}
/** Intervalo inicial de cada modo. */
function intervaloModo() {
  const hoje = host.hoje();
  if (agModo === "historico") return M.janelaHistorico(hoje);
  if (agModo === "periodo") return M.periodoAgenda(agPer.de, agPer.ate, hoje);
  return M.janelaFutura(hoje);
}
function recarregarAgenda() { lim = null; janela = null; dados = []; if (aba === "agenda" && root) carregar(intervaloModo(), "trocar"); }
function pintarAgenda(body) {
  if (!body.querySelector(".ct-agenda")) {
    body.innerHTML = `<div class="ct-agenda">
      <div class="ct-agtop">
        <div class="modetog ct-seg ct-modo" role="tablist" aria-label="Período da agenda">${M.MODOS_AGENDA.map((m) => `<button type="button" role="tab" data-ct-modo="${m.key}" title="${esc(m.dica)}">${esc(m.label)}</button>`).join("")}</div>
        <div class="ct-per" id="ctPerF" hidden><label class="fx-field ct-f ct-fd"><span>De</span><input type="date" id="ctDe" aria-label="Data inicial"></label><label class="fx-field ct-f ct-fd"><span>Até</span><input type="date" id="ctAte" aria-label="Data final"></label></div>
        <span class="ct-per-t" id="ctPer"></span>
      </div>
      <div class="ct-kpis" id="ctKpis"></div>
      <div class="ct-fil">
        <div class="modetog ct-seg" role="tablist" aria-label="Tipo"><button type="button" data-ct-tipo="">Todas</button><button type="button" data-ct-tipo="vistoria">Vistorias</button><button type="button" data-ct-tipo="revistoria">Revistorias</button></div>
        <label class="fx-field fx-sel ct-f"><span>Responsável</span><select id="ctResp" aria-label="Responsável"></select></label>
        <label class="fx-field fx-sel ct-f"><span>Bloco</span><select id="ctBloco" aria-label="Bloco ou conjunto"></select></label>
        <label class="fx-field ct-f ct-fq"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg><input id="ctQ" type="search" placeholder="Apto, bloco, cliente…" autocomplete="off" aria-label="Filtrar a agenda por apartamento, bloco, cliente ou responsável"></label>
        <button type="button" class="fx-btn fx-clear" id="ctLimpar" hidden>Limpar</button>
        <div class="ct-chips" id="ctStatus" role="group" aria-label="Situação"></div>
      </div>
      <div class="ct-meta"><span id="ctCount"></span></div>
      <div class="ct-ag" id="ctAg" tabindex="0" aria-label="Agenda"></div>
    </div>`;
    const q = (s) => body.querySelector(s);
    q("#ctResp").addEventListener("change", (e) => { filt.resp = e.target.value; salvarPrefs(); pintarListaAgenda(); });
    q("#ctBloco").addEventListener("change", (e) => { filt.bloco = e.target.value; salvarPrefs(); pintarListaAgenda(); });
    q("#ctQ").addEventListener("input", (e) => { filt.busca = e.target.value; pintarListaAgenda(); });
    const mudouPer = () => {
      const de = q("#ctDe").value, ate = q("#ctAte").value;
      const msg = M.validarPeriodoAgenda(de, ate);
      if (msg) { if (de && ate) host.toast?.(msg); return; }
      agPer = { de, ate }; recarregarAgenda();
    };
    q("#ctDe").addEventListener("change", mudouPer); q("#ctAte").addEventListener("change", mudouPer);
    q("#ctLimpar").addEventListener("click", () => { const p = filt.projetos; filt = { ...M.FILTRO0(), projetos: p }; salvarPrefs(); pintarListaAgenda(); });
    q("#ctAg").addEventListener("scroll", () => { const b = q("#ctAg"); if (b.scrollTop + b.clientHeight >= b.scrollHeight - 160) carregarMais(); }, { passive: true });
  }
  if (!janela) { carregar(intervaloModo(), "trocar"); return; }
  pintarListaAgenda();
}
function trocarModo(m) {
  if (m === agModo) return;
  agModo = m;
  if (m === "periodo" && !agPer.de) { const h = host.hoje(); agPer = { de: M.somaDias(h, -30), ate: h }; }
  // situação "Atrasadas", "Concluídos"… só fazem sentido com datas passadas; ao voltar para hoje em diante, limpa
  if (m === "futuro" && filt.status && !M.STATUS_FUTURO.includes(filt.status)) filt.status = "";
  recarregarAgenda();
}
/** Rolagem até o fim: hoje em diante carrega os próximos dias; histórico, os dias mais antigos. */
function carregarMais() {
  if (carregando || !janela || erro) return;
  if (agModo === "futuro") { if (!fimFuturo()) carregar(M.proximaJanela(janela.ate), "depois"); }
  else if (agModo === "historico" && temMaisAntigo()) carregar(M.janelaAnterior(janela.de), "antes");
}
const fimFuturo = () => !!(lim?.max && janela.ate >= lim.max && janela.ate >= M.somaDias(host.hoje(), 60));
const temMaisAntigo = () => !lim?.min || janela.de > lim.min;
function pintarListaAgenda() {
  const box = root?.querySelector("#ctAg"); if (!box) return;
  const hoje = host.hoje();
  const base = dados.filter((a) => M.passaFiltros(a, { ...filt, status: "", tipo: "" }, hoje));
  const vis = base.filter((a) => M.passaFiltros(a, filt, hoje));
  root.querySelectorAll("[data-ct-modo]").forEach((b) => { const on = b.dataset.ctModo === agModo; b.classList.toggle("active", on); b.setAttribute("aria-selected", String(on)); });
  const pf = root.querySelector("#ctPerF"); pf.hidden = agModo !== "periodo";
  if (agModo === "periodo") { const de = root.querySelector("#ctDe"), ate = root.querySelector("#ctAte"); if (de.value !== agPer.de) de.value = agPer.de; if (ate.value !== agPer.ate) ate.value = agPer.ate; }
  root.querySelector("#ctPer").textContent = !janela ? "" : agModo === "futuro" ? `A partir de hoje, ${M.fmtD(hoje)}` : agModo === "historico" ? `Até ontem · carregado desde ${M.fmtD(janela.de)}` : `${M.fmtD(janela.de)} a ${M.fmtD(janela.ate)}`;
  // indicadores: o que está carregado + condomínio, responsável, bloco e busca; cada indicador aplica tipo/situação
  const k = M.indicadores(base, hoje);
  const kpis = M.kpisAgenda(agModo);
  const on = (key) => (key === "total" ? !filt.tipo && !filt.status : key === "vistoria" || key === "revistoria" ? filt.tipo === key : filt.status === key);
  root.querySelector("#ctKpis").innerHTML = kpis.map((x) => x.info
    ? `<div class="ct-kpi k-${x.key} k-info" title="${esc(x.dica)}"><b>${k[x.key]}</b><span>${esc(x.label)}</span></div>`
    : `<button type="button" class="ct-kpi k-${x.key}${on(x.key) ? " on" : ""}" data-ct-kpi="${x.key}" title="${esc(x.dica)}"><b>${k[x.key]}</b><span>${esc(x.label)}</span></button>`).join("");
  root.querySelector("#ctKpis").style.setProperty("--n", kpis.length);
  const chips = M.FILTROS_STATUS.filter((s) => agModo !== "futuro" || M.STATUS_FUTURO.includes(s.key));
  root.querySelector("#ctStatus").innerHTML = chips.map((s) => `<button type="button" class="fchip${filt.status === s.key ? " active" : ""}" data-ct-status="${s.key}" style="--c:${M.SITUACOES[s.key === "concluidas" ? "aprovada" : s.key]?.cor || "#1f4a3f"}"><i></i>${esc(s.label)}</button>`).join("");
  root.querySelectorAll("[data-ct-tipo]").forEach((b) => b.classList.toggle("active", b.dataset.ctTipo === filt.tipo));
  const resp = M.responsaveis(dados), selR = root.querySelector("#ctResp");
  selR.innerHTML = `<option value="">Todos</option>` + resp.map((n) => `<option${filt.resp && filt.resp.toLowerCase() === n.toLowerCase() ? " selected" : ""}>${esc(n)}</option>`).join("");
  const blocos = [...new Map(dados.map((a) => [`${a.project_id}|${a.bloco}`, a])).values()]
    .sort((x, y) => x.projeto.localeCompare(y.projeto, "pt-BR") || String(x.bloco).localeCompare(String(y.bloco), "pt-BR", { numeric: true }));
  const multi = new Set(blocos.map((b) => b.project_id)).size > 1;
  root.querySelector("#ctBloco").innerHTML = `<option value="">Todos</option>` + blocos.map((b) => `<option value="${esc(`${b.project_id}|${b.bloco}`)}"${filt.bloco === `${b.project_id}|${b.bloco}` ? " selected" : ""}>${esc((multi ? b.projeto + " · " : "") + (b.unidade_tipo === "casa" ? "Conj. " : "Bloco ") + b.bloco)}</option>`).join("");
  const q = root.querySelector("#ctQ"); if (q.value !== filt.busca) q.value = filt.busca;
  root.querySelector("#ctLimpar").hidden = !(filt.tipo || filt.status || filt.resp || filt.bloco || filt.busca);
  root.querySelector("#ctCount").textContent = janela ? `${vis.length} atividade(s) · ${new Set(vis.map((a) => a.unit_id)).size} unidade(s)` : "";
  if (carregando === "trocar" || (!janela && !erro)) { box.innerHTML = esqueleto(); return; }
  if (erro && !dados.length) { box.innerHTML = `<div class="ct-vazio err"><b>${esc(erro)}</b><button type="button" class="btn g" data-ct-retry>Tentar de novo</button></div>`; return; }
  const desc = agModo === "historico";
  const dias = M.porDia(vis, hoje, janela.de, janela.ate, desc);
  let h = "";
  if (!dias.length) h += `<div class="ct-vazio"><b>${agModo === "futuro" ? "Nenhuma atividade agendada com esses filtros." : "Nenhuma atividade com esses filtros no período."}</b><span>${agModo === "futuro" ? "Role para ver mais dias, use o Histórico para datas anteriores ou limpe os filtros." : "Escolha outro período ou limpe os filtros."}</span></div>`;
  for (const d of dias) {
    const r = M.rotuloDia(d.data, hoje), nV = d.itens.filter((a) => a.tipo === "vistoria").length, nR = d.itens.length - nV;
    h += `<section class="ct-dia${r.hoje ? " hoje" : ""}${r.passado ? " passado" : ""}" data-dia="${d.data}">
      <header class="ct-dh"><b>${esc(r.rel)}</b><span>${esc(r.data)}</span><em>${d.itens.length ? `${d.itens.length} atividade(s)${nV && nR ? ` · ${nV} V · ${nR} R` : ""}` : "Nenhuma atividade"}</em></header>
      ${d.itens.map((a) => linha(a, hoje)).join("")}</section>`;
  }
  if (agModo === "futuro") {
    const fim = fimFuturo();
    h += `<div class="ct-depois">${carregando === "depois" ? `<span class="ct-spin"></span>Carregando os próximos dias…` : fim ? "Fim da programação registrada" : `<button type="button" class="btn g ch-mini" data-ct-mais>Carregar mais dias</button>`}</div>`;
  } else if (agModo === "historico") {
    h += `<div class="ct-depois">${carregando === "antes" ? `<span class="ct-spin"></span>Carregando dias anteriores…` : temMaisAntigo() ? `<button type="button" class="btn g ch-mini" data-ct-mais>Carregar dias anteriores</button>` : "Início do histórico de atividades"}</div>`;
  }
  box.innerHTML = h;
  // pouca coisa na tela: carrega o próximo bloco sozinho até encher a área (ou acabar)
  if (!carregando && !erro && agModo !== "periodo" && box.scrollHeight - box.clientHeight < 160) setTimeout(carregarMais, 0);
  if (erro) host.toast?.(erro);
}
function linha(a, hoje) {
  const t = M.TIPOS[a.tipo], s = M.situacao(a, hoje), sit = M.SITUACOES[s];
  const st = a.tipo === "vistoria" ? host.vistoriaInfo(a.status) : null;
  const pill = a.tipo === "vistoria" ? `<span class="ct-st" style="background:${st.bg};color:${st.tx};border-color:${st.bd}">${esc(st.label)}</span>`
    : `<span class="ct-st rv s-${esc(String(a.status || "").toLowerCase().replace(/\s+/g, "-"))}">${esc(a.status || "—")}</span>`;
  return `<button type="button" class="ct-row s-${s}" data-ct-unit="${a.unit_id}" style="--pj:${esc(corProj(a.project_id))}" title="Abrir a unidade (histórico completo)">
    <span class="ct-hr">${esc(a.horario || "—")}</span>
    <span class="ct-tp t-${a.tipo}" title="${esc(t.label)}${a.numero ? ` nº ${a.numero}` : ""}"><i>${t.sigla}</i>${esc(t.label)}${a.numero ? ` <small>nº ${a.numero}</small>` : ""}</span>
    <span class="ct-un"><b>${esc(rotuloUn(a))}</b><small><i></i>${esc(a.projeto)}${a.cliente ? ` · ${esc(a.cliente)}` : ""}</small></span>
    <span class="ct-rs">${a.responsavel ? esc(a.responsavel) : '<span class="ct-mut">sem responsável</span>'}</span>
    <span class="ct-sts">${pill}${s === "atrasada" || s === "pendente" ? `<em class="ct-sit" style="--c:${sit.cor}">${esc(sit.label)}</em>` : ""}</span>
  </button>`;
}
const esqueleto = () => `<div class="ct-skel" aria-hidden="true">${Array.from({ length: 7 }, (_, i) => `<i style="width:${92 - (i % 3) * 9}%"></i>`).join("")}</div><span class="ct-sr" role="status">Carregando a agenda…</span>`;

/* ── Unidades (pesquisa global) ── */
function pintarUnidades(body) {
  if (!body.querySelector(".ct-unid")) {
    body.innerHTML = `<div class="ct-unid">
      <label class="ct-ubusca"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg><input type="search" id="ctUQ" placeholder="Ex.: A 604, B35, bloco C apto 203, nome do cliente" autocomplete="off" aria-label="Buscar unidade"></label>
      <p class="ct-nota">A Central de Unidades reúne vistoria, revistorias, agendamentos, pendências e relatórios de cada apartamento, sem duplicar cadastros. Clique em qualquer unidade da agenda, das listas ou dos indicadores para abrir.</p>
      <div id="ctURes"></div></div>`;
    const inp = body.querySelector("#ctUQ");
    inp.addEventListener("input", (e) => { unid.q = e.target.value; clearTimeout(unid.t); unid.t = setTimeout(buscarUnidades, 250); });
  }
  const inp = body.querySelector("#ctUQ"); if (inp.value !== unid.q) inp.value = unid.q;
  pintarResultados();
}
async function buscarUnidades() {
  const q = unid.q.trim(), meu = ++unid.pedido;
  if (!q) { unid.res = null; pintarResultados(); return; }
  unid.carregando = true; pintarResultados();
  try { const r = await S.buscar(host.sb, q, filt.projetos); if (meu !== unid.pedido) return; unid.res = r || []; }
  catch (err) { if (meu !== unid.pedido) return; if (S.naoInstalado(err)) { semFuncao = true; pintar(); return; } unid.res = []; host.toast?.(err.message || "Falha na busca"); }
  unid.carregando = false; pintarResultados();
}
function pintarResultados() {
  const el = root?.querySelector("#ctURes"); if (!el) return;
  if (unid.carregando) { el.innerHTML = esqueleto(); return; }
  const lista = unid.res ?? recentesDe(host);
  if (!lista.length) { el.innerHTML = unid.res ? `<div class="ct-vazio"><b>Nenhuma unidade encontrada.</b><span>Tente o bloco e o número (ex.: A 604) ou parte do nome do cliente.</span></div>` : `<div class="ct-vazio"><b>Digite para buscar em todos os condomínios.</b><span>As unidades abertas recentemente aparecem aqui.</span></div>`; return; }
  el.innerHTML = `${unid.res ? "" : `<div class="ct-sub">Abertas recentemente</div>`}<div class="ct-ulist">${lista.map((u) => {
    const st = host.vistoriaInfo(u.status_vistoria || "Não agendado");
    return `<button type="button" class="ct-urow" data-ct-unit="${u.unit_id}" style="--pj:${esc(corProj(u.project_id))}">
      <span class="ct-un"><b>${esc(rotuloUn(u))}</b><small><i></i>${esc(nomeProj(u.project_id))}${u.cliente ? ` · ${esc(u.cliente)}` : ""}</small></span>
      <span class="ct-st" style="background:${st.bg};color:${st.tx};border-color:${st.bd}">${esc(st.label)}</span>
      ${u.status_revistoria ? `<span class="ct-rc">Revistoria: ${esc(u.status_revistoria)}</span>` : "<span></span>"}
      ${u.aps_total ? `<span class="ct-pd"><b>${u.aps_resolvidas}/${u.aps_total}</b><i style="--p:${Math.round((u.aps_resolvidas / u.aps_total) * 100)}%"></i></span>` : `<span class="ct-pd vazio">—</span>`}
    </button>`;
  }).join("")}</div>`;
}

/* ── eventos ── */
function clique(e) {
  const t = e.target;
  const ab = t.closest("[data-ct-aba]");
  if (ab) { aba = ab.dataset.ctAba; salvarPrefs(); pintar(); return; }
  const pj = t.closest("[data-ct-proj]");
  if (pj) {
    const id = pj.dataset.ctProj;
    filt.projetos = !id ? [] : filt.projetos.includes(id) ? filt.projetos.filter((x) => x !== id) : [...filt.projetos, id];
    if (filt.projetos.length === host.projetos().length) filt.projetos = [];
    filt.bloco = ""; salvarPrefs(); pintarProjetos();
    if (aba === "agenda") recarregarAgenda(); else { janela = null; dados = []; pintar(); if (aba === "unidades" && unid.q) buscarUnidades(); }
    return;
  }
  const un = t.closest("[data-ct-unit]");
  if (un) { abrirUnidade(host, Number(un.dataset.ctUnit)); return; }
  const kp = t.closest("[data-ct-kpi]");
  if (kp) { filt = M.filtroDoKpi(kp.dataset.ctKpi, filt); salvarPrefs(); pintarListaAgenda(); return; }
  const tp = t.closest("[data-ct-tipo]");
  if (tp) { filt.tipo = tp.dataset.ctTipo; salvarPrefs(); pintarListaAgenda(); return; }
  const st = t.closest("[data-ct-status]");
  if (st) { filt.status = filt.status === st.dataset.ctStatus ? "" : st.dataset.ctStatus; salvarPrefs(); pintarListaAgenda(); return; }
  const md = t.closest("[data-ct-modo]");
  if (md) { trocarModo(md.dataset.ctModo); return; }
  if (t.closest("[data-ct-mais]")) { carregarMais(); return; }
  if (t.closest("[data-ct-retry]")) { recarregarAgenda(); }
}
function digitou(e) {
  if (e.target.id !== "ctGBusca") return;
  const v = e.target.value;
  if (!v.trim()) return;
  unid.q = v; aba = "unidades"; salvarPrefs(); pintar();
  const inp = root.querySelector("#ctUQ"); if (inp) { inp.value = v; }
  clearTimeout(unid.t); unid.t = setTimeout(buscarUnidades, 250);
  e.target.value = ""; inp?.focus();
}
function aoMudar() {
  clearTimeout(recarga);
  recarga = setTimeout(() => {
    if (!root?.isConnected || !root.offsetParent) return;
    if (aba === "agenda" && janela) carregar(janela, "recarregar");
    else if (aba === "produtividade") pintarProdutividade(root.querySelector("#ctBody"), { ...ctxProd(), recarregar: true });
  }, 900);
}

/* ── API para a tela de Vistorias ── */
const api = {
  /**
   * Monta (ou mostra de novo) a central dentro de `el`. `entrando` = o usuário acabou de abrir a página:
   * começa sempre pelo Panorama (no Resumo Geral do condomínio) e a agenda volta para "Hoje em diante".
   */
  mostrar(el, h, entrando = false) {
    const trocou = root !== el;
    host = h; root = el;
    if (!root) return;
    if (trocou || !root.dataset.montado) {
      lerPrefs();
      if (!root.dataset.ouvindo) { root.addEventListener("click", clique); root.addEventListener("input", digitou); root.dataset.ouvindo = "1"; }
      delete root.dataset.montado; janela = null; dados = []; lim = null;
    }
    if (entrando || trocou) {
      aba = host.panorama ? "panorama" : "agenda";
      if (agModo !== "futuro") { agModo = "futuro"; janela = null; dados = []; }
      if (filt.status && !M.STATUS_FUTURO.includes(filt.status)) filt.status = "";
    }
    if (aba === "panorama" && !host.panorama) aba = "agenda";
    if (!cancelarRT && host.sb) cancelarRT = S.assinar(host.sb, aoMudar);
    pintar();
  },
  /** Dados mudaram em outra aba (salvar vistoria, revistoria, checklist). */
  atualizar() { aoMudar(); },
  abrirUnidade(unitId) { if (host) abrirUnidade(host, unitId); },
  fecharUnidade,
  esconder() { fecharUnidade(); },
  /** Troca de usuário ou saída: limpa o que estava em memória. */
  reset() { try { cancelarRT?.(); } catch { /* sem tempo real */ } cancelarRT = null; fecharUnidade(); dados = []; janela = null; lim = null; unid = { q: "", res: null, carregando: false, t: null, pedido: 0 }; semFuncao = false; if (root) { root.innerHTML = ""; delete root.dataset.montado; } }
};
window.AmciCentral = api;
export default api;
