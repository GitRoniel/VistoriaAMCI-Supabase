// Orquestra a conversão Mobuss → relatório compacto (mesmo código no Node, para os testes, e no Deno, na Edge Function).
//   ler (texto + fotos) → extrair (NCs, itens, fotos) → validar → gerar o PDF compacto.
// `etapa(nome)` é chamada a cada fase (extraindo, organizando_fotos, gerando) para a tela acompanhar.
import { criarLeitor } from "./leitor.js";
import { extrair } from "./extrator.js";
import { criarDicionario } from "./dicionario.js";
import { criarGerador, resumir } from "./gerador.js";

export const VERSAO_CONVERSOR = "mobuss-compacto-1";

export class ErroConversao extends Error {
  constructor(msg, detalhe) { super(msg); this.name = "ErroConversao"; this.detalhe = detalhe; }
}

/** Confere o que foi extraído antes de gerar. Erros impedem a geração; avisos vão para o relatório e o resumo. */
export function validar(ext, totalPaginas) {
  const temTexto = ext.itens.length || ext.ncs.length || ext.cabecalho.unidade || ext.cabecalho.obra;
  if (!temTexto)
    throw new ErroConversao(`O PDF não tem texto legível (${totalPaginas} página(s)). Parece digitalizado/imagem: envie o relatório exportado pelo Mobuss.`);
  if (!ext.cabecalho.unidade && !ext.ambientes.length)
    throw new ErroConversao("O arquivo não parece um Relatório de Entrega da Unidade do Mobuss (unidade e ambientes não encontrados).");
  if (!ext.ncs.length)
    throw new ErroConversao("Nenhuma não conformidade foi encontrada no relatório. Confira se o PDF é o relatório da vistoria com as NCs.");
  if (ext.cabecalho.ncsDeclaradas != null && ext.cabecalho.ncsDeclaradas !== ext.ncs.length)
    throw new ErroConversao(`O Mobuss informa ${ext.cabecalho.ncsDeclaradas} não conformidade(s), mas foram lidas ${ext.ncs.length}. A conversão foi interrompida para não gerar um relatório incompleto.`);
  const repetidas = ext.ncs.map((n) => n.numero).filter((n, i, a) => a.indexOf(n) !== i);
  if (repetidas.length) throw new ErroConversao(`NC(s) repetida(s) no documento: ${[...new Set(repetidas)].join(", ")}.`);
  const fotos = new Set();
  for (const f of [...ext.ncs.flatMap((n) => n.fotos), ...ext.fotosItem.flatMap((i) => i.fotos), ...ext.naoAssociadas]) {
    const k = f.ref?.toString?.() + "@" + f.pagina + "#" + f.seq;
    if (fotos.has(k)) throw new ErroConversao("Foto associada mais de uma vez (falha interna de associação).");
    fotos.add(k);
  }
}

/** Resumo gravado com a versão convertida (sem dados pessoais do cliente). */
export function resumoVersao(ext, dic, totalPaginas, semEquivalencia) {
  const r = resumir(ext, dic), c = ext.cabecalho;
  return {
    ncs: ext.ncs.length, fotos: ext.totais.fotos, fotosNc: ext.totais.fotosNc, fotosItem: ext.totais.fotosItem,
    fotosNaoAssociadas: ext.totais.fotosNaoAssociadas, itensReprovados: ext.totais.itensReprovados, paginasOriginal: totalPaginas,
    cabecalho: { obra: c.obra, unidade: c.unidade, bloco: c.bloco, apto: c.apto, dataVistoria: c.dataVistoria, responsavel: c.responsavel, ncsDeclaradas: c.ncsDeclaradas },
    porAmbiente: r.porAmbiente, porServico: r.porServico, ncsSemFoto: r.ncsSemFoto, ncsSemDescricao: r.ncsSemDescricao,
    semEquivalencia: semEquivalencia.slice(0, 40), avisos: ext.avisos.slice(0, 40),
    apontamentos: ext.ncs.map((n) => ({ nc: n.numero, ambiente: n.ambiente, servico: dic.nome(n.servicoOriginal).curto, descricao: n.descricao, fotos: n.fotos.length })),
  };
}

/**
 * @param {any} PDFLib
 * @param {Uint8Array} dados
 * @param {{ regras?: Array<{original: string, curto: string, ativo?: boolean}>, etapa?: (nome: string) => Promise<void>, geradoEm?: Date }} [opcoes]
 */
export async function converter(PDFLib, dados, { regras = [], etapa = async (_nome) => {}, geradoEm = new Date() } = {}) {
  await etapa("extraindo");
  let lido;
  try { lido = await criarLeitor(PDFLib)(dados); }
  catch (e) { throw new ErroConversao("Não foi possível abrir o PDF (arquivo corrompido ou protegido).", String(e?.message || e)); }
  const ext = extrair(lido.paginas);
  validar(ext, lido.totalPaginas);
  await etapa("organizando_fotos");
  const dic = criarDicionario(regras);
  await etapa("gerando");
  const g = await criarGerador(PDFLib)({ extracao: ext, origem: lido, dicionario: dic, geradoEm });
  return { bytes: g.bytes, paginas: g.paginas, extracao: ext, resumo: resumoVersao(ext, dic, lido.totalPaginas, g.semEquivalencia) };
}
