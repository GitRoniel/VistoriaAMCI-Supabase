# Vistorias AMCI — versão Supabase + Vercel

Esta versão substitui Google Sheets/Apps Script como banco operacional por:

- **Vercel** para o site;
- **Supabase Auth** para login por e-mail e senha;
- **Postgres + RLS** para dados e permissões;
- **Supabase Realtime** para refletir alterações de outros usuários;
- **Google Sheets** apenas como origem da carga inicial ou relatório/exportação.

O código antigo do Apps Script não é necessário para a nova versão. Não mantenha escrita simultânea nos dois sistemas, pois isso criaria duas fontes de verdade.

## Comece aqui

Siga [GUIA-DE-MIGRACAO.md](./GUIA-DE-MIGRACAO.md) do início ao fim. Ele cobre criação do projeto, banco, primeiro administrador, importação dos CSVs, função administrativa, configuração da Vercel, testes e virada.

## Comandos principais

```powershell
pnpm install --frozen-lockfile
pnpm exec supabase login
pnpm exec supabase link --project-ref SEU_PROJECT_REF
pnpm exec supabase db push
pnpm exec supabase functions deploy admin-users
pnpm import:data -- --dry-run
pnpm import:data
pnpm export:reports
pnpm build
```

## Segurança

- `SUPABASE_PUBLISHABLE_KEY` pode ir para o navegador; o acesso real é limitado por RLS.
- `SUPABASE_SECRET_KEY` é somente para a importação local e nunca deve ser adicionada à Vercel ou ao Git.
- Senhas antigas da aba `ACESSOS` não são importadas. Recrie os usuários com senhas novas de pelo menos 8 caracteres.
- O painel permanece totalmente bloqueado até existir uma sessão válida e um vínculo ativo em `project_members`.
- Novos usuários podem solicitar acesso na tela inicial. O cadastro cria uma solicitação com nível básico (`visitante`), sem liberar dados.
- Um administrador revisa as solicitações em **Aprovações de Acesso** (botão na tela de seleção de obra, abaixo de "Sair da conta"; filtros por obra/condomínio e status), escolhe o nível e aprova ou rejeita cada conta.
- Depois do login, o usuário escolhe entre os empreendimentos ativos vinculados à sua conta. A função e as permissões são carregadas separadamente para cada obra.
- Condomínios disponíveis: **Alto do Jerivá** (448 apartamentos, blocos/pavimentos) e **Alto do Buriti** (319 casas, conjuntos A a R). Todos usam as mesmas tabelas (`units`, `client_inspections`...), separadas por `project_id`; as consultas e o RLS retornam apenas os dados do condomínio selecionado.
- **Visão Geral** (botão na seleção de obra): agendamentos de todos os condomínios liberados ao usuário numa só lista, com filtros, resumo e atalho para abrir a unidade. Usa as mesmas tabelas (`client_inspections` + `units`), sem cópia de dados.
- **Acomp. Técnico** (Engenheiro, Arquiteto ou Sem Acomp. Técnico): campo `client_inspections.technical_escort`, editável na Lista e no popup do Mapa de qualquer condomínio.
- A relação de clientes do Alto do Buriti foi importada direto no Supabase a partir da planilha de vendas (sem CPF). Dados pessoais não vão para o Git.
- Cadastro: o novo usuário fica **pendente** até um administrador aprovar em cada condomínio. Em *Authentication → URL Configuration* do Supabase, o **Site URL** e os **Redirect URLs** precisam apontar para `https://amci-vistoria.vercel.app` (Site URL) e `https://amci-vistoria.vercel.app/**` (Redirect URLs), não `localhost`, senão o link de confirmação de e-mail abre uma página inexistente.
- As regras do banco garantem: administrador edita tudo; cada frente edita sua própria etapa; visitante apenas visualiza; somente administrador edita a vistoria do cliente e a data planejada.

## Desenvolvimento local

Copie `.env.example` para `.env`, preencha as chaves públicas e execute:

```powershell
pnpm build
npx serve www
```

O build da Vercel gera `www/config.js` e `www/supabase-client.js` automaticamente.

## App iPhone (Capacitor)

A mesma página `www/` roda como app iOS; a versão WEB continua igual.

