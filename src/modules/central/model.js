// Central Operacional (Resumo Geral): regras puras, sem tela nem Supabase. Usadas pela Agenda Operacional,
// pela Visão de Produtividade, pela Central de Unidades e pelos testes (scripts/test-central.mjs).
//
// Os dados vêm das funções central_* do banco (só leitura). Aqui só classificação, filtros, agrupamento por
// dia, indicadores do período carregado e a linha do tempo da unidade. Nada é gravado.

const norm = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
export const pad = (n) => String(n).padStart(2, "0");
/** Data local (AAAA-MM-DD) somando dias, sem fuso: só aritmética de calendário. */
export function somaDias(iso, n) {
  const [y, m, d] = String(iso).slice(0, 10).split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}
export const diasEntre = (a, b) => Math.round((Date.parse(String(b).slice(0, 10) + "T00:00:00Z") - Date.parse(String(a).slice(0, 10) + "T00:00:00Z")) / 86400000);
export const fmtD = (iso) => { const p = String(iso || "").slice(0, 10).split("-"); return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : ""; };
export const fmtDH = (ts) => { if (!ts) return ""; const d = new Date(ts); return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const SEMANA = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
export function diaSemana(iso) { const [y, m, d] = String(iso).split("-").map(Number); return SEMANA[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]; }
/** Rótulo do cabeçalho do dia: Hoje, Amanhã, Ontem ou o dia da semana. */
export function rotuloDia(iso, hoje) {
  const n = diasEntre(hoje, iso);
  const rel = n === 0 ? "Hoje" : n === 1 ? "Amanhã" : n === -1 ? "Ontem" : diaSemana(iso).replace(/^./, (c) => c.toUpperCase());
  return { rel, data: fmtD(iso), passado: n < 0, hoje: n === 0 };
}

// ── Atividades (vistoria ou revistoria) ──
export const TIPOS = {
  vistoria: { key: "vistoria", label: "Vistoria", sigla: "V", cor: "#2f6fdb" },
  revistoria: { key: "revistoria", label: "Revistoria", sigla: "R", cor: "#e8842a" }
};
/**
 * Situação operacional da atividade (para filtros e indicadores), sem mudar o status original:
 *   agendada · atrasada (data passou e não foi realizada) · andamento · aprovada · pendente (reprovada,
 *   segue para revistoria) · concluida (finalizada) · cancelada · outro.
 * Vistoria: Agendado/Remarcado → agendada/atrasada; Aprovado → aprovada; Revistoria → pendente (reprovada na
 * vistoria); Revistoria Finalizada → aprovada (após a revistoria); Inadimplência → outro.
 * Revistoria: Agendada → agendada/atrasada; Em revistoria → andamento; Aprovada → aprovada; Reprovada →
 * pendente; Cancelada → cancelada (remarcação ou desmarcação; fica no histórico).
 */
export function situacao(a, hoje) {
  const st = String(a?.status || "");
  const passou = a?.data && a.data < hoje;
  if (a?.tipo === "revistoria") {
    if (st === "Agendada") return passou ? "atrasada" : "agendada";
    if (st === "Em revistoria") return passou ? "atrasada" : "andamento";
    if (st === "Aprovada") return "aprovada";
    if (st === "Reprovada") return "pendente";
    if (st === "Cancelada") return "cancelada";
    return "outro";
  }
  if (st === "Agendado" || st === "Remarcado") return passou ? "atrasada" : "agendada";
  if (st === "Aprovado" || st === "Revistoria Finalizada") return "aprovada";
  if (st === "Revistoria") return "pendente";
  return "outro";
}
export const CONCLUIDAS = ["aprovada", "pendente"];
export const SITUACOES = {
  agendada: { label: "Agendada", cor: "#2459b5" },
  andamento: { label: "Em andamento", cor: "#7b5cd6" },
  atrasada: { label: "Atrasada", cor: "#b33636" },
  aprovada: { label: "Aprovada", cor: "#268a4d" },
  pendente: { label: "Com pendências", cor: "#c96a1a" },
  cancelada: { label: "Cancelada", cor: "#8a948f" },
  outro: { label: "Outro", cor: "#8a948f" }
};
// Indicadores clicáveis da agenda → filtro aplicado
export const KPIS_AGENDA = [
  { key: "total", label: "Atividades", dica: "Vistorias e revistorias do período (canceladas não contam)" },
  { key: "vistoria", label: "Vistorias", dica: "Vistorias com data no período" },
  { key: "revistoria", label: "Revistorias", dica: "Agendamentos de revistoria no período (sem os cancelados)" },
  { key: "concluidas", label: "Concluídas", dica: "Realizadas: aprovadas ou com pendências" },
  { key: "andamento", label: "Em andamento", dica: "Revistorias em andamento" },
  { key: "pendente", label: "Pendentes", dica: "Realizadas com pendências (reprovadas): seguem para revistoria" },
  { key: "aprovada", label: "Aprovadas", dica: "Vistorias aprovadas ou revistorias aprovadas" },
  { key: "atrasada", label: "Atrasadas", dica: "Data já passou e a atividade não foi realizada" }
];
/** Filtros de status (chips) → situações. */
export const FILTROS_STATUS = [
  { key: "agendada", label: "Agendados" }, { key: "andamento", label: "Em andamento" }, { key: "concluidas", label: "Concluídos" },
  { key: "aprovada", label: "Aprovados" }, { key: "pendente", label: "Pendentes" }, { key: "atrasada", label: "Atrasados" },
  { key: "cancelada", label: "Cancelados" }
];
export const FILTRO0 = () => ({ projetos: [], tipo: "", status: "", resp: "", bloco: "", busca: "", canceladas: false });
export const passaStatus = (sit, f) => !f || (f === "concluidas" ? CONCLUIDAS.includes(sit) : sit === f);
const codigoBusca = (s) => norm(s).replace(/\b(bloco|bl|apto|apt|ap|casa|conj|conjunto|unidade)\b/g, "").replace(/[\s·\-_/.]+/g, "");
/** Filtros combináveis da agenda (condomínios e período já vêm aplicados pelo banco). */
export function passaFiltros(a, f, hoje) {
  const sit = situacao(a, hoje);
  if (f.projetos?.length && !f.projetos.map(String).includes(String(a.project_id))) return false;
  if (f.tipo && a.tipo !== f.tipo) return false;
  if (sit === "cancelada" && !f.canceladas && f.status !== "cancelada") return false;
  if (f.status && !passaStatus(sit, f.status)) return false;
  if (f.resp && norm(a.responsavel || "(sem responsável)") !== norm(f.resp)) return false;
  if (f.bloco && `${a.project_id}|${a.bloco}` !== f.bloco) return false;
  const q = String(f.busca || "").trim();
  if (q) {
    const c = codigoBusca(q), alvo = [`${a.bloco}${a.codigo}`, a.codigo, `${a.bloco} ${a.codigo}`].map(codigoBusca);
    const texto = norm(`${a.cliente || ""} ${a.projeto || ""} ${a.responsavel || ""}`);
    if (!(c && alvo.some((x) => x === c || x.startsWith(c))) && !texto.includes(norm(q))) return false;
  }
  return true;
}
/** Indicadores do que está carregado e filtrado (cada atividade conta uma vez; canceladas fora). */
export function indicadores(lista, hoje) {
  const k = { total: 0, vistoria: 0, revistoria: 0, concluidas: 0, andamento: 0, pendente: 0, aprovada: 0, atrasada: 0, agendada: 0, unidades: 0 };
  const un = new Set();
  for (const a of lista) {
    const s = situacao(a, hoje);
    if (s === "cancelada") continue;
    k.total++; k[a.tipo]++; un.add(a.unit_id);
    if (CONCLUIDAS.includes(s)) k.concluidas++;
    if (k[s] !== undefined) k[s]++;
  }
  k.unidades = un.size;
  return k;
}
/** Filtro que cada indicador aplica (clicar de novo limpa). */
export function filtroDoKpi(key, f) {
  const n = { ...f };
  if (key === "total") { n.tipo = ""; n.status = ""; return n; }
  if (key === "vistoria" || key === "revistoria") { n.tipo = f.tipo === key ? "" : key; return n; }
  n.status = f.status === key ? "" : key;
  return n;
}
/** Agrupa por dia (ordem cronológica), garantindo o dia de hoje mesmo vazio quando estiver no intervalo. */
export function porDia(lista, hoje, de, ate) {
  const m = new Map();
  for (const a of lista) { if (!m.has(a.data)) m.set(a.data, []); m.get(a.data).push(a); }
  if (hoje >= de && hoje <= ate && !m.has(hoje)) m.set(hoje, []);
  return [...m.entries()].sort((x, y) => (x[0] < y[0] ? -1 : 1)).map(([data, itens]) => ({
    data, itens: itens.sort((x, y) => (x.horario || "99:99").localeCompare(y.horario || "99:99") || String(x.projeto || "").localeCompare(String(y.projeto || ""), "pt-BR")
      || String(x.bloco).localeCompare(String(y.bloco), "pt-BR", { numeric: true }) || String(x.codigo).localeCompare(String(y.codigo), "pt-BR", { numeric: true }))
  }));
}
/** Responsáveis presentes (para o filtro), sem diferenciar maiúsculas/espaços. */
export function responsaveis(lista) {
  const m = new Map();
  for (const a of lista) { const nome = String(a.responsavel || "").trim() || "(sem responsável)"; const k = norm(nome); if (!m.has(k)) m.set(k, nome); }
  return [...m.values()].sort((a, b) => a.localeCompare(b, "pt-BR"));
}
/** Janela inicial da agenda e o próximo bloco a carregar na rolagem. */
export const JANELA = 21;
export const janelaInicial = (hoje) => ({ de: somaDias(hoje, -7), ate: somaDias(hoje, JANELA) });
export const proximaJanela = (ate) => ({ de: somaDias(ate, 1), ate: somaDias(ate, JANELA) });
export const janelaAnterior = (de) => ({ de: somaDias(de, -JANELA), ate: somaDias(de, -1) });

// ── Produtividade ──
export const PERIODOS = [
  { key: "7d", label: "7 dias" }, { key: "30d", label: "30 dias" }, { key: "mes", label: "Este mês" },
  { key: "90d", label: "90 dias" }, { key: "tudo", label: "Desde o início" }, { key: "custom", label: "Personalizado" }
];
export function periodo(key, hoje, inicio = "2026-01-01") {
  if (key === "7d") return { de: somaDias(hoje, -6), ate: hoje };
  if (key === "30d") return { de: somaDias(hoje, -29), ate: hoje };
  if (key === "90d") return { de: somaDias(hoje, -89), ate: hoje };
  if (key === "mes") return { de: hoje.slice(0, 8) + "01", ate: hoje };
  return { de: inicio, ate: hoje };
}
/** Granularidade sugerida para o gráfico, para não ter barras demais nem de menos. */
export const graoSugerido = (de, ate) => { const n = diasEntre(de, ate) + 1; return n <= 31 ? "dia" : n <= 150 ? "semana" : "mes"; };
export const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : null);
export const fmtPct = (v) => (v == null ? "—" : `${String(v).replace(".", ",")}%`);
/** Variação contra o período anterior de mesmo tamanho (null quando não há base). */
export function variacao(atual, anterior) {
  if (!anterior) return atual ? { txt: "novo", dir: "up" } : null;
  const d = Math.round(((atual - anterior) / anterior) * 100);
  return { txt: `${d > 0 ? "+" : ""}${d}%`, dir: d > 0 ? "up" : d < 0 ? "down" : "eq" };
}
/** Escala "bonita" para o eixo do gráfico (passo 1, 2 ou 5 × 10ⁿ). */
export function escala(max, linhas = 4) {
  if (!max || max <= 0) return { max: linhas, passo: 1 };
  const bruto = max / linhas, mag = 10 ** Math.floor(Math.log10(bruto)), r = bruto / mag;
  const passo = Math.max(1, (r <= 1 ? 1 : r <= 2 ? 2 : r <= 5 ? 5 : 10) * mag);   // contagens: passo inteiro
  return { max: Math.ceil(max / passo) * passo, passo };
}
/** Rótulo curto de um balde da série. */
export function rotuloBalde(ini, grao) {
  const [y, m, d] = String(ini).split("-");
  if (grao === "mes") return `${["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"][Number(m) - 1]}/${y.slice(2)}`;
  return `${d}/${m}`;
}

