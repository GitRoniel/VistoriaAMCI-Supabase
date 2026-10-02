// Moldura das páginas de módulo: cabeçalho no padrão da Visão Geral, telas de estado e avisos.
import { esc } from "../core/utils.js";
import { HOME_URL } from "../core/config.js";

const ICON = {
  back: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>',
  moon: '<svg class="theme-ico-moon" viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>',
  sun: '<svg class="theme-ico-sun" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
  logout: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/></svg>',
  print: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 9V3h10v6M7 18H4v-7h16v7h-3M7 14h10v7H7z"/></svg>'
};
ICON.home = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 21h18M5 21V7l8-4v18M19 21V11l-6-3"/></svg>';
ICON.user = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>';
export { ICON };

/**
 * Cabeçalho do app no mesmo padrão das páginas dos condomínios (Vistorias):
 * faixa verde com logos, título, botões e, abaixo, a faixa de abas (no celular, barra inferior).
 * @param {{title:string, user?:{name:string}, actions?:string, tabs?:Array<{id:string,label:string,icon:string}>, active?:string}} o
 */
export function appHeaderHTML({ title, user = null, actions = "", tabs = [], active = "" }) {
  const tabBtns = (cls) => tabs.map((t) => `<button type="button" role="tab" class="${cls}${t.id === active ? " active" : ""}" data-tab="${esc(t.id)}" aria-selected="${t.id === active}"${cls === "tab" ? ` id="tab-${esc(t.id)}" aria-controls="pane-${esc(t.id)}"` : ""}>`
    + (cls === "tab" ? `<span class="ti">${t.icon}</span>${esc(t.label)}` : `${t.icon}<span>${esc(t.label)}</span>`) + "</button>").join("");
  return `<div class="pf-appbar">
    <div class="header">
      <div class="header-inner">
        <a class="brand" href="${HOME_URL}" aria-label="Voltar à página inicial">
          <img class="brand-logo-img" src="/assets/alto-mangueiral-logo-white.png" alt="Alto Mangueiral">
          <div class="brand-vsep"></div>
          <div class="engertal-badge"><img src="/assets/engertal-logo.png" alt="Engertal Construtora"></div>
        </a>
        <div class="head-spacer"></div>
        <div class="head-title"><strong>${esc(title)}</strong></div>
        <div class="head-actions">
          <a class="project-switch-btn" href="${HOME_URL}" title="Voltar para a seleção de obras e módulos">${ICON.home}<span>Início</span></a>
          ${user ? `<span class="userchip" title="${esc(user.name)}">${ICON.user}<span class="ub">${esc(user.name)}</span></span>` : ""}
          ${actions}
          <button class="icon-btn" type="button" data-theme-toggle aria-label="Alternar tema claro/escuro" title="Alternar tema">${ICON.moon}${ICON.sun}</button>
          <button class="icon-btn" type="button" data-pf-logout aria-label="Sair" title="Sair">${ICON.logout}</button>
        </div>
      </div>
    </div>
    ${tabs.length > 1 ? `<div class="tabs-strip"><div class="tabs" role="tablist" aria-label="Relatórios">${tabBtns("tab")}</div></div>` : ""}
  </div>
  ${tabs.length > 1 ? `<nav class="botnav" aria-label="Relatórios">${tabBtns("navbtn")}</nav>` : ""}`;
}

/** Título da seção (mesmo "sec-head" das páginas dos condomínios). O subtítulo fica em #pfSubtitle. */
export function secHeadHTML({ icon, title, subtitle = "" }) {
  return `<div class="sec-head pf-sec-head"><span class="icn">${icon}</span><h2 id="pfSecTitle">${esc(title)}</h2><div class="sh-flow" id="pfSubtitle">${subtitle}</div></div>`;
}

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
