// Registro dos módulos da plataforma.
//
//   Plataforma
//   ├── Vistorias      (página inicial: login, seletor de obras, mapa/lista dos clientes)
//   ├── Suprimentos    (Relatório de Pedidos — aba da página Relatórios)
//   ├── Contratos      (Relatório de Contratos — aba da página Relatórios)
//   └── Configurações  (dentro de Vistorias: acessos, condomínios, logs)
//
// Para adicionar um módulo no futuro:
//   1. acrescente o identificador ao check de public.module_members.module (migration);
//   2. crie src/modules/<modulo>/<pagina>/ (service, model, view, index);
//   3. registre a página aqui e o ponto de entrada em scripts/build.mjs (PLATFORM_PAGES).
// O acesso é sempre conferido no banco (RLS); este registro só decide o que aparece na tela.

export const MODULES = Object.freeze([
  {
    id: "vistorias",
    name: "Vistorias",
    access: "projects", // controlado por condomínio (project_members)
    pages: [{ id: "inicio", name: "Vistorias dos condomínios", href: "/" }]
  },
  {
    id: "suprimentos",
    name: "Suprimentos",
    access: "module", // controlado por module_members
    pages: [
      {
        id: "pedidos",
        name: "Relatório de Pedidos",
        description: "Pedidos, ordens de compra e entregas de materiais por obra.",
        href: "/relatorios#suprimentos"
      }
    ]
  },
  {
    id: "contratos",
    name: "Contratos",
    access: "module",
    pages: [
      {
        id: "contratos",
        name: "Relatório de Contratos",
        description: "Contratos, medições e saldos por obra e fornecedor.",
        href: "/relatorios#contratos"
      }
    ]
  },
  { id: "configuracoes", name: "Configurações", access: "admin", pages: [], embedded: "vistorias" }
]);

/** Páginas que o usuário pode abrir, a partir do Map(módulo → papel) liberado no banco. */
export function availablePages(moduleAccess) {
  return MODULES.filter((m) => m.access === "module" && !m.reserved && moduleAccess?.has(m.id))
    .flatMap((m) => m.pages.map((p) => ({ ...p, module: m.id, moduleName: m.name })));
}

export const findModule = (id) => MODULES.find((m) => m.id === id) || null;
