// Visão de Produtividade (Central Operacional): indicadores, evolução, vistoriadores, condomínios e atenção.
// Tudo calculado no banco (public.central_produtividade, consultas agregadas). Separa unidades únicas
// (situação atual) de atividades (no período) e produtividade (quantidade) de qualidade (aprovação/pendências).
import * as M from "./model.js";
import * as S from "./service.js";
import { barras, proporcao } from "./graficos.js";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const PARAMS0 = { diasEspera: 15, diasSemAtualizacao: 30, diasPendencia: 30, minPendencias: 10 };
let st = { carregando: false, dados: null, erro: "", chave: "", pedido: 0 };
let ctxAtual = null, body = null;

const cfg = () => {
  const p = ctxAtual.prefs.prod || {};
  return { periodo: p.periodo || "30d", de: p.de || "", ate: p.ate || "", grao: p.grao || "auto", params: { ...PARAMS0, ...(p.params || {}) } };
};
const salvarCfg = (n) => { ctxAtual.prefs.prod = { ...cfg(), ...n }; ctxAtual.salvar(); };
function intervalo() {
  const c = cfg(), hoje = ctxAtual.host.hoje();
  if (c.periodo === "custom" && c.de && c.ate && c.de <= c.ate) return { de: c.de, ate: c.ate };
  return M.periodo(c.periodo === "custom" ? "30d" : c.periodo, hoje, "2026-01-01");
}

