// Regras da tela do relatório (rodam no `pnpm check`): versões original × convertido, versão aberta por padrão,
// status da conversão, falha sem perder a versão válida, histórico, mapa da Execução M.O. (chave entregue e liberado).
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import * as C from "../src/modules/revistoria-cliente/conversao.js";

const rel = { id: 7, caminho: "1/A/103/x.pdf", nome_arquivo: "BL A - APT 103.pdf", tamanho: 100, paginas: 22, enviado_em: "2026-11-10T10:00:00Z", conversao_status: "pendente", convertido_id: null };
const orig = { id: 1, relatorio_id: 7, tipo: "original", versao: 1, status: "disponivel", caminho: rel.caminho };
// banco antigo (sem versões): original vem do registro e fica "pendente"
let i = C.versoesDoRelatorio({ id: 7, caminho: rel.caminho, nome_arquivo: "a.pdf" }, []);
assert.equal(i.original.caminho, rel.caminho); assert.equal(i.vigente, null); assert.equal(i.status, "pendente");
assert.equal(C.arquivoExibido(i, null).caminho, rel.caminho, "sem convertido abre o original");
// em andamento
const v1 = { id: 2, relatorio_id: 7, tipo: "convertido", versao: 1, status: "extraindo", caminho: null };
i = C.versoesDoRelatorio({ ...rel, conversao_status: "extraindo" }, [orig, v1]);
assert.equal(i.status, "extraindo"); assert.ok(C.emAndamento(i.status)); assert.equal(i.andamento.id, 2); assert.equal(i.vigente, null, "nunca mostra sucesso antes do arquivo");
assert.equal(C.arquivoExibido(i, null).tipo, "original");
// disponível: convertido por padrão; escolha do original respeitada
const v1ok = { ...v1, status: "disponivel", caminho: "1/conversoes/7/v1.pdf" };
i = C.versoesDoRelatorio({ ...rel, conversao_status: "disponivel", convertido_id: 2 }, [orig, v1ok]);
assert.equal(C.arquivoExibido(i, null).caminho, "1/conversoes/7/v1.pdf", "convertido aberto por padrão");
assert.equal(C.arquivoExibido(i, "original").tipo, "original", "alternar para o original");
assert.equal(C.nomeDownload(rel, i.vigente), "BL A - APT 103 - compacto v1.pdf"); assert.equal(C.nomeDownload(rel, orig), "BL A - APT 103.pdf");
// reprocessamento com falha: v1 continua vigente, status falha
const v2 = { id: 3, relatorio_id: 7, tipo: "convertido", versao: 2, status: "falha", caminho: null, erro: "x" };
i = C.versoesDoRelatorio({ ...rel, conversao_status: "falha", convertido_id: 2 }, [orig, v1ok, v2]);
assert.equal(i.status, "falha"); assert.equal(i.vigente.id, 2, "falha não troca a versão válida"); assert.equal(i.ultima.id, 3);
assert.deepEqual(i.convertidas.map((v) => v.versao), [2, 1], "histórico do mais novo para o mais antigo");
// histórico: abrir uma versão anterior
const v3 = { id: 4, relatorio_id: 7, tipo: "convertido", versao: 3, status: "disponivel", caminho: "1/conversoes/7/v3.pdf" };
i = C.versoesDoRelatorio({ ...rel, conversao_status: "disponivel", convertido_id: 4 }, [orig, v1ok, v2, v3]);
assert.equal(C.arquivoExibido(i, null).versao, 3); assert.equal(C.arquivoExibido(i, { id: 2 }).versao, 1, "versão anterior do histórico");
assert.equal(C.arquivoExibido(i, { id: 3 }).versao, 3, "versão com falha não abre (cai na vigente)");
// convertido_id desatualizado: usa a mais nova disponível
i = C.versoesDoRelatorio({ ...rel, convertido_id: null, conversao_status: "disponivel" }, [orig, v1ok]);
assert.equal(i.vigente.id, 2);
// versões de outro relatório não se misturam
i = C.versoesDoRelatorio(rel, [{ ...v1ok, relatorio_id: 99 }]); assert.equal(i.vigente, null);
assert.equal(C.rotulo("organizando_fotos"), "Organizando fotos"); assert.equal(C.rotulo("xyz"), "Pendente de conversão");

// estático: tela e mapa
const root = resolve(import.meta.dirname, "..");
const tela = await readFile(resolve(root, "src/modules/revistoria-cliente/relatorio-tela.js"), "utf8");
assert.doesNotMatch(tela, /data-rv="(ant|prox)"/, "sem botões anterior/próxima como navegação principal");
assert.match(tela, /criarVisualizador/); assert.match(tela, /Original Mobuss/); assert.match(tela, /converterRelatorio/);
const svc = await readFile(resolve(root, "src/modules/revistoria-cliente/service.js"), "utf8");
assert.doesNotMatch(svc, /getPublicUrl/, "nada de link público: só URL assinada");
const idx = await readFile(resolve(root, "src/modules/revistoria-cliente/index.js"), "utf8");
const exec = idx.slice(idx.indexOf("// Execução M.O.: cor = status da execução"));
assert.match(exec.slice(0, 1500), /rc-mk-ent[\s\S]*rc-mk-lib/, "Execução M.O.: chave entregue e liberado no mesmo botão");
const html = await readFile(resolve(root, "www/index.html"), "utf8");
const claro = html.slice(0, html.indexOf("TEMA ESCURO"));
assert.match(claro, /\.rc-u \.rc-mk-lib\{position:absolute;top:-5px;right:-5px/, "liberado no canto superior direito");
assert.match(claro, /\.rc-u \.rc-mk-ent\{position:absolute;top:-5px;left:-5px/, "chave entregue no canto superior esquerdo");
const fn = await readFile(resolve(root, "supabase/functions/relatorio-converter/index.ts"), "utf8");
assert.match(fn, /revistoria_conversao_solicitar/); assert.ok(fn.indexOf(".upload(") < fn.indexOf("admin.rpc('revistoria_conversao_concluir'"), "conclui só depois do upload");
assert.doesNotMatch(fn, /\.remove\(\[rel\.caminho\]/, "a função nunca apaga o original");
console.log("Regras da conversão de relatórios verificadas.");
