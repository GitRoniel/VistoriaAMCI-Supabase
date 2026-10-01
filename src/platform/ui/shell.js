// Moldura das páginas de módulo: cabeçalho no padrão da Visão Geral, telas de estado e avisos.
import { esc } from "../core/utils.js";
import { HOME_URL } from "../core/config.js";

const ICON = {
  back: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>',
  moon: '<svg class="theme-ico-moon" viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>',
  sun: '<svg class="theme-ico-sun" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
  logout: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M15 12H3"/></svg>',
  print: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 9V3h10v6M7 18H4v-7h16v7h-3M7 14h10v7H7z"/></svg>'
};
export { ICON };

/**
 * Cabeçalho do módulo.
 * @param {{kicker:string,title:string,subtitle?:string,actions?:string}} o  actions: HTML de botões extras
 */
export function headerHTML({ kicker, title, subtitle = "", actions = "" }) {
  return `<header class="pf-top">
    <div class="pf-logos" aria-label="Alto Mangueiral e Engertal">
      <img class="pf-alto" src="/assets/alto-mangueiral-logo-white.png" alt="Alto Mangueiral"><i aria-hidden="true"></i>
      <img class="pf-engertal" src="/assets/engertal-logo.png" alt="Engertal Construtora">
    </div>
    <div class="pf-title"><small>${esc(kicker)}</small><h1>${esc(title)}</h1>${subtitle ? `<p id="pfSubtitle">${subtitle}</p>` : ""}</div>
    <div class="pf-actions">
      ${actions}
      <a class="pf-btn" href="${HOME_URL}" title="Voltar à plataforma">${ICON.back}<span class="pf-lbl">Início</span></a>
      <button class="pf-btn icon" type="button" data-theme-toggle aria-label="Alternar tema claro/escuro">${ICON.moon}${ICON.sun}</button>
      <button class="pf-btn icon" type="button" data-pf-logout aria-label="Sair" title="Sair">${ICON.logout}</button>
    </div>
  </header>`;
}

/** Tela de estado (carregando, sem acesso, erro). */
export function stateHTML({ title, text = "", spinner = false, action = "" }) {
  return `<div class="pf-state" role="status"><div class="box">
    ${spinner ? '<div class="pf-spin" aria-hidden="true"></div>' : ""}
    <h2>${esc(title)}</h2>${text ? `<p>${esc(text)}</p>` : ""}${action}
  </div></div>`;
}

let toastTimer;
export function toast(message) {
  let el = document.querySelector(".pf-toast");
  if (!el) { el = document.createElement("div"); el.className = "pf-toast"; el.setAttribute("role", "status"); document.body.appendChild(el); }
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2200);
}
