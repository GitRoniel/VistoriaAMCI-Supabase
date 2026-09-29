// Leitor de planilhas para a importação de agendamentos (carregado só quando necessário).
//
// Suporta .xlsx (Office Open XML) e os ".xls" exportados por sistemas como tabela HTML ou
// XML do Excel 2003. O .xls binário antigo (BIFF) não é lido: o usuário recebe uma mensagem
// para salvar como .xlsx. Não usa bibliotecas com vulnerabilidades conhecidas: só fflate
// (descompactação) e o DOMParser do navegador.
//
// Resultado: [{ name, rows: [[valor, ...], ...] }]. Números com formato de data/hora
// chegam como { serial: número } para a camada de importação converter conforme a coluna.
import { unzipSync, strFromU8 } from "fflate";

const MAX_BYTES = 25 * 1024 * 1024;
const BUILTIN_DATE_FORMATS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 30, 36, 45, 46, 47, 50, 57]);

function xml(text) {
  const doc = new DOMParser().parseFromString(text, "application/xml");
  if (doc.getElementsByTagName("parsererror").length) throw new Error("Arquivo corrompido ou em formato inválido.");
  return doc;
}
const byTag = (node, tag) => Array.from(node.getElementsByTagNameNS("*", tag));
const first = (node, tag) => node.getElementsByTagNameNS("*", tag)[0] || null;

function colIndex(ref) {
  const letters = /^[A-Z]+/.exec(ref || "")?.[0] || "";
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function isDateFormat(code) {
  const clean = String(code || "").replace(/\[[^\]]*\]|"[^"]*"|\\./g, "");
  return /[dmyhs]/i.test(clean) && !/^[#0.,%\s]+$/.test(clean);
}

function readXlsx(bytes) {
  let files;
  try {
    files = unzipSync(bytes, { filter: (f) => /^xl\/(workbook\.xml|sharedStrings\.xml|styles\.xml|worksheets\/[^/]+\.xml|_rels\/workbook\.xml\.rels)$/.test(f.name) });
  } catch {
    throw new Error("Não foi possível abrir o arquivo .xlsx (arquivo corrompido?).");
  }
  const read = (name) => (files[name] ? strFromU8(files[name]) : null);

  const shared = [];
  const sst = read("xl/sharedStrings.xml");
  if (sst) for (const si of byTag(xml(sst), "si")) shared.push(byTag(si, "t").map((t) => t.textContent).join(""));

  const dateStyles = [];
  const styles = read("xl/styles.xml");
  if (styles) {
    const doc = xml(styles);
    const custom = new Map(byTag(doc, "numFmt").map((n) => [+n.getAttribute("numFmtId"), n.getAttribute("formatCode")]));
    const xfs = first(doc, "cellXfs");
    if (xfs) byTag(xfs, "xf").forEach((xf, i) => {
      const id = +xf.getAttribute("numFmtId");
      dateStyles[i] = BUILTIN_DATE_FORMATS.has(id) || (custom.has(id) && isDateFormat(custom.get(id)));
    });
  }

  const wb = xml(read("xl/workbook.xml") || "<x/>");
  const rels = xml(read("xl/_rels/workbook.xml.rels") || "<x/>");
  const target = new Map(byTag(rels, "Relationship").map((r) => [r.getAttribute("Id"), r.getAttribute("Target")]));
  const sheets = [];
  for (const s of byTag(wb, "sheet")) {
    const rid = s.getAttribute("r:id") || s.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id");
    let path = target.get(rid) || "";
    path = path.startsWith("/") ? path.slice(1) : "xl/" + path.replace(/^\.\//, "");
    const text = read(path);
    if (!text) continue;
    const rows = [];
    for (const row of byTag(xml(text), "row")) {
      const r = (+row.getAttribute("r") || rows.length + 1) - 1;
      const cells = [];
      for (const c of byTag(row, "c")) {
        const i = colIndex(c.getAttribute("r"));
        const t = c.getAttribute("t");
        const v = first(c, "v")?.textContent;
        let value = null;
        if (t === "s") value = shared[+v] ?? "";
        else if (t === "inlineStr") value = byTag(c, "t").map((x) => x.textContent).join("");
        else if (t === "str" || t === "e") value = v ?? "";
        else if (t === "b") value = v === "1";
        else if (v != null && v !== "") {
          const n = Number(v);
          value = dateStyles[+c.getAttribute("s") || 0] ? { serial: n } : n;
        }
        cells[i < 0 ? cells.length : i] = value;
      }
      rows[r] = cells;
    }
    sheets.push({ name: s.getAttribute("name") || "Planilha", rows: Array.from(rows, (r) => r || []) });
  }
  return sheets;
}

function readHtmlTable(text) {
  const doc = new DOMParser().parseFromString(text, "text/html");
  const tables = Array.from(doc.querySelectorAll("table"));
  if (!tables.length) throw new Error("Nenhuma tabela encontrada no arquivo.");
  return tables.map((table, i) => ({
    name: "Tabela " + (i + 1),
    rows: Array.from(table.rows, (tr) => Array.from(tr.cells, (td) => td.textContent.trim())),
  }));
}

function readSpreadsheetMl(text) {
  const doc = xml(text);
  return byTag(doc, "Worksheet").map((ws) => ({
    name: ws.getAttribute("ss:Name") || "Planilha",
    rows: byTag(ws, "Row").map((row) => {
      const cells = [];
      for (const cell of byTag(row, "Cell")) {
        const idx = +cell.getAttribute("ss:Index");
        if (idx) cells.length = idx - 1;
        const data = first(cell, "Data");
        cells.push(data ? data.textContent : null);
      }
      return cells;
    }),
  }));
}

export function readSpreadsheet(buffer) {
  const bytes = new Uint8Array(buffer);
  if (bytes.length > MAX_BYTES) throw new Error("Arquivo maior que 25 MB.");
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) return readXlsx(bytes);
  if (bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0) {
    throw new Error("Este .xls está no formato antigo do Excel 97-2003. Abra no Excel e use \"Salvar como\" → Pasta de Trabalho do Excel (.xlsx).");
  }
  const text = new TextDecoder("utf-8").decode(bytes.slice(0, Math.min(bytes.length, MAX_BYTES)));
  if (/<Workbook[\s>]/i.test(text) && /urn:schemas-microsoft-com:office:spreadsheet/i.test(text)) return readSpreadsheetMl(text);
  if (/<table[\s>]/i.test(text)) return readHtmlTable(text);
  throw new Error("Formato de arquivo não reconhecido. Envie uma planilha .xlsx.");
}

window.readSpreadsheet = readSpreadsheet;
