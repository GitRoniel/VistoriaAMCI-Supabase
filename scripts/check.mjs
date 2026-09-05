import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { transform } from "esbuild";

const root = resolve(import.meta.dirname, "..");
const html = await readFile(resolve(root, "www/index.html"), "utf8");
const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
  .map((match) => match[1])
  .filter((source) => source.trim());

assert.ok(scripts.length, "Nenhum JavaScript inline encontrado.");
for (const source of scripts) new Function(source);

assert.ok(!html.includes("script.google.com"), "O HTML ainda aponta para o Apps Script.");
assert.ok(!html.includes("WEBAPP_URL"), "O HTML ainda contém a configuração antiga.");
assert.ok(html.includes("signInWithPassword"), "Login do Supabase não encontrado.");
assert.ok(html.includes("supabase.auth.signUp"), "Cadastro do Supabase não encontrado.");
assert.ok(html.includes('class="auth-locked"'), "Bloqueio inicial da aplicação não encontrado.");
assert.ok(html.includes('id="projectOv"'), "Tela de seleção de empreendimento não encontrada.");
assert.ok(html.includes("availableProjects"), "Lista de empreendimentos autorizados não encontrada.");
assert.ok(html.includes('.from("project_members")'), "Consulta de acessos por empreendimento não encontrada.");
assert.ok(html.includes('id="btnProjectSwitch"'), "Ação para trocar de empreendimento não encontrada.");
assert.ok(html.includes("Acompanhamento da obra, vistorias dos clientes e mantenha toda a equipe trabalhando com informações atualizadas."), "Texto solicitado para o login não encontrado.");
assert.ok(!html.includes('<span class="login-kicker">Alto do Jerivá Residencial</span>'), "O empreendimento ainda aparece indevidamente no login.");
assert.ok(html.includes("alto-mangueiral-logo-transparent.svg"), "Logo transparente do Alto Mangueiral não encontrada no login.");
assert.ok(html.includes("postgres_changes"), "Assinatura Realtime não encontrada.");

const transparentLogo = await readFile(
  resolve(root, "assets/alto-mangueiral-logo-transparent.svg"),
  "utf8",
);
assert.match(transparentLogo, /<feColorMatrix/i);
assert.match(transparentLogo, /alto-mangueiral-logo\.jpg/i);

const edgeFunction = await readFile(
  resolve(root, "supabase/functions/admin-users/index.ts"),
  "utf8",
);
await transform(edgeFunction, { loader: "ts", target: "es2022" });
assert.match(edgeFunction, /@supabase\/server@1\.5\.3/);
assert.match(edgeFunction, /auth:\s*['"]user['"]/);

const migration = await readFile(
  resolve(root, "supabase/migrations/20260904012409_initial_schema.sql"),
  "utf8",
);
for (const table of [
  "projects",
  "profiles",
  "project_members",
  "units",
  "unit_stage_status",
  "client_inspections",
  "floor_schedule",
  "audit_log",
]) {
  assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`, "i"));
}
assert.match(migration, /revoke all on all tables in schema public from anon/i);
assert.match(migration, /alter publication supabase_realtime add table/i);

const accessMigration = await readFile(
  resolve(root, "supabase/migrations/20260904235624_access_requests.sql"),
  "utf8",
);
assert.match(accessMigration, /create table public\.access_requests/i);
assert.match(accessMigration, /alter table public\.access_requests enable row level security/i);
assert.match(accessMigration, /revoke all on table public\.access_requests from public, anon, authenticated/i);
assert.match(edgeFunction, /\.from\(['"]access_requests['"]\)/);

JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
JSON.parse(await readFile(resolve(root, "vercel.json"), "utf8"));

console.log("Verificações estáticas concluídas sem erros.");
