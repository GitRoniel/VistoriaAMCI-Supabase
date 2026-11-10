// Revistoria · Cliente: regras puras (sem tela nem Supabase), usadas pela aba (www/revcliente.js),
// pela aba Vistoria (filtros rápidos, canto do mapa, via window.AmciRevistorias.cliente), pelo Controle
// de Chaves (etiqueta) e pelos testes (scripts/test-revistoria-cliente.mjs).
//
// Dados (Supabase):
//   revistorias_cliente  uma linha por unidade em acompanhamento: status, ciclo, versao
//   revistorias          cada agendamento (nº 1, 2…): data, horário, responsável, status, realização, resultado
//   revistorias_eventos  histórico imutável
// As regras de gravação ficam no banco (funções revistoria_*); aqui só o que a tela precisa.

// Cores padronizadas: Aprovado verde · Em Revistoria laranja · Em andamento amarelo · Agendado azul · Sem registro cinza.
export const STATUS = {
  "Em andamento": { key: "Em andamento", label: "Em andamento", cor: "#f2c14e", borda: "#d9a92f", texto: "#5a4409" },
  Agendado: { key: "Agendado", label: "Agendado", cor: "#2f6fdb", borda: "#2459b5", texto: "#ffffff" },
  Aprovado: { key: "Aprovado", label: "Aprovado", cor: "#2f9e5b", borda: "#268a4d", texto: "#ffffff" }
};
export const SEM_REGISTRO = { key: "", label: "Sem registro", cor: "#e3e7e4", borda: "#b9c1bc", texto: "#5f6b64" };
export const EM_REVISTORIA = { key: "em_revistoria", label: "Em Revistoria", cor: "#e8842a", borda: "#c96a1a", texto: "#ffffff" };
export const STATUS_ORDEM = ["Em andamento", "Agendado", "Aprovado"];
export const info = (status) => STATUS[status] || SEM_REGISTRO;

// Execução dos serviços (revistorias_cliente.execucao): equipe e responsável. Cores próprias, diferentes
// das cores de status (o status pinta a unidade; a execução aparece como selo com a inicial).
export const EXECUCOES = [
  { key: "MOP_FELIPE", equipe: "M.O.P", responsavel: "Felipe", sigla: "F", cor: "#7b4fc9" },
  { key: "MOP_RENATO", equipe: "M.O.P", responsavel: "Renato", sigla: "R", cor: "#c2185b" },
  { key: "EMP_OSCAR", equipe: "EMP", responsavel: "Oscar", sigla: "O", cor: "#00838f" },
  { key: "EMP_NILSON", equipe: "EMP", responsavel: "Nilson", sigla: "N", cor: "#8d5524" }
];
export const EQUIPES = ["M.O.P", "EMP"];
export const execInfo = (key) => EXECUCOES.find((e) => e.key === key) || null;
export const execRotulo = (key) => { const e = execInfo(key); return e ? `${e.equipe} · ${e.responsavel}` : "Sem execução"; };
export const FILTRO_LIBERADO = [{ key: "", label: "Todos" }, { key: "sim", label: "Liberados" }, { key: "nao", label: "Não liberados" }];
/** Filtro rápido de Execução (botões da aba): acumulativo (Felipe + Renato…); vazio = todas as equipes. */
export const BOTOES_EXECUCAO = EXECUCOES.map((e) => ({ key: e.key, label: `${e.equipe} – ${e.responsavel}`, sigla: e.sigla, cor: e.cor }));
const listaExec = (v) => (Array.isArray(v) ? v : v ? [v] : []);
/** Liga/desliga uma equipe (ou "sem") na seleção, mantendo as outras. */
export const alternarExecucao = (atual, clicado) => { const l = listaExec(atual); return l.includes(clicado) ? l.filter((k) => k !== clicado) : [...l, clicado]; };
export function passaExecucao(chave, execucao) {
  if (Array.isArray(chave)) return !chave.length || chave.some((k) => passaExecucao(k, execucao));
  if (!chave) return true;
  if (chave === "sem") return !execucao;
  if (chave.startsWith("equipe:")) return execInfo(execucao)?.equipe === chave.slice(7);
  return execucao === chave;
}
/** Filtro de relatório: "com" (relatório enviado), "sem" ou "" (todas). */
export const FILTRO_RELATORIO = [{ key: "com", label: "Com relatório" }, { key: "sem", label: "Sem relatório" }];
export const passaRelatorio = (chave, tem) => !chave || (chave === "com" ? !!tem : !tem);
export function passaLiberado(chave, liberado) {
  return !chave || (chave === "sim" ? !!liberado : !liberado);
}

