// Ponto de entrada da página Suprimentos › Relatório de Pedidos.
// Fluxo: tema → sessão (login feito na página inicial) → permissão do módulo → dados → tela.
import { initTheme } from "../../../platform/core/theme.js";
import { loadSession, signOut } from "../../../platform/core/auth.js";
import { HOME_URL } from "../../../platform/core/config.js";
import { esc, fmtDateTime, fmtDateShort } from "../../../platform/core/utils.js";
import { headerHTML, stateHTML, ICON } from "../../../platform/ui/shell.js";
import { fetchPedidoRows, fetchUltimaExecucao } from "./service.js";
import { buildPedidos } from "./model.js";
import { mountPedidos } from "./view.js";

const MODULE = "suprimentos";
const page = document.getElementById("app");

const goHome = `<a class="pf-btn primary" href="${HOME_URL}">Ir para a página inicial</a>`;
const retry = `<button class="pf-btn primary" type="button" onclick="location.reload()">Tentar novamente</button>`;

function frame(subtitle, body) {
  page.innerHTML = headerHTML({
    kicker: "Suprimentos",
    title: "Relatório de Controle de Pedidos",
    subtitle,
    actions: `<button class="pf-btn" type="button" data-pf-print title="Imprimir / PDF">${ICON.print}<span class="pf-lbl">Imprimir</span></button>`
  }) + `<div id="pfBody">${body}</div>`;
}

function updatedText(exec, rows) {
  if (!exec) return `Acompanhamento de materiais por obra · ${rows.toLocaleString("pt-BR")} itens do ERP.`;
  const periodo = exec.periodo_inicio && exec.periodo_fim ? ` · período ${fmtDateShort(exec.periodo_inicio)} a ${fmtDateShort(exec.periodo_fim)}` : "";
  return `Acompanhamento de materiais por obra · dados do ERP atualizados em <b>${esc(fmtDateTime(exec.finalizado_em))}</b>${periodo}.`;
}

async function boot() {
  initTheme();
  document.addEventListener("click", async (e) => {
    if (e.target.closest("[data-pf-print]")) window.print();
    if (e.target.closest("[data-pf-logout]")) { await signOut(); location.href = HOME_URL; }
  });

  frame("", stateHTML({ title: "Carregando pedidos…", text: "Buscando os dados mais recentes do ERP.", spinner: true }));

  let session;
  try { session = await loadSession(); } catch { session = { status: "error" }; }
  if (session.status !== "ok") {
    const msg = session.status === "expired" ? "Sua sessão expirou após 30 dias. Entre novamente." : "Entre com seu e-mail e senha na página inicial para acessar os módulos da plataforma.";
    frame("", stateHTML({ title: session.status === "offline" ? "Configuração indisponível" : "Faça login para continuar", text: msg, action: goHome }));
    return;
  }
  if (!session.modules.has(MODULE)) {
    frame("", stateHTML({ title: "Sem acesso ao módulo Suprimentos", text: "Peça a um administrador do módulo para liberar o seu acesso em Configurações › Módulos.", action: goHome }));
    return;
  }

  try {
    const [rows, exec] = await Promise.all([fetchPedidoRows(), fetchUltimaExecucao()]);
    const pedidos = buildPedidos(rows);
    frame(updatedText(exec, rows.length), '<div id="pdRoot"></div>');
    if (!pedidos.length) {
      document.getElementById("pdRoot").innerHTML = '<div class="pf-empty">Nenhum pedido disponível. O relatório 1187 ainda não foi importado pelo robô.</div>';
      return;
    }
    mountPedidos(document.getElementById("pdRoot"), { pedidos });
  } catch (err) {
    console.error(err);
    frame("", stateHTML({ title: "Erro ao carregar os dados", text: "Verifique sua conexão e tente novamente.", action: retry }));
  }
}

boot();
