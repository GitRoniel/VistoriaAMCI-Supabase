// Cores centralizadas: regras puras (sem tela nem Supabase), usadas pelo módulo de cores (www/cores.js), pelo
// Controle de Chaves, pela Revistoria · Cliente e pelos testes.
//
// Duas categorias independentes (nunca se misturam):
//   A) Legendas operacionais — setores do Controle de Chaves (tabela cores_legendas, categoria "setor_chave").
//      Sem configuração = cor padrão do aplicativo (abaixo).
//   B) Equipes de mão de obra — cadastro equipes_execucao (id estável, nome, equipe, sigla, cor, cor padrão, ativa).
// Para cada cor de fundo calculamos a borda (mais escura) e o texto (claro ou escuro) com contraste adequado.

export const CATEGORIA_SETOR = "setor_chave";
/** Cores padrão dos setores (as mesmas usadas desde o início do Controle de Chaves). */
export const SETORES_PADRAO = {
  base: { cor: "#2f6fdb", borda: "#2459b5", texto: "#ffffff" },
  cx: { cor: "#2f9e5b", borda: "#268a4d", texto: "#ffffff" },
  asstec: { cor: "#e8842a", borda: "#c96a1a", texto: "#ffffff" },
  producao: { cor: "#d64545", borda: "#b33636", texto: "#ffffff" },
  cliente: { cor: "#7b4fc9", borda: "#6340a8", texto: "#ffffff" },
  sem: { cor: "#e4e8e5", borda: "#c3cac5", texto: "#7a857e" }
};
/** Equipes de antes do cadastro (usadas só se o cadastro ainda não estiver no banco). */
export const EQUIPES_PADRAO = [
  { id: "MOP_FELIPE", grupo: "M.O.P", nome: "Felipe", sigla: "F", cor: "#7b4fc9", cor_padrao: "#7b4fc9", ativo: true, ordem: 1 },
  { id: "MOP_RENATO", grupo: "M.O.P", nome: "Renato", sigla: "R", cor: "#c2185b", cor_padrao: "#c2185b", ativo: true, ordem: 2 },
  { id: "EMP_OSCAR", grupo: "EMP", nome: "Oscar", sigla: "O", cor: "#00838f", cor_padrao: "#00838f", ativo: true, ordem: 3 },
  { id: "EMP_NILSON", grupo: "EMP", nome: "Nilson", sigla: "N", cor: "#8d5524", cor_padrao: "#8d5524", ativo: true, ordem: 4 }
];
/** Unidade sem equipe vinculada (mapa da Execução M.O.): tom mais escuro que o fundo, para destacar quem ainda
 *  não tem mão de obra alocada (com contorno tracejado no mapa). */
export const SEM_EQUIPE = { cor: "#bcc7c1", borda: "#5f6f67", texto: "#1d2e26" };
/** Unidade já aprovada na revistoria e sem equipe: cinza mais forte (concluída, não precisa de mão de obra). */
export const APROVADA_SEM_EQUIPE = { cor: "#7d8782", borda: "#5f6964", texto: "#ffffff" };
/** Sugestões para equipes novas (distintas das cores de status e de setores). */
export const PALETA_EQUIPES = ["#7b4fc9", "#c2185b", "#00838f", "#8d5524", "#3949ab", "#00897b", "#ad1457", "#5d4037", "#6d4c41", "#1e88e5", "#7cb342", "#f4511e"];

export const hexOk = (v) => /^#[0-9a-f]{6}$/i.test(String(v || "").trim());
export const hex = (v) => String(v || "").trim().toLowerCase();
const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const paraHex = (c) => "#" + c.map((x) => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, "0")).join("");
/** Luminância relativa (WCAG). */
export function luminancia(h) {
  const [r, g, b] = rgb(hex(h)).map((x) => { const v = x / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export const contraste = (a, b) => { const [x, y] = [luminancia(a), luminancia(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
/** Texto com o melhor contraste sobre a cor (branco ou verde-escuro do app). */
export const textoSobre = (cor) => (contraste(cor, "#ffffff") >= contraste(cor, "#14241c") ? "#ffffff" : "#14241c");
/** Borda: a própria cor escurecida (mais escura ainda quando o fundo é muito claro, para o contorno aparecer). */
export const escurecer = (cor, f) => paraHex(rgb(hex(cor)).map((x) => x * (1 - f)));
export function estilo(cor) {
  const c = hex(cor);
  return { cor: c, borda: escurecer(c, luminancia(c) > 0.7 ? 0.2 : 0.16), texto: textoSobre(c) };
}

/** Setores com as cores personalizadas aplicadas (linhas de cores_legendas). */
export function setores(linhas = []) {
  const custom = {};
  for (const l of linhas || []) if (l?.categoria === CATEGORIA_SETOR && SETORES_PADRAO[l.chave] && hexOk(l.cor)) custom[l.chave] = hex(l.cor);
  const out = {};
  for (const [k, p] of Object.entries(SETORES_PADRAO)) out[k] = custom[k] ? { ...estilo(custom[k]), custom: true, padrao: p.cor } : { ...p, custom: false, padrao: p.cor };
  return out;
}
/** Equipes normalizadas e ordenadas (ativas e desativadas: as desativadas continuam identificando o histórico). */
export function equipes(linhas) {
  const l = Array.isArray(linhas) && linhas.length ? linhas : EQUIPES_PADRAO;
  return l.filter((e) => e?.id).map((e) => {
    const cor = hexOk(e.cor) ? hex(e.cor) : "#8a948f";
    return { id: e.id, grupo: e.grupo || "", nome: e.nome || "", sigla: String(e.sigla || "?").slice(0, 2), ativo: e.ativo !== false, ordem: Number(e.ordem) || 0,
      ...estilo(cor), corPadrao: hexOk(e.cor_padrao) ? hex(e.cor_padrao) : cor };
  }).sort((a, b) => a.ordem - b.ordem || a.nome.localeCompare(b.nome, "pt-BR"));
}
/** Validação da equipe no formulário (o banco confere de novo). */
export function validarEquipe(e) {
  const g = String(e?.grupo || "").replace(/\s+/g, " ").trim(), n = String(e?.nome || "").replace(/\s+/g, " ").trim(), s = String(e?.sigla || "").trim();
  if (!g || g.length > 30) return "Informe a equipe (até 30 caracteres)";
  if (n.length < 2 || n.length > 60) return "Informe o nome do responsável (2 a 60 caracteres)";
  if (!s || s.length > 2) return "Informe a sigla (1 ou 2 caracteres)";
  if (!hexOk(e?.cor)) return "Escolha uma cor";
  return "";
}
/** Próxima cor sugerida para uma equipe nova (a primeira da paleta que ainda não está em uso). */
export const sugerirCor = (lista = []) => PALETA_EQUIPES.find((c) => !lista.some((e) => hex(e.cor) === c)) || PALETA_EQUIPES[lista.length % PALETA_EQUIPES.length];