// Filtros rápidos (iguais nas abas Vistoria e Revistoria · Cliente, cada uma no seu contexto).
export const FILTROS = [
  { key: "todos", label: "Todos", cor: "#1f4a3f" },
  { key: "aprovados", label: "Aprovados", cor: STATUS.Aprovado.borda },
  { key: "em_revistoria", label: "Em Revistoria", cor: EM_REVISTORIA.borda },
  { key: "em_andamento", label: "Em andamento", cor: STATUS["Em andamento"].borda },
  { key: "agendados", label: "Agendados", cor: STATUS.Agendado.borda }
];
// Aba Revistoria · Cliente: os mesmos filtros rápidos + "Rev. Reprovada" (só nesta aba).
export const REPROVADA = { key: "reprovada", label: "Rev. Reprovada", cor: "#d64545", borda: "#b33636" };
export const FILTROS_REVISTORIA = [...FILTROS, { key: REPROVADA.key, label: REPROVADA.label, cor: REPROVADA.borda }];
/**
 * Rev. Reprovada: a última revistoria REALIZADA teve resultado Reprovada e a unidade ainda não foi aprovada
 * (está em novo ciclo, Em andamento ou já com nova data). Em andamento sem revistoria realizada não conta.
 */
export const reprovada = (s) => !!s?.status && s.status !== "Aprovado" && s.ultima?.status === "Reprovada";
/** Última reprovação da unidade (a revistoria realizada com resultado Reprovada mais recente). */
export const ultimaReprovacao = (s) => (s?.lista || []).filter((r) => r.status === "Reprovada").at(-1) || null;

// Status da chave (Controle de Chaves): no mapa, canto inferior esquerdo na cor do setor (mesmo formato do canto da aba Vistoria).
export const FILTRO_CHAVE = [
  { key: "", label: "Todas" }, { key: "base", label: "Base" }, { key: "cx", label: "CX" }, { key: "asstec", label: "Asstec" },
  { key: "producao", label: "Produção" }, { key: "cliente", label: "Entregue para Cliente" }, { key: "sem", label: "Sem status" },
  { key: "perdida", label: "Chave perdida" }
];
/** chave = {setor: base|cx|asstec|producao|cliente|sem, perdida: ocorrência aberta ou null} */
export function passaChave(chave, k) {
  if (!chave) return true;
  if (chave === "perdida") return !!k?.perdida;
  return (k?.setor || "sem") === chave && !k?.perdida;
}

/** Data (e horário) da revistoria considerada nos filtros: o agendamento em aberto ou o último não cancelado. */
export function agendaRevistoria(s) {
  const r = s?.aberto || [...(s?.lista || [])].filter((x) => x.status !== "Cancelada").at(-1) || null;
  return { data: r?.data ? String(r.data).slice(0, 10) : "", hora: r?.horario ? String(r.horario).slice(0, 5) : "" };
}
/**
 * Ordem da lista (igual à aba Vistoria): data da revistoria (mais cedo primeiro; sem data no fim) e, no mesmo dia,
 * horário do mais cedo para o mais tarde ("asc") ou o inverso ("desc"); sem horário fica depois dos com horário.
 */
export function compararAgenda(x, y, hrSort = "asc", ordemUnidade = () => 0) {
  const ax = agendaRevistoria(x.situacao), ay = agendaRevistoria(y.situacao);
  const dx = ax.data || "9999-99-99", dy = ay.data || "9999-99-99";
  if (dx !== dy) return dx < dy ? -1 : 1;
  if (ax.hora !== ay.hora) {
    if (!ax.hora) return 1;
    if (!ay.hora) return -1;
    return hrSort === "desc" ? (ax.hora < ay.hora ? 1 : -1) : (ax.hora < ay.hora ? -1 : 1);
  }
  return ordemUnidade(x, y);
}

