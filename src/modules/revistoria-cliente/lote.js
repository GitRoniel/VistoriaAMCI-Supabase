// Relatórios em lote (aba Revistoria · Cliente): envia muitos PDFs de uma vez, cada um para a sua unidade.
//
// 1) Escolher os PDFs (ou a pasta) no computador.
// 2) Conferência, sem gravar nada: cada arquivo é lido no próprio navegador (pdf.js) e a unidade é
//    reconhecida pelo nome do arquivo (ex.: BL_A_-_APT_507_…pdf) e pelo cabeçalho do PDF (BL A - APT 507).
//    Situações: pronto · divergente (nome × PDF) · não identificada · fora da Revistoria · já enviado ·
//    repetido no lote · inválido (não é PDF ou passa de 25 MB). Só os prontos vão marcados; os demais podem
//    ter a unidade escolhida à mão.
// 3) Enviar: um por vez, com progresso, pelo mesmo caminho do envio individual (Storage privado +
//    revistoria_relatorio_registrar). Opcionalmente, os apontamentos lidos entram no checklist: itens que
//    já estão no checklist da unidade não são duplicados e mantêm o registro de resolução.
import * as M from "./model.js";
import * as S from "./service.js";
import { extrair, unidadeDoNome, decidirUnidade, mesmaUnidade, codigoComparavel } from "./relatorio.js";
import { pdfjs, lerTexto, caminhoRelatorio, LIMITE } from "./relatorio-tela.js";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const MB = (n) => (!n ? "" : n < 1048576 ? Math.max(1, Math.round(n / 1024)) + " KB" : (n / 1048576).toFixed(1).replace(".", ",") + " MB");
const SIT = {
  ok: { rot: "Pronto", cls: "ok" },
  divergente: { rot: "Divergência", cls: "warn" },
  nao_encontrada: { rot: "Não identificada", cls: "warn" },
  fora: { rot: "Fora da Revistoria", cls: "mut" },
  ja_enviado: { rot: "Já enviado", cls: "mut" },
  repetido: { rot: "Repetido no lote", cls: "mut" },
  invalido: { rot: "Inválido", cls: "err" }
};

let st = null;
function el() {
  let ov = document.getElementById("rvLoteOv");
  if (!ov) {
    ov = document.createElement("div"); ov.id = "rvLoteOv"; ov.className = "rv-ov"; ov.setAttribute("role", "dialog"); ov.setAttribute("aria-modal", "true");
    ov.innerHTML = `<div class="rv-box lt-box"><div class="rv-head"><div class="rv-tit"><small id="ltKick"></small><strong>Relatórios em lote</strong></div><button type="button" class="pp-icon" data-lt="fechar" aria-label="Fechar">×</button></div><div class="rv-body" id="ltBody"></div></div>`;
    document.body.appendChild(ov);
    ov.addEventListener("click", (e) => { if (e.target === ov) fechar(); else clique(e); });
    ov.addEventListener("change", mudou);
    ov.addEventListener("dragover", (e) => { if (st && !st.enviando) { e.preventDefault(); ov.querySelector(".lt-drop")?.classList.add("on"); } });
    ov.addEventListener("dragleave", () => ov.querySelector(".lt-drop")?.classList.remove("on"));
    ov.addEventListener("drop", (e) => { if (!st || st.enviando) return; e.preventDefault(); escolher([...(e.dataTransfer?.files || [])]); });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && ov.classList.contains("open")) fechar(); });
  }
  return ov;
}

/**
 * Abre o envio em lote.
 * @param ctx { host, unidades: () => [unidade com situacao], aoMudar }
 */
export function abrirLote(ctx) {
  const ov = el();
  st = { ...ctx, itens: [], lendo: null, enviando: null, parar: false, comApontamentos: true, fim: null };
  ov.querySelector("#ltKick").textContent = `${ctx.host.project.name} · Revistoria · Cliente`;
  ov.classList.add("open"); document.body.classList.add("rv-aberto");
  pintar();
}
export function fechar() {
  const ov = document.getElementById("rvLoteOv"); if (!ov?.classList.contains("open")) return;
  if (st?.enviando && !confirm("O envio está em andamento. Interromper depois do arquivo atual e fechar?")) return;
  if (st?.enviando) st.parar = true;
  if (!st?.enviando && st?.itens.some((i) => i.enviar && !i.resultado) && !st.fim && !confirm("Os relatórios conferidos ainda não foram enviados. Fechar mesmo assim?")) return;
  ov.classList.remove("open"); document.body.classList.remove("rv-aberto");
  st = null;
}

