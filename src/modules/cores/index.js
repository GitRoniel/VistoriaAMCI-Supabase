// Cores centralizadas (window.AmciCores): carrega do Supabase as duas categorias de cores, avisa os módulos quando
// mudam (inclusive em tempo real, quando outro administrador altera em outro aparelho) e mostra o editor do Admin.
//
//   A) Legendas operacionais: public.cores_legendas (setores do Controle de Chaves)
//   B) Equipes de mão de obra: public.equipes_execucao (id estável; nome, equipe, sigla, cor, ativa) e as legendas do
//      mapa da Execução M.O.: public.cores_legendas, categoria "execucao_mapa" (sem equipe, aprovado sem equipe, fora
//      da revistoria, liberado e botões de status). Mesma tabela das legendas, categoria separada dos setores.
//
// Os módulos (Controle de Chaves, Revistoria · Cliente) não guardam cores próprias: leem daqui e repintam em `on()`.
// Escrita só pelas funções do banco, que conferem se o usuário é administrador (o editor só esconde os botões).
import * as M from "./model.js";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const naoInstalado = (err) => ["42P01", "42883", "PGRST205", "PGRST202", "PGRST204"].includes(err?.code) || /does not exist|could not find/i.test(err?.message || "");
let sb = null, canal = null, recarga = null, pedido = 0;
const vazio = () => ({ carregado: false, instalado: true, setores: M.setores([]), equipes: M.equipes(null), execucao: M.legendasExecucao([]) });
let estado = vazio();
const ouvintes = new Set();
let ov = null, ctx = { admin: false, aba: "setores", rotulos: {} }, msg = null;

function avisar() { for (const f of [...ouvintes]) { try { f(estado); } catch (e) { console.error(e); } } if (ov?.classList.contains("open")) pintarEditor(); }
async function carregar() {
  if (!sb) return;
  const meu = ++pedido;
  const [a, b] = await Promise.all([
    sb.from("cores_legendas").select("categoria,chave,cor,atualizado_em,atualizado_email"),
    sb.from("equipes_execucao").select("id,grupo,nome,sigla,cor,cor_padrao,ativo,ordem").order("ordem")
  ]);
  if (meu !== pedido) return;
  const inst = !(naoInstalado(a.error) || naoInstalado(b.error));
  if ((a.error && !naoInstalado(a.error)) || (b.error && !naoInstalado(b.error))) console.warn("Cores: não foi possível carregar", a.error || b.error);
  estado = { carregado: true, instalado: inst, setores: M.setores(a.data || []), equipes: M.equipes(b.data && b.data.length ? b.data : null),
    execucao: M.legendasExecucao(a.data || []) };
  avisar();
}
const agendar = () => { clearTimeout(recarga); recarga = setTimeout(carregar, 250); };
async function rpc(fn, args) {
  const { data, error } = await sb.rpc(fn, args);
  if (error) { const m = String(error.message || "").replace(/^.*?ERROR:\s*/i, ""); throw new Error(naoInstalado(error) ? "As cores centralizadas ainda não foram instaladas no banco." : m || "Não foi possível salvar."); }
  return data;
}

