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
pnpm exec supabase functions deploy suprimentos-atualizar
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
- Um administrador revisa as solicitações em **Liberações › Acesso de usuários** (menu do usuário na tela inicial; filtros por obra/condomínio e status), escolhe o nível e aprova ou rejeita cada conta.
- Depois do login, o usuário escolhe entre os empreendimentos ativos vinculados à sua conta. A função e as permissões são carregadas separadamente para cada obra.
- Condomínios disponíveis: **Alto do Jerivá** (448 apartamentos, blocos/pavimentos) e **Alto do Buriti** (319 casas, conjuntos A a R). Todos usam as mesmas tabelas (`units`, `client_inspections`...), separadas por `project_id`; as consultas e o RLS retornam apenas os dados do condomínio selecionado.
- **Visão Geral** (botão na seleção de obra): agendamentos de todos os condomínios liberados ao usuário numa só lista, com filtros, resumo e atalho para abrir a unidade. Usa as mesmas tabelas (`client_inspections` + `units`), sem cópia de dados.
- **Acomp. Técnico** (Engenheiro, Arquiteto ou Sem Acomp. Técnico): campo `client_inspections.technical_escort`, editável na Lista e no popup do Mapa de qualquer condomínio.
- A relação de clientes do Alto do Buriti foi importada direto no Supabase a partir da planilha de vendas (sem CPF). Dados pessoais não vão para o Git.
- Cadastro: o novo usuário fica **pendente** até um administrador aprovar em cada condomínio. Em *Authentication → URL Configuration* do Supabase, o **Site URL** e os **Redirect URLs** precisam apontar para `https://www.amci.com.br` (Site URL) e `https://www.amci.com.br/**` (Redirect URLs; mantenha também `https://amci-vistoria.vercel.app/**`, endereço antigo que continua funcionando), não `localhost`, senão o link de confirmação de e-mail abre uma página inexistente.
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
No app o endereço interno é `capacitor://localhost`; o link do e-mail de confirmação aponta para `https://www.amci.com.br` (padrão de `APP_PUBLIC_URL` em `scripts/build.mjs`, pode ser trocado no `.env`).

## Tema claro/escuro

- Botão de sol/lua no login, no cabeçalho, na escolha de obra, na Visão Geral, na importação e nas páginas de administração; a escolha fica salva no aparelho (`localStorage`, chave `amci-theme`).
- O Modo Escuro é gerado automaticamente a partir do CSS do Modo Claro por `scripts/theme-dark.mjs` (roda no `pnpm build`; o `pnpm check` falha se estiver desatualizado). Ajustes manuais ficam logo após o bloco gerado em `www/index.html`.
- As cores de status (Não agendado, Agendado, Remarcado, Revistoria, Revistoria Finalizada, Aprovado, Processo em Andamento) são iguais nos dois temas.
- **Processo em Andamento** (cinza; gravado no banco como "Inadimplência") é o último status da lista: aparece na legenda, no popup da unidade, nos filtros, no resumo e na Visão Geral. Não conta como unidade vistoriada nem como "agendada p/ cliente"; na tela inicial entra em "a agendar". Na importação da planilha, o texto "Inadimplência" é reconhecido.
- **Estatística Geral** (3ª aba do condomínio, ao lado de Resumo Geral e Vistoria · Cliente; "Estatística" na barra inferior do celular): layout compacto com indicadores, aprovação/reprovação por acompanhamento técnico, comparativo de taxas e vistoriador × acompanhamento (tabela ordenável no computador; cartões por vistoriador abaixo de 1000px). Calculada no navegador direto dos dados de client_inspections já carregados para o condomínio (sem cópia nem consulta à parte; atualiza em tempo real). Regra igual à do Resumo Geral e da planilha Excel: vistoriada = Aprovado + Revistoria + Revistoria Finalizada; aprovação = Aprovado ÷ vistoriadas; reprovação = (Revistoria + Revistoria Finalizada) ÷ vistoriadas; 1 registro por unidade (a revistoria não duplica), contado para o Responsável da vistoria.
- A área da barra de status no iPhone (tela cheia/app) usa `--chrome-top`, que acompanha o tema.

## Importação de agendamentos (Excel)

Na **Visão Geral**, administradores veem **📥 Atualizar Agendamentos** e **Histórico de importações**.