/* ── leitura e conferência ── */
async function escolher(arquivos) {
  if (!st || st.lendo || st.enviando) return;
  const pdfs = arquivos.filter((f) => f && f.name);
  if (!pdfs.length) return;
  const me = st;
  st.fim = null; st.lendo = { feitos: 0, total: pdfs.length };
  pintar();
  let existentes = [];
  try { existentes = await S.relatoriosCondominio(st.host.sb, st.host.project.id); } catch { existentes = []; }
  if (st !== me) return;
  const unidades = st.unidades();
  const achar = (ref) => unidades.find((u) => mesmaUnidade(ref, u.b, st.host.casa() ? +u.a : u.codigo)) || null;
  const jaNome = new Set(existentes.map((r) => `${r.unit_id}|${String(r.nome_arquivo || "").toLowerCase()}`));
  const vistos = new Set(st.itens.map((i) => `${i.nome.toLowerCase()}|${i.tamanho}`));
  for (const arq of pdfs) {
    if (st !== me) return;
    const it = { arq, nome: arq.name, tamanho: arq.size, porNome: unidadeDoNome(arq.name), porPdf: null, unidade: null, situacao: "", msg: "", aps: [], resumo: {}, paginas: null, enviar: false, resultado: null };
    const chave = `${arq.name.toLowerCase()}|${arq.size}`;
    if (!/\.pdf$/i.test(arq.name) && arq.type !== "application/pdf") { it.situacao = "invalido"; it.msg = "não é um arquivo PDF"; }
    else if (arq.size > LIMITE) { it.situacao = "invalido"; it.msg = `arquivo grande demais (${MB(arq.size)}; máximo de 25 MB)`; }
    else if (vistos.has(chave)) { it.situacao = "repetido"; it.msg = "o mesmo arquivo foi escolhido mais de uma vez"; }
    else {
      vistos.add(chave);
      try {
        const lib = await pdfjs();
        const doc = await lib.getDocument({ data: new Uint8Array(await arq.arrayBuffer()), isEvalSupported: false }).promise;
        it.paginas = doc.numPages;
        const r = extrair(await lerTexto(doc)); doc.destroy();
        it.porPdf = r.unidade; it.aps = r.apontamentos.map((a) => a.texto);
        it.resumo = { unidade: r.unidade?.texto || "", realizado: r.realizado, hora: r.hora, naoConformidades: r.naoConformidades, responsavel: r.responsavel };
      } catch (err) { console.warn("Lote: PDF não lido", arq.name, err); it.msg = "conteúdo do PDF não lido (os apontamentos não serão importados)"; }
      const d = decidirUnidade(it.porNome, it.porPdf, achar);
      it.unidade = d.unidade; it.situacao = d.situacao; it.msg = [d.msg, it.msg].filter(Boolean).join(" · ");
      avaliar(it, jaNome);
    }
    st.itens.push(it);
    st.lendo.feitos++; pintarProgresso();
  }
  if (st !== me) return;
  st.lendo = null; st.jaNome = jaNome;
  pintar();
}
/** Situação final depois de identificar a unidade (automática ou escolhida à mão). */
function avaliar(it, jaNome) {
  if (!it.unidade) { it.enviar = false; return; }
  if (!it.unidade.situacao?.status) { it.situacao = "fora"; it.msg = "a unidade não está na Revistoria · Cliente (o status da vistoria precisa ser Revistoria)"; it.enviar = false; return; }
  if (jaNome?.has(`${it.unidade.unitId}|${it.nome.toLowerCase()}`)) { it.situacao = "ja_enviado"; it.msg = "um relatório com este nome já foi enviado para esta unidade"; it.enviar = false; return; }
  if (it.situacao !== "ok") { it.situacao = "ok"; }
  it.enviar = true;
}

