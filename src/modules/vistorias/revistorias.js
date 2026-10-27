// Revistorias da planilha de Vistorias AMCI: regras puras (sem tela nem Supabase), usadas pela
// importação, pelo mapa/lista/popup das Vistorias e pelos testes (scripts/test-revistorias.mjs).
//
// Colunas da planilha (Relatório 854):
//   K  STATUS DA REVISTORIA                 Agendada · Em revistoria · Aprovada · Reprovada
//   L  DATA DA REVISTORIA                   data da revistoria (agendada ou realizada)
//   M  HORÁRIO DO AGENDAMENTO REVISTORIA     horário da revistoria
// Cada unidade pode ter várias revistorias (nº 1, 2…). A planilha traz uma por linha: a atual.
//   - sem revistoria no sistema                       → revistoria nova (nº 1)
//   - a atual está Agendada / Em revistoria           → é a mesma revistoria: atualiza status, data e horário
//   - a atual foi Reprovada e a planilha traz data     → revistoria nova (nº seguinte)
//     posterior
//   - a atual já terminou e a planilha a altera         → conflito: só muda se o usuário escolher a planilha
// Valor vazio na planilha nunca apaga dado. O status da vistoria (coluna H) nunca é tocado aqui.

export const REV_STATUS = [
  { key: "Agendada", label: "Agendada", cor: "#c99a1e", texto: "#3d2f06", fim: false },
  { key: "Em revistoria", label: "Em revistoria", cor: "#7b5cd6", texto: "#ffffff", fim: false },
  { key: "Aprovada", label: "Aprovada", cor: "#2f9e5b", texto: "#ffffff", fim: true },
  { key: "Reprovada", label: "Reprovada", cor: "#d64545", texto: "#ffffff", fim: true }
];
export const SEM_STATUS = { key: "", label: "Sem status", cor: "#8a948f", texto: "#ffffff", fim: false };
// Filtro da lista: os status acima + unidades sem nenhuma revistoria.
export const SEM_REVISTORIA = "nenhuma";

export const revInfo = (status) => REV_STATUS.find((s) => s.key === status) || SEM_STATUS;

const norm = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
const clean = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
const hhmm = (t) => String(t || "").slice(0, 5);
const fmtData = (d) => { const p = String(d || "").slice(0, 10).split("-"); return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : ""; };

/** Coluna K → status normalizado. {status:""} vazio; {invalid} quando o texto não é reconhecido. */
export function statusDaPlanilha(raw) {
  const original = clean(raw), t = norm(raw);
  if (!t) return { status: "", original: "" };
  if (/reprov/.test(t)) return { status: "Reprovada", original };
  if (/aprov/.test(t)) return { status: "Aprovada", original };
  if (/^em (re)?vistoria|^em revis|^em andamento|realizando|chegou/.test(t)) return { status: "Em revistoria", original };
  if (/agend|remarc|aguar/.test(t)) return { status: "Agendada", original };
  return { invalid: original, original };
}

/** Revistoria mais recente (maior número) de uma lista. */
export const ultima = (lista) => (lista || []).reduce((m, r) => (!m || r.numero > m.numero ? r : m), null);

/** "nº 2 · Aprovada · 22/10/2026 · 09:00" */
export function rotulo(rev, { numero = true } = {}) {
  if (!rev) return "";
  return [numero && rev.numero ? `nº ${rev.numero}` : "", revInfo(rev.status).label, fmtData(rev.data), hhmm(rev.horario)].filter(Boolean).join(" · ");
}

/**
 * Compara a revistoria da planilha com a atual do sistema (nada é gravado aqui).
 * @param atual  revistoria mais recente da unidade ({numero,status,data,horario}) ou null
 * @param sheet  {status, statusOriginal, statusInvalido, data, dataInvalida, hora, horaInvalida} já convertidos
 * @param dataUnidade  "Data da revistoria" da unidade (client_inspections.reinspection_date), "AAAA-MM-DD" ou ""
 * @returns null (linha sem revistoria) ou item {key:"revistoria", kind, cur, next, rev, avisos, nota}
 *   kind: fill (nova ou só preenche) · update (muda a revistoria em andamento) · conflict (muda uma
 *   revistoria já terminada: precisa de decisão) · same · invalid (só valores inválidos)
 */
