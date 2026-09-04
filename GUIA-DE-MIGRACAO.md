# Migração do Vistorias AMCI para Supabase Free + Vercel

## Resultado final

O site continua hospedado na Vercel, mas deixa de consultar o Apps Script. Cada alteração passa a atualizar somente um registro no Postgres e chega aos demais usuários pelo Realtime. O login passa a usar Supabase Auth; nenhuma senha fica em planilha, URL ou `localStorage`.

## 1. Faça uma cópia de segurança e marque a janela de virada

1. Faça cópia das duas planilhas atuais.
2. Avise a equipe de uma janela curta sem edições.
3. Não desligue o app antigo ainda. Ele será o plano de retorno até a validação final.

Planilhas de origem:

- planilha principal: abas `OBRA` e `CRONOGRAMA`;
- planilha de clientes: aba `CLIENTE`.

## 2. Crie o projeto gratuito no Supabase

1. Em <https://supabase.com/dashboard>, crie um projeto.
2. Escolha a região mais próxima dos usuários, normalmente São Paulo quando disponível.
3. Guarde o **Project ref**, a URL do projeto, a **publishable key** e uma **secret key**.
4. Em **Authentication > Providers > Email**, mantenha login por e-mail/senha e desative novos cadastros públicos. Os usuários serão criados apenas por administradores.

> A secret key ignora RLS. Use-a somente no computador durante a importação. Nunca a configure na Vercel.

## 3. Instale e vincule este projeto

No terminal, dentro desta pasta:

```powershell
pnpm install --frozen-lockfile
pnpm exec supabase login
pnpm exec supabase link --project-ref SEU_PROJECT_REF
```

O `Project ref` aparece na URL do Dashboard e em **Project Settings**.

## 4. Crie as tabelas e regras de segurança

Execute:

```powershell
pnpm exec supabase db push
```

Isso aplica a migração versionada em `supabase/migrations/`, que cria:

- projeto, perfis e vínculos de usuários;
- unidades, quatro etapas por unidade, vistorias de cliente e cronograma;
- controle otimista de versão para impedir sobrescrita silenciosa;
- RLS por projeto e função;
- trilha de auditoria;
- publicação das três tabelas operacionais no Realtime.

Se o comando mostrar o SQL planejado, revise e confirme. Não edite as tabelas manualmente no Dashboard: alterações futuras devem virar novas migrações.

## 5. Crie o primeiro administrador

1. No Dashboard, abra **Authentication > Users > Add user > Create new user**.
2. Cadastre seu e-mail e uma senha com pelo menos 8 caracteres.
3. Abra **SQL Editor**, troque o e-mail no comando abaixo e execute uma vez:

```sql
insert into public.project_members (project_id, user_id, role, active)
select p.id, u.id, 'admin', true
from public.projects as p
join auth.users as u on lower(u.email) = lower('SEU_EMAIL@EMPRESA.COM')
where p.slug = 'alto-do-jeriva'
on conflict (project_id, user_id) do update
set role = 'admin', active = true, updated_at = now();
```

Confirme o vínculo:

```sql
select p.slug, pr.email, pm.role, pm.active
from public.project_members as pm
join public.projects as p on p.id = pm.project_id
join public.profiles as pr on pr.id = pm.user_id;
```

## 6. Exporte e valide os dados das planilhas

No Google Sheets, abra cada aba e use **Arquivo > Fazer download > Valores separados por vírgulas (.csv)**. Coloque na pasta `data-import` com os nomes exatos:

- `OBRA.csv`
- `CLIENTE.csv`
- `CRONOGRAMA.csv`

Crie `.env` a partir de `.env.example` e preencha:

```dotenv
SUPABASE_URL=https://SEU-PROJETO.supabase.co
SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
SUPABASE_SECRET_KEY=sb_secret_...
APP_PROJECT_SLUG=alto-do-jeriva
```

Valide sem gravar:

```powershell
pnpm import:data -- --dry-run
```

O resultado esperado para a base atual é aproximadamente:

- 448 unidades;
- 1.792 etapas de obra;
- 448 registros de vistoria do cliente;
- 224 itens de cronograma (56 pavimentos × 4 frentes).

Corrija qualquer aviso de cabeçalho, data ou horário antes de continuar.

