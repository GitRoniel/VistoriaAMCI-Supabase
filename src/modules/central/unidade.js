// Central de Unidades: a trajetória completa de um apartamento num só lugar (camada de visualização; não cria
// nem copia cadastros). Dados de public.central_unidade (uma chamada, só os registros da unidade).
import * as M from "./model.js";
import * as S from "./service.js";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
let st = null;   // { host, unitId, d, aba, sub, erro }

const chave = (host) => `amci.central.${host?.usuarioId?.() || "anon"}.recentes`;
export function recentes(host) { try { return JSON.parse(localStorage.getItem(chave(host)) || "[]"); } catch { return []; } }
function lembrar(host, u) {
  try { const l = recentes(host).filter((x) => x.unit_id !== u.unit_id); l.unshift(u); localStorage.setItem(chave(host), JSON.stringify(l.slice(0, 8))); } catch { /* sem armazenamento */ }
}

function el() {
  let ov = document.getElementById("ctUnOv");
  if (!ov) {
    ov = document.createElement("div"); ov.id = "ctUnOv"; ov.className = "ct-ov"; ov.setAttribute("role", "dialog"); ov.setAttribute("aria-modal", "true"); ov.setAttribute("aria-labelledby", "ctUnTit");
    ov.innerHTML = `<div class="ct-dr"><header class="ct-dr-h"><div class="ct-dr-t"><small id="ctUnKick"></small><strong id="ctUnTit">Unidade</strong><em id="ctUnCli"></em></div><button type="button" class="pp-icon" data-un="fechar" aria-label="Fechar">×</button></header><div class="ct-dr-b" id="ctUnBody"></div></div>`;
    document.body.appendChild(ov);
    ov.addEventListener("click", (e) => { if (e.target === ov) fecharUnidade(); else clique(e); });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && ov.classList.contains("open")) fecharUnidade(); });
  }
  return ov;
}
export async function abrirUnidade(host, unitId) {
  if (!host || !unitId) return;
  const ov = el();
  st = { host, unitId: Number(unitId), d: null, aba: "tempo", sub: "abertas", erro: "" };
  ov.querySelector("#ctUnKick").textContent = "Central de Unidades";
  ov.querySelector("#ctUnTit").textContent = "Carregando…"; ov.querySelector("#ctUnCli").textContent = "";
  ov.classList.add("open"); document.body.classList.add("ct-un-aberto");
  pintar();
  const me = st;
  try {
    const d = await S.unidade(host.sb, unitId);
    if (st !== me) return;
    if (!d) { st.erro = "Unidade não encontrada ou sem acesso a este condomínio."; pintar(); return; }
    st.d = d;
    const u = d.unidade;
    lembrar(host, { unit_id: u.id, project_id: u.project_id, bloco: u.bloco, pav: u.pav, apto: u.apto, kind: u.kind, unidade_tipo: u.kind, codigo: u.codigo,
      cliente: d.vistoria?.client_name || "", status_vistoria: d.vistoria?.status || "", status_revistoria: d.revistoria?.status || "" });
  } catch (err) { if (st !== me) return; st.erro = S.naoInstalado(err) ? "A Central Operacional ainda não foi instalada no banco." : err.message || "Não foi possível carregar a unidade."; }
  pintar();
  ov.querySelector(".ct-dr").focus?.();
}
export function fecharUnidade() {
  const ov = document.getElementById("ctUnOv"); if (!ov?.classList.contains("open")) return;
  ov.classList.remove("open"); document.body.classList.remove("ct-un-aberto"); st = null;
}

const casa = (u) => u?.kind === "casa";
const nomeUn = (u) => (casa(u) ? `Casa ${u.codigo}` : `Apto ${u.codigo}`);
const localUn = (u) => (casa(u) ? `Conjunto ${u.bloco}` : `Bloco ${u.bloco}${u.pav ? ` · ${String(u.pav).toUpperCase() === "T" ? "Térreo" : u.pav + " pav."}` : ""}`);
function pill(host, statusVistoria) { const s = host.vistoriaInfo(statusVistoria || "Não agendado"); return `<span class="ct-st" style="background:${s.bg};color:${s.tx};border-color:${s.bd}">${esc(s.label)}</span>`; }
const revPill = (s) => `<span class="ct-st rv s-${esc(String(s || "").toLowerCase().replace(/\s+/g, "-"))}">${esc(s || "—")}</span>`;

