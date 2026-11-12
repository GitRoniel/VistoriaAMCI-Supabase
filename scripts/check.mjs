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
assert.ok(html.includes("Vistorias por ${LAYOUT.group}") && html.includes("Revistorias por ${LAYOUT.group}"), "Panorama de Vistorias e de Revistorias por bloco/conjunto não encontrado no resumo.");
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
// Data e responsável da revistoria saíram da lista da Vistoria (ficam na aba Revistoria · Cliente); a Visão Geral e a exportação continuam com eles.
assert.ok(html.includes('<th class="cw-d th-rev">Data revistoria</th>') && html.includes("function exportCliList") && html.includes("Responsável revistoria"), "Visão Geral e exportação precisam manter data e responsável da revistoria.");
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
assert.match(ovSummary, /cliShow\(r\.code\)==="rv"/, "Resumo: a revistoria já aprovada (rf) conta como Revistoria, como no resto da Vistoria.");
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
const chavesSimples = await readFile(resolve(root, "supabase/migrations/20261103120000_chaves_transferencia_simples.sql"), "utf8");
assert.match(chavesSimples, /create or replace function public\.chaves_transferir\(\s*p_unit_id bigint,\s*p_setor text,\s*p_responsavel text/);
assert.match(chavesSimples, /Selecione o setor de destino/);
assert.match(chavesSimples, /Informe o responsável que está recebendo a chave/);
assert.match(chavesSimples, /private\.chaves_pedido_existente\(p_pedido\)/, "Transferência repetida não pode duplicar.");
assert.doesNotMatch(chavesSimples, /(delete from|truncate|drop table)/i, "Simplificação das chaves não apaga dados.");
assert.doesNotMatch(chavesSimples, /grant (insert|update|delete)/i, "Escrita só pela função.");
const chavesPerdidas = await readFile(resolve(root, "supabase/migrations/20261103150000_chaves_perdidas.sql"), "utf8");
assert.match(chavesPerdidas, /alter table public\.chaves_ocorrencias enable row level security/);
assert.match(chavesPerdidas, /grant select on table public\.chaves_ocorrencias to authenticated/);
assert.match(chavesPerdidas, /registrada como perdida\. Use "Regularizar chave"/, "Chave perdida não pode voltar a um setor sem regularização.");
assert.doesNotMatch(chavesPerdidas, /(delete from|truncate|drop table)|(update|insert into) public\.client_inspections/i, "Chave perdida não apaga dados nem toca na vistoria.");
const chavesJs = await readFile(resolve(root, "www/chaves.js"), "utf8").catch(() => "");
assert.ok(chavesJs.includes("chaves_transferir") && chavesJs.includes("chaves_regularizar") && !/chaves_(cadastrar|retirar|devolver|ocorrencia)"/.test(chavesJs), "Aba Chaves: transferência e chave perdida, sem as funções antigas.");
await import("./test-chaves.mjs");
const revPlanilha = await readFile(resolve(root, "supabase/migrations/20261027120000_revistorias_planilha.sql"), "utf8");
assert.match(revPlanilha, /alter table public\.revistorias enable row level security/);
assert.match(revPlanilha, /grant select on table public\.revistorias to authenticated/);
assert.doesNotMatch(revPlanilha, /grant (insert|update|delete)[^;]*revistorias/i, "Revistorias: escrita só pela função de importação.");
assert.match(revPlanilha, /is_project_admin\(p\.id\) is not true/, "Importação precisa recusar quem não é administrador (inclusive sem acesso).");
assert.match(revPlanilha, /coalesce\(private\.project_role\(p_project_id\) = 'admin', false\)/, "is_project_admin nunca pode devolver nulo.");
assert.doesNotMatch(revPlanilha.slice(revPlanilha.indexOf("-- ── Revistorias ──")), /set\s+status\s*=\s*v_rec/, "Revistoria não altera o status da vistoria.");
assert.ok(html.includes('<script src="./revistorias.js"></script>') && html.includes("p_revistorias") && html.includes("IMPORT_REV_COLUMNS"), "Importação e telas das revistorias.");
await import("./test-revistorias.mjs");

// Revistoria · Cliente: aba própria, colunas de revistoria fora da lista da Vistoria, etiquetas no Controle de Chaves.
const revCli = await readFile(resolve(root, "supabase/migrations/20261105120000_revistoria_cliente.sql"), "utf8");
assert.match(revCli, /alter table public\.revistorias_cliente enable row level security/);
assert.match(revCli, /alter table public\.revistorias_eventos enable row level security/);
assert.match(revCli, /grant select on table public\.revistorias_cliente, public\.revistorias_eventos to authenticated/);
assert.doesNotMatch(revCli, /grant (insert|update|delete)[^;]*(revistorias_cliente|revistorias_eventos)/i, "Revistoria · Cliente: escrita só pelas funções do banco.");
assert.doesNotMatch(revCli, /drop table|truncate|delete from public\.(revistorias|client_inspections)/i, "Revistoria · Cliente não apaga dados.");
assert.match(revCli, /unit_id bigint not null unique references public\.units/, "Uma linha de acompanhamento por unidade (sem duplicar).");
assert.match(revCli, /after insert or update of status on public\.client_inspections/, "Entrada automática pelo status da vistoria.");
const listaCli = html.slice(html.indexOf("function renderCliList"), html.indexOf("function printCliList"));
assert.ok(listaCli && !/Data revistoria|Resp\. revistoria|th-rvs/.test(listaCli), "Lista da Vistoria sem as colunas Data Revistoria, Resp. Revistoria e Revistoria.");
assert.ok(html.includes('data-view="revcli"') && html.includes('id="revcliRoot"') && html.includes('<script src="./revcliente.js" defer></script>'), "Aba Revistoria · Cliente não encontrada.");
assert.ok(html.indexOf('data-view="cliente"') < html.indexOf('data-view="revcli"') && html.indexOf('data-view="revcli"') < html.indexOf('data-view="chaves"'), "Revistoria · Cliente fica logo depois da Vistoria.");
// Reorganização: Estatística Geral saiu da navegação (conteúdo na Produtividade); Vistoria sem "Revistoria Finalizada".
assert.ok(!html.includes('data-view="stats"') && !html.includes('id="v-stats"'), "A aba Estatística Geral foi removida da navegação.");
const centralJs = await readFile(resolve(root, "src/modules/central/produtividade.js"), "utf8");
assert.ok(html.includes("estatistica:overlay||!appProject?null:") && centralJs.includes("est.pintar("), "Vistoriadores × acompanhamento técnico na Produtividade do Resumo Geral.");
const legVist = html.slice(html.indexOf('<div id="cliMapaWrap">'), html.indexOf('<div id="cliListaWrap"'));
assert.ok(legVist && !/Revistoria Finalizada/.test(legVist), "Legenda da Vistoria sem Revistoria Finalizada.");
assert.match(html, /const CLI_FLOW=\["na","ag","rm","rv","ap","in"\];/, "Vistoria: sem o status Revistoria Finalizada para escolher.");
assert.match(html, /const CLI_DB=\{\.\.\.CLL,rf:"Revistoria Finalizada",in:"Inadimplência"\};/, "O valor gravado no banco não muda.");
assert.match(html, /if\(old===code\|\|cliShow\(old\)===code\)return;/, "Revistoria numa unidade aprovada não reabre a revistoria.");
assert.match(html, /if\(\/finaliz\/\.test\(t\)\)return "rv";/, "Planilha de vistorias não aprova nem reabre revistorias.");
const pan = html.slice(html.indexOf("function renderResumo"), html.indexOf("/* ── VISTORIADORES"));
assert.ok(pan.indexOf('titulo:"Panorama Geral"') > 0 && pan.indexOf('titulo:"Panorama Geral"') < pan.indexOf('titulo:"Panorama de Vistorias"') && pan.indexOf('titulo:"Panorama de Vistorias"') < pan.indexOf('titulo:"Panorama de Revistorias"'), "Panorama Geral primeiro, depois Vistorias e Revistorias.");
assert.ok(html.includes('table:"revistorias_cliente"') && html.includes("RVC.passaFiltroRapido"), "Tempo real e filtro rápido da Revistoria · Cliente na Vistoria.");
const revCliJs = await readFile(resolve(root, "www/revcliente.js"), "utf8").catch(() => "");
assert.ok(revCliJs.includes("revistoria_agendar") && revCliJs.includes("revistoria_resultado") && revCliJs.includes("revistoria_reabrir") && !/\.from\("(revistorias_cliente|revistorias|client_inspections)"\)\.(insert|update|upsert|delete)/.test(revCliJs), "Aba Revistoria · Cliente grava só pelas funções do banco.");
const rcSrc = await readFile(resolve(root, "src/modules/revistoria-cliente/index.js"), "utf8");
assert.ok(/const km = chavesOk && s\.status \? marcaChave\(u\.chave\) : "";/.test(rcSrc) && /rc-mk-key sem/.test(rcSrc), "Marca da chave nos dois mapas da Revistoria, com Sem status neutro.");
assert.ok(rcSrc.includes("M.LEG_EXECUCAO.fora_revistoria") && !/M\.SEM_EQUIPE\.cor|M\.APROVADA_SEM_EQUIPE\.cor/.test(rcSrc), "Legendas da Execução M.O. vêm da configuração central.");
const entMig = await readFile(resolve(root, "supabase/migrations/20261117120000_revistoria_aprovacao_entrega_chave.sql"), "utf8");
assert.match(entMig, /create trigger chaves_movimentacoes_30_revistoria after insert on public\.chaves_movimentacoes\s+for each row when \(new\.setor = 'cliente' and new\.tipo in \('transferencia', 'regularizacao'\)\)/, "Só a entrega efetiva ao cliente aciona a aprovação.");
assert.match(entMig, /revistorias_eventos_chave_mov_uniq on public\.revistorias_eventos \(chave_mov_id\)/, "Entrega idempotente (um evento por movimentação).");
assert.doesNotMatch(entMig, /update public\.revistorias\s+set|delete from|drop table|truncate|grant (insert|update|delete)/i, "Entrega de chave nunca altera o resultado técnico (revistorias) nem apaga dados.");
assert.ok(rcSrc.includes("htmlOrigem(s)") && rcSrc.includes("tagEntrega(s)"), "Revistoria mostra a origem da aprovação e o resultado técnico.");
const legMig = await readFile(resolve(root, "supabase/migrations/20261116120000_cores_legendas_execucao.sql"), "utf8");
assert.doesNotMatch(legMig, /create table|drop table|delete from|grant (insert|update|delete)/i, "Legendas da M.O.: sem tabela nova, sem apagar dados, sem escrita direta.");
assert.ok(!/root\.dataset\.cores\b/.test(await readFile(resolve(root, "src/modules/chaves/index.js"), "utf8")), "Chaves: o contêiner não pode ter data-cores (qualquer clique abriria o editor de cores).");
assert.ok(chavesJs.includes("rc-badge") && !/client_inspections"\)\.(update|insert)|revistoria_(agendar|resultado|cancelar|reabrir)/.test(chavesJs), "Controle de Chaves mostra a Revistoria · Cliente sem alterá-la.");
const revLib = await readFile(resolve(root, "supabase/migrations/20261109120000_revistoria_liberacao_execucao.sql"), "utf8");
assert.match(revLib, /alter table public\.revistorias_cliente\s+add column if not exists liberado/, "Liberação na própria linha da unidade (sem tabela nova).");
assert.doesNotMatch(revLib, /create table|grant (insert|update|delete)|drop table|delete from/i, "Liberação/execução: sem tabela nova, sem escrita direta, sem apagar dados.");
assert.ok(revCliJs.includes("revistoria_liberar") && revCliJs.includes("revistoria_execucao"), "Aba Revistoria · Cliente grava liberação e execução pelas funções do banco.");
assert.ok(html.includes('show(revcliHost(),true)'), "Revistoria · Cliente abre no Mapa ao entrar na aba.");
const revRel = await readFile(resolve(root, "supabase/migrations/20261110120000_revistoria_relatorios_reagendamento.sql"), "utf8");
assert.match(revRel, /'revistorias-relatorios', 'revistorias-relatorios', false/, "Bucket dos relatórios precisa ser privado.");
assert.doesNotMatch(revRel, /bytea|base64/i, "PDF nunca dentro do banco (nem Base64).");
assert.match(revRel, /p_sincronizar_data boolean default true/, "Importação só de revistorias não toca na vistoria.");
assert.ok(!/getPublicUrl/.test(revCliJs) && revCliJs.includes("createSignedUrl"), "Relatórios só por URL assinada (sem link público).");
assert.ok(html.includes('supabase.rpc("vistoria_reagendar"') && html.includes("Reagendar Vistoria"), "Reagendar Vistoria no popup.");
assert.ok(html.includes('startImport("rev")') && html.includes("args.p_sincronizar_data=false"), "Importação só de revistorias (aba Revistoria).");
await import("./test-revistoria-cliente.mjs");
await import("./test-central.mjs");
await import("./test-cores.mjs");
await import("./test-conversao-tela.mjs");
await import("./test-offline.mjs");

console.log("Verificações estáticas concluídas sem erros.");
