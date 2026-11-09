// Central Operacional: leitura no Supabase pelas funções central_* (só leitura; RLS de cada tabela vale).
const rpc = async (sb, nome, args) => {
  const { data, error } = await sb.rpc(nome, args);
  if (error) throw error;
  return data;
};
export const naoInstalado = (err) => ["42883", "PGRST202", "42P01"].includes(err?.code) || /central_[a-z_]+|could not find the function/i.test(err?.message || "");
/** Atividades (vistorias e revistorias) de um intervalo de datas, já com os quantitativos de pendências. */
export const agenda = (sb, de, ate, projetos) => rpc(sb, "central_agenda", { p_de: de, p_ate: ate, p_projetos: projetos?.length ? projetos.map(Number) : null });
export const limites = (sb, projetos) => rpc(sb, "central_agenda_limites", { p_projetos: projetos?.length ? projetos.map(Number) : null });
export const produtividade = (sb, a) => rpc(sb, "central_produtividade", {
  p_de: a.de, p_ate: a.ate, p_projetos: a.projetos?.length ? a.projetos.map(Number) : null, p_grao: a.grao || "semana",
  p_dias_espera: a.diasEspera ?? 15, p_dias_sem_atualizacao: a.diasSemAtualizacao ?? 30, p_dias_pendencia: a.diasPendencia ?? 30, p_min_pendencias: a.minPendencias ?? 10
});
export const unidade = (sb, unitId) => rpc(sb, "central_unidade", { p_unit_id: Number(unitId) });
export const buscar = (sb, q, projetos, limite = 30) => rpc(sb, "central_buscar", { p_q: q, p_projetos: projetos?.length ? projetos.map(Number) : null, p_limite: limite });
/** Link temporário (10 min) para o PDF do relatório (bucket privado). */
export async function urlRelatorio(sb, caminho, baixar = "") {
  const { data, error } = await sb.storage.from("revistorias-relatorios").createSignedUrl(caminho, 600, baixar ? { download: baixar } : undefined);
  if (error) throw error;
  return data.signedUrl;
}
/** Tempo real: qualquer mudança em vistorias, revistorias ou checklist atualiza a central (o RLS filtra os eventos). */
export function assinar(sb, aoMudar) {
  if (!sb?.channel) return () => {};
  const ch = sb.channel(`central-${Date.now()}`);
  for (const t of ["client_inspections", "revistorias", "revistorias_cliente", "revistorias_apontamentos", "revistorias_relatorios"])
    ch.on("postgres_changes", { event: "*", schema: "public", table: t }, aoMudar);
  ch.subscribe();
  return () => { try { sb.removeChannel(ch); } catch { /* já fechado */ } };
}
