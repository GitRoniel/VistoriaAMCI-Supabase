// HM Bar: cabeçalho único da plataforma (estilos em src/platform/styles/hmbar.css).
//
//   logos → espaço flexível → navegação da página (.hm-nav) → ações → tema → menu do usuário
//
// Todas as telas usam esta mesma barra: a página inicial e as telas de Vistorias recebem o HTML
// gerado aqui no build (scripts/build.mjs injeta em www/index.html) e Relatórios a monta em tempo
// de execução. Cada página só informa os botões da sua navegação (`nav`) e ações extras (`actions`);
// logos, tema e o botão do usuário (HM User) são sempre os mesmos.
// Sem dependência de tela (window/document) no carregamento: o build importa este arquivo no Node.
import { esc } from "../core/utils.js";

const svg = (paths) => `<svg viewBox="0 0 24 24" aria-hidden="true">${paths}</svg>`;
export const HM_ICON = {
  home: svg('<path d="M3 11l9-8 9 8"/><path d="M5 10v10h5v-6h4v6h5V10"/>'),
  back: svg('<path d="M15 18l-6-6 6-6"/>'),
  search: svg('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>'),
  building: svg('<path d="M3 21h18M5 21V7l8-4v18M19 21V11l-6-3"/>'),
  print: svg('<path d="M7 9V3h10v6M7 18H4v-7h16v7h-3M7 14h10v7H7z"/>'),
  shield: svg('<path d="M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6z"/><path d="M8.5 12l2.5 2.5 4.5-5"/>'),
  condos: svg('<path d="M3 21h18M5 21V7l7-4 7 4v14"/><path d="M9 21v-5h6v5M9 9h.01M12 9h.01M15 9h.01M9 12.5h.01M12 12.5h.01M15 12.5h.01"/>'),
  logs: svg('<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M8 13h8M8 17h5"/>'),
  logout: svg('<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/>'),
  moon: '<svg class="theme-ico-moon" viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>',
  sun: '<svg class="theme-ico-sun" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
  caret: '<svg class="hm-caret" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>'
};

// Páginas de administração do menu do usuário (abertas na página inicial: /#liberacoes …).
export const HM_ADMIN_PAGES = [
  { id: "liberacoes", label: "Liberações", icon: HM_ICON.shield, badge: "aprProjectBadge" },
  { id: "condominios", label: "Configuração de Condomínios", icon: HM_ICON.condos },
  { id: "logs", label: "Logs", icon: HM_ICON.logs }
];

/**
 * Botão no padrão da barra. `href` gera um link; `ctx` um rótulo de contexto (sem ação).
 * @param {{id?:string,label:string,icon?:string,href?:string,cls?:string,attrs?:string,title?:string,ctx?:boolean,labelId?:string}} o
 */
export function hmBtnHTML({ id = "", label, icon = "", href = "", cls = "", attrs = "", title = "", ctx = false, labelId = "" }) {
  const a = `${id ? ` id="${esc(id)}"` : ""} class="hm-btn${ctx ? " hm-ctx" : ""}${cls ? " " + cls : ""}" title="${esc(title || label)}"${attrs ? " " + attrs : ""}`;
  const inner = `${icon}<span class="hm-lbl"${labelId ? ` id="${esc(labelId)}"` : ""}>${esc(label)}</span>`;
  if (ctx) return `<div${a}>${inner}</div>`;
  if (href) return `<a${a} href="${esc(href)}">${inner}</a>`;
  return `<button type="button"${a} aria-label="${esc(label)}">${inner}</button>`;
}

