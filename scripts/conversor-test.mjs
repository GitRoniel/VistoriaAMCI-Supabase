// Testes do conversor Mobuss → relatório compacto (o mesmo código da Edge Function relatorio-converter),
// com um PDF sintético no formato do Mobuss (dados fictícios). Uso: pnpm test:conversor
// Opcional: node scripts/conversor-test.mjs <relatorio-mobuss.pdf> [ncs-esperadas] [fotos-esperadas] — confere um PDF real
// (os PDFs reais têm dados de clientes e não ficam no repositório).
import * as PDFLib from "pdf-lib";
import fs from "node:fs";
import { gerarMobussSintetico } from "./fixtures/mobuss-sintetico.mjs";
import { criarLeitor } from "../supabase/functions/relatorio-converter/conversor/leitor.js";
import { extrair, descricaoNc } from "../supabase/functions/relatorio-converter/conversor/extrator.js";
import { criarDicionario, chaveServico } from "../supabase/functions/relatorio-converter/conversor/dicionario.js";
import { converter, validar, ErroConversao } from "../supabase/functions/relatorio-converter/conversor/converter.js";

let falhas = 0;
const ok = (c, m) => { console.log((c ? "✔" : "✘") + " " + m); if (!c) falhas++; };
const igual = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ── dicionário ──
const dic = criarDicionario([{ original: "Esquadrias - Portas", curto: "Portas (obra)" }, { original: "IMPERMEABILIZAÇÃO", curto: "Imperm.", ativo: false }]);
ok(dic.nome("REVESTIMENTO - PISO/ PAREDE (CERÂMICO)").curto === "Cerâmica", "dicionário: espaços do Mobuss não atrapalham (Cerâmica)");
ok(dic.nome("REVESTIMENTO - PAREDE/ TETO( SKIN COAT)").curto === "Skin Coat", "dicionário: Skin Coat");
ok(dic.nome("REVESTIMENTO - PISO ( LAMINADO)").curto === "Piso Laminado", "dicionário: Piso Laminado");
ok(dic.nome("SISTEMA ELÉTRICO - TOMADAS").curto === "Tomadas" && dic.nome("SISTEMA HIDRÁULICO - LOUÇAS E METAIS").curto === "Louças e Metais", "dicionário: Tomadas / Louças e Metais");
ok(dic.nome("ESQUADRIAS - JANELA").curto === "Janelas", "dicionário: Janelas");
ok(dic.nome("ESQUADRIAS - PORTAS").curto === "Portas (obra)", "dicionário: regra do banco tem prioridade sobre o padrão");
ok(dic.nome("IMPERMEABILIZAÇÃO").curto === "IMPERMEABILIZAÇÃO" && dic.semEquivalencia.has("IMPERMEABILIZAÇÃO"), "dicionário: regra desativada não vale; sem equivalência mantém o nome e é listado");
ok(dic.nome("").curto === "Não informado", "dicionário: serviço vazio = Não informado");
ok(chaveServico("Louças e Metais") === "loucasemetais", "chave do serviço sem acento/pontuação");

// ── descrição da NC ──
ok(descricaoNc(["Não Conformidade criada automaticamente a partir do item X, do Formulário CHECKLIST VISTORIA CLIENTE", "Trinca na parede"]) === "Trinca na parede", "descrição: remove o texto automático");
ok(descricaoNc(["Não Conformidade criada automaticamente a partir do item X, do Formulário CHECKLIST VISTORIA CLIENTE, localizado na SALA"], { ambiente: "SALA", servico: "X" }) === "", "descrição: só o texto automático = vazia (vira Não informado)");

