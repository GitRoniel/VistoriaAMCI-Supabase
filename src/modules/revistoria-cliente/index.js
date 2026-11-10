// Aba "Revistoria · Cliente" das Vistorias: acompanhamento das revistorias pedidas pelo cliente.
//
// Montada pela tela de Vistorias (www/index.html), que fornece o contexto (`host`): cliente Supabase,
// condomínio aberto, unidades (as mesmas do Mapa), status da vistoria (só leitura), a situação de cada
// unidade (revistorias_cliente) e os agendamentos (revistorias), já atualizados em tempo real. Toda
// gravação passa pelas funções revistoria_* do banco; o histórico vem de revistorias_eventos.
// Entrada automática: vistoria em "Revistoria" → unidade aparece aqui como "Em andamento".
// Fluxo: Em andamento → Agendar → Agendado → Registrar resultado → Aprovado
//                                            ↘ Reprovada → Em andamento (novo ciclo) → Agendar…
//        Agendado → Remarcar (o anterior fica no histórico) / Cancelar · Aprovado → Reabrir (novas pendências)
import * as M from "./model.js";
import * as S from "./service.js";
import { abrirRelatorio } from "./relatorio-tela.js";
import { abrirLote } from "./lote.js";
// Status da chave: mesmos dados e regras do Controle de Chaves (chaves_unidades / chaves_ocorrencias e chaves_transferir).
import * as CM from "../chaves/model.js";
import * as CS from "../chaves/service.js";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const FILTRO0 = () => ({ bloco: "ALL", busca: "", rapido: "todos", liberado: "", execucao: "", chave: "", data: "", hrSort: "asc" });
const pad = (n) => String(n).padStart(2, "0");
const fmtDH = (ts) => { if (!ts) return "—"; const d = new Date(ts); return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const fmtD = (d) => { const p = String(d || "").slice(0, 10).split("-"); return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : ""; };
const hhmm = (t) => String(t || "").slice(0, 5);
const novoPedido = () => (crypto.randomUUID ? crypto.randomUUID() : "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) => (c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))).toString(16)));
const badge = (status, extra = "") => { const s = M.info(status); return `<span class="rc-badge${extra}" style="--c:${s.cor};--b:${s.borda}">${esc(s.label)}</span>`; };
const ICONE = {
  agendar: `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18M12 14v4M10 16h4"/></svg>`,
  remarcar: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12a9 9 0 0 1 15.5-6.2L21 8"/><path d="M21 3v5h-5M21 12a9 9 0 0 1-15.5 6.2L3 16"/><path d="M3 21v-5h5"/></svg>`,
  resultado: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 11l3 3 8-8"/><path d="M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9"/></svg>`,
  cancelar: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M15 9l-6 6M9 9l6 6"/></svg>`,
  reabrir: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/></svg>`,
  historico: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/></svg>`,
  relatorio: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M8 13l2 2 4-4M8 18h8"/></svg>`,
  chave: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="8" cy="15" r="4"/><path d="M10.8 12.2 20 3M17 6l3 3M14.5 8.5l2 2"/></svg>`,
  relogio: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>`
};
const FORMS = {
  agendar: { botao: "Agendar revistoria", curto: "Agendar", ok: "Confirmar agendamento" },
  remarcar: { botao: "Remarcar", curto: "Remarcar", ok: "Confirmar nova data" },
  resultado: { botao: "Registrar resultado", curto: "Resultado", ok: "Registrar resultado" },
  cancelar: { botao: "Cancelar agendamento", curto: "Cancelar", ok: "Cancelar agendamento" },
  reabrir: { botao: "Reabrir", curto: "Reabrir", ok: "Reabrir revistoria" }
};

// Mapa é a visualização principal: abre (e volta) sempre no Mapa; a Lista fica para consulta detalhada.
let host = null, root = null, projId = null, filt = FILTRO0(), modo = "mapa", area = "acomp", nomes = [], salvando = "";
let pop = null, fundo = null, cur = null, painel = "", hist = null, ocupado = false, aviso = null, pedido = null;
// chaves: unitId → situação da chave (CM.situacao); comRelatorio: unidades com relatório enviado;
// apont: unitId → { total, resolvidas, pct } do checklist (mesma regra do relatório individual: M.checklistUnidade)
let chaves = new Map(), chavesOk = false, chavesProj = null, cancelarChaves = null, recargaChaves = null, comRelatorio = new Set();
let apont = new Map(), apontOk = false, cancelarRel = null, recargaRel = null;

const hoje = () => host?.hoje?.() || new Date().toISOString().slice(0, 10);
const podeEditar = () => ["admin", "revistorias"].includes(host?.papel());
function unidade(u) {
  const unitId = host.unitId(u.b, u.p, u.a);
  return { ...u, unitId, codigo: host.codigo(u.b, u.p, u.a), titulo: host.titulo(u.b, u.p, u.a), vistoria: host.vistoria(u.b, u.p, u.a),
    cliente: host.cliente(u.b, u.p, u.a), situacao: M.situacao(host.acompanhamento(unitId), host.agendamentos(unitId)),
    chave: chaves.get(unitId) || CM.situacao(null) };
}
const todasUnidades = () => host.units().filter((u) => host.unitId(u.b, u.p, u.a)).map(unidade);
const nomeUnidade = (u) => (host.casa() ? `Casa ${+u.a}` : `Apto ${u.codigo}`);
const localUnidade = (u) => (host.casa() ? `Conjunto ${u.b}` : `Bloco ${u.b} · ${host.grid().pavLabel[u.p] || u.p}`);
const rotuloLista = (u) => (host.casa() ? `Conj. ${u.b} · Casa ${+u.a}` : `Bloco ${u.b} · ${u.codigo}`);
const vistPill = (c) => { const vc = host.vistoriaCor(c); return `<span class="ch-vpill rc-vpill" style="background:${vc.bg};color:${vc.tx};border-color:${vc.bd}">${esc(host.vistoriaLabel(c))}</span>`; };
// Liberação e execução (selos no mapa, colunas na lista, controles no painel).
const execPill = (key, extra = "") => { const e = M.execInfo(key); return e ? `<span class="rc-exec${extra}" style="--c:${e.cor}"><i>${esc(e.sigla)}</i>${esc(e.equipe)} · ${esc(e.responsavel)}</span>` : '<span class="ch-mut">—</span>'; };
const libPill = (lib) => (lib ? '<span class="rc-lib on">✓ Liberado</span>' : '<span class="rc-lib">Não liberado</span>');
// Chave: pílula com a cor do setor (como no Controle de Chaves) e selo neutro com a letra no mapa.
const chavePill = (k, extra = "") => {
  if (k?.perdida) return `<span class="rc-key lost${extra}">! ${esc(CM.ETAPAS[k.perdida.etapa]?.label || "Chave perdida")}</span>`;
  const st = CM.SETORES[k?.setor || "sem"] || CM.SETORES.sem;
  return `<span class="ch-spill rc-key-pill${extra}" style="--c:${st.cor};--b:${st.borda};--t:${st.texto}">${esc(st.label)}</span>`;
};
const quandoAg = (r) => (r ? [fmtD(r.data), hhmm(r.horario)].filter(Boolean).join(" · ") : "");

/* ── tela ── */
// Duas áreas sobre os mesmos dados (revistorias_cliente, revistorias, chaves e relatórios), sem duplicar telas:
//   Acompanhamento Geral: agendamentos, status, aprovações e indicadores do fluxo da revistoria;
//   Execução M.O.: liberação, equipes de mão de obra (M.O.P Felipe/Renato, EMP), relatórios/checklist e chaves.
// Cada área mostra só os seus filtros, indicadores, colunas e marcas no mapa; bloco e busca valem para as duas.
const AREAS = [
  { key: "acomp", label: "Acompanhamento Geral", sub: "Agendamentos, status e aprovações das revistorias",
    ic: '<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M16 2v4M8 2v4M3 10h18M9 15.5l2 2 4-4.5"/>' },
  { key: "exec", label: "Execução M.O.", sub: "Liberação, equipes de mão de obra, relatórios e chaves",
    ic: '<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.6 2.6-2.4-.6-.6-2.4z"/>' }
];
/** Filtros de cada área (bloco e busca são comuns). */
const CAMPOS_AREA = { acomp: ["rapido", "data"], exec: ["liberado", "execucao", "chave"] };
/** Filtro efetivo da área: os campos da outra área não valem aqui (ficam guardados para quando voltar). */
function filtroArea() {
  const f0 = FILTRO0(), f = { ...filt };
  for (const k of CAMPOS_AREA[area === "acomp" ? "exec" : "acomp"]) f[k] = f0[k];
  return f;
}
const so = (a) => ` data-so="${a}"`;
function casca() {
  root.innerHTML = `
    <div class="modetog rc-modo" role="tablist" aria-label="Visualização"><button type="button" role="tab" data-modo="mapa">Mapa</button><button type="button" role="tab" data-modo="lista">Lista</button></div>
    <div class="rc-areas" role="tablist" aria-label="Área da revistoria">${AREAS.map((a) => `<button type="button" role="tab" class="rc-area" data-area="${a.key}"><span class="vw-ic"><svg viewBox="0 0 24 24" aria-hidden="true">${a.ic}</svg></span><span class="vw-txt"><b>${esc(a.label)}</b><small>${esc(a.sub)}</small></span></button>`).join("")}</div>
    <div class="ch-top rc-top" id="rcKpis"></div>
    <div class="clif ch-filters rc-filters">
      <div class="ch-line">
        <label class="fx-field fx-sel"><span>${esc(host.grupo())}</span><select id="rcBloco" aria-label="${esc(host.grupo())}"><option value="ALL">Todos</option>${host.grupos().map((b) => `<option value="${esc(b)}">${esc(b)}</option>`).join("")}</select></label>
        <label class="fx-field ch-f-apto"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg><input id="rcBusca" type="search" placeholder="${host.casa() ? "Casa ou cliente" : "Unidade (ex.: 604 ou A604) ou cliente"}" aria-label="Buscar unidade ou cliente" autocomplete="off"></label>
        <label class="fx-field rc-f-data"${so("acomp")}><span>Data</span><input type="date" id="rcData" aria-label="Data da revistoria"><button type="button" class="rc-f-x" id="rcDataX" aria-label="Limpar data" hidden>×</button></label>
        <button class="fx-btn rc-hr" id="rcHr" type="button" aria-label="Ordenar por horário"${so("acomp")}>${ICONE.relogio}<span>Horário ↑</span></button>
        <label class="fx-field fx-sel rc-f-lib"${so("exec")}><span>Liberado</span><select id="rcLib" aria-label="Liberado">${M.FILTRO_LIBERADO.map((o) => `<option value="${o.key}">${esc(o.label)}</option>`).join("")}</select></label>
        <label class="fx-field fx-sel rc-f-key"${so("exec")}><span>Chave</span><select id="rcChave" aria-label="Status da chave">${M.FILTRO_CHAVE.map((o) => `<option value="${esc(o.key)}">${esc(o.label)}</option>`).join("")}</select></label>
      </div>
      <div class="ch-line rc-exe-fil" role="group" aria-label="Filtrar por equipe de execução"${so("exec")}>
        <span class="rc-exe-fil-t">Execução</span>
        ${M.BOTOES_EXECUCAO.map((e) => `<button type="button" class="rc-exe-b" data-exe-f="${esc(e.key)}" style="--c:${e.cor}" aria-pressed="false"><i>${esc(e.sigla)}</i>${esc(e.label)}<b class="rc-exe-n" data-exe-n="${esc(e.key)}"></b></button>`).join("")}
        <button type="button" class="rc-exe-x" id="rcExeX" aria-label="Limpar filtro de execução" title="Mostrar todas as equipes" hidden>× Todas as equipes</button>
      </div>
      <div class="ch-line ch-chips">
        ${M.FILTROS_REVISTORIA.map((f) => `<button type="button" class="fchip rc-fr${f.key === "todos" ? " fx-all" : ""}" data-fr="${f.key}" style="--c:${f.cor}"${so("acomp")}>${f.key === "todos" ? "" : "<i></i>"}${esc(f.label)}</button>`).join("")}
        <span class="ch-count" id="rcCount"></span>
        ${podeEditar() ? `<button type="button" class="btn g ch-clear rc-imp" id="rcLote" title="Enviar vários PDFs de relatório de uma vez; a unidade é reconhecida pelo nome do arquivo e pelo PDF"${so("exec")}>Relatórios em lote</button>` : ""}
        ${host.abrirChaves ? `<button type="button" class="btn g ch-clear rc-imp" id="rcChaves" title="Abrir o Controle de Chaves (setores, transferências e ocorrências de todas as unidades)"${so("exec")}>Controle de Chaves</button>` : ""}
        ${host.podeImportar?.() ? `<button type="button" class="btn g ch-clear rc-imp" id="rcImportar" title="Atualizar status, data e horário das revistorias pela planilha (colunas M, N e O)"${so("acomp")}>Importar planilha</button>` : ""}
        <button type="button" class="btn g ch-clear" id="rcLimpar">Limpar</button>
      </div>
    </div>
    <div id="rcGrid" class="ch-grid"></div>`;
  root.dataset.proj = String(host.project.id);
  const q = (id) => root.querySelector(id);
  q("#rcBloco").addEventListener("change", (e) => { filt.bloco = e.target.value; pintarConteudo(); });
  q("#rcBusca").addEventListener("input", (e) => { filt.busca = e.target.value; pintarConteudo(); });
  q("#rcLib").addEventListener("change", (e) => { filt.liberado = e.target.value; sincronizarFiltros(); pintarConteudo(); });
  // Execução: filtro rápido (um responsável por vez; clicar de novo mostra todas). Não atribui nada.
  root.querySelectorAll("[data-exe-f]").forEach((b) => b.addEventListener("click", () => { filt.execucao = M.alternarExecucao(filt.execucao, b.dataset.exeF); sincronizarFiltros(); pintarConteudo(); }));
  q("#rcExeX").addEventListener("click", () => { filt.execucao = ""; sincronizarFiltros(); pintarConteudo(); });
  q("#rcChave").addEventListener("change", (e) => { filt.chave = e.target.value; sincronizarFiltros(); pintarConteudo(); });
  q("#rcData").addEventListener("input", (e) => { filt.data = e.target.value; sincronizarFiltros(); pintarConteudo(); });
  q("#rcDataX").addEventListener("click", () => { filt.data = ""; sincronizarFiltros(); pintarConteudo(); });
  // Ordenação por horário (igual à aba Vistoria): cedo → tarde ou o inverso; sem horário fica depois
  q("#rcHr").addEventListener("click", () => { filt.hrSort = filt.hrSort === "asc" ? "desc" : "asc"; sincronizarFiltros(); pintarConteudo(); });
  q("#rcImportar")?.addEventListener("click", () => host.importarRevistorias?.());
  q("#rcLote")?.addEventListener("click", () => abrirLote({ host, unidades: todasUnidades, aoMudar: () => agendarRelatorios() }));
  q("#rcChaves")?.addEventListener("click", () => host.abrirChaves?.());
  // Limpar: bloco, busca e os filtros da área aberta (os da outra área continuam como estavam)
  q("#rcLimpar").addEventListener("click", () => { const f0 = FILTRO0(); for (const k of ["bloco", "busca", ...CAMPOS_AREA[area]]) filt[k] = f0[k]; sincronizarFiltros(); pintarConteudo(); });
  if (!root.dataset.ouvindo) { root.addEventListener("click", cliqueRaiz); root.dataset.ouvindo = "1"; }
}
function sincronizarFiltros() {
  const q = (id) => root.querySelector(id); if (!q("#rcBloco")) return;
  q("#rcBloco").value = filt.bloco; if (q("#rcBusca").value !== filt.busca) q("#rcBusca").value = filt.busca;
  q("#rcLib").value = filt.liberado; q("#rcChave").value = filt.chave;
  root.querySelectorAll("[data-exe-f]").forEach((b) => { const on = b.dataset.exeF === filt.execucao; b.classList.toggle("on", on); b.setAttribute("aria-pressed", String(on)); });
  q("#rcExeX").hidden = !filt.execucao;
  if (q("#rcData").value !== filt.data) q("#rcData").value = filt.data;
  q("#rcDataX").hidden = !filt.data; q("#rcData").closest("label").classList.toggle("on", !!filt.data);
  q("#rcChave").closest("label").classList.toggle("on", !!filt.chave);
  q("#rcHr span").textContent = `Horário ${filt.hrSort === "asc" ? "↑" : "↓"}`;
  q("#rcLib").closest("label").classList.toggle("on", !!filt.liberado);
  root.querySelectorAll(".rc-fr").forEach((b) => b.classList.toggle("active", filt.rapido === b.dataset.fr));
  root.querySelectorAll("[data-modo]").forEach((b) => { const on = b.dataset.modo === modo; b.classList.toggle("active", on); b.setAttribute("aria-selected", String(on)); });
  root.querySelectorAll("[data-area]").forEach((b) => { const on = b.dataset.area === area; b.classList.toggle("on", on); b.setAttribute("aria-selected", String(on)); });
  root.querySelectorAll("[data-so]").forEach((el) => { el.hidden = el.dataset.so !== area; });
  root.dataset.areaAtual = area;
  const f = filtroArea();
  q("#rcLimpar").hidden = f.bloco === "ALL" && !f.busca && f.rapido === "todos" && !f.liberado && !f.execucao && !f.chave && !f.data;
}
function cliqueRaiz(e) {
  const u = e.target.closest("[data-rcu]");
  if (u && u.dataset.acao === "relatorio") { e.stopPropagation(); abrirRel(u.dataset.b, u.dataset.p, u.dataset.a); return; }
  if (u) { e.stopPropagation(); abrir(u.dataset.b, u.dataset.p, u.dataset.a, u, u.dataset.acao || ""); return; }
  const ar = e.target.closest(".rc-area[data-area]");
  if (ar) { if (ar.dataset.area !== area) { area = ar.dataset.area; sincronizarFiltros(); pintarConteudo(); if (cur) pintarPopup(); } return; }
  // indicadores da Execução M.O.: "campo:valor" (clicar de novo limpa; "todos" limpa os filtros da área)
  const kx = e.target.closest("[data-kx]");
  if (kx) {
    const [campo, valor] = kx.dataset.kx.split(":");
    if (campo === "todos") for (const k of CAMPOS_AREA.exec) filt[k] = "";
    else filt[campo] = filt[campo] === valor ? "" : valor;
    sincronizarFiltros(); pintarConteudo(); return;
  }
  const fr = e.target.closest("[data-fr]");
  if (fr) { filt.rapido = fr.dataset.fr === filt.rapido && fr.matches("[data-kpi]") ? "todos" : fr.dataset.fr; sincronizarFiltros(); pintarConteudo(); return; }
  const md = e.target.closest("[data-modo]");
  if (md) { modo = md.dataset.modo; sincronizarFiltros(); pintarConteudo(); }
}

function pintar() {
  if (!root || !host) return;
  if (!host.instalado()) {
    root.innerHTML = `<div class="ch-state"><b>A Revistoria · Cliente ainda não foi instalada no banco.</b><span>Aplique a migration <code>20261105120000_revistoria_cliente.sql</code> e recarregue.</span></div>`;
    delete root.dataset.proj; return;
  }
  if (root.dataset.proj !== String(host.project.id)) { casca(); }
  sincronizarFiltros();
  pintarConteudo();
}

function pintarConteudo() {
  if (!root?.querySelector("#rcGrid")) return;
  const lista = todasUnidades();
  const naAba = lista.filter((u) => u.situacao.status);
  const vis = naAba.filter((u) => M.passaFiltros(u, filtroArea()));
  const ok = new Set(vis.map((u) => u.unitId));
  root.querySelector("#rcKpis").innerHTML = area === "acomp" ? kpisAcompanhamento(naAba) : kpisExecucao(naAba);
  // nº de unidades de cada equipe nos botões de Execução (todas as unidades da aba)
  root.querySelectorAll("[data-exe-n]").forEach((b) => { b.textContent = String(naAba.filter((u) => u.situacao.execucao === b.dataset.exeN).length); });
  root.querySelector("#rcCount").textContent = `${vis.length} de ${naAba.length} unidade(s)`;
  root.querySelector("#rcGrid").innerHTML = modo === "mapa" ? htmlMapa(lista, ok) : htmlLista(vis, naAba.length);
}
/** Acompanhamento Geral: fluxo da revistoria (cada unidade conta uma vez; realizadas = revistorias feitas). */
function kpisAcompanhamento(naAba) {
  const ind = M.indicadores(naAba, hoje()), rep = naAba.filter((u) => M.reprovada(u.situacao)).length;
  const kpi = (key, n, label, cor, title) => `<button type="button" class="ch-kpi${filt.rapido === key ? " on" : ""}" data-kpi data-fr="${key}" style="--c:${cor}" title="${esc(title)}"><b>${n}</b><span>${esc(label)}</span></button>`;
  return kpi("todos", ind.total, "Unidades em revistoria", "#1f4a3f", "Todas as unidades acompanhadas nesta aba") +
    kpi("em_andamento", ind["Em andamento"], "Aguardando agendamento", M.STATUS["Em andamento"].borda, "Em andamento: aguardando o agendamento da revistoria") +
    kpi("agendados", ind.Agendado, "Agendadas", M.STATUS.Agendado.borda, "Revistoria marcada") +
    kpi("aprovados", ind.Aprovado, "Aprovadas", M.STATUS.Aprovado.borda, "Revistoria aprovada pelo cliente") +
    kpi(M.REPROVADA.key, rep, "Rev. Reprovada", M.REPROVADA.borda, "Última revistoria reprovada; a unidade segue em novo ciclo") +
    `<div class="ch-kpi k-info" style="--c:#6b8040" title="Revistorias já realizadas (aprovadas ou reprovadas)"><b>${ind.realizadas}</b><span>Revistorias realizadas</span></div>` +
    `<div class="ch-kpi k-info" style="--c:#2459b5" title="Revistorias agendadas para hoje e os próximos 7 dias"><b>${ind.semana}</b><span>Próximos 7 dias${ind.hoje ? ` · ${ind.hoje} hoje` : ""}</span></div>`;
}
/** Execução M.O.: liberação, equipe, chave e checklist dos relatórios das unidades da aba. */
function kpisExecucao(naAba) {
  const lib = naAba.filter((u) => u.situacao.liberado).length, sem = naAba.filter((u) => !u.situacao.execucao).length;
  const prod = naAba.filter((u) => !u.chave.perdida && u.chave.setor === "producao").length;
  const rel = naAba.filter((u) => comRelatorio.has(u.unitId)).length;
  let apT = 0, apR = 0; for (const u of naAba) { const r = apont.get(u.unitId); if (r) { apT += r.total; apR += r.resolvidas; } }
  const pct = apT ? Math.round((apR / apT) * 100) : 0;
  const kpi = (kx, on, n, label, cor, title) => `<button type="button" class="ch-kpi${on ? " on" : ""}" data-kx="${kx}" style="--c:${cor}" title="${esc(title)}"><b>${n}</b><span>${esc(label)}</span></button>`;
  const algum = filt.liberado || filt.execucao || filt.chave;
  return kpi("todos:", !algum, naAba.length, "Unidades em revistoria", "#1f4a3f", "Todas as unidades da aba (limpa os filtros da Execução M.O.)") +
    kpi("liberado:sim", filt.liberado === "sim", lib, "Liberadas", "#0f3b31", "Unidades liberadas para a execução dos serviços") +
    kpi("liberado:nao", filt.liberado === "nao", naAba.length - lib, "Não liberadas", "#8a948f", "Unidades ainda não liberadas para a execução") +
    kpi("execucao:sem", filt.execucao === "sem", sem, "Sem equipe", "#b9770e", "Unidades sem equipe de execução definida") +
    kpi("chave:producao", filt.chave === "producao", chavesOk ? prod : "…", "Chave na Produção", CM.SETORES.producao?.cor || "#6b8040", "Chave com o setor de Produção (Controle de Chaves)") +
    `<div class="ch-kpi k-info" style="--c:#2f6fdb" title="Unidades com relatório de revistoria enviado"><b>${apontOk ? rel : "…"}</b><span>Com relatório</span></div>` +
    `<div class="ch-kpi k-info" style="--c:#0097a7" title="Apontamentos resolvidos no checklist dos relatórios (sem repetidos)"><b>${apontOk ? `${apR}/${apT}` : "…"}</b><span>Apontamentos resolvidos${apT ? ` · ${pct}%` : ""}</span></div>`;
}

function ordemUnidade() {
  const g = host.grid(), gi = (b) => (g.grupos || []).indexOf(b), pi = (p) => (g.pavs || []).indexOf(p);
  return (x, y) => gi(x.b) - gi(y.b) || pi(x.p) - pi(y.p) || String(x.a).localeCompare(String(y.a), "pt-BR", { numeric: true });
}
function htmlLista(vis, total) {
  if (!total) return `<div class="clif-empty">Nenhuma unidade em revistoria neste condomínio. As unidades entram aqui automaticamente quando o status da vistoria passa a <b>Revistoria</b>.</div>`;
  if (!vis.length) return `<div class="clif-empty">Nenhuma unidade encontrada com esses filtros.</div>`;
  const ord = ordemUnidade();
  // Acompanhamento: ordem da agenda (data e horário); Execução: ordem das unidades (bloco, pavimento, apto)
  vis = [...vis].sort(area === "acomp" ? (x, y) => M.compararAgenda(x, y, filt.hrSort, ord) : ord);
  const linha = (u) => {
    const s = u.situacao, attrs = `data-rcu data-b="${esc(u.b)}" data-p="${esc(u.p)}" data-a="${esc(u.a)}"`;
    const rep = M.reprovada(s);
    const cUn = `<td class="ch-c-un rc-c-un"><b>${esc(rotuloLista(u))}</b>${u.cliente ? `<small>${esc(u.cliente)}</small>` : ""}</td>`;
    const cSt = `<td class="rc-c-st">${badge(s.status)}${rep ? '<span class="rc-rep-tag">Rev. Reprovada</span>' : ""}${s.ciclo > 1 ? `<small>${s.ciclo}º ciclo</small>` : ""}</td>`;
    const bHist = `<button type="button" class="btn g ch-mini" ${attrs} data-acao="historico">Histórico</button>`;
    if (area === "exec") {
      return `<tr class="${cur?.unitId === u.unitId ? "is-sel" : ""}${rep ? " rc-tr-rep" : ""}">${cUn}${cSt}
      <td class="rc-c-lib">${libPill(s.liberado)}</td>
      <td class="rc-c-exe">${execPill(s.execucao)}</td>
      <td class="rc-c-key">${chavePill(u.chave, " sm")}${u.chave.responsavel && !u.chave.perdida ? `<small>${esc(u.chave.responsavel)}</small>` : ""}</td>
      ${celulasApontamentos(u.unitId)}
      <td class="ch-c-ac"><button type="button" class="btn ${comRelatorio.has(u.unitId) ? "g rc-tem-rel" : "p"} ch-mini" ${attrs} data-acao="relatorio" title="${comRelatorio.has(u.unitId) ? "Relatório enviado: abrir o checklist" : "Sem relatório enviado"}">Relatório</button>${bHist}</td>
    </tr>`;
    }
    const ac = M.acoes(s.status, podeEditar()), ag = M.agendaRevistoria(s);
    const quando = s.aberto ? `<b>${esc(fmtD(ag.data)) || "Sem data"}${ag.hora ? ` · ${esc(ag.hora)}` : ' <span class="rc-semh">sem horário</span>'}</b><small>agendada</small>`
      : s.status === "Aprovado" && s.ultima ? `<b>${esc(fmtD(s.ultima.realizada_em || s.ultima.data)) || "—"}</b><small>aprovada</small>`
      : s.ultima ? `<span class="ch-mut">aguardando</span><small>última: ${esc(fmtD(s.ultima.realizada_em || s.ultima.data))} · ${esc(M.agendamento(s.ultima).resultado.toLowerCase())}</small>` : '<span class="ch-mut">aguardando agendamento</span>';
    const resp = (s.aberto || s.ultima)?.responsavel;
    const principal = ac.length ? `<button type="button" class="btn p ch-mini" ${attrs} data-acao="${ac[0]}">${ac[0] === "agendar" ? "Agendar" : ac[0] === "resultado" ? "Resultado" : "Reabrir"}</button>` : "";
    return `<tr class="${cur?.unitId === u.unitId ? "is-sel" : ""}${rep ? " rc-tr-rep" : ""}">${cUn}${cSt}
      <td class="rc-c-vst">${vistPill(u.vistoria)}</td>
      <td class="ch-c-dt rc-c-dt">${quando}</td>
      <td class="ch-c-resp rc-c-resp">${esc(resp) || '<span class="ch-mut">—</span>'}</td>
      <td class="rc-c-n" title="Revistorias realizadas">${s.realizadas}${s.lista.length > s.realizadas ? `<small>${s.lista.length} agend.</small>` : ""}</td>
      <td class="ch-c-ac">${principal}${bHist}</td>
    </tr>`;
  };
  const cab = area === "exec"
    ? `<th class="th-cli">Unidade</th><th>Revistoria · Cliente</th><th>Liberado</th><th>Execução</th><th>Chave</th><th title="Apontamentos no checklist do relatório da unidade">Qtd. Apont.</th><th title="Apontamentos marcados como resolvidos no checklist">Qtd. Resolvidas</th><th>Ação</th>`
    : `<th class="th-cli">Unidade</th><th>Revistoria · Cliente</th><th>Vistoria</th><th>Próxima / última</th><th class="th-cli">Responsável</th><th>Revistorias</th><th>Ação</th>`;
  return `<div class="gridscroll ch-tblw rc-tblw"><table class="ctbl ch-tbl rc-tbl rc-tbl-${area}"><thead><tr>${cab}</tr></thead><tbody>${vis.map(linha).join("")}</tbody></table></div>`;
}

/** Qtd. Apontamentos e Qtd. Resolvidas (com progresso): "—" sem relatório ou sem apontamentos, nunca 100% vazio. */
function celulasApontamentos(unitId) {
  const r = apont.get(unitId);
  if (!apontOk) return `<td class="rc-c-ap"><span class="ch-mut">…</span></td><td class="rc-c-res"><span class="ch-mut">…</span></td>`;
  if (!r || !r.total) {
    const t = r ? "Relatório sem apontamentos no checklist" : "Sem relatório enviado";
    return `<td class="rc-c-ap" title="${t}"><span class="ch-mut">—</span></td><td class="rc-c-res" title="${t}"><span class="ch-mut">—</span></td>`;
  }
  const cls = r.resolvidas === r.total ? " ok" : r.resolvidas ? "" : " zero";
  return `<td class="rc-c-ap" title="${r.total} apontamento(s) no checklist"><b>${r.total}</b></td>
      <td class="rc-c-res${cls}" title="${r.resolvidas} de ${r.total} resolvido(s) (${r.pct}%)"><span class="rc-resq"><b>${r.resolvidas}/${r.total}</b><span class="rc-prog" aria-hidden="true"><i style="width:${r.pct}%"></i></span><small>${r.pct}%</small></span></td>`;
}

function htmlMapa(lista, ok) {
  const porId = new Map(lista.map((u) => [`${u.b}|${u.p}|${u.a}`, u]));
  const btn = (b, p, a) => {
    const u = porId.get(`${b}|${p}|${a}`);
    if (!u) return `<span class="apt ch-u ch-void"></span>`;
    const s = u.situacao, i = s.info;
    const tip = [u.titulo, s.status ? `Revistoria · Cliente: ${i.label}` : "Sem registro na Revistoria · Cliente", s.aberto ? `agendada ${quandoAg(s.aberto)}` : "",
      s.realizadas ? `${s.realizadas} revistoria(s) realizada(s)` : "", s.status ? (s.liberado ? "Liberado" : "Não liberado") : "",
      s.execucao ? `Execução: ${M.execRotulo(s.execucao)}` : "", M.reprovada(s) ? "Revistoria reprovada" : "",
      chavesOk ? (u.chave.perdida ? `Chave perdida (${CM.ETAPAS[u.chave.perdida.etapa]?.label || ""})` : `Chave: ${CM.setorLabel(u.chave.setor)}${u.chave.responsavel ? " com " + u.chave.responsavel : ""}`) : "",
      `Vistoria: ${host.vistoriaLabel(u.vistoria)}`].filter(Boolean).join(" · ");
    // chave: canto inferior esquerdo, no mesmo formato do canto da aba Vistoria, na cor do setor (Controle de Chaves)
    const exe = area === "exec";
    const km = exe && chavesOk && s.status ? (u.chave.perdida ? "lost" : CM.SETORES[u.chave.setor] && u.chave.setor !== "sem" ? CM.SETORES[u.chave.setor].cor : "") : "";
    const ex = exe ? M.execInfo(s.execucao) : null;
    const cls = ["apt", "ch-u", "rc-u", s.status ? "" : "rc-sem", M.reprovada(s) ? "rc-rep" : "", s.status && ok.has(u.unitId) ? "" : "off", cur?.unitId === u.unitId ? "is-sel" : ""].filter(Boolean).join(" ");
    return `<button type="button" class="${cls}" data-rcu data-b="${esc(b)}" data-p="${esc(p)}" data-a="${esc(a)}" title="${esc(tip)}" aria-label="${esc(tip)}" style="background:${i.cor};color:${i.texto};border-color:${i.borda}">${esc(host.codigo(b, p, a))}${s.realizadas > 1 ? `<i class="rc-n">${s.realizadas}</i>` : ""}${exe && s.liberado ? '<i class="rc-mk-lib" aria-hidden="true">✓</i>' : ""}${ex ? `<i class="rc-mk-exe" style="--c:${ex.cor}" aria-hidden="true">${esc(ex.sigla)}</i>` : ""}${km ? `<i class="rc-mk-key${km === "lost" ? " lost" : ""}"${km === "lost" ? "" : ` style="--k:${km}"`} aria-hidden="true"></i>` : ""}</button>`;
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
  return h + `<div class="legend ch-legend">${M.STATUS_ORDEM.map((s) => `<div class="lg"><span class="sw" style="background:${M.STATUS[s].cor};border-color:${M.STATUS[s].borda}"></span>${M.STATUS[s].label}</div>`).join("")}
    <div class="lg"><span class="sw" style="background:${M.SEM_REGISTRO.cor};border-color:${M.SEM_REGISTRO.borda}"></span>Sem registro</div>
    <div class="lg"><span class="sw rc-sw-n">2</span>Nº de revistorias realizadas (quando mais de uma)</div>
    <div class="lg"><span class="sw rc-sw-rep"></span>Rev. Reprovada (contorno vermelho)</div>
    ${area === "exec" ? `<div class="lg"><span class="sw rc-sw-lib">✓</span>Liberado para execução</div>
    ${M.EXECUCOES.map((e) => `<div class="lg"><span class="sw rc-sw-exe" style="--c:${e.cor}">${esc(e.sigla)}</span>${esc(e.equipe)} · ${esc(e.responsavel)}</div>`).join("")}` : ""}
    ${area === "exec" && chavesOk ? `<div class="lg rc-lg-key"><span class="rc-lg-key-t"><span class="rc-key-corner"></span>Chave (canto esquerdo):</span>${CM.SETORES_DESTINO.map((k) => `<span class="rc-lg-key-i"><i style="--k:${CM.SETORES[k].cor}"></i>${esc(CM.SETORES[k].label)}</span>`).join("")}<span class="rc-lg-key-i"><i class="lost"></i>Perdida</span><span class="rc-lg-key-i">sem marca = sem status</span></div>` : ""}
    <div class="lg ch-lg-dica">${area === "exec" ? "Toque na unidade para liberar, definir a equipe, transferir a chave ou abrir o relatório" : "Toque na unidade para agendar, registrar o resultado ou ver o histórico"}</div></div>`;
}

/* ── painel da unidade ── */
function garantirPopup() {
  if (pop) return;
  fundo = document.createElement("div"); fundo.className = "pop-backdrop ch-backdrop"; document.body.appendChild(fundo);
  pop = document.createElement("div"); pop.className = "pop pp ch-pop rc-pop"; pop.id = "rcPop"; pop.setAttribute("role", "dialog"); pop.tabIndex = -1;
  document.body.appendChild(pop);
  fundo.addEventListener("click", () => fechar());
  pop.addEventListener("click", cliquePopup);
  const editou = (e) => { const f = e.target.closest(".ch-form"); if (!f || ocupado) return; f.dataset.dirty = "1"; aviso = null; const m = pop.querySelector(".ch-msg"); if (m) { m.textContent = ""; m.className = "pp-hint ch-msg"; } if (e.target.name === "resultado") ajustarResultado(); };
  pop.addEventListener("input", editou);
  pop.addEventListener("change", editou);
  pop.addEventListener("submit", (e) => { e.preventDefault(); if (e.target.dataset.tipo === "chave") transferirChave(e.target); else enviar(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && pop.classList.contains("open")) fechar(); });
  document.addEventListener("click", (e) => { const path = e.composedPath(); if (pop.classList.contains("open") && !path.includes(pop) && !path.some((n) => n.matches?.("[data-rcu],.toast")) && !fundo.classList.contains("show")) fechar(); });
  addEventListener("resize", () => posicionar());
}
const folha = () => matchMedia("(max-width:720px)").matches;
function posicionar(ancora) {
  if (!pop?.classList.contains("open")) return;
  const sheet = folha(); pop.classList.toggle("sheet", sheet); fundo.classList.toggle("show", sheet);
  if (sheet) { pop.style.left = ""; pop.style.top = ""; return; }
  const t = ancora && ancora.isConnected ? ancora : root.querySelector(`.rc-u[data-b="${CSS.escape(cur.b)}"][data-p="${CSS.escape(cur.p)}"][data-a="${CSS.escape(cur.a)}"]`);
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
  const ac = M.acoes(u.situacao.status, podeEditar());
  painel = FORMS[acao] && ac.includes(acao) ? acao : acao === "historico" ? "historico" : mesma ? painel : "";
  if (FORMS[painel] && !pedido) pedido = novoPedido();
  pintarPopup();
  pop.classList.add("open"); posicionar(ancora);
  root.querySelectorAll(".is-sel").forEach((x) => x.classList.remove("is-sel")); if (ancora?.classList.contains("rc-u")) ancora.classList.add("is-sel");
  if (FORMS[painel]) focarForm(); else if (!folha()) pop.focus({ preventScroll: true });
  if (painel === "historico") carregarHistorico();
  if (!nomes.length && host.sb) S.responsaveis(host.sb, host.project.id).then((n) => { nomes = n; const dl = pop?.querySelector("#rcNomes"); if (dl) dl.innerHTML = n.map((x) => `<option value="${esc(x)}"></option>`).join(""); }).catch(() => {});
}
function focarForm() { const f = pop.querySelector(".ch-form"); (f?.querySelector('input[type="date"],textarea,input'))?.focus({ preventScroll: true }); }
function fechar() {
  if (!pop?.classList.contains("open")) return;
  if (preenchendo() && !confirm("Descartar o registro em andamento?")) return;
  pop.classList.remove("open", "sheet"); fundo.classList.remove("show"); cur = null; painel = ""; pedido = null; aviso = null;
  root?.querySelectorAll(".is-sel").forEach((x) => x.classList.remove("is-sel"));
}
async function carregarHistorico() {
  const id = cur?.unitId; if (!id) return;
  try { const h = await S.eventos(host.sb, id); if (cur?.unitId === id) { hist = h; pintarHistorico(); } }
  catch (err) { if (cur?.unitId === id) { hist = { erro: err.message }; pintarHistorico(); } }
}

function htmlAgendamentos(s) {
  if (!s.lista.length) return "";
  const linhas = [...s.lista].reverse().map((r) => {
    const g = M.agendamento(r), cls = g.resultado === "Aprovada" ? "ok" : g.resultado === "Reprovada" ? "rep" : g.status === "Cancelado" ? "can" : "ab";
    const det = [r.responsavel ? `Responsável: ${esc(r.responsavel)}` : "", r.realizada_em ? `realizada em ${esc(fmtD(r.realizada_em))}` : "",
      r.observacoes ? esc(r.observacoes) : "", r.resultado_obs ? `<em>${esc(r.resultado_obs)}</em>` : ""].filter(Boolean).join(" · ");
    return `<li class="rc-ag ${cls}"><div class="rc-ag1"><b>Nº ${r.numero}</b><span>${esc(quandoAg(r)) || "Sem data"}</span><span class="rc-ag-st">${esc(g.status)}${g.resultado ? ` · ${esc(g.resultado)}` : ""}</span>${r.ciclo ? `<small>${r.ciclo}º ciclo</small>` : ""}</div>${det ? `<div class="rc-ag2">${det}</div>` : ""}</li>`;
  }).join("");
  return `<div class="rc-ags"><div class="pp-label">Agendamentos <small>· ${s.realizadas} realizada(s) de ${s.lista.length}</small></div><ul>${linhas}</ul></div>`;
}

function pintarPopup() {
  if (!cur || !pop) return;
  const u = todasUnidades().find((x) => x.unitId === cur.unitId);
  if (!u) { fechar(); return; }
  const s = u.situacao, ac = M.acoes(s.status, podeEditar());
  if (FORMS[painel] && !ac.includes(painel)) { painel = ""; pedido = null; }   // ex.: outra pessoa já registrou
  const lista = host.units(), i = lista.findIndex((x) => x.b === u.b && x.p === u.p && x.a === u.a);
  const prev = FORMS[painel] ? capturarForm() : null;
  pop.setAttribute("aria-label", `${nomeUnidade(u)} · Revistoria · Cliente`);
  const botoes = s.status ? [...ac.map((a) => `<button type="button" class="btn ${painel === a ? "p" : "g"} ch-act${a === "cancelar" || a === "reabrir" ? " rc-act-sec" : ""}" data-painel="${a}" aria-pressed="${painel === a}" title="${FORMS[a].botao}">${ICONE[a]}<span>${FORMS[a].curto}</span></button>`),
    `<button type="button" class="btn ${painel === "historico" ? "p" : "g"} ch-act" data-painel="historico" aria-pressed="${painel === "historico"}">${ICONE.historico}<span>Histórico</span></button>`,
    `<button type="button" class="btn g ch-act" data-relatorio>${ICONE.relatorio}<span>Relatório</span></button>`].join("") : "";
  const prox = s.aberto ? { rot: "Próxima revistoria", val: esc(quandoAg(s.aberto)) || "Sem data", sub: s.aberto.responsavel ? esc(s.aberto.responsavel) : "sem vistoriador definido" }
    : s.ultima ? { rot: "Última revistoria", val: esc(fmtD(s.ultima.realizada_em || s.ultima.data)) || "—", sub: [esc(M.agendamento(s.ultima).resultado.toLowerCase()), esc(s.ultima.responsavel || "")].filter(Boolean).join(" · ") }
    : { rot: "Próxima revistoria", val: "—", sub: "aguardando agendamento" };
  const info = (rot, val, sub = "", cls = "") => `<div class="rc-i${cls}"><span>${rot}</span><b>${val}</b>${sub ? `<small>${sub}</small>` : ""}</div>`;
  const rep = M.reprovada(s);
  const opcard = s.status || chavesOk ? `<div class="rc-opcard">${s.status ? htmlOperacao(s) : ""}${htmlChave(u)}</div>` : "";
  // Painel (formulário ou histórico) logo abaixo das ações; agendamentos no fim.
  const area = FORMS[painel] ? htmlForm(u, painel)
    : painel === "historico" ? `<div class="ch-hist rc-area"><div class="pp-label">Histórico da revistoria</div><div id="rcHist" class="ch-hist-body"></div></div>` : "";
  pop.innerHTML = `
    <div class="pp-head">
      <div class="pp-title"><small>${esc(host.project.name)} · ${esc(localUnidade(u))}</small><strong>${esc(nomeUnidade(u))}</strong>${u.cliente ? `<em class="rc-pp-cli" title="Cliente">${esc(u.cliente)}</em>` : ""}</div>
      <div class="pp-tools">
        <button type="button" class="pp-icon" data-nav="-1" ${i <= 0 ? "disabled" : ""} aria-label="Unidade anterior">‹</button>
        <button type="button" class="pp-icon" data-nav="1" ${i >= lista.length - 1 ? "disabled" : ""} aria-label="Próxima unidade">›</button>
        ${window.AmciCentral ? `<button type="button" class="pp-icon pp-central" data-central aria-label="Histórico completo da unidade" title="Histórico completo da unidade (Central de Unidades)"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/></svg></button>` : ""}
        <button type="button" class="pp-icon" data-close aria-label="Fechar">×</button>
      </div>
    </div>
    <div class="pp-body ch-body rc-pbody">
      <div class="rc-strip">
        <div class="rc-strip-st">${badge(s.status, " lg")}${s.status ? `<span class="rc-ciclo">${s.ciclo}º ciclo</span>` : ""}${rep ? '<span class="rc-rep-tag">Rev. Reprovada</span>' : ""}</div>
        <div class="rc-strip-v"><span class="rc-strip-l">Vistoria</span>${vistPill(u.vistoria)}</div>
      </div>
      ${!s.status ? `<div class="pp-ro">Esta unidade não está na Revistoria · Cliente. Ela entra automaticamente, como <b>Em andamento</b>, quando o status da vistoria passa a <b>Revistoria</b>.</div>` : ""}
      ${botoes ? `<div class="ch-btns rc-btns">${botoes}</div>` : ""}
      ${area}
      ${area === "exec" ? opcard : ""}
      ${s.status ? `<div class="ch-now rc-info">
        ${info(prox.rot, prox.val, prox.sub, " rc-i-prox")}
        ${info("Revistorias", `${s.realizadas} realizada(s)`, s.lista.length ? `${s.lista.length} agendamento(s)` : "nenhum agendamento")}
        ${info("Última alteração", s.atualizadoEm ? fmtDH(s.atualizadoEm) : "—", s.atualizadoPor ? `por ${esc(s.atualizadoPor === "migração" ? "situação inicial" : s.atualizadoPor)}` : "")}
      </div>` : ""}
      ${htmlReprovacao(s)}
      ${area === "exec" ? "" : opcard}
      ${s.status && !podeEditar() ? `<div class="pp-ro rc-ro">Acesso de consulta: agendamentos e resultados são registrados por administradores e pela equipe de revistorias.</div>` : ""}
      ${painel === "historico" ? "" : htmlAgendamentos(s)}
    </div>`;
  if (prev && prev.tipo === painel) restaurarForm(prev);
  if (painel === "resultado") ajustarResultado();
  if (painel === "historico") pintarHistorico();
  if (aviso) mostrarAviso(aviso.msg, aviso.tipo);
}

/** Última reprovação (pendências que motivaram), quando a unidade está em Rev. Reprovada. */
function htmlReprovacao(s) {
  if (!M.reprovada(s)) return "";
  const r = M.ultimaReprovacao(s);
  return `<div class="rc-repcard" role="status"><div class="rc-rep-h"><b>Revistoria reprovada</b>${r ? `<span>nº ${r.numero} · ${esc(fmtD(r.realizada_em || r.data))}${r.responsavel ? ` · ${esc(r.responsavel)}` : ""}</span>` : ""}</div>
    ${r?.resultado_obs ? `<div class="rc-rep-t"><span>Apontamentos:</span> ${esc(r.resultado_obs)}</div>` : ""}<div class="rc-rep-d">Veja o relatório da unidade para o checklist completo.</div></div>`;
}
/** Status da chave (Controle de Chaves): consulta e, para admin/revistorias, transferência rápida. */
function htmlChave(u) {
  if (!chavesOk) return "";
  const k = u.chave, o = k.perdida, pode = podeEditar() && !o;
  const form = painel === "chave" && pode ? `<form class="ch-form rc-keyform" data-tipo="chave" novalidate>
      <div class="pp-f pp-full"><span>Setor de destino</span><div class="ch-setores" role="radiogroup" aria-label="Setor de destino">${CM.SETORES_DESTINO.map((st) =>
        `<label class="ch-setor" style="--c:${CM.SETORES[st].cor}"><input type="radio" name="setor" value="${st}"><span><i></i>${CM.SETORES[st].label}${k.setor === st ? "<small>atual</small>" : ""}</span></label>`).join("")}</div></div>
      <label class="pp-f pp-full"><span>Responsável que está recebendo a chave</span><input name="responsavel" placeholder="Nome" autocomplete="off" maxlength="80"></label>
      <div class="pp-actions pp-full"><span class="pp-hint ch-msg" role="status"></span><button type="button" class="btn g" data-painel="">Voltar</button><button type="submit" class="btn p">Transferir chave</button></div></form>` : "";
  const det = o ? `perdida desde ${fmtDH(o.registrado_em)} · etapa <b>${esc(CM.ETAPAS[o.etapa]?.label || o.etapa)}</b> · trate na aba Controle de Chaves`
    : k.setor === "sem" ? "nenhum setor registrado no Controle de Chaves"
    : [k.responsavel ? `com <b>${esc(k.responsavel)}</b>` : "", k.movimentadoEm ? `desde ${fmtDH(k.movimentadoEm)}` : "", k.movimentadoPor ? `por ${esc(k.movimentadoPor)}` : ""].filter(Boolean).join(" · ");
  return `<div class="rc-or rc-or-key"><span class="rc-or-t">${ICONE.chave}Chave</span>
      <div class="rc-or-v"><span class="rc-sr">Status da chave</span>${chavePill(k, " sm")}${pode ? `<button type="button" class="btn g ch-mini rc-or-btn${painel === "chave" ? " on" : ""}" data-painel="chave">Transferir</button>` : ""}</div>
      ${det ? `<div class="rc-or-d">${det}</div>` : ""}${form}</div>`;
}

/** Liberação e execução: controles para admin/revistorias (gravam na hora); consulta para os demais. */
function htmlOperacao(s) {
  const dis = salvando ? " disabled" : "", ed = podeEditar(), ex = M.execInfo(s.execucao);
  const quemLib = s.liberadoEm ? `${fmtDH(s.liberadoEm)}${s.liberadoPor ? ` · ${esc(s.liberadoPor)}` : ""}` : "";
  const lib = ed ? `<button type="button" class="rc-tog${s.liberado ? " on" : ""}" role="switch" aria-checked="${s.liberado}" data-lib="${!s.liberado}"${dis}><i></i>${s.liberado ? "Liberado" : "Não liberado"}</button>` : libPill(s.liberado);
  const exe = ed ? `<div class="rc-exe-opts" role="radiogroup" aria-label="Execução">${M.EXECUCOES.map((e) => `<button type="button" role="radio" aria-checked="${s.execucao === e.key}" class="rc-exe-opt${s.execucao === e.key ? " sel" : ""}" style="--c:${e.cor}" data-exe="${e.key}" title="${esc(e.equipe)} · ${esc(e.responsavel)}"${dis}><i>${esc(e.sigla)}</i><span>${esc(e.responsavel)}<small>${esc(e.equipe)}</small></span></button>`).join("")}</div>
      ${s.execucao ? `<button type="button" class="rc-exe-none" data-exe=""${dis}>Remover execução</button>` : ""}`
    : ex ? execPill(s.execucao) : '<b class="rc-mut">Não definida</b>';
  return `<div class="rc-or rc-or-lib"><span class="rc-or-t">Liberação</span><div class="rc-or-v">${lib}${quemLib ? `<small class="rc-or-q">${quemLib}</small>` : ""}</div></div>
    <div class="rc-or rc-or-ex"><span class="rc-or-t">Execução</span><div class="rc-or-v rc-or-exe">${exe}</div>
      ${!ed && ex ? `<div class="rc-or-d">Equipe ${esc(ex.equipe)} · Responsável ${esc(ex.responsavel)}</div>` : ""}</div>
    ${salvando ? `<div class="rc-op-msg">Salvando…</div>` : ""}`;
}
async function salvarOperacao(tipo, valor) {
  if (salvando || !cur) return;
  const u = todasUnidades().find((x) => x.unitId === cur.unitId); if (!u?.situacao.status) return;
  const s = u.situacao;
  if (tipo === "execucao" && (valor || null) === (s.execucao || null)) return;
  salvando = tipo; pintarPopup();
  try {
    const args = { unitId: u.unitId, pedido: novoPedido() };
    const r = tipo === "liberacao" ? await S.liberar(host.sb, { ...args, liberado: valor })
      : await S.execucao(host.sb, { ...args, execucao: valor || null, anterior: s.execucao || null });
    host.toast(tipo === "liberacao" ? (valor ? "Unidade liberada para execução" : "Liberação retirada")
      : valor ? `Execução: ${M.execRotulo(valor)}` : "Execução removida");
    salvando = ""; await host.recarregar?.(r);
  } catch (err) {
    salvando = ""; host.toast(err.message || "Não foi possível salvar"); await host.recarregar?.();
  }
  pintarConteudo(); pintarPopup(); if (painel === "historico") carregarHistorico();
}

function htmlForm(u, tipo) {
  const F = FORMS[tipo], s = u.situacao, usuario = host.usuario()?.nome || "", ab = s.aberto;
  const dl = `<datalist id="rcNomes">${nomes.map((n) => `<option value="${esc(n)}"></option>`).join("")}</datalist>`;
  const campoResp = (rot, valor, req = true) => `<label class="pp-f pp-full"><span>${esc(rot)}</span><input name="responsavel" list="rcNomes" placeholder="Nome" autocomplete="off" maxlength="80" value="${esc(valor)}"${req ? " required" : ""}>${dl}</label>`;
  const obs = (rot, ph, req = false) => `<label class="pp-f pp-full"><span>${esc(rot)}</span><textarea name="obs" rows="2" maxlength="500" placeholder="${esc(ph)}"${req ? " required" : ""}></textarea></label>`;
  let corpo = "", nota = "";
  if (tipo === "agendar" || tipo === "remarcar") {
    corpo = `<div class="rc-dh pp-full"><label class="pp-f"><span>Data da revistoria</span><input type="date" name="data" required></label>
        <label class="pp-f"><span>Horário <small>(opcional)</small></span><input type="time" name="horario" step="900"></label></div>
      ${campoResp("Vistoriador / responsável (opcional)", tipo === "remarcar" ? ab?.responsavel || "" : "", false)}
      ${obs("Observações (opcional)", "Ex.: cliente pediu período da manhã, levar chave da CX…")}`;
    nota = tipo === "remarcar" ? `O agendamento atual (${esc(quandoAg(ab)) || "sem data"}) fica no histórico como <b>Cancelado</b> e a unidade continua <b>Agendado</b> na nova data.`
      : `A unidade passa para <b>Agendado</b>. Cada agendamento fica guardado no histórico.`;
  } else if (tipo === "resultado") {
    corpo = `<div class="pp-f pp-full"><span>Resultado</span><div class="rc-res" role="radiogroup" aria-label="Resultado">
        <label class="rc-opt ok"><input type="radio" name="resultado" value="Aprovada"><span>Aprovada<small>cliente aprovou</small></span></label>
        <label class="rc-opt rep"><input type="radio" name="resultado" value="Reprovada"><span>Reprovada<small>novas pendências</small></span></label></div></div>
      <label class="pp-f pp-full"><span>Data da realização</span><input type="date" name="realizada" required value="${esc(ab?.data && ab.data <= hoje() ? String(ab.data).slice(0, 10) : hoje())}" max="${esc(hoje())}"></label>
      ${campoResp("Responsável pela revistoria", ab?.responsavel || usuario)}
      <label class="pp-f pp-full"><span class="rc-obs-l">Observações (opcional)</span><textarea name="obs" rows="2" maxlength="500" placeholder="Ex.: tudo conforme, pendências corrigidas…"></textarea></label>`;
    nota = `<span class="rc-n-ok">Aprovada: a unidade fica <b>Aprovado</b> e a vistoria passa de Revistoria para <b>Revistoria Finalizada</b>, com a data e o responsável.</span><span class="rc-n-rep" hidden>Reprovada: começa um novo ciclo e a unidade volta para <b>Em andamento</b>, aguardando novo agendamento.</span>`;
  } else if (tipo === "cancelar") {
    corpo = obs("Motivo (opcional)", "Ex.: cliente desmarcou, sem acesso à unidade…");
    nota = `O agendamento de ${esc(quandoAg(ab)) || "—"} fica no histórico como <b>Cancelado</b> e a unidade volta para <b>Em andamento</b>.`;
  } else if (tipo === "reabrir") {
    corpo = obs("Novas pendências", "Descreva o que o cliente apontou", true);
    nota = `Começa um novo ciclo: a unidade volta para <b>Em andamento</b> e a vistoria, se estiver em Revistoria Finalizada, volta para <b>Revistoria</b>. As revistorias anteriores ficam no histórico.`;
  }
  return `<form class="ch-form rc-form" data-tipo="${tipo}" novalidate>
      ${corpo}
      <p class="ch-nota pp-full">${nota}</p><p class="ch-nota pp-full ch-auto">Data, hora e usuário da alteração são registrados automaticamente.</p>
      <div class="pp-actions pp-full"><span class="pp-hint ch-msg" role="status"></span><button type="button" class="btn g" data-painel="">Voltar</button><button type="submit" class="btn p${tipo === "cancelar" ? " rc-btn-sec" : ""}"${ocupado ? " disabled" : ""}>${ocupado ? "Registrando…" : esc(F.ok)}</button></div>
    </form>`;
}
function ajustarResultado() {
  const f = pop?.querySelector('.rc-form[data-tipo="resultado"]'); if (!f) return;
  const rep = f.querySelector('input[name="resultado"]:checked')?.value === "Reprovada";
  f.querySelector(".rc-obs-l").textContent = rep ? "Pendências encontradas" : "Observações (opcional)";
  f.elements.obs.placeholder = rep ? "Descreva as pendências que o cliente apontou" : "Ex.: tudo conforme, pendências corrigidas…";
  f.querySelector(".rc-n-ok").hidden = rep; f.querySelector(".rc-n-rep").hidden = !rep;
}
function capturarForm() {
  const f = pop?.querySelector(".ch-form"); if (!f) return null;
  const v = (n) => f.elements[n]?.value || "";
  return { tipo: f.dataset.tipo, data: v("data"), horario: v("horario"), responsavel: v("responsavel"), obs: v("obs"), realizada: v("realizada"),
    resultado: f.querySelector('input[name="resultado"]:checked')?.value || "", dirty: !!f.dataset.dirty };
}
function restaurarForm(s) {
  const f = pop.querySelector(".ch-form"); if (!f) return;
  ["data", "horario", "responsavel", "obs", "realizada"].forEach((n) => { if (f.elements[n] && s[n] !== undefined && (s.dirty || s[n])) f.elements[n].value = s[n]; });
  if (s.resultado) { const r = f.querySelector(`input[name="resultado"][value="${s.resultado}"]`); if (r) r.checked = true; }
  if (s.dirty) f.dataset.dirty = "1";
}
function pintarHistorico() {
  const el = pop?.querySelector("#rcHist"); if (!el) return;
  if (!hist) { el.innerHTML = '<div class="ch-hist-empty">Carregando…</div>'; return; }
  if (hist.erro) { el.innerHTML = `<div class="ch-hist-empty">Não foi possível carregar o histórico.</div>`; return; }
  if (!hist.length) { el.innerHTML = '<div class="ch-hist-empty">Nenhum registro para esta unidade.</div>'; return; }
  el.innerHTML = `<ol class="ch-hist-l">${hist.map((e) => {
    const d = M.descreverEvento(e);
    const rota = d.mantemStatus ? "" : d.de && d.de !== d.para ? `${badge(d.de, " sm")}<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>${badge(d.para, " sm")}` : badge(d.para, " sm");
    return `<li style="--c:${d.cor}"><div class="ch-h1"><b>${esc(d.titulo)}</b><span class="ch-rota">${rota}</span><time>${fmtDH(d.quando)}</time></div>
      ${d.texto ? `<div class="ch-h2">${esc(d.texto)}</div>` : ""}<div class="ch-h4">${d.ciclo}º ciclo · registrado por ${esc(d.por)}</div></li>`;
  }).join("")}</ol>`;
}
function mostrarAviso(msg, tipo = "err") {
  aviso = { msg, tipo }; const el = pop?.querySelector(".ch-msg"); if (el) { el.textContent = msg; el.className = `pp-hint ch-msg ${tipo}`; }
}

function cliquePopup(e) {
  const t = e.target;
  if (t.closest("[data-close]")) { fechar(); return; }
  if (t.closest("[data-relatorio]")) { const c = cur; if (c) abrirRel(c.b, c.p, c.a); return; }
  if (t.closest("[data-central]")) { const c = cur; if (c) window.AmciCentral?.abrirUnidade(c.unitId); return; }
  const lb = t.closest("[data-lib]");
  if (lb && !lb.disabled) { salvarOperacao("liberacao", lb.dataset.lib === "true"); return; }
  const ex = t.closest("[data-exe]");
  if (ex && !ex.disabled) { salvarOperacao("execucao", ex.dataset.exe); return; }
  const nav = t.closest("[data-nav]");
  if (nav) {
    const l = host.units(), i = l.findIndex((x) => x.b === cur.b && x.p === cur.p && x.a === cur.a), n = l[i + Number(nav.dataset.nav)];
    if (n) { if (preenchendo() && !confirm("Descartar o registro em andamento?")) return; painel = ""; pop.querySelector(".ch-form")?.removeAttribute("data-dirty"); const anc = root.querySelector(`.rc-u[data-b="${CSS.escape(n.b)}"][data-p="${CSS.escape(n.p)}"][data-a="${CSS.escape(n.a)}"]`); abrir(n.b, n.p, n.a, anc); }
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
  const tipo = painel, u = todasUnidades().find((x) => x.unitId === cur.unitId), v = capturarForm(), s = u.situacao;
  const erro = tipo === "agendar" || tipo === "remarcar" ? M.validarAgendamento(v, hoje()) : tipo === "resultado" ? M.validarResultado(v, hoje())
    : tipo === "reabrir" ? M.validarReabrir(v.obs) : String(v.obs || "").trim().length > 500 ? "Observação muito longa (máximo de 500 caracteres)" : "";
  if (erro) { mostrarAviso(erro); return; }
  pedido = pedido || novoPedido();   // o mesmo pedido em novas tentativas: o banco não grava duas vezes
  ocupado = true; mostrarAviso("Registrando…", "info");
  const f = pop.querySelector(".ch-form"), b0 = f.querySelector("[type=submit]"); b0.disabled = true; b0.textContent = "Registrando…";
  const args = { unitId: u.unitId, versao: s.versao, pedido, data: v.data, horario: v.horario, responsavel: M.limparNome(v.responsavel), obs: v.obs.trim(),
    resultado: v.resultado, realizada: v.realizada };
  const fazer = { agendar: S.agendar, remarcar: S.agendar, resultado: S.resultado, cancelar: S.cancelar, reabrir: S.reabrir }[tipo];
  const msgOk = { agendar: `Revistoria agendada para ${fmtD(v.data)}`, remarcar: `Revistoria remarcada para ${fmtD(v.data)}`,
    resultado: v.resultado === "Aprovada" ? "Revistoria aprovada" : "Revistoria reprovada: novo ciclo em andamento", cancelar: "Agendamento cancelado", reabrir: "Revistoria reaberta: novo ciclo em andamento" }[tipo];
  try {
    const r = await fazer(host.sb, args);
    ocupado = false; pedido = null; aviso = null; painel = "historico"; hist = null;
    pop.querySelector(".ch-form")?.removeAttribute("data-dirty");
    host.toast(r?.repetido ? "Já registrado" : msgOk);
    await host.recarregar?.(r);
    pintarPopup(); carregarHistorico(); pintarConteudo();
  } catch (err) {
    ocupado = false;
    const rede = /fetch|network|rede|failed/i.test(err.message || "");
    if (!rede) pedido = novoPedido();
    mostrarAviso(err.message || "Não foi possível registrar.");
    const b = pop.querySelector(".ch-form [type=submit]"); if (b) { b.disabled = false; b.textContent = FORMS[tipo].ok; }
    if (!rede) { const msg = aviso; await host.recarregar?.(); pintarConteudo(); if (pop.querySelector(".ch-form") && msg) { pintarPopup(); mostrarAviso(msg.msg, msg.tipo); } else if (msg) { pintarPopup(); host.toast(msg.msg); } }
  }
}

/* ── chaves e relatórios (dados do condomínio) ── */
async function carregarChaves() {
  if (!host?.sb || !host.project) return;
  const pid = host.project.id;
  try {
    const d = await CS.carregarCondominio(host.sb, pid);
    if (host?.project?.id !== pid) return;
    const oc = new Map(d.ocorrencias.map((o) => [o.unit_id, o]));
    chaves = new Map(d.unidades.map((r) => [r.unit_id, CM.situacao(r, oc.get(r.unit_id))])); chavesOk = true;
  } catch (err) { console.warn("Revistoria: status da chave indisponível", err); chavesOk = false; }
  await carregarRelatorios(false);
  if (root?.isConnected) { pintarConteudo(); if (cur && !preenchendo() && !ocupado) pintarPopup(); }
}
/** Relatórios e apontamentos do condomínio → botão Relatório e colunas Qtd. Apontamentos / Qtd. Resolvidas. */
async function carregarRelatorios(repintar = true) {
  if (!host?.sb || !host.project) return;
  const pid = host.project.id;
  try {
    const [rels, aps] = await Promise.all([S.relatoriosCondominio(host.sb, pid), S.apontamentosCondominio(host.sb, pid)]);
    if (host?.project?.id !== pid) return;
    comRelatorio = new Set(rels.map((r) => r.unit_id)); apont = M.resumoPorUnidade(aps, rels); apontOk = true;
  } catch (err) { console.warn("Revistoria: apontamentos indisponíveis", err); if (host?.project?.id === pid) { comRelatorio = new Set(); apont = new Map(); apontOk = true; } }
  if (repintar && root?.isConnected) pintarConteudo();
}
function agendarRelatorios() { clearTimeout(recargaRel); recargaRel = setTimeout(() => carregarRelatorios(), 300); }
function agendarChaves() { clearTimeout(recargaChaves); recargaChaves = setTimeout(carregarChaves, 400); }
function abrirRel(b, p, a) {
  const u = todasUnidades().find((x) => x.b === b && x.p === p && x.a === a); if (!u) return;
  abrirRelatorio({ host, u, podeEditar: podeEditar(), aoMudar: () => agendarRelatorios() });
}
async function transferirChave(f) {
  const u = todasUnidades().find((x) => x.unitId === cur?.unitId); if (!u) return;
  const setor = f.querySelector('input[name="setor"]:checked')?.value || "", resp = CM.limparNome(f.elements.responsavel.value);
  const erro = CM.validarTransferencia({ setor, responsavel: resp }, u.chave);
  const msg = f.querySelector(".ch-msg");
  if (erro) { msg.textContent = erro; msg.className = "pp-hint ch-msg err"; return; }
  const b = f.querySelector("[type=submit]"); b.disabled = true; b.textContent = "Transferindo…";
  try {
    await CS.transferir(host.sb, { unitId: u.unitId, setor, responsavel: resp, ultimaMov: u.chave.ultimaMov, pedido: novoPedido() });
    host.toast(`Chave transferida para ${CM.setorLabel(setor)} · ${resp}`); painel = ""; await carregarChaves();
  } catch (err) { msg.textContent = err.message || "Não foi possível transferir"; msg.className = "pp-hint ch-msg err"; b.disabled = false; b.textContent = "Transferir chave"; agendarChaves(); }
}

/* ── API para a tela de Vistorias ── */
const api = {
  /** Mostra a aba. */
  show(h, entrando = false) {
    host = h; root = document.getElementById("revcliRoot");
    if (entrando) modo = "mapa";   // ao abrir (ou voltar para) a aba, o Mapa é a visualização principal
    if (!root || !host.project) return;
    if (projId !== host.project.id) {
      filt = FILTRO0(); nomes = []; projId = host.project.id; delete root.dataset.proj;
      chaves = new Map(); chavesOk = false; comRelatorio = new Set(); apont = new Map(); apontOk = false;
      if (pop?.classList.contains("open")) { pop.querySelector(".ch-form")?.removeAttribute("data-dirty"); fechar(); }
    }
    pintar();
    // status da chave e relatórios: carregados ao abrir a aba e atualizados em tempo real (Controle de Chaves)
    if (chavesProj !== host.project.id) {
      cancelarChaves?.(); cancelarChaves = null; chavesProj = host.project.id;
      if (host.sb) { try { cancelarChaves = CS.assinar(host.sb, chavesProj, agendarChaves); } catch { cancelarChaves = null; } }
      // apontamentos marcados/desmarcados em qualquer aparelho atualizam a Lista
      cancelarRel?.(); cancelarRel = null;
      if (host.sb) { try { cancelarRel = S.assinarRelatorios(host.sb, chavesProj, agendarRelatorios); } catch { cancelarRel = null; } }
    }
    carregarChaves();
  },
  hide() { if (pop?.classList.contains("open")) fechar(); },
  /** Abre o painel de uma unidade pelo id (vindo da Central Operacional). */
  abrirUnidade(unitId) {
    if (!host || !root) return;
    const u = todasUnidades().find((x) => x.unitId === Number(unitId)); if (!u) return;
    const anc = root.querySelector(`.rc-u[data-b="${CSS.escape(u.b)}"][data-p="${CSS.escape(u.p)}"][data-a="${CSS.escape(u.a)}"]`);
    anc?.scrollIntoView({ block: "center", inline: "center" });
    abrir(u.b, u.p, u.a, anc);
  },
  /** Situação, agendamentos ou status da vistoria mudaram (carga, tempo real ou outra aba). */
  dadosMudaram() {
    if (!host || !root?.isConnected || !root.offsetParent) return;
    if (root.dataset.proj !== String(host.project?.id)) { pintar(); return; }
    pintarConteudo(); if (cur && !preenchendo() && !ocupado) pintarPopup();
  },
  reset() { cancelarChaves?.(); cancelarChaves = null; cancelarRel?.(); cancelarRel = null; chavesProj = null; chaves = new Map(); chavesOk = false; apont = new Map(); apontOk = false; projId = null; nomes = []; if (pop) { pop.querySelector(".ch-form")?.removeAttribute("data-dirty"); fechar(); } if (root) { root.innerHTML = ""; delete root.dataset.proj; } }
};
window.AmciRevCliente = api;
export default api;
