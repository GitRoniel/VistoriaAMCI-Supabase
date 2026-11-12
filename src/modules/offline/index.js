// Central Offline (www/offline.html → www/offline.js): prepara condomínios para consulta sem internet, guarda os
// relatórios (PDF) no aparelho, sincroniza só o que mudou e abre os documentos guardados sem depender do servidor.
//
// Arquitetura (Safari/iPhone e PWA):
//   • Service Worker (www/sw.js): guarda as telas e scripts do aplicativo para abrir sem internet;
//   • IndexedDB (store.js): um banco por usuário com os PDFs, metadados, fila de downloads e checklists;
//   • Supabase: lista o que o usuário pode ver (RLS) e entrega cada arquivo por URL assinada e temporária.
// Limites do iOS respeitados: nada roda em segundo plano — os downloads acontecem com a página aberta; se o Safari
// fechar, a fila fica guardada e é retomada ao abrir a Central de novo (com internet). O espaço é pedido como
// persistente (navigator.storage.persist) quando o navegador permite; mesmo assim o sistema pode limpar dados de
// sites pouco usados — a Central mostra o que está guardado e permite preparar de novo.
import { initTheme } from "../../platform/core/theme.js";
import { signOut } from "../../platform/core/auth.js";
import { getSupabase } from "../../platform/core/supabase.js";
import { mountHmUser } from "../../platform/ui/hmbar.js";
import { HOME_URL } from "../../platform/core/config.js";
import { esc } from "../../platform/core/utils.js";
import { appHeaderHTML, secHeadHTML, stateHTML, toast } from "../../platform/ui/shell.js";
import * as O from "./model.js";
import { abrirBanco, bancosDeOutrasContas, apagarBanco } from "./store.js";
import { listarObras, catalogoServidor, criarExecutor } from "./sync.js";
import { criarVisualizador } from "../revistoria-cliente/visualizador.js";

const page = document.getElementById("app");
const IC = {
  nuvem: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 18a5 5 0 1 1 .9-9.9A6 6 0 0 1 19 10a4 4 0 0 1-1 7.9"/><path d="M12 12v8m0 0-3-3m3 3 3-3"/></svg>',
  ok: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="m7.5 12.5 3 3 6-6.5"/></svg>',
  sinc: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12a9 9 0 0 1 15.5-6.2L21 8"/><path d="M21 3v5h-5M21 12a9 9 0 0 1-15.5 6.2L3 16"/><path d="M3 21v-5h5"/></svg>',
  lixo: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/></svg>',
  pdf: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/></svg>',
  wifi: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0M2 9a15 15 0 0 1 20 0"/><circle cx="12" cy="19.5" r="1"/></svg>',
  semWifi: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 3l18 18M8.5 16a5 5 0 0 1 7 0M5 12.5a10 10 0 0 1 4.3-2.5M2 9a15 15 0 0 1 6.3-3.6M15.5 10.2A10 10 0 0 1 19 12.5M17.7 6A15 15 0 0 1 22 9"/><circle cx="12" cy="19.5" r="1"/></svg>'
};
const ST_DOC = { ok: "g", atualizacao: "b", falha: "r", baixando: "y", online: "n", removido: "n" };

let sb = null, store = null, usuario = null, online = navigator.onLine;
let obrasSrv = [], catSrv = [], catEm = null, guardados = new Map(), obrasLocais = new Map(), fila = [];
let selObra = "", tipos = { ...O.SELECAO_PADRAO }, estimativa = null, persistente = null, outrasContas = null;
let filtroDocs = { obra: "", bloco: "", busca: "", soOffline: false, ordem: "unidade" };
let executor = null, progresso = null, alvoAtual = null, relatorio = null, carregandoCat = false, erroCat = "";

/* ── início ── */
async function boot() {
  initTheme();
  registrarSW();
  frame(stateHTML({ title: "Abrindo a Central Offline…", spinner: true }));
  sb = getSupabase();
  usuario = await identificar();
  if (!usuario) {
    frame(stateHTML({ title: "Entre na sua conta", text: online ? "Faça login na página inicial (marque “Manter conectado” para usar os documentos sem internet)." : "Sem internet e sem uma conta conectada neste aparelho. Os documentos offline só abrem com a conta que os baixou.", action: `<a class="pf-btn primary" href="${HOME_URL}">Ir para a página inicial</a>` }));
    return;
  }
  try { store = await abrirBanco(usuario.id); } catch (err) { frame(stateHTML({ title: "Armazenamento indisponível", text: err.message })); return; }
  window.__amciOffline = { store, usuario };   // usado nos testes automáticos
  await recarregarLocal();
  try { persistente = await navigator.storage?.persisted?.(); } catch { persistente = null; }
  outrasContas = await bancosDeOutrasContas(usuario.id);
  executor = criarExecutor({ sb, store, aoProgresso: (p) => { progresso = p; pintarProgresso(); if (["concluido", "pausado", "interrompido", "erro"].includes(p.fase)) aoTerminar(p); } });
  montar();
  addEventListener("online", () => { online = true; pintarConexao(); atualizarCatalogo().then(() => { retomarSePreciso(); }); });
  addEventListener("offline", () => { online = false; pintarConexao(); pintarTudo(); });
  if (online) await atualizarCatalogo();
  retomarSePreciso();
}