// ── PDF sintético ──
const { bytes, esperado: E } = await gerarMobussSintetico(PDFLib);
const lido = await criarLeitor(PDFLib)(bytes);
const x = extrair(lido.paginas);
ok(lido.totalPaginas === 4, "leitor: 4 páginas");
for (const k of Object.keys(E.cabecalho)) ok(x.cabecalho[k] === E.cabecalho[k], `cabeçalho ${k}: ${x.cabecalho[k]}`);
ok(igual(x.ambientes, E.ambientes), "ambientes na ordem do documento");
ok(x.ncs.length === 5 && igual(x.ncs.map((n) => n.numero), [10, 11, 12, 13, 14]), "5 NCs na ordem do documento");
for (const [i, e] of E.ncs.entries()) {
  const n = x.ncs[i] || {};
  ok(n.ambiente === e.ambiente && n.servicoOriginal === e.servico, `NC ${e.numero}: ambiente e serviço`);
  ok(n.descricao === e.descricao, `NC ${e.numero}: descrição "${n.descricao}"`);
  ok(igual((n.fotos || []).map((f) => f.arquivo), e.fotos), `NC ${e.numero}: fotos ${JSON.stringify((n.fotos || []).map((f) => f.arquivo))}`);
}
ok(x.ncs[2].fotos.map((f) => f.pagina).join() === "2,3", "NC 12: anexos atravessam a quebra de página (págs. 2 e 3)");
ok(x.fotosItem.length === 1 && igual(x.fotosItem[0].fotos.map((f) => f.arquivo), E.fotosItem[0].fotos) && x.fotosItem[0].ambiente === "SALA DE ESTAR", "foto anexada ao item fica separada (sem NC)");
ok(x.totais.fotos === E.totalFotos && x.totais.fotosNaoAssociadas === 0, `todas as ${E.totalFotos} fotos associadas`);
ok(x.totais.assinaturasIgnoradas === E.assinaturas, "assinaturas do termo não viram evidência");
const seqs = [...x.ncs.flatMap((n) => n.fotos), ...x.fotosItem.flatMap((i) => i.fotos)].map((f) => f.seq).sort((a, b) => a - b);
ok(igual(seqs, Array.from({ length: E.totalFotos }, (_, i) => i + 1)), "cada foto usada uma única vez, ordem preservada");
ok(x.avisos.length === 0, "sem avisos: " + x.avisos.join(" | "));

// ── conversão completa ──
const etapas = [];
const r = await converter(PDFLib, bytes, { regras: [], etapa: async (e) => { etapas.push(e); }, geradoEm: new Date("2026-11-10T12:00:00Z") });
ok(igual(etapas, ["extraindo", "organizando_fotos", "gerando"]), "etapas informadas na ordem");
const saida = await PDFLib.PDFDocument.load(r.bytes);
const pag0 = saida.getPage(0).getSize();
ok(Math.round(pag0.width) === 842 && Math.round(pag0.height) === 595, "relatório compacto em A4 paisagem");
ok(r.paginas === saida.getPageCount() && r.paginas >= 2, `páginas: ${r.paginas}`);
const lidoSaida = await criarLeitor(PDFLib)(r.bytes);
const texto = lidoSaida.paginas.map((p) => p.itens.map((i) => i.str).join(" ")).join("\n");
ok(/RELATÓRIO FINAL DE VISTORIA/.test(texto) && /NCs: 5/.test(texto), "cabeçalho com total de NCs");
ok(/Obra: OBRA TESTE/.test(texto) && /Bloco: B/.test(texto) && /Unidade: BL B - APT 204/.test(texto) && /Data da vistoria: 10\/11\/2026/.test(texto) && /Responsável: Fulana Responsável Teste/.test(texto), "cabeçalho: obra, bloco, unidade, data e responsável");
ok(/NC: 10/.test(texto) && /Serviço: Cerâmica/.test(texto) && /Serviço: Portas/.test(texto), "legendas das fotos com o nome curto do serviço");
ok(/Problema: Não informado/.test(texto), "NC sem descrição aparece como Não informado");
ok(/sem NC \(foto do item 1 do checklist\)/.test(texto), "foto do item identificada como sem NC");
ok(/RESUMO DOS APONTAMENTOS/.test(texto) && /Não conformidades por ambiente/.test(texto) && /Não conformidades por serviço/.test(texto), "resumo final: por ambiente e por serviço");
ok(/SERVIÇO NOVO - SEM EQUIVALÊNCIA/.test(texto), "serviço sem equivalência mantém o nome original");
ok(/NCs sem foto: 14/.test(texto), "observações: NC sem foto listada");
const fotosSaida = lidoSaida.paginas.flatMap((p) => p.imagens).filter((i) => i.w >= 40);
ok(fotosSaida.length === E.totalFotos, `todas as ${E.totalFotos} fotos no relatório compacto (${fotosSaida.length})`);
ok(fotosSaida.every((i) => Math.abs(i.w / i.h - i.pw / i.ph) < 0.02), "fotos sem distorção (proporção original)");
const linhasFotos = new Map(); for (const p of lidoSaida.paginas) for (const i of p.imagens.filter((i) => i.w >= 40)) { const k = p.numero + "@" + Math.round(i.y + i.h); linhasFotos.set(k, (linhasFotos.get(k) || 0) + 1); }
ok([...linhasFotos.values()].every((n) => n <= 3), "no máximo 3 fotos por linha");
ok(r.resumo.ncs === 5 && r.resumo.fotos === 7 && r.resumo.semEquivalencia.includes("SERVIÇO NOVO - SEM EQUIVALÊNCIA") && !("cliente" in r.resumo.cabecalho), "resumo da versão (sem dados pessoais do cliente)");
ok(r.resumo.porAmbiente.map((a) => `${a.ambiente}:${a.ncs}`).join() === "COZINHA:2,SALA DE ESTAR:3", "resumo por ambiente");

