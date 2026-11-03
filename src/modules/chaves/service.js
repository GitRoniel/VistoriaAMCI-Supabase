// Controle de Chaves: leitura das tabelas (RLS por condomínio) e escrita pela função chaves_transferir.
// Nenhuma chave de serviço no navegador: tudo com a sessão do usuário e as permissões do papel dele.

const PAGE = 1000;
async function todas(build, coluna = "id") {
  const out = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build().order(coluna, { ascending: true }).range(from, from + PAGE - 1);
    if (error) throw error;
    out.push(...(data || []));
    if (!data || data.length < PAGE) break;
  }
  return out;
}

/** Erro de "tabela/coluna/função inexistente": a migration do módulo ainda não foi aplicada. */
export const naoInstalado = (err) => ["42P01", "42703", "42883", "PGRST205", "PGRST204", "PGRST202"].includes(err?.code) ||
  /does not exist|could not find/i.test(err?.message || "");

/** Situação atual das unidades do condomínio e quantidade de transferências de hoje. */
export async function carregarCondominio(sb, projectId) {
  const inicioHoje = new Date(); inicioHoje.setHours(0, 0, 0, 0);
  const [unidades, hoje] = await Promise.all([
    todas(() => sb.from("chaves_unidades").select("unit_id,setor,responsavel,movimentado_em,movimentado_por,movimentacao_id").eq("project_id", projectId), "unit_id"),
    sb.from("chaves_movimentacoes").select("id", { count: "exact", head: true }).eq("project_id", projectId)
      .eq("tipo", "transferencia").gte("registrado_em", inicioHoje.toISOString())
  ]);
  if (hoje.error) throw hoje.error;
  return { unidades, hoje: hoje.count || 0 };
}

/** Histórico de uma unidade (mais recente primeiro). */
export async function historico(sb, unitId, limite = 80) {
  const { data, error } = await sb.from("chaves_movimentacoes")
    .select("id,tipo,setor,setor_origem,responsavel,responsavel_anterior,recebido_por,data_hora,observacoes,registrado_email,registrado_em")
    .eq("unit_id", unitId).order("registrado_em", { ascending: false }).order("id", { ascending: false }).limit(limite);
  if (error) throw error;
  return data || [];
}

/** Nomes já usados como responsáveis, para sugerir no formulário. */
export async function nomesUsados(sb, projectId) {
  const { data } = await sb.from("chaves_movimentacoes").select("responsavel,responsavel_anterior")
    .eq("project_id", projectId).order("registrado_em", { ascending: false }).limit(500);
  const nomes = new Set();
  (data || []).forEach((m) => [m.responsavel, m.responsavel_anterior].forEach((n) => String(n || "").split(",").map((x) => x.trim()).filter((x) => x.length > 1).forEach((x) => nomes.add(x))));
  return [...nomes].sort((a, b) => a.localeCompare(b, "pt-BR"));
}

/** Transfere a chave da unidade (o banco confere permissão, setor, responsável, concorrência e pedido repetido). */
export async function transferir(sb, { unitId, setor, responsavel, ultimaMov, pedido }) {
  const { data, error } = await sb.rpc("chaves_transferir", {
    p_unit_id: unitId, p_setor: setor, p_responsavel: responsavel, p_ultima_mov: ultimaMov ?? null, p_pedido: pedido
  });
  if (error) {
    const msg = String(error.message || "").replace(/^.*?ERROR:\s*/i, "");
    const e = new Error(naoInstalado(error) ? "A transferência ainda não foi instalada no banco." : msg || "Não foi possível registrar a transferência.");
    e.code = error.code; throw e;
  }
  return data;
}

/** Tempo real: avisa quando outro usuário transfere chaves do condomínio. */
export function assinar(sb, projectId, aoMudar) {
  const filtro = `project_id=eq.${projectId}`;
  const canal = sb.channel(`chaves-${projectId}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "chaves_unidades", filter: filtro }, aoMudar)
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "chaves_movimentacoes", filter: filtro }, aoMudar)
    .subscribe();
  return () => sb.removeChannel(canal);
}
