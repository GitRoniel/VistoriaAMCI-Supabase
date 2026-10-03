# Relatório de Contratos — estrutura real e regras

**Fonte:** `public.contratos_registros_549`, o relatório 549 do ERP gravado pelo robô.
O app lê pela view `public.contratos_registros_atual`, que devolve só a última execução com sucesso.
A data da atualização vem de `public.pedidos_execucoes` (`relatorio = 549`).
Nenhuma tabela ou coluna foi criada ou alterada.

## Identificação (conferida nos dados de 01/10/2026: 725 linhas, execução 12)

| O quê | Chave | Observação |
|---|---|---|
| Item / serviço | `chave_contrato` = `empresa-obra-contrato-item` | 721 chaves em 725 linhas: 4 itens vêm repetidos pelo ERP, com valores idênticos, e ficam uma vez só |
| Contrato | `empresa` + `obra` + `contrato` | 194 contratos. O número do contrato se repete entre obras (147 números distintos), então ele sozinho não identifica o contrato |
| Obra | `obra` (+ `desc_obra`, `desc_empresa` = condomínio) | 12 obras |

## Campos exibidos

| Tela | Campo | Nível | Regra |
|---|---|---|---|
| Contrato | `contrato` | contrato | |
| Fornecedor | `fornecedor` (+ `cod_fornecedor`) | contrato | igual em todas as linhas do contrato |
| Objeto | `objeto` | contrato | igual em todas as linhas do contrato |
| Valor do contrato | `total_contrato` | contrato | lido **uma vez** por contrato, nunca somado por item |
| Medido | `valor_medido` | contrato | lido uma vez; % medido = medido ÷ valor |
| Saldo | `saldo_contrato` | contrato | lido uma vez. Vazio em 22 contratos sem medição: aí o saldo é `total_contrato − valor_medido` (mesma relação que vale nos outros 172) |
| Situação | `situacao` | contrato | "0 - Andamento" vira "Andamento" (o código só ordena) |
| Status | `status` | contrato | Aprovado, Em Aditivo, Não Aprovado |
| Retenção | `desc_desconto` + `taxa_desconto` | contrato | etiqueta "Retenção contratual 5%" quando a taxa é maior que zero |
| Item | `item`, `cod_servico`, `servico`, `unidade` | item | |
| Quantidade, preço, subtotal | `qtde`, `preco`, `subtotal` | item | `qtde × preço = subtotal` em todas as linhas |
| Medido do item | `qtde_medida`, `valor_medido_item` | item | |
| A medir | `qtde_a_medir`, `valor_a_medir` | item | `medida + a medir = qtde` em todas as linhas |

**Totais (indicadores e cabeçalho da obra):** somam os valores **do contrato**, uma vez por contrato.
Sem as linhas repetidas, a soma dos `subtotal` dos itens fecha com `total_contrato` em todos os 194 contratos.
Já o `valor_medido` do contrato difere da soma dos `valor_medido_item` em 5 contratos (retenções e
medições do ERP). Por isso o resumo usa sempre o valor do contrato, e a tabela de itens mostra o valor de cada item.

**Não exibidos:** `retido`, `a_pag`, `ret_pag` e `a_pagar`. Variam entre os itens de 28 contratos, mas
sem regra clara de nível (contrato ou item). Somá-los poderia duplicar valores. `extras` está vazio.

## Filtros

Uma linha compacta, nesta ordem:

1. **Nº contrato** (prefixo do número; texto também encontra fornecedor ou objeto);
2. **Serviço / item** (palavras-chave, com sugestões; abre e destaca os itens encontrados);
3. **Obra** (seleção múltipla);
4. **Tipo** = campo `status` do ERP (Aprovado, Em Aditivo, Não Aprovado);
5. **Status** = campo `situacao` do ERP (Andamento, Concluído, Cancelado; padrão **em aberto**, sem concluídos e cancelados).

Abaixo: "somente com saldo a medir", modo compacto e, à direita, a quantidade de contratos, **Limpar** e
**Expandir todos**. Ao rolar, cada obra mantém no topo a linha da obra (totais) e a linha dos títulos das colunas.

## Conferência com os dados reais (execução 12, 01/10/2026)

| Indicador | Valor |
|---|---|
| Linhas do ERP | 725 (721 itens sem repetidas) |
| Contratos | 194 (165 em aberto) |
| Valor contratado | R$ 78.483.166,44 |
| Fornecedores | 110 |
| Obras | 12 |
| Contratos com saldo a medir | 105 informados pelo ERP + 22 sem medição |
| Saldo negativo | 2 contratos (exibidos em vermelho) |
