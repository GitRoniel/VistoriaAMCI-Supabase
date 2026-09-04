# Arquivos CSV para a carga inicial

Exporte no Google Sheets cada aba em **Arquivo > Fazer download > Valores separados por vírgulas (.csv)** e salve aqui com estes nomes exatos:

- `OBRA.csv`
- `CLIENTE.csv`
- `CRONOGRAMA.csv`

Não coloque `ACESSOS.csv`: as senhas antigas não serão migradas. Os usuários serão recriados no Supabase Auth com novas senhas.

Antes da carga real, valide os arquivos com:

```powershell
pnpm import:data -- --dry-run
```

Os CSVs desta pasta são ignorados pelo Git para evitar publicação acidental de dados pessoais.
