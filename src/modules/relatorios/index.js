// Página Relatórios: uma página com uma aba por módulo (Suprimentos, Contratos).
// Fluxo: tema → sessão (login feito na página inicial) → abas liberadas → aba ativa (#hash) → dados.
// Cada aba busca os dados só quando é aberta pela primeira vez e mantém o estado (filtros) ao alternar.
import { initTheme } from "../../platform/core/theme.js";
import { loadSession, signOut } from "../../platform/core/auth.js";
import { getSupabase } from "../../platform/core/supabase.js";
import { mountHmUser } from "../../platform/ui/hmbar.js";
import { HOME_URL } from "../../platform/core/config.js";
import { esc } from "../../platform/core/utils.js";
import { appHeaderHTML, secHeadHTML, stateHTML } from "../../platform/ui/shell.js";
import { suprimentosTab } from "../suprimentos/pedidos/tab.js";
import { contratosTab } from "../contratos/contratos/tab.js";
import { mountSync } from "./sync.js";

const TABS = [suprimentosTab, contratosTab];
const TAB_ICON = {
  suprimentos: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 8l-9-5-9 5 9 5 9-5z"/><path d="M3 8v8l9 5 9-5V8"/><path d="M12 13v8"/></svg>',
  contratos: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M8 13h8M8 17h5"/></svg>'
};
const page = document.getElementById("app");

const goHome = `<a class="pf-btn primary" href="${HOME_URL}">Ir para a página inicial</a>`;
const retry = `<button class="pf-btn primary" type="button" onclick="location.reload()">Tentar novamente</button>`;

/** HM Bar (cabeçalho único da plataforma) + conteúdo. */
let hmUser = null;
function frame({ user = null, tabs = [], active = "", body }) {
  page.innerHTML = appHeaderHTML({ tabs, active }) + `<div class="pf-page" id="pfBody">${body}</div>`;
  document.body.classList.toggle("has-botnav", tabs.length > 1);
  document.querySelector(".hm-user").hidden = !user;
  if (user && hmUser) mountHmUser({ ...hmUser, onLogout: logout });
  trackAppbar();
}
async function logout() { await signOut(); location.href = HOME_URL; }

/**
 * Menu do usuário: mesmas páginas de administração da tela inicial (abrem lá). Leitura apenas,
 * protegida por RLS: administrador de condomínio vê as três; administrador de módulo, Liberações.
 */
async function userMenuInfo(session) {
  let projectAdmin = false;
  try {
    const { data } = await getSupabase().from("project_members").select("role").eq("user_id", session.user.id).eq("active", true);
    projectAdmin = (data || []).some((m) => m.role === "admin");
  } catch { /* sem administração no menu */ }
  const moduleAdmin = [...session.modules.values()].includes("admin");
  return {
    name: session.user.name, email: session.user.email,
    role: projectAdmin || moduleAdmin ? "Admin" : "",
    adminPages: projectAdmin ? ["liberacoes", "condominios", "logs"] : moduleAdmin ? ["liberacoes"] : []
  };
}

// Altura do cabeçalho fixo: os títulos das obras grudam logo abaixo dele ao rolar.
let appbarObs;
function trackAppbar() {
  const bar = page.querySelector(".pf-appbar");
  if (!bar) return;
  const set = () => document.documentElement.style.setProperty("--pf-appbar-h", bar.offsetHeight + "px");
  set();
  appbarObs?.disconnect();
  if ("ResizeObserver" in window) { appbarObs = new ResizeObserver(set); appbarObs.observe(bar); }
}