function frame(body) {
  page.innerHTML = appHeaderHTML({ tabs: [] }) + `<div class="pf-page of-page" id="pfBody">${body}</div>`;
  const u = page.querySelector(".hm-user"); if (u) u.hidden = !usuario;
  if (usuario) mountHmUser({ name: usuario.nome || usuario.email, email: usuario.email, onLogout: async () => { await signOut(); location.href = HOME_URL; } });
}

/** Usuário: com internet, a sessão do Supabase; sem internet, o usuário da sessão guardada no aparelho (sem token). */
async function identificar() {
  const local = usuarioGuardado();
  if (online && sb) {
    try {
      const r = await Promise.race([sb.auth.getSession(), new Promise((ok) => setTimeout(() => ok(null), 6000))]);
      const u = r?.data?.session?.user;
      if (u?.id) {
        let nome = "";
        try { const { data } = await sb.from("profiles").select("full_name").eq("id", u.id).maybeSingle(); nome = data?.full_name || ""; } catch { /* sem nome */ }
        return { id: String(u.id), email: u.email || "", nome };
      }
      if (r) return null;   // respondeu: não há sessão
    } catch { /* cai para a sessão guardada */ }
  }
  return local ? { ...local, nome: "" } : null;
}
function usuarioGuardado() {
  for (const st of [() => localStorage, () => sessionStorage]) {
    try {
      const s = st();
      for (let i = 0; i < s.length; i++) { const k = s.key(i); if (/^sb-.+-auth-token$/.test(k)) { const u = O.usuarioDaSessao(s.getItem(k)); if (u) return u; } }
    } catch { /* armazenamento indisponível */ }
  }
  return null;
}
function registrarSW() {
  if (!("serviceWorker" in navigator) || !/^https?:$/.test(location.protocol)) return;
  navigator.serviceWorker.register("/sw.js").catch(() => {});
}

async function recarregarLocal() {
  guardados = new Map((await store.docs()).map((d) => [d.id, d]));
  obrasLocais = new Map((await store.obras()).map((o) => [Number(o.projectId), o]));
  fila = await store.fila();
  const cache = await store.meta("catalogo");
  if (!catSrv.length && cache?.docs) { catSrv = cache.docs; obrasSrv = cache.obras || []; catEm = cache.em; }
  try { estimativa = await navigator.storage?.estimate?.(); } catch { estimativa = null; }
}
async function atualizarCatalogo() {
  if (!online || !sb) return;
  carregandoCat = true; erroCat = ""; pintarTudo();
  try {
    obrasSrv = await listarObras(sb);
    const { docs, checklists } = await catalogoServidor(sb, obrasSrv);
    catSrv = docs; catEm = new Date().toISOString();
    await store.salvarMeta("catalogo", { docs, obras: obrasSrv, em: catEm });
    const porObra = new Set(obrasLocais.keys());
    await store.salvarChecklists(checklists.filter((c) => porObra.has(c.projectId)));
    // documentos guardados que deixaram de estar disponíveis ao usuário (apagados ou sem permissão): saem do aparelho
    const ids = new Set(catSrv.map((d) => d.id)), obrasOk = new Set(obrasSrv.map((o) => o.id));
    const sair = [...guardados.values()].filter((d) => !ids.has(d.id)).map((d) => d.id);
    if (sair.length) { await store.remover(sair); toast(`${sair.length} documento(s) não estão mais disponíveis para você e saíram do aparelho.`); }
    for (const pid of obrasLocais.keys()) if (!obrasOk.has(pid)) await store.removerObra(pid);
    if (!selObra) {   // sugere o condomínio com mais relatórios
      const n = new Map(); for (const d of catSrv) n.set(d.projectId, (n.get(d.projectId) || 0) + 1);
      selObra = String([...obrasSrv].sort((x, y) => (n.get(y.id) || 0) - (n.get(x.id) || 0))[0]?.id || "");
    }
  } catch (err) { console.error(err); erroCat = "Não foi possível consultar o servidor agora."; }
  carregandoCat = false;
  await recarregarLocal(); pintarTudo();
}

/* ── tela ── */
function montar() {
  frame(`${secHeadHTML({ icon: IC.nuvem, title: "Central Offline", subtitle: "Relatórios guardados neste aparelho para consulta sem internet" })}
    <div id="ofConexao" class="of-conexao"></div>
    <div id="ofResumo" class="pf-kpis of-kpis"></div>
    <div id="ofRetomar"></div>
    <section class="pf-card of-sec of-preparar" id="ofPreparar"></section>
    <section class="pf-card of-sec" id="ofProgresso" hidden></section>
    <section class="pf-card of-sec" id="ofObras"></section>
    <section class="pf-card of-sec" id="ofDocs"></section>
    <section class="pf-card of-sec of-gerenciar" id="ofGerenciar"></section>`);
  page.addEventListener("click", clique);
  page.addEventListener("change", mudanca);
  page.addEventListener("input", (e) => { if (e.target.id === "ofBusca") { filtroDocs.busca = e.target.value; pintarDocs(); } });
  pintarTudo();
}
function pintarTudo() { if (!page.querySelector("#ofResumo")) return; pintarConexao(); pintarResumo(); pintarRetomar(); pintarPreparar(); pintarProgresso(); pintarObras(); pintarDocs(); pintarGerenciar(); }

