# Testes de banco das revistorias

Mesmo ambiente dos testes do Controle de Chaves (Postgres local + stub do Supabase):

```bash
scripts/db-tests/chaves/reset.sh
cd scripts/db-tests/revistorias && npm i --no-save pg@8 && node test.mjs
```

Confere: só administradores do condomínio importam (visitante, revistorias, admin de outro condomínio e
usuário sem acesso são recusados), escrita direta bloqueada, validação de status/data/horário, revistoria
nova e atualização sem duplicar, segunda importação da mesma planilha, prévia desatualizada (pula e
registra), reprovada + nova data (nº 2), status da vistoria intacto, Data da revistoria da unidade
(preenche ou mantém a alterada no site), leitura por condomínio (RLS), chamada antiga de 4 parâmetros e
a correção de `private.is_project_admin` (arquivar obra / importar sem acesso ao condomínio).
