# Testes de banco do Controle de Chaves

Rodam num Postgres local (não no Supabase de produção). O `reset.sh` recria o banco `amci` com um
stub mínimo do ambiente Supabase (`00_stub.sql`: papéis anon/authenticated, `auth.uid()`, publicação
de tempo real) e aplica todas as migrations de `supabase/migrations` (menos as do robô ERP, que dependem
de tabelas criadas pelo UAU-Sync), inclusive a `20261024120000_controle_chaves.sql`.

```bash
# Postgres 16+ escutando em /var/tmp:55432 (ou defina PGHOST/PGPORT), usuário postgres sem senha
scripts/db-tests/chaves/reset.sh
cd scripts/db-tests/chaves && npm i --no-save pg@8 && node test.mjs
```

O `test.mjs` executa cada operação como usuário autenticado (como o PostgREST) e confere: leitura
por condomínio (RLS), escrita só pelas funções, permissões por papel (admin, revistorias, visitante),
retirada parcial, chave indisponível, conflito de duas retiradas simultâneas da mesma chave, pedido
repetido sem duplicar, transferência, devolução parcial e completa, pendência, ocorrência/extravio,
histórico imutável (nem o dono do banco altera), tipologia com log, obra arquivada e exclusão em cascata.
