// Testes das regras da Central Offline (rodam no `pnpm check`): catálogo dos documentos, versões, diferença
// aparelho × servidor, integridade do PDF, situação da preparação e isolamento por usuário.
import assert from "node:assert/strict";
import * as O from "../src/modules/offline/model.js";
import { montarZip, lerZip, crc32 } from "../src/modules/offline/zip.js";

const units = new Map([[10, { bloco: "A", pav: "6º", apto: "04" }], [11, { bloco: "A", pav: "T", apto: "01" }], [20, { bloco: "B", pav: "", apto: "3" }]]);
const obras = new Map([[1, { id: 1, nome: "Alto do Jerivá" }], [2, { id: 2, nome: "Outro Condomínio" }]]);
const rels = [
  { id: 1, project_id: 1, unit_id: 10, caminho: "1/10/a.pdf", nome_arquivo: "a.pdf", tamanho: 1000, enviado_em: "2026-11-01T10:00:00Z", convertido_id: 50 },
  { id: 2, project_id: 1, unit_id: 11, caminho: "1/11/b.pdf", nome_arquivo: "b.pdf", tamanho: 2000, enviado_em: "2026-11-02T10:00:00Z", convertido_id: null },
  { id: 3, project_id: 1, unit_id: 10, caminho: "1/10/c.pdf", tamanho: 10, enviado_em: "2026-11-03T10:00:00Z", removido_em: "2026-11-04T10:00:00Z" },   // retirado: fora
  { id: 4, project_id: 2, unit_id: 20, caminho: "2/20/d.pdf", tamanho: 500, enviado_em: "2026-11-05T10:00:00Z", convertido_id: 51 }
];
const versoes = [
  { id: 50, relatorio_id: 1, tipo: "convertido", versao: 2, status: "disponivel", caminho: "1/10/conv-v2.pdf", tamanho: 700, concluido_em: "2026-11-06T10:00:00Z" },
  { id: 51, relatorio_id: 4, tipo: "convertido", versao: 1, status: "falha", caminho: null, tamanho: null }   // falhou: sem compacto
];
// 1) catálogo: original sempre (enquanto ativo) + compacto vigente; retirados fora; unidade/obra identificadas pelo id
const cat = O.catalogo(rels, versoes, units, obras);
assert.deepEqual(cat.map((d) => d.id), ["convertido:1", "original:1", "original:2", "original:4"]);
assert.equal(cat[0].versao, "v2:1/10/conv-v2.pdf"); assert.equal(cat[0].unidade, "A · 604"); assert.equal(cat[2].unidade, "A · T01");
assert.equal(cat[3].unidade, "B · Casa 3"); assert.equal(cat[3].obra, "Outro Condomínio");
assert.equal(O.selecionar(cat, { tipos: { convertido: true, original: false } }).length, 1);
assert.deepEqual(O.selecionar(cat, { projetos: [2] }).map((d) => d.id), ["original:4"]);
assert.deepEqual(O.selecionar(cat, { projetos: 1, bloco: "A" }).map((d) => d.id), ["convertido:1", "original:1", "original:2"]);
// 2) diferença: novos, atualizados (nova conversão), sincronizados, removidos (sem permissão / apagado), falha preserva o válido
const local = [
  { id: "original:1", status: "ok", versaoOk: "orig:1/10/a.pdf" },
  { id: "convertido:1", status: "ok", versaoOk: "v1:1/10/conv-v1.pdf" },                      // versão antiga
  { id: "original:2", status: "falha", versaoOk: null },                                       // nunca baixou
  { id: "original:9", status: "ok", versaoOk: "orig:x" }                                       // não está mais disponível
];
const dif = O.diferenca(local, cat);
assert.deepEqual(dif.novos.map((d) => d.id), ["original:2", "original:4"]);
assert.deepEqual(dif.atualizados.map((d) => d.id), ["convertido:1"]);
assert.deepEqual(dif.sincronizados.map((d) => d.id), ["original:1"]);
assert.deepEqual(dif.removidos.map((d) => d.id), ["original:9"]);
assert.deepEqual(O.aBaixar(dif).map((d) => d.id), ["original:2", "original:4", "convertido:1"], "não baixa de novo o que já está atualizado");
// atualização que falhou: continua com a versão válida anterior e aparece como "atualização disponível"/falha
const falhou = { id: "convertido:1", status: "falha", versaoOk: "v1:1/10/conv-v1.pdf", erro: "rede" };
assert.equal(O.diferenca([falhou], [cat[0]]).atualizados.length, 1);
assert.equal(O.situacaoDoc(cat[0], falhou).key, "atualizacao");
assert.equal(O.situacaoDoc(cat[2], { status: "falha" }).key, "falha");
assert.equal(O.situacaoDoc(null, { status: "ok", versaoOk: "x" }).key, "removido");
assert.equal(O.situacaoDoc(cat[1], { status: "ok", versaoOk: cat[1].versao }).key, "ok");
assert.equal(O.situacaoDoc(cat[1], null, true).key, "baixando");
// 3) integridade do PDF
const pdf = (corpo = "x") => new TextEncoder().encode(`%PDF-1.7\n${corpo}\n%%EOF\n`);
assert.equal(O.validarPdf(pdf()).ok, true);
assert.equal(O.validarPdf(pdf(), pdf().length).ok, true);
assert.match(O.validarPdf(pdf(), 999).motivo, /tamanho diferente/);
assert.match(O.validarPdf(new TextEncoder().encode("<html>erro</html>")).motivo, /não é um PDF/);
assert.match(O.validarPdf(pdf().subarray(0, 12)).motivo, /incompleto/);
assert.match(O.validarPdf(new Uint8Array()).motivo, /vazio/);
// 4) situação da obra: só "preparada" quando todos os selecionados estão guardados e na versão do servidor
const sel = O.selecionar(cat, { projetos: 1 });
const g = (pares) => new Map(pares.map(([id, o]) => [id, { id, ...o }]));
let s = O.situacaoObra(sel, g([["convertido:1", { status: "ok", versaoOk: cat[0].versao, bytes: 700 }], ["original:1", { status: "ok", versaoOk: cat[1].versao, bytes: 1000 }]]), new Set(["original:2"]));
assert.equal(s.preparada, false); assert.equal(s.pendentes, 1); assert.equal(s.estado, "parcial"); assert.equal(s.bytes, 1700);
s = O.situacaoObra(sel, g([["convertido:1", { status: "ok", versaoOk: cat[0].versao }], ["original:1", { status: "ok", versaoOk: cat[1].versao }], ["original:2", { status: "falha", erro: "403" }]]));
assert.equal(s.preparada, false); assert.equal(s.falhas, 1); assert.equal(s.estado, "falha"); assert.equal(s.listaFalhas[0].id, "original:2");
s = O.situacaoObra(sel, g(sel.map((d) => [d.id, { status: "ok", versaoOk: d.versao, bytes: 1 }])));
assert.equal(s.preparada, true); assert.equal(s.estado, "preparada"); assert.equal(s.ok, 3);
s = O.situacaoObra(sel, g(sel.map((d) => [d.id, { status: "ok", versaoOk: d.id === "convertido:1" ? "v1:velho" : d.versao }])));
assert.equal(s.preparada, false); assert.equal(s.estado, "atualizacao");
assert.equal(O.situacaoObra([], new Map()).estado, "vazia");
// 5) espaço e isolamento por usuário
assert.deepEqual(O.cabe(100, { quota: 1000, usage: 800 }), { conhecido: true, cabe: true, livre: 200 });
assert.equal(O.cabe(300, { quota: 1000, usage: 800 }).cabe, false);
assert.equal(O.cabe(10 ** 12, null).conhecido, false);
assert.notEqual(O.nomeBanco("u1"), O.nomeBanco("u2"));
assert.deepEqual(O.usuarioDaSessao(JSON.stringify({ access_token: "x", user: { id: "u1", email: "a@b" } })), { id: "u1", email: "a@b" });
assert.equal(O.usuarioDaSessao("lixo"), null); assert.equal(O.usuarioDaSessao(null), null);
assert.equal(O.fmtBytes(1536), "2 KB"); assert.equal(O.fmtBytes(5 * 1048576), "5,0 MB"); assert.equal(O.fmtBytes(507 * 1048576), "507 MB");
// 6) baixar no computador: nomes seguros, pastas por condomínio/bloco, sem repetidos; .zip válido
assert.equal(O.nomeSeguro('A · 604: "x"/y?'), "A - 604-x-y");
assert.equal(O.nomeSeguro("  ...  "), "sem nome");
assert.equal(O.nomeSeguro("Condomínio São João – Bloco Ç"), "Condominio Sao Joao Bloco C");
const pcDocs = [
  { id: "convertido:1", relatorioId: 1, tipo: "convertido", obra: "Alto do Jerivá", bloco: "A", unidade: "A · 604" },
  { id: "original:1", relatorioId: 1, tipo: "original", obra: "Alto do Jerivá", bloco: "A", unidade: "A · 604" },
  { id: "original:9", relatorioId: 9, tipo: "original", obra: "Alto do Jerivá", bloco: "A", unidade: "A · 604" },   // 2º relatório da unidade
  { id: "original:4", relatorioId: 4, tipo: "original", obra: "Outro: Cond", bloco: "Conj. B", unidade: "Conj. B · Casa 3" }
];
const cam = O.caminhosNoComputador(pcDocs);
assert.equal(cam.get("convertido:1"), "Alto do Jeriva/Bloco A/A - 604 - Compacto.pdf");
assert.equal(cam.get("original:1"), "Alto do Jeriva/Bloco A/A - 604 - Original Mobuss.pdf");
assert.equal(cam.get("original:9"), "Alto do Jeriva/Bloco A/A - 604 - Original Mobuss (2).pdf");
assert.equal(cam.get("original:4"), "Outro- Cond/Conj. B/Conj. B - Casa 3 - Original Mobuss.pdf");
assert.equal(new Set(cam.values()).size, pcDocs.length);
assert.equal(O.caminhosNoComputador(pcDocs.slice(0, 1), { comObra: false }).get("convertido:1"), "Bloco A/A - 604 - Compacto.pdf");
assert.equal(O.nomeExportacao("Alto do Jerivá", "convertido", new Date(2026, 10, 12)), "Relatorios compactos - Alto do Jeriva - 2026-11-12");
assert.equal(O.nomeExportacao("Alto do Jerivá", "original", null), "Relatorios originais Mobuss - Alto do Jeriva");
assert.equal(O.nomeExportacao("X", "ambos", new Date(2026, 0, 2), 2), "Relatorios - X - 2026-01-02 - parte 2");
assert.deepEqual(O.TIPOS_PC.ambos.tipos, ["convertido", "original"]);
assert.equal(crc32(new TextEncoder().encode("123456789")), 0xcbf43926);   // valor de referência do CRC-32
const zipBytes = (() => { const p = montarZip([{ nome: "Bloco A/A - 604 - Compacto.pdf", bytes: pdf() }, { nome: "Bloco B/Ação.pdf", bytes: new Uint8Array([1, 2, 3]) }]); const t = new Uint8Array(p.reduce((s, x) => s + x.length, 0)); let o = 0; for (const x of p) { t.set(x, o); o += x.length; } return t; })();
const lidos = lerZip(zipBytes);
assert.deepEqual(lidos.map((x) => x.nome), ["Bloco A/A - 604 - Compacto.pdf", "Bloco B/Ação.pdf"]);
assert.ok(lidos.every((x) => x.crcOk)); assert.deepEqual([...lidos[1].bytes], [1, 2, 3]); assert.ok(O.validarPdf(lidos[0].bytes).ok);
console.log("Regras da Central Offline verificadas.");