1. **Selecionar** o .xlsx (ou .xls exportado como HTML/XML; o .xls binário antigo pede "Salvar como .xlsx").
2. **Analisar**: a planilha é lida no navegador; nada é gravado. As colunas são encontradas pelo **nome do cabeçalho** (`IMPORT_COLUMNS` em `www/index.html`; para outro padrão, acrescente o nome em `aliases`). Faltando coluna obrigatória, a importação para e informa qual.
3. **Revisar**: unidade identificada por condomínio + bloco/conjunto + número (nunca pelo nome do cliente). Campo vazio no sistema é preenchido; valor igual fica "sem alteração"; valor diferente vira **conflito** (Manter sistema / Usar planilha, individual ou por campo); planilha vazia nunca apaga; unidade ausente na planilha nunca é alterada. Unidade, bloco ou condomínio inexistente, data/horário/status inválidos, linhas duplicadas e cliente diferente são sinalizados.
4. **Confirmar** e **Atualizar**: `public.aplicar_importacao_agendamentos` aplica tudo em uma transação, só para administradores dos condomínios, e pula campos alterados no sistema depois da prévia.

A planilha só atualiza **Cliente, Data, Horário e Status** da vistoria. As colunas do Atendimento ao Cliente (**Responsável pelo agendamento, Observação e Etapa de Categoria Atendimento**) são ignoradas: nem são lidas, e a função do banco recusa qualquer alteração em responsável, observações ou etapa vinda da importação. O responsável pela vistoria e as observações continuam sendo definidos só no site.

Origem de cada campo em `client_inspections.field_sources` / `updated_source` (MANUAL, PLANILHA, SISTEMA). Histórico em `importacoes_agendamentos` e `importacoes_agendamentos_itens`.

### Revistorias da planilha (colunas K, L e M)

A mesma importação lê as colunas de revistoria do Relatório 854 (opcionais; reconhecidas por "revistoria" no nome, inclusive o erro de digitação "REVSITORIA", e lidas antes das colunas da vistoria):

| Coluna | Cabeçalho | Gravado em |
|---|---|---|
| K | STATUS DA REVISTORIA | `revistorias.status` (Agendada, Em revistoria, Aprovada, Reprovada) e o texto original em `status_planilha` |
| L | DATA DA REVISTORIA | `revistorias.data` |
| M | HORÁRIO DO AGENDAMENTO REVISTORIA | `revistorias.horario` |

- Cada unidade pode ter várias revistorias (nº 1, 2…), na tabela `public.revistorias`. O **status da vistoria nunca muda** por causa da revistoria (coluna H continua indo só para `client_inspections.status`).
- Sem duplicar: a linha é comparada com a revistoria mais recente da unidade. Agendada/Em revistoria → a mesma revistoria é atualizada (status, reagendamento). Reprovada + data posterior na planilha → revistoria nova (nº seguinte). Revistoria já Aprovada/Reprovada que a planilha altere → **conflito** (Manter sistema / Usar planilha). Importar de novo a mesma planilha não muda nada.
- Planilha vazia nunca apaga. Status desconhecido, data ou horário inválidos são ignorados com aviso na linha, sem interromper a importação (o resto da linha é importado).
- A **Data da revistoria** da unidade (`reinspection_date`, usada na lista, filtros, impressão e exportação) acompanha a revistoria quando está vazia ou igual à data anterior; se alguém a mudou no site, é mantida e registrada como "Mantido do sistema".
- Onde aparece: canto colorido nas unidades do mapa (cor = status da revistoria), coluna **Revistoria** e filtro na lista, histórico no popup da unidade, indicadores no Resumo Geral, coluna na Visão Geral e colunas no fim da exportação.
- Gravação só por `aplicar_importacao_agendamentos` (parâmetro `p_revistorias`, só administradores); leitura por RLS para quem tem acesso ao condomínio. Testes: `scripts/test-revistorias.mjs` (regras, no `pnpm check`) e `scripts/db-tests/revistorias/test.mjs` (banco local).

## Cadastro de condomínios

Em **Configuração de Condomínios** (menu do usuário, administradores):

- **+ Novo condomínio:** nome, tipo, cor de destaque e descrição (opcional; se vazia, é gerada).
  - **Apartamentos:** gera automaticamente 448 unidades, no mesmo modelo do Alto do Jerivá (blocos A–H × Térreo e 1º ao 6º × aptos 01–08).
  - **Casas:** escolha o intervalo de conjuntos (ex.: A até P) e informe a quantidade de casas de cada um; são geradas as casas 01…N de cada conjunto, como no Alto do Buriti.
