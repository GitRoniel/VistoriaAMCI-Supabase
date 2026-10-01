// Tema claro/escuro compartilhado com o site de Vistorias (mesma chave no localStorage).
const THEME_KEY = "amci-theme";

export const isDark = () => document.documentElement.dataset.theme === "dark";

function syncChrome() {
  const top = getComputedStyle(document.documentElement).getPropertyValue("--chrome-top").trim() || "#102a24";
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute("content", top));
  document.querySelectorAll("[data-theme-toggle]").forEach((b) => {
    b.setAttribute("aria-pressed", String(isDark()));
    b.title = isDark() ? "Usar tema claro" : "Usar tema escuro";
  });
}

export function setTheme(theme) {
  if (theme === "dark") document.documentElement.dataset.theme = "dark";
  else delete document.documentElement.dataset.theme;
  try { localStorage.setItem(THEME_KEY, theme); } catch { /* ignora */ }
  syncChrome();
}

/** Aplica o tema salvo e liga os botões [data-theme-toggle]. */
export function initTheme() {
  let saved = "";
  try { saved = localStorage.getItem(THEME_KEY) || ""; } catch { /* ignora */ }
  if (saved === "dark") document.documentElement.dataset.theme = "dark";
  document.addEventListener("click", (e) => {
    if (e.target.closest("[data-theme-toggle]")) setTheme(isDark() ? "light" : "dark");
  });
  syncChrome();
}
