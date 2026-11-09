# Auditoria · Vistorias e Revistorias (novembro/2026)

Análise feita sobre o código (`www/index.html`, `src/modules/revistoria-cliente`, `src/modules/vistorias`,
`supabase/migrations`) e sobre os dados de produção (contagens agregadas, sem dados pessoais). O que já foi
resolvido nesta entrega está marcado como **feito**; o restante é proposta, com o motivo de não ter sido
implementado agora.

## Situação encontrada (dados de produção)

| Item | Valor |
|---|---|
| Condomínios | 3 (Alto do Jerivá 448 aptos, Alto do Buriti 319 casas, Alto do Murici 448 aptos) |
| Vistorias com dados | só no Jerivá: 214 Aprovado, 210 Revistoria, 10 Revistoria Finalizada, 13 Inadimplência |
| Revistoria · Cliente | 221 unidades (154 em andamento, 58 agendadas, 9 aprovadas); 80 agendamentos |
| Relatórios / apontamentos | 129 PDFs em 127 unidades; 1.551 apontamentos, 2 resolvidos |
| Histórico da vistoria | 2.623 alterações em `audit_log` (legível só por administradores) |

## Entregue nesta etapa

- **Central Operacional** no Resumo Geral e na tela inicial: Agenda Operacional unificada, Visão de
  Produtividade e Central de Unidades (`src/modules/central`, migration `20261112120000_central_operacional.sql`).
- **Linha do tempo da vistoria para todos os membros** (feito): antes, só administradores viam as mudanças
  de status/data/responsável (o `audit_log` é só deles). A função `private.central_hist_vistoria` devolve
  somente esses campos, para membros do condomínio, sem mudar o RLS do `audit_log`.
- **Indicadores calculados no banco** (feito): a produtividade usa uma consulta agregada; a agenda e a
  pesquisa filtram por data e condomínio no banco; a Central de Unidades busca só a unidade aberta.
- **Índices** (feito): `audit_log (table_name, record_id, id)` para a linha do tempo, datas de vistoria e de
  revistoria para a agenda, `revistorias_apontamentos (relatorio_id)`.

## Prioridade alta

### 1. Resolução de pendência sem histórico
- **Problema:** ao desmarcar um apontamento, `concluido_em`/`concluido_email` são apagados; não dá para saber
  quem marcou antes nem quantas vezes o item foi reaberto.
- **Hoje:** `revistoria_apontamento_marcar` sobrescreve o registro.
- **Solução:** tabela só de inserção `revistorias_apontamentos_eventos` (marcou/desmarcou, quem, quando),
  gravada pela mesma função; a Central de Unidades passa a mostrar o histórico de cada pendência.
- **Benefício:** rastreabilidade e tempo médio de resolução confiável. **Complexidade:** baixa.
  **Impacto técnico:** 1 tabela + ajuste de 1 função; nenhuma mudança de tela obrigatória.
- **Por que não agora:** muda a regra de gravação do checklist (pede aprovação explícita).

### 2. Nomes de vistoriadores em três formatos
- **Problema:** a vistoria usa o primeiro nome ("Eduarda"), o PDF traz o nome completo ("Eduarda Ferreira de
  Oliveira") e as revistorias têm variações ("Rejane", "REJANE", "Levi" / "LEVI MAC CORMICK").
- **Hoje:** a produtividade junta nomes iguais sem diferenciar maiúsculas e espaços; nomes diferentes da
  mesma pessoa continuam separados.
- **Solução:** cadastro de vistoriadores (nome, apelidos aceitos, ativo) usado nos campos de responsável
  (lista em vez de texto livre) e na importação da planilha.
- **Benefício:** indicadores por pessoa corretos, menos digitação. **Complexidade:** média.
  **Impacto técnico:** 1 tabela, ajuste dos formulários e da importação.

### 3. Dois lugares para a data da revistoria
- **Problema:** `client_inspections.reinspection_date/reinspection_responsible` (vindos da planilha) e a tabela
  `revistorias` guardam a mesma informação; a importação sincroniza os dois, mas edições manuais podem divergir.
- **Hoje:** a Central usa só `revistorias` (sem duplicar na agenda); a Visão Geral ainda mostra os campos antigos.
- **Solução:** tratar `revistorias` como fonte única e transformar os campos antigos em somente leitura
  (depois, remover das telas).
- **Benefício:** sem divergência de datas. **Complexidade:** média. **Impacto técnico:** Visão Geral,
  exportação CSV e importação.

### 4. "Não realizada" não existe como status
- **Problema:** uma vistoria agendada que não aconteceu continua "Agendado" com data passada.
- **Hoje:** a Central identifica como **Atrasada** (data passou, sem resultado), sem alterar nada.
- **Solução:** ação "Não realizada / cliente não compareceu" que registra o motivo e pede reagendamento.
- **Benefício:** agenda limpa e indicador de ausências. **Complexidade:** baixa.
  **Impacto técnico:** 1 valor de status + 1 função.

### 5. Proteção de senha vazada desligada (Supabase Auth)
- **Problema:** o aviso de segurança do Supabase indica a verificação de senhas vazadas desligada.
- **Solução:** ativar em Authentication › Password security. **Complexidade:** muito baixa (configuração).

## Prioridade média

### 6. Visão Geral × Agenda Operacional
- **Hoje:** a Visão Geral (tela inicial) carrega todos os agendamentos de vistoria de uma vez e tem a
  importação da planilha e a exportação CSV; a Agenda Operacional junta vistorias e revistorias por período.
- **Proposta:** levar a importação e a exportação para a Central e aposentar a Visão Geral.
  **Por que não agora:** a equipe usa a Visão Geral todos os dias (importação e resumo por dia);
  a troca deve ser combinada.

### 7. Estatística Geral × Produtividade
- **Hoje:** a Estatística Geral calcula no navegador por vistoriador × acompanhamento técnico (situação atual);
  a Produtividade calcula no banco por período.
- **Proposta:** mover o recorte por acompanhamento técnico para a Produtividade e manter uma só tela.

### 8. Pendência que impede a aprovação
- **Hoje:** não existe regra; qualquer apontamento tem o mesmo peso.
- **Proposta:** marcar apontamentos como "impede aprovação" e bloquear o resultado "Aprovada" enquanto houver
  algum aberto (com confirmação de administrador para exceções).

### 9. Filtros salvos no aparelho
- **Hoje:** a Central guarda filtros e períodos por usuário no navegador (localStorage).
- **Proposta:** salvar no Supabase para valer em todos os aparelhos.

### 10. Notificações internas
- **Proposta:** aviso diário (não por evento) com atrasadas, revistorias aguardando agendamento e pendências
  antigas, usando os mesmos parâmetros da seção Atenção. **Por que não agora:** exige canal de entrega
  (e-mail/WhatsApp) e definição de quem recebe; a seção Atenção já mostra tudo sem notificar.

## Prioridade baixa

### 11. Tempo real por condomínio
- A Central assina mudanças de vistorias, revistorias e checklist sem filtro (o RLS limita o que chega);
  com muitos condomínios, filtrar por `project_id` reduz eventos.

### 12. Status "Inadimplência" exibido como "Processo em Andamento"
- O banco grava "Inadimplência" e a tela mostra outro nome; padronizar o rótulo evita confusão em relatórios.

### 13. Envio de fotos/evidências por pendência
- Hoje as evidências estão só dentro do PDF. Um anexo por apontamento (Storage privado, como os PDFs)
  permitiria comprovar a resolução. Custo de armazenamento a avaliar no plano atual (1 GB).