function pintar() {
  const ov = document.getElementById("ctUnOv"), b = ov?.querySelector("#ctUnBody"); if (!b || !st) return;
  if (st.erro) { ov.querySelector("#ctUnTit").textContent = "Unidade"; b.innerHTML = `<div class="ct-vazio err"><b>${esc(st.erro)}</b></div>`; return; }
  if (!st.d) { b.innerHTML = `<div class="ct-skel" aria-hidden="true">${"<i></i>".repeat(9)}</div><span class="ct-sr" role="status">Carregando a unidade…</span>`; return; }
  const { host, d } = st, u = d.unidade, v = d.vistoria || {}, rc = d.revistoria, hoje = host.hoje();
  ov.querySelector("#ctUnKick").textContent = `${u.projeto} · ${localUn(u)}`;
  ov.querySelector("#ctUnTit").textContent = nomeUn(u) + (u.pcd ? " · PCD" : "");
  ov.querySelector("#ctUnCli").textContent = v.client_name || "";
  const tl = M.linhaDoTempo(d), pd = M.pendencias(d), ag = M.agendamentosUnidade(d, hoje), geral = M.situacaoGeral(v, rc), ult = M.ultimaAtividade(d, tl);
  const prox = ag.futuros[0];
  const relAtivos = (d.relatorios || []).filter((r) => !r.removido_em);
  const abas = [["tempo", `Linha do tempo <small>${tl.length}</small>`], ["pend", `Pendências <small>${pd.abertas.length} abertas</small>`],
    ["agenda", `Agendamentos <small>${ag.futuros.length + ag.realizados.length + ag.cancelados.length}</small>`], ["docs", `Relatórios <small>${relAtivos.length}</small>`]];
  b.innerHTML = `
    <div class="ct-u-st"><span class="ct-geral" style="--c:${geral.cor}">${esc(geral.label)}</span>
      <span class="ct-u-l">Vistoria ${pill(host, v.status)}</span>
      <span class="ct-u-l">Revistoria ${rc ? `${revPill(rc.status)}<small>${rc.ciclo}º ciclo</small>` : '<b class="ct-mut">sem registro</b>'}</span></div>
    <div class="ct-u-info">
      <div><span>Última atividade</span><b>${ult ? esc(M.fmtDH(ult.quando)) : "—"}</b><small>${ult ? esc([ult.titulo, ult.por].filter(Boolean).join(" · ")) : ""}</small></div>
      <div><span>Vistoria</span><b>${v.inspection_date ? esc([M.fmtD(v.inspection_date), v.inspection_time].filter(Boolean).join(" · ")) : "—"}</b><small>${esc(v.responsible || "sem responsável")}</small></div>
      <div><span>Próxima atividade</span><b>${prox ? esc([M.fmtD(prox.data), prox.horario].filter(Boolean).join(" · ")) : "—"}</b><small>${prox ? esc(`${M.TIPOS[prox.tipo].label}${prox.numero ? ` nº ${prox.numero}` : ""}${prox.responsavel ? " · " + prox.responsavel : ""}`) : "nada agendado"}</small></div>
      <div class="ct-u-pd"><span>Pendências</span><b>${pd.total ? `${pd.resolvidas.length}/${pd.total} resolvidas` : "—"}</b><small>${pd.total ? `${pd.abertas.length} em aberto · ${M.fmtPct(pd.pct)}${pd.reincidentes ? ` · ${pd.reincidentes} reincidente(s)` : ""}` : "sem relatório com apontamentos"}</small>${pd.total ? `<i class="ct-bar" style="--p:${pd.pct}%"></i>` : ""}</div>
    </div>
    <div class="ct-u-acts">
      <button type="button" class="btn g ch-mini" data-un="vistoria">Abrir na Vistoria</button>
      <button type="button" class="btn g ch-mini" data-un="revistoria"${rc ? "" : " disabled title=\"A unidade não está na Revistoria · Cliente\""}>Abrir na Revistoria</button>
      ${relAtivos.length ? `<button type="button" class="btn g ch-mini" data-un-pdf="${relAtivos.at(-1).id}">Relatório (PDF)</button>` : ""}
    </div>
    <div class="modetog ct-seg ct-u-tabs" role="tablist">${abas.map(([k, l]) => `<button type="button" role="tab" data-un-aba="${k}" class="${st.aba === k ? "active" : ""}" aria-selected="${st.aba === k}">${l}</button>`).join("")}</div>
    <div class="ct-u-cont">${st.aba === "tempo" ? htmlTempo(tl) : st.aba === "pend" ? htmlPend(pd) : st.aba === "agenda" ? htmlAgenda(ag, d) : htmlDocs(d)}</div>`;
}
const TAG = { vistoria: ["V", "Vistoria"], revistoria: ["R", "Revistoria"], relatorio: ["Rel", "Relatório"], pendencia: ["P", "Pendências"] };
function htmlTempo(tl) {
  if (!tl.length) return `<div class="ct-vazio"><b>Nenhum acontecimento registrado ainda.</b><span>O histórico da vistoria começa a ser guardado a partir das alterações feitas no sistema.</span></div>`;
  return `<ol class="ct-tl">${tl.slice().reverse().map((e) => `<li class="tl-${e.tipo}"><i>${TAG[e.tipo]?.[0] || "•"}</i><div>
      <div class="ct-tl1"><b>${esc(e.titulo)}</b><time>${esc(M.fmtDH(e.quando))}</time></div>
      ${e.texto ? `<div class="ct-tl2">${esc(e.texto)}</div>` : ""}
      <div class="ct-tl3">${esc(TAG[e.tipo]?.[1] || e.tipo)}${e.ciclo ? ` · ${e.ciclo}º ciclo` : ""}${e.por ? ` · ${esc(e.por)}` : ""}${e.relatorio_id ? ` · <button type="button" class="ct-lnk" data-un-pdf="${e.relatorio_id}">abrir PDF</button>` : ""}</div></div></li>`).join("")}</ol>
    <p class="ct-nota">Mais recente primeiro. Nada é sobrescrito: cada alteração da vistoria, cada agendamento, resultado e relatório é um registro próprio.</p>`;
}
function htmlPend(pd) {
  const grupos = [["abertas", `Em aberto (${pd.abertas.length})`], ["resolvidas", `Resolvidas (${pd.resolvidas.length})`], ["historico", `Histórico (${pd.historico.length})`]];
  const lista = pd[st.sub] || [];
  const item = (a) => `<li class="${a.concluido ? "ok" : ""}"><div class="ct-p1"><span>${esc(a.texto)}</span>${a.reincidencia > 1 ? `<em class="ct-reinc" title="O mesmo item aparece em ${a.reincidencia} relatórios">reincidente · ${a.reincidencia}×</em>` : ""}</div>
    <div class="ct-p2">Identificada em ${esc(M.fmtD(a.identificado_em) || "—")}${a.identificado_por ? ` · ${esc(a.identificado_por)}` : ""} · ${esc(a.relatorio?.nome_arquivo || "relatório")}${a.relatorio?.id && !a.relatorio.removido_em ? ` · <button type="button" class="ct-lnk" data-un-pdf="${a.relatorio.id}">ver no PDF</button>` : ""}</div>
    ${a.concluido ? `<div class="ct-p2 ok">Resolvida em ${esc(M.fmtDH(a.concluido_em))}${a.concluido_email ? ` · ${esc(a.concluido_email)}` : ""}</div>` : ""}
    ${a.motivo ? `<div class="ct-p2">${esc(a.motivo)}</div>` : ""}</li>`;
  return `<div class="modetog ct-seg ct-u-sub">${grupos.map(([k, l]) => `<button type="button" data-un-sub="${k}" class="${st.sub === k ? "active" : ""}">${l}</button>`).join("")}</div>
    ${lista.length ? `<ul class="ct-pl">${lista.map(item).join("")}</ul>` : `<div class="ct-vazio"><b>${st.sub === "abertas" ? "Nenhuma pendência em aberto." : st.sub === "resolvidas" ? "Nenhuma pendência resolvida ainda." : "Sem histórico."}</b></div>`}
    <p class="ct-nota">Pendências = apontamentos do checklist dos relatórios (fotos e evidências estão no PDF original). Itens repetidos em relatórios diferentes contam uma vez (vale o mais recente) e aparecem como reincidentes; as cópias antigas ficam no Histórico. Não há regra de pendência que impeça a aprovação definida no sistema. Para marcar como resolvida, use o Relatório na aba Revistoria · Cliente.</p>`;
}
function htmlAgenda(ag, d) {
  const linha = (a) => `<li class="s-${a.situacao}"><span class="ct-tp t-${a.tipo}"><i>${M.TIPOS[a.tipo].sigla}</i>${M.TIPOS[a.tipo].label}${a.numero ? ` <small>nº ${a.numero}</small>` : ""}</span>
    <b>${esc([M.fmtD(a.data), a.horario].filter(Boolean).join(" · ") || "sem data")}</b><span>${esc(a.responsavel || "—")}</span>
    ${a.tipo === "vistoria" ? pill(st.host, a.status) : revPill(a.status)}${a.situacao === "atrasada" ? `<em class="ct-sit" style="--c:${M.SITUACOES.atrasada.cor}">Atrasada</em>` : ""}
    ${a.realizada_em ? `<small>realizada em ${esc(M.fmtD(a.realizada_em))}</small>` : ""}${a.obs ? `<small>${esc(a.obs)}</small>` : ""}</li>`;
  const bloco = (t, l) => `<h4>${t} <small>${l.length}</small></h4>${l.length ? `<ul class="ct-al">${l.map(linha).join("")}</ul>` : `<p class="ct-nota">Nenhum.</p>`}`;
  const reag = d.reagendamentos || [];
  return bloco("Futuros e em andamento", ag.futuros) + bloco("Realizados", ag.realizados) + bloco("Cancelados", ag.cancelados) +
    `<h4>Reagendamentos da vistoria <small>${reag.length}</small></h4>${reag.length ? `<ul class="ct-al">${reag.map((g) => `<li><b>${esc(M.fmtD(g.data_anterior))} → ${esc(M.fmtD(g.data_nova))}</b><span>${esc(g.registrado_email || "")}</span><small>${esc(M.fmtDH(g.registrado_em))}${g.observacao ? " · " + esc(g.observacao) : ""}</small></li>`).join("")}</ul>` : `<p class="ct-nota">Nenhum reagendamento pelo popup. Mudanças de data também aparecem na linha do tempo.</p>`}`;
}
function htmlDocs(d) {
  const rs = (d.relatorios || []).slice().reverse();
  if (!rs.length) return `<div class="ct-vazio"><b>Nenhum relatório enviado para esta unidade.</b><span>Os PDFs são enviados na aba Revistoria · Cliente (botão Relatório ou Relatórios em lote).</span></div>`;
  return `<ul class="ct-docs">${rs.map((r) => {
    const n = (d.apontamentos || []).filter((a) => a.relatorio_id === r.id).length;
    return `<li class="${r.removido_em ? "rem" : ""}"><div><b>${esc(r.nome_arquivo || "PDF")}</b><small>enviado ${esc(M.fmtDH(r.enviado_em))}${r.enviado_email ? ` · ${esc(r.enviado_email)}` : ""} · ${n} apontamento(s)${r.paginas ? ` · ${r.paginas} pág.` : ""}${r.resumo?.realizado ? ` · realizado ${esc(M.fmtD(r.resumo.realizado))}` : ""}${r.resumo?.responsavel ? ` · ${esc(r.resumo.responsavel)}` : ""}</small>
      ${r.removido_em ? `<small>retirado em ${esc(M.fmtDH(r.removido_em))}${r.removido_email ? ` · ${esc(r.removido_email)}` : ""}</small>` : ""}</div>
      ${r.removido_em ? "" : `<span><button type="button" class="btn g ch-mini" data-un-pdf="${r.id}">Abrir</button><button type="button" class="btn g ch-mini" data-un-pdf="${r.id}" data-baixar="1">Baixar</button></span>`}</li>`;
  }).join("")}</ul><p class="ct-nota">Os PDFs ficam em pasta privada e abrem por link temporário (10 minutos), só para quem tem acesso ao condomínio.</p>`;
}
async function clique(e) {
  if (!st) return;
  const t = e.target;
  if (t.closest('[data-un="fechar"]')) { fecharUnidade(); return; }
  const ab = t.closest("[data-un-aba]"); if (ab) { st.aba = ab.dataset.unAba; pintar(); return; }
  const sb = t.closest("[data-un-sub]"); if (sb) { st.sub = sb.dataset.unSub; pintar(); return; }
  const pdf = t.closest("[data-un-pdf]");
  if (pdf) {
    const r = (st.d?.relatorios || []).find((x) => String(x.id) === pdf.dataset.unPdf); if (!r) return;
    const baixar = !!pdf.dataset.baixar, w = baixar ? null : window.open("", "_blank");
    try {
      const url = await S.urlRelatorio(st.host.sb, r.caminho, baixar ? r.nome_arquivo || "relatorio.pdf" : "");
      if (w) w.location.href = url; else { const a = document.createElement("a"); a.href = url; a.rel = "noopener"; document.body.appendChild(a); a.click(); a.remove(); }
    } catch (err) { w?.close(); st.host.toast?.(err.message || "Não foi possível abrir o PDF"); }
    return;
  }
  const go = t.closest('[data-un="vistoria"],[data-un="revistoria"]');
  if (go && st.d) {
    const u = st.d.unidade, host = st.host, alvo = go.dataset.un;
    fecharUnidade();
    if (alvo === "vistoria") host.abrirNaVistoria?.(u); else host.abrirNaRevistoria?.(u);
  }
}
