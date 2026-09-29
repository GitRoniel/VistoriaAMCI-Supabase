// Gera o Modo Escuro a partir do CSS do Modo Claro (www/index.html).
//
// Cada regra com cor recebe uma cópia prefixada por :root[data-theme="dark"], na mesma ordem,
// então a cascata do tema escuro é idêntica à do claro. As cores são convertidas pelo papel
// da propriedade: fundos claros viram superfícies escuras, textos escuros viram claros e bordas
// claras viram bordas escuras. Cores saturadas de fundo (status, botões, cabeçalho) não mudam.
//
// Uso: node scripts/theme-dark.mjs          (atualiza o bloco gerado em www/index.html)
//      node scripts/theme-dark.mjs --check  (falha se o bloco estiver desatualizado)
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const BEGIN = "/* TEMA ESCURO · gerado por scripts/theme-dark.mjs (não editar à mão) */";
const END = "/* /TEMA ESCURO */";
const DARK = ':root[data-theme="dark"]';

const COLOR_PROPS = new Set([
  "color", "background", "background-color", "background-image",
  "border", "border-color", "border-top", "border-right", "border-bottom", "border-left",
  "border-top-color", "border-right-color", "border-bottom-color", "border-left-color",
  "outline", "outline-color", "box-shadow", "text-shadow", "fill", "stroke", "caret-color",
  "text-decoration-color", "-webkit-text-fill-color",
]);

/* ── cores ── */
const NAMED = { white: [255, 255, 255, 1], black: [0, 0, 0, 1] };
function parseColor(tok) {
  const t = tok.toLowerCase();
  if (NAMED[t]) return NAMED[t];
  let m = t.match(/^#([0-9a-f]{3,8})$/);
  if (m) {
    let h = m[1];
    if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join("");
    const n = (i) => parseInt(h.slice(i, i + 2), 16);
    return [n(0), n(2), n(4), h.length === 8 ? n(6) / 255 : 1];
  }
  m = t.match(/^rgba?\(([^)]*)\)$/);
  if (m) {
    const p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
    return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1];
  }
  return null;
}
function toHsl([r, g, b]) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
  if (mx === mn) return [0, 0, l];
  const d = mx - mn, s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  const h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}
function fromHsl(h, s, l) {
  const k = (n) => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0), f(8), f(4)].map((v) => Math.round(v * 255));
}
function fmt([r, g, b], a) {
  if (a >= 1) return "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("");
  return `rgba(${r},${g},${b},${+a.toFixed(3)})`;
}
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

// Fundo claro → superfície escura (quanto mais clara a original, mais "elevada" a escura).
function surface(c) {
  const [h, s, l] = toHsl(c);
  // Preenchimentos vivos (indicadores, status) continuam iguais; só tons claros/neutros escurecem.
  if (l <= 0.6 || (l < 0.85 && s >= 0.45)) return null;
  // Quase brancos viram superfícies (branco = card); cinzas médios (trilhas, "sem agendamento") viram cinza visível.
  const dl = l >= 0.88 ? 0.155 - (1 - l) * 0.42 : 0.155 + (0.88 - l) * 0.9;
  return fromHsl(h, Math.min(s, 0.5) * 0.45, clamp(dl, 0.1, 0.34));
}
function border(c) {
  const [h, s, l] = toHsl(c);
  if (l <= 0.6) return null;
  return fromHsl(h, Math.min(s, 0.4) * 0.45, clamp(0.23 + (1 - l) * 0.35, 0.22, 0.34));
}
function text(c) {
  const [h, s, l] = toHsl(c);
  if (l >= 0.52 || (s > 0.3 && l >= 0.42)) return null; // dourado, laranja e verdes da marca
  return s > 0.45 ? fromHsl(h, s, Math.max(l, 0.66)) : fromHsl(h, Math.min(s, 0.12), clamp(0.93 - l * 0.62, 0.62, 0.93));
}

function mapColor(tok, role) {
  const c = parseColor(tok);
  if (!c) return tok;
  const a = c[3];
  const [, , l] = toHsl(c);
  if (role === "shadow") {
    if (l < 0.5) return a === 0 ? tok : fmt([0, 0, 0], Math.min(0.6, a * 1.8));
    if (a >= 0.5) { const m = surface(c); return m ? fmt(m, a) : tok; }
    return tok;
  }
  // Brancos translúcidos são "vidro" sobre o cabeçalho escuro: continuam iguais.
  if (a < 0.6 && l > 0.6 && role !== "text") return tok;
  const m = role === "bg" ? surface(c) : role === "border" ? border(c) : text(c);
  return m ? fmt(m, a) : tok;
}

