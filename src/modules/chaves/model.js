// Controle de Chaves: regras puras (sem tela nem Supabase), usadas pela aba Chaves e pelos testes.
//
// A chave de cada unidade é acompanhada como um todo: em que setor está (cor no mapa) e quem é o
// responsável. A única operação é "Transferir para outro setor" (destino + quem recebe).
//   Base (azul) · CX (verde) · Asstec (laranja) · Produção (vermelho) · Sem status (cinza: nenhum registro)
// O status da vistoria vem de client_inspections e é mostrado à parte: este módulo nunca o altera.

export const SETORES = {
  base: { label: "Base", cor: "#2f6fdb", borda: "#2459b5", texto: "#ffffff" },
  cx: { label: "CX", cor: "#2f9e5b", borda: "#268a4d", texto: "#ffffff" },
  asstec: { label: "Asstec", cor: "#e8842a", borda: "#c96a1a", texto: "#ffffff" },
  producao: { label: "Produção", cor: "#d64545", borda: "#b33636", texto: "#ffffff" },
  sem: { label: "Sem status", cor: "#e4e8e5", borda: "#c3cac5", texto: "#7a857e" }
};
/** Setores para onde a chave pode ser transferida. */
export const SETORES_DESTINO = ["base", "cx", "asstec", "producao"];
export const STATUS_ORDEM = ["base", "cx", "asstec", "producao", "sem"];
export const setorLabel = (s) => (SETORES[s || "sem"] || SETORES.sem).label;

/** Nome digitado sem espaços sobrando ("  Pedro   Silva " → "Pedro Silva"). */
export const limparNome = (s) => String(s ?? "").replace(/\s+/g, " ").trim();

/** Situação atual da chave a partir da linha de chaves_unidades (ou null). */
export function situacao(row) {
  return {
    setor: row?.setor || "sem",
    responsavel: row?.responsavel || "",
    movimentadoEm: row?.movimentado_em || null,
    movimentadoPor: row?.movimentado_por === "planilha" ? "planilha de levantamento" : row?.movimentado_por || "",
    ultimaMov: row?.movimentacao_id ?? null
  };
}

/**
 * Filtros do mapa e da lista.
 * @param u  {b, codigo, situacao:{setor}, vistoria}
 * @param f  {bloco, apto, setor:[], vistoria}
 */
export function passaFiltros(u, f) {
  if (f.bloco && f.bloco !== "ALL" && u.b !== f.bloco) return false;
  if (f.setor?.length && !f.setor.includes(u.situacao.setor)) return false;
  if (f.vistoria && u.vistoria !== f.vistoria) return false;
  if (f.apto) {
    const q = String(f.apto).toUpperCase().replace(/[\s·-]+/g, "");
    const cod = String(u.codigo).toUpperCase(), full = String(u.b).toUpperCase() + cod;
    if (!(cod.includes(q) || full.includes(q) || cod.replace(/^0+/, "") === q.replace(/^0+/, ""))) return false;
  }
  return true;
}

/** Quantidade de unidades por setor (+ total e transferências de hoje). */
export function indicadores(lista, hoje = 0) {
  const out = { total: lista.length, hoje };
  STATUS_ORDEM.forEach((s) => (out[s] = 0));
  lista.forEach((u) => out[u.situacao.setor]++);
  return out;
}

/** Validação da transferência (o banco confere de novo). Devolve a mensagem de erro ou "". */
export function validarTransferencia({ setor, responsavel }, atual) {
  if (!SETORES_DESTINO.includes(setor)) return "Selecione o setor de destino.";
  const nome = limparNome(responsavel);
  if (nome.length < 2) return "Informe o responsável que está recebendo a chave.";
  if (nome.length > 80) return "Nome do responsável muito longo.";
  if (atual && atual.setor === setor && atual.responsavel.toLowerCase() === nome.toLowerCase()) {
    return `A chave já está com ${atual.responsavel} (${setorLabel(setor)}).`;
  }
  return "";
}

const TIPOS = { cadastro: "Levantamento", retirada: "Retirada", devolucao: "Devolução", transferencia: "Transferência", ocorrencia: "Ocorrência" };

/** Linha do histórico: de onde → para onde, quem recebeu, quem estava antes. */
export function descreverMov(m) {
  const legado = m.tipo !== "transferencia";
  return {
    titulo: m.tipo === "cadastro" && m.registrado_email === "planilha" ? "Levantamento inicial" : TIPOS[m.tipo] || m.tipo,
    de: legado ? null : m.setor_origem || "sem",
    para: m.setor || null,
    recebeu: m.tipo === "devolucao" ? m.recebido_por || "" : m.responsavel || "",
    anterior: legado ? (m.tipo === "devolucao" ? m.responsavel || "" : "") : m.responsavel_anterior || "",
    quando: m.data_hora || m.registrado_em,
    por: m.registrado_email === "planilha" ? "planilha de levantamento" : m.registrado_email || "sistema",
    obs: m.registrado_email === "planilha" ? "" : m.observacoes || ""
  };
}
