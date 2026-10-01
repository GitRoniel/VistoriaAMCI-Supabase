// Seleção múltipla com busca, "Marcar todos" e "Limpar" (ex.: obras, pedidos).
// O componente não conhece regras de negócio: recebe as opções e devolve as chaves marcadas.
import { esc, normText } from "../core/utils.js";

/**
 * @param {HTMLElement} root  elemento .ms (contém um botão .ms-btn)
 * @param {{placeholder:string, allLabel:string, searchPlaceholder:string,
 *          getOptions:()=>Array<{key:string,label:string,tag?:string,sub?:string,search?:string}>,
 *          getSelected:()=>Set<string>, onChange:(selected:Set<string>)=>void,
 *          summary?:(selected:Set<string>, total:number)=>string}} o
 */
export function createMultiSelect(root, o) {
  const btn = root.querySelector(".ms-btn");
  const label = btn.querySelector("span");
  let pop = null;

  const filtered = (q) => {
    const n = normText(q.trim());
    return o.getOptions().filter((opt) => !n || normText(opt.search || opt.label).includes(n));
  };
  const renderList = () => {
    if (!pop) return;
    const items = filtered(pop.querySelector("input").value), sel = o.getSelected();
    pop.querySelector(".ms-list").innerHTML = items.length
      ? items.map((opt) => `<label class="ms-item"><input type="checkbox" data-k="${esc(opt.key)}"${sel.has(opt.key) ? " checked" : ""}>${opt.tag ? `<span class="ms-tag">${esc(opt.tag)}</span>` : ""}<span class="ms-main">${esc(opt.label)}</span>${opt.sub ? `<span class="ms-sub">${esc(opt.sub)}</span>` : ""}</label>`).join("")
      : `<div class="ms-empty">Nada encontrado.</div>`;
  };
  const close = () => { pop?.remove(); pop = null; btn.setAttribute("aria-expanded", "false"); };
  const place = () => {
    if (!pop) return;
    const r = btn.getBoundingClientRect(), w = Math.min(Math.max(r.width, 300), window.innerWidth - 24);
    pop.style.width = w + "px";
    pop.style.left = Math.max(12, Math.min(r.left, window.innerWidth - w - 12)) + "px";
    const below = window.innerHeight - r.bottom;
    pop.style.top = (below < 300 && r.top > below ? Math.max(12, r.top - 4 - pop.offsetHeight) : r.bottom + 4) + "px";
  };
  const open = () => {
    pop = document.createElement("div");
    pop.className = "ms-pop";
    pop.setAttribute("role", "dialog");
    pop.innerHTML = `<div class="ms-head"><input type="search" placeholder="${esc(o.searchPlaceholder)}" aria-label="${esc(o.searchPlaceholder)}"></div>
      <div class="ms-acts"><button type="button" data-ms="all">Marcar todos</button><button type="button" data-ms="none">Limpar</button></div>
      <div class="ms-list" role="listbox" aria-multiselectable="true"></div>`;
    document.body.appendChild(pop);
    renderList(); place();
    btn.setAttribute("aria-expanded", "true");
    pop.querySelector("input").addEventListener("input", renderList);
    pop.addEventListener("change", (e) => {
      const k = e.target.dataset.k; if (k == null) return;
      const sel = new Set(o.getSelected());
      e.target.checked ? sel.add(k) : sel.delete(k);
      o.onChange(sel); update();
    });
    pop.addEventListener("click", (e) => {
      const a = e.target.closest("[data-ms]")?.dataset.ms; if (!a) return;
      const sel = new Set(o.getSelected());
      if (a === "all") filtered(pop.querySelector("input").value).forEach((opt) => sel.add(opt.key));
      else sel.clear();
      o.onChange(sel); renderList(); update();
    });
    setTimeout(() => pop?.querySelector("input")?.focus(), 30);
  };
  const update = () => {
    const sel = o.getSelected(), total = o.getOptions().length;
    label.textContent = o.summary ? o.summary(sel, total) : !sel.size ? o.allLabel : sel.size === 1 ? [...sel][0] : `${sel.size} selecionados`;
    root.classList.toggle("on", sel.size > 0);
  };

  btn.setAttribute("aria-haspopup", "dialog");
  btn.setAttribute("aria-expanded", "false");
  btn.addEventListener("click", (e) => { e.stopPropagation(); pop ? close() : open(); });
  document.addEventListener("click", (e) => { if (pop && !pop.contains(e.target) && !root.contains(e.target)) close(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && pop) { close(); btn.focus(); } });
  window.addEventListener("resize", () => pop && place());
  window.addEventListener("scroll", (e) => { if (pop && !pop.contains(e.target)) close(); }, true);
  update();
  return { update, refresh: () => { renderList(); update(); }, close };
}
