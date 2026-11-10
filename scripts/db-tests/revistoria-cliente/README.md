# Testes de banco da Revistoria · Cliente

Mesmo ambiente dos testes do Controle de Chaves (Postgres local + stub do Supabase). O banco é recriado
até a migration anterior; o teste cria dados como os de produção e aplica
`20261105120000_revistoria_cliente.sql` (duas vezes, para conferir que não duplica nada).

```bash
scripts/db-tests/chaves/reset.sh 20261103180000
cd scripts/db-tests/revistoria-cliente && npm i --no-save pg@8 && node test.mjs
```

Confere: situação inicial (Revistoria → Em andamento; Revistoria Finalizada → Aprovado com a revistoria
registrada a partir da data e do responsável da vistoria; agendamento da planilha → Agendado), entrada
automática quando a vistoria passa a Revistoria (sem duplicar), agendar / remarcar (o anterior fica
Cancelada) / cancelar / resultado (aprovada → vistoria Revistoria Finalizada; reprovada → novo ciclo) /
reabrir (novas pendências → novo ciclo; vistoria volta a Revistoria), validações (data, responsável,
horário, realização futura, pendências), tela desatualizada, clique repetido, duas pessoas ao mesmo tempo,
permissões por papel (admin e revistorias alteram; visitante, outro condomínio e sem acesso não),
leitura por condomínio (RLS), escrita direta bloqueada, histórico imutável, importação da planilha
atualizando a situação sem mexer na vistoria, dados antigos preservados e exclusão em cascata.

## Correção das revistorias aprovadas em duplicidade (`duplicidade.mjs`)

```bash
scripts/db-tests/chaves/reset.sh 20261114120000
node scripts/db-tests/revistoria-cliente/duplicidade.mjs
```

Reproduz o caso real (vistoria Revistoria Finalizada → Revistoria → Revistoria Finalizada, que registra de novo a
mesma revistoria aprovada) e aplica `20261115120000_revistoria_duplicidades_correcao.sql` (duas vezes). Confere:
nada apagado; status da vistoria de nenhuma unidade muda; fica 1 revistoria aprovada válida (a atual) e as
repetidas ficam anuladas com motivo; horário do registro anulado mantido no atual; ciclo volta ao do 1º registro;
evento "correcao" no histórico; unidades fora da regra (reprovada no meio, datas diferentes, em andamento) não
mudam; rodar de novo não muda nada.
