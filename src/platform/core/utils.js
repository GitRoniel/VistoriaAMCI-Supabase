// Utilitários sem dependência de tela (podem ser usados por qualquer módulo e nos testes).

const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
/** Escapa texto para HTML. */
export const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ESC[c]);

/** Minúsculas sem acento (buscas que ignoram acentuação). */
export const normText = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

/** dd/mm/aa a partir de "aaaa-mm-dd" (ou "aaaa-mm-ddThh:mm"). */
export function fmtDateShort(iso) {
  if (!iso) return "—";
  const [y, m, d] = String(iso).slice(0, 10).split("-");
  return d && m && y ? `${d}/${m}/${y.slice(2)}` : "—";
}

/** dd/mm/aaaa hh:mm a partir de um timestamp. */
export function fmtDateTime(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

const NUM = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 3 });
/** Número em formato brasileiro, sem casas desnecessárias. */
export const fmtNum = (n) => (n == null || Number.isNaN(Number(n)) ? "—" : NUM.format(Number(n)));

/** Executa fn após `ms` sem novas chamadas. */
export function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

/** Ordenação por relevância da busca: começa com o termo, palavra começa com o termo, contém. */
export function rankMatch(name, q) {
  const n = normText(name);
  if (n.startsWith(q)) return 0;
  const escRe = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (new RegExp("(^|[^a-z0-9])" + escRe).test(n)) return 1;
  return 2;
}

/** Destaca os termos (sem acento) no texto original, preservando acentos. Retorna HTML. */
export function highlight(text, words) {
  const raw = String(text || "");
  if (!words?.length) return esc(raw);
  const norm = normText(raw);
  const marks = new Array(raw.length).fill(false);
  words.forEach((w) => {
    if (!w) return;
    for (let i = norm.indexOf(w); i !== -1; i = norm.indexOf(w, i + w.length)) for (let k = i; k < i + w.length; k++) marks[k] = true;
  });
  let out = "", open = false;
  for (let i = 0; i < raw.length; i++) {
    if (marks[i] && !open) { out += '<mark class="kw">'; open = true; }
    if (!marks[i] && open) { out += "</mark>"; open = false; }
    out += esc(raw[i]);
  }
  return open ? out + "</mark>" : out;
}