## 7. Importe a carga final

Com as edições no sistema antigo pausadas, gere os CSVs finais e execute:

```powershell
pnpm import:data
```

A importação usa `upsert`, portanto pode ser repetida caso a conexão caia. Não a repita depois que a equipe começar a editar no sistema novo, pois os CSVs antigos poderiam substituir dados atuais.

Depois da carga, remova a secret key do arquivo `.env` ou guarde o arquivo somente em local protegido. Os CSVs e `.env` já estão ignorados pelo Git.

## 8. Publique a função de administração de usuários

Execute:

```powershell
pnpm exec supabase functions deploy admin-users
```

A função exige JWT válido, confirma no banco que o chamador é administrador e só então usa a API administrativa do Auth. A secret key fica no ambiente protegido da função, não no HTML.

Entre no app com o primeiro administrador e use **Acessos & Logs** para recriar cada conta da antiga aba `ACESSOS`. Use e-mails reais e senhas novas; não migre as senhas em texto puro.

## 9. Configure o projeto existente na Vercel

Em **Vercel > Project > Settings > Environment Variables**, adicione para Production e Preview:

```text
SUPABASE_URL=https://SEU-PROJETO.supabase.co
SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
APP_PROJECT_SLUG=alto-do-jeriva
```

Não adicione `SUPABASE_SECRET_KEY`.

Garanta que a Vercel use:

- Install Command: `pnpm install --frozen-lockfile`
- Build Command: `pnpm build`
- Output Directory: `www`

O arquivo `vercel.json` já contém essas opções. Envie esta pasta ao repositório ligado à Vercel ou faça o deploy pelo fluxo que você já utiliza.

## 10. Teste antes da virada

Abra o endereço de Preview da Vercel em duas janelas, preferencialmente uma normal e uma anônima, com dois usuários diferentes.

Valide:

1. login por e-mail e restauração da sessão após atualizar a página;
2. administrador edita qualquer frente, vistoria do cliente e planejamento;
3. usuário `acab`, `inst`, `qual` ou `astec` edita somente sua frente;
4. usuário `visitante` não consegue editar;
5. uma mudança feita na primeira janela aparece na segunda sem atualizar a página;
6. duas edições simultâneas no mesmo item não sobrescrevem silenciosamente: uma recebe aviso de conflito e recarrega o valor atual;
7. **Acessos & Logs** lista contas e auditoria apenas para administrador;
8. nenhum dado operacional aparece antes do login.

Também teste no celular e com a rede móvel.

## 11. Faça a virada

1. Confirme que não houve edição nas planilhas desde o CSV final. Se houve, repita a carga antes de liberar o novo app.
2. Promova o deploy de Preview para Production na Vercel.
3. Oriente a equipe a usar o novo endereço e as novas credenciais.
4. Deixe as planilhas como somente leitura por alguns dias.
5. Só depois arquive a implantação do Apps Script e a aba `ACESSOS` antiga.

Para retorno emergencial, faça rollback do deploy na Vercel e reabra temporariamente o app antigo. Registre manualmente as alterações feitas no Supabase durante esse intervalo antes de voltar de novo.

## 12. Use o Google Sheets apenas como relatório

Evite sincronização bidirecional. Para relatórios, exporte tabelas ou consultas do Supabase para CSV e importe em uma planilha separada, sempre em sentido único **Supabase → Sheets**. Assim o Postgres permanece como a única fonte de verdade.

Com `SUPABASE_URL` e `SUPABASE_SECRET_KEY` disponíveis apenas no `.env` local, gere os três relatórios compatíveis com o formato antigo:

```powershell
pnpm export:reports
```

Os arquivos serão criados em `exports/`. Importe-os em uma planilha exclusiva de relatórios; não permita que essa planilha grave de volta no banco.

## Referências oficiais

- Supabase Auth: <https://supabase.com/docs/guides/auth>
- Row Level Security: <https://supabase.com/docs/guides/database/postgres/row-level-security>
- Realtime/Postgres Changes: <https://supabase.com/docs/guides/realtime/postgres-changes>
- Edge Functions e autenticação: <https://supabase.com/docs/guides/functions/auth>
- Vercel Environment Variables: <https://vercel.com/docs/environment-variables>