export function comparar(atual, sheet, dataUnidade = "") {
  const avisos = [];
  if (sheet.statusInvalido) avisos.push(`Status da revistoria não reconhecido ("${sheet.statusInvalido}"): o status não será importado`);
  if (sheet.dataInvalida) avisos.push(`Data da revistoria inválida ("${sheet.dataInvalida}"): ignorada`);
  if (sheet.horaInvalida) avisos.push(`Horário da revistoria inválido ("${sheet.horaInvalida}"): ignorado`);
  const novo = {
    status: sheet.status || "",
    status_planilha: (sheet.status ? sheet.statusOriginal : sheet.statusInvalido) || "",
    data: sheet.data || "",
    horario: sheet.hora || ""
  };
  const base = { key: "revistoria", label: "Revistoria", avisos };
  if (!novo.status && !novo.data && !novo.horario) {
    return avisos.length ? { ...base, kind: "invalid", cur: rotulo(atual), next: "", message: avisos.join("; ") } : null;
  }
  const fim = !!atual && revInfo(atual.status).fim;
  const nova = !atual || (atual.status === "Reprovada" && !!novo.data && (!atual.data || novo.data > atual.data));
  let kind, merged, rev;
  if (nova) {
    const numero = (atual?.numero || 0) + 1;
    merged = { numero, status: novo.status, data: novo.data, horario: novo.horario };
    rev = { acao: "nova", numero: atual?.numero || 0, novo };
    kind = "fill";
  } else {
    const cur = { status: atual.status || "", data: atual.data || "", horario: hhmm(atual.horario) };
    const mudou = ["status", "data", "horario"].filter((f) => novo[f] && novo[f] !== cur[f]);
    merged = { numero: atual.numero, status: novo.status || cur.status, data: novo.data || cur.data, horario: novo.horario || cur.horario };
    if (!mudou.length) return { ...base, kind: "same", cur: rotulo(atual), next: rotulo(merged) };
    rev = { acao: "atualizar", numero: atual.numero, esperado: cur, novo };
    kind = fim ? "conflict" : mudou.every((f) => !cur[f]) ? "fill" : "update";
    rev.campos = mudou;
  }
  // "Data da revistoria" da unidade acompanha a revistoria quando vazia ou igual à data anterior.
  let nota = nova && atual ? `Nova revistoria (nº ${merged.numero}); a nº ${atual.numero} fica no histórico` : nova ? "Primeira revistoria da unidade" : "";
  const dataNova = nova ? novo.data : rev.campos.includes("data") ? novo.data : "";
  if (dataNova && dataUnidade !== dataNova) {
    const sync = !dataUnidade || dataUnidade === (atual?.data || "");
    nota = [nota, sync ? "Também preenche a Data da revistoria da unidade" : `A Data da revistoria da unidade (${fmtData(dataUnidade)}) foi alterada no site e será mantida`].filter(Boolean).join(" · ");
  }
  return { ...base, kind, cur: rotulo(atual), next: (nova ? "Nova · " : "") + rotulo(merged), rev, nota, source: fim ? "PLANILHA" : undefined };
}

/** Indicadores da revistoria mais recente de cada unidade: {total, Agendada, "Em revistoria", Aprovada, Reprovada, semStatus}. */
export function resumo(listas) {
  const out = { total: 0, semStatus: 0 };
  REV_STATUS.forEach((s) => (out[s.key] = 0));
  for (const lista of listas) {
    const u = ultima(lista); if (!u) continue;
    out.total++;
    if (u.status && u.status in out) out[u.status]++; else out.semStatus++;
  }
  return out;
}

/** Código usado no filtro da lista: status da revistoria mais recente, "" (sem status) ou SEM_REVISTORIA. */
export function codigoFiltro(lista) {
  const u = ultima(lista);
  return u ? u.status || "" : SEM_REVISTORIA;
}
