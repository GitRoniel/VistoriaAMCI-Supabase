import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

const root = resolve(import.meta.dirname, "..");
const inputDir = resolve(root, "data-import");
const dryRun = process.argv.includes("--dry-run");

function detectDelimiter(text) {
  const line = text.split(/\r?\n/, 1)[0] ?? "";
  let quoted = false;
  let commas = 0;
  let semicolons = 0;
  for (let i = 0; i < line.length; i += 1) {
    if (line[i] === '"') quoted = !quoted;
    if (!quoted && line[i] === ",") commas += 1;
    if (!quoted && line[i] === ";") semicolons += 1;
  }
  return semicolons > commas ? ";" : ",";
}

export function parseCsv(text) {
  const delimiter = detectDelimiter(text);
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (char === '"') {
      if (quoted && text[i + 1] === '"') {
        field += '"';
        i += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === delimiter && !quoted) {
      row.push(field);
      field = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && text[i + 1] === "\n") i += 1;
      row.push(field);
      if (row.some((value) => value !== "")) rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }

  row.push(field);
  if (row.some((value) => value !== "")) rows.push(row);
  if (!rows.length) return [];

  const headers = rows[0].map(normalizeHeader);
  return rows.slice(1).map((values) =>
    Object.fromEntries(headers.map((header, index) => [header, (values[index] ?? "").trim()])),
  );
}

function normalizeHeader(value) {
  return String(value ?? "")
    .replace(/^\uFEFF/, "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

function clean(value) {
  return String(value ?? "").trim();
}

function bloco(value) {
  return clean(value).toUpperCase();
}

function pav(value) {
  const result = clean(value).replaceAll("°", "º");
  return /terreo/i.test(result.normalize("NFD").replace(/[\u0300-\u036f]/g, "")) || result === "T"
    ? "T"
    : result;
}

function apto(value) {
  const result = clean(value);
  return /^\d+$/.test(result) ? result.padStart(2, "0") : result;
}

function dbDate(value) {
  const result = clean(value);
  if (!result) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(result)) return result.slice(0, 10);
  const match = result.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);
  if (match) return `${match[3]}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}`;
  throw new Error(`Data inválida no CSV: ${result}`);
}

function dbTime(value) {
  const result = clean(value);
  if (!result) return null;
  const match = result.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (!match) throw new Error(`Horário inválido no CSV: ${result}`);
  return `${match[1].padStart(2, "0")}:${match[2]}:${match[3] ?? "00"}`;
}

function stageStatus(value) {
  const result = clean(value).toLowerCase();
  if (result.includes("finaliz")) return "Finalizado";
  if (result.includes("revistoriado")) return "Revistoriado";
  if (result.includes("pend") || result.includes("revist") || result.includes("reprov")) {
    return "Pendências Revisórias";
  }
  if (result.includes("proxima") || result.includes("próxima") || result.includes("liberado")) {
    return "Liberado p/ Próxima Etapa";
  }
  if (result.includes("andamento")) return "Em andamento";
  return "Não iniciado";
}

function inspectionStatus(value) {
  const result = clean(value).toLowerCase();
  if (result.includes("aprov")) return "Aprovado";
  if (result.includes("revist")) return "Revistoria";
  if (result.includes("remarc")) return "Remarcado";
  if (result.includes("agend") && !result.includes("não") && !result.includes("nao")) return "Agendado";
  return "Não agendado";
}

function keyOf(row) {
  return `${bloco(row.bloco)}|${pav(row.pav)}|${apto(row.apto)}`;
}

async function readSheet(name) {
  const text = await readFile(resolve(inputDir, `${name}.csv`), "utf8");
  return parseCsv(text);
}

function requireColumns(rows, sheet, columns) {
  if (!rows.length) throw new Error(`${sheet}.csv está vazio.`);
  const available = new Set(Object.keys(rows[0]));
  const missing = columns.filter((column) => !available.has(column));
  if (missing.length) throw new Error(`${sheet}.csv não contém: ${missing.join(", ")}.`);
}

function uniqueBy(items, getKey) {
  return [...new Map(items.map((item) => [getKey(item), item])).values()];
}

async function upsertChunks(client, table, rows, onConflict) {
  for (let index = 0; index < rows.length; index += 500) {
    const { error } = await client
      .from(table)
      .upsert(rows.slice(index, index + 500), { onConflict });
    if (error) throw new Error(`${table}: ${error.message}`);
  }
}

const [obra, cliente, cronograma] = await Promise.all([
  readSheet("OBRA"),
  readSheet("CLIENTE"),
  readSheet("CRONOGRAMA"),
]);

