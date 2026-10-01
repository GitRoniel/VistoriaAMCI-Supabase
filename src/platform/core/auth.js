// Autenticação e permissões da plataforma.
// O login acontece na página inicial (Vistorias); os módulos apenas reaproveitam a sessão.
import { getSupabase, rememberExpired, LOGIN_AT_KEY } from "./supabase.js";

/**
 * Usuário logado com os módulos liberados.
 * @returns {Promise<{status:"ok"|"anon"|"expired"|"offline", user?:object, modules?:Map<string,string>}>}
 */
export async function loadSession() {
  const supabase = getSupabase();
  if (!supabase) return { status: "offline" };
  const { data } = await supabase.auth.getSession();
  const session = data?.session;
  if (!session?.user) return { status: "anon" };
  if (rememberExpired()) {
    await supabase.auth.signOut({ scope: "local" });
    try { localStorage.removeItem(LOGIN_AT_KEY); } catch { /* ignora */ }
    return { status: "expired" };
  }
  const [{ data: profile }, modules] = await Promise.all([
    supabase.from("profiles").select("full_name,email").eq("id", session.user.id).maybeSingle(),
    loadModuleAccess(session.user.id)
  ]);
  return {
    status: "ok",
    user: { id: session.user.id, email: session.user.email || profile?.email || "", name: profile?.full_name || session.user.email || "Usuário" },
    modules
  };
}

/** Módulos liberados para o usuário: Map(módulo → papel). A regra real está no banco (RLS). */
export async function loadModuleAccess(userId) {
  const supabase = getSupabase();
  const access = new Map();
  if (!supabase || !userId) return access;
  const { data, error } = await supabase.from("module_members").select("module,role").eq("user_id", userId).eq("active", true);
  if (!error) (data || []).forEach((m) => access.set(m.module, m.role));
  return access;
}

export async function signOut() {
  const supabase = getSupabase();
  if (supabase) await supabase.auth.signOut({ scope: "local" });
  try { localStorage.removeItem(LOGIN_AT_KEY); } catch { /* ignora */ }
}
