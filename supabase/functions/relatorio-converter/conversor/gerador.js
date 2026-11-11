// Gerador do relatório compacto (A4 paisagem), no layout do modelo "Relatório Final de Vistoria":
//   • páginas de evidências: cabeçalho (obra, bloco, unidade, data, responsável, total de NCs), fotos agrupadas por
//     ambiente, 3 por linha, cada foto com NC / Ambiente / Serviço / Problema;
//   • resumo final: totais, NCs por ambiente, NCs por serviço e a tabela de todos os apontamentos.
// As fotos são copiadas do PDF original como estão (o mesmo objeto de imagem, sem recodificar nem distorcer:
// encaixe proporcional dentro do quadro). Nenhum dado é inventado: o que falta aparece como "Não informado".

const NI = "Não informado";
const limpa = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
const dataBr = (iso) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || ""); return m ? `${m[3]}/${m[2]}/${m[1]}` : ""; };

/** Monta a lista ordenada de fotos (ordem do documento) com o contexto de cada uma. */
export function montarFotos(ext, dic) {
  const out = [];
  for (const nc of ext.ncs) for (const f of nc.fotos)
    out.push({ ...f, tipo: "nc", nc: nc.numero, ambiente: nc.ambiente, servico: dic.nome(nc.servicoOriginal), problema: nc.descricao || NI });
  for (const it of ext.fotosItem) for (const f of it.fotos)
    out.push({ ...f, tipo: "item", nc: null, itemNr: it.itemNr, ambiente: it.ambiente, servico: dic.nome(it.servicoOriginal), problema: "Foto anexada ao item do checklist (sem NC)" });
  for (const f of ext.naoAssociadas)
    out.push({ ...f, tipo: "solta", nc: null, ambiente: f.ambiente, servico: dic.nome(f.servico), problema: `Foto sem vínculo identificado (pág. ${f.pagina} do original)` });
  return out.sort((a, b) => a.seq - b.seq);
}

/** Agrupa por ambiente mantendo a ordem em que cada ambiente aparece no documento. */
export function agruparPorAmbiente(fotos) {
  const grupos = [];
  for (const f of fotos) {
    const nome = f.ambiente || NI;
    let g = grupos.find((x) => x.ambiente === nome);
    if (!g) grupos.push((g = { ambiente: nome, fotos: [] }));
    g.fotos.push(f);
  }
  return grupos;
}

/** Totais do resumo final. */
export function resumir(ext, dic) {
  const porAmb = new Map(), porServ = new Map();
  for (const nc of ext.ncs) {
    const a = nc.ambiente || NI, s = dic.nome(nc.servicoOriginal).curto;
    const pa = porAmb.get(a) || { ambiente: a, ncs: 0, fotos: 0 }; pa.ncs++; pa.fotos += nc.fotos.length; porAmb.set(a, pa);
    const ps = porServ.get(s) || { servico: s, ncs: 0, fotos: 0 }; ps.ncs++; ps.fotos += nc.fotos.length; porServ.set(s, ps);
  }
  return {
    totalNcs: ext.ncs.length, totalFotos: ext.totais.fotos, ambientes: porAmb.size,
    porAmbiente: [...porAmb.values()],
    porServico: [...porServ.values()].sort((a, b) => b.ncs - a.ncs || a.servico.localeCompare(b.servico, "pt-BR")),
    ncsSemFoto: ext.ncs.filter((n) => !n.fotos.length).map((n) => n.numero),
    ncsSemDescricao: ext.ncs.filter((n) => !n.descricao).map((n) => n.numero),
  };
}

