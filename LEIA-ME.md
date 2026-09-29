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
- Cadastro: o novo usuário fica **pendente** até um administrador aprovar em cada condomínio. Em *Authentication → URL Configuration* do Supabase, o **Site URL** e os **Redirect URLs** precisam apontar para o endereço do site na Vercel (não `localhost`), senão o link de confirmação de e-mail abre uma página inexistente.
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
No app o endereço interno é `capacitor://localhost`; para o link do e-mail de confirmação abrir o site, defina `APP_PUBLIC_URL` (endereço da Vercel) no `.env` antes do build — sem ele o Supabase usa o **Site URL**.
