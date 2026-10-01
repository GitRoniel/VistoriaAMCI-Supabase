// Acesso ao Supabase: um único cliente por página, compartilhando a sessão com o site de Vistorias.
// A sessão fica no mesmo armazenamento usado pelo login (www/index.html):
//   "Manter conectado" marcado → localStorage; desmarcado → sessionStorage.
import { createClient } from "@supabase/supabase-js";
import { CONFIG, SUPABASE_READY } from "./config.js";

export const REMEMBER_KEY = "amci-remember";
export const LOGIN_AT_KEY = "amci-login-at";
export const REMEMBER_MS = 30 * 24 * 60 * 60 * 1000;

const rememberOn = () => {
  try { return localStorage.getItem(REMEMBER_KEY) !== "0"; } catch { return true; }
};
const authStore = () => {
  try { return rememberOn() ? localStorage : sessionStorage; } catch { return null; }
};
const authStorage = {
  getItem: (key) => { try { return authStore()?.getItem(key) ?? null; } catch { return null; } },
  setItem: (key, value) => { try { authStore()?.setItem(key, value); } catch { /* armazenamento indisponível */ } },
  removeItem: (key) => {
    try { localStorage.removeItem(key); } catch { /* ignora */ }
    try { sessionStorage.removeItem(key); } catch { /* ignora */ }
  }
};

/** Sessão "manter conectado" vencida (30 dias), igual à regra do login. */
export function rememberExpired() {
  try {
    if (!rememberOn()) return false;
    const at = Number(localStorage.getItem(LOGIN_AT_KEY) || 0);
    if (!at) { localStorage.setItem(LOGIN_AT_KEY, String(Date.now())); return false; }
    return Date.now() - at > REMEMBER_MS;
  } catch { return false; }
}

let client = null;
/** Cliente Supabase da página (ou null quando a configuração pública não está disponível). */
export function getSupabase() {
  if (!SUPABASE_READY) return null;
  if (!client) {
    const factory = window.__createSupabaseClient || createClient; // permite cliente simulado nos testes
    client = factory(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_PUBLISHABLE_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storage: authStorage }
    });
  }
  return client;
}

/** Busca todas as linhas de uma consulta em páginas de 1000 (limite padrão da API). */
export async function fetchAllPages(buildQuery, pageSize = 1000) {
  const rows = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await buildQuery().range(from, from + pageSize - 1);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < pageSize) break;
  }
  return rows;
}