// ── Central de Unidades ──
/** Situação geral da unidade (não substitui os status individuais da vistoria e da revistoria). */
export function situacaoGeral(v, rc) {
  const st = v?.status || "Não agendado";
  if (st === "Aprovado") return { label: "Aprovada na 1ª vistoria", cor: "#268a4d" };
  if (st === "Revistoria Finalizada" || rc?.status === "Aprovado") return { label: "Aprovada após revistoria", cor: "#268a4d" };
  if (st === "Revistoria") return rc?.status === "Agendado" ? { label: "Em revistoria · agendada", cor: "#c96a1a" } : { label: "Em revistoria · aguardando agendamento", cor: "#c96a1a" };
  if (st === "Agendado" || st === "Remarcado") return { label: "Aguardando a 1ª vistoria", cor: "#2459b5" };
  if (st === "Inadimplência") return { label: "Processo em andamento", cor: "#6f7a74" };
  return { label: "Vistoria não agendada", cor: "#8a948f" };
}
/**
 * Pendências da unidade a partir dos registros originais (apontamentos de cada relatório):
 *   abertas/resolvidas = checklist atual (relatórios ativos, sem repetidos; vale o mais recente);
 *   historico = cópias anteriores do mesmo item (reincidência) e itens de relatórios retirados.
 * Reincidente = o mesmo item aparece em mais de um relatório (não duplica a contagem).
 */