// ── validações (não gera relatório incompleto) ──
const falha = async (fn, re, m) => { try { await fn(); ok(false, m + " (não falhou)"); } catch (e) { ok(e instanceof ErroConversao && re.test(e.message), m + ": " + e.message); } };
await falha(() => converter(PDFLib, new TextEncoder().encode("não é pdf")), /Não foi possível abrir/, "arquivo que não é PDF");
const vazio = await PDFLib.PDFDocument.create(); vazio.addPage();
await falha(async () => converter(PDFLib, await vazio.save()), /não tem texto legível/, "PDF sem texto (digitalizado)");
await falha(async () => validar({ ...x, cabecalho: { ...x.cabecalho, ncsDeclaradas: 6 } }, 4), /informa 6.*lidas 5/, "contagem diferente da declarada pelo Mobuss");
await falha(async () => validar({ ...x, ncs: [] }, 4), /Nenhuma não conformidade/, "sem NCs");

// ── PDF real (opcional, fora do repositório) ──
if (process.argv[2]) {
  const real = fs.readFileSync(process.argv[2]);
  const t0 = performance.now(); const rr = await converter(PDFLib, real); const ms = performance.now() - t0;
  ok(!process.argv[3] || rr.resumo.ncs === Number(process.argv[3]), `PDF real: ${rr.resumo.ncs} NCs`);
  ok(!process.argv[4] || rr.resumo.fotos === Number(process.argv[4]), `PDF real: ${rr.resumo.fotos} fotos (${rr.resumo.fotosNc} de NC, ${rr.resumo.fotosItem} de item, ${rr.resumo.fotosNaoAssociadas} sem vínculo)`);
  console.log(`  ${rr.paginas} páginas geradas em ${ms.toFixed(0)} ms · avisos: ${rr.resumo.avisos.length} · sem equivalência: ${rr.resumo.semEquivalencia.join(", ") || "nenhum"}`);
  if (process.argv[5]) fs.writeFileSync(process.argv[5], rr.bytes);
}

console.log(falhas ? `\n${falhas} falha(s)` : "\nConversor: todos os testes passaram.");
process.exit(falhas ? 1 : 0);