/* ── editor (Admin altera; os demais só veem) ── */
function garantirEditor() {
  if (ov) return;
  ov = document.createElement("div"); ov.className = "cr-ov"; ov.id = "crOv"; ov.setAttribute("role", "dialog"); ov.setAttribute("aria-modal", "true"); ov.setAttribute("aria-label", "Cores e equipes");
  ov.innerHTML = `<div class="cr-box"><div class="cr-head"><div><b>Cores e equipes</b><small>Configuração central: vale para todos os módulos e condomínios</small></div><button type="button" class="pp-icon cr-x" data-cr-fechar aria-label="Fechar">×</button></div>
    <div class="modetog cr-tabs" role="tablist"><button type="button" role="tab" data-cr-aba="setores">A · Legendas operacionais</button><button type="button" role="tab" data-cr-aba="equipes">B · Equipes e legendas da M.O.</button></div>
    <div class="cr-msg" role="status" aria-live="polite"></div><div class="cr-body" id="crBody"></div></div>`;
  document.body.appendChild(ov);
  ov.addEventListener("click", clique);
  ov.addEventListener("input", previa);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && ov.classList.contains("open")) fechar(); });
}
function fechar() { ov?.classList.remove("open"); document.body.classList.remove("cr-aberto"); }
const aviso = (t, tipo = "ok") => { msg = t ? { t, tipo } : null; const el = ov?.querySelector(".cr-msg"); if (el) { el.textContent = t || ""; el.className = `cr-msg ${t ? tipo : ""}`; } };
function pintarEditor() {
  if (!ov) return;
  ov.querySelectorAll("[data-cr-aba]").forEach((b) => { const on = b.dataset.crAba === ctx.aba; b.classList.toggle("active", on); b.setAttribute("aria-selected", String(on)); });
  const body = ov.querySelector("#crBody"), ro = !ctx.admin;
  const leitura = ro ? `<p class="cr-ro">Somente administradores podem alterar as cores. Você pode consultá-las aqui.</p>` : "";
  if (!estado.instalado) { body.innerHTML = `<p class="cr-ro">As cores centralizadas ainda não foram instaladas no banco (migration 20261114120000).</p>`; return; }
  if (ctx.aba === "setores") {
    const S = estado.setores;
    body.innerHTML = `${leitura}<p class="cr-nota">Setores e situações do <b>Controle de Chaves</b>. A mesma cor aparece em todos os painéis que mostram o setor (Controle de Chaves e marca da chave na Revistoria). Independente das cores das equipes.</p>
      <ul class="cr-list">${Object.keys(M.SETORES_PADRAO).map((k) => {
        const s = S[k], rot = ctx.rotulos[k] || k;
        return `<li class="cr-row" data-setor="${k}"><span class="cr-prev" style="background:${s.cor};border-color:${s.borda};color:${s.texto}">${esc(rot)}</span>
          <label class="cr-cor"><input type="color" value="${s.cor}" data-cr-cor aria-label="Cor de ${esc(rot)}"${ro ? " disabled" : ""}></label>
          <span class="cr-st">${s.custom ? "personalizada" : "padrão"}</span>
          ${ro ? "" : `<span class="cr-acoes"><button type="button" class="btn p ch-mini" data-cr-salvar-setor="${k}" disabled>Salvar</button><button type="button" class="btn g ch-mini" data-cr-padrao-setor="${k}"${s.custom ? "" : " disabled"} title="Voltar para a cor original (${s.padrao})">Restaurar</button></span>`}</li>`;
      }).join("")}</ul>
      ${ro ? "" : `<div class="cr-rodape"><button type="button" class="btn g" data-cr-padrao-todos${Object.values(S).some((s) => s.custom) ? "" : " disabled"}>Restaurar todas as cores padrão</button></div>`}`;
    return;
  }
  const E = estado.equipes, nova = M.sugerirCor(E);
  const linha = (e) => `<li class="cr-row cr-eq${e.ativo ? "" : " off"}" data-equipe="${esc(e.id)}"><span class="cr-prev cr-prev-eq" style="background:${e.cor};border-color:${e.borda};color:${e.texto}"><i>${esc(e.sigla)}</i>${esc(e.grupo)} · ${esc(e.nome)}</span>
      <label class="cr-cor"><input type="color" value="${e.cor}" data-cr-cor aria-label="Cor de ${esc(e.nome)}"${ro ? " disabled" : ""}></label>
      ${ro ? `<span class="cr-st">${e.ativo ? "ativa" : "desativada"}</span>` : `<span class="cr-campos"><input class="cr-in s" data-cr-sigla value="${esc(e.sigla)}" maxlength="2" aria-label="Sigla"><input class="cr-in g" data-cr-grupo value="${esc(e.grupo)}" maxlength="30" aria-label="Equipe"><input class="cr-in n" data-cr-nome value="${esc(e.nome)}" maxlength="60" aria-label="Responsável">
        <label class="cr-ativo"><input type="checkbox" data-cr-ativo${e.ativo ? " checked" : ""}> ativa</label></span>
        <span class="cr-acoes"><button type="button" class="btn p ch-mini" data-cr-salvar-equipe="${esc(e.id)}" disabled>Salvar</button><button type="button" class="btn g ch-mini" data-cr-padrao-equipe="${esc(e.id)}"${e.cor === e.corPadrao ? " disabled" : ""} title="Voltar para a cor padrão (${e.corPadrao})">Cor padrão</button></span>`}</li>`;
  body.innerHTML = `${leitura}<p class="cr-nota">Equipes e profissionais da <b>Execução M.O.</b> A cor pinta os apartamentos no mapa da Revistoria e da Execução M.O. Cada equipe tem um identificador fixo: renomear mantém a cor e as unidades; desativar preserva o histórico (não pode ser escolhida para novas unidades).</p>
    <ul class="cr-list">${E.map(linha).join("")}</ul>
    ${ro ? "" : `<div class="cr-nova"><b>Nova equipe</b><span class="cr-prev cr-prev-eq" id="crNovaPrev" style="background:${nova};border-color:${M.estilo(nova).borda};color:${M.estilo(nova).texto}"><i>?</i>Equipe · Nome</span>
      <label class="cr-cor"><input type="color" value="${nova}" id="crNovaCor" aria-label="Cor da nova equipe"></label>
      <span class="cr-campos"><input class="cr-in s" id="crNovaSigla" maxlength="2" placeholder="Sigla" aria-label="Sigla"><input class="cr-in g" id="crNovaGrupo" maxlength="30" placeholder="Equipe (ex.: M.O.P)" aria-label="Equipe"><input class="cr-in n" id="crNovaNome" maxlength="60" placeholder="Responsável" aria-label="Responsável"></span>
      <button type="button" class="btn p ch-mini" data-cr-nova>Adicionar equipe</button></div>`}
    ${secaoLegendasExecucao(ro)}`;
}
/** Legendas do mapa e botões de status da Execução M.O. (categoria execucao_mapa): uma linha por item, sem exceção. */
function secaoLegendasExecucao(ro) {
  const L = estado.execucao;
  const linha = (k) => {
    const x = L[k], st = k === "liberado" ? `<i class="cr-lib">✓</i>` : "";
    return `<li class="cr-row" data-legexec="${k}"><span class="cr-prev" style="background:${x.cor};border-color:${x.borda};color:${x.texto}">${st}${esc(x.label)}</span>
      <label class="cr-cor"><input type="color" value="${x.cor}" data-cr-cor aria-label="Cor de ${esc(x.label)}"${ro ? " disabled" : ""}></label>
      <span class="cr-st">${x.custom ? "personalizada" : "padrão"}</span>
      ${ro ? "" : `<span class="cr-acoes"><button type="button" class="btn p ch-mini" data-cr-salvar-legexec="${k}" disabled>Salvar</button><button type="button" class="btn g ch-mini" data-cr-padrao-legexec="${k}"${x.custom ? "" : " disabled"} title="Voltar para a cor original (${x.padrao})">Restaurar</button></span>`}</li>`;
  };
  const grupo = (g) => Object.keys(L).filter((k) => L[k].grupo === g).map(linha).join("");
  return `<h4 class="cr-sub">Situação da Execução M.O.</h4>
    <p class="cr-nota">Cores dos três status da mão de obra (filtros, listas, painel e Revistoria · Cliente): A Executar (sem equipe), Em Andamento (equipe vinculada, ainda não liberado) e Liberado. No mapa da Execução M.O. o apartamento fica na cor da equipe (cores abaixo). A marca da chave (canto esquerdo) usa as cores dos setores do Controle de Chaves (aba A).</p>
    <ul class="cr-list">${grupo("status")}</ul>
    <h4 class="cr-sub">Outras cores do mapa da Execução M.O.</h4>
    <ul class="cr-list">${grupo("mapa")}</ul>
    ${ro ? "" : `<div class="cr-rodape"><button type="button" class="btn g" data-cr-padrao-legexec-todos${Object.values(L).some((x) => x.custom) ? "" : " disabled"}>Restaurar as cores padrão das legendas da M.O.</button></div>`}`;
}
/** Prévia ao vivo, antes de salvar. */
function previa(e) {
  const row = e.target.closest(".cr-row"), nova = e.target.closest(".cr-nova");
  if (row) {
    const cor = row.querySelector("[data-cr-cor]").value, st = M.estilo(cor), pv = row.querySelector(".cr-prev");
    pv.style.background = st.cor; pv.style.borderColor = st.borda; pv.style.color = st.texto;
    if (row.dataset.equipe) {
      const s = row.querySelector("[data-cr-sigla]"), g = row.querySelector("[data-cr-grupo]"), n = row.querySelector("[data-cr-nome]");
      if (s) pv.innerHTML = `<i>${esc(s.value.toUpperCase() || "?")}</i>${esc(g.value)} · ${esc(n.value)}`;
      const atual = estado.equipes.find((x) => x.id === row.dataset.equipe);
      const mudou = !atual || cor !== atual.cor || (s && (s.value.trim().toUpperCase() !== atual.sigla || g.value.trim() !== atual.grupo || n.value.trim() !== atual.nome || row.querySelector("[data-cr-ativo]").checked !== atual.ativo));
      const b = row.querySelector("[data-cr-salvar-equipe]"); if (b) b.disabled = !mudou;
    } else if (row.dataset.legexec) {
      const b = row.querySelector("[data-cr-salvar-legexec]"); if (b) b.disabled = cor === estado.execucao[row.dataset.legexec].cor;
    } else {
      const b = row.querySelector("[data-cr-salvar-setor]"); if (b) b.disabled = cor === estado.setores[row.dataset.setor].cor;
    }
    return;
  }
  if (nova) {
    const cor = ov.querySelector("#crNovaCor").value, st = M.estilo(cor), pv = ov.querySelector("#crNovaPrev");
    pv.style.background = st.cor; pv.style.borderColor = st.borda; pv.style.color = st.texto;
    pv.innerHTML = `<i>${esc(ov.querySelector("#crNovaSigla").value.toUpperCase() || "?")}</i>${esc(ov.querySelector("#crNovaGrupo").value || "Equipe")} · ${esc(ov.querySelector("#crNovaNome").value || "Nome")}`;
  }
}
async function executar(fn, ok) {
  aviso("Salvando…", "info");
  try { await fn(); await carregar(); aviso(ok, "ok"); }
  catch (err) { aviso(err.message || "Não foi possível salvar.", "err"); }
}
function clique(e) {
  const t = e.target;
  if (t === ov || t.closest("[data-cr-fechar]")) { fechar(); return; }
  const ab = t.closest("[data-cr-aba]"); if (ab) { ctx.aba = ab.dataset.crAba; aviso(""); pintarEditor(); return; }
  if (!ctx.admin) return;
  const ss = t.closest("[data-cr-salvar-setor]");
  if (ss) { const k = ss.dataset.crSalvarSetor, cor = ov.querySelector(`[data-setor="${k}"] [data-cr-cor]`).value; executar(() => rpc("cores_legenda_salvar", { p_categoria: M.CATEGORIA_SETOR, p_chave: k, p_cor: cor }), `Cor de ${ctx.rotulos[k] || k} salva`); return; }
  const ps = t.closest("[data-cr-padrao-setor]");
  if (ps) { const k = ps.dataset.crPadraoSetor; executar(() => rpc("cores_legenda_restaurar", { p_categoria: M.CATEGORIA_SETOR, p_chave: k }), `${ctx.rotulos[k] || k}: cor original restaurada`); return; }
  if (t.closest("[data-cr-padrao-todos]")) {
    if (!confirm("Restaurar as cores padrão de todos os setores? As cores personalizadas serão descartadas (as equipes e as legendas da M.O. não mudam).")) return;
    executar(() => rpc("cores_legenda_restaurar", { p_categoria: M.CATEGORIA_SETOR, p_chave: null }), "Cores padrão restauradas"); return;
  }
  const sl = t.closest("[data-cr-salvar-legexec]");
  if (sl) { const k = sl.dataset.crSalvarLegexec, cor = ov.querySelector(`[data-legexec="${k}"] [data-cr-cor]`).value; executar(() => rpc("cores_legenda_salvar", { p_categoria: M.CATEGORIA_EXECUCAO, p_chave: k, p_cor: cor }), `Cor de ${estado.execucao[k].label} salva`); return; }
  const pl = t.closest("[data-cr-padrao-legexec]");
  if (pl) { const k = pl.dataset.crPadraoLegexec; executar(() => rpc("cores_legenda_restaurar", { p_categoria: M.CATEGORIA_EXECUCAO, p_chave: k }), `${estado.execucao[k].label}: cor original restaurada`); return; }
  if (t.closest("[data-cr-padrao-legexec-todos]")) {
    if (!confirm("Restaurar as cores padrão das legendas da Execução M.O.? As equipes e os setores do Controle de Chaves não mudam.")) return;
    executar(() => rpc("cores_legenda_restaurar", { p_categoria: M.CATEGORIA_EXECUCAO, p_chave: null }), "Cores padrão das legendas da M.O. restauradas"); return;
  }
  const se = t.closest("[data-cr-salvar-equipe]");
  if (se) {
    const row = se.closest(".cr-row"), v = { cor: row.querySelector("[data-cr-cor]").value, sigla: row.querySelector("[data-cr-sigla]").value.trim(), grupo: row.querySelector("[data-cr-grupo]").value, nome: row.querySelector("[data-cr-nome]").value, ativo: row.querySelector("[data-cr-ativo]").checked };
    const erro = M.validarEquipe(v); if (erro) { aviso(erro, "err"); return; }
    executar(() => rpc("equipe_execucao_salvar", { p_id: se.dataset.crSalvarEquipe, p_grupo: v.grupo, p_nome: v.nome, p_sigla: v.sigla, p_cor: v.cor, p_ativo: v.ativo }), "Equipe salva"); return;
  }
  const pe = t.closest("[data-cr-padrao-equipe]");
  if (pe) { executar(() => rpc("equipe_execucao_restaurar_cor", { p_id: pe.dataset.crPadraoEquipe }), "Cor padrão da equipe restaurada"); return; }
  if (t.closest("[data-cr-nova]")) {
    const v = { cor: ov.querySelector("#crNovaCor").value, sigla: ov.querySelector("#crNovaSigla").value.trim(), grupo: ov.querySelector("#crNovaGrupo").value, nome: ov.querySelector("#crNovaNome").value, ativo: true };
    const erro = M.validarEquipe(v); if (erro) { aviso(erro, "err"); return; }
    executar(() => rpc("equipe_execucao_salvar", { p_id: null, p_grupo: v.grupo, p_nome: v.nome, p_sigla: v.sigla, p_cor: v.cor, p_ativo: true }), "Equipe adicionada");
  }
}

