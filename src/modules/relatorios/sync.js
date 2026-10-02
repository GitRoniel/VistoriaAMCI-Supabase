// Situação da automação UAU-Sync (GitHub Actions) para cada relatório.
//
// A automação grava cada execução em public.pedidos_execucoes (relatório, início, fim, status,
// linhas, erro) e as linhas de cada execução nas tabelas do ERP. Aqui mostramos:
//   • se a última execução deu certo (ou falhou, com o motivo, ou ainda está rodando);
//   • data e horário da atualização dos dados exibidos;
//   • o que mudou em relação à execução anterior com sucesso (linhas e registros novos);
//   • o histórico das últimas execuções.
// A página confere a cada minuto (com a aba visível) se chegou uma execução nova e avisa.
import { getSupabase } from "../../platform/core/supabase.js";
import { esc, fmtNum } from "../../platform/core/utils.js";

const POLL_MS = 60_000;
const HISTORY = 8;
const OK = "sucesso", FAIL = "erro";

const fmtWhen = (ts) => {
  if (!ts) return "—";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "—";
  const dia = d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
  const hora = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  return `${dia} às ${hora}`;
};
const fmtDur = (a, b) => {
  if (!a || !b) return "";
  const min = Math.round((new Date(b) - new Date(a)) / 60000);
  return min < 1 ? "menos de 1 min" : `${min} min`;
};
const signed = (n) => (n > 0 ? "+" : n < 0 ? "−" : "") + fmtNum(Math.abs(n));

/** Últimas execuções de um relatório (mais recente primeiro). */
export async function fetchExecucoes(relatorio, limit = HISTORY) {
  const supabase = getSupabase();
  if (!supabase) return [];
  const { data, error } = await supabase.from("pedidos_execucoes")
    .select("id,iniciado_em,finalizado_em,status,linhas,periodo_inicio,periodo_fim,erro")
    .eq("relatorio", relatorio).order("iniciado_em", { ascending: false }).limit(limit);
  if (error) throw error;
  return data || [];
}

/** Resumo: última execução, última com sucesso (dados exibidos) e a anterior com sucesso. */
export function summarize(execs) {
  const oks = execs.filter((e) => e.status === OK);
  const last = execs[0] || null;
  const lastOk = oks[0] || null, prevOk = oks[1] || null;
  const running = last && last.status !== OK && last.status !== FAIL && !last.finalizado_em ? last : null;
  const failed = last && last.status === FAIL && (!lastOk || new Date(last.iniciado_em) > new Date(lastOk.iniciado_em)) ? last : null;
  return { last, lastOk, prevOk, running, failed, lineDiff: lastOk && prevOk && lastOk.linhas != null && prevOk.linhas != null ? lastOk.linhas - prevOk.linhas : null };
}

function statusPill(e) {
  if (e.status === OK) return '<span class="pf-badge b-ok">Sucesso</span>';
  if (e.status === FAIL) return '<span class="pf-badge b-danger">Falhou</span>';
  return '<span class="pf-badge b-partial">Em andamento</span>';
}