export function criarGerador(PDFLib) {
  const { PDFDocument, StandardFonts, rgb, PDFObjectCopier, pushGraphicsState, popGraphicsState, concatTransformationMatrix, drawObject } = PDFLib;
  const W = 841.89, H = 595.28, M = 28;
  const COR = { tinta: rgb(0.11, 0.13, 0.16), suave: rgb(0.42, 0.45, 0.5), linha: rgb(0.82, 0.84, 0.87), borda: rgb(0.86, 0.87, 0.89),
    faixa: rgb(0.94, 0.95, 0.96), destaque: rgb(0.06, 0.23, 0.19), branco: rgb(1, 1, 1) };

  return async function gerar({ extracao: ext, origem, dicionario: dic, geradoEm = new Date() }) {
    const doc = await PDFDocument.create();
    const f = await doc.embedFont(StandardFonts.Helvetica), fb = await doc.embedFont(StandardFonts.HelveticaBold);
    // Helvetica (WinAnsi) cobre o português; o que não couber nela vira "?" em vez de quebrar a geração.
    const seguro = (fonte, s) => { let o = ""; for (const ch of limpa(s)) { try { fonte.encodeText(ch); o += ch; } catch { o += "?"; } } return o; };
    const larg = (fonte, s, t) => fonte.widthOfTextAtSize(s, t);
    const corta = (fonte, s, t, max) => { s = seguro(fonte, s); if (larg(fonte, s, t) <= max) return s; while (s && larg(fonte, s + "…", t) > max) s = s.slice(0, -1); return s + "…"; };
    const quebra = (fonte, s, t, max, maxLinhas = 99) => {
      const ps = seguro(fonte, s).split(" "), ls = []; let l = "";
      for (const p of ps) { const c = l ? l + " " + p : p; if (larg(fonte, c, t) <= max || !l) l = c; else { ls.push(l); l = p; } }
      if (l) ls.push(l);
      if (ls.length > maxLinhas) { const r = ls.slice(0, maxLinhas); r[maxLinhas - 1] = corta(fonte, ls.slice(maxLinhas - 1).join(" "), t, max); return r; }
      return ls.map((x) => (larg(fonte, x, t) > max ? corta(fonte, x, t, max) : x));
    };
    const cab = ext.cabecalho, res = resumir(ext, dic);
    const paginas = [];
    const txt = (pg, s, x, y, t, fonte = f, cor = COR.tinta) => pg.drawText(seguro(fonte, s), { x, y, size: t, font: fonte, color: cor });

    const novaPagina = (direita) => {
      const pg = doc.addPage([W, H]); paginas.push(pg);
      txt(pg, "RELATÓRIO FINAL DE VISTORIA", M, H - 40, 15, fb);
      const d = `${direita} | NCs: ${res.totalNcs}`;
      txt(pg, d, W - M - larg(f, seguro(f, d), 7.5), H - 38, 7.5, f, COR.suave);
      pg.drawLine({ start: { x: M, y: H - 46 }, end: { x: W - M, y: H - 46 }, thickness: 0.8, color: COR.tinta });
      const info = [`Obra: ${cab.obra || NI}`, `Bloco: ${cab.bloco || NI}`, `Unidade: ${cab.unidade || NI}`,
        `Data da vistoria: ${dataBr(cab.dataVistoria) || NI}`, `Responsável: ${cab.responsavel || NI}`].join("   |   ");
      txt(pg, corta(f, info, 7.5, W - 2 * M), M, H - 59, 7.5);
      return pg;
    };

    // ---- evidências fotográficas ----
    const copiador = origem?.documento ? PDFObjectCopier.for(origem.documento.context, doc.context) : null;
    const copiadas = new Map();
    const imagem = (foto) => {
      const k = foto.ref?.toString?.();
      if (!copiador || !k) return null;
      if (!copiadas.has(k)) copiadas.set(k, doc.context.register(copiador.copy(origem.documento.context.lookup(foto.ref))));
      return copiadas.get(k);
    };
    const grupos = agruparPorAmbiente(montarFotos(ext, dic));
    const topo = H - 70, base = 34, gap = 12, colW = (W - 2 * M - 2 * gap) / 3;
    const faixaH = 17, cardH = 214, fotoH = 150;
    let pg = null, y = 0;
    const desenhaCard = (foto, x, yTopo) => {
      pg.drawRectangle({ x, y: yTopo - cardH, width: colW, height: cardH, borderColor: COR.borda, borderWidth: 0.7, color: COR.branco });
      const ref = imagem(foto);
      const iw = foto.w || 1, ih = foto.h || 1, boxW = colW - 16, boxH = fotoH;
      const esc = Math.min(boxW / iw, boxH / ih), dw = iw * esc, dh = ih * esc;
      const ix = x + 8 + (boxW - dw) / 2, iy = yTopo - 7 - boxH + (boxH - dh) / 2;
      if (ref) {
        const nome = pg.node.newXObject("Foto", ref);
        pg.pushOperators(pushGraphicsState(), concatTransformationMatrix(dw, 0, 0, dh, ix, iy), drawObject(nome), popGraphicsState());
      } else {
        pg.drawRectangle({ x: x + 8, y: yTopo - 7 - boxH, width: boxW, height: boxH, color: COR.faixa });
        txt(pg, "Foto indisponível", x + colW / 2 - 30, yTopo - 7 - boxH / 2, 8, f, COR.suave);
      }
      const ly = yTopo - 12 - boxH;
      pg.drawLine({ start: { x: x + 8, y: ly }, end: { x: x + colW - 8, y: ly }, thickness: 0.5, color: COR.linha });
      const mw = colW - 16, t = 7;
      const ncTxt = foto.tipo === "nc" ? `NC: ${foto.nc}` : foto.tipo === "item" ? `NC: sem NC (foto do item ${foto.itemNr ?? "?"} do checklist)` : "NC: não associada";
      let yy = ly - 10;
      txt(pg, corta(fb, ncTxt, t, mw), x + 8, yy, t, fb); yy -= 9;
      txt(pg, corta(f, `Ambiente: ${foto.ambiente || NI}`, t, mw), x + 8, yy, t); yy -= 9;
      txt(pg, corta(f, `Serviço: ${foto.servico.curto}`, t, mw), x + 8, yy, t); yy -= 9;
      for (const l of quebra(f, `Problema: ${foto.problema}`, t, mw, 3)) { txt(pg, l, x + 8, yy, t); yy -= 9; }
    };
    const faixa = (nome, cont) => {
      pg.drawRectangle({ x: M, y: y - faixaH, width: W - 2 * M, height: faixaH, color: COR.faixa });
      txt(pg, corta(fb, nome + (cont ? " (continuação)" : ""), 8.5, W - 2 * M - 16), M + 8, y - 12, 8.5, fb, COR.destaque);
      y -= faixaH + 6;
    };
    for (const g of grupos) {
      if (!pg || y - (faixaH + 6 + cardH) < base) { pg = novaPagina("EVIDÊNCIAS FOTOGRÁFICAS"); y = topo; }
      faixa(g.ambiente, false);
      for (let i = 0; i < g.fotos.length; i += 3) {
        if (y - cardH < base) { pg = novaPagina("EVIDÊNCIAS FOTOGRÁFICAS"); y = topo; faixa(g.ambiente, true); }
        g.fotos.slice(i, i + 3).forEach((foto, k) => desenhaCard(foto, M + k * (colW + gap), y));
        y -= cardH + gap;
      }
    }

    // ---- resumo final ----
    pg = novaPagina("RESUMO DOS APONTAMENTOS"); y = topo - 4;
    const linhaRes = (garantir) => { if (y - garantir < base) { pg = novaPagina("RESUMO DOS APONTAMENTOS"); y = topo - 4; return true; } return false; };
    // cartões de totais
    const tot = [["Não conformidades", res.totalNcs], ["Fotos", res.totalFotos], ["Ambientes", res.ambientes],
      ["Itens reprovados", ext.totais.itensReprovados], ["NCs sem foto", res.ncsSemFoto.length], ["NCs sem descrição", res.ncsSemDescricao.length]];
    const tw = (W - 2 * M - 5 * 8) / 6;
    tot.forEach(([r, v], i) => {
      const x = M + i * (tw + 8);
      pg.drawRectangle({ x, y: y - 40, width: tw, height: 40, borderColor: COR.borda, borderWidth: 0.7, color: COR.faixa });
      txt(pg, String(v), x + 10, y - 22, 15, fb, COR.destaque);
      txt(pg, r, x + 10, y - 34, 7, f, COR.suave);
    });
    y -= 56;
    // NCs por ambiente | por serviço (lado a lado)
    const meia = (W - 2 * M - 20) / 2;
    const tabelaPeq = (x, titulo, cols, linhas) => {
      let yy = y; txt(pg, titulo, x, yy - 9, 9, fb); yy -= 16;
      const larguras = [meia - 110, 55, 55];
      pg.drawRectangle({ x, y: yy - 13, width: meia, height: 13, color: COR.faixa });
      let cx = x + 6; cols.forEach((c, i) => { txt(pg, c, cx, yy - 9.5, 7, fb); cx += larguras[i]; }); yy -= 13;
      for (const l of linhas) {
        cx = x + 6; l.forEach((c, i) => { txt(pg, i ? String(c) : corta(f, c, 7.5, larguras[0] - 10), cx, yy - 10, 7.5); cx += larguras[i]; });
        yy -= 13; pg.drawLine({ start: { x, y: yy }, end: { x: x + meia, y: yy }, thickness: 0.4, color: COR.linha });
      }
      return yy;
    };
    const y1 = tabelaPeq(M, "Não conformidades por ambiente", ["Ambiente", "NCs", "Fotos"], res.porAmbiente.map((r) => [r.ambiente, r.ncs, r.fotos]));
    const y2 = tabelaPeq(M + meia + 20, "Não conformidades por serviço", ["Serviço", "NCs", "Fotos"], res.porServico.map((r) => [r.servico, r.ncs, r.fotos]));
    y = Math.min(y1, y2) - 18;
    // tabela de apontamentos
    const cw = [46, 150, 150, W - 2 * M - 46 - 150 - 150];
    const cabTab = () => {
      pg.drawRectangle({ x: M, y: y - 14, width: W - 2 * M, height: 14, color: COR.destaque });
      let cx = M + 6; ["NC", "Ambiente", "Serviço avaliado", "Descrição do problema"].forEach((c, i) => { txt(pg, c, cx, y - 10, 7.5, fb, COR.branco); cx += cw[i]; });
      y -= 14;
    };
    linhaRes(60); txt(pg, "Apontamentos", M, y - 9, 9, fb); y -= 16; cabTab();
    for (const nc of ext.ncs) {
      const desc = quebra(f, nc.descricao || NI, 7.5, cw[3] - 10, 6);
      const amb = quebra(f, nc.ambiente || NI, 7.5, cw[1] - 10, 3), serv = quebra(f, dic.nome(nc.servicoOriginal).curto, 7.5, cw[2] - 10, 3);
      const h = Math.max(desc.length, amb.length, serv.length) * 9.5 + 6;
      if (linhaRes(h)) cabTab();
      let cx = M + 6;
      [[String(nc.numero)], amb, serv, desc].forEach((ls, i) => { ls.forEach((l, k) => txt(pg, l, cx, y - 10 - k * 9.5, 7.5, i === 0 ? fb : f)); cx += cw[i]; });
      y -= h; pg.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.4, color: COR.linha });
    }
    // fotos sem NC e conferências (rastreabilidade)
    const notas = [];
    for (const it of ext.fotosItem) notas.push(`Item ${it.itemNr ?? "?"} (${it.ambiente || NI} · ${dic.nome(it.servicoOriginal).curto}): ${it.fotos.length} foto(s) anexada(s) ao item, sem NC.`);
    if (ext.naoAssociadas.length) notas.push(`${ext.naoAssociadas.length} foto(s) sem vínculo identificado: páginas ${[...new Set(ext.naoAssociadas.map((x) => x.pagina))].join(", ")} do original.`);
    if (res.ncsSemFoto.length) notas.push(`NCs sem foto: ${res.ncsSemFoto.join(", ")}.`);
    for (const a of ext.avisos) notas.push(a);
    if (notas.length) {
      y -= 10; linhaRes(30); txt(pg, "Observações da conversão", M, y - 9, 9, fb); y -= 16;
      for (const n of notas) for (const l of quebra(f, "• " + n, 7.5, W - 2 * M - 10)) { linhaRes(11); txt(pg, l, M + 4, y - 9, 7.5); y -= 11; }
    }

    // ---- rodapé ----
    const gerado = `Gerado a partir do relatório do Mobuss em ${geradoEm.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}`;
    paginas.forEach((p, i) => {
      const s = `Página ${i + 1}/${paginas.length}`;
      txt(p, s, W - M - larg(f, s, 7), 16, 7, f, COR.suave);
      txt(p, gerado, M, 16, 7, f, COR.suave);
    });
    doc.setTitle(`Relatório Final de Vistoria — ${cab.unidade || ""}`.trim());
    doc.setProducer("VistoriaAMCI — conversor de relatórios Mobuss");
    doc.setCreator("VistoriaAMCI");
    const bytes = await doc.save({ useObjectStreams: true });
    return { bytes, paginas: paginas.length, resumo: res, semEquivalencia: [...dic.semEquivalencia] };
  };
}