/* ── API ── */
const api = {
  M,
  /** Começa a carregar e a acompanhar as cores (chamado depois do login). */
  iniciar(cliente) {
    if (!cliente) return;
    if (sb === cliente && canal) { carregar(); return; }
    sb = cliente;
    try { canal?.unsubscribe?.(); } catch { /* sem tempo real */ }
    try {
      canal = sb.channel("amci-cores")
        .on("postgres_changes", { event: "*", schema: "public", table: "cores_legendas" }, agendar)
        .on("postgres_changes", { event: "*", schema: "public", table: "equipes_execucao" }, agendar)
        .subscribe();
    } catch { canal = null; }
    carregar();
  },
  recarregar: carregar,
  /** Estado atual: { carregado, instalado, setores: {chave: {cor,borda,texto,custom,padrao}}, equipes: [...],
   *  execucao: {item: {label,grupo,cor,borda,texto,custom,padrao}} }. */
  get: () => estado,
  /** Avisa quando as cores mudarem; devolve a função para parar de ouvir. */
  on(fn) { ouvintes.add(fn); return () => ouvintes.delete(fn); },
  /** Editor: aba "setores" (A) ou "equipes" (B). rotulos = nomes dos setores (do Controle de Chaves). */
  abrirEditor({ admin = false, aba = "setores", rotulos = {} } = {}) {
    garantirEditor(); ctx = { admin, aba, rotulos }; aviso("");
    ov.classList.add("open"); document.body.classList.add("cr-aberto"); pintarEditor();
    if (sb) carregar();
  },
  fechar,
  reset() { try { canal?.unsubscribe?.(); } catch { /* sem tempo real */ } canal = null; sb = null; fechar(); estado = vazio(); avisar(); }
};
window.AmciCores = api;
export default api;