/**
 * Filtro rápido.
 * @param chave     key de FILTROS
 * @param unidade   { vistoria: código do status da vistoria (na, ag, rm, rv, rf, ap, in), revistoria: status de revistorias_cliente ou "" }
 * @param contexto  "revistoria" (aba Revistoria · Cliente: só unidades em acompanhamento) ou "vistoria" (aba Vistoria: todas)
 *   Revistoria · Cliente: Aprovados = Aprovado · Em Revistoria = ainda não aprovado (Em andamento + Agendado)
 *   Vistoria:             Aprovados = vistoria Aprovado ou revistoria aprovada · Em Revistoria = vistoria em Revistoria
 *   Em andamento / Agendados = situação da Revistoria · Cliente nas duas abas
 */
export function passaFiltroRapido(chave, unidade, contexto = "revistoria") {
  const v = unidade?.vistoria || "", r = unidade?.revistoria || "";
  switch (chave || "todos") {
    case "todos": return contexto === "vistoria" || !!r;
    case "aprovados": return r === "Aprovado" || (contexto === "vistoria" && v === "ap");
    case "em_revistoria": return contexto === "vistoria" ? v === "rv" : r === "Em andamento" || r === "Agendado";
    case "em_andamento": return r === "Em andamento";
    case "agendados": return r === "Agendado";
    default: return true;
  }
}

// Agendamento (linha de revistorias): status do agendamento e resultado.
export const ABERTOS = ["Agendada", "Em revistoria"];
export const REALIZADAS = ["Aprovada", "Reprovada"];
/** {status: Agendado | Em revistoria | Realizado | Cancelado | Sem status, resultado: Aprovada | Reprovada | ""} */
export function agendamento(r) {
  const s = r?.status || "";
  if (s === "Agendada") return { status: "Agendado", resultado: "", aberto: true };
  if (s === "Em revistoria") return { status: "Em revistoria", resultado: "", aberto: true };
  if (REALIZADAS.includes(s)) return { status: "Realizado", resultado: s, aberto: false };
  if (s === "Cancelada") return { status: "Cancelado", resultado: "", aberto: false };
  return { status: "Sem status", resultado: "", aberto: false };
}

const ordNum = (x, y) => (x.numero || 0) - (y.numero || 0);
/**
 * Situação da unidade na aba.
 * @param a    linha de revistorias_cliente (ou null: a unidade não está na aba)
 * @param ags  agendamentos da unidade (linhas de revistorias)
 */
export function situacao(a, ags = []) {
  // agendamentos anulados pelo administrador (duplicidade) ficam fora das listas e das contagens
  const todos = [...(ags || [])].sort(ordNum), anulados = todos.filter((r) => r.anulado_em), lista = todos.filter((r) => !r.anulado_em);
  const realizadas = lista.filter((r) => REALIZADAS.includes(r.status));
  if (!a) return { status: "", info: SEM_REGISTRO, lista, anulados, realizadas: realizadas.length, aberto: null, ultima: realizadas.at(-1) || null, ciclo: 0, versao: null,
    liberado: false, execucao: null, revistoriaId: null };
  const aberto = a.status === "Agendado" ? lista.filter((r) => ABERTOS.includes(r.status)).at(-1) || null : null;
  return {
    status: a.status, info: info(a.status), ciclo: a.ciclo || 1, versao: a.versao ?? null, lista, anulados, revistoriaId: a.revistoria_id ?? null,
    realizadas: realizadas.length, aberto, ultima: realizadas.at(-1) || null,
    entrouEm: a.entrou_em || "", atualizadoEm: a.atualizado_em || "", atualizadoPor: a.atualizado_email || "",
    liberado: !!a.liberado, liberadoEm: a.liberado_em || "", liberadoPor: a.liberado_por || "",
    execucao: execInfo(a.execucao) ? a.execucao : null, execucaoEm: a.execucao_em || "", execucaoPor: a.execucao_por || ""
  };
}

