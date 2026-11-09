// Relatório da unidade (aba Revistoria · Cliente): cabeçalho, checklist de apontamentos e o PDF original.
// O PDF fica no Storage privado e é aberto por URL assinada e temporária; o checklist é só acompanhamento
// (revistorias_apontamentos) e nunca altera o PDF. pdf.js (www/pdfjs) é carregado só quando a tela abre.
import * as M from "./model.js";
import * as S from "./service.js";
import { extrair, mesmaUnidade } from "./relatorio.js";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const pad = (n) => String(n).padStart(2, "0");
const fmtD = (d) => { const p = String(d || "").slice(0, 10).split("-"); return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : ""; };
const fmtDH = (ts) => { if (!ts) return ""; const d = new Date(ts); return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const MB = (n) => (!n ? "" : n < 1048576 ? Math.max(1, Math.round(n / 1024)) + " KB" : (n / 1048576).toFixed(n > 10485760 ? 0 : 1).replace(".", ",") + " MB");
const LIMITE = 25 * 1048576;

let pdfjsP = null;
/** pdf.js (versão legacy: Safari/iPhone mais antigos), carregado sob demanda de www/pdfjs. */
function pdfjs() {
  if (!pdfjsP) {
    const base = document.baseURI;
    const url = new URL("./pdfjs/pdf.min.js", base).href;
    pdfjsP = import(/* @vite-ignore */ url).then((m) => { m.GlobalWorkerOptions.workerSrc = new URL("./pdfjs/pdf.worker.min.js", base).href; return m; })
      .catch((e) => { pdfjsP = null; throw e; });
  }
  return pdfjsP;
}
/** Texto do PDF com posições (para o extrator). */
async function lerTexto(doc) {
  const paginas = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const tc = await (await doc.getPage(i)).getTextContent();
    paginas.push({ itens: tc.items.map((it) => ({ str: it.str, x: it.transform[4], y: it.transform[5], w: it.width })) });
  }
  return paginas;
}

let st = null;   // estado da tela aberta
function el() {
  let ov = document.getElementById("rvRelOv");
  if (!ov) {
    ov = document.createElement("div"); ov.id = "rvRelOv"; ov.className = "rv-ov"; ov.setAttribute("role", "dialog"); ov.setAttribute("aria-modal", "true");
    ov.innerHTML = `<div class="rv-box"><div class="rv-head"><div class="rv-tit"><small id="rvKick"></small><strong id="rvTit">Relatório</strong></div><button type="button" class="pp-icon" data-rv="fechar" aria-label="Fechar">×</button></div><div class="rv-body" id="rvBody"></div></div>`;
    document.body.appendChild(ov);
    ov.addEventListener("click", (e) => { if (e.target === ov) fechar(); else clique(e); });
    ov.addEventListener("change", mudou);
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && ov.classList.contains("open")) fechar(); });
  }
  return ov;
}

/**
 * Abre o relatório da unidade.
 * @param ctx { host, u (unidade com situacao), podeEditar, aoMudar }
 */
