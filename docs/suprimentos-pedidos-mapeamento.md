# Relatório de Pedidos — mapeamento Google Sheets → HTML antigo → Supabase

**Fonte nova:** `public.pedidos_registros_1187`, o relatório 1187 do ERP gravado pelo robô.
O app lê pela view `public.pedidos_registros_atual`, que devolve só a última execução com sucesso
(cada execução grava uma foto completa; a view evita pedidos duplicados entre execuções).
A data da atualização vem de `public.pedidos_execucoes` (`finalizado_em`, `periodo_inicio`, `periodo_fim`).

O HTML antigo recebia de `/api/dados` (montado a partir da planilha) um registro por pedido. A
planilha não pôde ser aberta deste ambiente, porque o acesso ao Google está bloqueado. Por isso o
mapeamento foi feito pelo contrato de dados que o HTML usava e pela estrutura real da tabela.

## Pedido (uma linha da tabela, chave OBRA-PEDIDO)

| HTML antigo (`/api/dados`) | Supabase (`pedidos_registros_1187`) | Regra |
|---|---|---|
| `obra` | `obra` | código da obra no ERP (ex.: 18OBA) |
| `pedido` | `pedido` | |
| `solicitante` | `quem` | usuário do ERP que fez o pedido |
| `dt_pedido` | `dt_pedido` | só a data |
| `dt_prev` | `dt_prevista_entrega` | a mais próxima entre os itens com saldo; sem saldo, a maior |
| `oc` | `ordem_compra` | todas as OCs distintas do pedido |
| `fornecedor` | `nome_fantasia` ou `fornecedor` | todos os distintos do pedido |
| `descMap[obra-pedido]` | `observacao_pedido` | a mais frequente no pedido; sem observação, "Materiais diversos" |
| `n_itens` | linhas do pedido | depois de remover as duplicadas (abaixo) |
| `delivery_status` | `qtde_entregue`, `qtde_restante` | sem saldo → ENTREGUE TOTALMENTE; saldo com algo entregue → ENTREGUE PARCIALMENTE; saldo sem nada entregue → PENDENTE DE ENTREGA; todos os itens descartados → CANCELADO *(novo)* |
| `oc_status` | `ordem_compra`, `qtde_restante` | OC PENDENTE quando algum item com saldo não tem OC; senão OC GERADA |
| `pct` | | média do % de entrega dos itens não cancelados |

## Material (linha expandida)

| HTML antigo | Supabase | Regra |
|---|---|---|
| `nome` | `insumo` (+ `cod_insumo`, `unidade`) | |
| `oc` | `ordem_compra` | "Pendente" quando há saldo e não há OC |
| `sol` | `qtde_entregue + qtde_descartada + qtde_restante` | o ERP não traz a quantidade solicitada; ela é a soma das três |
| `ent` | `qtde_entregue` | |
| — | `qtde_descartada` | coluna nova "Descartada" (cancelada no ERP) |
| `saldo` | `qtde_restante` | |
| `pct` | | entregue ÷ (entregue + restante) |

## Linhas duplicadas do ERP

Depois que a OC é emitida, o relatório 1187 continua trazendo a linha original do item (sem OC),
além das linhas com OC, com as mesmas quantidades. Na execução de 01/10/2026 eram 534 casos em 4.293 linhas.

Regra aplicada (`dedupeRows` em `model.js`): em cada pedido + insumo, a linha sem OC é descartada
quando coincide com o total das linhas com OC ou com uma delas. O que sobrar sem OC é saldo ainda
não comprado (ex.: 15POS pedido 5: 200 com OC + 1 sem OC).

## Conferência com os dados reais (execução 5, 01/10/2026)

| Indicador | Valor |
|---|---|
| Linhas do ERP | 4.293 (3.759 sem duplicadas) |
| Pedidos | 1.163 |
| Obras | 10 |
| Entregues | 874 |
| Parciais | 121 |
| Pendentes | 166 |
| Cancelados | 2 |
| Em aberto | 287 |
| Com OC gerada | 1.092 |
| OC pendente | 71 |

## Pontos para confirmar com a planilha

- **Quantidade solicitada:** usamos entregue + descartada + restante, porque o ERP não traz essa coluna.
- **Status da OC:** um pedido fica "OC pendente" quando qualquer item com saldo está sem OC.
- **Descrição do pedido:** vem da observação do pedido no ERP. Se a planilha usava outro texto (resumo dos itens, por exemplo), basta ajustar `model.js`.
- **Obras:** aparecem pelo código do ERP (ex.: 18OBA), não pelo nome do condomínio.

## Filtros da tela

Uma linha compacta, nesta ordem: **Pedido** (número, cabe 4 dígitos), **OC** (ordem de compra, cabe
4 dígitos), **Material** (palavras-chave, com sugestões; abre e destaca os itens encontrados),
**Obra** (seleção múltipla) e **Entrega** (padrão: apenas em aberto). Abaixo, os **solicitantes**
(chips coloridos) e as opções: "Ocultar pedidos totalmente entregues" (sempre começa **desligado**),
modo compacto e gráficos; à direita, a quantidade de pedidos, **Limpar** e **Expandir todos**.
Ao rolar, cada obra mantém no topo a linha da obra (contagens) e a linha dos títulos das colunas.