export function pendencias(d) {
  const rel = new Map((d?.relatorios || []).map((r) => [r.id, r]));
  const ativos = new Set(d?.checklist || []);
  const vezes = new Map();
  for (const a of d?.apontamentos || []) { const r = rel.get(a.relatorio_id); if (r && !r.removido_em) vezes.set(a.chave, (vezes.get(a.chave) || 0) + 1); }
  const enriquecer = (a) => { const r = rel.get(a.relatorio_id) || {}; return { ...a, relatorio: r, identificado_em: r.identificado_em || String(r.enviado_em || "").slice(0, 10), identificado_por: r.resumo?.responsavel || "", reincidencia: vezes.get(a.chave) || 1 }; };
  const todos = (d?.apontamentos || []).map(enriquecer);
  const atuais = todos.filter((a) => ativos.has(a.id));
  const abertas = atuais.filter((a) => !a.concluido), resolvidas = atuais.filter((a) => a.concluido);
  const historico = todos.filter((a) => !ativos.has(a.id)).map((a) => ({ ...a, motivo: a.relatorio?.removido_em ? "relatório retirado" : "repetido em relatório mais recente" }));
  const ord = (x, y) => String(x.identificado_em).localeCompare(String(y.identificado_em)) || x.ordem - y.ordem;
  return { abertas: abertas.sort(ord), resolvidas: resolvidas.sort(ord), historico: historico.sort(ord), total: atuais.length,
    reincidentes: atuais.filter((a) => a.reincidencia > 1).length, pct: pct(resolvidas.length, atuais.length) };
}
const descrVistoria = (h) => {
  const partes = [];
  if (h.status_anterior !== h.status_novo) partes.push(`${h.status_anterior || "—"} → ${h.status_novo || "—"}`);
  if (h.data_anterior !== h.data_nova || h.horario_anterior !== h.horario_novo)
    partes.push(`data ${[fmtD(h.data_anterior), h.horario_anterior].filter(Boolean).join(" ") || "—"} → ${[fmtD(h.data_nova), h.horario_novo].filter(Boolean).join(" ") || "—"}`);
  if (h.responsavel_anterior !== h.responsavel_novo) partes.push(`responsável ${h.responsavel_anterior || "—"} → ${h.responsavel_novo || "—"}`);
  return partes.join(" · ");
};
const tituloVistoria = (h) => {
  const n = h.status_novo, a = h.status_anterior;
  if (n !== a) {
    if (n === "Agendado") return "Vistoria agendada";
    if (n === "Remarcado") return "Vistoria remarcada";
    if (n === "Aprovado") return "Vistoria realizada · aprovada";
    if (n === "Revistoria") return a === "Revistoria Finalizada" ? "Revistoria reaberta" : "Vistoria realizada · encaminhada para revistoria";
    if (n === "Revistoria Finalizada") return "Revistoria finalizada · aprovada";
    if (n === "Inadimplência") return "Processo em andamento";
    if (n === "Não agendado") return "Agendamento retirado";
    return `Status da vistoria: ${n}`;
  }
  if (h.data_anterior !== h.data_nova || h.horario_anterior !== h.horario_novo) return h.data_anterior ? "Data da vistoria alterada" : "Vistoria agendada";
  return "Responsável da vistoria alterado";
};
const TIPO_EVENTO = {
  entrada: "Entrou na Revistoria", agendamento: "Revistoria agendada", remarcacao: "Revistoria remarcada", cancelamento: "Agendamento cancelado",
  resultado: "Revistoria realizada", reabertura: "Revistoria reaberta", vistoria: "Mudança vinda da vistoria", planilha: "Atualização pela planilha",
  liberacao: "Liberação para execução", execucao: "Equipe de execução", relatorio: "Relatório"
};
/**
 * Linha do tempo da unidade, em ordem cronológica, sem sobrescrever nada: cada registro original vira um
 * acontecimento (histórico da vistoria, reagendamentos, eventos da revistoria, relatórios e resoluções).
 */
