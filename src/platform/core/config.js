// Configuração pública da plataforma (gerada no build em /config.js).
// Só contém valores públicos por definição: URL do Supabase e chave publicável (RLS protege os dados).
// Nunca coloque a chave de serviço (service_role) no navegador.
export const CONFIG = Object.freeze({ ...(window.APP_CONFIG || {}) });

export const SUPABASE_READY = Boolean(CONFIG.SUPABASE_URL && CONFIG.SUPABASE_PUBLISHABLE_KEY);

// Endereço da página inicial da plataforma (login + seletor de obras/módulos).
export const HOME_URL = "/";
