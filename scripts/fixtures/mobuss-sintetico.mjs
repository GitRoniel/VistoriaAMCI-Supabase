// PDF sintético no formato do "Relatório de Entrega da Unidade" do Mobuss (mesmas posições de colunas, blocos de
// NC, anexos com rótulo "Imagem k" e a lista "Imagem k: arquivo", quebra de página no meio dos anexos, foto anexada
// ao item, termo final com assinatura). Dados fictícios: serve para testar o conversor sem PDFs de clientes reais.
import { deflateSync } from "node:zlib";

/** PNG RGB de cor sólida (com uma faixa), para simular as fotos sem depender de arquivos. */
export function png(w, h, [r, g, b]) {
  const crcT = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
  const crc = (buf) => { let c = -1; for (const x of buf) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
  const chunk = (tipo, dados) => {
    const t = Buffer.from(tipo, "ascii"), len = Buffer.alloc(4), cr = Buffer.alloc(4);
    len.writeUInt32BE(dados.length); cr.writeUInt32BE(crc(Buffer.concat([t, dados])));
    return Buffer.concat([len, t, dados, cr]);
  };
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const o = y * (w * 3 + 1) + 1 + x * 3, faixa = y > h * 0.7 ? 0.6 : 1;
      raw[o] = r * faixa; raw[o + 1] = g * faixa; raw[o + 2] = b * faixa;
    }
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

/**
 * Gera o PDF. Retorna { bytes, esperado } com o que o conversor deve encontrar.
 */
export async function gerarMobussSintetico(PDFLib) {
  const { PDFDocument, StandardFonts } = PDFLib;
  const doc = await PDFDocument.create();
  const f = await doc.embedFont(StandardFonts.Helvetica), fb = await doc.embedFont(StandardFonts.HelveticaBold);
  const cores = [[200, 60, 60], [60, 140, 200], [80, 170, 90], [210, 160, 40], [150, 80, 180], [90, 90, 90], [30, 160, 160]];
  let nFoto = 0;
  const foto = async (retrato = true) => doc.embedPng(png(retrato ? 144 : 256, retrato ? 256 : 144, cores[nFoto++ % cores.length]));
  const assinatura = await doc.embedPng(png(520, 200, [240, 240, 240]));
  let pg = null, nPag = 0;
  const T = (s, x, y, t = 8, fonte = f) => pg.drawText(s, { x, y, size: t, font: fonte });
  const nova = () => {
    pg = doc.addPage([595.28, 841.89]); nPag++;
    T("RELATÓRIO DE ENTREGA DA UNIDADE", 8, 811.5, 12, fb);
    T("BL B - APT 204 (OBRA TESTE >> BLOCO B  >> 2º PAVIMENTO)", 9, 792.6, 10, fb);
    T("Gerado:", 8, 39.4, 7); T("10/11/2026 08:00:00", 38, 38.4, 7); T("USUARIO@EXEMPLO.COM.BR", 38, 23.4, 7);
    return pg;
  };
  const cabChecklist = (y) => {
    T("Nr", 13.5, y); T("Situação", 40, y); T("Data de Inspeção", 77, y); T("Descrição", 161, y); T("Resposta", 392, y); T("Observação", 490, y);
  };
  const item = (y, nr, servico, resposta) => { T(String(nr), 12, y); T("10/11/2026", 77, y); T(servico, 161, y); T(resposta, 392, y + 1); };
  const ncCab = (y, n, servico, ambiente, descricao) => {
    T(`Não Conformidade ${n}`, 25, y, 10, fb);
    T("Situação", 27, y - 19); T("Aberta", 27, y - 30); T("Data de Criação", 214, y - 19); T("10/11/2026 09:00", 214, y - 30);
    T("Tipo", 27, y - 46); T("VISTORIA & ENTREGA", 27, y - 57);
    T("Descrição", 27, y - 73);
    T(`Não Conformidade criada automaticamente a partir do item ${servico}, do Formulário CHECKLIST VISTORIA CLIENTE, localizado na ${ambiente}`, 27, y - 84, 6.5);
    let yy = y - 117;
    for (const l of descricao) { T(l, 27, yy); yy -= 10; }
    T("Resumo das Ações", 27, yy - 6);
    return yy - 23;
  };
  // desenha fotos (uma por "linha", como no Mobuss) e devolve o y após o bloco
  const fotos = async (y, qtd, inicio = 1) => {
    for (let k = 0; k < qtd; k++) {
      const im = await foto(); pg.drawImage(im, { x: 85, y: y - 122, width: 65, height: 115 }); T(`Imagem ${inicio + k}`, 101.4, y - 134);
      y -= 150;
    }
    return y;
  };
  const lista = (y, nomes, inicio = 1) => { nomes.forEach((n, k) => { T(`Imagem ${inicio + k}:`, 29, y); T(n, 75, y); y -= 14; }); return y; };

  // ── página 1 ──
  nova();
  T("Informações Gerais", 8, 771.7, 10, fb);
  T("Obra", 52.9, 753.1); T("OBRA TESTE", 78, 753.1);
  T("Unidade", 38.8, 740.1); T("BL B - APT 204", 78, 740.1);
  T("Cliente", 44.6, 727.1); T("CLIENTE FICTICIO / 000.000.000-00", 78, 727.1);
  T("Agendamentos", 8, 712, 10, fb); T("Agendamento 1", 8, 698);
  T("Realizado", 34, 684); T("10/11/2026 09:00", 78, 684); T("até", 153.4, 684); T("10/11/2026 10:15", 169, 684);
  T("Não Conformidades", 276.1, 684); T("5", 362, 684);
  T("Formulário:", 8, 668); T("CHECKLIST VISTORIA CLIENTE | Revisão:", 58, 668);
  T("COZINHA", 12, 648, 9, fb); T("Vistoria do Cliente | CHECKLIST VISTORIA CLIENTE", 12, 636.3);
  cabChecklist(616);
  item(598, 1, "REVESTIMENTO - PISO/ PAREDE (CERÂMICO)", "Reprovado");
  let y = ncCab(576, 10, "REVESTIMENTO - PISO/ PAREDE (CERÂMICO)", "COZINHA", ["Rejunte falhando junto ao ralo"]);
  T("Anexos da Não Conformidade 10", 29, y); y = await fotos(y - 7, 2);
  if (y < 80) throw new Error("layout do sintético");
  lista(y + 10, ["FOTO_A1.jpeg", "FOTO_A2.jpeg"]);

  // ── página 2 ──
  nova();
  y = ncCab(763, 11, "REVESTIMENTO - PISO/ PAREDE (CERÂMICO)", "COZINHA", []);   // sem descrição escrita
  T("Anexos da Não Conformidade 11", 29, y); y = await fotos(y - 7, 1); y = lista(y + 10, ["FOTO_B1.jpeg"]);
  item(y - 12, 2, "SISTEMA ELÉTRICO - TOMADAS", "Aprovado");
  T("SALA DE ESTAR", 12, y - 40, 9, fb); T("Vistoria do Cliente | CHECKLIST VISTORIA CLIENTE", 12, y - 52);
  cabChecklist(y - 72);
  item(y - 92, 1, "ESQUADRIAS - PORTAS", "Reprovado");
  T("Anexos do Item", 29, y - 108);
  y = await fotos(y - 115, 1); y = lista(y + 10, ["FOTO_ITEM.jpeg"]);
  // NC 12 começa no fim da página 2 e os anexos continuam na página 3
  y = ncCab(y - 10, 12, "ESQUADRIAS - PORTAS", "SALA DE ESTAR", ["Porta raspando no piso"]);
  T("Anexos da Não Conformidade 12", 29, y); y = await fotos(y - 7, 1);

  // ── página 3 ── (continuação dos anexos da NC 12)
  nova();
  y = await fotos(780, 1, 2); y = lista(y + 10, ["FOTO_C1.jpeg", "FOTO_C2.jpeg"]);
  item(y - 12, 2, "SERVIÇO NOVO - SEM EQUIVALÊNCIA", "Reprovado");
  y = ncCab(y - 40, 13, "SERVIÇO NOVO - SEM EQUIVALÊNCIA", "SALA DE ESTAR", ["Teste de serviço sem nome curto"]);
  T("Anexos da Não Conformidade 13", 29, y);
  const im = await foto(false); pg.drawImage(im, { x: 25, y: y - 111, width: 185, height: 104 }); T("Imagem 1", 101.4, y - 123);
  y = lista(y - 137, ["FOTO_D1.jpeg"]);
  y = ncCab(y - 12, 14, "SERVIÇO NOVO - SEM EQUIVALÊNCIA", "SALA DE ESTAR", ["Descrição em duas linhas que", "continua aqui"]);
  item(y - 12, 3, "ESQUADRIAS - JANELA", "Aprovado");

  // ── página 4: termo ──
  nova();
  T("TERMO DE ÁREA PRIVATIVA: RECUSA DA VISTORIA", 149.9, 759.7, 10, fb);
  T("Eu, CLIENTE FICTICIO, venho informar que realizei a vistoria.", 8, 702.5);
  pg.drawImage(assinatura, { x: 81, y: 532, width: 160, height: 61 }); pg.drawImage(assinatura, { x: 350, y: 532, width: 160, height: 61 });
  T("10/11/2026 10:10", 128.5, 518.4); T("Fulana Responsável Teste", 114.5, 507.4); T("Responsável", 138.8, 496.4);
  T("10/11/2026 10:15", 397.5, 518.4); T("CLIENTE FICTICIO", 377.3, 507.4); T("Cliente", 417.7, 496.4);
  for (let i = 0; i < nPag; i++) doc.getPage(i).drawText(`${i + 1}/${nPag}`, { x: 269.4, y: 38.4, size: 7, font: f });

  return {
    bytes: await doc.save(),
    esperado: {
      cabecalho: { obra: "OBRA TESTE", unidade: "BL B - APT 204", bloco: "B", apto: "204", dataVistoria: "2026-11-10", responsavel: "Fulana Responsável Teste", ncsDeclaradas: 5 },
      ambientes: ["COZINHA", "SALA DE ESTAR"],
      ncs: [
        { numero: 10, ambiente: "COZINHA", servico: "REVESTIMENTO - PISO/ PAREDE (CERÂMICO)", descricao: "Rejunte falhando junto ao ralo", fotos: ["FOTO_A1.jpeg", "FOTO_A2.jpeg"] },
        { numero: 11, ambiente: "COZINHA", servico: "REVESTIMENTO - PISO/ PAREDE (CERÂMICO)", descricao: "", fotos: ["FOTO_B1.jpeg"] },
        { numero: 12, ambiente: "SALA DE ESTAR", servico: "ESQUADRIAS - PORTAS", descricao: "Porta raspando no piso", fotos: ["FOTO_C1.jpeg", "FOTO_C2.jpeg"] },
        { numero: 13, ambiente: "SALA DE ESTAR", servico: "SERVIÇO NOVO - SEM EQUIVALÊNCIA", descricao: "Teste de serviço sem nome curto", fotos: ["FOTO_D1.jpeg"] },
        { numero: 14, ambiente: "SALA DE ESTAR", servico: "SERVIÇO NOVO - SEM EQUIVALÊNCIA", descricao: "Descrição em duas linhas que continua aqui", fotos: [] },
      ],
      fotosItem: [{ ambiente: "SALA DE ESTAR", servico: "ESQUADRIAS - PORTAS", fotos: ["FOTO_ITEM.jpeg"] }],
      totalFotos: 7, assinaturas: 2,
    },
  };
}