/* ── tela ── */
let ordenadas = null;
/** Unidades da Revistoria para a escolha à mão: bloco e número em ordem crescente (calculado uma vez por pintura). */
function unidadesOrdenadas() {
  if (ordenadas) return ordenadas;
  const num = (u) => Number(codigoComparavel(st.host.casa() ? +u.a : u.codigo)) || 0;
  ordenadas = st.unidades().filter((u) => u.situacao.status).sort((x, y) => String(x.b).localeCompare(String(y.b), "pt-BR", { numeric: true }) || num(x) - num(y));
  queueMicrotask(() => { ordenadas = null; });
  return ordenadas;
}
const rotulo = (st0, u) => (st0.host.casa() ? `Conj. ${u.b} · Casa ${+u.a}` : `Bloco ${u.b} · ${u.codigo}`);
function contagem() {
  const c = Object.fromEntries(Object.keys(SIT).map((k) => [k, 0]));
  st.itens.forEach((i) => { c[i.situacao] = (c[i.situacao] || 0) + 1; });
  return c;
}
function pintarProgresso() {
  const b = document.querySelector("#ltBody .lt-prog"); if (!b || !st) return;
  const p = st.lendo || st.enviando; if (!p) return;
  b.querySelector("i").style.width = `${Math.round((p.feitos / Math.max(1, p.total)) * 100)}%`;
  b.querySelector("span").textContent = st.lendo ? `Lendo ${p.feitos} de ${p.total} arquivo(s)…` : `Enviando ${p.feitos} de ${p.total}…${p.erros ? ` · ${p.erros} com erro` : ""}`;
}
function pintar() {
  const b = document.getElementById("ltBody"); if (!b || !st) return;
  const ocupado = !!(st.lendo || st.enviando);
  const escolha = `<div class="lt-drop${ocupado ? " off" : ""}">
      <b>Escolha os PDFs dos relatórios</b>
      <span>Selecione todos de uma vez (Ctrl+A ou ⌘+A na janela de arquivos) ou arraste-os para cá. A unidade é reconhecida pelo nome do arquivo (ex.: <code>BL_A_-_APT_507_RelatorioEntregaUnidade.pdf</code>) e pelo cabeçalho do PDF. Nada é gravado antes da sua confirmação.</span>
      <div class="lt-pick"><label class="btn p${ocupado ? " disabled" : ""}"><input type="file" accept="application/pdf,.pdf" multiple data-lt="arquivos" hidden ${ocupado ? "disabled" : ""}>Escolher PDFs</label>
      <label class="btn g${ocupado ? " disabled" : ""}"><input type="file" webkitdirectory multiple data-lt="arquivos" hidden ${ocupado ? "disabled" : ""}>Escolher pasta</label></div></div>`;
  const prog = ocupado ? `<div class="lt-prog"><div><i style="width:0%"></i></div><span></span></div>` : "";
  if (!st.itens.length) { b.innerHTML = escolha + prog; pintarProgresso(); return; }
  const c = contagem(), marcados = st.itens.filter((i) => i.enviar && !i.resultado?.ok);
  const enviados = st.itens.filter((i) => i.resultado?.ok).length, erros = st.itens.filter((i) => i.resultado && !i.resultado.ok).length;
  const opcoes = (it) => {
    const us = unidadesOrdenadas();
    return `<select data-lt-un="${st.itens.indexOf(it)}" aria-label="Escolher a unidade"><option value="">Escolher unidade…</option>${us.map((u) => `<option value="${u.unitId}"${it.unidade?.unitId === u.unitId ? " selected" : ""}>${esc(rotulo(st, u))}</option>`).join("")}</select>`;
  };
  const linha = (it, i) => {
    const s = SIT[it.situacao] || SIT.invalido, r = it.resultado;
    const editar = !r?.ok && !st.enviando && ["divergente", "nao_encontrada"].includes(it.situacao);
    const status = r ? (r.ok ? `<span class="lt-st ok">Enviado${r.aps ? ` · ${r.aps} apont.` : ""}${r.pulados ? ` · ${r.pulados} já existia(m)` : ""}</span>` : `<span class="lt-st err" title="${esc(r.erro)}">Erro: ${esc(r.erro)}</span>`)
      : `<span class="lt-st ${s.cls}">${s.rot}</span>`;
    return `<tr class="${r?.ok ? "lt-feito" : ""}">
      <td class="lt-c-ch"><input type="checkbox" data-lt-i="${i}" ${it.enviar ? "checked" : ""} ${!it.unidade || r?.ok || st.enviando || ["fora", "invalido"].includes(it.situacao) ? "disabled" : ""} aria-label="Enviar ${esc(it.nome)}"></td>
      <td class="lt-c-arq"><b title="${esc(it.nome)}">${esc(it.nome)}</b><small>${esc([MB(it.tamanho), it.paginas ? `${it.paginas} pág.` : ""].filter(Boolean).join(" · "))}</small></td>
      <td class="lt-c-un">${it.unidade ? `<b>${esc(rotulo(st, it.unidade))}</b>` : ""}${editar ? opcoes(it) : ""}${it.msg ? `<small>${esc(it.msg)}</small>` : ""}</td>
      <td class="lt-c-ap">${it.aps.length || (it.paginas ? "0" : "—")}</td>
      <td class="lt-c-st">${status}</td></tr>`;
  };
  const resumo = `<div class="lt-sum">${Object.entries(SIT).filter(([k]) => c[k]).map(([k, s]) => `<span class="lt-st ${s.cls}">${s.rot}: <b>${c[k]}</b></span>`).join("")}${enviados ? `<span class="lt-st ok">Enviados: <b>${enviados}</b></span>` : ""}${erros ? `<span class="lt-st err">Com erro: <b>${erros}</b></span>` : ""}</div>`;
  const acoes = st.enviando ? `<div class="lt-acts"><button type="button" class="btn g" data-lt="parar">Interromper depois do arquivo atual</button></div>`
    : `<div class="lt-acts">
        <label class="lt-opt"><input type="checkbox" data-lt="aps" ${st.comApontamentos ? "checked" : ""}> Adicionar ao checklist os apontamentos lidos de cada PDF <small>(itens que já estão no checklist da unidade não são duplicados e mantêm o registro de resolução)</small></label>
        <span class="lt-sp"></span>
        <button type="button" class="btn g" data-lt="limpar">Recomeçar</button>
        ${erros ? `<button type="button" class="btn g" data-lt="refazer">Tentar de novo os ${erros} com erro</button>` : ""}
        <button type="button" class="btn p" data-lt="enviar" ${marcados.length && !st.lendo ? "" : "disabled"}>Enviar ${marcados.length} relatório(s)</button></div>`;
  const fim = st.fim ? `<div class="lt-fim"><b>${esc(st.fim)}</b><span>Os relatórios aparecem no botão Relatório de cada unidade e os quantitativos na Lista. Cada envio fica registrado no histórico da unidade com data, hora e usuário.</span></div>` : "";
  b.innerHTML = `${st.enviando ? "" : escolha}${prog}${fim}${resumo}
    <div class="lt-tw"><table class="lt-tbl"><thead><tr><th></th><th>Arquivo</th><th>Unidade</th><th title="Apontamentos lidos do PDF">Apont.</th><th>Situação</th></tr></thead><tbody>${st.itens.map(linha).join("")}</tbody></table></div>
    ${acoes}`;
  pintarProgresso();
}