- Quem cadastra e todos os demais administradores recebem acesso de administrador ao novo condomínio.
- **Conjuntos e casas** (condomínios de casas): acrescentar/remover conjuntos e ajustar quantidades. Casas com dados cadastrados (cliente, data, status…) não podem ser removidas.
- **Cor** aparece no cartão da escolha de obra, no botão do condomínio no cabeçalho e nas etiquetas da Visão Geral.
- **Nomes na planilha de Vendas:** outros nomes do condomínio usados na planilha (comparados sem acento/maiúsculas). A importação vincula as linhas pelo nome do condomínio e lista o que não for encontrado.

Banco: colunas `projects.kind`, `color`, `import_aliases`, `created_by` e funções `criar_condominio` e `atualizar_estrutura_condominio` (transação única, só administradores).

## Esqueci minha senha e Manter conectado

- **Esqueci minha senha** (tela de login): o usuário informa o e-mail e recebe um **link** (e-mail padrão do Supabase). Ao abrir o link, o sistema pede a nova senha (mínimo de 8 caracteres) e a confirmação. O link só pode ser usado uma vez. A mensagem é sempre a mesma, exista ou não o e-mail, para não revelar quem tem cadastro. Depois da troca, todas as sessões abertas são encerradas e o usuário entra de novo com a nova senha. As senhas ficam só no Supabase Auth, com hash; nada é salvo em tabela própria nem em planilha.
- **Manter conectado** (vem marcado): a sessão fica salva no aparelho por até 30 dias. Desmarcado, ela dura só enquanto a aba ou o app estiver aberto. **Sair** encerra apenas a sessão daquele aparelho.
- Configuração no painel do Supabase (Authentication):
  1. **URL Configuration**: o endereço do sistema (`https://www.amci.com.br/**`) precisa estar em *Redirect URLs*, senão o link volta para o *Site URL*.
  2. **Emails → Reset Password**: o modelo padrão (com `{{ .ConfirmationURL }}`) já serve; não use `{{ .Token }}`.
  3. **Emails → SMTP Settings**: configure um SMTP próprio. Sem ele, o Supabase só entrega e-mails para membros da equipe do projeto, com limite baixo por hora.

## Revistoria: data e responsável

- A data da revistoria sempre foi gravada (`client_inspections.reinspection_date`); a lista só não a exibia. Agora a lista do condomínio e a Visão Geral mostram **Data vistoria** e **Data revistoria** lado a lado, com o **Responsável** de cada uma.
- O responsável pela revistoria tem coluna própria (`reinspection_responsible`) e não substitui o responsável da vistoria primária (`responsible`).
- Ao escolher **Revistoria Finalizada**, o status é gravado na hora; data e responsável da revistoria aparecem no popup e são **opcionais**.
- Cada unidade guarda a revistoria mais recente; as anteriores ficam no registro de logs.
- Filtros da lista: período por data da vistoria, da revistoria ou ambas; ordenação por qualquer uma das duas. **Imprimir** e **Exportar** (CSV que abre no Excel) incluem as duas datas e os dois responsáveis.

## Excluir obra

- Em Configuração de Condomínios, cada obra tem **Excluir obra** (só administradores da obra). A confirmação mostra quantas unidades, vistorias com dados e usuários são afetados e exige digitar o nome da obra.
- A exclusão é lógica (`projects.archived_at` / `archived_by`): nada é apagado. A obra some de todas as telas, do seletor e da Visão Geral, e pode ser restaurada em **Obras excluídas**. Exclusão e restauração ficam registradas em `audit_log` (ações `ARCHIVE`/`RESTORE`) com usuário e horário.

## Fonte

- **Inter** (Google Fonts, pesos 300 a 900 com tamanho óptico) em toda a versão web: computador, Android, iPhone e iPad, inclusive na impressão da lista. Só o app instalado no iPhone (Capacitor) usa a fonte do sistema (SF Pro).
- O texto usa suavização e kerning (`-webkit-font-smoothing`, `text-rendering:optimizeLegibility`) e não sintetiza negrito/itálico (`font-synthesis:none`), para ficar nítido.

## Cabeçalho único (HM Bar)

- Todas as telas usam o mesmo cabeçalho: tela inicial, condomínio, Visão Geral, Importação, Liberações, Configuração de Condomínios, Logs e Relatórios. Mesma altura, logos, tema e botão do usuário (HM User); cada página só acrescenta os botões dela, à direita, ao lado do tema:
  - **Condomínio:** Início e o condomínio atual. As páginas *Resumo Geral* e *Vistoria · Cliente* ficam no topo do conteúdo, em dois cartões com uma descrição de cada uma (no celular, na barra inferior).
  - **Visão Geral** e **Administração:** Início. **Importação:** voltar à Visão Geral.
  - **Relatórios:** Início e as abas *Suprimentos* e *Contratos*.
