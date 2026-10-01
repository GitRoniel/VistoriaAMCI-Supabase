// Página Relatórios: uma página com uma aba por módulo (Suprimentos, Contratos).
// Fluxo: tema → sessão (login feito na página inicial) → abas liberadas → aba ativa (#hash) → dados.
// Cada aba busca os dados só quando é aberta pela primeira vez e mantém o estado (filtros) ao alternar.
import { initTheme } from "../../platform/core/theme.js";
import { loadSession, signOut } from "../../platform/core/auth.js";
import { HOME_URL } from "../../platform/core/config.js";
import { esc } from "../../platform/core/utils.js";
import { headerHTML, stateHTML, ICON } from "../../platform/ui/shell.js";
import { suprimentosTab } from "../suprimentos/pedidos/tab.js";
import { contratosTab } from "../contratos/contratos/tab.js";

const TABS = [suprimentosTab, contratosTab];
const page = document.getElementById("app");

const goHome = `<a class="pf-btn primary" href="${HOME_URL}">Ir para a página inicial</a>`;
const retry = `<button class="pf-btn primary" type="button" onclick="location.reload()">Tentar novamente</button>`;
const printBtn = `<button class="pf-btn" type="button" data-pf-print title="Imprimir / PDF">${ICON.print}<span class="pf-lbl">Imprimir</span></button>`;

function frame(title, subtitle, body) {
  page.innerHTML = headerHTML({ kicker: "Relatórios", title, subtitle, actions: printBtn }) + `<div id="pfBody">${body}</div>`;
}

function mountTabs(tabs) {
  const state = new Map(tabs.map((t) => [t.id, { loaded: false, loading: null, subtitle: "" }]));
  frame(tabs[0].title, "&nbsp;", `
    ${tabs.length > 1 ? `<nav class="pf-tabs" role="tablist" aria-label="Relatórios">${tabs.map((t) =>
      `<button type="button" role="tab" class="pf-tab" id="tab-${t.id}" data-tab="${t.id}" aria-controls="pane-${t.id}" aria-selected="false">${esc(t.label)}</button>`).join("")}</nav>` : ""}
    ${tabs.map((t) => `<div class="pf-pane" id="pane-${t.id}" role="tabpanel" aria-labelledby="tab-${t.id}" hidden></div>`).join("")}`);

  const h1 = page.querySelector(".pf-title h1");
  const sub = document.getElementById("pfSubtitle");

  async function show(id) {
    const tab = tabs.find((t) => t.id === id) || tabs[0];
    const st = state.get(tab.id);
    tabs.forEach((t) => {
      document.getElementById("pane-" + t.id).hidden = t.id !== tab.id;
      document.getElementById("tab-" + t.id)?.setAttribute("aria-selected", String(t.id === tab.id));
    });
    h1.textContent = tab.title;
    document.title = `${tab.title} · Relatórios`;
    if (location.hash !== "#" + tab.id) history.replaceState(null, "", "#" + tab.id);
    sub.innerHTML = st.subtitle || "&nbsp;";
    if (st.loaded || st.loading) return;
    const pane = document.getElementById("pane-" + tab.id);
    pane.innerHTML = stateHTML({ title: tab.loading, text: "Buscando os dados mais recentes do ERP.", spinner: true });
    st.loading = tab.load(pane).then((subtitle) => {
      st.loaded = true; st.subtitle = subtitle;
      if (!pane.hidden) sub.innerHTML = subtitle;
    }).catch((err) => {
      console.error(err);
      pane.innerHTML = stateHTML({ title: "Erro ao carregar os dados", text: "Verifique sua conexão e tente novamente.", action: retry });
    }).finally(() => { st.loading = null; });
  }

  page.addEventListener("click", (e) => { const b = e.target.closest("[data-tab]"); if (b) show(b.dataset.tab); });
  page.addEventListener("keydown", (e) => {
    const b = e.target.closest("[data-tab]"); if (!b || !["ArrowLeft", "ArrowRight"].includes(e.key)) return;
    const i = tabs.findIndex((t) => t.id === b.dataset.tab), n = tabs[(i + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length];
    show(n.id); document.getElementById("tab-" + n.id).focus();
  });
  window.addEventListener("hashchange", () => show(location.hash.slice(1)));
  // "Modo compacto" vale para as duas abas: mantém as chaves iguais.
  page.addEventListener("change", (e) => {
    if (!e.target.matches("#pdCompact,#ctCompact")) return;
    page.querySelectorAll("#pdCompact,#ctCompact").forEach((el) => { el.checked = e.target.checked; });
  });
  show(location.hash.slice(1));
}

async function boot() {
  initTheme();
  document.addEventListener("click", async (e) => {
    if (e.target.closest("[data-pf-print]")) window.print();
    if (e.target.closest("[data-pf-logout]")) { await signOut(); location.href = HOME_URL; }
  });
  try { if (localStorage.getItem("amCompact") === "1") document.body.classList.add("compact"); } catch { /* ignora */ }

  frame("Relatórios", "", stateHTML({ title: "Carregando…", text: "Conferindo o seu acesso.", spinner: true }));

  let session;
  try { session = await loadSession(); } catch { session = { status: "error" }; }
  if (session.status !== "ok") {
    const msg = session.status === "expired" ? "Sua sessão expirou após 30 dias. Entre novamente." : "Entre com seu e-mail e senha na página inicial para acessar os módulos da plataforma.";
    frame("Relatórios", "", stateHTML({ title: session.status === "offline" ? "Configuração indisponível" : "Faça login para continuar", text: msg, action: goHome }));
    return;
  }
  const tabs = TABS.filter((t) => session.modules.has(t.module));
  if (!tabs.length) {
    frame("Relatórios", "", stateHTML({ title: "Sem acesso aos relatórios", text: "Peça a um administrador para liberar o módulo Suprimentos ou Contratos em Configurações › Módulos.", action: goHome }));
    return;
  }
  mountTabs(tabs);
}

boot();
