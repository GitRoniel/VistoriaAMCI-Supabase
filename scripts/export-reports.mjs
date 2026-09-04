import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

const root = resolve(import.meta.dirname, "..");
const outputDir = resolve(root, "exports");
const url = process.env.SUPABASE_URL;
const secretKey = process.env.SUPABASE_SECRET_KEY;
const projectSlug = process.env.APP_PROJECT_SLUG ?? "alto-do-jeriva";

if (!url || !secretKey) {
  throw new Error("Defina SUPABASE_URL e SUPABASE_SECRET_KEY no arquivo .env local.");
}

const supabase = createClient(url, secretKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function fetchAll(table, columns, filter) {
  const all = [];
  for (let from = 0; ; from += 1000) {
    let query = supabase.from(table).select(columns);
    if (filter) query = filter(query);
    const { data, error } = await query.order("id", { ascending: true }).range(from, from + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    all.push(...(data ?? []));
    if (!data || data.length < 1000) return all;
  }
}

function csvCell(value) {
  const text = value == null ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function csv(headers, rows) {
  return `\uFEFF${headers.join(",")}\r\n${rows
    .map((row) => headers.map((header) => csvCell(row[header])).join(","))
    .join("\r\n")}\r\n`;
}

const { data: project, error: projectError } = await supabase
  .from("projects")
  .select("id")
  .eq("slug", projectSlug)
  .single();

if (projectError) throw new Error(`projects: ${projectError.message}`);

const [units, stages, inspections, schedules] = await Promise.all([
  fetchAll("units", "id,bloco,pav,apto", (query) => query.eq("project_id", project.id)),
  fetchAll("unit_stage_status", "id,unit_id,stage,status"),
  fetchAll("client_inspections", "*"),
  fetchAll("floor_schedule", "*", (query) => query.eq("project_id", project.id)),
]);

const projectUnitIds = new Set(units.map((unit) => unit.id));
const stageByUnit = new Map();
for (const row of stages) {
  if (!projectUnitIds.has(row.unit_id)) continue;
  if (!stageByUnit.has(row.unit_id)) stageByUnit.set(row.unit_id, {});
  stageByUnit.get(row.unit_id)[row.stage] = row.status;
}

const inspectionByUnit = new Map(
  inspections.filter((row) => projectUnitIds.has(row.unit_id)).map((row) => [row.unit_id, row]),
);

const obraRows = units.map((unit) => {
  const status = stageByUnit.get(unit.id) ?? {};
  return {
    bloco: unit.bloco,
    pav: unit.pav,
    apto: unit.apto,
    acab: status.acab ?? "Não iniciado",
    inst: status.inst ?? "Não iniciado",
    qual: status.qual ?? "Não iniciado",
    astec: status.astec ?? "Não iniciado",
  };
});

const clientRows = units.map((unit) => {
  const row = inspectionByUnit.get(unit.id) ?? {};
  return {
    bloco: unit.bloco,
    pav: unit.pav,
    apto: unit.apto,
    cliente: row.client_name ?? "",
    data_vistoria: row.inspection_date ?? "",
    horario_vistoria: String(row.inspection_time ?? "").slice(0, 5),
    responsavel: row.responsible ?? "",
    status: row.status ?? "Não agendado",
    data_revistoria: row.reinspection_date ?? "",
    obs: row.notes ?? "",
  };
});

const scheduleByFloor = new Map();
for (const row of schedules) {
  const key = `${row.bloco}|${row.pav}`;
  if (!scheduleByFloor.has(key)) scheduleByFloor.set(key, { bloco: row.bloco, pav: row.pav });
  const target = scheduleByFloor.get(key);
  target[`${row.stage}_plan`] = row.planned_date ?? "";
  target[`${row.stage}_lib`] = row.released_date ?? "";
}
const scheduleRows = [...scheduleByFloor.values()];

await mkdir(outputDir, { recursive: true });
await Promise.all([
  writeFile(
    resolve(outputDir, "OBRA.csv"),
    csv(["bloco", "pav", "apto", "acab", "inst", "qual", "astec"], obraRows),
    "utf8",
  ),
  writeFile(
    resolve(outputDir, "CLIENTE.csv"),
    csv(
      [
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
      ],
      clientRows,
    ),
    "utf8",
  ),
  writeFile(
    resolve(outputDir, "CRONOGRAMA.csv"),
    csv(
      [
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
      ],
      scheduleRows,
    ),
    "utf8",
  ),
]);

console.log(
  `Relatórios gerados em exports/: ${obraRows.length} OBRA, ${clientRows.length} CLIENTE e ${scheduleRows.length} CRONOGRAMA.`,
);
