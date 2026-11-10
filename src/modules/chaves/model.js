// Controle de Chaves: regras puras (sem tela nem Supabase), usadas pela aba Chaves e pelos testes.
//
// A chave de cada unidade é acompanhada como um todo: em que setor está (cor no mapa) e quem é o
// responsável. Operações: "Transferir para outro setor" e o ciclo da chave perdida
// (Marcar chave perdida → Chaveiro solicitado → Cópia realizada → Regularizar chave).
//   Base (azul) · CX (verde) · Asstec (laranja) · Produção (vermelho) · Entregue para Cliente (roxo) · Sem status (cinza)
// Chave perdida = sem status com ocorrência aberta: tem prioridade visual (cinza hachurado + selo).
// O status da vistoria vem de client_inspections e é mostrado à parte: este módulo nunca o altera.

import { SETORES_PADRAO } from "../cores/model.js";

// Cores: as padrão abaixo valem até o Admin personalizar (tabela cores_legendas, via window.AmciCores);
// aplicarCores() troca cor/borda/texto aqui mesmo, e todo o módulo passa a usar a cor configurada.
export const SETORES = {
  base: { label: "Base", cor: "#2f6fdb", borda: "#2459b5", texto: "#ffffff" },
  cx: { label: "CX", cor: "#2f9e5b", borda: "#268a4d", texto: "#ffffff" },
  asstec: { label: "Asstec", cor: "#e8842a", borda: "#c96a1a", texto: "#ffffff" },
  producao: { label: "Produção", cor: "#d64545", borda: "#b33636", texto: "#ffffff" },
  cliente: { label: "Entregue para Cliente", cor: "#7b4fc9", borda: "#6340a8", texto: "#ffffff" },
  sem: { label: "Sem status", cor: "#e4e8e5", borda: "#c3cac5", texto: "#7a857e" }
};
/** Aplica as cores centralizadas (window.AmciCores.get()) nos setores; sem configuração = cor padrão. */
export function aplicarCores(cfg) {
  for (const k of Object.keys(SETORES)) {
    const c = cfg?.setores?.[k] || SETORES_PADRAO[k];
    if (c) Object.assign(SETORES[k], { cor: c.cor, borda: c.borda, texto: c.texto });
  }
}
/** Setores para onde a chave pode ser transferida (ou regularizada). */
export const SETORES_DESTINO = ["base", "cx", "asstec", "producao", "cliente"];
export const STATUS_ORDEM = ["base", "cx", "asstec", "producao", "cliente", "sem"];
export const setorLabel = (s) => (SETORES[s || "sem"] || SETORES.sem).label;

/** Etapas da ocorrência de chave perdida (a última fecha a ocorrência). */
export const ETAPAS = {
  perdida: { label: "Chave perdida", acao: "Ocorrência registrada, aguardando providência" },
  chaveiro_solicitado: { label: "Chaveiro solicitado", acao: "Serviço solicitado" },
  copia_realizada: { label: "Cópia realizada", acao: "Nova chave confeccionada" },
  regularizada: { label: "Chave regularizada", acao: "Chave disponível e controle normalizado" }
};
export const ETAPAS_ORDEM = ["perdida", "chaveiro_solicitado", "copia_realizada", "regularizada"];
/** Filtro "Chave perdida": todas as ocorrências abertas ou uma etapa. */
export const PERDIDAS_TODAS = "todas";

/** Próximos passos possíveis de uma ocorrência aberta (a chave pode ser encontrada a qualquer momento). */
export function proximosPassos(etapa) {
  if (etapa === "perdida") return ["chaveiro", "regularizar"];
  if (etapa === "chaveiro_solicitado") return ["copia", "regularizar"];
  if (etapa === "copia_realizada") return ["regularizar"];
  return [];
}

/** Nome digitado sem espaços sobrando ("  Pedro   Silva " → "Pedro Silva"). */
export const limparNome = (s) => String(s ?? "").replace(/\s+/g, " ").trim();

/** Situação atual da chave a partir da linha de chaves_unidades (ou null) e da ocorrência aberta (ou null). */
export function situacao(row, ocorrencia = null) {
  return {
    setor: row?.setor || "sem",
    responsavel: row?.responsavel || "",
    movimentadoEm: row?.movimentado_em || null,
    movimentadoPor: row?.movimentado_por === "planilha" ? "planilha de levantamento" : row?.movimentado_por || "",
    ultimaMov: row?.movimentacao_id ?? null,
    perdida: ocorrencia && ocorrencia.etapa !== "regularizada" ? ocorrencia : null
  };
}

