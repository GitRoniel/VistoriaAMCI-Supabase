// Controle de Chaves: regras puras (sem tela nem Supabase), usadas pela aba Chaves e pelos testes.
//
// Situação das chaves de uma unidade (cor no mapa):
//   Base (azul)      todas as chaves cadastradas estão no claviculário
//   CX / Asstec /    há chaves retiradas com o setor (se houver mais de um setor, vale a retirada mais
//   Produção         recente); "parcial" quando parte continua na Base
//   Sem status       nenhuma chave cadastrada e o levantamento não indicou chaves
// Base "a cadastrar": o levantamento indicou chaves, mas as quantidades por categoria ainda não foram
// cadastradas (a retirada exige identificar cada chave).
// O status da vistoria vem de client_inspections e é mostrado à parte: este módulo nunca o altera.

export const SETORES = {
  base: { label: "Base", cor: "#2f6fdb", borda: "#2459b5", texto: "#ffffff" },
  cx: { label: "CX", cor: "#2f9e5b", borda: "#268a4d", texto: "#ffffff" },
  asstec: { label: "Asstec", cor: "#e8842a", borda: "#c96a1a", texto: "#ffffff" },
  producao: { label: "Produção", cor: "#d64545", borda: "#b33636", texto: "#ffffff" },
  sem: { label: "Sem status", cor: "#e4e8e5", borda: "#c3cac5", texto: "#7a857e" }
};
export const SETORES_DESTINO = ["cx", "asstec", "producao"];
export const STATUS_ORDEM = ["base", "cx", "asstec", "producao", "sem"];
export const CATEGORIAS = { entrada: "Entrada", quarto: "Quarto", banheiro: "Banheiro" };
export const TIPOS_MOV = {
  cadastro: "Cadastro", retirada: "Retirada", devolucao: "Devolução", transferencia: "Transferência", ocorrencia: "Ocorrência"
};
export const SITUACOES = {
  disponivel: "Todas as chaves na Base",
  retirada: "Com chaves retiradas",
  pendente: "Devolução pendente",
  divergencia: "Com divergência",
  cadastrar: "Quantidades a cadastrar",
  sem: "Sem status"
};

/** Rótulo de uma chave: "Entrada", "Quarto 2", "Banheiro 1" (+ " · cópia n" quando pedido). */
export function rotuloChave(k, comCopia = false) {
  const base = k.categoria === "entrada" ? "Entrada" : `${CATEGORIAS[k.categoria] || k.categoria} ${k.comodo}`;
  return comCopia ? `${base} · cópia ${k.copia}` : base;
}

const ordemCat = { entrada: 0, quarto: 1, banheiro: 2 };
export const ordenarChaves = (a, b) => (ordemCat[a.categoria] - ordemCat[b.categoria]) || (a.comodo - b.comodo) || (a.copia - b.copia);

/** Tipologia como texto. */
export const tipologiaLabel = (q) => (q ? `${q} quarto${q > 1 ? "s" : ""}` : "Não informada");

/**
 * Resumo das chaves de uma unidade.
 * @param {{tem_chaves?:boolean}|null} cadastro  linha de chaves_unidades (ou null)
 * @param {Array} chaves  chaves da unidade (situacao ativa ou extraviada)
 * @param {number|null} quartos  tipologia
 * @param {number} agora  Date.now()
 */
