// Relatório da unidade (aba Revistoria · Cliente): cabeçalho, checklist de apontamentos e o PDF original.
// O PDF fica no Storage privado e é aberto por URL assinada e temporária; o checklist é só acompanhamento
// (revistorias_apontamentos) e nunca altera o PDF. pdf.js (www/pdfjs) é carregado só quando a tela abre.
// O checklist é o da UNIDADE: apontamentos de todos os relatórios ativos, sem repetidos (M.checklistUnidade),
// a mesma regra das colunas Qtd. Apontamentos / Qtd. Resolvidas da Lista. Enviar outro PDF não apaga nada:
// os itens já existentes mantêm o registro de resolução e só os novos entram, depois da conferência.
// Conversão: depois do envio, a Edge Function relatorio-converter gera o relatório compacto como uma nova versão do
// mesmo registro (o original nunca muda). O visualizador abre o convertido por padrão, com a opção do original,
// em rolagem contínua; enquanto a conversão roda, a etapa aparece aqui (tempo real + consulta periódica).
import * as M from "./model.js";
import * as S from "./service.js";
import * as C from "./conversao.js";
import { extrair, mesmaUnidade } from "./relatorio.js";
import { criarVisualizador } from "./visualizador.js";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const pad = (n) => String(n).padStart(2, "0");
const fmtD = (d) => { const p = String(d || "").slice(0, 10).split("-"); return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : ""; };
const fmtDH = (ts) => { if (!ts) return ""; const d = new Date(ts); return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const MB = (n) => (!n ? "" : n < 1048576 ? Math.max(1, Math.round(n / 1024)) + " KB" : (n / 1048576).toFixed(n > 10485760 ? 0 : 1).replace(".", ",") + " MB");
export const LIMITE = 25 * 1048576;

let pdfjsP = null;
/** pdf.js (versão legacy: Safari/iPhone mais antigos), carregado sob demanda de www/pdfjs. */
export function pdfjs() {
  if (!pdfjsP) {
    const base = document.baseURI;
    const url = new URL("./pdfjs/pdf.min.js", base).href;
    pdfjsP = import(/* @vite-ignore */ url).then((m) => { m.GlobalWorkerOptions.workerSrc = new URL("./pdfjs/pdf.worker.min.js", base).href; return m; })
      .catch((e) => { pdfjsP = null; throw e; });
  }
  return pdfjsP;
}
/** Texto do PDF com posições (para o extrator). */
export async function lerTexto(doc) {
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
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && ov.classList.contains("open") && !document.fullscreenElement) { if (ov.classList.contains("rv-cheia")) telaCheia(false); else fechar(); } });
    document.addEventListener("fullscreenchange", () => { if (!document.fullscreenElement && ov.classList.contains("rv-cheia")) telaCheia(false, true); });
  }
  return ov;
}

/**
 * Abre o relatório da unidade.
 * @param ctx { host, u (unidade com situacao), podeEditar, aoMudar }
 */