/** Próxima revistoria (data agendada) para ordenar e exibir: "AAAA-MM-DD" ou "". */
export const proxima = (s) => (s?.aberto?.data ? String(s.aberto.data).slice(0, 10) : "");

/** Indicadores da aba. */
export function indicadores(unidades, hoje = "") {
  const out = { total: 0, "Em andamento": 0, Agendado: 0, Aprovado: 0, realizadas: 0, hoje: 0, semana: 0, liberados: 0 };
  const fim = hoje ? somaDias(hoje, 7) : "";
  for (const u of unidades) {
    const s = u.situacao; if (!s?.status) continue;
    out.total++; out[s.status]++; out.realizadas += s.realizadas; if (s.liberado) out.liberados++;
    const d = proxima(s);
    if (d && hoje && d === hoje) out.hoje++;
    if (d && hoje && d >= hoje && d <= fim) out.semana++;
  }
  return out;
}
export function somaDias(iso, n) {
  const [y, m, d] = String(iso).split("-").map(Number); const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}

/** Ordem da lista: agendadas (data mais próxima primeiro), em andamento, aprovadas; depois a unidade. */
export function comparar(x, y, ordemUnidade = () => 0) {
  const peso = (s) => (s.status === "Agendado" ? 0 : s.status === "Em andamento" ? 1 : s.status === "Aprovado" ? 2 : 3);
  const px = peso(x.situacao), py = peso(y.situacao);
  if (px !== py) return px - py;
  if (px === 0) { const dx = proxima(x.situacao) || "9999", dy = proxima(y.situacao) || "9999"; if (dx !== dy) return dx < dy ? -1 : 1; }
  return ordemUnidade(x, y);
}

const norm = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
/** Filtros da aba: bloco, busca (unidade ou cliente), filtro rápido, liberado e execução (todos juntos). */
export function passaFiltros(u, f) {
  if (f.bloco && f.bloco !== "ALL" && u.b !== f.bloco) return false;
  if (f.rapido === REPROVADA.key) { if (!reprovada(u.situacao)) return false; }
  else if (!passaFiltroRapido(f.rapido, { vistoria: u.vistoria, revistoria: u.situacao?.status }, "revistoria")) return false;
  if (!passaChave(f.chave, u.chave)) return false;
  if (f.data && agendaRevistoria(u.situacao).data !== f.data) return false;
  if (!passaLiberado(f.liberado, u.situacao?.liberado)) return false;
  if (!passaExecucao(f.execucao, u.situacao?.execucao)) return false;
  if (!passaRelatorio(f.relatorio, u.temRelatorio)) return false;
  const q = norm(f.busca).replace(/\s/g, "");
  if (q) {
    const cod = norm(u.codigo), comBloco = norm(u.b) + cod;
    if (!(cod.includes(q) || comBloco.includes(q) || norm(u.cliente).replace(/\s/g, "").includes(q))) return false;
  }
  return true;
}

