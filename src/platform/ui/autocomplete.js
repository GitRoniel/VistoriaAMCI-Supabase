// Sugestões enquanto digita (até 15), ordenadas por relevância e ignorando acentos.
import { esc, normText, rankMatch, highlight } from "../core/utils.js";

/**
 * @param {HTMLInputElement} input  dentro de um elemento com position:relative
 * @param {{getItems:()=>string[], onPick:(value:string)=>void, limit?:number}} o
 */
export function attachAutocomplete(input, o) {
  const host = input.parentElement;
  let box = null, items = [], sel = -1;
  const close = () => { box?.remove(); box = null; sel = -1; };
  const render = () => {
    // Todas as palavras digitadas precisam aparecer (em qualquer ordem), como na busca da tabela.
    const words = normText(input.value.trim()).split(/\s+/).filter(Boolean);
    if (!words.length) return close();
    items = o.getItems().filter((n) => { const t = normText(n); return words.every((w) => t.includes(w)); })
      .sort((a, b) => rankMatch(a, words[0]) - rankMatch(b, words[0]) || a.localeCompare(b, "pt-BR"))
      .slice(0, o.limit || 15);
    if (!items.length) return close();
    if (!box) { box = document.createElement("div"); box.className = "ac-box"; box.setAttribute("role", "listbox"); host.appendChild(box); }
    box.innerHTML = items.map((n, i) => `<div class="ac-item${i === sel ? " sel" : ""}" role="option" data-i="${i}">${highlight(n, words)}</div>`).join("");
  };
  const pick = (i) => { const v = items[i]; if (v == null) return; input.value = v; close(); o.onPick(v); };

  input.setAttribute("autocomplete", "off");
  input.addEventListener("input", () => { sel = -1; render(); });
  input.addEventListener("keydown", (e) => {
    if (!box) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); sel = (sel + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length; render(); }
    else if (e.key === "Enter" && sel >= 0) { e.preventDefault(); pick(sel); }
    else if (e.key === "Escape") { e.preventDefault(); close(); }
  });
  input.addEventListener("blur", () => setTimeout(close, 150));
  host.addEventListener("mousedown", (e) => { const it = e.target.closest(".ac-item"); if (it) { e.preventDefault(); pick(+it.dataset.i); } });
  return { close };
}

export { esc };
