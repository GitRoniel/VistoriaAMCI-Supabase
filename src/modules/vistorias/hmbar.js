// HM Bar das telas de Vistorias (www/index.html). O build injeta este HTML no lugar marcado
// com <!-- HM-BAR --> … <!-- /HM-BAR -->; a página move a barra para a tela aberta e mostra
// só o grupo de navegação dela (data-hm-screen). Os ids dos botões são os que o index.html usa.
import { hmBarHTML, hmBtnHTML, HM_ICON } from "../../platform/ui/hmbar.js";

const TAB_ICON = {
  resumo: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 3v18h18"/><path d="M7 15l4-4 3 3 5-6"/></svg>',
  cliente: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>'
};
const group = (screen, html, hidden = true) => `<div class="hm-grp" data-hm-screen="${screen}"${hidden ? " hidden" : ""}>${html}</div>`;

export function vistoriasHmBarHTML() {
  const nav = [
    // Tela inicial: busca de condomínios e relatórios.
    group("home", `<label class="hm-search hm-search-top">${HM_ICON.search}<input type="search" id="hmSearch" placeholder="Buscar condomínio ou relatório…" aria-label="Buscar condomínio ou relatório" autocomplete="off"></label>`),
    // Condomínio aberto: Início, condomínio atual e as abas da página.
    group("app", [
      hmBtnHTML({ id: "btnHome", label: "Início", icon: HM_ICON.home, title: "Voltar para a seleção de obras e módulos", attrs: 'style="display:none"' }),
      hmBtnHTML({ id: "btnProjectSwitch", label: "Condomínio", labelId: "activeProjectName", icon: HM_ICON.building, title: "Condomínio atual", ctx: true }),
      '<span class="hm-sep" aria-hidden="true"></span>',
      `<div class="hm-tabs" role="tablist" aria-label="Páginas do condomínio">${[["resumo", "Resumo Geral"], ["cliente", "Vistoria · Cliente"]].map(([v, l], i) =>
        `<button type="button" role="tab" class="hm-btn hm-tab${i ? "" : " active"}" data-view="${v}" aria-selected="${!i}">${TAB_ICON[v]}<span class="hm-lbl">${l}</span></button>`).join("")}</div>`,
      '<button class="hm-btn hm-icon" id="btnLogin" type="button" title="Entrar para editar" aria-label="Entrar para editar" style="display:none"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg></button>'
    ].join(""), false),
    group("overview", hmBtnHTML({ id: "overviewBack", label: "Início", icon: HM_ICON.home, title: "Voltar à tela inicial" })),
    group("import", hmBtnHTML({ id: "importBack", label: "Visão Geral", icon: HM_ICON.back, title: "Voltar à Visão Geral" })),
    group("admin", hmBtnHTML({ id: "adminBack", label: "Início", icon: HM_ICON.home, title: "Voltar à tela inicial" }))
  ].join("\n      ");
  return hmBarHTML({ assets: "./", home: "./", nav, navLabel: "Navegação de Vistorias" });
}
