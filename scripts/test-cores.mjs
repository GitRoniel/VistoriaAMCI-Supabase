// Testes das cores centralizadas (rodam no `pnpm check`): duas categorias independentes (setores × equipes),
// contraste, cor padrão, equipes com id estável, cor do apartamento pela equipe e filtros de status da Execução M.O.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import * as C from "../src/modules/cores/model.js";
import * as CM from "../src/modules/chaves/model.js";
import * as M from "../src/modules/revistoria-cliente/model.js";

// contraste e estilo
assert.equal(C.textoSobre("#ffffff"), "#14241c"); assert.equal(C.textoSobre("#1f3d38"), "#ffffff"); assert.equal(C.textoSobre("#f2c14e"), "#14241c");
for (const cor of ["#7b4fc9", "#f2c14e", "#e4e8e5", "#00838f", "#ffeb3b", "#000000"]) {
  const st = C.estilo(cor);
  assert.ok(C.contraste(st.cor, st.texto) >= 4.5, `contraste do texto sobre ${cor}`);
  assert.ok(C.luminancia(st.borda) < C.luminancia(st.cor) || cor === "#000000", `borda mais escura que ${cor}`);
}
// Categoria A: setores — sem configuração = padrão; personalizada = estilo calculado
let S = C.setores([]);
assert.deepEqual(Object.keys(S), ["base", "cx", "asstec", "producao", "cliente", "sem"]);
assert.equal(S.cx.cor, "#2f9e5b"); assert.equal(S.cx.custom, false);
S = C.setores([{ categoria: "setor_chave", chave: "cx", cor: "#00AA55" }, { categoria: "setor_chave", chave: "xx", cor: "#000000" }, { categoria: "outra", chave: "base", cor: "#000000" }]);
assert.equal(S.cx.cor, "#00aa55"); assert.equal(S.cx.custom, true); assert.equal(S.cx.padrao, "#2f9e5b");
assert.equal(S.base.cor, "#2f6fdb", "outra categoria não altera setor");
CM.aplicarCores({ setores: S });
assert.equal(CM.SETORES.cx.cor, "#00aa55", "Controle de Chaves usa a cor central"); assert.equal(CM.SETORES.cx.label, "CX", "rótulo preservado");
CM.aplicarCores(null);
assert.equal(CM.SETORES.cx.cor, "#2f9e5b", "sem configuração volta ao padrão");
// Categoria B: equipes — id estável, desativadas preservadas, independentes dos setores
const linhas = [
  { id: "MOP_FELIPE", grupo: "M.O.P", nome: "Felipe", sigla: "F", cor: "#ff0000", cor_padrao: "#7b4fc9", ativo: true, ordem: 1 },
  { id: "EQ_1A2B3C4D", grupo: "M.O.P", nome: "Carlos", sigla: "C", cor: "#3366ff", cor_padrao: "#3366ff", ativo: true, ordem: 5 },
  { id: "EMP_NILSON", grupo: "EMP", nome: "Nilson", sigla: "N", cor: "#8d5524", cor_padrao: "#8d5524", ativo: false, ordem: 4 }
];
const E = C.equipes(linhas);
assert.deepEqual(E.map((e) => e.id), ["MOP_FELIPE", "EMP_NILSON", "EQ_1A2B3C4D"], "ordem do cadastro");
M.aplicarEquipes({ equipes: E });
assert.equal(M.execInfo("MOP_FELIPE").cor, "#ff0000", "equipe com a cor central");
assert.equal(M.execInfo("EQ_1A2B3C4D").responsavel, "Carlos", "equipe nova sem mudar o código");
assert.equal(M.BOTOES_EXECUCAO.map((b) => b.key).join(), "MOP_FELIPE,EQ_1A2B3C4D", "botões só com equipes ativas");
assert.deepEqual(M.opcoesExecucao("EMP_NILSON").map((e) => e.key), ["MOP_FELIPE", "EMP_NILSON", "EQ_1A2B3C4D"], "a equipe desativada continua na unidade que já a tem");
assert.equal(M.opcoesExecucao(null).some((e) => e.key === "EMP_NILSON"), false, "desativada não pode ser escolhida");
assert.equal(M.execInfo("EMP_NILSON").ativo, false, "histórico preservado (desativada ainda identifica)");
// renomear: mesmo id, mesma cor
M.aplicarEquipes({ equipes: C.equipes(linhas.map((l) => (l.id === "EQ_1A2B3C4D" ? { ...l, nome: "Carlos Henrique" } : l))) });
assert.equal(M.execInfo("EQ_1A2B3C4D").cor, "#3366ff"); assert.equal(M.execRotulo("EQ_1A2B3C4D"), "M.O.P · Carlos Henrique");
// cor do apartamento = equipe; sem equipe = neutra; status não muda a cor
const st = (o) => M.situacao({ status: "Agendado", ciclo: 1, versao: 1, ...o }, []);
assert.equal(M.corUnidade(st({ execucao: "MOP_FELIPE" })).cor, "#ff0000");
assert.equal(M.corUnidade(st({ execucao: "MOP_FELIPE", status: "Aprovado" })).cor, "#ff0000", "aprovado não compete com a cor da equipe");
assert.equal(M.corUnidade(st({ execucao: null })).cor, C.SEM_EQUIPE.cor);
assert.equal(M.corUnidade(st({ execucao: null, status: "Em andamento" })).cor, C.SEM_EQUIPE.cor, "sem equipe em andamento: tom de destaque");
assert.equal(M.corUnidade(st({ execucao: null, status: "Agendado" })).cor, C.SEM_EQUIPE.cor);
assert.equal(M.corUnidade(st({ execucao: null, status: "Aprovado" })).cor, C.APROVADA_SEM_EQUIPE.cor, "aprovado sem equipe: cinza mais forte");
assert.ok(M.corUnidade(st({ execucao: null, status: "Aprovado" })).aprovada && !M.corUnidade(st({ execucao: null })).aprovada);
assert.notEqual(C.SEM_EQUIPE.cor.toLowerCase(), "#ffffff", "sem equipe não é mais branco");
assert.notEqual(C.SEM_EQUIPE.cor, C.APROVADA_SEM_EQUIPE.cor);
assert.equal(M.corUnidade(st({ execucao: "EMP_NILSON" })).cor, "#8d5524", "equipe desativada mantém a cor nas unidades dela");
// setor e equipe independentes
CM.aplicarCores({ setores: C.setores([{ categoria: "setor_chave", chave: "producao", cor: "#3366ff" }]) });
assert.equal(M.execInfo("MOP_FELIPE").cor, "#ff0000", "mudar setor não muda equipe");
CM.aplicarCores(null);
// status da Execução M.O. (Em andamento, Finalizado, Agendado, Aprovado)
const a1 = st({ status: "Em andamento", execucao: "MOP_FELIPE", execucao_finalizada_em: "2026-11-10T12:00:00Z" }), a2 = st({ status: "Aprovado" });
assert.equal(a1.finalizada, true); assert.equal(a2.finalizada, false);
assert.ok(M.passaStatusExecucao("finalizado", a1) && M.passaStatusExecucao("em_andamento", a1), "em andamento e finalizado ao mesmo tempo (dimensões diferentes)");
assert.ok(M.passaStatusExecucao("aprovado", a2) && !M.passaStatusExecucao("agendado", a2) && M.passaStatusExecucao("", a2));
assert.deepEqual(M.STATUS_EXECUCAO.map((x) => x.label), ["Em andamento", "Finalizado", "Agendado", "Aprovado"]);
const u = (s, extra = {}) => ({ b: "A", codigo: "101", cliente: "", vistoria: "rv", chave: CM.situacao(null), temRelatorio: false, situacao: s, ...extra });
const f0 = { bloco: "ALL", busca: "", rapido: "todos", liberado: "", execucao: [], relatorio: "", statusExec: "", chave: "", data: "" };
assert.equal(M.passaFiltros(u(a1), { ...f0, statusExec: "finalizado", execucao: ["MOP_FELIPE"] }), true, "status + equipe juntos");
assert.equal(M.passaFiltros(u(a1), { ...f0, statusExec: "finalizado", execucao: ["EQ_1A2B3C4D"] }), false);
M.aplicarEquipes(null);
assert.equal(M.execInfo("MOP_FELIPE").cor, "#7b4fc9", "sem cadastro carregado: equipes e cores de antes");
// estático: tabelas separadas, escrita só por funções que conferem administrador
const root = resolve(import.meta.dirname, "..");
const mig = await readFile(resolve(root, "supabase/migrations/20261114120000_cores_equipes_execucao.sql"), "utf8");
assert.match(mig, /create table if not exists public\.cores_legendas/); assert.match(mig, /create table if not exists public\.equipes_execucao/);
assert.doesNotMatch(mig, /grant (insert|update|delete)[^;]*cores_legendas|grant (insert|update|delete)[^;]*equipes_execucao/i, "sem escrita direta");
assert.equal((mig.match(/perform private\.cores_admin\(\)/g) || []).length, 4, "as 4 funções de cores conferem administrador");
assert.doesNotMatch(mig, /\b(delete from public\.(revistorias|revistorias_cliente|units|chaves)|drop table|truncate)\b/i, "nada operacional apagado");
const html = await readFile(resolve(root, "www/index.html"), "utf8");
assert.ok(html.includes('src="./cores.js"') && html.indexOf('src="./cores.js"') < html.indexOf('src="./chaves.js"'), "cores.js carregado antes dos módulos");
assert.ok(html.includes("window.AmciCores?.iniciar(supabase)") && html.includes("window.AmciCores?.reset()"), "cores iniciadas no login e limpas no logout");
console.log("Regras das cores centralizadas verificadas.");