function pintarConexao() {
  const el = page.querySelector("#ofConexao"); if (!el) return;
  el.className = "of-conexao " + (online ? "on" : "off");
  el.innerHTML = online
    ? `${IC.wifi}<b>Conectado</b><span>${carregandoCat ? "consultando o servidor…" : catEm ? `servidor consultado ${esc(O.fmtDataHora(catEm))}` : ""}${erroCat ? ` · ${esc(erroCat)}` : ""}</span>`
    : `${IC.semWifi}<b>Sem internet</b><span>os documentos guardados abaixo continuam disponíveis</span>`;
}
const obrasConhecidas = () => {
  const m = new Map(obrasSrv.map((o) => [o.id, o.nome]));
  for (const [id, o] of obrasLocais) if (!m.has(id)) m.set(id, o.nome);
  for (const d of guardados.values()) if (!m.has(Number(d.projectId))) m.set(Number(d.projectId), d.obra);
  return [...m.entries()].map(([id, nome]) => ({ id, nome })).sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
};
const tiposDaObra = (pid) => obrasLocais.get(Number(pid))?.tipos || tipos;
/** Documentos escolhidos para a obra (do catálogo do servidor; sem ele, os guardados). */
function selecionadosDaObra(pid) {
  const srv = catSrv.filter((d) => Number(d.projectId) === Number(pid));
  return srv.length || online ? O.selecionar(srv, { tipos: tiposDaObra(pid) }) : [...guardados.values()].filter((d) => Number(d.projectId) === Number(pid));
}
const filaIds = () => new Set(fila.map((f) => f.id));
function situacaoDe(pid) { return O.situacaoObra(selecionadosDaObra(pid), guardados, filaIds()); }

