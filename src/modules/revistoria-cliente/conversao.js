// Regras de exibição das versões de um relatório (original do Mobuss × relatório compacto convertido).
// Puro: usado pela tela do relatório e pelos testes (scripts/check.mjs).

export const ETAPAS = ["aguardando", "processando", "extraindo", "organizando_fotos", "gerando"];
export const STATUS = {
  pendente: { label: "Pendente de conversão", curto: "Pendente" },
  aguardando: { label: "Aguardando processamento", curto: "Aguardando" },
  processando: { label: "Processando", curto: "Processando" },
  extraindo: { label: "Extraindo dados do PDF", curto: "Extraindo" },
  organizando_fotos: { label: "Organizando fotos", curto: "Organizando fotos" },
  gerando: { label: "Gerando relatório compacto", curto: "Gerando" },
  disponivel: { label: "Disponível", curto: "Disponível" },
  falha: { label: "Falha na conversão", curto: "Falha" },
};
export const emAndamento = (s) => ETAPAS.includes(s);
export const rotulo = (s) => STATUS[s]?.label || STATUS.pendente.label;

/**
 * Versões de um relatório: { original, vigente (convertida exibida por padrão), convertidas (mais nova primeiro),
 * andamento (conversão em curso), ultima (última tentativa), status (situação a mostrar) }.
 * Sem a tabela de versões (banco antigo) o original vem do próprio registro do relatório.
 */
export function versoesDoRelatorio(rel, versoes = []) {
  if (!rel) return { original: null, vigente: null, convertidas: [], andamento: null, ultima: null, status: "pendente" };
  const doRel = (versoes || []).filter((v) => v.relatorio_id === rel.id);
  const original = doRel.find((v) => v.tipo === "original") ||
    { id: null, relatorio_id: rel.id, tipo: "original", versao: 1, status: "disponivel", caminho: rel.caminho, tamanho: rel.tamanho, paginas: rel.paginas, criado_em: rel.enviado_em, solicitado_email: rel.enviado_email };
  const convertidas = doRel.filter((v) => v.tipo === "convertido").sort((a, b) => b.versao - a.versao);
  const disponiveis = convertidas.filter((v) => v.status === "disponivel" && v.caminho);
  const vigente = disponiveis.find((v) => v.id === rel.convertido_id) || disponiveis[0] || null;
  const andamento = convertidas.find((v) => emAndamento(v.status)) || null;
  const ultima = convertidas[0] || null;
  let status = rel.conversao_status || (ultima ? ultima.status : "pendente");
  if (andamento) status = andamento.status;
  else if (ultima) status = ultima.status;
  if (status === "disponivel" && !vigente) status = "pendente";
  return { original, vigente, convertidas, andamento, ultima, status };
}

/** Qual arquivo abrir: a escolha do usuário (uma versão do histórico, "original" ou "convertido"); por padrão o convertido. */
export function arquivoExibido(info, escolha) {
  if (!info?.original) return null;
  if (escolha && typeof escolha === "object") {
    const v = [info.original, ...info.convertidas].find((x) => x.id === escolha.id && x.caminho && x.status === "disponivel");
    if (v) return v;
  }
  if (escolha === "original" || !info.vigente) return info.original;
  return info.vigente;
}

/** Nome do arquivo para download. */
export function nomeDownload(rel, v) {
  const base = String(rel?.nome_arquivo || "relatorio.pdf").replace(/\.pdf$/i, "");
  return v?.tipo === "convertido" ? `${base} - compacto v${v.versao}.pdf` : `${base}.pdf`;
}