// ── validações (o banco confere de novo) ──
export const limparNome = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
const dataOk = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d || "") && !Number.isNaN(Date.parse(d + "T12:00:00Z")) && new Date(d + "T12:00:00Z").toISOString().slice(0, 10) === d;
export function validarNome(nome, campo = "o responsável pela revistoria") {
  const n = limparNome(nome);
  if (n.length < 2) return `Informe ${campo}`;
  if (n.length > 80) return "Nome muito longo (máximo de 80 caracteres)";
  return "";
}
export function validarAgendamento(v, hoje = "") {
  if (!v?.data) return "Informe a data da revistoria";
  if (!dataOk(v.data) || v.data < "2020-01-01") return "Data da revistoria inválida";
  if (hoje && v.data > somaDias(hoje, 730)) return "Data da revistoria inválida";
  if (v.horario && !/^([01]\d|2[0-3]):[0-5]\d$/.test(v.horario)) return "Horário inválido (use HH:MM)";
  // vistoriador opcional: a equipe de revistorias agenda sem precisar definir quem fará a revistoria
  if (limparNome(v.responsavel)) { const n = validarNome(v.responsavel); if (n) return n; }
  if (String(v.obs || "").trim().length > 500) return "Observação muito longa (máximo de 500 caracteres)";
  return "";
}
export function validarResultado(v, hoje = "") {
  if (!["Aprovada", "Reprovada"].includes(v?.resultado)) return "Escolha o resultado da revistoria";
  if (!v.realizada) return "Informe a data em que a revistoria foi realizada";
  if (!dataOk(v.realizada) || v.realizada < "2020-01-01") return "Data da realização inválida";
  if (hoje && v.realizada > hoje) return "A data da realização não pode ser futura";
  if (limparNome(v.responsavel)) { const n = validarNome(v.responsavel); if (n) return n; }
  const obs = String(v.obs || "").trim();
  if (v.resultado === "Reprovada" && obs.length < 3) return "Descreva as pendências encontradas na revistoria";
  if (obs.length > 500) return "Observação muito longa (máximo de 500 caracteres)";
  return "";
}
export function validarReabrir(motivo) {
  const t = String(motivo || "").trim();
  if (t.length < 3) return "Descreva as novas pendências";
  if (t.length > 500) return "Observação muito longa (máximo de 500 caracteres)";
  return "";
}

/** Ações disponíveis para a situação (na ordem dos botões). */
export function acoes(status, podeEditar) {
  if (!podeEditar || !status) return [];
  if (status === "Em andamento") return ["agendar"];
  if (status === "Agendado") return ["resultado", "remarcar", "cancelar"];
  if (status === "Aprovado") return ["reabrir"];
  return [];
}

// Histórico (revistorias_eventos).
const TITULOS = {
  entrada: "Entrou na Revistoria · Cliente", agendamento: "Revistoria agendada", remarcacao: "Revistoria remarcada",
  cancelamento: "Agendamento cancelado", reabertura: "Reaberta: novas pendências", vistoria: "Mudança na aba Vistoria",
  planilha: "Planilha de vistorias", liberacao: "Liberação para execução", execucao: "Execução", relatorio: "Relatório",
  correcao: "Correção de agendamento (administrador)"
};
/**
 * Correções do administrador no agendamento: Corrigir (qualquer agendamento não anulado) e Anular (revistoria
 * realizada que não seja a atual nem a mais recente; as mesmas regras o banco confere de novo).
 */
export function correcoes(r, s, papel) {
  if (papel !== "admin" || !r || r.anulado_em) return { corrigir: false, anular: false };
  const maisRecente = Math.max(0, ...[...(s?.lista || []), ...(s?.anulados || [])].map((x) => x.numero || 0));
  return { corrigir: true, anular: REALIZADAS.includes(r.status) && r.id !== s?.revistoriaId && (r.numero || 0) < maisRecente };
}
export function validarCorrecao(v, realizada, hoje = "") {
  if (!v?.data || !dataOk(v.data) || v.data < "2020-01-01") return "Data da revistoria inválida";
  if (v.horario && !/^([01]\d|2[0-3]):[0-5]\d$/.test(v.horario)) return "Horário inválido (use HH:MM)";
  if (limparNome(v.responsavel)) { const n = validarNome(v.responsavel); if (n) return n; }
  if (realizada) {
    if (!v.realizada || !dataOk(v.realizada)) return "Informe a data em que a revistoria foi realizada";
    if (hoje && v.realizada > hoje) return "A data da realização não pode ser futura";
  }
  const m = String(v.motivo || "").trim();
  if (m.length < 3) return "Informe o motivo da correção";
  if (m.length > 500) return "Motivo muito longo (máximo de 500 caracteres)";
  return "";
}
export function descreverEvento(e) {
  let titulo = TITULOS[e.tipo] || e.tipo;
  if (e.tipo === "resultado") titulo = e.status_novo === "Aprovado" ? "Revistoria aprovada" : "Revistoria reprovada";
  if (e.tipo === "liberacao") titulo = /retirada/i.test(e.descricao || "") ? "Liberação retirada" : "Liberada para execução";
  const por = e.registrado_email === "migração" ? "situação inicial" : e.registrado_email || "sistema";
  return { titulo, de: e.status_anterior || "", para: e.status_novo || "", ciclo: e.ciclo || 1, texto: e.descricao || "", quando: e.registrado_em, por,
    mantemStatus: e.tipo === "liberacao" || e.tipo === "execucao" || e.tipo === "relatorio" || e.tipo === "correcao",
    cor: e.tipo === "resultado" && e.status_novo !== "Aprovado" ? "#d64545" : e.tipo === "cancelamento" ? "#8a948f"
      : e.tipo === "liberacao" ? "#0f3b31" : e.tipo === "execucao" ? "#7b4fc9" : e.tipo === "correcao" ? "#b9770e" : info(e.status_novo).borda };
}