function pintarResumo() {
  const el = page.querySelector("#ofResumo"); if (!el) return;
  const ok = [...guardados.values()].filter((d) => d.status === "ok" || d.versaoOk);
  const bytes = ok.reduce((s, d) => s + (d.bytes || 0), 0);
  const prep = [...obrasLocais.keys()].filter((pid) => situacaoDe(pid).preparada).length;
  const livre = estimativa?.quota ? Math.max(0, estimativa.quota - (estimativa.usage || 0)) : null;
  el.innerHTML = `<div class="pf-kpi ok"><div class="kl">Documentos offline</div><div class="kv">${ok.length}</div></div>
    <div class="pf-kpi blue"><div class="kl">Condomínios preparados</div><div class="kv">${prep}<small> de ${obrasLocais.size}</small></div></div>
    <div class="pf-kpi"><div class="kl">Espaço utilizado</div><div class="kv">${esc(O.fmtBytes(bytes))}</div></div>
    <div class="pf-kpi gold"><div class="kl">Espaço disponível</div><div class="kv">${livre == null ? "—" : esc(O.fmtBytes(livre))}</div></div>
    <div class="pf-kpi ${persistente ? "ok" : "warn"}" title="Armazenamento persistente: o sistema evita apagar estes arquivos para liberar espaço"><div class="kl">Armazenamento</div><div class="kv of-kv-s">${persistente ? "Persistente" : persistente === false ? "Pode ser limpo pelo sistema" : "—"}</div></div>`;
}
function pintarRetomar() {
  const el = page.querySelector("#ofRetomar"); if (!el) return;
  const rodando = executor?.rodando;
  el.innerHTML = fila.length && !rodando ? `<div class="of-aviso warn">${IC.sinc}<span><b>Download interrompido:</b> ${fila.length} documento(s) ainda não baixado(s). ${online ? "" : "Conecte-se à internet para continuar."}</span>${online ? `<button type="button" class="pf-btn primary" data-acao="retomar">Retomar</button>` : ""}</div>` : "";
}
function pintarPreparar() {
  const el = page.querySelector("#ofPreparar"); if (!el) return;
  const obras = obrasSrv.length ? obrasSrv : obrasConhecidas();
  const ids = selObra === "todos" ? obras.map((o) => o.id) : selObra ? [Number(selObra)] : [];
  const sel = O.selecionar(catSrv, { tipos, projetos: ids });
  const faltam = O.aBaixar(O.diferenca([...guardados.values()].filter((d) => ids.includes(Number(d.projectId))), sel));
  const bytesTot = sel.reduce((s, d) => s + d.tamanho, 0), bytesFaltam = faltam.reduce((s, d) => s + d.tamanho, 0);
  const espaco = O.cabe(bytesFaltam, estimativa);
  const rodando = executor?.rodando;
  el.innerHTML = `<div class="of-h"><h3>${IC.nuvem}Preparar obra para uso offline</h3><span>Baixa de uma vez todos os relatórios do condomínio para consultar na obra, sem sinal.</span></div>
    <div class="of-prep">
      <label class="of-campo"><span>Condomínio</span><select id="ofObraSel"${!online ? " disabled" : ""}>
        ${obras.map((o) => `<option value="${o.id}"${String(o.id) === selObra ? " selected" : ""}>${esc(o.nome)}</option>`).join("")}
        ${obras.length > 1 ? `<option value="todos"${selObra === "todos" ? " selected" : ""}>Todos os meus condomínios (${obras.length})</option>` : ""}
      </select></label>
      <div class="of-tipos" role="group" aria-label="Documentos">
        ${Object.values(O.TIPOS).map((t) => `<label class="of-chk"><input type="checkbox" data-tipo="${t.key}"${tipos[t.key] ? " checked" : ""}> ${esc(t.label)}</label>`).join("")}
      </div>
      <div class="of-est">${!online ? "Sem internet: conecte-se para preparar ou atualizar."
        : carregandoCat && !catSrv.length ? "Consultando os documentos disponíveis…"
        : `<span><b>${sel.length}</b> documento(s) encontrados · <b>${esc(O.fmtBytes(bytesTot))}</b> estimados${sel.length ? ` · <b>${faltam.length ? `${faltam.length} a baixar (${esc(O.fmtBytes(bytesFaltam))})` : "tudo já está no aparelho"}</b>` : ""}</span>`}
        ${online && espaco.conhecido ? `<small class="${espaco.cabe ? "" : "of-err"}">Espaço livre no aparelho: ${esc(O.fmtBytes(espaco.livre))}${espaco.cabe ? "" : " — insuficiente para este download"}</small>` : ""}</div>
      <div class="of-acoes">
        <button type="button" class="pf-btn primary of-big" data-acao="preparar"${!online || rodando || !sel.length ? " disabled" : ""}>${IC.nuvem}Preparar obra para uso offline</button>
        <button type="button" class="pf-btn" data-acao="sincronizar"${!online || rodando || !obrasLocais.size ? " disabled" : ""} title="Baixa só os documentos novos ou atualizados dos condomínios já preparados">${IC.sinc}Sincronizar agora</button>
      </div>
    </div>`;
}
function pintarProgresso() {
  const el = page.querySelector("#ofProgresso"); if (!el) return;
  const p = progresso, r = relatorio;
  if (!p && !r) { el.hidden = true; return; }
  el.hidden = false;
  if (p && executor?.rodando || p?.fase === "pausado") {
    const pct = p.total ? Math.round((p.feitos / p.total) * 100) : 0;
    el.innerHTML = `<div class="of-h"><h3>${IC.sinc}${p.fase === "pausado" ? "Download pausado" : `Preparando ${esc(alvoAtual?.titulo || "")} para uso offline`}</h3></div>
      <div class="of-prog-n"><span><b>${p.total}</b> documentos encontrados</span><span><b>${p.feitos - p.falhas}</b> baixados</span><span><b>${p.total - p.feitos}</b> restantes</span>${p.falhas ? `<span class="of-err"><b>${p.falhas}</b> com falha</span>` : ""}<span><b>${pct}%</b> concluído</span><span><b>${esc(O.fmtBytes(p.bytes))}</b> de ${esc(O.fmtBytes(p.bytesTotal))}</span></div>
      <div class="of-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><i style="width:${pct}%"></i></div>
      <div class="of-acoes">${p.fase === "pausado" ? `<button type="button" class="pf-btn primary" data-acao="retomar"${online ? "" : " disabled"}>Retomar</button>` : `<button type="button" class="pf-btn" data-acao="pausar">Pausar</button>`}
      <small>Mantenha esta página aberta: o iPhone não continua downloads com o Safari fechado. Se fechar, o que já baixou fica guardado e o restante continua ao abrir de novo.</small></div>`;
    return;
  }
  if (r) {
    const e = O.ESTADOS_OBRA[r.estado] || O.ESTADOS_OBRA.parcial;
    el.innerHTML = `<div class="of-h"><h3>${r.preparada ? IC.ok : IC.sinc}Relatório de preparação · ${esc(r.titulo)}</h3><span class="of-badge" style="--c:${e.cor}">${esc(e.label)}</span></div>
      <div class="of-prog-n"><span><b>${r.total}</b> encontrados</span><span class="of-okt"><b>${r.ok}</b> baixados e verificados</span><span><b>${r.pendentes}</b> pendentes</span><span class="${r.falhas ? "of-err" : ""}"><b>${r.falhas}</b> com falha</span><span><b>${esc(O.fmtBytes(r.bytes))}</b> ocupados</span><span>${esc(O.fmtDataHora(r.em))}</span></div>
      ${r.listaFalhas?.length ? `<div class="of-falhas"><b>Precisam ser baixados de novo:</b><ul>${r.listaFalhas.slice(0, 30).map((d) => `<li>${esc(d.obra)} · ${esc(d.unidade)} · ${esc(O.TIPOS[d.tipo]?.label || d.tipo)} — <i>${esc(d.erro || "")}</i></li>`).join("")}</ul>
        <button type="button" class="pf-btn primary" data-acao="repetir"${online ? "" : " disabled"}>Repetir só as falhas</button></div>` : ""}
      ${r.erro ? `<p class="of-err">${esc(r.erro)}</p>` : ""}`;
  }
}
function pintarObras() {
  const el = page.querySelector("#ofObras"); if (!el) return;
  const lista = [...obrasLocais.values()].sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  el.innerHTML = `<div class="of-h"><h3>Condomínios no aparelho</h3><span>${lista.length ? "" : "Nenhum condomínio preparado ainda."}</span></div>
    ${lista.length ? `<div class="pf-table-wrap"><table class="pf-tbl of-tbl"><thead><tr><th>Condomínio</th><th>Documentos</th><th>Espaço</th><th>Última sincronização</th><th>Situação</th><th></th></tr></thead><tbody>
    ${lista.map((o) => { const s = situacaoDe(o.projectId), e = O.ESTADOS_OBRA[s.estado]; return `<tr>
      <td class="of-nome">${esc(o.nome)}</td><td>${s.ok} de ${s.total}</td><td>${esc(O.fmtBytes(s.bytes))}</td><td>${esc(O.fmtDataHora(o.ultimaSync || o.preparadaEm))}</td>
      <td><span class="of-badge" style="--c:${e.cor}">${esc(e.label)}</span></td>
      <td class="of-ac"><button type="button" class="pf-btn" data-acao="atualizar-obra" data-obra="${o.projectId}"${online && !executor?.rodando ? "" : " disabled"}>${IC.sinc}Atualizar</button>
      <button type="button" class="pf-btn" data-acao="remover-obra" data-obra="${o.projectId}"${executor?.rodando ? " disabled" : ""}>${IC.lixo}Remover do dispositivo</button></td></tr>`; }).join("")}
    </tbody></table></div>` : ""}`;
}
function docsDaLista() {
  const srv = new Map(catSrv.map((d) => [d.id, d]));
  const base = new Map([...catSrv.map((d) => [d.id, d]), ...[...guardados.values()].filter((d) => !srv.has(d.id)).map((d) => [d.id, d])]);
  const q = filtroDocs.busca.trim().toLowerCase(), f = filaIds();
  let l = [...base.values()].map((d) => ({ d, loc: guardados.get(d.id), st: O.situacaoDoc(srv.get(d.id), guardados.get(d.id), f.has(d.id)) }));
  if (filtroDocs.obra) l = l.filter((x) => String(x.d.projectId) === filtroDocs.obra);
  if (filtroDocs.bloco) l = l.filter((x) => x.d.bloco === filtroDocs.bloco);
  if (filtroDocs.soOffline || !online) l = l.filter((x) => x.loc?.versaoOk);
  if (q) l = l.filter((x) => `${x.d.unidade} ${x.d.nomeArquivo} ${x.d.obra}`.toLowerCase().includes(q));
  if (filtroDocs.ordem === "tamanho") l.sort((a, b) => (b.loc?.bytes || b.d.tamanho || 0) - (a.loc?.bytes || a.d.tamanho || 0));
  return l;
}
function pintarDocs() {
  const el = page.querySelector("#ofDocs"); if (!el) return;
  const obras = obrasConhecidas();
  const blocos = [...new Set([...catSrv, ...guardados.values()].filter((d) => !filtroDocs.obra || String(d.projectId) === filtroDocs.obra).map((d) => d.bloco).filter(Boolean))].sort((a, b) => a.localeCompare(b, "pt-BR", { numeric: true }));
  const l = docsDaLista(), faltam = l.filter((x) => x.st.key !== "ok" && x.st.key !== "removido" && catSrv.some((d) => d.id === x.d.id));
  el.innerHTML = `<div class="of-h"><h3>${IC.pdf}Documentos</h3><span>${l.length} na lista${!online ? " · sem internet: só os guardados" : ""}</span></div>
    <div class="of-filtros">
      <label class="of-campo"><span>Condomínio</span><select id="ofFObra"><option value="">Todos</option>${obras.map((o) => `<option value="${o.id}"${String(o.id) === filtroDocs.obra ? " selected" : ""}>${esc(o.nome)}</option>`).join("")}</select></label>
      <label class="of-campo"><span>Bloco</span><select id="ofFBloco"><option value="">Todos</option>${blocos.map((b) => `<option${b === filtroDocs.bloco ? " selected" : ""}>${esc(b)}</option>`).join("")}</select></label>
      <label class="of-campo of-busca"><span>Unidade</span><input id="ofBusca" type="search" placeholder="Ex.: 604" value="${esc(filtroDocs.busca)}" autocomplete="off"></label>
      <label class="of-chk"><input type="checkbox" id="ofFOff"${filtroDocs.soOffline || !online ? " checked" : ""}${!online ? " disabled" : ""}> Só os guardados</label>
      <label class="of-campo"><span>Ordem</span><select id="ofFOrdem"><option value="unidade">Unidade</option><option value="tamanho"${filtroDocs.ordem === "tamanho" ? " selected" : ""}>Maior espaço primeiro</option></select></label>
      ${online && faltam.length && !executor?.rodando ? `<button type="button" class="pf-btn primary" data-acao="baixar-lista">${IC.nuvem}Baixar ${filtroDocs.bloco ? `o bloco ${esc(filtroDocs.bloco)}` : "estes"} (${faltam.length})</button>` : ""}
    </div>
    ${l.length ? `<div class="pf-table-wrap of-docs-wrap"><table class="pf-tbl of-tbl of-docs"><thead><tr><th>Relatório</th><th>Tipo</th><th>Unidade</th><th>Atualizado</th><th>Tamanho</th><th>Situação</th><th></th></tr></thead><tbody>
      ${l.slice(0, 400).map(({ d, loc, st }) => `<tr data-doc="${esc(d.id)}">
        <td class="of-nome">${loc?.versaoOk ? `<i class="of-off" title="Disponível offline">${IC.ok}</i>` : ""}${esc(d.obra)}<small>${esc(d.nomeArquivo || "")}</small></td>
        <td><span class="of-tipo ${d.tipo}">${esc(O.TIPOS[d.tipo]?.curto || d.tipo)}</span></td>
        <td>${esc(d.unidade)}</td><td>${esc(O.fmtData(d.data))}</td><td>${esc(O.fmtBytes(loc?.bytes || d.tamanho))}</td>
        <td><span class="of-st ${ST_DOC[st.key] || "n"}">${esc(st.label)}</span></td>
        <td class="of-ac">${loc?.versaoOk ? `<button type="button" class="pf-btn primary" data-acao="abrir" data-doc="${esc(d.id)}">Abrir</button>` : ""}
          ${online && st.key !== "ok" && st.key !== "removido" && catSrv.some((x) => x.id === d.id) ? `<button type="button" class="pf-btn" data-acao="baixar" data-doc="${esc(d.id)}"${executor?.rodando ? " disabled" : ""}>${st.key === "atualizacao" ? "Atualizar" : "Baixar"}</button>` : ""}
          ${loc ? `<button type="button" class="pf-btn" data-acao="remover" data-doc="${esc(d.id)}" title="Remove só deste aparelho (o original continua no servidor)">${IC.lixo}<span class="of-lbl">Remover</span></button>` : ""}</td></tr>`).join("")}
    </tbody></table>${l.length > 400 ? `<p class="of-nota">Mostrando 400 de ${l.length}. Use os filtros.</p>` : ""}</div>`
      : `<p class="of-vazio">${online ? "Nenhum documento com esses filtros." : "Nenhum documento guardado neste aparelho. Prepare uma obra quando estiver com internet."}</p>`}`;
}
function pintarGerenciar() {
  const el = page.querySelector("#ofGerenciar"); if (!el) return;
  el.innerHTML = `<div class="of-h"><h3>${IC.lixo}Gerenciar armazenamento</h3><span>Remover daqui nunca apaga nada do servidor.</span></div>
    <div class="of-acoes">
      <button type="button" class="pf-btn" data-acao="limpar"${guardados.size && !executor?.rodando ? "" : " disabled"}>${IC.lixo}Limpar todos os arquivos offline desta conta</button>
      ${outrasContas?.length ? `<button type="button" class="pf-btn" data-acao="outras">${IC.lixo}Apagar arquivos de outras contas deste aparelho (${outrasContas.length})</button>` : ""}
    </div>
    <p class="of-nota">Os documentos ficam separados por conta: outra pessoa que entrar neste aparelho não vê estes arquivos. Ao sair da conta, eles ficam bloqueados até você entrar de novo. Para usar sem internet, mantenha a sessão conectada (“Manter conectado” no login).</p>`;
}

