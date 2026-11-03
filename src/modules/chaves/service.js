// Controle de Chaves: leitura das tabelas (RLS por condomínio) e escrita pelas funções chaves_* do banco.
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

/** Situação atual das unidades, chaves perdidas em aberto e quantidade de transferências de hoje. */
export async function carregarCondominio(sb, projectId) {
  const inicioHoje = new Date(); inicioHoje.setHours(0, 0, 0, 0);
  const [unidades, ocorrencias, hoje] = await Promise.all([
    todas(() => sb.from("chaves_unidades").select("unit_id,setor,responsavel,movimentado_em,movimentado_por,movimentacao_id").eq("project_id", projectId), "unit_id"),
    todas(() => sb.from("chaves_ocorrencias").select("id,unit_id,etapa,motivo,setor_anterior,responsavel_anterior,identificado_por,registrado_em,registrado_email,chaveiro_em,chaveiro_por,chaveiro_obs,copia_em,copia_por,copia_obs")
      .eq("project_id", projectId).neq("etapa", "regularizada"))
      // sem a migration das chaves perdidas: a aba funciona só com as transferências
      .catch((err) => (naoInstalado(err) ? null : Promise.reject(err))),
    sb.from("chaves_movimentacoes").select("id", { count: "exact", head: true }).eq("project_id", projectId)
      .eq("tipo", "transferencia").gte("registrado_em", inicioHoje.toISOString())
  ]);
  if (hoje.error) throw hoje.error;
  return { unidades, ocorrencias: ocorrencias || [], perdasInstalado: ocorrencias !== null, hoje: hoje.count || 0 };
}

/** Histórico de uma unidade (mais recente primeiro). */
export async function historico(sb, unitId, limite = 80) {
  const { data, error } = await sb.from("chaves_movimentacoes")
    .select("id,tipo,setor,setor_origem,responsavel,responsavel_anterior,recebido_por,data_hora,observacoes,registrado_email,registrado_em,ocorrencia_id")
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

async function rpc(sb, fn, args) {
  const { data, error } = await sb.rpc(fn, args);
  if (error) {
    const msg = String(error.message || "").replace(/^.*?ERROR:\s*/i, "");
    const e = new Error(naoInstalado(error) ? "Esta função ainda não foi instalada no banco." : msg || "Não foi possível registrar.");
    e.code = error.code; throw e;
  }
  return data;
}
// O banco confere permissão, campos obrigatórios, tela desatualizada (p_ultima_mov) e pedido repetido (p_pedido).
/** Transfere a chave da unidade para outro setor. */
export const transferir = (sb, a) => rpc(sb, "chaves_transferir", { p_unit_id: a.unitId, p_setor: a.setor, p_responsavel: a.responsavel, p_ultima_mov: a.ultimaMov ?? null, p_pedido: a.pedido });
/** Marca a chave da unidade como perdida / sem status. */
export const marcarPerdida = (sb, a) => rpc(sb, "chaves_marcar_perdida", { p_unit_id: a.unitId, p_identificado_por: a.responsavel, p_motivo: a.obs || "", p_ultima_mov: a.ultimaMov ?? null, p_pedido: a.pedido });
/** Andamento da chave perdida: chaveiro_solicitado ou copia_realizada. */
export const andamento = (sb, a) => rpc(sb, "chaves_ocorrencia_andamento", { p_unit_id: a.unitId, p_etapa: a.etapa, p_responsavel: a.responsavel, p_observacoes: a.obs || "", p_ultima_mov: a.ultimaMov ?? null, p_pedido: a.pedido });
/** Regulariza: a nova chave fica com um setor e um responsável. */
export const regularizar = (sb, a) => rpc(sb, "chaves_regularizar", { p_unit_id: a.unitId, p_setor: a.setor, p_responsavel: a.responsavel, p_observacoes: a.obs || "", p_ultima_mov: a.ultimaMov ?? null, p_pedido: a.pedido });

/** Tempo real: avisa quando outro usuário transfere chaves ou atualiza uma chave perdida. */
export function assinar(sb, projectId, aoMudar) {
  const filtro = `project_id=eq.${projectId}`;
  const canal = sb.channel(`chaves-${projectId}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "chaves_unidades", filter: filtro }, aoMudar)
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "chaves_movimentacoes", filter: filtro }, aoMudar)
    .on("postgres_changes", { event: "*", schema: "public", table: "chaves_ocorrencias", filter: filtro }, aoMudar)
    .subscribe();
  return () => sb.removeChannel(canal);
}