/**
 * Filtros do mapa e da lista.
 * @param u  {b, codigo, situacao:{setor, perdida}, vistoria}
 * @param f  {bloco, apto, setor:[], vistoria, perdida: "" | "todas" | etapa}
 */
export function passaFiltros(u, f) {
  if (f.bloco && f.bloco !== "ALL" && u.b !== f.bloco) return false;
  if (f.setor?.length && !f.setor.includes(u.situacao.setor)) return false;
  if (f.vistoria && u.vistoria !== f.vistoria) return false;
  if (f.perdida) {
    const o = u.situacao.perdida;
    if (!o || (f.perdida !== PERDIDAS_TODAS && o.etapa !== f.perdida)) return false;
  }
  if (f.apto) {
    const q = String(f.apto).toUpperCase().replace(/[\s·-]+/g, "");
    const cod = String(u.codigo).toUpperCase(), full = String(u.b).toUpperCase() + cod;
    if (!(cod.includes(q) || full.includes(q) || cod.replace(/^0+/, "") === q.replace(/^0+/, ""))) return false;
  }
  return true;
}

/** Quantidade de unidades por setor, chaves perdidas (e por etapa) e transferências de hoje. */
export function indicadores(lista, hoje = 0) {
  const out = { total: lista.length, hoje, perdidas: 0 };
  STATUS_ORDEM.forEach((s) => (out[s] = 0));
  ETAPAS_ORDEM.forEach((e) => (out[e] = 0));
  lista.forEach((u) => { out[u.situacao.setor]++; if (u.situacao.perdida) { out.perdidas++; out[u.situacao.perdida.etapa]++; } });
  return out;
}

/** Nome obrigatório (2 a 80 letras). Devolve a mensagem de erro ou "". */
export function validarNome(nome, campo) {
  const n = limparNome(nome);
  if (n.length < 2) return `Informe ${campo}.`;
  if (n.length > 80) return "Nome muito longo.";
  return "";
}

/** Validação da transferência (o banco confere de novo). Devolve a mensagem de erro ou "". */
export function validarTransferencia({ setor, responsavel }, atual) {
  if (atual?.perdida) return "A chave está registrada como perdida: use Regularizar chave.";
  if (!SETORES_DESTINO.includes(setor)) return "Selecione o setor de destino.";
  const erro = validarNome(responsavel, "o responsável que está recebendo a chave");
  if (erro) return erro;
  const nome = limparNome(responsavel);
  if (atual && atual.setor === setor && atual.responsavel.toLowerCase() === nome.toLowerCase()) {
    return `A chave já está com ${atual.responsavel} (${setorLabel(setor)}).`;
  }
  return "";
}

/** Validação da regularização: setor que fica com a nova chave e quem recebe. */
export function validarRegularizacao({ setor, responsavel }) {
  if (!SETORES_DESTINO.includes(setor)) return "Selecione o setor que ficará com a nova chave.";
  return validarNome(responsavel, "o responsável que está recebendo a chave");
}

const TIPOS = {
  cadastro: "Levantamento", retirada: "Retirada", devolucao: "Devolução", transferencia: "Transferência", ocorrencia: "Ocorrência",
  perda: "Chave perdida", chaveiro: "Chaveiro solicitado", copia: "Cópia realizada", regularizacao: "Chave regularizada"
};
const QUEM = { perda: "Identificado por", chaveiro: "Solicitado por", copia: "Responsável", regularizacao: "Recebeu", transferencia: "Recebeu" };

/** Linha do histórico: de onde → para onde, quem (recebeu, identificou, solicitou…), quem estava antes. */
export function descreverMov(m) {
  const legado = !["transferencia", "perda", "regularizacao"].includes(m.tipo);
  return {
    titulo: m.tipo === "cadastro" && m.registrado_email === "planilha" ? "Levantamento inicial" : TIPOS[m.tipo] || m.tipo,
    ocorrencia: ["perda", "chaveiro", "copia", "regularizacao"].includes(m.tipo),
    de: legado ? null : m.setor_origem || "sem",
    para: m.tipo === "perda" ? "sem" : m.setor || null,
    quemRotulo: QUEM[m.tipo] || "Recebeu",
    recebeu: m.tipo === "devolucao" ? m.recebido_por || "" : m.responsavel || "",
    anterior: m.tipo === "devolucao" ? m.responsavel || "" : ["transferencia", "perda"].includes(m.tipo) ? m.responsavel_anterior || "" : "",
    quando: m.data_hora || m.registrado_em,
    por: m.registrado_email === "planilha" ? "planilha de levantamento" : m.registrado_email || "sistema",
    obs: m.registrado_email === "planilha" ? "" : m.observacoes || ""
  };
}