/* ── ações ── */
async function clique(e) {
  const b = e.target.closest("[data-acao]"); if (!b || b.disabled) return;
  const a = b.dataset.acao, doc = b.dataset.doc, pid = Number(b.dataset.obra);
  if (a === "preparar") { const ids = selObra === "todos" ? obrasSrv.map((o) => o.id) : [Number(selObra)]; await preparar(ids, { ...tipos }); }
  else if (a === "sincronizar") await preparar([...obrasLocais.keys()], null, "Sincronização");
  else if (a === "atualizar-obra") await preparar([pid], null);
  else if (a === "pausar") { executor.pausar(); toast("Pausando: termina o arquivo em andamento e para."); }
  else if (a === "retomar") await retomar();
  else if (a === "repetir") await repetirFalhas();
  else if (a === "baixar") { const d = catSrv.find((x) => x.id === doc); if (d) await baixarLista([d], `${d.unidade} · ${O.TIPOS[d.tipo]?.curto}`); }
  else if (a === "baixar-lista") { const l = docsDaLista().filter((x) => x.st.key !== "ok" && x.st.key !== "removido").map((x) => catSrv.find((d) => d.id === x.d.id)).filter(Boolean); await baixarLista(l, filtroDocs.bloco ? `Bloco ${filtroDocs.bloco}` : "documentos da lista"); }
  else if (a === "remover") { if (confirm("Remover este documento do aparelho? O original continua no servidor.")) { await store.remover([doc]); await recarregarLocal(); pintarTudo(); toast("Removido do aparelho."); } }
  else if (a === "remover-obra") { const o = obrasLocais.get(pid); if (confirm(`Remover todos os documentos de ${o?.nome || "este condomínio"} deste aparelho? Nada é apagado do servidor.`)) { await store.removerObra(pid); relatorio = null; await recarregarLocal(); pintarTudo(); toast("Condomínio removido do aparelho."); } }
  else if (a === "limpar") { if (confirm("Apagar todos os arquivos offline desta conta neste aparelho? Nada é apagado do servidor.")) { await store.limparTudo(); relatorio = null; progresso = null; await recarregarLocal(); pintarTudo(); toast("Arquivos offline apagados."); } }
  else if (a === "outras") { if (confirm("Apagar os arquivos offline de outras contas que já usaram este aparelho?")) { for (const n of outrasContas || []) await apagarBanco(n); outrasContas = await bancosDeOutrasContas(usuario.id); pintarGerenciar(); toast("Arquivos de outras contas apagados."); } }
  else if (a === "abrir") abrirDoc(doc);
}
function mudanca(e) {
  const t = e.target;
  if (t.id === "ofObraSel") { selObra = t.value; pintarPreparar(); }
  else if (t.dataset.tipo) { tipos = { ...tipos, [t.dataset.tipo]: t.checked }; if (!tipos.convertido && !tipos.original) { tipos[t.dataset.tipo] = true; t.checked = true; } pintarPreparar(); }
  else if (t.id === "ofFObra") { filtroDocs.obra = t.value; filtroDocs.bloco = ""; pintarDocs(); }
  else if (t.id === "ofFBloco") { filtroDocs.bloco = t.value; pintarDocs(); }
  else if (t.id === "ofFOff") { filtroDocs.soOffline = t.checked; pintarDocs(); }
  else if (t.id === "ofFOrdem") { filtroDocs.ordem = t.value; pintarDocs(); }
}