function roleOf(prop) {
  if (prop.startsWith("background")) return "bg";
  if (prop.startsWith("border") || prop.startsWith("outline")) return "border";
  if (prop === "box-shadow" || prop === "text-shadow") return "shadow";
  return "text";
}

const COLOR_RE = /#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)|\b(?:white|black)\b/g;
function mapValue(value, prop, vars) {
  const role = roleOf(prop);
  // var(--x) com cor conhecida é resolvida só quando a conversão muda o resultado.
  const resolved = value.replace(/var\((--[\w-]+)\)/g, (all, name) => {
    const v = vars.get(name);
    if (!v || !parseColor(v)) return all;
    const mapped = mapColor(v, role);
    return mapped === v ? all : mapped;
  });
  return resolved.replace(COLOR_RE, (tok) => mapColor(tok, role));
}

/* ── CSS ── */
function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}
function parseBlocks(css) {
  const out = [];
  let i = 0;
  while (i < css.length) {
    const open = css.indexOf("{", i);
    if (open < 0) break;
    const prelude = css.slice(i, open).trim();
    let depth = 1, j = open + 1;
    while (j < css.length && depth) {
      if (css[j] === "{") depth++;
      else if (css[j] === "}") depth--;
      j++;
    }
    const body = css.slice(open + 1, j - 1);
    if (prelude.startsWith("@media") || prelude.startsWith("@supports")) out.push({ at: prelude, children: parseBlocks(body) });
    else if (!prelude.startsWith("@")) out.push({ sel: prelude, decls: body });
    i = j;
  }
  return out;
}
function splitDecls(body) {
  const res = [];
  let depth = 0, cur = "";
  for (const ch of body) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === ";" && !depth) { res.push(cur); cur = ""; } else cur += ch;
  }
  res.push(cur);
  return res.map((d) => d.trim()).filter((d) => d.includes(":")).map((d) => {
    const k = d.indexOf(":");
    return [d.slice(0, k).trim().toLowerCase(), d.slice(k + 1).trim()];
  });
}
function prefix(sel) {
  return sel.split(/,(?![^(]*\))/).map((s) => {
    s = s.trim();
    if (/^:root\b/.test(s)) return s.replace(/^:root/, DARK);
    if (/^html\b/.test(s)) return s.replace(/^html/, 'html[data-theme="dark"]');
    return `${DARK} ${s}`;
  }).join(",");
}

function collectVars(blocks, vars = new Map()) {
  for (const b of blocks) {
    if (b.children) continue; // variáveis só nas regras :root de nível superior
    if (b.sel.trim() !== ":root") continue;
    for (const [p, v] of splitDecls(b.decls)) if (p.startsWith("--")) vars.set(p, v);
  }
  return vars;
}

function render(blocks, vars, indent = "") {
  let out = "";
  for (const b of blocks) {
    if (b.children) {
      const inner = render(b.children, vars, indent + "  ");
      if (inner) out += `${indent}${b.at}{\n${inner}${indent}}\n`;
      continue;
    }
    if (b.sel.includes("data-theme") || b.sel.trim() === ":root") continue;
    const decls = splitDecls(b.decls).filter(([p]) => COLOR_PROPS.has(p));
    if (!decls.length) continue;
    const body = decls.map(([p, v]) => `${p}:${mapValue(v, p, vars)}`).join(";");
    out += `${indent}${prefix(b.sel)}{${body}}\n`;
  }
  return out;
}

export function generate(html) {
  const start = html.indexOf("<style>") + 7, stop = html.indexOf("</style>", start);
  let css = html.slice(start, stop);
  const b = css.indexOf(BEGIN), e = css.indexOf(END);
  if (b >= 0 && e > b) css = css.slice(0, b) + css.slice(e + END.length);
  const blocks = parseBlocks(stripComments(css));
  return BEGIN + "\n" + render(blocks, collectVars(blocks)) + END;
}

export function inject(html) {
  const nl = html.includes("\r\n</style>") ? "\r\n" : "\n";
  const block = generate(html).replace(/\n/g, nl);
  const b = html.indexOf(BEGIN), e = html.indexOf(END);
  if (b >= 0 && e > b) return html.slice(0, b) + block + html.slice(e + END.length);
  const stop = html.indexOf("</style>");
  return html.slice(0, stop) + block + nl + html.slice(stop);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const file = resolve(import.meta.dirname, "..", "www/index.html");
  const html = await readFile(file, "utf8");
  const next = inject(html);
  if (process.argv.includes("--check")) {
    if (next !== html) {
      console.error("Tema escuro desatualizado: rode `node scripts/theme-dark.mjs`.");
      process.exit(1);
    }
  } else if (next !== html) {
    await writeFile(file, next, "utf8");
    console.log("Tema escuro atualizado em www/index.html.");
  }
}