export async function abrirRelatorio(ctx) {
  const ov = el();
  st = { ...ctx, rels: null, rel: null, aps: [], doc: null, pagina: 1, zoom: 1, erro: "", extraidos: null, enviando: "", canal: null };
  ov.classList.add("open"); document.body.classList.add("rv-aberto");
  ov.querySelector("#rvKick").textContent = `${ctx.host.project.name} · ${ctx.host.casa() ? `Conjunto ${ctx.u.b}` : `Bloco ${ctx.u.b}`}`;
  ov.querySelector("#rvTit").textContent = `Relatório · ${ctx.host.casa() ? `Casa ${+ctx.u.a}` : `Apto ${ctx.u.codigo}`}`;
  pintar();
  assinar();
  await carregar();
}
export function fechar() {
  const ov = document.getElementById("rvRelOv"); if (!ov?.classList.contains("open")) return;
  if (st?.extraidos?.length && !confirm("Os apontamentos lidos do PDF ainda não foram salvos no checklist. Fechar mesmo assim?")) return;
  ov.classList.remove("open"); document.body.classList.remove("rv-aberto");
  try { st?.canal?.(); } catch { /* sem tempo real */ }
  st?.doc?.destroy?.(); st = null;
}
function assinar() {
  const sb = st.host.sb; if (!sb?.channel) return;
  const filtro = `unit_id=eq.${st.u.unitId}`, me = st;
  const ch = sb.channel(`rev-rel-${st.u.unitId}-${Date.now()}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "revistorias_apontamentos", filter: filtro }, () => { if (st === me && st.rel) recarregarApontamentos(); })
    .on("postgres_changes", { event: "*", schema: "public", table: "revistorias_relatorios", filter: filtro }, () => { if (st === me) carregar(true); })
    .subscribe();
  st.canal = () => sb.removeChannel(ch);
}
async function carregar(manterPdf = false) {
  const me = st;
  try {
    const rels = await S.relatorios(st.host.sb, st.u.unitId); if (st !== me) return;
    st.rels = rels; st.erro = "";
    const atual = st.rel && rels.find((r) => r.id === st.rel.id);
    if (!atual || !manterPdf) { st.rel = atual || rels[0] || null; if (!manterPdf) { st.doc?.destroy?.(); st.doc = null; st.pagina = 1; } }
    await recarregarApontamentos(false);
    pintar();
    if (st.rel && !st.doc) abrirPdf();
  } catch (err) { if (st === me) { st.erro = S.naoInstalado(err) ? "Os relatórios ainda não foram instalados no banco." : err.message || "Não foi possível carregar."; pintar(); } }
}
async function recarregarApontamentos(repintar = true) {
  if (!st?.rel) { if (st) st.aps = []; return; }
  const me = st, id = st.rel.id;
  const aps = await S.apontamentos(st.host.sb, id).catch(() => null);
  if (st !== me || st.rel?.id !== id || !aps) return;
  st.aps = aps; if (repintar) pintarChecklist();
}

/* ── tela ── */
function cabecalho() {
  const u = st.u, s = u.situacao, ag = M.agendaRevistoria(s), resumo = st.rel?.resumo || {};
  const resp = (s.aberto || s.ultima)?.responsavel || resumo.responsavel || "";
  const feitos = st.aps.filter((a) => a.concluido).length;
  const campo = (rot, val) => `<div><span>${esc(rot)}</span><b>${val || "—"}</b></div>`;
  return `<div class="rv-cab">
      ${campo("Condomínio", esc(st.host.project.name))}
      ${campo(st.host.grupo(), esc(u.b))}
      ${campo(st.host.casa() ? "Casa" : "Apartamento", esc(st.host.casa() ? +u.a : u.codigo))}
      ${campo("Data da revistoria", esc([fmtD(ag.data), ag.hora].filter(Boolean).join(" · ")) || (resumo.realizado ? esc(fmtD(resumo.realizado)) + " <small>(relatório)</small>" : ""))}
      ${campo("Responsável pela vistoria", esc(resp))}
      <div><span>Status da revistoria</span>${s.status ? `<span class="rc-badge" style="--c:${M.info(s.status).cor};--b:${M.info(s.status).borda}">${esc(M.info(s.status).label)}</span>` : "<b>Sem registro</b>"}</div>
      ${campo("Apontamentos", st.rel ? `${st.aps.length}${st.aps.length ? ` <small>· ${feitos} concluído(s)</small>` : ""}${resumo.naoConformidades != null ? ` <small>· ${esc(resumo.naoConformidades)} NC no relatório</small>` : ""}` : "")}
    </div>`;
}
function pintar() {
  const b = document.getElementById("rvBody"); if (!b || !st) return;
  if (st.erro) { b.innerHTML = `${cabecalho()}<div class="ch-state"><b>${esc(st.erro)}</b></div>`; return; }
  if (!st.rels) { b.innerHTML = `${cabecalho()}<div class="ch-state"><div class="ch-spin" aria-hidden="true"></div><b>Carregando o relatório…</b></div>`; return; }
  const sel = st.rels.length > 1 ? `<label class="fx-field fx-sel rv-sel"><span>Relatório</span><select data-rv="sel">${st.rels.map((r) => `<option value="${r.id}"${r.id === st.rel?.id ? " selected" : ""}>${esc(r.nome_arquivo || "PDF")} · ${esc(fmtDH(r.enviado_em))}</option>`).join("")}</select></label>` : "";
  const envio = st.podeEditar ? `<label class="btn ${st.rel ? "g" : "p"} rv-up${st.enviando ? " disabled" : ""}"><input type="file" accept="application/pdf,.pdf" data-rv="arquivo" hidden ${st.enviando ? "disabled" : ""}>${st.enviando ? esc(st.enviando) : st.rel ? "Enviar outro PDF" : "Enviar relatório (PDF)"}</label>` : "";
  b.innerHTML = `${cabecalho()}
    <div class="rv-tools">${sel}${envio}${st.rel && st.podeEditar ? `<button type="button" class="btn g rv-rm" data-rv="remover">Remover relatório</button>` : ""}</div>
    ${!st.rel ? `<div class="ch-state rv-vazio"><b>Nenhum relatório enviado para esta unidade.</b><span>${st.podeEditar ? "Envie o PDF do relatório: os apontamentos (itens reprovados) são lidos automaticamente para o checklist." : "Os relatórios são enviados pela equipe de revistorias e administradores."}</span></div>` : ""}
    <section class="rv-sec" id="rvCheck"></section>
    ${st.rel ? `<section class="rv-sec"><div class="rv-sec-h"><b>Relatório original</b><span class="rv-meta">${esc(st.rel.nome_arquivo || "")}${st.rel.tamanho ? " · " + MB(st.rel.tamanho) : ""}${st.rel.paginas ? ` · ${st.rel.paginas} página(s)` : ""} · enviado ${esc(fmtDH(st.rel.enviado_em))}${st.rel.enviado_email ? " por " + esc(st.rel.enviado_email) : ""}</span></div>
      <div class="rv-pdfbar"><button type="button" class="btn g" data-rv="ant" aria-label="Página anterior">‹</button><span id="rvPag">—</span><button type="button" class="btn g" data-rv="prox" aria-label="Próxima página">›</button>
        <span class="rv-sep"></span><button type="button" class="btn g" data-rv="menos" aria-label="Diminuir">−</button><span id="rvZoom">100%</span><button type="button" class="btn g" data-rv="mais" aria-label="Ampliar">+</button><button type="button" class="btn g" data-rv="ajustar">Ajustar</button>
        <span class="rv-sep"></span><button type="button" class="btn g" data-rv="abrir">Abrir</button><button type="button" class="btn g" data-rv="baixar">Baixar</button></div>
      <div class="rv-pdf" id="rvPdf"><div class="ch-state"><div class="ch-spin"></div><b>Abrindo o PDF…</b></div></div></section>` : ""}`;
  pintarChecklist();
  if (st.doc) desenharPagina();
}
function pintarChecklist() {
  const c = document.getElementById("rvCheck"); if (!c || !st) return;
  if (!st.rel) { c.innerHTML = ""; return; }
  const ed = st.podeEditar;
  const lista = st.aps.length ? `<ol class="rv-list">${st.aps.map((a, i) => `<li class="${a.concluido ? "ok" : ""}"><label><input type="checkbox" data-ap="${a.id}" ${a.concluido ? "checked" : ""} ${ed ? "" : "disabled"}><span class="rv-n">${i + 1}</span><span class="rv-t">${esc(a.texto)}${a.concluido && a.concluido_email ? `<small>concluído ${esc(fmtDH(a.concluido_em))} · ${esc(a.concluido_email)}</small>` : ""}</span></label>${ed ? `<button type="button" class="rv-x" data-aprm="${a.id}" aria-label="Remover apontamento">×</button>` : ""}</li>`).join("")}</ol>`
    : `<p class="rv-nada">Nenhum apontamento no checklist.</p>`;
  const ex = st.extraidos;
  const preview = ex ? `<div class="rv-ext"><div class="rv-ext-h"><b>${ex.length} apontamento(s) lido(s) do PDF</b><span>Confira e desmarque o que não deve entrar no checklist.</span></div>
      ${ex.length ? `<ol class="rv-list rv-ext-l">${ex.map((a, i) => `<li><label><input type="checkbox" data-ext="${i}" ${a.usar ? "checked" : ""}><span class="rv-t">${esc(a.texto)}</span></label></li>`).join("")}</ol>` : `<p class="rv-nada">Nenhum item reprovado encontrado no PDF. Adicione os apontamentos manualmente, se houver.</p>`}
      <div class="rv-ext-a"><button type="button" class="btn g" data-rv="descartar">Descartar</button>${ex.length ? `<button type="button" class="btn p" data-rv="salvarext">Adicionar ao checklist</button>` : ""}</div></div>` : "";
  c.innerHTML = `<div class="rv-sec-h"><b>Apontamentos · checklist</b><span class="rv-meta">${st.aps.filter((a) => a.concluido).length} de ${st.aps.length} concluído(s)</span></div>
    ${preview}${lista}
    ${ed ? `<div class="rv-add">${!ex ? `<button type="button" class="btn g" data-rv="ler">Ler apontamentos do PDF</button>` : ""}<details><summary>Adicionar manualmente</summary><textarea id="rvNovo" rows="3" maxlength="6000" placeholder="Um apontamento por linha"></textarea><button type="button" class="btn p" data-rv="addman">Adicionar</button></details></div>` : ""}`;
}

/* ── PDF ── */
async function abrirPdf() {
  const me = st, rel = st.rel;
  try {
    const [lib, url] = await Promise.all([pdfjs(), S.urlRelatorio(st.host.sb, rel.caminho)]);
    const doc = await lib.getDocument({ url, isEvalSupported: false }).promise;
    if (st !== me || st.rel?.id !== rel.id) { doc.destroy(); return; }
    st.doc = doc; st.pagina = 1; desenharPagina();
  } catch (err) {
    console.error(err);
    const box = document.getElementById("rvPdf"); if (box && st === me) box.innerHTML = `<div class="ch-state"><b>Não foi possível exibir o PDF aqui.</b><span>Use "Abrir" ou "Baixar".</span></div>`;
  }
}
let desenhando = null;
async function desenharPagina() {
  const box = document.getElementById("rvPdf"); if (!box || !st?.doc) return;
  const me = st, n = st.pagina, doc = st.doc;
  document.getElementById("rvPag").textContent = `${n} / ${doc.numPages}`;
  document.getElementById("rvZoom").textContent = Math.round(st.zoom * 100) + "%";
  try {
    desenhando?.cancel?.();
    const page = await doc.getPage(n); if (st !== me) return;
    const base = page.getViewport({ scale: 1 }), largura = Math.max(280, box.clientWidth - 2);
    const escala = (largura / base.width) * st.zoom, dpr = Math.min(window.devicePixelRatio || 1, 3);
    const vp = page.getViewport({ scale: escala * dpr });
    const cv = document.createElement("canvas"); cv.width = Math.floor(vp.width); cv.height = Math.floor(vp.height);
    cv.style.width = Math.floor(vp.width / dpr) + "px"; cv.style.height = Math.floor(vp.height / dpr) + "px";
    desenhando = page.render({ canvasContext: cv.getContext("2d"), viewport: vp });
    await desenhando.promise; desenhando = null;
    if (st !== me || st.pagina !== n) return;
    box.innerHTML = ""; box.appendChild(cv);
  } catch (err) { if (err?.name !== "RenderingCancelledException") console.error(err); }
}

/* ── ações ── */
async function clique(e) {
  if (!st) return;
  const t = e.target.closest("[data-rv],[data-aprm]"); if (!t) return;
  const a = t.dataset.rv;
  if (a === "fechar") return fechar();
  if (a === "ant" && st.doc && st.pagina > 1) { st.pagina--; return desenharPagina(); }
  if (a === "prox" && st.doc && st.pagina < st.doc.numPages) { st.pagina++; return desenharPagina(); }
  if (a === "mais") { st.zoom = Math.min(4, +(st.zoom + 0.25).toFixed(2)); return desenharPagina(); }
  if (a === "menos") { st.zoom = Math.max(0.5, +(st.zoom - 0.25).toFixed(2)); return desenharPagina(); }
  if (a === "ajustar") { st.zoom = 1; return desenharPagina(); }
  if (a === "abrir" || a === "baixar") {
    const w = a === "abrir" ? window.open("", "_blank") : null;
    try {
      const url = await S.urlRelatorio(st.host.sb, st.rel.caminho, { baixar: a === "baixar" ? st.rel.nome_arquivo || "relatorio.pdf" : "" });
      if (w) w.location.href = url; else { const l = document.createElement("a"); l.href = url; l.rel = "noopener"; document.body.appendChild(l); l.click(); l.remove(); }
    } catch (err) { w?.close(); st.host.toast(err.message); }
    return;
  }
  if (a === "remover") {
    if (!confirm(`Remover o relatório "${st.rel.nome_arquivo || "PDF"}" desta unidade? O arquivo é apagado e o checklist dele sai junto.`)) return;
    try { await S.removerRelatorio(st.host.sb, st.rel.id); st.host.toast("Relatório removido"); st.rel = null; await carregar(); st.aoMudar?.(); }
    catch (err) { st.host.toast(err.message); }
    return;
  }
  if (a === "ler") return lerDoPdf();
  if (a === "descartar") { st.extraidos = null; return pintarChecklist(); }
  if (a === "salvarext") {
    const textos = st.extraidos.filter((x) => x.usar).map((x) => x.texto);
    if (!textos.length) { st.host.toast("Nenhum apontamento selecionado"); return; }
    return salvarTextos(textos, () => { st.extraidos = null; });
  }
  if (a === "addman") {
    const textos = String(document.getElementById("rvNovo")?.value || "").split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
    if (!textos.length) { st.host.toast("Escreva um apontamento por linha"); return; }
    return salvarTextos(textos, () => {});
  }
  const rm = t.dataset.aprm;
  if (rm) {
    if (!confirm("Remover este apontamento do checklist?")) return;
    try { await S.removerApontamento(st.host.sb, Number(rm)); await recarregarApontamentos(); pintar(); } catch (err) { st.host.toast(err.message); }
  }
}
async function salvarTextos(textos, depois) {
  try { const r = await S.adicionarApontamentos(st.host.sb, st.rel.id, textos); depois(); st.host.toast(`${r?.adicionados || textos.length} apontamento(s) no checklist`); await recarregarApontamentos(false); pintar(); }
  catch (err) { st.host.toast(err.message); }
}
async function mudou(e) {
  if (!st) return;
  const t = e.target;
  if (t.dataset.rv === "sel") { st.rel = st.rels.find((r) => String(r.id) === t.value) || st.rel; st.extraidos = null; st.doc?.destroy?.(); st.doc = null; await recarregarApontamentos(false); pintar(); abrirPdf(); return; }
  if (t.dataset.rv === "arquivo") { const f = t.files?.[0]; t.value = ""; if (f) enviar(f); return; }
  if (t.dataset.ext != null) { st.extraidos[Number(t.dataset.ext)].usar = t.checked; return; }
  if (t.dataset.ap) {
    const id = Number(t.dataset.ap), ok = t.checked; t.disabled = true;
    try { await S.marcarApontamento(st.host.sb, id, ok); await recarregarApontamentos(false); pintar(); }
    catch (err) { t.checked = !ok; t.disabled = false; st.host.toast(err.message); }
  }
}
async function lerDoPdf() {
  try {
    const lib = await pdfjs();
    const doc = st.doc || await lib.getDocument({ url: await S.urlRelatorio(st.host.sb, st.rel.caminho), isEvalSupported: false }).promise;
    const r = extrair(await lerTexto(doc));
    const ja = new Set(st.aps.map((a) => a.texto));
    st.extraidos = r.apontamentos.map((a) => ({ texto: a.texto, usar: !ja.has(a.texto) }));
    pintarChecklist();
  } catch (err) { console.error(err); st.host.toast("Não foi possível ler o PDF"); }
}
const seguro = (s) => String(s || "relatorio").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9._-]+/g, "_").replace(/_+/g, "_").slice(0, 80) || "relatorio";
async function enviar(arq) {
  const u = st.u, host = st.host;
  if (!/\.pdf$/i.test(arq.name) && arq.type !== "application/pdf") { host.toast("Envie um arquivo PDF"); return; }
  if (arq.size > LIMITE) { host.toast("Arquivo grande demais (máximo de 25 MB)"); return; }
  st.enviando = "Lendo o PDF…"; pintar();
  let resumo = {}, paginas = null, aps = [];
  try {
    const lib = await pdfjs();
    const doc = await lib.getDocument({ data: new Uint8Array(await arq.arrayBuffer()), isEvalSupported: false }).promise;
    paginas = doc.numPages;
    const r = extrair(await lerTexto(doc)); doc.destroy();
    aps = r.apontamentos;
    resumo = { unidade: r.unidade?.texto || "", realizado: r.realizado, hora: r.hora, naoConformidades: r.naoConformidades, responsavel: r.responsavel };
    const mesma = mesmaUnidade(r.unidade, u.b, host.casa() ? +u.a : u.codigo);
    if (mesma === false && !confirm(`Este PDF parece ser de ${r.unidade.texto}, não do ${host.casa() ? `Conjunto ${u.b} casa ${+u.a}` : `Bloco ${u.b} apto ${u.codigo}`}. Enviar mesmo assim?`)) { st.enviando = ""; pintar(); return; }
  } catch (err) { console.error(err); if (!confirm("Não foi possível ler o conteúdo deste PDF (os apontamentos não serão lidos). Enviar mesmo assim?")) { st.enviando = ""; pintar(); return; } }
  st.enviando = "Enviando…"; pintar();
  try {
    const caminho = `${host.project.id}/${seguro(u.b)}/${seguro(host.casa() ? String(+u.a) : u.codigo)}/${Date.now()}-${seguro(arq.name.replace(/\.pdf$/i, ""))}.pdf`;
    const r = await S.enviarRelatorio(host.sb, { unitId: u.unitId, caminho, arquivo: arq, nome: arq.name.slice(0, 200), tamanho: arq.size, paginas, resumo });
    st.enviando = ""; host.toast("Relatório enviado");
    st.rel = r.relatorio; st.doc?.destroy?.(); st.doc = null;
    await carregar(true);
    if (!st) return;
    st.extraidos = aps.map((a) => ({ texto: a.texto, usar: true }));
    pintarChecklist(); st.aoMudar?.();
  } catch (err) { if (st) { st.enviando = ""; pintar(); } host.toast(err.message || "Não foi possível enviar"); }
}
