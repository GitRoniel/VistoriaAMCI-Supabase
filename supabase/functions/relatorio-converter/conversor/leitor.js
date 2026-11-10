// Leitor de PDF (sem renderizar): texto com posição e fotografias com a área que ocupam na página.
// Usado pelo conversor dos relatórios do Mobuss. Puro JavaScript; a biblioteca pdf-lib é injetada (Node nos
// testes, Deno na Edge Function). Interpreta o conteúdo de cada página (operadores de texto e imagem),
// decodifica as fontes pela tabela ToUnicode (Identity-H, 2 bytes) ou WinAnsi (fontes simples) e devolve as
// imagens JPEG como bytes originais (sem recodificar: mesma qualidade, pouco processamento).
//
//   paginas: [{ numero, largura, altura, itens: [{ str, x, y, w, tam }], imagens: [{ id, x, y, w, h, pw, ph, ref, filtro }] }]
//   (x/y em pontos, y cresce para cima, como no PDF; imagem: canto inferior esquerdo + largura/altura desenhadas)

const WINANSI = { 128: "€", 130: "‚", 131: "ƒ", 132: "„", 133: "…", 134: "†", 135: "‡", 136: "ˆ", 137: "‰", 138: "Š", 139: "‹", 140: "Œ", 142: "Ž",
  145: "‘", 146: "’", 147: "“", 148: "”", 149: "•", 150: "–", 151: "—", 152: "˜", 153: "™", 154: "š", 155: "›", 156: "œ", 158: "ž", 159: "Ÿ" };

/* ── tokenizador do conteúdo da página ── */
const BRANCO = new Set([0, 9, 10, 12, 13, 32]), DELIM = new Set([40, 41, 60, 62, 91, 93, 123, 125, 47, 37]);
function* tokens(b) {
  let i = 0;
  const n = b.length;
  while (i < n) {
    const c = b[i];
    if (BRANCO.has(c)) { i++; continue; }
    if (c === 37) { while (i < n && b[i] !== 10 && b[i] !== 13) i++; continue; }            // comentário
    if (c === 40) {                                                                       // (string literal)
      const out = []; let nivel = 1; i++;
      while (i < n && nivel > 0) {
        let ch = b[i++];
        if (ch === 92) {
          const e = b[i++];
          if (e === 110) out.push(10); else if (e === 114) out.push(13); else if (e === 116) out.push(9);
          else if (e === 98) out.push(8); else if (e === 102) out.push(12);
          else if (e === 10) { /* continuação */ } else if (e === 13) { if (b[i] === 10) i++; }
          else if (e >= 48 && e <= 55) { let v = e - 48; for (let k = 0; k < 2 && b[i] >= 48 && b[i] <= 55; k++) v = v * 8 + (b[i++] - 48); out.push(v & 255); }
          else out.push(e);
          continue;
        }
        if (ch === 40) nivel++; else if (ch === 41) { nivel--; if (!nivel) break; }
        out.push(ch);
      }
      yield { t: "s", v: Uint8Array.from(out) }; continue;
    }
    if (c === 60 && b[i + 1] === 60) { i += 2; yield { t: "op", v: "<<" }; continue; }
    if (c === 62 && b[i + 1] === 62) { i += 2; yield { t: "op", v: ">>" }; continue; }
    if (c === 60) {                                                                       // <hex>
      let j = i + 1, h = "";
      while (j < n && b[j] !== 62) { if (!BRANCO.has(b[j])) h += String.fromCharCode(b[j]); j++; }
      i = j + 1; if (h.length % 2) h += "0";
      const out = new Uint8Array(h.length / 2); for (let k = 0; k < out.length; k++) out[k] = parseInt(h.substr(k * 2, 2), 16);
      yield { t: "s", v: out }; continue;
    }
    if (c === 91) { i++; yield { t: "[" }; continue; }
    if (c === 93) { i++; yield { t: "]" }; continue; }
    if (c === 47) {                                                                       // /Nome
      let j = i + 1; while (j < n && !BRANCO.has(b[j]) && !DELIM.has(b[j])) j++;
      yield { t: "n", v: String.fromCharCode(...b.subarray(i + 1, j)).replace(/#([0-9a-f]{2})/gi, (_, x) => String.fromCharCode(parseInt(x, 16))) }; i = j; continue;
    }
    let j = i; while (j < n && !BRANCO.has(b[j]) && !DELIM.has(b[j])) j++;
    if (j === i) { i++; continue; }
    const s = String.fromCharCode(...b.subarray(i, j)); i = j;
    if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(s)) { yield { t: "num", v: Number(s) }; continue; }
    if (s === "BI") {                                                                     // imagem embutida: pula até EI
      while (i < n - 2 && !(BRANCO.has(b[i]) && b[i + 1] === 69 && b[i + 2] === 73 && (i + 3 >= n || BRANCO.has(b[i + 3])))) i++;
      i += 3; continue;
    }
    yield { t: "op", v: s };
  }
}

/* ── fontes: ToUnicode (bfchar/bfrange) ou WinAnsi ── */
function lerCMap(txt) {
  const mapa = new Map(); let bytes = 1;
  const hex = (h) => parseInt(h, 16);
  const uni = (h) => { if (!h) return ""; let s = ""; for (let k = 0; k + 4 <= h.length; k += 4) s += String.fromCharCode(parseInt(h.substr(k, 4), 16)); return s || String.fromCharCode(hex(h)); };
  const cs = /begincodespacerange\s*<([0-9a-fA-F]+)>/.exec(txt); if (cs) bytes = cs[1].length / 2;
  for (const bloco of txt.matchAll(/beginbfchar([\s\S]*?)endbfchar/g))
    for (const m of bloco[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g)) { mapa.set(hex(m[1]), uni(m[2])); bytes = Math.max(bytes, m[1].length / 2); }
  for (const bloco of txt.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const m of bloco[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*(<[0-9a-fA-F]+>|\[[^\]]*\])/g)) {
      const lo = hex(m[1]), hi = hex(m[2]); bytes = Math.max(bytes, m[1].length / 2);
      if (m[3].startsWith("[")) { const arr = [...m[3].matchAll(/<([0-9a-fA-F]+)>/g)]; for (let k = lo; k <= hi && k - lo < arr.length; k++) mapa.set(k, uni(arr[k - lo][1])); }
      else { const base = m[3].slice(1, -1); const ini = parseInt(base.slice(-4), 16), pre = uni(base.slice(0, -4)); for (let k = lo; k <= hi; k++) mapa.set(k, pre + String.fromCharCode(ini + (k - lo))); }
    }
  }
  return { mapa, bytes };
}