requireColumns(obra, "OBRA", ["bloco", "pav", "apto", "acab", "inst", "qual", "astec"]);
requireColumns(cliente, "CLIENTE", [
  "bloco",
  "pav",
  "apto",
  "cliente",
  "data_vistoria",
  "horario_vistoria",
  "responsavel",
  "status",
  "data_revistoria",
  "obs",
]);
requireColumns(cronograma, "CRONOGRAMA", [
  "bloco",
  "pav",
  "acab_plan",
  "acab_lib",
  "inst_plan",
  "inst_lib",
  "qual_plan",
  "qual_lib",
  "astec_plan",
  "astec_lib",
]);

const unitRows = uniqueBy(
  [...obra, ...cliente]
    .map((row) => ({ bloco: bloco(row.bloco), pav: pav(row.pav), apto: apto(row.apto) }))
    .filter((row) => row.bloco && row.pav && row.apto),
  (row) => `${row.bloco}|${row.pav}|${row.apto}`,
);

console.log(
  `CSV validado: ${obra.length} OBRA, ${cliente.length} CLIENTE, ${cronograma.length} CRONOGRAMA, ${unitRows.length} unidades.`,
);

if (dryRun) {
  console.log("Dry-run concluído; nenhuma alteração foi enviada ao Supabase.");
  process.exit(0);
}

const url = process.env.SUPABASE_URL;
const secretKey = process.env.SUPABASE_SECRET_KEY;
const projectSlug = process.env.APP_PROJECT_SLUG ?? "alto-do-jeriva";

if (!url || !secretKey) {
  throw new Error("Defina SUPABASE_URL e SUPABASE_SECRET_KEY no arquivo .env local.");
}

const supabase = createClient(url, secretKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const { data: project, error: projectError } = await supabase
  .from("projects")
  .upsert({ slug: projectSlug, name: "Alto do Jerivá" }, { onConflict: "slug" })
  .select("id")
  .single();

if (projectError) throw new Error(`projects: ${projectError.message}`);

await upsertChunks(
  supabase,
  "units",
  unitRows.map((row) => ({ ...row, project_id: project.id })),
  "project_id,bloco,pav,apto",
);

const { data: storedUnits, error: unitError } = await supabase
  .from("units")
  .select("id,bloco,pav,apto")
  .eq("project_id", project.id);

if (unitError) throw new Error(`units: ${unitError.message}`);
const unitId = new Map((storedUnits ?? []).map((row) => [`${row.bloco}|${row.pav}|${row.apto}`, row.id]));

const obraByUnit = new Map(obra.map((row) => [keyOf(row), row]));
const stages = ["acab", "inst", "qual", "astec"];
const statusRows = unitRows.flatMap((unit) => {
  const source = obraByUnit.get(`${unit.bloco}|${unit.pav}|${unit.apto}`) ?? {};
  const id = unitId.get(`${unit.bloco}|${unit.pav}|${unit.apto}`);
  return stages.map((stage) => ({ unit_id: id, stage, status: stageStatus(source[stage]) }));
});

const clientByUnit = new Map(cliente.map((row) => [keyOf(row), row]));
const inspectionRows = unitRows.map((unit) => {
  const source = clientByUnit.get(`${unit.bloco}|${unit.pav}|${unit.apto}`) ?? {};
  return {
    unit_id: unitId.get(`${unit.bloco}|${unit.pav}|${unit.apto}`),
    client_name: clean(source.cliente),
    inspection_date: dbDate(source.data_vistoria),
    inspection_time: dbTime(source.horario_vistoria),
    responsible: clean(source.responsavel),
    status: inspectionStatus(source.status),
    reinspection_date: dbDate(source.data_revistoria),
    notes: clean(source.obs),
  };
});

const scheduleRows = cronograma.flatMap((row) =>
  stages.map((stage) => ({
    project_id: project.id,
    bloco: bloco(row.bloco),
    pav: pav(row.pav),
    stage,
    planned_date: dbDate(row[`${stage}_plan`]),
    released_date: dbDate(row[`${stage}_lib`]),
  })),
);

await upsertChunks(supabase, "unit_stage_status", statusRows, "unit_id,stage");
await upsertChunks(supabase, "client_inspections", inspectionRows, "unit_id");
await upsertChunks(
  supabase,
  "floor_schedule",
  scheduleRows,
  "project_id,bloco,pav,stage",
);

console.log(
  `Importação concluída: ${unitRows.length} unidades, ${statusRows.length} etapas, ${inspectionRows.length} vistorias de cliente e ${scheduleRows.length} itens de cronograma.`,
);