export function linhaDoTempo(d) {
  const ev = [];
  for (const h of d?.historico_vistoria || []) {
    ev.push({ quando: h.registrado_em, tipo: "vistoria", titulo: tituloVistoria(h), texto: descrVistoria(h), por: h.registrado_email || h.origem || "",
      status: h.status_novo, ref: "Vistoria · histórico de alterações" });
  }
  for (const g of d?.reagendamentos || []) {
    ev.push({ quando: g.registrado_em, tipo: "vistoria", titulo: "Vistoria reagendada", texto: `${fmtD(g.data_anterior)} ${g.horario_anterior ? String(g.horario_anterior).slice(0, 5) : ""} → ${fmtD(g.data_nova)} ${g.horario_nova ? String(g.horario_nova).slice(0, 5) : ""}${g.observacao ? " · " + g.observacao : ""}`.replace(/\s+/g, " ").trim(),
      por: g.registrado_email, status: "Remarcado", ref: "Reagendamento" });
  }
  for (const e of d?.eventos || []) {
    if (e.tipo === "relatorio") continue;   // relatórios entram abaixo, com os dados do arquivo
    const titulo = e.tipo === "resultado" ? `Revistoria realizada · ${/reprov/i.test(e.descricao || "") ? "reprovada" : /aprov/i.test(e.descricao || "") ? "aprovada" : "resultado"}` : TIPO_EVENTO[e.tipo] || e.tipo;
    ev.push({ quando: e.registrado_em, tipo: "revistoria", titulo, texto: e.descricao || "", por: e.registrado_email || "", status: e.status_novo || "", ciclo: e.ciclo, ref: "Revistoria · histórico" });
  }
  for (const r of d?.relatorios || []) {
    const n = (d?.apontamentos || []).filter((a) => a.relatorio_id === r.id).length;
    ev.push({ quando: r.enviado_em, tipo: "relatorio", titulo: "Relatório anexado · pendências identificadas", texto: `${r.nome_arquivo || "PDF"} · ${n} apontamento(s)${r.resumo?.realizado ? ` · realizado em ${fmtD(r.resumo.realizado)}` : ""}${r.resumo?.responsavel ? ` · ${r.resumo.responsavel}` : ""}`,
      por: r.enviado_email || "", status: "", ref: "Relatório", relatorio_id: r.id });
    if (r.removido_em) ev.push({ quando: r.removido_em, tipo: "relatorio", titulo: "Relatório retirado", texto: r.nome_arquivo || "PDF", por: r.removido_email || "", status: "", ref: "Relatório" });
  }
  // resoluções: agrupadas por dia e pessoa, para não virar uma lista enorme
  const res = new Map();
  for (const a of d?.apontamentos || []) {
    if (!a.concluido || !a.concluido_em) continue;
    const k = String(a.concluido_em).slice(0, 10) + "|" + (a.concluido_email || "");
    if (!res.has(k)) res.set(k, { quando: a.concluido_em, por: a.concluido_email || "", n: 0 });
    const x = res.get(k); x.n++; if (a.concluido_em > x.quando) x.quando = a.concluido_em;
  }
  for (const x of res.values()) ev.push({ quando: x.quando, tipo: "pendencia", titulo: "Pendências resolvidas", texto: `${x.n} item(ns) marcado(s) como resolvido(s) no checklist`, por: x.por, status: "", ref: "Checklist" });
  return ev.filter((e) => e.quando).sort((x, y) => String(x.quando).localeCompare(String(y.quando)));
}
/** Agendamentos da unidade (vistoria atual + revistorias), separados em futuros, realizados e cancelados. */
export function agendamentosUnidade(d, hoje) {
  const out = [];
  const v = d?.vistoria;
  if (v?.inspection_date) out.push({ tipo: "vistoria", data: v.inspection_date, horario: v.inspection_time || "", responsavel: v.responsible || "", status: v.status, numero: null });
  for (const r of d?.agendamentos || []) out.push({ tipo: "revistoria", data: r.data, horario: String(r.horario || "").slice(0, 5), responsavel: r.responsavel || "", status: r.status, numero: r.numero, ciclo: r.ciclo, realizada_em: r.realizada_em, obs: r.resultado_obs || r.observacoes || "" });
  const grupo = (a) => { const s = situacao(a, hoje); return s === "cancelada" ? "cancelados" : ["agendada", "andamento", "atrasada"].includes(s) ? "futuros" : "realizados"; };
  const g = { futuros: [], realizados: [], cancelados: [] };
  for (const a of out) g[grupo(a)].push({ ...a, situacao: situacao(a, hoje) });
  g.futuros.sort((x, y) => String(x.data).localeCompare(String(y.data)));
  g.realizados.sort((x, y) => String(y.data).localeCompare(String(x.data)));
  g.cancelados.sort((x, y) => String(y.data).localeCompare(String(x.data)));
  return g;
}
/** Última atividade da unidade (data e responsável) pela linha do tempo e pelos agendamentos. */
export function ultimaAtividade(d, tl) {
  const ult = (tl || []).at(-1);
  return ult ? { quando: ult.quando, por: ult.por, titulo: ult.titulo } : null;
}