/**
 * Preparar (ou atualizar/sincronizar) condomínios: consulta o servidor, baixa só o que é novo ou mudou, tira do
 * aparelho o que deixou de estar disponível, verifica todos os arquivos e gera o relatório de preparação.
 */
async function preparar(ids, tiposEscolhidos, rotulo = "") {
  if (!online || executor.rodando || !ids.length) return;
  await atualizarCatalogo();
  if (erroCat) { toast(erroCat); return; }
  const obras = ids.map((id) => obrasSrv.find((o) => o.id === id)).filter(Boolean);
  if (!obras.length) { toast("Condomínio não disponível para a sua conta."); return; }
  const agora = new Date().toISOString(), todosSel = [];
  for (const o of obras) {
    const t = tiposEscolhidos || obrasLocais.get(o.id)?.tipos || tipos;
    const ant = obrasLocais.get(o.id);
    await store.salvarObra({ ...(ant || {}), projectId: o.id, nome: o.nome, tipos: t, iniciadoEm: agora });
    todosSel.push(...O.selecionar(catSrv, { tipos: t, projetos: o.id }));
  }
  // documentos guardados de tipos que deixaram de ser escolhidos continuam até o usuário remover
  const dif = O.diferenca([...guardados.values()].filter((d) => ids.includes(Number(d.projectId))), todosSel);
  const itens = O.aBaixar(dif);
  const bytes = itens.reduce((s, d) => s + d.tamanho, 0), espaco = O.cabe(bytes, estimativa);
  if (espaco.conhecido && !espaco.cabe && !confirm(`O download precisa de cerca de ${O.fmtBytes(bytes)} e o aparelho informa ${O.fmtBytes(espaco.livre)} livres. Tentar mesmo assim?`)) return;
  try { if (navigator.storage?.persist && !persistente) persistente = await navigator.storage.persist(); } catch { /* sem suporte */ }
  const { checklists } = await catalogoServidor(sb, obras).catch(() => ({ checklists: [] }));
  await store.salvarChecklists(checklists);
  alvoAtual = { ids, titulo: rotulo || (obras.length === 1 ? obras[0].nome : `${obras.length} condomínios`) };
  relatorio = null;
  await recarregarLocal();
  if (!itens.length) { await finalizar(); toast("Tudo já estava atualizado no aparelho."); return; }
  await store.salvarFila(itens.map((d) => ({ ...d, enfileiradoEm: agora })));
  fila = await store.fila();
  pintarTudo();
  executor.executar(itens);
}
async function baixarLista(itens, titulo) {
  if (!online || executor.rodando || !itens.length) return;
  for (const pid of new Set(itens.map((d) => Number(d.projectId)))) {
    if (!obrasLocais.has(pid)) { const o = obrasSrv.find((x) => x.id === pid); await store.salvarObra({ projectId: pid, nome: o?.nome || itens[0].obra, tipos: { ...tipos } }); }
  }
  alvoAtual = { ids: [...new Set(itens.map((d) => Number(d.projectId)))], titulo };
  relatorio = null;
  await store.salvarFila(itens);
  await recarregarLocal(); pintarTudo();
  executor.executar(itens);
}
async function retomar() {
  if (!online || executor.rodando) return;
  const itens = await store.fila(); if (!itens.length) return;
  alvoAtual = { ids: [...new Set(itens.map((d) => Number(d.projectId)))], titulo: itens.length === 1 ? itens[0].obra : [...new Set(itens.map((d) => d.obra))].join(", ") };
  relatorio = null; pintarTudo();
  executor.executar(itens);
}
function retomarSePreciso() {
  if (online && fila.length && !executor.rodando) { toast(`Retomando ${fila.length} download(s) interrompido(s)…`); retomar(); }
}
async function repetirFalhas() {
  const ids = alvoAtual?.ids || [...obrasLocais.keys()];
  const sel = ids.flatMap((pid) => selecionadosDaObra(pid)).filter((d) => guardados.get(d.id)?.status === "falha" || !guardados.get(d.id)?.versaoOk);
  await baixarLista(sel, alvoAtual?.titulo || "falhas");
}
async function aoTerminar(p) {
  await recarregarLocal();
  if (p.fase === "concluido") await finalizar(p);
  else { if (p.fase === "interrompido") { progresso = null; toast("Sem internet: download interrompido. O que já baixou está guardado; o restante continua quando a conexão voltar."); } pintarTudo(); if (p.fase === "erro") toast(p.erro || "Falha ao baixar."); }
}
/** Verificação final (lê cada arquivo do aparelho e confere o hash) + relatório de preparação. */
async function finalizar(p = null) {
  const ids = alvoAtual?.ids || [];
  let ok = 0;
  for (const pid of ids) for (const d of selecionadosDaObra(pid)) {
    const loc = guardados.get(d.id); if (!loc?.versaoOk) continue;
    const buf = await store.bytes(d.id);
    let bom = !!buf && buf.byteLength === loc.bytes;
    if (bom && loc.hash && crypto?.subtle) bom = O.hex(await crypto.subtle.digest("SHA-256", buf)) === loc.hash;
    if (!bom) await store.falha({ ...loc, versaoOk: null }, "arquivo corrompido no aparelho: baixe de novo"); else ok++;
  }
  await recarregarLocal();
  const agg = { total: 0, ok: 0, pendentes: 0, falhas: 0, bytes: 0, desatualizados: 0, listaFalhas: [] };
  for (const pid of ids) { const s = situacaoDe(pid); for (const k of Object.keys(agg)) agg[k] = Array.isArray(agg[k]) ? agg[k].concat(s[k]) : agg[k] + s[k]; }
  const preparada = agg.total > 0 && agg.ok === agg.total, em = new Date().toISOString();
  for (const pid of ids) {
    const o = obrasLocais.get(pid); if (!o) continue;
    const s = situacaoDe(pid);
    await store.salvarObra({ ...o, ultimaSync: em, ...(s.preparada ? { preparadaEm: o.preparadaEm || em } : {}), ultimoRelatorio: { ...s, listaFalhas: s.listaFalhas.slice(0, 50), em } });
  }
  await store.salvarMeta("ultimaSync", em);
  relatorio = { ...agg, preparada, estado: preparada ? "preparada" : agg.falhas ? "falha" : "parcial", titulo: alvoAtual?.titulo || "", em, erro: p?.erro || "" };
  progresso = null;
  await recarregarLocal(); pintarTudo();
  if (preparada) toast(`${relatorio.titulo}: obra preparada para uso offline.`);
}