export function resumoUnidade(cadastro, chaves = [], quartos = null, agora = Date.now()) {
  const ativas = chaves.filter((k) => k.situacao === "ativa");
  const extraviadas = chaves.filter((k) => k.situacao === "extraviada");
  const fora = ativas.filter((k) => k.local !== "base");
  const naBase = ativas.length - fora.length;
  const atrasadas = fora.filter((k) => k.previsao_devolucao && new Date(k.previsao_devolucao).getTime() < agora);
  const aCadastrar = !!cadastro?.tem_chaves && ativas.length === 0 && extraviadas.length === 0;
  let status = "sem";
  if (fora.length) {
    // setor da retirada mais recente
    const ult = [...fora].sort((a, b) => String(b.retirada_em || "").localeCompare(String(a.retirada_em || "")))[0];
    status = ult.local;
  } else if (ativas.length || aCadastrar) status = "base";
  const divergencias = [];
  if (extraviadas.length) divergencias.push(`${extraviadas.length} chave${extraviadas.length > 1 ? "s" : ""} extraviada${extraviadas.length > 1 ? "s" : ""}`);
  if (ativas.length) {
    if (!ativas.some((k) => k.categoria === "entrada")) divergencias.push("Nenhuma chave de entrada disponível no cadastro");
    const nQuartos = new Set(ativas.filter((k) => k.categoria === "quarto").map((k) => k.comodo)).size;
    if (quartos && nQuartos !== quartos) divergencias.push(`Chaves de ${nQuartos} quarto${nQuartos === 1 ? "" : "s"} para tipologia de ${quartos} quartos`);
  }
  const setoresFora = [...new Set(fora.map((k) => k.local))];
  const responsaveis = [...new Set(fora.map((k) => k.responsavel).filter(Boolean))];
  const proxPrevisao = fora.map((k) => k.previsao_devolucao).filter(Boolean).sort()[0] || null;
  return {
    status, total: ativas.length, naBase, fora: fora.length, parcial: fora.length > 0 && naBase > 0,
    pendente: atrasadas.length > 0, atrasadas: atrasadas.length, extraviadas: extraviadas.length,
    aCadastrar, divergencias, divergente: divergencias.length > 0, setoresFora, responsaveis, proxPrevisao,
    disponivel: ativas.length > 0 && fora.length === 0
  };
}

/** Agrupa as chaves por item (Entrada, Quarto n, Banheiro n) com as cópias e onde cada uma está. */
export function itensDaUnidade(chaves = []) {
  const mapa = new Map();
  [...chaves].sort(ordenarChaves).forEach((k) => {
    const id = `${k.categoria}-${k.comodo}`;
    if (!mapa.has(id)) mapa.set(id, { id, categoria: k.categoria, comodo: k.comodo, rotulo: rotuloChave(k), copias: [] });
    mapa.get(id).copias.push(k);
  });
  return [...mapa.values()].map((it) => {
    const ativas = it.copias.filter((k) => k.situacao === "ativa");
    const base = ativas.filter((k) => k.local === "base").length;
    return { ...it, total: ativas.length, base, fora: ativas.length - base, extraviadas: it.copias.length - ativas.length,
      situacao: !ativas.length ? "extraviada" : base === ativas.length ? "disponivel" : base === 0 ? "retirada" : "parcial" };
  });
}

/** Itens sugeridos para o cadastro, pela tipologia (o usuário ajusta as quantidades). */
export function cadastroSugerido(quartos, chavesAtuais = []) {
  const atual = new Map();
  chavesAtuais.filter((k) => k.situacao === "ativa").forEach((k) => {
    const id = `${k.categoria}-${k.comodo}`; atual.set(id, (atual.get(id) || 0) + 1);
  });
  const nQ = Math.max(quartos || 0, ...chavesAtuais.filter((k) => k.categoria === "quarto").map((k) => k.comodo), 0) || 2;
  const nB = Math.max(...chavesAtuais.filter((k) => k.categoria === "banheiro").map((k) => k.comodo), 0) || (nQ >= 3 ? 2 : 1);
  const it = (categoria, comodo) => ({ categoria, comodo, copias: atual.has(`${categoria}-${comodo}`) ? atual.get(`${categoria}-${comodo}`) : (atual.size ? 0 : 1) });
  return [it("entrada", 1), ...Array.from({ length: nQ }, (_, i) => it("quarto", i + 1)), ...Array.from({ length: nB }, (_, i) => it("banheiro", i + 1))];
}

