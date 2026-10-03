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
assert.ok(html.includes("houseLayout") && html.includes('project?.kind==="casas"'), "Tipo do condomínio (casas/apartamentos) precisa vir do banco.");
assert.ok(!html.includes("PROJECT_EXPERIENCES") && !html.includes("BURITI_CONJUNTOS"), "Condomínios não podem ficar fixos no código.");
assert.ok(html.includes("resetPasswordForEmail(email,{redirectTo})") && html.includes('type==="recovery"') && html.includes("openResetNewPassword(") && html.includes("updateUser({password"), "Esqueci minha senha precisa usar o link de recuperação do Supabase Auth.");
assert.ok(/id="loginRemember"[^>]*checked/.test(html) && html.includes("storage:authStorage"), "Manter conectado precisa vir marcado e controlar onde a sessão fica salva.");
assert.ok(html.includes('scope:"global"') && html.includes('scope:"local"'), "Troca de senha encerra todas as sessões; Sair encerra só a do aparelho.");
assert.ok(html.includes('supabase.rpc("criar_condominio"') && html.includes('supabase.rpc("atualizar_estrutura_condominio"'), "Cadastro/estrutura de condomínios devem usar as funções do banco.");
assert.ok(html.includes("units!inner(project_id)"), "Consultas precisam ficar restritas ao condomínio selecionado.");
assert.ok(html.includes('id="projectOverview"') && html.includes('id="overviewOv"'), "Visão Geral não encontrada na seleção de obra.");
assert.ok(html.includes("technical_escort") && html.includes("Acomp. Técnico"), "Campo Acomp. Técnico não encontrado.");
assert.ok(!html.includes("fonts.googleapis.com/css2?family=Geist"), "A fonte do projeto deve ser a do sistema (SF Pro).");
assert.ok(html.includes("family=Inter:opsz,wght@14..32,300..900") && html.includes("html.native body{font-family:-apple-system") && !/@supports \(-webkit-touch-callout:none\)\{body\{font-family/.test(html), "Inter em toda a versão web; fonte do sistema só no app iOS.");
assert.ok(!/transform:scale\(/.test(html), "Não usar scale() em elementos com texto.");
assert.ok(html.includes('data-admin-page="condominios"') && html.includes('data-pane="cond"') && html.includes("sort_order"), "Configuração de Condomínios não encontrada.");
assert.ok(html.includes('class="stk-bar"'), "Gráfico empilhado por bloco não encontrado no resumo.");
assert.ok(!html.includes('data-view="obra"'), "A aba Vistoria · Obra ainda aparece no painel.");
assert.ok(html.includes("Acesso de usuários") && html.includes("Acesso aos módulos") && html.includes('data-pane="apr"') && html.includes('data-pane="mods"'), "Página Liberações (acesso de usuários e módulos) não encontrada.");
assert.ok(!html.includes('id="projectAdmin"') && html.includes('id="hmAdminMenu"') && ['liberacoes','condominios','logs'].every((p) => html.includes(`data-admin-page="${p}"`)) && html.includes('id="adminOv"'), "Liberações, Configuração de Condomínios e Logs ficam no menu do usuário.");
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
// Tema claro/escuro, topo do iPhone e Revistoria Finalizada.
const { inject: injectDarkTheme } = await import("./theme-dark.mjs");
assert.equal(injectDarkTheme(html), html, "Tema escuro desatualizado: rode `node scripts/theme-dark.mjs`.");
assert.match(html, /:root\[data-theme="dark"\]\{color-scheme:dark;--chrome-top:/);
assert.match(html, /html\{background-color:var\(--status-top,var\(--chrome-top\)\)\}/);
assert.match(html, /apple-mobile-web-app-status-bar-style" content="default"/, "iOS 26: barra opaca; a translúcida ganha a faixa de desfoque.");
assert.match(html, /localStorage\.getItem\("amci-theme"\)/);
assert.match(html, /data-theme-toggle/);
assert.match(html, /const showRev=cur==="rf";/);
// Revistoria: data e responsável próprios, obrigatórios para finalizar; visíveis na lista, impressão e exportação.
assert.ok(html.includes('resp_revistoria:"reinspection_responsible"') && html.includes("reinspection_responsible"), "Responsável da revistoria precisa ter coluna própria.");
assert.ok(html.includes('<th class="cw-d th-rev">Data revistoria</th>') && html.includes("function exportCliList") && html.includes("Responsável revistoria"), "Lista geral precisa mostrar e exportar data e responsável da revistoria.");
assert.ok(!html.includes("pendingStatus") && !html.includes("Informe a data e o responsável pela revistoria"), "Revistoria Finalizada não exige data nem responsável.");
// Excluir obra: exclusão lógica, confirmação por nome, só administradores, com log.
assert.ok(html.includes('supabase.rpc("arquivar_condominio"') && html.includes("condArchiveMatch") && html.includes('supabase.rpc("restaurar_condominio"'), "Excluir obra precisa arquivar com confirmação e permitir restaurar.");
const revMigration = await readFile(resolve(root, "supabase/migrations/20260929145956_revistoria_responsavel_arquivar_obra.sql"), "utf8");
assert.match(revMigration, /add column if not exists reinspection_responsible text not null default ''/);
const revOptional = await readFile(resolve(root, "supabase/migrations/20260929152323_revistoria_final_sem_obrigatorios.sql"), "utf8");
assert.match(revOptional, /drop trigger if exists client_inspections_16_revistoria_final/);
assert.match(revMigration, /and p\.archived_at is null/);
assert.match(revMigration, /private\.log_project_event\(p_project, 'ARCHIVE'/);
assert.doesNotMatch(revMigration, /delete from public\.(projects|units|client_inspections)/i, "Excluir obra não pode apagar linhas.");
// Importação de agendamentos: nada gravado sem confirmação, sem apagar valores, histórico e RPC segura.
const importMigration = await readFile(resolve(root, "supabase/migrations/20260929031353_importacao_agendamentos.sql"), "utf8");
assert.match(importMigration, /create table if not exists public\.importacoes_agendamentos \(/);
assert.match(importMigration, /create table if not exists public\.importacoes_agendamentos_itens \(/);
assert.match(importMigration, /alter table public\.importacoes_agendamentos enable row level security/);
assert.match(importMigration, /private\.is_project_admin\(p\.id\)/, "RPC precisa exigir administrador de todos os condomínios.");
assert.match(importMigration, /coalesce\(c ->> 'new', ''\) = ''/, "A importação não pode apagar valores.");
assert.match(importMigration, /alterado_no_sistema/, "Campo alterado depois da prévia não pode ser sobrescrito.");
assert.match(importMigration, /revoke all on function public\.aplicar_importacao_agendamentos\(text, jsonb, jsonb, jsonb\) from public, anon;/);
assert.match(html, /id="ovImport"[^>]*>Atualizar Agendamentos</);
const importUi = html.slice(html.indexOf("/* ── IMPORTAÇÃO DE AGENDAMENTOS"), html.indexOf("/* ── CONFIGURAÇÕES ── */"));
assert.doesNotMatch(importUi, /[\u{1F300}-\u{1FAFF}\u2600-\u27BF]/u, "Sem emojis na importação.");
const importFieldsUi = importUi.slice(importUi.indexOf("const IMPORT_COLUMNS"), importUi.indexOf("const IMP_ACTION"));
assert.doesNotMatch(importFieldsUi, /db:"(responsible|notes|sale_stage)"|key:"(responsavel|obs|etapa)"/, "Responsável, Observação e Etapa da planilha não podem ser importados.");
assert.doesNotMatch(importUi, /text\("(responsavel|obs|etapa)"/, "Responsável, Observação e Etapa da planilha não podem ser comparados/importados.");
const importFields = await readFile(resolve(root, "supabase/migrations/20260929033637_importacao_campos_atendimento.sql"), "utf8");
assert.match(importFields, /allowed text\[\] := array\['client_name', 'inspection_date', 'inspection_time', 'status'\];/);
assert.doesNotMatch(importFields, /(responsible|notes|sale_stage) = v_rec/, "A função não pode gravar responsável, observação ou etapa.");
// HM Bar: um único cabeçalho (com o tema e o menu do usuário) para todas as telas.
assert.equal((html.match(/<header class="hm-bar" id="hmBar">/g) || []).length, 1, "A HM Bar deve existir uma única vez.");
assert.ok(html.includes("<!-- HM-BAR") && html.includes("<!-- /HM-BAR -->") && html.includes('./platform/hmbar.css'), "HM Bar gerada a partir de src/platform/ui/hmbar.js.");
assert.ok(!html.includes('class="header"') && !html.includes('class="project-top"'), "Cabeçalhos antigos não devem voltar.");
assert.ok((html.match(/data-hm-host="/g) || []).length >= 4 && html.includes("function syncHmBar"), "Telas de Vistorias precisam receber a HM Bar.");
assert.ok((html.match(/data-theme-toggle/g) || []).length >= 2, "Botão de tema no login e na HM Bar.");
assert.match(html, /const IMPORT_COLUMNS=\[/);
assert.match(html, /supabase\.rpc\("aplicar_importacao_agendamentos"/);
assert.doesNotMatch(html.slice(html.indexOf("async function onImportFile"), html.indexOf("function impRows")), /supabase\.(rpc|from)\(/, "Selecionar o arquivo não pode gravar no banco.");
await readFile(resolve(root, "src/xlsx-entry.js"), "utf8");
// Visão Geral: modos Lista/Resumo, resumo por Data + Condomínio + Local sem dados individuais.
assert.match(html, /data-ovmode="lista"[^>]*>Lista<\/button><button[^>]*data-ovmode="resumo"/);
const ovSummary = html.slice(html.indexOf("function renderOvSummary"), html.indexOf("function openOvSummaryRow"));
assert.doesNotMatch(ovSummary, /\.cliente|\.hora\b|\.resp\b/, "O Resumo não pode exibir cliente, horário ou responsável.");
assert.match(ovSummary, /r\.code==="rv"/);
const condMigration = await readFile(resolve(root, "supabase/migrations/20260929042923_cadastro_condominios.sql"), "utf8");
assert.match(condMigration, /create or replace function public\.criar_condominio\(/);
assert.match(condMigration, /private\.is_any_admin\(\)/, "Só administradores cadastram condomínios.");
assert.match(condMigration, /Não é possível remover casas com dados cadastrados/, "Remoção de casas com dados precisa ser bloqueada.");
assert.match(condMigration, /revoke all on function public\.criar_condominio\(text, text, text, jsonb, text\) from public, anon;/);
JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
JSON.parse(await readFile(resolve(root, "vercel.json"), "utf8"));

// Plataforma: módulos protegidos por RLS, sem chave de serviço no navegador, regras do Relatório de Pedidos testadas.
const platformJs = await readFile(resolve(root, "www/relatorios.js"), "utf8").catch(() => "");
assert.ok(platformJs.includes("pedidos_registros_atual") && !/service_role/i.test(platformJs), "Relatório de Pedidos deve ler a view protegida e nunca usar a chave de serviço.");
assert.ok(platformJs.includes("contratos_registros_atual"), "Relatório de Contratos deve ler a view protegida (última execução).");
const rlsErp = await readFile(resolve(root, "supabase/migrations/20261001150432_plataforma_modulos_rls_erp.sql"), "utf8");
assert.match(rlsErp, /private\.has_module\('suprimentos'\)/);
assert.match(rlsErp, /private\.has_module\('contratos'\)/);
await import("./test-pedidos.mjs");
await import("./test-contratos.mjs");

console.log("Verificações estáticas concluídas sem erros.");
