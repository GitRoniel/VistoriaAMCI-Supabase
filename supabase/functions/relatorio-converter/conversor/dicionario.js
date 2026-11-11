// Dicionário de equivalência dos nomes de serviço: o nome longo do checklist do Mobuss vira o nome curto usado
// no relatório compacto. É configurável: a tabela public.relatorio_servicos_dicionario (editável pelos admins)
// tem prioridade sobre os padrões abaixo, e serviços sem equivalência mantêm o nome original (e são listados
// como "sem equivalência" para o admin cadastrar).

/** Equivalências padrão (as mesmas semeadas na tabela). */
export const PADRAO = [
  { original: "REVESTIMENTO - PISO/PAREDE (CERÂMICO)", curto: "Cerâmica" },
  { original: "REVESTIMENTO - PAREDE/TETO (SKIN COAT)", curto: "Skin Coat" },
  { original: "REVESTIMENTO - PISO (LAMINADO)", curto: "Piso Laminado" },
  { original: "SISTEMA ELÉTRICO - TOMADAS", curto: "Tomadas" },
  { original: "SISTEMA HIDRÁULICO - LOUÇAS E METAIS", curto: "Louças e Metais" },
  { original: "ESQUADRIAS - PORTAS", curto: "Portas" },
  { original: "ESQUADRIAS - JANELA", curto: "Janelas" },
];

/** Chave de comparação: sem acentos, sem espaços nem pontuação, em minúsculas
 *  ("REVESTIMENTO - PISO/ PAREDE (CERÂMICO)" e "Revestimento - Piso/Parede (Cerâmico)" são o mesmo serviço). */
export const chaveServico = (s) => String(s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * regras: [{ original, curto, ativo? }] — da tabela (prioridade) seguidas das padrão.
 * Retorna { nome(original) → { curto, original, encontrado }, semEquivalencia: Set }.
 */
export function criarDicionario(regras = []) {
  const mapa = new Map();
  for (const r of [...(regras || []), ...PADRAO]) {
    if (!r || r.ativo === false) continue;
    const k = chaveServico(r.original), c = String(r.curto ?? "").trim();
    if (k && c && !mapa.has(k)) mapa.set(k, c);
  }
  const semEquivalencia = new Set();
  return {
    semEquivalencia,
    nome(original) {
      const o = String(original ?? "").replace(/\s+/g, " ").trim();
      if (!o) return { original: "", curto: "Não informado", encontrado: false };
      const c = mapa.get(chaveServico(o));
      if (c) return { original: o, curto: c, encontrado: true };
      semEquivalencia.add(o);
      return { original: o, curto: o, encontrado: false };
    },
  };
}