/** Uma unidade passa nos filtros? `u` = {bloco, pav, apto, codigo, quartos, vistoria, resumo}. */
export function passaFiltros(u, f) {
  if (f.bloco && f.bloco !== "ALL" && u.bloco !== f.bloco) return false;
  if (f.apto) {
    const q = String(f.apto).toUpperCase().replace(/[\s\-.]/g, "");
    const cod = String(u.codigo).toUpperCase(), full = (u.bloco + cod).toUpperCase();
    if (!(cod === q || full === q || cod.endsWith(q) || full.includes(q))) return false;
  }
  if (f.status?.length && !f.status.includes(u.resumo.status) && !(u.resumo.setoresFora || []).some((s) => f.status.includes(s))) return false;
  if (f.tipologia && f.tipologia !== "ALL" && String(u.quartos || "") !== (f.tipologia === "ni" ? "" : f.tipologia)) return false;
  if (f.vistoria?.length && !f.vistoria.includes(u.vistoria)) return false;
  const r = u.resumo;
  switch (f.situacao) {
    case "disponivel": if (!r.disponivel) return false; break;
    case "retirada": if (!r.fora) return false; break;
    case "pendente": if (!r.pendente) return false; break;
    case "divergencia": if (!r.divergente) return false; break;
    case "cadastrar": if (!r.aCadastrar) return false; break;
    case "sem": if (r.status !== "sem") return false; break;
  }
  switch (f.rapido) {
    case "aprovada-disponivel": if (!(u.vistoria === "ap" && (r.disponivel || (r.aCadastrar && r.status === "base")))) return false; break;
    case "aguardando": if (!["na", "ag", "rm", "rv"].includes(u.vistoria)) return false; break;
  }
  return true;
}

/** Indicadores do topo. `movsHoje` = movimentações (retirada, devolução, transferência) registradas hoje. */
export function indicadores(unidades, movsHoje = 0) {
  const r = unidades.map((u) => u.resumo);
  return {
    total: unidades.length,
    disponiveis: r.filter((x) => x.disponivel).length,
    retiradas: r.filter((x) => x.fora > 0).length,
    pendentes: r.filter((x) => x.pendente).length,
    semStatus: r.filter((x) => x.status === "sem").length,
    aCadastrar: r.filter((x) => x.aCadastrar).length,
    divergentes: r.filter((x) => x.divergente).length,
    movsHoje
  };
}

/** Valida o formulário de retirada/transferência antes de pedir confirmação. Devolve a mensagem de erro ou "". */
export function validarSaida({ ids, setor, responsavel, dataHora, previsao }, agora = Date.now()) {
  if (!ids?.length) return "Selecione as chaves movimentadas.";
  if (!SETORES_DESTINO.includes(setor)) return "Escolha o setor de destino.";
  if (String(responsavel || "").trim().length < 2) return "Informe o responsável.";
  if (!dataHora) return "Informe a data e a hora.";
  const t = new Date(dataHora).getTime();
  if (Number.isNaN(t)) return "Data inválida.";
  if (t > agora + 10 * 60e3) return "A data não pode estar no futuro.";
  if (previsao && new Date(previsao).getTime() < t) return "A previsão de devolução é anterior à data informada.";
  return "";
}
export function validarDevolucao({ ids, recebidoPor, dataHora }, agora = Date.now()) {
  if (!ids?.length) return "Selecione as chaves devolvidas.";
  if (String(recebidoPor || "").trim().length < 2) return "Informe quem recebeu as chaves.";
  if (!dataHora) return "Informe a data e a hora.";
  const t = new Date(dataHora).getTime();
  if (Number.isNaN(t)) return "Data inválida.";
  if (t > agora + 10 * 60e3) return "A data não pode estar no futuro.";
  return "";
}

/** Resumo legível de uma lista de chaves movimentadas: "Entrada (2), Quarto 1, Banheiro 2". */
export function resumoChaves(lista = []) {
  const cont = new Map();
  [...lista].sort(ordenarChaves).forEach((k) => { const r = rotuloChave(k); cont.set(r, (cont.get(r) || 0) + 1); });
  return [...cont.entries()].map(([r, n]) => (n > 1 ? `${r} (${n})` : r)).join(", ");
}