// ── Apontamentos da revistoria (checklist do relatório) ──
// Fonte única para a Lista (Qtd. Apontamentos / Qtd. Resolvidas) e para o relatório individual:
// os apontamentos (revistorias_apontamentos) dos relatórios ativos da unidade, sem repetidos.
// Repetido = mesmo texto (sem diferença de maiúsculas, acentos ou espaços); vale a cópia mais recente
// (relatório enviado por último), com o registro de resolução dela. Nada é guardado em campos de total:
// os quantitativos são sempre calculados destes registros.
export const chaveApontamento = (texto) => norm(texto);
const tempo = (r) => Date.parse(r?.enviado_em || "") || 0;
/** Checklist da unidade: relatório mais antigo primeiro e, em cada um, a ordem do checklist. */
export function checklistUnidade(aps, rels) {
  const rel = new Map((rels || []).filter((r) => !r.removido_em).map((r) => [r.id, r]));
  const vivos = (aps || []).filter((a) => rel.has(a.relatorio_id) && chaveApontamento(a.texto));
  const cmp = (x, y) => tempo(rel.get(x.relatorio_id)) - tempo(rel.get(y.relatorio_id)) || x.relatorio_id - y.relatorio_id ||
    (x.ordem ?? 0) - (y.ordem ?? 0) || x.id - y.id;
  vivos.sort(cmp);
  const vale = new Map();
  for (const a of vivos) vale.set(chaveApontamento(a.texto), a);   // o último (mais recente) prevalece
  return vivos.filter((a) => vale.get(chaveApontamento(a.texto)) === a);
}
/** Quantitativos do checklist: total, resolvidas e % (null sem apontamentos: nunca "100%" sem itens). */
export function resumoApontamentos(lista) {
  const total = (lista || []).length, resolvidas = (lista || []).filter((a) => a.concluido).length;
  return { total, resolvidas, pct: total ? Math.round((resolvidas / total) * 100) : null };
}
/** Quantitativos por unidade a partir dos apontamentos e relatórios do condomínio (mesma regra do relatório). */
export function resumoPorUnidade(aps, rels) {
  const relsU = new Map(), apsU = new Map();
  for (const r of rels || []) { if (r.removido_em) continue; if (!relsU.has(r.unit_id)) relsU.set(r.unit_id, []); relsU.get(r.unit_id).push(r); }
  for (const a of aps || []) { if (!apsU.has(a.unit_id)) apsU.set(a.unit_id, []); apsU.get(a.unit_id).push(a); }
  const out = new Map();
  for (const [unit, rs] of relsU) out.set(unit, { relatorios: rs.length, ...resumoApontamentos(checklistUnidade(apsU.get(unit) || [], rs)) });
  return out;
}
/** Separa os apontamentos lidos de um PDF entre novos e já existentes no checklist (conferência antes de salvar). */
export function conferirExtraidos(textos, checklist) {
  const ja = new Map((checklist || []).map((a) => [chaveApontamento(a.texto), a]));
  const vistos = new Set();
  return (textos || []).map((texto) => {
    const k = chaveApontamento(texto), existente = ja.get(k) || null, repetido = !existente && vistos.has(k);
    vistos.add(k);
    return { texto, existente, repetido, usar: !existente && !repetido && !!k };
  });
}