export function pintarProdutividade(el, ctx) {
  ctxAtual = ctx; body = el;
  const c = cfg(), iv = intervalo(), grao = c.grao === "auto" ? M.graoSugerido(iv.de, iv.ate) : c.grao;
  const chave = JSON.stringify([iv, grao, c.params, ctx.projetos]);
  if (!el.querySelector(".pv")) {
    el.innerHTML = `<div class="pv"><div class="pv-bar" id="pvBar"></div><div id="pvConteudo"></div></div>`;
    el.querySelector(".pv").addEventListener("click", clique);
    el.querySelector(".pv").addEventListener("change", mudou);
  }
  pintarBarra(c, iv, grao);
  if (chave !== st.chave || ctx.recarregar) { st.chave = chave; carregar(iv, grao, c.params); }
  else pintarConteudo(grao);
}
async function carregar(iv, grao, params) {
  const meu = ++st.pedido, ctx = ctxAtual;
  st.carregando = true; st.erro = ""; pintarConteudo(grao);
  try {
    const d = await S.produtividade(ctx.host.sb, { ...iv, grao, projetos: ctx.projetos, ...params });
    if (meu !== st.pedido) return;
    st.dados = d;
  } catch (err) {
    if (meu !== st.pedido) return;
    if (S.naoInstalado(err)) { ctx.naoInstalado(); return; }
    st.erro = err.message || "Não foi possível calcular os indicadores.";
  }
  st.carregando = false; pintarConteudo(grao);
}
function pintarBarra(c, iv, grao) {
  const bar = body.querySelector("#pvBar");
  bar.innerHTML = `<div class="modetog ct-seg pv-per" role="tablist" aria-label="Período">${M.PERIODOS.map((p) => `<button type="button" data-pv-per="${p.key}" class="${c.periodo === p.key ? "active" : ""}">${esc(p.label)}</button>`).join("")}</div>
    <div class="pv-datas"${c.periodo === "custom" ? "" : " hidden"}><label class="fx-field"><span>De</span><input type="date" data-pv-de value="${esc(c.de || iv.de)}"></label><label class="fx-field"><span>Até</span><input type="date" data-pv-ate value="${esc(c.ate || iv.ate)}"></label></div>
    <div class="modetog ct-seg pv-grao" role="tablist" aria-label="Agrupar o gráfico por">${[["auto", "Auto"], ["dia", "Dia"], ["semana", "Semana"], ["mes", "Mês"]].map(([k, l]) => `<button type="button" data-pv-grao="${k}" class="${c.grao === k ? "active" : ""}">${l}</button>`).join("")}</div>
    <span class="pv-iv">${M.fmtD(iv.de)} a ${M.fmtD(iv.ate)} · por ${grao === "mes" ? "mês" : grao}</span>`;
}
const tile = (v, rot, sub = "", cls = "", acao = "") => `<div class="pv-k${cls}"${acao}><b>${v}</b><span>${esc(rot)}</span>${sub ? `<small>${sub}</small>` : ""}</div>`;
const delta = (a, b) => { const v = M.variacao(a, b); return v ? `<em class="pv-d ${v.dir}" title="Comparado ao período anterior de mesmo tamanho">${esc(v.txt)}</em>` : ""; };
/** Ranking de produção por pessoa: barra empilhada (vistorias + revistorias) na mesma escala para comparar. */
function ranking(ps) {
  const max = Math.max(1, ...ps.map((x) => x.vistorias + x.revistorias));
  return `<ol class="pv-rank">${ps.map((x) => {
    const tot = x.vistorias + x.revistorias, ant = x.ant_vistorias + x.ant_revistorias;
    const wv = (x.vistorias / max) * 100, wr = (x.revistorias / max) * 100;
    return `<li><span class="pv-rk-n" title="${esc(x.nome)}">${esc(x.nome)}</span>
      <span class="pv-rk-bar" role="img" aria-label="${esc(x.nome)}: ${x.vistorias} vistoria(s) e ${x.revistorias} revistoria(s)">${x.vistorias ? `<i class="v" style="width:${wv}%" data-tip="${esc(`${x.nome} · Vistorias: ${x.vistorias}`)}" tabindex="0"></i>` : ""}${x.revistorias ? `<i class="r" style="width:${wr}%" data-tip="${esc(`${x.nome} · Revistorias: ${x.revistorias}`)}" tabindex="0"></i>` : ""}</span>
      <b class="pv-rk-t">${tot}${tot || ant ? delta(tot, ant) : ""}</b>
      <span class="pv-rk-a" title="Aprovação na 1ª vistoria (aprovadas ÷ vistoriadas)">${x.vistorias ? M.fmtPct(M.pct(x.aprovadas, x.vistorias)) : "—"}</span></li>`;
  }).join("")}</ol>`;
}
function pintarConteudo(grao) {
  const el = body?.querySelector("#pvConteudo"); if (!el) return;
  if (st.carregando && !st.dados) { el.innerHTML = `<div class="ct-skel" aria-hidden="true">${"<i></i>".repeat(8)}</div><span class="ct-sr" role="status">Calculando os indicadores…</span>`; return; }
  if (st.erro && !st.dados) { el.innerHTML = `<div class="ct-vazio err"><b>${esc(st.erro)}</b></div>`; return; }
  const d = st.dados; if (!d) return;
  const g = d.geral, p = d.no_periodo, host = ctxAtual.host;
  const aprovTot = g.aprovadas_1a + g.rev_finalizadas, abertas = g.pend_total - g.pend_resolvidas;
  const prod = p.vist_realizadas + p.rev_realizadas, prodAnt = p.ant_vist_realizadas + p.ant_rev_realizadas;
  const atras = p.vist_atrasadas + p.rev_atrasadas;
  const nomeP = (id) => host.projetos().find((x) => String(x.id) === String(id))?.nome || `Condomínio ${id}`;
  let h = st.carregando ? `<div class="pv-carr" role="status"><span class="ct-spin"></span>Atualizando…</div>` : "";
  // 1. Destaques do período: produção total e o que a compõe, aprovação e pendências resolvidas
  h += `<section class="pv-sec pv-dest"><h3>Produção no período</h3><div class="pv-hero">
    ${tile(`${prod}${delta(prod, prodAnt)}`, "Produção total", `vistorias e revistorias realizadas`, " hero")}
    ${tile(`${p.vist_realizadas}${delta(p.vist_realizadas, p.ant_vist_realizadas)}`, "Vistorias realizadas", `${p.vist_aprovadas} aprovada(s)`, " v")}
    ${tile(`${p.rev_realizadas}${delta(p.rev_realizadas, p.ant_rev_realizadas)}`, "Revistorias realizadas", `${p.rev_unidades} unidade(s) · ${p.rev_aprovadas} aprovada(s)`, " r")}
    ${tile(M.fmtPct(M.pct(p.vist_aprovadas, p.vist_realizadas)), "Aprovação na 1ª vistoria", "das vistorias realizadas no período", " ok")}
    ${tile(`${p.pend_resolvidas}${delta(p.pend_resolvidas, p.ant_pend_resolvidas)}`, "Pendências resolvidas", `${p.pend_identificadas} identificada(s) no período`, " c")}
  </div>
  <p class="pv-linha">${[`<b>${p.vist_agendadas + p.rev_agendadas}</b> atividade(s) agendada(s) (${p.vist_agendadas} vistorias · ${p.rev_agendadas} revistorias)`,
    `<b class="${atras ? "bad" : ""}">${atras}</b> atrasada(s) ou não realizada(s)`, `${p.rev_reprovadas} revistoria(s) reprovada(s)`].join(" · ")}<span> · comparação com os ${d.periodo.dias} dia(s) anteriores</span></p></section>`;
  // 2. Produção por vistoriador (comparação direta) e a tabela completa como consulta complementar
  const ps = d.vistoriadores || [];
  h += `<section class="pv-sec"><h3>Produção por vistoriador <small>· no período</small></h3>${ps.length ? `
    <div class="pv-rk-h"><span>Responsável</span><span class="pv-rk-leg"><i class="v"></i>Vistorias <i class="r"></i>Revistorias</span><span>Total</span><span title="Aprovação na 1ª vistoria">% aprov.</span></div>
    ${ranking(ps)}
    <details class="pv-mais"><summary>Ver tabela completa por vistoriador</summary><div class="pv-tw"><table class="pv-tbl pv-pes"><thead><tr>
      <th class="l" rowspan="2">Responsável</th><th colspan="5" class="g">1ª vistoria · produtividade e qualidade</th><th colspan="2" class="g">Pendências identificadas</th><th colspan="3" class="g">Revistorias</th></tr>
      <tr><th>Realizadas</th><th title="Comparado ao período anterior">Variação</th><th>Aprovadas</th><th>Com pendências</th><th>% aprov.</th><th>Total</th><th title="Média por unidade vistoriada com relatório">Por unidade</th><th>Realizadas</th><th>Aprovadas</th><th title="Comparado ao período anterior">Variação</th></tr></thead><tbody>
      ${ps.map((x) => `<tr><td class="l"><b>${esc(x.nome)}</b></td><td>${x.vistorias || "—"}</td><td>${x.vistorias || x.ant_vistorias ? delta(x.vistorias, x.ant_vistorias) || "=" : "—"}</td><td>${x.vistorias ? x.aprovadas : "—"}</td><td>${x.vistorias ? x.reprovadas : "—"}</td>
        <td>${M.fmtPct(M.pct(x.aprovadas, x.vistorias))}</td><td>${x.pendencias || "—"}</td><td>${x.unidades_com_pend ? (x.pendencias / x.unidades_com_pend).toFixed(1).replace(".", ",") : "—"}</td>
        <td>${x.revistorias || "—"}</td><td>${x.revistorias ? x.rev_aprovadas : "—"}</td><td>${x.revistorias || x.ant_revistorias ? delta(x.revistorias, x.ant_revistorias) || "=" : "—"}</td></tr>`).join("")}
      </tbody></table></div>
      <p class="pv-nota"><b>Como ler:</b> <i>Realizadas</i> mede produtividade; <i>% aprov.</i> mede o resultado da 1ª vistoria (aprovada × com pendências) e não a qualidade do trabalho de quem vistoriou. Pendências são as dos relatórios das unidades vistoriadas pela pessoa. A resolução das pendências é da obra e não é atribuída ao vistoriador. Nomes iguais com maiúsculas ou espaços diferentes contam como a mesma pessoa.</p></details>`
    : `<div class="ct-vazio"><b>Nenhuma vistoria ou revistoria com responsável no período.</b></div>`}</section>`;
  // 3. Produtividade por período: gráfico principal grande; aprovações e pendências ao lado, menores
  h += `<section class="pv-sec"><h3>Produtividade por período <small>· ${grao === "mes" ? "por mês" : grao === "semana" ? "por semana" : "por dia"}</small></h3>
    ${barras({ id: "pvG1", titulo: "Vistorias e revistorias realizadas", baldes: d.serie, series: ["vistorias", "revistorias"], grao, classe: "cg-grande" })}
    <div class="pv-graf">
    ${barras({ id: "pvG2", titulo: "Aprovações", baldes: d.serie, series: ["vist_aprovadas", "rev_aprovadas"], grao })}
    ${barras({ id: "pvG3", titulo: "Pendências identificadas e resolvidas", baldes: d.serie, series: ["pend_identificadas", "pend_resolvidas"], grao })}
  </div></section>`;
  // 4. Situação atual (unidades únicas: cada apartamento conta uma vez)
  h += `<section class="pv-sec"><h3>Situação atual <small>· unidades únicas</small></h3><div class="pv-ks">
    ${tile(g.vistoriadas, "Unidades vistoriadas", `de ${g.unidades} · ${M.fmtPct(M.pct(g.vistoriadas, g.unidades))}`)}
    ${tile(aprovTot, "Unidades aprovadas", `${g.aprovadas_1a} na 1ª vistoria · ${g.rev_finalizadas} após revistoria`, " ok")}
    ${tile(M.fmtPct(M.pct(g.aprovadas_1a, g.vistoriadas)), "Aprovação na 1ª vistoria", "aprovadas ÷ vistoriadas", " ok")}
    ${tile(g.em_revistoria, "Em revistoria", `${g.rc_agendado} agendada(s) · ${g.rc_em_andamento} aguardando`, " warn")}
    ${tile(g.aguardando_vistoria, "Aguardando a 1ª vistoria", `${g.nao_agendadas} sem agendamento`)}
    ${tile(`${g.pend_resolvidas}/${g.pend_total}`, "Pendências resolvidas", `${M.fmtPct(M.pct(g.pend_resolvidas, g.pend_total))} · ${abertas} em aberto em ${g.unidades_pend_abertas} unidade(s)${proporcao(g.pend_resolvidas, g.pend_total)}`, " ok")}
  </div></section>`;
  // 5. Por condomínio (consulta complementar; aberta quando há mais de um)
  const cs = d.condominios || [];
  if (cs.length) {
    h += `<details class="pv-sec pv-mais pv-cond"${cs.length > 1 ? " open" : ""}><summary><h3>Por condomínio <small>· clique para ver só um condomínio</small></h3></summary><div class="pv-tw"><table class="pv-tbl"><thead><tr>
      <th class="l">Condomínio</th><th>Unidades</th><th>Vistoriadas</th><th>Aprovadas</th><th>% aprov. 1ª</th><th>Em revistoria</th><th>Rev. finalizadas</th><th>Pendências</th><th>Resolvidas</th><th>% resolução</th><th title="No período">Vist. período</th><th title="No período">Rev. período</th></tr></thead><tbody>
      ${cs.map((x) => `<tr data-pv-proj="${x.project_id}" tabindex="0" title="Ver só este condomínio"><td class="l"><b>${esc(nomeP(x.project_id))}</b></td><td>${x.unidades}</td><td>${x.vistoriadas}</td><td>${x.aprovadas_1a + x.rev_finalizadas}</td><td>${M.fmtPct(M.pct(x.aprovadas_1a, x.vistoriadas))}</td><td>${x.em_revistoria}</td><td>${x.rev_finalizadas}</td><td>${x.pend_total}</td><td>${x.pend_resolvidas}</td><td>${M.fmtPct(M.pct(x.pend_resolvidas, x.pend_total))}</td><td>${x.vist_realizadas}</td><td>${x.rev_realizadas}</td></tr>`).join("")}
      </tbody></table></div></details>`;
  }
  // 6. Atenção (situação atual): cartões fechados com o total; abre para ver as unidades
  const a = d.atencao, par = cfg().params;
  const num = (k, v, min = 1, max = 365) => `<input type="number" min="${min}" max="${max}" value="${v}" data-pv-par="${k}" aria-label="Parâmetro">`;
  const card = (k, titulo, regra, unid, extra) => {
    const x = a[k] || { total: 0, itens: [] };
    return `<details class="pv-at${x.total ? " tem" : ""}"><summary><b>${x.total}</b><span>${titulo}</span><small>${regra}</small></summary>
      ${x.itens?.length ? `<ul>${x.itens.map((i) => `<li><button type="button" data-pv-unit="${i.unit_id}"><span>${esc(nomeP(i.project_id))} · ${i.kind === "casa" ? "Conj." : "Bloco"} ${esc(i.bloco)} · ${esc(i.codigo)}${i.cliente ? ` <small>${esc(i.cliente)}</small>` : ""}</span><em>${esc(unid(i))}</em></button></li>`).join("")}</ul>${x.total > x.itens.length ? `<p class="pv-nota">Mostrando ${x.itens.length} de ${x.total}.</p>` : ""}` : `<p class="pv-nota">Nada por aqui.</p>`}${extra || ""}</details>`;
  };
  h += `<section class="pv-sec"><h3>Atenção <small>· situação atual · toque para ver as unidades</small></h3>
    <div class="pv-ats">
    ${card("atrasadas", "Atividades atrasadas", "agendadas para antes de hoje e sem resultado", (i) => `${i.tipo === "revistoria" ? "Revistoria" : "Vistoria"} de ${M.fmtD(i.data)} · ${i.valor} dia(s)`)}
    ${card("aguardando_revistoria", "Aguardando agendamento da revistoria", `há ${par.diasEspera} dias ou mais`, (i) => `${i.valor} dia(s)`)}
    ${card("muitas_pendencias", "Unidades com muitas pendências abertas", `${par.minPendencias} ou mais em aberto`, (i) => `${i.valor} aberta(s) de ${i.extra}`)}
    ${card("reincidentes", "Reprovações recorrentes", "2 ou mais revistorias reprovadas", (i) => `${i.valor} reprovação(ões)`)}
    ${card("pendencias_antigas", "Pendências abertas há muito tempo", `identificadas há ${par.diasPendencia} dias ou mais`, (i) => `${i.extra} item(ns) · ${i.valor} dia(s)`, a.pendencias_antigas?.unidades != null ? `<p class="pv-nota">${a.pendencias_antigas.total} pendência(s) em ${a.pendencias_antigas.unidades} unidade(s).</p>` : "")}
    ${card("sem_atualizacao", "Unidades sem atualização recente", `nada registrado há ${par.diasSemAtualizacao} dias (fora as aprovadas)`, (i) => `${i.valor} dia(s) · ${i.extra}`)}
    </div>
    <details class="pv-mais"><summary>Ajustar os parâmetros da seção Atenção</summary><div class="pv-par"><span>Não alteram dados:</span>
      <label>aguardando revistoria ≥ ${num("diasEspera", par.diasEspera)} dias</label><label>muitas pendências ≥ ${num("minPendencias", par.minPendencias)}</label>
      <label>pendência antiga ≥ ${num("diasPendencia", par.diasPendencia)} dias</label><label>sem atualização ≥ ${num("diasSemAtualizacao", par.diasSemAtualizacao)} dias</label></div></details>
  </section>`;
  const abertos = [...el.querySelectorAll("details[data-k]")].filter((x) => x.open).map((x) => x.dataset.k);
  el.innerHTML = h;
  // mantém abertas as consultas complementares que o usuário abriu (ao trocar período ou parâmetro)
  el.querySelectorAll("details").forEach((x, i) => { x.dataset.k = String(i); if (abertos.includes(String(i))) x.open = true; });
}
function clique(e) {
  const t = e.target;
  const per = t.closest("[data-pv-per]");
  if (per) { const k = per.dataset.pvPer, iv = intervalo(); salvarCfg(k === "custom" ? { periodo: k, de: iv.de, ate: iv.ate } : { periodo: k }); pintarProdutividade(body, ctxAtual); return; }
  const gr = t.closest("[data-pv-grao]");
  if (gr) { salvarCfg({ grao: gr.dataset.pvGrao }); pintarProdutividade(body, ctxAtual); return; }
  const pj = t.closest("[data-pv-proj]");
  if (pj) { ctxAtual.filtrarProjeto(pj.dataset.pvProj); return; }
  const un = t.closest("[data-pv-unit]");
  if (un) { ctxAtual.abrirUnidade(Number(un.dataset.pvUnit)); }
}
function mudou(e) {
  const t = e.target;
  if (t.matches("[data-pv-de],[data-pv-ate]")) {
    const de = body.querySelector("[data-pv-de]").value, ate = body.querySelector("[data-pv-ate]").value;
    if (de && ate && de <= ate) { salvarCfg({ periodo: "custom", de, ate }); pintarProdutividade(body, ctxAtual); }
    else ctxAtual.host.toast?.("Período inválido: a data inicial deve ser antes da final.");
    return;
  }
  if (t.dataset.pvPar) {
    const v = Math.max(Number(t.min) || 1, Math.min(Number(t.max) || 365, Math.round(Number(t.value) || 0)));
    salvarCfg({ params: { ...cfg().params, [t.dataset.pvPar]: v } }); pintarProdutividade(body, ctxAtual);
  }
}