/** Menu do usuário (HM User): nome, administração (Liberações, Condomínios, Logs) e sair. */
export function hmUserHTML({ home = "/" } = {}) {
  const admin = HM_ADMIN_PAGES.map((p) => `<a class="hm-menu-item hm-menu-nav" role="menuitem" href="${esc(home)}#${p.id}" data-admin-page="${p.id}" hidden>${p.icon}<span>${esc(p.label)}</span>${p.badge ? `<span class="tab-badge" id="${p.badge}" hidden></span>` : ""}</a>`).join("");
  return `<div class="hm-user">
            <button class="hm-btn hm-user-btn" id="hmUserBtn" type="button" aria-haspopup="menu" aria-expanded="false" aria-controls="hmUserMenu"><span class="hm-avatar" id="hmAvatar">?</span><span class="hm-lbl" id="hmUserName">Usuário</span><span class="tab-badge" id="hmUserBadge" hidden></span>${HM_ICON.caret}</button>
            <div class="hm-menu" id="hmUserMenu" role="menu" hidden>
              <div class="hm-menu-who"><b id="hmMenuName">Usuário</b><span id="hmMenuEmail"></span></div>
              <div class="hm-menu-sec" id="hmAdminMenu" hidden>
                <span class="hm-menu-lbl">Administração</span>
                ${admin}
              </div>
              <button class="hm-menu-item hm-menu-out" id="hmLogout" type="button" role="menuitem">${HM_ICON.logout}Sair da conta</button>
            </div>
          </div>`;
}

/**
 * A barra completa.
 * @param {{assets?:string, home?:string, nav?:string, actions?:string, navLabel?:string}} o
 *   assets: prefixo das imagens ("./" em Vistorias, "/" nos módulos); home: endereço da página inicial;
 *   nav: botões de navegação da página; actions: botões extras antes do tema.
 */
export function hmBarHTML({ assets = "/", home = "/", nav = "", actions = "", navLabel = "Navegação da página" } = {}) {
  return `<header class="hm-bar" id="hmBar">
  <div class="hm-bar-in">
    <div class="hm-logos" aria-label="Alto Mangueiral e Engertal">
      <img class="hm-alto" src="${esc(assets)}assets/alto-mangueiral-logo-white.png" alt="Alto Mangueiral">
      <span class="hm-vsep" aria-hidden="true"></span>
      <img class="hm-engertal" src="${esc(assets)}assets/engertal-logo.png" alt="Engertal Construtora">
    </div>
    <nav class="hm-nav" id="hmNav" aria-label="${esc(navLabel)}">${nav}</nav>
    <div class="hm-actions" id="hmActions">
      ${actions}
      <button class="hm-btn hm-icon" id="hmTheme" type="button" data-theme-toggle aria-label="Alternar tema claro/escuro" title="Alternar tema">${HM_ICON.moon}${HM_ICON.sun}</button>
      ${hmUserHTML({ home })}
    </div>
  </div>
</header>`;
}

/** Iniciais e primeiro nome exibidos no botão do usuário. */
export const hmInitials = (name) => String(name || "?").trim().split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "?";
export const hmFirstName = (name) => String(name || "").trim().split(/\s+/)[0] || "Usuário";

/**
 * Comportamento do HM User nas páginas de módulo (na página inicial o próprio index.html cuida dele).
 * @param {{name:string,email?:string,role?:string,adminPages?:string[],onLogout:()=>void}} o
 */
export function mountHmUser({ name, email = "", role = "", adminPages = [], onLogout }) {
  const btn = document.getElementById("hmUserBtn"), menu = document.getElementById("hmUserMenu");
  if (!btn || !menu) return;
  document.getElementById("hmAvatar").textContent = hmInitials(name);
  document.getElementById("hmUserName").textContent = hmFirstName(name) + (role ? " · " + role : "");
  document.getElementById("hmMenuName").textContent = name;
  document.getElementById("hmMenuEmail").textContent = email && email !== name ? email : "";
  let any = false;
  menu.querySelectorAll("[data-admin-page]").forEach((a) => { const ok = adminPages.includes(a.dataset.adminPage); a.hidden = !ok; any = any || ok; });
  document.getElementById("hmAdminMenu").hidden = !any;
  const set = (open) => {
    menu.hidden = !open; btn.setAttribute("aria-expanded", String(open));
    if (open) requestAnimationFrame(() => menu.querySelector(".hm-menu-item:not([hidden])")?.focus());
  };
  btn.addEventListener("click", (e) => { e.stopPropagation(); set(menu.hidden); });
  document.addEventListener("click", (e) => { if (!e.target.closest(".hm-user")) set(false); });
  menu.addEventListener("keydown", (e) => { if (e.key === "Escape") { set(false); btn.focus(); } });
  document.getElementById("hmLogout").addEventListener("click", () => onLogout());
}