/* ── visualizador (PDF direto do aparelho, sem URL do servidor) ── */
let pdfjsP = null;
function pdfjs() {
  if (!pdfjsP) {
    const base = document.baseURI;
    pdfjsP = import(/* @vite-ignore */ new URL("./pdfjs/pdf.min.js", base).href).then((m) => { m.GlobalWorkerOptions.workerSrc = new URL("./pdfjs/pdf.worker.min.js", base).href; return m; }).catch((e) => { pdfjsP = null; throw e; });
  }
  return pdfjsP;
}
let viz = null, ov = null, docAberto = null;
async function abrirDoc(id) {
  const lista = docsDaLista().filter((x) => x.loc?.versaoOk).map((x) => x.d.id);
  const d = guardados.get(id); if (!d) return;
  docAberto = { id, lista };
  if (!ov) {
    ov = document.createElement("div"); ov.className = "of-viz"; ov.setAttribute("role", "dialog"); ov.setAttribute("aria-modal", "true");
    ov.innerHTML = `<div class="of-viz-top"><div class="of-viz-t"><b id="ofVzT"></b><small id="ofVzS"></small></div>
      <div class="of-viz-bt"><button type="button" class="pf-btn" data-vz="ant" aria-label="Relatório anterior">‹</button><span id="ofVzN" class="of-viz-n"></span><button type="button" class="pf-btn" data-vz="prox" aria-label="Próximo relatório">›</button>
      <button type="button" class="pf-btn" data-vz="menos" aria-label="Diminuir">−</button><button type="button" class="pf-btn" data-vz="mais" aria-label="Aumentar">+</button><button type="button" class="pf-btn" data-vz="check">Pendências</button><button type="button" class="pf-btn primary" data-vz="fechar">Fechar</button></div></div>
      <div class="of-viz-corpo"><div class="of-viz-pdf" id="ofVzPdf"></div><aside class="of-viz-chk" id="ofVzChk" hidden></aside></div>`;
    document.body.appendChild(ov);
    ov.addEventListener("click", (e) => {
      const v = e.target.closest("[data-vz]")?.dataset.vz; if (!v) return;
      if (v === "fechar") fecharDoc();
      else if (v === "mais") viz?.mais(); else if (v === "menos") viz?.menos();
      else if (v === "check") { const c = ov.querySelector("#ofVzChk"); c.hidden = !c.hidden; }
      else { const i = docAberto.lista.indexOf(docAberto.id), n = docAberto.lista[i + (v === "prox" ? 1 : -1)]; if (n) abrirDoc(n); }
    });
    addEventListener("keydown", (e) => { if (e.key === "Escape" && ov?.classList.contains("on")) fecharDoc(); });
    viz = criarVisualizador(ov.querySelector("#ofVzPdf"), { aoMudar: ({ pagina, total }) => { const n = ov.querySelector("#ofVzN"); if (n) n.textContent = total ? `pág. ${pagina}/${total}` : ""; } });
  }
  ov.classList.add("on"); document.body.classList.add("of-viz-aberto");
  ov.querySelector("#ofVzT").textContent = `${d.unidade} · ${O.TIPOS[d.tipo]?.label || d.tipo}`;
  ov.querySelector("#ofVzS").textContent = `${d.obra} · ${d.nomeArquivo || ""} · guardado em ${O.fmtDataHora(d.baixadoEm)} · ${O.fmtBytes(d.bytes)}`;
  const i = lista.indexOf(id);
  ov.querySelector('[data-vz="ant"]').disabled = i <= 0; ov.querySelector('[data-vz="prox"]').disabled = i < 0 || i >= lista.length - 1;
  const chk = await store.checklist(d.unitId);
  const c = ov.querySelector("#ofVzChk");
  c.innerHTML = `<b>Pendências da unidade</b>${chk?.itens?.length ? `<ol>${chk.itens.map((a) => `<li class="${a.concluido ? "ok" : ""}">${a.concluido ? "✓ " : ""}${esc(a.texto)}</li>`).join("")}</ol><small>${chk.itens.filter((a) => a.concluido).length} de ${chk.itens.length} resolvida(s) · situação em ${esc(O.fmtDataHora(chk.atualizadoEm))}</small>` : "<p>Sem apontamentos guardados para esta unidade.</p>"}`;
  try {
    const buf = await store.bytes(id);
    if (!buf) throw new Error("arquivo não encontrado no aparelho");
    const lib = await pdfjs();
    await viz.abrir(lib, { data: new Uint8Array(buf.slice(0)) });
  } catch (err) {
    console.error(err);
    ov.querySelector("#ofVzPdf").innerHTML = `<div class="of-viz-erro"><b>Não foi possível abrir este PDF.</b><span>${esc(err?.message || "")}</span><span>Remova e baixe de novo quando tiver internet.</span></div>`;
  }
}
function fecharDoc() { viz?.fechar(); ov?.classList.remove("on"); document.body.classList.remove("of-viz-aberto"); docAberto = null; }

boot();