/* ── envio ── */
async function enviarTodos(lista) {
  if (!st || st.enviando || !lista.length) return;
  const me = st, host = st.host, sb = host.sb;
  if (!confirm(`Enviar ${lista.length} relatório(s)?${st.comApontamentos ? " Os apontamentos lidos entram no checklist de cada unidade (sem duplicar os que já existem)." : ""}`)) return;
  st.fim = null; st.parar = false; st.enviando = { feitos: 0, total: lista.length, erros: 0 };
  pintar();
  let ok = 0, comAps = 0;
  for (const it of lista) {
    if (st !== me || st.parar) break;
    const u = it.unidade;
    try {
      const r = await S.enviarRelatorio(sb, { unitId: u.unitId, caminho: caminhoRelatorio(host, u, it.nome), arquivo: it.arq, nome: it.nome.slice(0, 200), tamanho: it.tamanho, paginas: it.paginas, resumo: it.resumo });
      it.resultado = { ok: true, aps: 0, pulados: 0 };
      if (st.comApontamentos && it.aps.length && r?.relatorio?.id && !r.repetido) {
        const [rels, aps] = await Promise.all([S.relatorios(sb, u.unitId), S.apontamentosUnidade(sb, u.unitId)]);
        const conf = M.conferirExtraidos(it.aps, M.checklistUnidade(aps, rels)), novos = conf.filter((x) => x.usar).map((x) => x.texto);
        if (novos.length) await S.adicionarApontamentos(sb, r.relatorio.id, novos);
        it.resultado.aps = novos.length; it.resultado.pulados = it.aps.length - novos.length;
        if (novos.length) comAps++;
      }
      it.enviar = false; ok++;
      st.jaNome?.add(`${u.unitId}|${it.nome.toLowerCase()}`);
    } catch (err) {
      it.resultado = { ok: false, erro: err?.message || "não foi possível enviar" };
      if (st === me) st.enviando.erros++;
    }
    if (st !== me) return;
    st.enviando.feitos++; pintarProgresso();
    const linha = document.querySelectorAll("#ltBody .lt-tbl tbody tr")[st.itens.indexOf(it)];
    if (linha) linha.querySelector(".lt-c-st").innerHTML = it.resultado.ok ? `<span class="lt-st ok">Enviado</span>` : `<span class="lt-st err">Erro</span>`;
  }
  if (st !== me) return;
  const parado = st.parar && st.enviando.feitos < lista.length;
  st.fim = `${ok} relatório(s) enviado(s)${comAps ? ` · apontamentos no checklist de ${comAps} unidade(s)` : ""}${st.enviando.erros ? ` · ${st.enviando.erros} com erro` : ""}${parado ? " · envio interrompido" : ""}.`;
  st.enviando = null; st.parar = false;
  host.toast?.(st.fim);
  try { st.aoMudar?.(); } catch { /* lista fechada */ }
  pintar();
}

