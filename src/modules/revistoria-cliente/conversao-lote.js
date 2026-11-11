// Conversão em lote (aba Revistoria · Cliente, admin e revistorias): converte de uma vez os relatórios do Mobuss
// já enviados que ainda não têm a versão compacta ("pendente de conversão") e, opcionalmente, tenta de novo os que
// falharam. Usa o mesmo caminho do botão "Converter agora" (Edge Function relatorio-converter, com o login do
// usuário: o banco confere a permissão e não duplica conversões). Três por vez; cada uma é acompanhada até ficar
// Disponível ou Falha. O original nunca é alterado; uma falha não apaga nada e pode ser tentada de novo depois.
import * as S from "./service.js";
import * as C from "./conversao.js";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const SIMULTANEAS = 3, ESPERA_MAX = 180000;
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

let st = null;
function el() {
  let ov = document.getElementById("rvConvOv");
  if (!ov) {
    ov = document.createElement("div"); ov.id = "rvConvOv"; ov.className = "rv-ov"; ov.setAttribute("role", "dialog"); ov.setAttribute("aria-modal", "true");
    ov.innerHTML = `<div class="rv-box cl-box"><div class="rv-head"><div class="rv-tit"><small id="clKick"></small><strong>Converter relatórios do Mobuss</strong></div><button type="button" class="pp-icon" data-cl="fechar" aria-label="Fechar">×</button></div><div class="rv-body" id="clBody"></div></div>`;
    document.body.appendChild(ov);
    ov.addEventListener("click", (e) => { if (e.target === ov) fechar(); else clique(e); });
    ov.addEventListener("change", (e) => { if (st && e.target.dataset.cl === "falhas") { st.incluirFalhas = e.target.checked; pintar(); } });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && ov.classList.contains("open")) fechar(); });
  }
  return ov;
}

/** @param ctx { host, unidades: () => [unidade], aoMudar } */
export async function abrirConversaoLote(ctx) {
  const ov = el();
  st = { ...ctx, rels: null, erro: "", incluirFalhas: true, rodando: null, parar: false, resultados: new Map(), fim: "" };
  ov.querySelector("#clKick").textContent = `${ctx.host.project.name} · Revistoria · Cliente`;
  ov.classList.add("open"); document.body.classList.add("rv-aberto");
  pintar();
  await carregar();
}
export function fechar() {
  const ov = document.getElementById("rvConvOv"); if (!ov?.classList.contains("open")) return;
  if (st?.rodando && !confirm("A conversão está em andamento. Parar depois dos relatórios que já começaram e fechar?")) return;
  if (st?.rodando) st.parar = true;
  ov.classList.remove("open"); document.body.classList.remove("rv-aberto");
  try { st?.aoMudar?.(); } catch { /* lista fechada */ }
  st = null;
}
async function carregar() {
  const me = st;
  try { const rels = await S.relatoriosConversao(st.host.sb, st.host.project.id); if (st === me) { st.rels = rels; st.erro = ""; pintar(); } }
  catch (err) { if (st === me) { st.erro = S.naoInstalado(err) ? "A conversão ainda não foi instalada no banco." : err.message || "Não foi possível carregar."; pintar(); } }
}

