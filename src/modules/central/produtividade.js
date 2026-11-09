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
function pintarConteudo(grao) {
  const el = body?.querySelector("#pvConteudo"); if (!el) return;
  if (st.carregando && !st.dados) { el.innerHTML = `<div class="ct-skel" aria-hidden="true">${"<i></i>".repeat(8)}</div><span class="ct-sr" role="status">Calculando os indicadores…</span>`; return; }
  if (st.erro && !st.dados) { el.innerHTML = `<div class="ct-vazio err"><b>${esc(st.erro)}</b></div>`; return; }
  const d = st.dados; if (!d) return;
  const g = d.geral, p = d.no_periodo, host = ctxAtual.host;
  const aprovTot = g.aprovadas_1a + g.rev_finalizadas, abertas = g.pend_total - g.pend_resolvidas;
  const nomeP = (id) => host.projetos().find((x) => String(x.id) === String(id))?.nome || `Condomínio ${id}`;
  let h = st.carregando ? `<div class="pv-carr" role="status"><span class="ct-spin"></span>Atualizando…</div>` : "";
  // 1. Situação atual (unidades únicas)
  h += `<section class="pv-sec"><h3>Situação atual <small>· unidades únicas (cada apartamento conta uma vez)</small></h3><div class="pv-ks">
    ${tile(g.vistoriadas, "Unidades vistoriadas", `de ${g.unidades} · ${M.fmtPct(M.pct(g.vistoriadas, g.unidades))}`)}
    ${tile(aprovTot, "Unidades aprovadas", `${g.aprovadas_1a} na 1ª vistoria · ${g.rev_finalizadas} após revistoria`, " ok")}
    ${tile(M.fmtPct(M.pct(g.aprovadas_1a, g.vistoriadas)), "Aprovação na 1ª vistoria", "aprovadas ÷ vistoriadas (qualidade)", " ok")}
    ${tile(g.em_revistoria, "Em revistoria", `${g.rc_agendado} agendada(s) · ${g.rc_em_andamento} aguardando`, " warn")}
    ${tile(g.rev_finalizadas, "Revistorias finalizadas", "aprovadas após a revistoria")}
    ${tile(g.aguardando_vistoria, "Aguardando a 1ª vistoria", `${g.nao_agendadas} sem agendamento`)}
    ${tile(g.pend_total, "Pendências identificadas", `${g.unidades_com_pend} unidade(s) com relatório`)}
    ${tile(g.pend_resolvidas, "Pendências resolvidas", `${abertas} em aberto · ${g.unidades_pend_abertas} unidade(s)`, " ok")}
    ${tile(M.fmtPct(M.pct(g.pend_resolvidas, g.pend_total)), "Resolução das pendências", proporcao(g.pend_resolvidas, g.pend_total), " ok")}
  </div></section>`;
  // 2. No período (atividades)
  h += `<section class="pv-sec"><h3>No período <small>· atividades (uma unidade pode ter várias revistorias)</small></h3><div class="pv-ks">
    ${tile(p.vist_agendadas + p.rev_agendadas, "Atividades agendadas", `${p.vist_agendadas} vistorias · ${p.rev_agendadas} revistorias`)}
    ${tile(p.vist_realizadas + p.rev_realizadas, "Atividades concluídas", `${p.vist_realizadas} vistorias · ${p.rev_realizadas} revistorias`)}
    ${tile(`${p.vist_realizadas}${delta(p.vist_realizadas, p.ant_vist_realizadas)}`, "Vistorias realizadas", `${p.vist_aprovadas} aprovadas · ${M.fmtPct(M.pct(p.vist_aprovadas, p.vist_realizadas))}`)}
    ${tile(`${p.rev_realizadas}${delta(p.rev_realizadas, p.ant_rev_realizadas)}`, "Revistorias realizadas", `${p.rev_unidades} unidade(s) · ${p.rev_aprovadas} aprovada(s)`)}
    ${tile(p.vist_atrasadas + p.rev_atrasadas, "Atrasadas / não realizadas", "data passou sem resultado", p.vist_atrasadas + p.rev_atrasadas ? " bad" : "")}
    ${tile(p.pend_identificadas, "Pendências identificadas", "pela data do relatório")}
    ${tile(`${p.pend_resolvidas}${delta(p.pend_resolvidas, p.ant_pend_resolvidas)}`, "Pendências resolvidas", "marcadas no checklist", " ok")}
  </div></section>`;
  // 3. Evolução
  h += `<section class="pv-sec"><h3>Evolução <small>· ${grao === "mes" ? "por mês" : grao === "semana" ? "por semana" : "por dia"}</small></h3><div class="pv-graf">
    ${barras({ id: "pvG1", titulo: "Vistorias e revistorias realizadas", baldes: d.serie, series: ["vistorias", "revistorias"], grao })}
    ${barras({ id: "pvG2", titulo: "Aprovações", baldes: d.serie, series: ["vist_aprovadas", "rev_aprovadas"], grao })}
    ${barras({ id: "pvG3", titulo: "Pendências identificadas e resolvidas", baldes: d.serie, series: ["pend_identificadas", "pend_resolvidas"], grao })}
  </div></section>`;
  // 4. Condomínios
  const cs = d.condominios || [];
  if (cs.length) {
    h += `<section class="pv-sec"><h3>Por condomínio <small>· clique para ver só um condomínio</small></h3><div class="pv-tw"><table class="pv-tbl"><thead><tr>
      <th class="l">Condomínio</th><th>Unidades</th><th>Vistoriadas</th><th>Aprovadas</th><th>% aprov. 1ª</th><th>Em revistoria</th><th>Rev. finalizadas</th><th>Pendências</th><th>Resolvidas</th><th>% resolução</th><th title="No período">Vist. período</th><th title="No período">Rev. período</th></tr></thead><tbody>
      ${cs.map((x) => `<tr data-pv-proj="${x.project_id}" tabindex="0" title="Ver só este condomínio"><td class="l"><b>${esc(nomeP(x.project_id))}</b></td><td>${x.unidades}</td><td>${x.vistoriadas}</td><td>${x.aprovadas_1a + x.rev_finalizadas}</td><td>${M.fmtPct(M.pct(x.aprovadas_1a, x.vistoriadas))}</td><td>${x.em_revistoria}</td><td>${x.rev_finalizadas}</td><td>${x.pend_total}</td><td>${x.pend_resolvidas}</td><td>${M.fmtPct(M.pct(x.pend_resolvidas, x.pend_total))}</td><td>${x.vist_realizadas}</td><td>${x.rev_realizadas}</td></tr>`).join("")}
      </tbody></table></div></section>`;
  }
  // 5. Vistoriadores
  const ps = d.vistoriadores || [];
  h += `<section class="pv-sec"><h3>Por vistoriador <small>· no período</small></h3>${ps.length ? `<div class="pv-tw"><table class="pv-tbl pv-pes"><thead><tr>
      <th class="l" rowspan="2">Responsável</th><th colspan="5" class="g">1ª vistoria · produtividade e qualidade</th><th colspan="2" class="g">Pendências identificadas</th><th colspan="3" class="g">Revistorias</th></tr>
      <tr><th>Realizadas</th><th title="Comparado ao período anterior">Variação</th><th>Aprovadas</th><th>Com pendências</th><th>% aprov.</th><th>Total</th><th title="Média por unidade vistoriada com relatório">Por unidade</th><th>Realizadas</th><th>Aprovadas</th><th title="Comparado ao período anterior">Variação</th></tr></thead><tbody>
      ${ps.map((x) => `<tr><td class="l"><b>${esc(x.nome)}</b></td><td>${x.vistorias || "—"}</td><td>${x.vistorias || x.ant_vistorias ? delta(x.vistorias, x.ant_vistorias) || "=" : "—"}</td><td>${x.vistorias ? x.aprovadas : "—"}</td><td>${x.vistorias ? x.reprovadas : "—"}</td>
        <td>${M.fmtPct(M.pct(x.aprovadas, x.vistorias))}</td><td>${x.pendencias || "—"}</td><td>${x.unidades_com_pend ? (x.pendencias / x.unidades_com_pend).toFixed(1).replace(".", ",") : "—"}</td>
        <td>${x.revistorias || "—"}</td><td>${x.revistorias ? x.rev_aprovadas : "—"}</td><td>${x.revistorias || x.ant_revistorias ? delta(x.revistorias, x.ant_revistorias) || "=" : "—"}</td></tr>`).join("")}
      </tbody></table></div>
      <p class="pv-nota"><b>Como ler:</b> <i>Realizadas</i> mede produtividade; <i>% aprov.</i> mede o resultado da 1ª vistoria (aprovada × com pendências) e não a qualidade do trabalho de quem vistoriou. Pendências são as dos relatórios das unidades vistoriadas pela pessoa (identificadas na vistoria). A resolução das pendências é da obra e não é atribuída ao vistoriador. Nomes iguais com maiúsculas ou espaços diferentes contam como a mesma pessoa.</p>`
    : `<div class="ct-vazio"><b>Nenhuma vistoria ou revistoria com responsável no período.</b></div>`}</section>`;
  // 6. Atenção
  const a = d.atencao, par = cfg().params;
  const num = (k, v, min = 1, max = 365) => `<input type="number" min="${min}" max="${max}" value="${v}" data-pv-par="${k}" aria-label="Parâmetro">`;
  const card = (k, titulo, regra, unid, extra) => {
    const x = a[k] || { total: 0, itens: [] };
    return `<details class="pv-at${x.total ? " tem" : ""}"${x.total && x.total <= 5 ? " open" : ""}><summary><b>${x.total}</b><span>${titulo}</span><small>${regra}</small></summary>
      ${x.itens?.length ? `<ul>${x.itens.map((i) => `<li><button type="button" data-pv-unit="${i.unit_id}"><span>${esc(nomeP(i.project_id))} · ${i.kind === "casa" ? "Conj." : "Bloco"} ${esc(i.bloco)} · ${esc(i.codigo)}${i.cliente ? ` <small>${esc(i.cliente)}</small>` : ""}</span><em>${esc(unid(i))}</em></button></li>`).join("")}</ul>${x.total > x.itens.length ? `<p class="pv-nota">Mostrando ${x.itens.length} de ${x.total}.</p>` : ""}` : `<p class="pv-nota">Nada por aqui.</p>`}${extra || ""}</details>`;
  };
  h += `<section class="pv-sec"><h3>Atenção <small>· situação atual</small></h3>
    <div class="pv-par"><span>Parâmetros (ajustáveis, não alteram dados):</span>
      <label>aguardando revistoria ≥ ${num("diasEspera", par.diasEspera)} dias</label><label>muitas pendências ≥ ${num("minPendencias", par.minPendencias)}</label>
      <label>pendência antiga ≥ ${num("diasPendencia", par.diasPendencia)} dias</label><label>sem atualização ≥ ${num("diasSemAtualizacao", par.diasSemAtualizacao)} dias</label></div>
    <div class="pv-ats">
    ${card("atrasadas", "Atividades atrasadas", "agendadas para antes de hoje e sem resultado", (i) => `${i.tipo === "revistoria" ? "Revistoria" : "Vistoria"} de ${M.fmtD(i.data)} · ${i.valor} dia(s)`)}
    ${card("aguardando_revistoria", "Aguardando agendamento da revistoria", `há ${par.diasEspera} dias ou mais`, (i) => `${i.valor} dia(s)`)}
    ${card("muitas_pendencias", "Unidades com muitas pendências abertas", `${par.minPendencias} ou mais em aberto`, (i) => `${i.valor} aberta(s) de ${i.extra}`)}
    ${card("reincidentes", "Reprovações recorrentes", "2 ou mais revistorias reprovadas", (i) => `${i.valor} reprovação(ões)`)}
    ${card("pendencias_antigas", "Pendências abertas há muito tempo", `identificadas há ${par.diasPendencia} dias ou mais`, (i) => `${i.extra} item(ns) · ${i.valor} dia(s)`, a.pendencias_antigas?.unidades != null ? `<p class="pv-nota">${a.pendencias_antigas.total} pendência(s) em ${a.pendencias_antigas.unidades} unidade(s).</p>` : "")}
    ${card("sem_atualizacao", "Unidades sem atualização recente", `nada registrado há ${par.diasSemAtualizacao} dias (fora as aprovadas)`, (i) => `${i.valor} dia(s) · ${i.extra}`)}
  </div></section>`;
  el.innerHTML = h;
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
