// Visualizador de PDF com rolagem vertical contínua (todas as páginas uma abaixo da outra), usado na tela do
// relatório da revistoria. Só as páginas perto da área visível são desenhadas (IntersectionObserver); as que se
// afastam têm o canvas descartado, para documentos longos não pesarem no celular. Zoom mantém a posição de leitura.

const ZOOM_MIN = 0.5, ZOOM_MAX = 4, MANTER = 3;   // páginas desenhadas além das visíveis (para cima e para baixo)

/**
 * @param {HTMLElement} caixa  elemento rolável que recebe as páginas
 * @param {{ aoMudar?: (estado: { pagina: number, total: number, zoom: number }) => void }} [op]
 */
export function criarVisualizador(caixa, { aoMudar = () => {} } = {}) {
  let doc = null, paginas = [], zoom = 1, obs = null, destruido = false, base = null;
  const visiveis = new Set();
  const avisar = () => aoMudar({ pagina: paginaAtual(), total: paginas.length, zoom });

  function largura() { return Math.max(260, caixa.clientWidth - 16); }
  function dimensionar(p) {
    const vp = p.vp || base; if (!vp) return;
    const esc = (largura() / vp.width) * zoom;
    p.esc = esc;
    p.el.style.width = Math.floor(vp.width * esc) + "px";
    p.el.style.height = Math.floor(vp.height * esc) + "px";
  }
  async function desenhar(p) {
    if (p.desenhada === zoom && p.el.querySelector("canvas")) return;
    p.tarefa?.cancel?.();
    try {
      const page = p.page || (p.page = await doc.getPage(p.n));
      if (destruido) return;
      if (!p.vp) { p.vp = page.getViewport({ scale: 1 }); dimensionar(p); }
      const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
      // limite de pixels por página (memória do celular)
      const alvo = p.esc * dpr, maxPx = 16e6, px = p.vp.width * p.vp.height * alvo * alvo;
      const escala = px > maxPx ? alvo * Math.sqrt(maxPx / px) : alvo;
      const vp = page.getViewport({ scale: escala });
      const cv = document.createElement("canvas");
      cv.width = Math.floor(vp.width); cv.height = Math.floor(vp.height);
      const z = zoom;
      p.tarefa = page.render({ canvasContext: cv.getContext("2d"), viewport: vp });
      await p.tarefa.promise; p.tarefa = null;
      if (destruido || z !== zoom || !visiveis.has(p.n) && !perto(p.n)) return;
      p.el.querySelector("canvas")?.remove();
      p.el.appendChild(cv); p.el.classList.add("ok"); p.desenhada = z;
    } catch (err) { if (err?.name !== "RenderingCancelledException") { console.error(err); p.el.classList.add("erro"); } }
  }
  function descartar(p) { p.tarefa?.cancel?.(); p.tarefa = null; p.el.querySelector("canvas")?.remove(); p.el.classList.remove("ok"); p.desenhada = 0; }
  const perto = (n) => { if (!visiveis.size) return n <= 2; const v = [...visiveis]; return n >= Math.min(...v) - MANTER && n <= Math.max(...v) + MANTER; };
  function atualizar() {
    for (const p of paginas) { if (perto(p.n)) desenhar(p); else if (p.desenhada) descartar(p); }
    avisar();
  }
  function paginaAtual() {
    if (!paginas.length) return 0;
    if (caixa.scrollTop > 0 && caixa.scrollTop + caixa.clientHeight >= caixa.scrollHeight - 2) return paginas.length;   // fim do documento
    const topo = caixa.getBoundingClientRect().top + 40;
    let atual = 1;
    for (const p of paginas) { if (p.el.getBoundingClientRect().top <= topo) atual = p.n; else break; }
    return atual;
  }

  async function abrir(lib, fonte) {
    fechar();
    destruido = false;
    caixa.innerHTML = `<div class="vz-msg"><div class="ch-spin" aria-hidden="true"></div><b>Abrindo o PDF…</b></div>`;
    const tarefa = lib.getDocument({ ...fonte, isEvalSupported: false });
    const d = await tarefa.promise;
    if (destruido) { d.destroy(); return null; }
    doc = d;
    const p1 = await doc.getPage(1); base = p1.getViewport({ scale: 1 });
    caixa.innerHTML = "";
    const lista = document.createElement("div"); lista.className = "vz-pags";
    paginas = Array.from({ length: doc.numPages }, (_, i) => {
      const el = document.createElement("div"); el.className = "vz-pag"; el.dataset.n = String(i + 1);
      el.setAttribute("aria-label", `Página ${i + 1} de ${doc.numPages}`); el.setAttribute("role", "img");
      lista.appendChild(el);
      const p = { n: i + 1, el, page: i === 0 ? p1 : null, vp: i === 0 ? base : null, desenhada: 0, tarefa: null, esc: 1 };
      dimensionar(p); return p;
    });
    caixa.appendChild(lista);
    obs = new IntersectionObserver((ents) => {
      for (const e of ents) { const n = Number(e.target.dataset.n); if (e.isIntersecting) visiveis.add(n); else visiveis.delete(n); }
      atualizar();
    }, { root: caixa, rootMargin: "600px 0px" });
    paginas.forEach((p) => obs.observe(p.el));
    caixa.addEventListener("scroll", avisar, { passive: true });
    avisar();
    return doc;
  }
  function definirZoom(z) {
    if (!paginas.length) return;
    const novo = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, +z.toFixed(2)));
    if (novo === zoom) return;
    const rel = caixa.scrollHeight ? caixa.scrollTop / caixa.scrollHeight : 0, relX = caixa.scrollWidth ? (caixa.scrollLeft + caixa.clientWidth / 2) / caixa.scrollWidth : 0.5;
    zoom = novo;
    for (const p of paginas) { dimensionar(p); if (p.desenhada) p.desenhada = -1; }
    caixa.scrollTop = rel * caixa.scrollHeight;
    caixa.scrollLeft = Math.max(0, relX * caixa.scrollWidth - caixa.clientWidth / 2);
    atualizar();
  }
  let timerLarg = null;
  const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => {
    clearTimeout(timerLarg);
    timerLarg = setTimeout(() => { if (!paginas.length) return; for (const p of paginas) { dimensionar(p); if (p.desenhada) p.desenhada = -1; } atualizar(); }, 150);
  }) : null;
  ro?.observe(caixa);
  function irPara(n) { const p = paginas[n - 1]; if (p) caixa.scrollTop += p.el.getBoundingClientRect().top - caixa.getBoundingClientRect().top - 8; }
  function fechar() {
    destruido = true;
    obs?.disconnect(); obs = null; visiveis.clear();
    caixa.removeEventListener("scroll", avisar);
    for (const p of paginas) p.tarefa?.cancel?.();
    paginas = []; base = null;
    try { doc?.destroy?.(); } catch { /* já fechado */ }
    doc = null;
  }
  return {
    abrir, fechar, irPara,
    destruir() { fechar(); ro?.disconnect(); },
    mais() { definirZoom(zoom + 0.25); }, menos() { definirZoom(zoom - 0.25); }, ajustar() { definirZoom(1); },
    get zoom() { return zoom; }, get total() { return paginas.length; }, get doc() { return doc; }, pagina: paginaAtual,
  };
}