- Configuração em `capacitor.config.json` (`appId` `br.com.engertal.vistorias`, `appName` Vistorias, `webDir` `www`).
- Projeto nativo em `ios/` (Xcode). Ícones em `ios/App/App/Assets.xcassets/AppIcon.appiconset` e tela de abertura em `Splash.imageset`, gerados a partir da logo Alto Mangueiral.
- Ícones da WEB (favicon, apple-touch-icon e ícones do manifest) ficam em `assets/icons/`.

Em um Mac com Xcode e CocoaPods:

```bash
pnpm install
pnpm cap:sync:ios   # build da WEB + cópia para o iOS + pod install
pnpm ios:open       # abre no Xcode (escolha o Team em Signing & Capabilities e rode no iPhone)
```

Sempre que alterar `www/index.html`, rode `pnpm cap:sync:ios` antes de gerar o app.
No app o endereço interno é `capacitor://localhost`; o link do e-mail de confirmação aponta para `https://amci-vistoria.vercel.app` (padrão de `APP_PUBLIC_URL` em `scripts/build.mjs`, pode ser trocado no `.env`).

## Tema claro/escuro

- Botão de sol/lua no login, no cabeçalho, na escolha de obra, na Visão Geral, na importação e em Configurações; a escolha fica salva no aparelho (`localStorage`, chave `amci-theme`).
- O Modo Escuro é gerado automaticamente a partir do CSS do Modo Claro por `scripts/theme-dark.mjs` (roda no `pnpm build`; o `pnpm check` falha se estiver desatualizado). Ajustes manuais ficam logo após o bloco gerado em `www/index.html`.
- As cores de status (Não agendado, Agendado, Remarcado, Revistoria, Revistoria Finalizada, Aprovado) são iguais nos dois temas.
- A área da barra de status no iPhone (tela cheia/app) usa `--chrome-top`, que acompanha o tema.

## Importação de agendamentos (Excel)

Na **Visão Geral**, administradores veem **📥 Atualizar Agendamentos** e **Histórico de importações**.

1. **Selecionar** o .xlsx (ou .xls exportado como HTML/XML; o .xls binário antigo pede "Salvar como .xlsx").
2. **Analisar**: a planilha é lida no navegador; nada é gravado. As colunas são encontradas pelo **nome do cabeçalho** (`IMPORT_COLUMNS` em `www/index.html`; para outro padrão, acrescente o nome em `aliases`). Faltando coluna obrigatória, a importação para e informa qual.
3. **Revisar**: unidade identificada por condomínio + bloco/conjunto + número (nunca pelo nome do cliente). Campo vazio no sistema é preenchido; valor igual fica "sem alteração"; valor diferente vira **conflito** (Manter sistema / Usar planilha, individual ou por campo); planilha vazia nunca apaga; unidade ausente na planilha nunca é alterada. Unidade, bloco ou condomínio inexistente, data/horário/status inválidos, linhas duplicadas e cliente diferente são sinalizados.
4. **Confirmar** e **Atualizar**: `public.aplicar_importacao_agendamentos` aplica tudo em uma transação, só para administradores dos condomínios, e pula campos alterados no sistema depois da prévia.

A planilha só atualiza **Cliente, Data, Horário e Status** da vistoria. As colunas do Atendimento ao Cliente (**Responsável pelo agendamento, Observação e Etapa de Categoria Atendimento**) são ignoradas: nem são lidas, e a função do banco recusa qualquer alteração em responsável, observações ou etapa vinda da importação. O responsável pela vistoria e as observações continuam sendo definidos só no site.

Origem de cada campo em `client_inspections.field_sources` / `updated_source` (MANUAL, PLANILHA, SISTEMA). Histórico em `importacoes_agendamentos` e `importacoes_agendamentos_itens`.

## Cadastro de condomínios

Em **Configurações › Configuração de Condomínio** (administradores):

- **+ Novo condomínio:** nome, tipo, cor de destaque e descrição (opcional; se vazia, é gerada).
  - **Apartamentos:** gera automaticamente 448 unidades, no mesmo modelo do Alto do Jerivá (blocos A–H × Térreo e 1º ao 6º × aptos 01–08).
  - **Casas:** escolha o intervalo de conjuntos (ex.: A até P) e informe a quantidade de casas de cada um; são geradas as casas 01…N de cada conjunto, como no Alto do Buriti.