export function criarLeitor(PDFLib) {
  const { PDFDocument, PDFName, PDFDict, PDFArray, PDFRawStream, PDFRef, decodePDFRawStream } = PDFLib;
  const N = (s) => PDFName.of(s);
  const bytesDe = (stream) => { try { return decodePDFRawStream(stream).decode(); } catch { return new Uint8Array(0); } };
  const latin = (u8) => { let s = ""; for (const c of u8) s += String.fromCharCode(c); return s; };

  return async function ler(dados) {
    const doc = await PDFDocument.load(dados, { updateMetadata: false, ignoreEncryption: true });
    const ctx = doc.context, cacheFonte = new Map();
    const fonte = (ref) => {
      const chave = ref instanceof PDFRef ? ref.toString() : ref;
      if (cacheFonte.has(chave)) return cacheFonte.get(chave);
      const d = ctx.lookup(ref, PDFDict);
      let f = { bytes: 1, mapa: null };
      const tu = d.get(N("ToUnicode"));
      if (tu) { const s = ctx.lookup(tu); if (s instanceof PDFRawStream) f = lerCMap(latin(bytesDe(s))); }
      else if (String(d.get(N("Subtype"))) === "/Type0") f = { bytes: 2, mapa: null };
      cacheFonte.set(chave, f); return f;
    };
    const texto = (f, u8) => {
      let s = "";
      if (f.bytes === 2) { for (let k = 0; k + 1 < u8.length; k += 2) { const cod = (u8[k] << 8) | u8[k + 1]; s += f.mapa?.get(cod) ?? ""; } return s; }
      for (const c of u8) s += f.mapa?.get(c) ?? WINANSI[c] ?? String.fromCharCode(c);
      return s;
    };
    const mul = (m, n) => [m[0] * n[0] + m[1] * n[2], m[0] * n[1] + m[1] * n[3], m[2] * n[0] + m[3] * n[2], m[2] * n[1] + m[3] * n[3], m[4] * n[0] + m[5] * n[2] + n[4], m[4] * n[1] + m[5] * n[3] + n[5]];

    const paginas = [];
    let idImg = 0;
    doc.getPages().forEach((pg, pi) => {
      const { width, height } = pg.getSize();
      const itens = [], imagens = [];
      const percorrer = (conteudo, recursos, ctmBase, profundidade) => {
        const fontes = recursos?.lookupMaybe?.(N("Font"), PDFDict), xobj = recursos?.lookupMaybe?.(N("XObject"), PDFDict);
        let ctm = ctmBase, pilha = [], tm = [1, 0, 0, 1, 0, 0], tlm = [1, 0, 0, 1, 0, 0], f = { bytes: 1, mapa: null }, tam = 10, lead = 0;
        let ops = [];
        const emitir = (u8) => {
          const s = texto(f, u8); if (!s) return;
          const m = mul(tm, ctm), escala = Math.hypot(m[0], m[1]) || 1;
          itens.push({ str: s, x: m[4], y: m[5], w: s.length * tam * escala * 0.5, tam: tam * escala });
          tm = [tm[0], tm[1], tm[2], tm[3], tm[4] + s.length * tam * 0.5 * tm[0], tm[5]];
        };
        for (const tk of tokens(conteudo)) {
          if (tk.t !== "op") { ops.push(tk); continue; }
          const op = tk.v, a = ops; ops = [];
          const num = (k) => a[a.length - k]?.v;
          switch (op) {
            case "q": pilha.push(ctm); break;
            case "Q": ctm = pilha.pop() || ctmBase; break;
            case "cm": ctm = mul([num(6), num(5), num(4), num(3), num(2), num(1)], ctm); break;
            case "BT": tm = [1, 0, 0, 1, 0, 0]; tlm = tm; break;
            case "Tm": tm = tlm = [num(6), num(5), num(4), num(3), num(2), num(1)]; break;
            case "Td": tm = tlm = mul([1, 0, 0, 1, num(2), num(1)], tlm); break;
            case "TD": lead = -num(1); tm = tlm = mul([1, 0, 0, 1, num(2), num(1)], tlm); break;
            case "TL": lead = num(1); break;
            case "T*": tm = tlm = mul([1, 0, 0, 1, 0, -lead], tlm); break;
            case "Tf": { tam = num(1) || tam; const nome = a[a.length - 2]?.v; const r = nome && fontes?.get(N(nome)); f = r ? fonte(r) : { bytes: 1, mapa: null }; break; }
            case "Tj": if (a.at(-1)?.t === "s") emitir(a.at(-1).v); break;
            case "'": tm = tlm = mul([1, 0, 0, 1, 0, -lead], tlm); if (a.at(-1)?.t === "s") emitir(a.at(-1).v); break;
            case '"': tm = tlm = mul([1, 0, 0, 1, 0, -lead], tlm); if (a.at(-1)?.t === "s") emitir(a.at(-1).v); break;
            case "TJ": {
              const ini = a.findLastIndex((x) => x.t === "["); const partes = ini >= 0 ? a.slice(ini + 1) : [];
              const u = []; for (const p of partes) if (p.t === "s") u.push(...p.v);
              if (u.length) emitir(Uint8Array.from(u)); break;
            }
            case "Do": {
              const nome = a.at(-1)?.v, r = nome && xobj?.get(N(nome)); if (!r) break;
              const x = ctx.lookup(r); if (!(x instanceof PDFRawStream)) break;
              const sub = String(x.dict.get(N("Subtype")));
              if (sub === "/Image") {
                const filtro = String(x.dict.get(N("Filter")) || "");
                imagens.push({ id: ++idImg, x: Math.min(ctm[4], ctm[4] + ctm[0]), y: Math.min(ctm[5], ctm[5] + ctm[3]), w: Math.abs(ctm[0]), h: Math.abs(ctm[3]),
                  pw: x.dict.get(N("Width"))?.asNumber?.() ?? 0, ph: x.dict.get(N("Height"))?.asNumber?.() ?? 0, ref: r, filtro });
              } else if (sub === "/Form" && profundidade < 4) {
                const mat = x.dict.lookupMaybe?.(N("Matrix"), PDFArray)?.asArray().map((v) => v.asNumber()) || [1, 0, 0, 1, 0, 0];
                percorrer(bytesDe(x), x.dict.lookupMaybe?.(N("Resources"), PDFDict) || recursos, mul(mat, ctm), profundidade + 1);
              }
              break;
            }
            default: break;
          }
        }
      };
      const cont = pg.node.Contents();
      const partes = !cont ? [] : cont instanceof PDFRawStream ? [cont] : cont.asArray().map((r) => ctx.lookup(r));
      const juntos = []; for (const s of partes) { const u = bytesDe(s); juntos.push(...u, 10); }
      percorrer(Uint8Array.from(juntos), pg.node.Resources(), [1, 0, 0, 1, 0, 0], 0);
      paginas.push({ numero: pi + 1, largura: width, altura: height, itens, imagens });
    });
    /** Bytes originais da foto (JPEG: DCTDecode), para incorporar no PDF novo sem recodificar. */
    const fotoBytes = (img) => { const s = ctx.lookup(img.ref); return s instanceof PDFRawStream ? s.contents : null; };
    return { paginas, fotoBytes, documento: doc, totalPaginas: paginas.length };
  };
}
