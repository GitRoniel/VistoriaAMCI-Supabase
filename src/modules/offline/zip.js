// Gerador de arquivo .zip simples (sem compressão — PDFs já são comprimidos — e sem dependências), usado para
// baixar os relatórios no computador. Nomes em UTF-8 (acentos), datas no formato do DOS. Puro: roda no navegador e
// nos testes (scripts/test-offline.mjs). Limites do formato clássico respeitados por quem chama: cada .zip abaixo
// de 4 GB e de 65.535 arquivos (a Central divide em partes bem menores).

const TAB = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
/** CRC-32 (o mesmo do zip/png). */
export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = TAB[(c ^ bytes[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function dosDataHora(d) {
  const ano = Math.max(1980, d.getFullYear());
  return {
    hora: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    data: ((ano - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()
  };
}
const enc = new TextEncoder();

/**
 * Monta o .zip. @param arquivos [{ nome: "Pasta/arquivo.pdf", bytes: Uint8Array|ArrayBuffer, data?: Date }]
 * @returns lista de pedaços (Uint8Array) — pronto para `new Blob(pedacos, { type: "application/zip" })`, sem copiar
 *          os PDFs de novo para um único buffer.
 */
export function montarZip(arquivos, agora = new Date()) {
  const pedacos = [], central = [];
  let pos = 0;
  for (const a of arquivos) {
    const dados = a.bytes instanceof Uint8Array ? a.bytes : new Uint8Array(a.bytes);
    const nome = enc.encode(a.nome), crc = crc32(dados), { hora, data } = dosDataHora(a.data || agora);
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, 0, true);
    lh.setUint16(10, hora, true); lh.setUint16(12, data, true); lh.setUint32(14, crc, true);
    lh.setUint32(18, dados.length, true); lh.setUint32(22, dados.length, true); lh.setUint16(26, nome.length, true); lh.setUint16(28, 0, true);
    pedacos.push(new Uint8Array(lh.buffer), nome, dados);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true); ch.setUint16(10, 0, true);
    ch.setUint16(12, hora, true); ch.setUint16(14, data, true); ch.setUint32(16, crc, true);
    ch.setUint32(20, dados.length, true); ch.setUint32(24, dados.length, true); ch.setUint16(28, nome.length, true);
    ch.setUint16(30, 0, true); ch.setUint16(32, 0, true); ch.setUint16(34, 0, true); ch.setUint16(36, 0, true); ch.setUint32(38, 0, true);
    ch.setUint32(42, pos, true);
    central.push(new Uint8Array(ch.buffer), nome);
    pos += 30 + nome.length + dados.length;
  }
  const tamCentral = central.reduce((s, p) => s + p.length, 0);
  const fim = new DataView(new ArrayBuffer(22));
  fim.setUint32(0, 0x06054b50, true); fim.setUint16(4, 0, true); fim.setUint16(6, 0, true);
  fim.setUint16(8, arquivos.length, true); fim.setUint16(10, arquivos.length, true);
  fim.setUint32(12, tamCentral, true); fim.setUint32(16, pos, true); fim.setUint16(20, 0, true);
  return [...pedacos, ...central, new Uint8Array(fim.buffer)];
}

/** Lê de volta um .zip sem compressão (usado nos testes para conferir o que foi gerado). */
export function lerZip(buf) {
  const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf), v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let e = b.length - 22; while (e >= 0 && v.getUint32(e, true) !== 0x06054b50) e--;
  if (e < 0) throw new Error("zip inválido");
  const n = v.getUint16(e + 10, true); let p = v.getUint32(e + 16, true); const out = [];
  const dec = new TextDecoder();
  for (let i = 0; i < n; i++) {
    if (v.getUint32(p, true) !== 0x02014b50) throw new Error("diretório do zip inválido");
    const crc = v.getUint32(p + 16, true), tam = v.getUint32(p + 20, true), ln = v.getUint16(p + 28, true), lx = v.getUint16(p + 30, true), lc = v.getUint16(p + 32, true), off = v.getUint32(p + 42, true);
    const nome = dec.decode(b.subarray(p + 46, p + 46 + ln));
    const ini = off + 30 + v.getUint16(off + 26, true) + v.getUint16(off + 28, true);
    const bytes = b.subarray(ini, ini + tam);
    out.push({ nome, bytes, crcOk: crc32(bytes) === crc });
    p += 46 + ln + lx + lc;
  }
  return out;
}