const rotuloUnidade = (r) => {
  const u = st.unidades().find((x) => x.unitId === r.unit_id);
  return u ? (st.host.casa() ? `Conj. ${u.b} · Casa ${+u.a}` : `Bloco ${u.b} · ${u.codigo}`) : `Unidade ${r.unit_id}`;
};
function grupos() {
  const rels = st.rels || [];
  const conv = rels.filter((r) => r.conversao_status === "disponivel" || r.convertido_id);
  const andamento = rels.filter((r) => C.emAndamento(r.conversao_status));
  const falhas = rels.filter((r) => r.conversao_status === "falha" && !r.convertido_id);
  const pendentes = rels.filter((r) => (r.conversao_status || "pendente") === "pendente" && !r.convertido_id);
  return { rels, conv, andamento, falhas, pendentes, fila: [...pendentes, ...(st.incluirFalhas ? falhas : [])] };
}
function pintar() {
  const b = document.getElementById("clBody"); if (!b || !st) return;
  if (st.erro) { b.innerHTML = `<div class="ch-state"><b>${esc(st.erro)}</b></div>`; return; }
  if (!st.rels) { b.innerHTML = `<div class="ch-state"><div class="ch-spin" aria-hidden="true"></div><b>Carregando os relatórios…</b></div>`; return; }
  const g = grupos(), r = st.rodando;
  const cartao = (n, rot, cls = "") => `<div class="cl-k ${cls}"><b>${n}</b><span>${esc(rot)}</span></div>`;
  const resultados = [...st.resultados.values()];
  const erros = resultados.filter((x) => x.status === "falha");
  const pct = r ? Math.round((r.feitos / Math.max(1, r.total)) * 100) : 0;
  b.innerHTML = `
    <p class="cl-intro">Gera a versão compacta dos relatórios do Mobuss já enviados. O PDF original não é alterado; o convertido passa a abrir por padrão no relatório da unidade. Os que não estiverem no padrão do Mobuss ficam com a falha registrada e o original continua disponível.</p>
    <div class="cl-ks">${cartao(g.rels.length, "relatórios ativos")}${cartao(g.conv.length, "já convertidos", "ok")}${cartao(g.pendentes.length, "pendentes", g.pendentes.length ? "pend" : "")}${cartao(g.falhas.length, "com falha", g.falhas.length ? "err" : "")}${g.andamento.length ? cartao(g.andamento.length, "em andamento", "run") : ""}</div>
    ${r ? `<div class="lt-prog" role="status"><div><i style="width:${pct}%"></i></div><span>${r.feitos} de ${r.total} · ${r.ok} convertido(s)${r.falhas ? ` · ${r.falhas} com falha` : ""}${st.parar ? " · parando…" : ""}</span></div>` : ""}
    ${st.fim ? `<div class="cl-fim" role="status">${esc(st.fim)}</div>` : ""}
    <div class="cl-acoes">
      ${g.falhas.length && !r ? `<label class="cl-chk"><input type="checkbox" data-cl="falhas"${st.incluirFalhas ? " checked" : ""}> Tentar de novo os ${g.falhas.length} com falha</label>` : ""}
      ${r ? `<button type="button" class="btn g" data-cl="parar"${st.parar ? " disabled" : ""}>Parar</button>`
        : `<button type="button" class="btn p" data-cl="iniciar"${g.fila.length ? "" : " disabled"}>${g.fila.length ? `Converter ${g.fila.length} relatório(s)` : "Nada pendente"}</button>`}
    </div>
    ${r ? `<p class="cl-nota">Mantenha esta janela aberta até terminar (três por vez). Se fechar, os que já começaram terminam no servidor e o restante continua pendente.</p>` : ""}
    ${erros.length ? `<details class="cl-err" open><summary>${erros.length} relatório(s) não convertido(s)</summary><ul>${erros.map((x) => `<li><b>${esc(x.unidade)}</b> <span>${esc(x.nome)}</span><em>${esc(x.erro || "Falha na conversão")}</em></li>`).join("")}</ul></details>` : ""}`;
}

/** Converte um relatório e espera até ficar Disponível ou Falha. */
async function converterUm(rel, me) {
  const sb = st.host.sb;
  let resp;
  try { resp = await S.converterRelatorio(sb, rel.id, false); }
  catch (err) { return { status: "falha", erro: err.message }; }
  if (resp?.ja_convertido) return { status: "disponivel" };
  const ini = Date.now();
  while (Date.now() - ini < ESPERA_MAX) {
    await dormir(1500);
    if (st !== me) return { status: "interrompido" };
    try {
      const s = await S.situacaoConversao(sb, rel.id);
      if (s.conversao_status === "disponivel") return { status: "disponivel" };
      if (s.conversao_status === "falha") return { status: "falha", erro: s.conversao_erro };
    } catch { /* tenta de novo na próxima volta */ }
  }
  return { status: "falha", erro: "A conversão demorou mais que o esperado. Tente de novo mais tarde." };
}
async function iniciar() {
  const g = grupos(); if (!g.fila.length || st.rodando) return;
  if (!confirm(`Converter ${g.fila.length} relatório(s) do Mobuss para o modelo compacto? O original de cada um continua guardado.`)) return;
  const me = st, fila = [...g.fila];
  st.fim = ""; st.parar = false; st.resultados = new Map();
  st.rodando = { total: fila.length, feitos: 0, ok: 0, falhas: 0 };
  pintar();
  const trabalhador = async () => {
    while (fila.length && st === me && !st.parar) {
      const rel = fila.shift();
      const r = await converterUm(rel, me);
      if (st !== me) return;
      st.rodando.feitos++;
      if (r.status === "disponivel") st.rodando.ok++; else if (r.status === "falha") st.rodando.falhas++;
      st.resultados.set(rel.id, { ...r, unidade: rotuloUnidade(rel), nome: rel.nome_arquivo || "PDF" });
      pintar();
    }
  };
  await Promise.all(Array.from({ length: SIMULTANEAS }, trabalhador));
  if (st !== me) return;
  const r = st.rodando, parado = st.parar && r.feitos < r.total;
  st.fim = `${r.ok} relatório(s) convertido(s)${r.falhas ? ` · ${r.falhas} não convertido(s) (motivos abaixo)` : ""}${parado ? ` · interrompido: ${r.total - r.feitos} continuam pendentes` : ""}.`;
  st.rodando = null; st.parar = false;
  st.host.toast?.(st.fim);
  try { st.aoMudar?.(); } catch { /* lista fechada */ }
  await carregar();
}
function clique(e) {
  const t = e.target.closest("[data-cl]"); if (!t || !st) return;
  const a = t.dataset.cl;
  if (a === "fechar") return fechar();
  if (a === "iniciar") return iniciar();
  if (a === "parar") { st.parar = true; pintar(); }
}
