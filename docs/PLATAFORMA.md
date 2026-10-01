# Plataforma AMCI — arquitetura e módulos

```
Plataforma
├── Vistorias      página inicial (www/index.html): login, seletor de obras, mapa/lista, Visão Geral
├── Suprimentos    www/relatorios.html#suprimentos → Relatório de Pedidos (migrado da planilha do Google)
├── Contratos      www/relatorios.html#contratos   → Relatório de Contratos (relatório 549 do ERP)
└── Configurações  dentro de Vistorias: acessos, condomínios, logs e aba "Módulos"
```

## Estrutura do código

```
src/
├── platform/                     núcleo compartilhado por todos os módulos
│   ├── core/
│   │   ├── config.js             configuração pública (URL e chave publicável do Supabase)
│   │   ├── supabase.js           cliente único, mesma sessão do login de Vistorias, paginação
│   │   ├── auth.js               sessão, "manter conectado" (30 dias), módulos liberados
│   │   ├── theme.js              tema claro/escuro (mesma chave "amci-theme")
│   │   └── utils.js              escape, datas, números, busca sem acento, destaque
│   ├── ui/
│   │   ├── shell.js              cabeçalho no padrão da Visão Geral, telas de estado, avisos
│   │   ├── multiselect.js        seleção múltipla com busca (obras, pedidos…)
│   │   └── autocomplete.js       sugestões enquanto digita
│   ├── styles/platform.css       tokens de cor (claro/escuro) e componentes: filtros, cards, tabelas
│   └── modules.js                registro dos módulos e páginas
└── modules/
    ├── relatorios/
    │   ├── index.js              página Relatórios: sessão → abas liberadas (#suprimentos/#contratos) → dados
    │   └── relatorios.css        abas + estilos dos dois relatórios
    ├── suprimentos/pedidos/
    │   ├── service.js            acesso ao Supabase (view pedidos_registros_atual)
    │   ├── model.js              regras de negócio: linhas do ERP → pedidos, status, indicadores
    │   ├── filters.js            filtros (puros)
    │   ├── charts.js             gráficos (Chart.js sob demanda)
    │   ├── view.js               interface
    │   ├── pedidos.css           estilos do relatório
    │   └── tab.js                aba Suprimentos (dados → tela)
    └── contratos/contratos/
        ├── service.js            acesso ao Supabase (view contratos_registros_atual)
        ├── model.js              regras: itens → contratos (sem duplicar valores do contrato)
        ├── filters.js            filtros (puros)
        ├── view.js               interface
        ├── contratos.css         estilos do relatório
        └── tab.js                aba Contratos (dados → tela)
```

`pnpm build` gera `www/platform/platform.css` e, para cada página registrada em `PLATFORM_PAGES`
(`scripts/build.mjs`), o `.js` e o `.css` (hoje: `www/relatorios.js` e `www/relatorios.css`).
A página Relatórios mostra só as abas dos módulos liberados para o usuário. Cada aba carrega os dados
quando é aberta pela primeira vez e mantém os filtros ao alternar. O endereço antigo
`/suprimentos/pedidos` redireciona para `/relatorios#suprimentos`.

Mapeamentos: [Pedidos](suprimentos-pedidos-mapeamento.md) · [Contratos](contratos-mapeamento.md).

## Segurança

- O navegador recebe só a **chave publicável** do Supabase. A chave de serviço nunca vai para o frontend.
- A sessão é a mesma do login de Vistorias (mesmo domínio e armazenamento).
- **Acesso por módulo:** tabela `module_members` (`leitor` ou `admin`) e funções `private.has_module` e `private.is_module_admin`.
- **Dados do ERP** (`pedidos_*`, `contratos_*`): leitura só com acesso ao módulo (RLS). O navegador não pode gravar nessas tabelas. O robô grava pelas funções `pedidos_robo` e `contratos_robo` (security definer, com token).
- **Gestão de acessos:** Configurações › Módulos, pelas funções `listar_acessos_modulo` e `definir_acesso_modulo`. Só administradores do módulo podem usá-las. Cada alteração fica em `module_access_log`.

## Como adicionar um relatório (nova aba)

1. Crie `src/modules/<modulo>/<relatorio>/` com `service.js`, `model.js`, `filters.js`, `view.js`, `<relatorio>.css` e `tab.js` (copie Contratos).
2. Acrescente a aba em `TABS` (`src/modules/relatorios/index.js`) e o CSS em `relatorios.css`.
3. Registre a página em `src/platform/modules.js` e em `PLATFORM_PAGES` no `www/index.html` (`href: "/relatorios#<aba>"`).

## Como adicionar um módulo

1. **Migration:** o identificador já está no check de `module_members.module`. Para um módulo novo, acrescente-o ali e crie as políticas `using (private.has_module('<modulo>'))` nas tabelas dele.
2. **Código:** crie `src/modules/<modulo>/<pagina>/` com `service.js`, `model.js`, `view.js` e `index.js`, reaproveitando `src/platform`.
3. **Página:** crie `www/<modulo>/<pagina>.html` (copie `www/suprimentos/pedidos.html`) e registre em `PLATFORM_PAGES` no `scripts/build.mjs`.
4. **Registro:** inclua a página em `src/platform/modules.js` e em `PLATFORM_PAGES` no `www/index.html`. É isso que mostra o card no seletor e a opção em Configurações › Módulos.