/** HTML da faixa de atualização. `news` = [{n, label}] registros novos (opcional, chega depois). */
export function syncHTML(sum, execs, { news = null, unit = "linhas", fresh = false } = {}) {
  if (!sum.last) return `<div class="pf-sync-main"><span class="pf-sync-st muted"><i></i>Sem registro de execução da automação</span></div>`;
  const { lastOk, prevOk, running, failed, lineDiff } = sum;
  const st = running
    ? `<span class="pf-sync-st run"><i></i>Atualização em andamento desde ${esc(fmtWhen(running.iniciado_em))}</span>`
    : failed
      ? `<span class="pf-sync-st err"><i></i>Última atualização falhou em ${esc(fmtWhen(failed.finalizado_em || failed.iniciado_em))}</span>`
      : `<span class="pf-sync-st ok"><i></i>Atualização concluída com sucesso</span>`;
  const when = lastOk
    ? `<span class="pf-sync-it"><small>Dados atualizados em</small><b>${esc(fmtWhen(lastOk.finalizado_em || lastOk.iniciado_em))}</b></span>` : "";
  const total = lastOk?.linhas != null ? `<span class="pf-sync-it"><small>Linhas no ERP</small><b>${fmtNum(lastOk.linhas)}</b></span>` : "";
  let delta = "";
  if (lastOk && prevOk) {
    const parts = [];
    if (news) news.forEach((x) => parts.push(`<b class="${x.n > 0 ? "up" : ""}">${x.n > 0 ? "+" : ""}${fmtNum(x.n)}</b> ${esc(x.label)}`));
    if (lineDiff != null) parts.push(`<b class="${lineDiff > 0 ? "up" : lineDiff < 0 ? "down" : ""}">${signed(lineDiff)}</b> ${esc(unit)}`);
    delta = `<span class="pf-sync-it pf-sync-delta"><small>Desde a atualização anterior (${esc(fmtWhen(prevOk.finalizado_em || prevOk.iniciado_em))})</small><span>${parts.join('<i class="sep">·</i>') || (news === null ? "calculando…" : "sem mudanças")}</span></span>`;
  } else if (lastOk) {
    delta = '<span class="pf-sync-it pf-sync-delta"><small>Mudanças</small><span>primeira atualização registrada</span></span>';
  }
  const err = failed?.erro ? `<div class="pf-sync-err"><b>Motivo:</b> ${esc(failed.erro)}${lastOk ? ` · os dados abaixo são da atualização de ${esc(fmtWhen(lastOk.finalizado_em))}.` : ""}</div>` : "";
  const hist = execs.length ? `<details class="pf-sync-hist"><summary>Histórico</summary><table><thead><tr><th>Início</th><th>Situação</th><th class="r">Linhas</th><th class="r">Duração</th><th>Observação</th></tr></thead><tbody>${execs.map((e) =>
    `<tr${e.id === lastOk?.id ? ' class="cur"' : ""}><td>${esc(fmtWhen(e.iniciado_em))}</td><td>${statusPill(e)}</td><td class="r">${e.linhas != null ? fmtNum(e.linhas) : "—"}</td><td class="r">${esc(fmtDur(e.iniciado_em, e.finalizado_em)) || "—"}</td><td class="obs">${e.id === lastOk?.id ? "dados exibidos" : esc(e.erro || "")}</td></tr>`).join("")}</tbody></table></details>` : "";
  const banner = fresh ? '<div class="pf-sync-new"><span>Chegaram dados novos da automação.</span><button type="button" class="pf-btn primary" data-sync-reload>Atualizar agora</button></div>' : "";
  return `${banner}<div class="pf-sync-main">${st}${when}${delta}${total}${hist}</div>${err}`;
}

/**
 * Monta a faixa de atualização em `el` para a aba `tab` ({report, unit, countNew(prevId)}).
 * `ready`: promessa do carregamento da aba (a contagem de registros novos espera por ela).
 * `isVisible()` diz se a aba está aberta (a conferência periódica só roda com ela visível).
 */
export function mountSync(el, tab, { isVisible, ready = Promise.resolve() }) {
  let execs = [], sum = summarize([]), news = null, fresh = false, shownOkId = null, timer = null;
  const paint = () => { el.innerHTML = syncHTML(sum, execs, { news, unit: tab.unit, fresh }); };

  async function refresh(first = false) {
    try {
      execs = await fetchExecucoes(tab.report);
      sum = summarize(execs);
      if (first) shownOkId = sum.lastOk?.id ?? null;
      // Execução nova com sucesso depois que a página abriu: avisa e oferece recarregar.
      fresh = !first && sum.lastOk && sum.lastOk.id !== shownOkId;
      paint();
      if (first && sum.lastOk && sum.prevOk && tab.countNew) {
        await ready; // as chaves atuais vêm do carregamento da aba
        news = await tab.countNew(sum.prevOk.id).catch(() => null);
        news = news || [];
        paint();
      }
    } catch (err) {
      console.error(err);
      if (first) el.innerHTML = '<div class="pf-sync-main"><span class="pf-sync-st muted"><i></i>Não foi possível consultar a situação da automação</span></div>';
    }
  }
  el.addEventListener("click", (e) => { if (e.target.closest("[data-sync-reload]")) location.reload(); });
  const tick = () => { if (document.visibilityState === "visible" && isVisible()) refresh(false); };
  timer = setInterval(tick, POLL_MS);
  document.addEventListener("visibilitychange", tick);
  refresh(true);
  return { refresh, stop: () => clearInterval(timer) };
}