export async function abrirRelatorio(ctx) {
  const ov = el();
  st = { ...ctx, rels: null, rel: null, aps: [], apsTodos: [], versoes: [], escolha: null, aberto: "", viz: null, caixa: null, sond: null,
    erro: "", extraidos: null, enviando: "", canal: null, pedindo: false };
  ov.classList.add("open"); document.body.classList.add("rv-aberto");
  ov.querySelector("#rvKick").textContent = `${ctx.host.project.name} · ${ctx.host.casa() ? `Conjunto ${ctx.u.b}` : `Bloco ${ctx.u.b}`}`;
  ov.querySelector("#rvTit").textContent = `Relatório · ${ctx.host.casa() ? `Casa ${+ctx.u.a}` : `Apto ${ctx.u.codigo}`}`;
  pintar();
  assinar();
  await carregar();
}
export function fechar() {
  const ov = document.getElementById("rvRelOv"); if (!ov?.classList.contains("open")) return;
  if (st?.extraidos?.some((x) => x.usar && !x.existente && !x.repetido) && !confirm("Os apontamentos lidos do PDF ainda não foram salvos no checklist. Fechar mesmo assim?")) return;
  if (ov.classList.contains("rv-cheia")) telaCheia(false);
  ov.classList.remove("open"); document.body.classList.remove("rv-aberto");
  try { st?.canal?.(); } catch { /* sem tempo real */ }
  clearTimeout(st?.sond); st?.viz?.destruir(); st = null;
}
function assinar() {
  const sb = st.host.sb; if (!sb?.channel) return;
  const filtro = `unit_id=eq.${st.u.unitId}`, me = st;
  const ch = sb.channel(`rev-rel-${st.u.unitId}-${Date.now()}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "revistorias_apontamentos", filter: filtro }, () => { if (st === me) recarregarApontamentos(); })
    .on("postgres_changes", { event: "*", schema: "public", table: "revistorias_relatorios", filter: filtro }, () => { if (st === me) carregar(true); })
    .on("postgres_changes", { event: "*", schema: "public", table: "revistorias_relatorios_versoes", filter: filtro }, () => { if (st === me) carregar(true); })
    .subscribe();
  st.canal = () => sb.removeChannel(ch);
}
async function carregar(manterPdf = false) {
  const me = st;
  try {
    const [rels, versoes] = await Promise.all([S.relatorios(st.host.sb, st.u.unitId), S.versoes(st.host.sb, st.u.unitId)]); if (st !== me) return;
    const antes = st.rel && C.versoesDoRelatorio(st.rel, st.versoes).vigente?.id;
    st.rels = rels; st.versoes = versoes; st.erro = "";
    const atual = st.rel && rels.find((r) => r.id === st.rel.id);
    if (!atual || !manterPdf) { st.rel = atual || rels[0] || null; if (!manterPdf) st.escolha = null; } else st.rel = atual;
    // convertido novo chegou e o usuário não escolheu o original: passa a mostrar o convertido
    const info = C.versoesDoRelatorio(st.rel, versoes);
    if (info.vigente && info.vigente.id !== antes && st.escolha === null) st.aberto = "";
    await recarregarApontamentos(false);
    pintar();
    abrirPdf();
    sondar();
  } catch (err) { if (st === me) { st.erro = S.naoInstalado(err) ? "Os relatórios ainda não foram instalados no banco." : err.message || "Não foi possível carregar."; pintar(); } }
}
async function recarregarApontamentos(repintar = true) {
  if (!st) return;
  if (!st.rels?.length) { st.aps = []; st.apsTodos = []; return; }
  const me = st;
  const aps = await S.apontamentosUnidade(st.host.sb, st.u.unitId).catch(() => null);
  if (st !== me || !aps) return;
  st.apsTodos = aps; st.aps = M.checklistUnidade(aps, st.rels);
  if (repintar) { pintarChecklist(); pintarCabecalho(); }
}
/** Lista, mapa e outros aparelhos: os quantitativos vêm dos mesmos registros (tempo real cobre os demais aparelhos). */
const avisar = () => { try { st?.aoMudar?.(); } catch { /* sem lista aberta */ } };
function pintarCabecalho() { const c = document.querySelector("#rvBody .rv-cab"); if (c) c.outerHTML = cabecalho(); }

/* ── tela ── */
function cabecalho() {
  const u = st.u, s = u.situacao, ag = M.agendaRevistoria(s), resumo = st.rel?.resumo || {};
  const resp = (s.aberto || s.ultima)?.responsavel || resumo.responsavel || "";
  const q = M.resumoApontamentos(st.aps);
  const campo = (rot, val) => `<div><span>${esc(rot)}</span><b>${val || "—"}</b></div>`;
  return `<div class="rv-cab">
      ${campo("Condomínio", esc(st.host.project.name))}
      ${campo(st.host.grupo(), esc(u.b))}
      ${campo(st.host.casa() ? "Casa" : "Apartamento", esc(st.host.casa() ? +u.a : u.codigo))}
      ${campo("Data da revistoria", esc([fmtD(ag.data), ag.hora].filter(Boolean).join(" · ")) || (resumo.realizado ? esc(fmtD(resumo.realizado)) + " <small>(relatório)</small>" : ""))}
      ${campo("Responsável pela vistoria", esc(resp))}
      <div><span>Status da revistoria</span>${s.status ? `<span class="rc-badge" style="--c:${M.info(s.status).cor};--b:${M.info(s.status).borda}">${esc(M.info(s.status).label)}</span>` : "<b>Sem registro</b>"}</div>
      ${campo("Apontamentos", st.rel ? `${q.total ? `${q.total} <small>· ${q.resolvidas} resolvido(s) · ${q.pct}%</small>` : "—"}${resumo.naoConformidades != null ? ` <small>· ${esc(resumo.naoConformidades)} NC no relatório</small>` : ""}` : "")}
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
    ${st.rel ? secaoDocumento() : ""}`;
  pintarChecklist();
  montarVisualizador();
}
const fmtTam = (v) => [v?.tamanho ? MB(v.tamanho) : "", v?.paginas ? `${v.paginas} pág.` : ""].filter(Boolean).join(" · ");
function rotuloVersao(v, info) {
  if (!v) return "";
  if (v.tipo === "original") return `Original Mobuss · ${esc(st.rel.nome_arquivo || "PDF")}${fmtTam(v) ? " · " + fmtTam(v) : ""} · enviado ${esc(fmtDH(st.rel.enviado_em))}${st.rel.enviado_email ? " por " + esc(st.rel.enviado_email) : ""}`;
  const r = v.resumo || {};
  return `Convertido · versão ${v.versao}${v.id !== info.vigente?.id ? " (anterior)" : ""} · gerado ${esc(fmtDH(v.concluido_em || v.atualizado_em))}${fmtTam(v) ? " · " + fmtTam(v) : ""}${r.ncs != null ? ` · ${r.ncs} NCs · ${r.fotos} fotos` : ""}`;
}
function avisoConversao(info) {
  const ed = st.podeEditar, s = info.status;
  if (C.emAndamento(s)) {
    const k = C.ETAPAS.indexOf(s);
    return `<div class="rv-conv run" role="status"><div class="ch-spin" aria-hidden="true"></div><div><b>Convertendo para o modelo compacto: ${esc(C.rotulo(s))}…</b>
      <ol class="rv-etapas">${C.ETAPAS.map((e, i) => `<li class="${i < k ? "ok" : i === k ? "atual" : ""}">${esc(C.STATUS[e].curto)}</li>`).join("")}</ol>
      <span>O original já pode ser consultado. O convertido abre aqui sozinho quando ficar pronto.</span></div></div>`;
  }
  if (s === "falha") {
    const erro = info.ultima?.erro || st.rel.conversao_erro || "Erro desconhecido";
    return `<div class="rv-conv err" role="alert"><div><b>A conversão falhou.</b><span>${esc(erro)}</span>${info.vigente ? `<span>Exibindo a última versão válida (versão ${info.vigente.versao}).</span>` : "<span>O original continua disponível.</span>"}</div>${ed ? `<button type="button" class="btn p" data-rv="converter" data-reproc="1"${st.pedindo ? " disabled" : ""}>Tentar novamente</button>` : ""}</div>`;
  }
  if (!info.vigente) {
    return `<div class="rv-conv pend"><div><b>Pendente de conversão</b><span>Este relatório ainda não tem a versão compacta.${ed ? "" : " A conversão é feita pela equipe de revistorias e administradores."}</span></div>${ed ? `<button type="button" class="btn p" data-rv="converter"${st.pedindo ? " disabled" : ""}>${st.pedindo ? "Iniciando…" : "Converter agora"}</button>` : ""}</div>`;
  }
  return "";
}
function historico(info) {
  const todas = [...info.convertidas, info.original].filter(Boolean);
  const exib = C.arquivoExibido(info, st.escolha);
  const linha = (v) => {
    const pode = v.status === "disponivel" && v.caminho, atual = exib && v === exib;
    const nome = v.tipo === "original" ? "Original Mobuss" : `Convertido v${v.versao}`;
    const quando = fmtDH(v.concluido_em || v.atualizado_em || v.criado_em);
    return `<li class="${atual ? "atual" : ""}"><span class="rv-h-n">${esc(nome)}</span><span class="rv-h-s s-${esc(v.status)}">${esc(C.STATUS[v.status]?.curto || v.status)}</span>
      <span class="rv-h-d">${esc(quando)}${v.solicitado_email ? " · " + esc(v.solicitado_email) : ""}${v.erro ? `<em>${esc(v.erro)}</em>` : ""}</span>
      ${pode && !atual ? `<button type="button" class="btn g" data-rv="verv" data-id="${v.id ?? ""}" data-tipo="${v.tipo}">Ver</button>` : atual ? "<small>exibindo</small>" : ""}</li>`;
  };
  const reproc = st.podeEditar && info.vigente && !C.emAndamento(info.status)
    ? `<button type="button" class="btn g" data-rv="converter" data-reproc="1"${st.pedindo ? " disabled" : ""}>Reprocessar conversão</button>` : "";
  return `<details class="rv-hist"><summary>Versões do relatório (${todas.length})</summary><ul>${todas.map(linha).join("")}</ul>${reproc ? `<div class="rv-hist-a">${reproc}<span>Gera uma nova versão; as anteriores e o original ficam guardados.</span></div>` : ""}</details>`;
}
function secaoDocumento() {
  const info = C.versoesDoRelatorio(st.rel, st.versoes), v = C.arquivoExibido(info, st.escolha);
  const conv = v?.tipo === "convertido", temConv = !!info.vigente;
  return `<section class="rv-sec rv-doc">
    <div class="rv-sec-h"><b>Relatório</b><span class="rv-meta" id="rvVersao">${rotuloVersao(v, info)}</span></div>
    ${avisoConversao(info)}
    <div class="rv-pdfbar">
      <div class="rv-seg" role="group" aria-label="Versão exibida">
        <button type="button" data-rv="ver" data-v="convertido" aria-pressed="${conv}"${temConv ? "" : ` disabled title="${esc(C.rotulo(info.status))}"`}>Convertido</button>
        <button type="button" data-rv="ver" data-v="original" aria-pressed="${!conv}">Original Mobuss</button>
      </div>
      <span class="rv-pg" id="rvPag" aria-live="polite">—</span>
      <span class="rv-grp"><button type="button" class="btn g" data-rv="menos" aria-label="Diminuir zoom">−</button><span id="rvZoom">100%</span><button type="button" class="btn g" data-rv="mais" aria-label="Aumentar zoom">+</button><button type="button" class="btn g" data-rv="ajustar" title="Ajustar à largura">Ajustar</button></span>
      <span class="rv-grp"><button type="button" class="btn g" data-rv="cheia" aria-label="Tela cheia" title="Tela cheia">⛶</button><button type="button" class="btn g" data-rv="abrir">Abrir</button><button type="button" class="btn g" data-rv="baixar">Baixar</button></span>
    </div>
    <div class="rv-pdf" id="rvPdf"></div>
    ${historico(info)}
  </section>`;
}
function pintarChecklist() {
  const c = document.getElementById("rvCheck"); if (!c || !st) return;
  if (!st.rel) { c.innerHTML = ""; return; }
  const ed = st.podeEditar, varios = st.rels.length > 1, relDe = new Map(st.rels.map((r) => [r.id, r]));
  const origem = (a) => (varios ? `<em class="rv-orig">relatório de ${esc(fmtDH(relDe.get(a.relatorio_id)?.enviado_em).slice(0, 10))}</em>` : "");
  const lista = st.aps.length ? `<ol class="rv-list">${st.aps.map((a, i) => `<li class="${a.concluido ? "ok" : ""}"><label><input type="checkbox" data-ap="${a.id}" ${a.concluido ? "checked" : ""} ${ed ? "" : "disabled"}><span class="rv-n">${i + 1}</span><span class="rv-t">${esc(a.texto)}${origem(a)}${a.concluido && a.concluido_email ? `<small>resolvido ${esc(fmtDH(a.concluido_em))} · ${esc(a.concluido_email)}</small>` : ""}</span></label>${ed ? `<button type="button" class="rv-x" data-aprm="${a.id}" aria-label="Remover apontamento">×</button>` : ""}</li>`).join("")}</ol>`
    : `<p class="rv-nada">Nenhum apontamento no checklist.</p>`;
  const ex = st.extraidos;
  const novos = ex ? ex.filter((a) => !a.existente && !a.repetido) : [], ja = ex ? ex.filter((a) => a.existente) : [];
  const preview = ex ? `<div class="rv-ext"><div class="rv-ext-h"><b>${ex.length} apontamento(s) lido(s) do PDF</b><span>Confira antes de salvar: só os itens marcados entram no checklist. ${ja.length ? "Os que já estão no checklist não são duplicados e mantêm o registro de resolução." : ""}</span></div>
      ${novos.length ? `<ol class="rv-list rv-ext-l">${ex.map((a, i) => (a.existente || a.repetido ? "" : `<li><label><input type="checkbox" data-ext="${i}" ${a.usar ? "checked" : ""}><span class="rv-t">${esc(a.texto)}</span></label></li>`)).join("")}</ol>` : ""}
      ${ja.length ? `<div class="rv-ext-ja"><b>${ja.length} já no checklist</b><ul>${ja.map((a) => `<li class="${a.existente.concluido ? "ok" : ""}"><span>${esc(a.texto)}</span><em>${a.existente.concluido ? "resolvido · mantido" : "pendente · mantido"}</em></li>`).join("")}</ul></div>` : ""}
      ${!ex.length ? `<p class="rv-nada">Nenhum item reprovado encontrado no PDF. Adicione os apontamentos manualmente, se houver.</p>` : ""}
      <div class="rv-ext-a"><button type="button" class="btn g" data-rv="descartar">${novos.length ? "Descartar" : "Fechar conferência"}</button>${novos.length ? `<button type="button" class="btn p" data-rv="salvarext">Adicionar ao checklist</button>` : ""}</div></div>` : "";
  const q = M.resumoApontamentos(st.aps);
  c.innerHTML = `<div class="rv-sec-h"><b>Apontamentos · checklist</b><span class="rv-meta">${q.total ? `${q.resolvidas} de ${q.total} resolvido(s) · ${q.pct}%` : "sem apontamentos"}${varios ? ` · ${st.rels.length} relatórios` : ""}</span></div>
    ${preview}${lista}
    ${ed ? `<div class="rv-add">${!ex ? `<button type="button" class="btn g" data-rv="ler">Ler apontamentos do PDF</button>` : ""}<details><summary>Adicionar manualmente</summary><textarea id="rvNovo" rows="3" maxlength="6000" placeholder="Um apontamento por linha"></textarea><button type="button" class="btn p" data-rv="addman">Adicionar</button></details></div>` : ""}`;
}

/* ── PDF (visualizador em rolagem contínua; o elemento rolável sobrevive às repinturas) ── */
function montarVisualizador() {
  const lugar = document.getElementById("rvPdf"); if (!lugar || !st) return;
  if (!st.caixa) {
    st.caixa = document.createElement("div"); st.caixa.className = "rv-pdf"; st.caixa.id = "rvPdf"; st.caixa.tabIndex = 0;
    st.caixa.setAttribute("aria-label", "Páginas do relatório");
    const me = st;
    st.viz = criarVisualizador(st.caixa, { aoMudar: (e) => { if (st !== me) return; const p = document.getElementById("rvPag"), z = document.getElementById("rvZoom");
      if (p) p.textContent = e.total ? `Página ${e.pagina} de ${e.total}` : "—"; if (z) z.textContent = Math.round(e.zoom * 100) + "%"; } });
  }
  if (lugar !== st.caixa) lugar.replaceWith(st.caixa);
  const p = document.getElementById("rvPag"), z = document.getElementById("rvZoom");
  if (p && st.viz.total) p.textContent = `Página ${st.viz.pagina()} de ${st.viz.total}`;
  if (z) z.textContent = Math.round(st.viz.zoom * 100) + "%";
}
async function abrirPdf() {
  if (!st?.rel) return;
  const info = C.versoesDoRelatorio(st.rel, st.versoes), v = C.arquivoExibido(info, st.escolha);
  if (!v?.caminho || v.caminho === st.aberto) return;
  const me = st; st.aberto = v.caminho;
  montarVisualizador();
  try {
    const [lib, url] = await Promise.all([pdfjs(), S.urlRelatorio(st.host.sb, v.caminho)]);
    if (st !== me || st.aberto !== v.caminho) return;
    await st.viz.abrir(lib, { url });
  } catch (err) {
    console.error(err);
    if (st === me && st.aberto === v.caminho) { st.aberto = ""; st.caixa.innerHTML = `<div class="vz-msg"><b>Não foi possível exibir o PDF aqui.</b><span>Use "Abrir" ou "Baixar".</span></div>`; }
  }
}
/** Enquanto houver conversão em andamento, consulta de novo (cobre aparelhos sem tempo real). */
function sondar() {
  clearTimeout(st?.sond); if (!st?.rel) return;
  const info = C.versoesDoRelatorio(st.rel, st.versoes); if (!C.emAndamento(info.status)) return;
  const me = st; st.sond = setTimeout(() => { if (st === me) carregar(true); }, 4000);
}
async function pedirConversao(reprocessar) {
  if (!st?.rel || st.pedindo) return;
  const me = st; st.pedindo = true; pintar();
  try {
    const r = await S.converterRelatorio(st.host.sb, st.rel.id, reprocessar);
    if (st !== me) return;
    st.host.toast(r?.em_andamento ? "A conversão já está em andamento" : r?.ja_convertido ? "Este relatório já está convertido" : "Conversão iniciada");
  } catch (err) { if (st === me) st.host.toast(err.message); }
  finally { if (st === me) { st.pedindo = false; await carregar(true); } }
}
function telaCheia(ligar, jaSaiu = false) {
  const ov = document.getElementById("rvRelOv"); if (!ov) return;
  ov.classList.toggle("rv-cheia", ligar);
  if (ligar) ov.requestFullscreen?.().catch(() => { /* iPhone: só o modo da página */ });
  else if (!jaSaiu && document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
  const b = ov.querySelector('[data-rv="cheia"]'); if (b) b.setAttribute("aria-pressed", String(ligar));
}

/* ── ações ── */
async function clique(e) {
  if (!st) return;
  const t = e.target.closest("[data-rv],[data-aprm]"); if (!t) return;
  const a = t.dataset.rv;
  if (a === "fechar") return fechar();
  if (a === "mais") return st.viz?.mais();
  if (a === "menos") return st.viz?.menos();
  if (a === "ajustar") return st.viz?.ajustar();
  if (a === "cheia") return telaCheia(!document.getElementById("rvRelOv").classList.contains("rv-cheia"));
  if (a === "ver") { st.escolha = t.dataset.v === "original" ? "original" : null; pintar(); return abrirPdf(); }
  if (a === "verv") {
    const id = t.dataset.id ? Number(t.dataset.id) : null;
    st.escolha = t.dataset.tipo === "original" ? "original" : { id }; pintar(); return abrirPdf();
  }
  if (a === "converter") return pedirConversao(t.dataset.reproc === "1");
  if (a === "abrir" || a === "baixar") {
    const w = a === "abrir" ? window.open("", "_blank") : null;
    try {
      const v = C.arquivoExibido(C.versoesDoRelatorio(st.rel, st.versoes), st.escolha);
      const url = await S.urlRelatorio(st.host.sb, v.caminho, { baixar: a === "baixar" ? C.nomeDownload(st.rel, v) : "" });
      if (w) w.location.href = url; else { const l = document.createElement("a"); l.href = url; l.rel = "noopener"; document.body.appendChild(l); l.click(); l.remove(); }
    } catch (err) { w?.close(); st.host.toast(err.message); }
    return;
  }
  if (a === "remover") {
    const dele = st.aps.filter((x) => x.relatorio_id === st.rel.id), res = dele.filter((x) => x.concluido).length;
    const aviso = dele.length ? `\n\nConferência: ${dele.length} apontamento(s) deste relatório (${res} resolvido(s)) saem do checklist e dos quantitativos da Lista. O registro fica guardado no histórico do banco.` : "";
    if (!confirm(`Remover o relatório "${st.rel.nome_arquivo || "PDF"}" desta unidade? O arquivo é apagado.${aviso}`)) return;
    try { await S.removerRelatorio(st.host.sb, st.rel.id); st.host.toast("Relatório removido"); st.rel = null; await carregar(); avisar(); }
    catch (err) { st.host.toast(err.message); }
    return;
  }
  if (a === "ler") return lerDoPdf();
  if (a === "descartar") { st.extraidos = null; return pintarChecklist(); }
  if (a === "salvarext") {
    const textos = st.extraidos.filter((x) => x.usar && !x.existente && !x.repetido).map((x) => x.texto);
    if (!textos.length) { st.host.toast("Nenhum apontamento selecionado"); return; }
    return salvarTextos(textos, () => { st.extraidos = null; });
  }
  if (a === "addman") {
    const linhas = String(document.getElementById("rvNovo")?.value || "").split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
    if (!linhas.length) { st.host.toast("Escreva um apontamento por linha"); return; }
    const conf = M.conferirExtraidos(linhas, st.aps), textos = conf.filter((x) => x.usar).map((x) => x.texto), pulados = linhas.length - textos.length;
    if (!textos.length) { st.host.toast("Esses apontamentos já estão no checklist"); return; }
    return salvarTextos(textos, () => {}, pulados);
  }
  const rm = t.dataset.aprm;
  if (rm) {
    if (!confirm("Remover este apontamento do checklist?")) return;
    try { await S.removerApontamento(st.host.sb, Number(rm)); await recarregarApontamentos(); pintar(); avisar(); } catch (err) { st.host.toast(err.message); }
  }
}
async function salvarTextos(textos, depois, pulados = 0) {
  try {
    const r = await S.adicionarApontamentos(st.host.sb, st.rel.id, textos); depois();
    st.host.toast(`${r?.adicionados || textos.length} apontamento(s) no checklist${pulados ? ` · ${pulados} já existia(m)` : ""}`);
    await recarregarApontamentos(false); pintar(); avisar();
  }
  catch (err) { st.host.toast(err.message); }
}
async function mudou(e) {
  if (!st) return;
  const t = e.target;
  if (t.dataset.rv === "sel") { st.rel = st.rels.find((r) => String(r.id) === t.value) || st.rel; st.extraidos = null; st.escolha = null; pintar(); abrirPdf(); sondar(); return; }
  if (t.dataset.rv === "arquivo") { const f = t.files?.[0]; t.value = ""; if (f) enviar(f); return; }
  if (t.dataset.ext != null) { st.extraidos[Number(t.dataset.ext)].usar = t.checked; return; }
  if (t.dataset.ap) {
    const id = Number(t.dataset.ap), ok = t.checked; t.disabled = true;
    try { await S.marcarApontamento(st.host.sb, id, ok); await recarregarApontamentos(false); pintar(); avisar(); }
    catch (err) { t.checked = !ok; t.disabled = false; st.host.toast(err.message); }
  }
}
async function lerDoPdf() {
  try {
    const lib = await pdfjs();
    // sempre do original do Mobuss (o checklist usa o texto original, não o compacto)
    const doc = await lib.getDocument({ url: await S.urlRelatorio(st.host.sb, st.rel.caminho), isEvalSupported: false }).promise;
    const r = extrair(await lerTexto(doc)); doc.destroy();
    st.extraidos = M.conferirExtraidos(r.apontamentos.map((a) => a.texto), st.aps);
    pintarChecklist();
  } catch (err) { console.error(err); st.host.toast("Não foi possível ler o PDF"); }
}
export const seguro = (s) => String(s || "relatorio").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9._-]+/g, "_").replace(/_+/g, "_").slice(0, 80) || "relatorio";
/** Caminho no Storage: <condomínio>/<bloco>/<apto>/<data>-<arquivo>.pdf (validado de novo pelo banco). */
export const caminhoRelatorio = (host, u, nome) =>
  `${host.project.id}/${seguro(u.b)}/${seguro(host.casa() ? String(+u.a) : u.codigo)}/${Date.now()}-${seguro(String(nome || "").replace(/\.pdf$/i, ""))}.pdf`;
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
    const caminho = caminhoRelatorio(host, u, arq.name);
    const r = await S.enviarRelatorio(host.sb, { unitId: u.unitId, caminho, arquivo: arq, nome: arq.name.slice(0, 200), tamanho: arq.size, paginas, resumo });
    st.enviando = ""; host.toast("Relatório enviado · convertendo para o modelo compacto");
    st.rel = r.relatorio; st.escolha = null; st.aberto = "";
    // conversão automática (em segundo plano no servidor); falha aqui não desfaz o envio
    S.converterRelatorio(host.sb, r.relatorio.id).catch((err) => host.toast(err.message)).finally(() => { if (st) carregar(true); });
    await carregar(true);
    if (!st) return;
    st.extraidos = M.conferirExtraidos(aps.map((a) => a.texto), st.aps);
    pintarChecklist(); avisar();
  } catch (err) { if (st) { st.enviando = ""; pintar(); } host.toast(err.message || "Não foi possível enviar"); }
}