- Código: `src/platform/ui/hmbar.js` (HTML) e `src/platform/styles/hmbar.css` (estilos). No `www/index.html` a barra é gerada pelo build entre `<!-- HM-BAR -->` e `<!-- /HM-BAR -->` (botões de Vistorias em `src/modules/vistorias/hmbar.js`) e existe uma única vez: a página a move para a tela aberta. Para mudar o cabeçalho, edite esses arquivos e rode `pnpm build`.

## Tela inicial (central de acesso)

- Barra verde com busca, tema e o menu do usuário. O botão do usuário mostra o número de acessos pendentes.
- **Menu do usuário › Administração** (só para administradores): **Liberações** (abas *Acesso de usuários* e *Acesso aos módulos*), **Configuração de Condomínios** e **Logs**. Cada uma abre uma página própria, com o mesmo cabeçalho da tela inicial (Início, tema e menu do usuário) e endereço próprio (`#liberacoes`, `#condominios`, `#logs`); o Voltar do navegador retorna à tela inicial. Quem vê cada página segue as mesmas regras de antes: administradores de condomínio veem as três; administradores de módulo veem Liberações › Acesso aos módulos.
- Saudação com a data e o menu em dois grupos: **Vistorias · Condomínios** (um card por condomínio + Visão Geral) e **Relatórios** (Suprimentos e Contratos, com a data da última atualização do ERP).
- Cada condomínio mostra uma barra compacta com os mesmos critérios do Resumo Geral: realizadas (aprovado + revistoria + revistoria finalizada), agendadas (agendado + remarcado) e a agendar (não agendado).
- A busca filtra os cards de condomínios e relatórios, sem acento.

## Controle de Chaves (claviculário)

Quarta aba do condomínio, ao lado de Resumo Geral, Vistoria · Cliente e Estatística Geral ("Chaves" na barra inferior do celular). O mapa é o mesmo das vistorias. Código em `src/modules/chaves/` (`model.js` regras, `service.js` Supabase, `index.js` tela), compilado em `www/chaves.js`; o CSS fica no `www/index.html`.

- **Situação das chaves** (cor da unidade): Base (azul, no claviculário), CX (verde), Asstec (laranja), Produção (vermelho) e Sem status (cinza). Marcadores:
  - bolinha vermelha = devolução pendente (previsão vencida);
  - "!" amarelo = divergência;
  - cor dividida = retirada parcial;
  - borda tracejada = quantidades a cadastrar.
- **Status da vistoria:** a barra na parte de baixo de cada unidade e o selo no popup mostram o status de `client_inspections`. O módulo só lê esse status, não grava nem copia.
- **Indicadores:** unidades, todas as chaves na Base, com retiradas, devoluções pendentes, sem status e movimentações de hoje. Os alertas de pendência, divergência e "a cadastrar" filtram o mapa.
- **Filtros:** condomínio, bloco ou conjunto, unidade, tipologia, status da vistoria, situação das chaves, setor, e os atalhos "Aprovadas com chaves disponíveis" e "Aguardando vistoria ou revistoria".
- **Popup da unidade:**
  - identificação: condomínio, bloco/apto, tipologia e vistoria;
  - cada chave por categoria (Entrada, Quarto n, Banheiro n), com as cópias e onde cada uma está;
  - abas Retirar, Devolver, Transferir, Ocorrência e Cadastro (admin);
  - histórico completo da unidade.
- **Regras:**
  - retirada parcial permitida; só sai chave ativa e na Base;
  - chave já retirada só muda de mãos por transferência;
  - exige responsável, data/hora e as chaves movimentadas, e pede confirmação antes de gravar;
  - data/hora e usuário são registrados automaticamente;
  - o mesmo envio nunca grava duas vezes;
  - duas retiradas simultâneas da mesma chave: a segunda é recusada;
  - o cadastro só muda com todas as chaves na Base;
  - o status da vistoria nunca é alterado pelo módulo.
