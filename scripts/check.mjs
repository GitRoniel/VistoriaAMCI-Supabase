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
assert.ok(html.includes("alto-mangueiral-logo-white.png"), "Logo transparente do Alto Mangueiral não encontrada no login.");
assert.ok(html.includes("Aprovações e Revistorias por ${LAYOUT.group}"), "Progresso por bloco/conjunto não encontrado no resumo.");
assert.ok(html.includes("alto-do-buriti") && html.includes("houseLayout"), "Módulo do Alto do Buriti não encontrado.");
assert.ok(html.includes("units!inner(project_id)"), "Consultas precisam ficar restritas ao condomínio selecionado.");
assert.ok(html.includes('id="projectOverview"') && html.includes('id="overviewOv"'), "Visão Geral não encontrada na seleção de obra.");
assert.ok(html.includes("technical_escort") && html.includes("Acomp. Técnico"), "Campo Acomp. Técnico não encontrado.");
assert.ok(!html.includes("fonts.googleapis.com/css2?family=Geist"), "A fonte do projeto deve ser a do sistema (SF Pro).");
assert.ok(html.includes("family=Inter") && html.includes("-webkit-touch-callout:none"), "Inter no desktop/Android e fonte nativa no iOS.");
assert.ok(!/transform:scale\(/.test(html), "Não usar scale() em elementos com texto.");
assert.ok(html.includes('data-cfg="cond"') && html.includes("sort_order"), "Configuração de Condomínio não encontrada.");
assert.ok(html.includes('class="stk-bar"'), "Gráfico empilhado por bloco não encontrado no resumo.");
assert.ok(!html.includes('data-view="obra"'), "A aba Vistoria · Obra ainda aparece no painel.");
assert.ok(html.includes("Aprovações de Acesso"), "Página de aprovações de acesso não encontrada.");
assert.ok(html.includes('id="projectAdmin"') && html.includes('id="adminOv"'), "Aprovações de acesso precisam ficar na seleção de obra.");
assert.ok(!html.includes('data-view="acessos"'), "Aprovações de acesso não devem aparecer como aba do condomínio.");
assert.ok(!html.includes('id="headProjectName"'), "Nome da obra duplicado no cabeçalho.");
assert.ok(html.includes("touch-action:pan-y"), "Rolagem tátil das telas de autenticação não encontrada.");
assert.ok(html.includes("postgres_changes"), "Assinatura Realtime não encontrada.");

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
assert.match(edgeFunction, /profiles!project_members_user_id_fkey/, "Relacionamento project_members → profiles precisa ser explícito.");
assert.match(edgeFunction, /action === ['"]reject['"]/);

// App iOS (Capacitor) e ícones.
const capConfig = JSON.parse(await readFile(resolve(root, "capacitor.config.json"), "utf8"));
assert.equal(capConfig.webDir, "www");
assert.ok(capConfig.appId && capConfig.appName, "Capacitor precisa de appId e appName.");
const manifest = JSON.parse(await readFile(resolve(root, "www/manifest.webmanifest"), "utf8"));
assert.ok(manifest.icons.some((i) => i.sizes === "512x512"), "Manifest precisa do ícone 512.");
for (const icon of ["favicon.svg", "favicon.ico", "favicon-32.png", "apple-touch-icon.png", "icon-192.png", "icon-512.png", "icon-maskable-512.png"]) {
  await readFile(resolve(root, "assets/icons", icon));
}
assert.match(html, /rel="apple-touch-icon"[^>]+apple-touch-icon\.png/);
assert.match(html, /rel="icon" href="\.\/assets\/icons\/favicon\.svg"/);
assert.match(html, /viewport-fit=cover/);
assert.match(html, /const IS_NATIVE=/);
assert.match(html, /\.apts\{grid-template-columns:repeat\(4,minmax\(0,1fr\)\)\}/, "Grade do mapa precisa de colunas minmax(0,1fr) (iOS).");
assert.match(html, /\.mx\.casas th\.casah\{font-size:12px\}/);
JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
JSON.parse(await readFile(resolve(root, "vercel.json"), "utf8"));

console.log("Verificações estáticas concluídas sem erros.");
