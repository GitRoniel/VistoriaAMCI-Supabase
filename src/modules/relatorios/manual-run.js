// "Atualizar relatório agora" (aba Suprimentos): dispara o mesmo robô da atualização agendada do
// Relatório 1187 (UAU-Sync) pela função suprimentos-atualizar e acompanha a execução.
//
// O botão só aparece para administradores do módulo, mas quem decide é o servidor: a função confere a
// permissão a cada chamada e impede execuções simultâneas. Aqui ficam a confirmação, o bloqueio de
// cliques duplicados e as mensagens de cada estado (aguardando, executando, concluído, erro).
import { getSupabase } from "../../platform/core/supabase.js";
import { esc } from "../../platform/core/utils.js";

const FN = "suprimentos-atualizar";
const POLL_MS = 20_000;
const ATIVOS = new Set(["aguardando", "executando"]);
const RECENTE_MS = 6 * 3600e3;   // mostra o resultado da última execução manual por 6 h
const ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/></svg>';

const hora = (ts) => (ts ? new Date(ts).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "");
const quando = (ts) => {
  if (!ts) return "";
  const d = new Date(ts), hoje = new Date().toDateString() === d.toDateString();
  return hoje ? `às ${hora(ts)}` : `em ${d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })} às ${hora(ts)}`;
};
const quem = (e) => (e?.solicitado_email || "").split("@")[0];

async function chamar(action) {
  const supabase = getSupabase();
  if (!supabase) throw new Error("Sem conexão com o servidor.");
  const { data, error } = await supabase.functions.invoke(FN, { body: { action } });
  if (!error) return data;
  let body = null;
  try { body = await error.context?.json?.(); } catch { /* sem corpo */ }
  const err = new Error(body?.error || "Não foi possível falar com o servidor. Tente de novo em instantes.");
  err.execucao = body?.execucao || null;
  err.status = error.context?.status;
  throw err;
}

function estadoHTML(exec, { configurado, busy, aviso }) {
  const ativo = exec && ATIVOS.has(exec.status);
  const recente = exec && !ativo && Date.now() - new Date(exec.finalizado_em || exec.solicitado_em) < RECENTE_MS;
  let st = "";
  if (ativo && exec.status === "aguardando") st = `<span class="pf-run-st run" role="status"><i class="pf-sync-dot run"></i>Aguardando o robô iniciar… <small>pedido por ${esc(quem(exec))} ${esc(quando(exec.solicitado_em))}</small></span>`;
  else if (ativo) st = `<span class="pf-run-st run" role="status"><i class="pf-sync-dot run"></i>Executando o robô (leva cerca de 15 min)… <small>pedido por ${esc(quem(exec))} ${esc(quando(exec.solicitado_em))}</small></span>`;
  else if (recente && exec.status === "concluido") st = `<span class="pf-run-st ok" role="status" title="${esc(exec.detalhe || "")}"><i class="pf-sync-dot ok"></i>Atualização manual concluída ${esc(quando(exec.finalizado_em))}</span>`;
  else if (recente && exec.status === "erro") st = `<span class="pf-run-st err" role="alert" title="${esc(exec.detalhe || "")}"><i class="pf-sync-dot err"></i>Erro na atualização manual: ${esc((exec.detalhe || "sem detalhe").slice(0, 160))}</span>`;
  if (aviso) st = `<span class="pf-run-st err" role="alert"><i class="pf-sync-dot err"></i>${esc(aviso)}</span>`;
  const link = exec?.github_run_url && (ativo || recente) ? `<a class="pf-run-link" href="${esc(exec.github_run_url)}" target="_blank" rel="noopener noreferrer">ver execução</a>` : "";
  const dis = busy || ativo || !configurado;
  const title = !configurado ? "Execução manual ainda não configurada no servidor" : ativo ? "Já existe uma atualização em andamento" : "Executa agora o robô da atualização agendada do Relatório 1187";
  return `${st}${link}<button type="button" class="pf-run-btn" data-run-start${dis ? " disabled" : ""} title="${esc(title)}">${ICON}<span>${busy ? "Iniciando…" : "Atualizar relatório agora"}</span></button>`;
}

function confirmar() {
  return new Promise((resolve) => {
    const dlg = document.createElement("dialog");
    dlg.className = "pf-dlg";
    dlg.innerHTML = `<form method="dialog">
      <h3>Atualizar o Relatório 1187 agora?</h3>
      <p>O robô vai entrar no UAU e gerar o Relatório 1187 e a lista de Pedidos de Compra com as empresas e obras configuradas no UAU. Leva cerca de 15 minutos; você pode continuar usando o site.</p>
      <p class="muted">A atualização agendada da noite continua normalmente.</p>
      <div class="pf-dlg-act"><button value="cancelar" class="pf-btn">Cancelar</button><button value="ok" class="pf-btn primary">Atualizar agora</button></div>
    </form>`;
    document.body.appendChild(dlg);
    dlg.addEventListener("close", () => { resolve(dlg.returnValue === "ok"); dlg.remove(); });
    dlg.showModal();
    dlg.querySelector('button[value="cancelar"]').focus();
  });
}

/**
 * Monta o botão em `el`. `onConcluido()` é chamado quando uma execução termina com sucesso
 * (a faixa de atualização confere a nova execução e oferece recarregar os dados).
 */
export function mountManualRun(el, { onConcluido = () => {} } = {}) {
  let exec = null, configurado = true, busy = false, aviso = "", timer = null, visto = null;
  const paint = () => { el.innerHTML = estadoHTML(exec, { configurado, busy, aviso }); };
  const agendar = () => {
    clearTimeout(timer);
    if (exec && ATIVOS.has(exec.status)) timer = setTimeout(atualizar, POLL_MS);
  };
  function aplicar(novo) {
    const antes = exec ? { id: exec.id, status: exec.status } : null;
    exec = novo || null;
    if (antes && ATIVOS.has(antes.status) && exec?.id === antes.id && exec.status === "concluido" && visto !== exec.id) { visto = exec.id; onConcluido(); }
    paint(); agendar();
  }
  async function atualizar() {
    try {
      const r = await chamar("status");
      configurado = r.configurado !== false; aviso = "";
      aplicar(r.execucao);
    } catch (err) {
      if (err.status === 403) { el.hidden = true; return; }   // sem permissão no servidor: some
      aviso = ""; paint(); timer = setTimeout(atualizar, POLL_MS * 3);
    }
  }
  el.addEventListener("click", async (e) => {
    if (!e.target.closest("[data-run-start]") || busy) return;
    if (!(await confirmar())) return;
    busy = true; aviso = ""; paint();
    try {
      const r = await chamar("run");
      aplicar(r.execucao);
    } catch (err) {
      aviso = err.message;
      if (err.execucao) exec = err.execucao;
    } finally {
      busy = false; paint(); agendar();
    }
  });
  paint();
  atualizar();
  return { refresh: atualizar, stop: () => clearTimeout(timer) };
}