- Quem cadastra e todos os demais administradores recebem acesso de administrador ao novo condomínio.
- **Conjuntos e casas** (condomínios de casas): acrescentar/remover conjuntos e ajustar quantidades. Casas com dados cadastrados (cliente, data, status…) não podem ser removidas.
- **Cor** aparece no cartão da escolha de obra, no botão do condomínio no cabeçalho e nas etiquetas da Visão Geral.
- **Nomes na planilha de Vendas:** outros nomes do condomínio usados na planilha (comparados sem acento/maiúsculas). A importação vincula as linhas pelo nome do condomínio e lista o que não for encontrado.

Banco: colunas `projects.kind`, `color`, `import_aliases`, `created_by` e funções `criar_condominio` e `atualizar_estrutura_condominio` (transação única, só administradores).

## Esqueci minha senha e Manter conectado

- **Esqueci minha senha** (tela de login): o usuário informa o e-mail e recebe um **código de 6 dígitos**. Depois digita o código, a nova senha (mínimo de 8 caracteres) e a confirmação. A mensagem é sempre a mesma, exista ou não o e-mail, para não revelar quem tem cadastro. Depois da troca, todas as sessões abertas são encerradas e o usuário entra de novo com a nova senha. As senhas ficam só no Supabase Auth, com hash; nada é salvo em tabela própria nem em planilha.
- **Manter conectado** (vem marcado): a sessão fica salva no aparelho por até 30 dias. Desmarcado, ela dura só enquanto a aba ou o app estiver aberto. **Sair** encerra apenas a sessão daquele aparelho.
- Configuração no painel do Supabase (Authentication):
  1. **Emails → Reset Password**: use `{{ .Token }}` no corpo (o código) em vez do link `{{ .ConfirmationURL }}`.
  2. **Providers/Email → Email OTP Expiration**: 1800 segundos (30 minutos).
  3. **Emails → SMTP Settings**: configure um SMTP próprio. Sem ele, o Supabase só entrega e-mails para membros da equipe do projeto, com limite baixo por hora.

## Revistoria: data e responsável

- A data da revistoria sempre foi gravada (`client_inspections.reinspection_date`); a lista só não a exibia. Agora a lista do condomínio e a Visão Geral mostram **Data vistoria** e **Data revistoria** lado a lado, com o **Responsável** de cada uma.
- O responsável pela revistoria tem coluna própria (`reinspection_responsible`) e não substitui o responsável da vistoria primária (`responsible`).
- Ao escolher **Revistoria Finalizada**, o status é gravado na hora; data e responsável da revistoria aparecem no popup e são **opcionais**.
- Cada unidade guarda a revistoria mais recente; as anteriores ficam no registro de logs.
- Filtros da lista: período por data da vistoria, da revistoria ou ambas; ordenação por qualquer uma das duas. **Imprimir** e **Exportar** (CSV que abre no Excel) incluem as duas datas e os dois responsáveis.

## Excluir obra

- Em Configurações › Configuração de Condomínio, cada obra tem **Excluir obra** (só administradores da obra). A confirmação mostra quantas unidades, vistorias com dados e usuários são afetados e exige digitar o nome da obra.
- A exclusão é lógica (`projects.archived_at` / `archived_by`): nada é apagado. A obra some de todas as telas, do seletor e da Visão Geral, e pode ser restaurada em **Obras excluídas**. Exclusão e restauração ficam registradas em `audit_log` (ações `ARCHIVE`/`RESTORE`) com usuário e horário.

## Plataforma: Suprimentos › Relatório de Pedidos

- O antigo "Relatório de Controle de Pedidos" (que lia a planilha do Google) agora faz parte da plataforma, em `/suprimentos/pedidos`, e lê o Supabase (`pedidos_registros_1187`, pela view `pedidos_registros_atual`). Layout no mesmo padrão do site de Vistorias, com tema claro/escuro, celular e impressão.
- Acesso por módulo: só quem tem permissão em Suprimentos vê o card no seletor de obras e consegue ler os dados (RLS). Os administradores do módulo liberam acessos em Configurações › Módulos.
- Arquitetura, segurança e como criar novos módulos: [docs/PLATAFORMA.md](docs/PLATAFORMA.md).
- Mapeamento planilha → HTML → Supabase e regras de cálculo: [docs/suprimentos-pedidos-mapeamento.md](docs/suprimentos-pedidos-mapeamento.md).