- **Permissões** (papel no condomínio): admin cadastra chaves e tipologia e movimenta; revistorias movimenta; visitante só consulta. Condomínio arquivado não aparece.
- **Banco** (migration `20261024120000_controle_chaves.sql`, só aditiva):
  - `units.quartos` guarda a tipologia. No Alto do Jerivá: finais 01, 04, 05 e 08 = 2 quartos; finais 02, 03, 06 e 07 = 3 quartos. Nos outros condomínios fica "não informada" até o admin definir.
  - `chaves_unidades` guarda o cadastro da unidade no claviculário.
  - `chaves` tem uma linha por cópia física, com o local atual.
  - `chaves_movimentacoes` é o histórico imutável: nem o dono do banco altera; só sai em cascata se a unidade for apagada.
  - Escrita só pelas funções `chaves_cadastrar`, `chaves_retirar`, `chaves_transferir`, `chaves_devolver`, `chaves_ocorrencia` e `chaves_definir_tipologia` (security definer, com trava das chaves e `pedido_id` contra duplicidade). Leitura por RLS, para membros do condomínio.
- **Carga inicial:** planilha "Levantamento Inicial" do Alto do Jerivá, com 448 unidades. "Tem chave SIM" = chaves na Base (345); "NÃO" = sem status (103). A coluna "Qtd. Chaves" estava vazia, então as quantidades de cada unidade são cadastradas no popup. As observações "24.10" foram desconsideradas.
- **Sem a migration aplicada**, a aba avisa que o módulo não está instalado; o resto das Vistorias continua igual.
- **Testes:**
  - regras da tela: `scripts/test-chaves.mjs` (no `pnpm check`);
  - banco (RLS, concorrência, histórico): `scripts/db-tests/chaves/` (Postgres local).

## Plataforma: Relatórios (Suprimentos e Contratos)

- Página única `/relatorios`, com uma aba por módulo:
  - **Suprimentos:** o antigo "Relatório de Controle de Pedidos" (que lia a planilha do Google), agora lendo o Supabase (`pedidos_registros_1187`, pela view `pedidos_registros_atual`). O endereço antigo `/suprimentos/pedidos` abre esta aba.
  - **Contratos:** contratos, medições e saldos por obra, lendo `contratos_registros_549` (view `contratos_registros_atual`). Hierarquia Obra → Contrato → itens/serviços (expansível).
- Layout no mesmo padrão do site de Vistorias, com tema claro/escuro, celular e impressão.
- Acesso por módulo: cada usuário vê só as abas (e os cards no seletor de obras) dos módulos liberados, e só consegue ler esses dados (RLS). Os administradores do módulo liberam acessos em Liberações › Acesso aos módulos.
- Arquitetura, segurança e como criar novos relatórios: [docs/PLATAFORMA.md](docs/PLATAFORMA.md).
- Regras e mapeamentos: [Pedidos](docs/suprimentos-pedidos-mapeamento.md) · [Contratos](docs/contratos-mapeamento.md).
- Situação da automação UAU-Sync (GitHub Actions) no topo de cada relatório, lida de `pedidos_execucoes`: se a última execução deu certo (ou o motivo da falha), data e horário dos dados exibidos, o que mudou desde a atualização anterior (pedidos novos, contratos e itens novos, diferença de linhas) e o histórico das últimas execuções. A página confere a cada minuto e avisa quando chegam dados novos.
- **Atualizar relatório agora** (aba Suprimentos, só administradores do módulo): ao lado da situação da automação, um botão discreto pede confirmação e executa o mesmo robô da atualização agendada (workflow "UAU → Supabase" do repositório UAU-Sync), só com o Relatório 1187 e os Pedidos de Compra. A tela mostra *aguardando*, *executando*, *concluído* ou *erro* (com o motivo) e, ao concluir, oferece recarregar os dados.
  - Backend: função `suprimentos-atualizar` (Edge Function). Ela confere a cada chamada se quem chamou é administrador ativo de Suprimentos (`module_members`); leitores e outros usuários recebem 403, inclusive chamando a API direto. O token do GitHub fica só nos secrets da função.
  - Proteção contra execução dupla: uma execução manual ativa por vez (índice único) e nenhuma enquanto o workflow estiver na fila ou rodando, inclusive o agendado. O workflow já tem `concurrency: uau-sync`.
  - Registro: tabela `robo_execucoes_manuais` (quem pediu, quando, execução do GitHub, início, fim, resultado e detalhe da falha), que só os administradores do módulo leem. O resultado de cada relatório continua em `pedidos_execucoes`.
  - Configuração (uma vez): crie no GitHub um token *fine-grained* só para o repositório UAU-Sync, com permissão **Actions: Read and write**. Depois: `pnpm exec supabase db push`, `pnpm exec supabase secrets set UAU_SYNC_GITHUB_TOKEN=<token>` e `pnpm exec supabase functions deploy suprimentos-atualizar`. Sem o token, o botão aparece desativado ("Execução manual ainda não configurada").
