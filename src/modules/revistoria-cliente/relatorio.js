// Leitura do "Relatório de Entrega da Unidade" (PDF gerado pelo sistema da construtora, JasperReports):
// extrai a unidade, a data realizada, o nº de não conformidades, o responsável e os APONTAMENTOS
// (itens do checklist com resposta "Reprovado", com ambiente, descrição, observação e nº da não
// conformidade). Regras puras: recebe o texto já lido do PDF (pdf.js getTextContent) com as posições.
//
//   páginas: [{ itens: [{ str, x, y, w }] }]   (x/y em pontos, y cresce para cima, como no PDF)
//
// Colunas do checklist (cabeçalho "Nr · Situação · Data de Inspeção · Descrição · Resposta · Observação")
// são localizadas pela posição do cabeçalho; o texto quebrado em várias linhas é juntado por coluna.
// Nada aqui altera o PDF: o resultado só sugere os itens do checklist, que o usuário confere antes de salvar.

const TOL = 3.5;
const limpa = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
const norm = (s) => limpa(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Agrupa os itens de uma página em linhas (de cima para baixo), cada uma com os itens da esquerda para a direita. */
export function linhas(itens) {
  const ord = [...itens].filter((i) => limpa(i.str)).sort((a, b) => b.y - a.y || a.x - b.x);
  const out = [];
  for (const it of ord) {
    const l = out.find((x) => Math.abs(x.y - it.y) <= TOL);
    if (l) l.itens.push(it); else out.push({ y: it.y, itens: [it] });
  }
  out.forEach((l) => l.itens.sort((a, b) => a.x - b.x));
  out.sort((a, b) => b.y - a.y);
  return out.map((l) => ({ y: l.y, itens: l.itens, texto: limpa(l.itens.map((i) => i.str).join(" ")) }));
}

const RESPOSTAS = /^(reprovado|aprovado|nao se aplica|n\/a|conforme|nao conforme)$/;
const RODAPE = /^(gerado:|relatorio de entrega da unidade$|bl [a-z0-9]+ - apt)/;

/**
 * Extrai o relatório. Retorna { unidade: {bloco, apto, texto}, realizado: "AAAA-MM-DD", hora, naoConformidades,
 * responsavel, apontamentos: [{ambiente, item, observacao, nc, texto}] }.
 */
export function extrair(paginas) {
  const res = { unidade: null, realizado: "", hora: "", naoConformidades: null, responsavel: "", apontamentos: [] };
  const col = { desc: 161, resp: 392, obs: 490 };
  let ambiente = "", anterior = "", atual = null, nc = null, ultimoReprovado = null;
  const fechaItem = () => {
    if (atual && atual.resposta === "reprovado") {
      const ap = { ambiente, item: limpa(atual.desc), observacao: limpa(atual.obs), nc: null };
      res.apontamentos.push(ap); ultimoReprovado = ap;
    }
    atual = null;
  };
  const fechaNc = () => {
    if (!nc) return;
    const alvo = nc.alvo;
    if (alvo) {
      alvo.nc = nc.numero;
      if (!alvo.observacao) {
        let t = limpa(nc.desc.join(" "));
        t = t.replace(/^n[aã]o conformidade criada automaticamente a partir do item .*?, do formul[aá]rio .*?cliente\.?/i, "").trim();
        if (alvo.ambiente) t = t.replace(new RegExp("^localizado na\\s+" + alvo.ambiente.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"), "").trim();
        t = t.replace(/^localizado na\s+/i, "").trim();
        alvo.observacao = t;
      }
    }
    nc = null;
  };
  for (const pg of paginas || []) {
    const ls = linhas(pg.itens || []);
    ls.forEach((l, idx) => {
      const n = norm(l.texto);
      // Cabeçalho do relatório e dados gerais
      if (!res.unidade) {
        const m = /\bbl\s*([a-z0-9]{1,3})\s*-\s*apt?o?\s*(t?\d{1,5})\b/i.exec(l.texto);
        if (m) res.unidade = { bloco: m[1].toUpperCase(), apto: m[2].toUpperCase(), texto: `BL ${m[1].toUpperCase()} - APT ${m[2].toUpperCase()}` };
      }
      const mr = /^realizado\s+(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}:\d{2})/i.exec(l.texto);
      if (mr) { res.realizado = `${mr[3]}-${mr[2]}-${mr[1]}`; res.hora = mr[4]; }
      const mn = /n[aã]o conformidades\s+(\d+)/i.exec(l.texto);
      if (mn && !/^n[aã]o conformidade \d/i.test(l.texto)) res.naoConformidades = Number(mn[1]);
      if (RODAPE.test(n)) return;
      // Cabeçalho de colunas do checklist
      if (/^nr\b/.test(n) && /descri/.test(n) && /resposta/.test(n)) {
        for (const it of l.itens) {
          const t = norm(it.str);
          if (t.startsWith("descri")) col.desc = it.x;
          else if (t.startsWith("resposta")) col.resp = it.x;
          else if (t.startsWith("observa")) col.obs = it.x;
        }
        return;
      }
      // Ambiente: a linha logo acima de "Vistoria do Cliente | CHECKLIST ..."
      if (/\|\s*checklist/.test(n)) { fechaItem(); fechaNc(); ambiente = anterior; return; }
      // Não conformidade (vinculada ao último item reprovado)
      const mnc = /^n[aã]o conformidade\s+(\d+)$/i.exec(l.texto);
      if (mnc) { fechaItem(); fechaNc(); nc = { numero: Number(mnc[1]), desc: [], lendo: false, alvo: ultimoReprovado }; anterior = l.texto; return; }
      if (nc) {
        if (/^resumo das a[cç][oõ]es/.test(n)) { fechaNc(); anterior = l.texto; return; }
        if (n === "descricao") { nc.lendo = true; return; }
        if (nc.lendo) nc.desc.push(l.texto);
        return;
      }
      // Linha de item: número na coluna Nr + data
      const primeiro = l.itens[0];
      if (primeiro && /^\d{1,3}$/.test(limpa(primeiro.str)) && primeiro.x < col.desc - 20 && /\d{2}\/\d{2}\/\d{4}/.test(l.texto)) {
        fechaItem();
        atual = { desc: "", resposta: "", obs: "" };
        for (const it of l.itens) {
          if (it.x >= col.obs - 4) atual.obs += " " + it.str;
          else if (it.x >= col.resp - 4) atual.resposta = norm(it.str);
          else if (it.x >= col.desc - 4) atual.desc += " " + it.str;
        }
        anterior = l.texto; return;
      }
      // Continuação do item (texto quebrado nas colunas Descrição/Observação)
      if (atual && l.itens.every((it) => it.x >= col.desc - 4)) {
        for (const it of l.itens) {
          if (it.x >= col.obs - 4) atual.obs += " " + it.str;
          else if (it.x < col.resp - 4) atual.desc += " " + it.str;
        }
        return;
      }
      if (atual && !RESPOSTAS.test(n)) fechaItem();
      // Responsável (assinatura do termo): nome logo acima do rótulo "Responsável"
      const rot = !res.responsavel && l.itens.find((i) => norm(i.str) === "responsavel");
      if (rot) {
        const cx = rot.x + (rot.w || 40) / 2;
        const cand = ls.slice(Math.max(0, idx - 3), idx).flatMap((x) => x.itens)
          .filter((i) => i.y > rot.y + 4 && i.y < rot.y + 22 && !/\d{2}\/\d{2}\/\d{4}/.test(i.str))
          .sort((a, b) => Math.abs(a.x + (a.w || 0) / 2 - cx) - Math.abs(b.x + (b.w || 0) / 2 - cx));
        if (cand[0]) res.responsavel = limpa(cand[0].str);
      }
      anterior = l.texto;
    });
  }
  fechaItem(); fechaNc();
  res.apontamentos.forEach((a, i) => {
    a.texto = limpa(`${a.ambiente ? a.ambiente + " · " : ""}${a.item}${a.observacao ? ": " + a.observacao : ""}${a.nc ? ` (NC ${a.nc})` : ""}`).slice(0, 600) || `Apontamento ${i + 1}`;
  });
  return res;
}

/** Código do apartamento comparável: pavimento + número, térreo (T) = 0 (T03 → 3, 507 → 507), como na planilha. */
export const codigoComparavel = (x) => {
  const s = String(x ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/^T/, "0");
  return /^\d+$/.test(s) ? String(Number(s)) : s;
};
/** Confere se o relatório é da unidade (bloco e apto, ex.: BL A - APT 507 × Bloco A, apto 507). */
export function mesmaUnidade(unidadePdf, bloco, codigo) {
  if (!unidadePdf) return null;
  return String(unidadePdf.bloco).toUpperCase() === String(bloco).toUpperCase() && codigoComparavel(unidadePdf.apto) === codigoComparavel(codigo);
}
/** Unidade pelo nome do arquivo (ex.: "BL_A_-_APT_507_RelatorioEntregaUnidade.pdf" → { bloco: "A", apto: "507" }). */
export function unidadeDoNome(nome) {
  const s = String(nome || "").replace(/\.pdf$/i, "");
  const m = /(?:^|[^A-Z0-9])(?:BL|BLOCO)[\s_.-]*([A-Z0-9]{1,3})[\s_.-]+(?:APTO|APT|AP)[\s_.-]*(T?\d{1,5})(?![0-9])/i.exec(s);
  return m ? { bloco: m[1].toUpperCase(), apto: m[2].toUpperCase(), texto: `BL ${m[1].toUpperCase()} - APT ${m[2].toUpperCase()}` } : null;
}
/**
 * Unidade de um PDF do lote: pelo nome do arquivo e pelo cabeçalho do PDF.
 * achar(ref) → unidade do condomínio (ou null). Retorna { unidade, situacao, msg }:
 *   ok · divergente (nome e PDF apontam unidades diferentes) · nao_encontrada (não identificada / não existe).
 */
export function decidirUnidade(porNome, porPdf, achar) {
  const un = porNome ? achar(porNome) : null, up = porPdf ? achar(porPdf) : null;
  if (un && up && un !== up) return { unidade: null, situacao: "divergente", msg: `Nome do arquivo: ${porNome.texto} · PDF: ${porPdf.texto}` };
  const u = up || un;
  if (u) return { unidade: u, situacao: "ok", msg: up && un ? "nome do arquivo e PDF conferem" : up ? "identificada pelo PDF" : "identificada pelo nome do arquivo" };
  const ref = porPdf || porNome;
  return { unidade: null, situacao: "nao_encontrada", msg: ref ? `${ref.texto} não existe neste condomínio` : "unidade não identificada no nome nem no PDF" };
}
