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
- Um administrador revisa as solicitações em **Acessos**, escolhe o nível e libera ou bloqueia cada conta.
- Depois do login, o usuário escolhe entre os empreendimentos ativos vinculados à sua conta. A função e as permissões são carregadas separadamente para cada obra.
- O painel atual está registrado como o módulo do **Alto do Jerivá**. Novos condomínios podem receber módulos próprios, evitando misturar fluxos operacionais diferentes.
- As regras do banco garantem: administrador edita tudo; cada frente edita sua própria etapa; visitante apenas visualiza; somente administrador edita a vistoria do cliente e a data planejada.

## Desenvolvimento local

Copie `.env.example` para `.env`, preencha as chaves públicas e execute:

```powershell
pnpm build
npx serve www
```

O build da Vercel gera `www/config.js` e `www/supabase-client.js` automaticamente.