/* ── ações ── */
function clique(e) {
  if (!st) return;
  const t = e.target.closest("[data-lt]"); if (!t || t.tagName === "INPUT") return;
  const a = t.dataset.lt;
  if (a === "fechar") return fechar();
  if (a === "parar") { st.parar = true; t.disabled = true; t.textContent = "Interrompendo…"; return; }
  if (a === "limpar") { if (st.itens.some((i) => i.enviar) && !st.fim && !confirm("Descartar a conferência atual?")) return; st.itens = []; st.fim = null; pintar(); return; }
  if (a === "enviar") return enviarTodos(st.itens.filter((i) => i.enviar && i.unidade && !i.resultado?.ok));
  if (a === "refazer") { const l = st.itens.filter((i) => i.resultado && !i.resultado.ok); l.forEach((i) => { i.resultado = null; i.enviar = true; }); return enviarTodos(l); }
}
function mudou(e) {
  if (!st) return;
  const t = e.target;
  if (t.dataset.lt === "arquivos") {
    // pasta: só os PDFs (a pasta pode ter outros arquivos); seleção direta: tudo, para avisar o que não é PDF
    const pasta = t.hasAttribute("webkitdirectory");
    const fs = [...(t.files || [])].filter((f) => !pasta || /\.pdf$/i.test(f.name)); t.value = ""; escolher(fs); return;
  }
  if (t.dataset.lt === "aps") { st.comApontamentos = t.checked; return; }
  if (t.dataset.ltI != null) { const it = st.itens[Number(t.dataset.ltI)]; if (it) it.enviar = t.checked; pintarBotao(); return; }
  if (t.dataset.ltUn != null) {
    const it = st.itens[Number(t.dataset.ltUn)]; if (!it) return;
    const u = st.unidades().find((x) => String(x.unitId) === t.value) || null;
    it.unidade = u; it.situacao = u ? "ok" : it.porNome || it.porPdf ? "divergente" : "nao_encontrada";
    it.msg = u ? "unidade escolhida à mão" : it.msg;
    if (u) avaliar(it, st.jaNome); else it.enviar = false;
    pintar();
  }
}
function pintarBotao() {
  const b = document.querySelector('#ltBody [data-lt="enviar"]'); if (!b) return;
  const n = st.itens.filter((i) => i.enviar && i.unidade && !i.resultado?.ok).length;
  b.textContent = `Enviar ${n} relatório(s)`; b.disabled = !n;
}
