# Testes de banco do Controle de Chaves

Rodam num Postgres local (não no Supabase de produção). O `reset.sh` recria o banco `amci` com um
stub mínimo do ambiente Supabase (`00_stub.sql`: papéis anon/authenticated, `auth.uid()`, publicação
de tempo real) e aplica as migrations de `supabase/migrations` (menos as do robô ERP, que dependem
de tabelas criadas pelo UAU-Sync). Com um prefixo, para depois dessa migration.

```bash
# Postgres 16+ escutando em /var/tmp:55432 (ou defina PGHOST/PGPORT), usuário postgres sem senha
scripts/db-tests/chaves/reset.sh 20261024120000
cd scripts/db-tests/chaves && npm i --no-save pg@8 && node test.mjs
```

O `test.mjs` cria dados no modelo anterior (cópias cadastradas e uma retirada), aplica as migrations
seguintes (inclusive `20261103120000_chaves_transferencia_simples.sql`) e confere, como usuário
autenticado (como o PostgREST): situação inicial calculada sem apagar nada, permissões por papel
(admin, revistorias, visitante, outro condomínio, sem acesso), escrita só pela função, setor e
responsável obrigatórios, mesma situação recusada, clique repetido sem duplicar, tela desatualizada
recusada, duas transferências simultâneas (só uma grava), chave perdida (permissões, campos
obrigatórios, uma ocorrência aberta por unidade, sem transferência até regularizar, chaveiro, cópia,
regularização, chave encontrada, vistoria intacta), histórico completo e imutável, casas do Buriti,
condomínio arquivado e exclusão em cascata.