function mountTabs(tabs, user) {
  const state = new Map(tabs.map((t) => [t.id, { loaded: false, loading: null, subtitle: "" }]));
  const items = tabs.map((t) => ({ id: t.id, label: t.label, icon: TAB_ICON[t.id] || "" }));
  frame({ user, tabs: items, active: tabs[0].id, body: `
    ${secHeadHTML({ icon: TAB_ICON[tabs[0].id] || "", title: tabs[0].title, subtitle: "&nbsp;" })}
    ${tabs.map((t) => `<div class="pf-pane" id="pane-${t.id}" role="tabpanel" aria-labelledby="tab-${t.id}" hidden></div>`).join("")}` });

  const h2 = document.getElementById("pfSecTitle");
  const icn = page.querySelector(".pf-sec-head .icn");
  const sub = document.getElementById("pfSubtitle");

  async function show(id) {
    const tab = tabs.find((t) => t.id === id) || tabs[0];
    const st = state.get(tab.id);
    tabs.forEach((t) => {
      document.getElementById("pane-" + t.id).hidden = t.id !== tab.id;
      page.querySelectorAll(`[data-tab="${t.id}"]`).forEach((b) => { b.classList.toggle("active", t.id === tab.id); b.setAttribute("aria-selected", String(t.id === tab.id)); });
    });
    h2.textContent = tab.title;
    icn.innerHTML = TAB_ICON[tab.id] || "";
    document.title = `${tab.title} · Relatórios`;
    if (location.hash !== "#" + tab.id) history.replaceState(null, "", "#" + tab.id);
    sub.innerHTML = st.subtitle || "&nbsp;";
    if (st.loaded || st.loading) return;
    const pane = document.getElementById("pane-" + tab.id);
    pane.innerHTML = `<section class="pf-sync" data-sync aria-label="Atualização dos dados"></section><div data-body>${stateHTML({ title: tab.loading, text: "Buscando os dados mais recentes do ERP.", spinner: true })}</div>`;
    const body = pane.querySelector("[data-body]");
    st.loading = tab.load(body).then((subtitle) => {
      st.loaded = true; st.subtitle = subtitle;
      if (!pane.hidden) sub.innerHTML = subtitle;
    }).catch((err) => {
      console.error(err);
      body.innerHTML = stateHTML({ title: "Erro ao carregar os dados", text: "Verifique sua conexão e tente novamente.", action: retry });
    }).finally(() => { st.loading = null; });
    // Situação da automação (UAU-Sync): última execução, horário, o que mudou e histórico.
    mountSync(pane.querySelector("[data-sync]"), tab, { isVisible: () => !pane.hidden, ready: st.loading });
  }

  page.addEventListener("click", (e) => {
    const b = e.target.closest("[data-tab]"); if (!b) return;
    const wasActive = b.classList.contains("active");
    show(b.dataset.tab);
    if (!wasActive && b.classList.contains("navbtn")) window.scrollTo({ top: 0 });
  });
  page.addEventListener("keydown", (e) => {
    const b = e.target.closest(".hm-tab[data-tab]"); if (!b || !["ArrowLeft", "ArrowRight"].includes(e.key)) return;
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
    if (e.target.closest("[data-pf-logout]")) await logout();
  });
  try { if (localStorage.getItem("amCompact") === "1") document.body.classList.add("compact"); } catch { /* ignora */ }

  frame({ body: stateHTML({ title: "Carregando…", text: "Conferindo o seu acesso.", spinner: true }) });

  let session;
  try { session = await loadSession(); } catch { session = { status: "error" }; }
  if (session.status !== "ok") {
    const msg = session.status === "expired" ? "Sua sessão expirou após 30 dias. Entre novamente." : "Entre com seu e-mail e senha na página inicial para acessar os módulos da plataforma.";
    frame({ body: stateHTML({ title: session.status === "offline" ? "Configuração indisponível" : "Faça login para continuar", text: msg, action: goHome }) });
    return;
  }
  hmUser = await userMenuInfo(session);
  const tabs = TABS.filter((t) => session.modules.has(t.module));
  if (!tabs.length) {
    frame({ user: session.user, body: stateHTML({ title: "Sem acesso aos relatórios", text: "Peça a um administrador para liberar o módulo Suprimentos ou Contratos em Liberações › Acesso aos módulos.", action: goHome }) });
    return;
  }
  mountTabs(tabs, session.user);
}

boot();
