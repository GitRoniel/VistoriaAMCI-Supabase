// Extrator do "Relatório de Entrega da Unidade" do Mobuss (JasperReports): a partir do texto com posições e das
// fotos de cada página (leitor.js), reconstrói a vistoria: cabeçalho, ambientes, itens reprovados do checklist,
// não conformidades (NC) com a descrição escrita na vistoria e as fotografias de cada NC.
//
// Regras de associação das fotos (nada é presumido):
//   • "Anexos da Não Conformidade N" → as fotos seguintes, até o próximo bloco, são da NC N;
//   • "Anexos do Item" → as fotos são do item do checklist (sem NC), guardadas como "foto do item";
//   • foto fora desses blocos → "não associada", com a página, para conferência;
//   • a lista "Imagem k: arquivo.jpeg" de cada bloco confere a quantidade de fotos (aviso se não bater).
// O estado atravessa as quebras de página (um bloco pode começar numa página e terminar na outra).

const limpa = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
const norm = (s) => limpa(s).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const TOL = 3.5;

/** Linhas da página (de cima para baixo), cada uma com os itens da esquerda para a direita. */
export function linhas(itens) {
  const ord = [...itens].filter((i) => i.str && i.str.length).sort((a, b) => b.y - a.y || a.x - b.x);
  const out = [];
  for (const it of ord) {
    const l = out.find((x) => Math.abs(x.y - it.y) <= TOL);
    if (l) l.itens.push(it); else out.push({ y: it.y, itens: [it] });
  }
  out.forEach((l) => {
    l.itens.sort((a, b) => a.x - b.x);
    // trechos encostados (geradores que escrevem letra a letra ou palavra a palavra) viram um segmento só
    const seg = [];
    for (const it of l.itens) {
      const ant = seg[seg.length - 1], t = it.tam || 8;
      const fim = ant ? ant.x + (ant.w || 0) : 0, gap = ant ? it.x - fim : Infinity;
      if (ant && ant.w != null && gap < 0.3 * t && gap > -0.5 * t) {
        ant.str += (gap > 0.15 * t && !/\s$/.test(ant.str) && !/^\s/.test(it.str) ? " " : "") + it.str;
        ant.w = Math.max(ant.w, it.x + (it.w || 0) - ant.x);
      } else seg.push({ ...it });
    }
    l.itens = seg.filter((x) => limpa(x.str)).map((x) => ({ ...x, str: limpa(x.str) }));
  });
  out.sort((a, b) => b.y - a.y);
  return out.map((l) => ({ tipo: "texto", y: l.y, x: l.itens[0].x, itens: l.itens, texto: limpa(l.itens.map((i) => i.str).join(" ")) }));
}

/** É foto de evidência (e não ícone/logotipo): imagem desenhada com tamanho de foto. */
export const ehFoto = (img) => img.w >= 40 && img.h >= 40 && img.pw >= 120 && img.ph >= 120;

const RODAPE = /^(gerado:|\d+\/\d+$|relatorio de entrega da unidade$)/;
const ehEmail = (s) => /^[^\s@]+@[^\s@]+\.[a-z.]+$/i.test(limpa(s));
const DATA = /(\d{2})\/(\d{2})\/(\d{4})/;
const iso = (m) => (m ? `${m[3]}-${m[2]}-${m[1]}` : "");

/** Tira o texto automático do Mobuss da descrição da NC e devolve só o que foi escrito na vistoria. */
export function descricaoNc(paragrafos, { ambiente = "", servico = "" } = {}) {
  let ps = paragrafos.map(limpa).filter(Boolean);
  const auto = /^n[aã]o conformidade criada automaticamente a partir do item/i;
  if (ps.length && auto.test(ps[0])) {
    if (ps.length > 1) ps = ps.slice(1);
    else {
      let t = ps[0].replace(auto, "").trim();
      if (servico && norm(t).startsWith(norm(servico))) t = t.slice(servico.length);
      t = t.replace(/^.*?do formul[aá]rio .*?cliente\b[.,;]?/i, "").trim();
      if (ambiente) t = t.replace(new RegExp("^,?\\s*localizado na\\s+" + ambiente.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s*"), "i"), "").trim();
      t = t.replace(/^,?\s*localizado na\s+\S+(\s+\d+)?\s*/i, "").trim();
      ps = t ? [t] : [];
    }
  }
  return limpa(ps.join(" ")).replace(/^[.,;:\-–\s]+/, "");
}

/** Serviço e ambiente escritos pelo próprio Mobuss no texto automático da NC (mais confiáveis que a posição). */
export function origemNc(paragrafos) {
  const t = limpa((paragrafos || []).join(" "));
  const m = /a partir do item\s+(.+?),\s*do formul[aá]rio/i.exec(t);
  const a = /localizado na\s+(.+?)(?:\.|$|\s{2})/i.exec(t);
  return { servico: m ? limpa(m[1]) : "", ambiente: a ? limpa(a[1]) : "" };
}

/**
 * paginas: saída do leitor ([{ numero, itens, imagens }]).
 * Retorna { cabecalho, ambientes, itens, ncs, fotosItem, naoAssociadas, avisos, totais }.
 */
export function extrair(paginas) {
  const cab = { obra: "", unidade: "", bloco: "", apto: "", pavimento: "", dataVistoria: "", horaInicio: "", horaFim: "", responsavel: "",
    formulario: "", ncsDeclaradas: null, agendamentosRealizados: 0, geradoEm: "", cliente: "" };
  const itens = [], ncs = [], fotosItem = [], naoAssociadas = [], avisos = [];
  const ambientes = [];
  const col = { desc: 161, resp: 392, obs: 490 };
  let ncsRealizados = null, ncsSoltas = null;
  let seq = 0, assinaturas = 0, ambiente = "", anterior = "", ultimaLinha = "", item = null, nc = null, alvo = null, modo = "", descUltY = null, termo = false;
  const fechaDesc = () => {
    if (!nc || !nc.paragrafos) return;
    const o = origemNc(nc.paragrafos);
    if (o.servico && norm(o.servico) !== norm(nc.servicoOriginal)) {
      if (nc.servicoOriginal) avisos.push(`NC ${nc.numero}: serviço pela posição ("${nc.servicoOriginal}") difere do texto do Mobuss ("${o.servico}"); usado o do texto`);
      nc.servicoOriginal = o.servico;
    }
    nc.descricao = descricaoNc(nc.paragrafos, { ambiente: nc.ambiente, servico: nc.servicoOriginal });
    delete nc.paragrafos;
  };
  const confere = (a) => {
    if (!a || !a.arquivos) return;
    if (a.arquivos.length && a.arquivos.length !== a.fotos.length)
      avisos.push(`${a.nc ? `NC ${a.nc}` : `Item ${a.servicoOriginal || a.servico}`}: ${a.fotos.length} foto(s) encontrada(s) e ${a.arquivos.length} listada(s) no Mobuss`);
    a.fotos.forEach((f, i) => { if (a.arquivos[i]) f.arquivo = a.arquivos[i]; });
  };
  const fechaAlvo = () => { confere(alvo); alvo = null; modo = ""; };
  const fechaNc = () => { fechaDesc(); if (nc && alvo === nc) fechaAlvo(); nc = null; };
  const fechaItem = () => { fechaNc(); if (alvo && alvo === item?.anexo) fechaAlvo(); item = null; };

  for (const pg of paginas || []) {
    const ls = linhas(pg.itens || []);
    const fotos = (pg.imagens || []).filter(ehFoto).map((f) => ({ tipo: "foto", y: f.y + f.h, foto: { ...f, pagina: pg.numero } }));
    const eventos = [...ls, ...fotos].sort((a, b) => b.y - a.y || (a.tipo === "foto" ? -1 : 1));
    for (let idx = 0; idx < eventos.length; idx++) {
      const ev = eventos[idx];
      if (ev.tipo === "foto") {
        const f = ev.foto;
        if (termo) { assinaturas++; continue; }                 // imagens do termo final são assinaturas, não evidências
        f.seq = ++seq;
        if (alvo && (modo === "nc" || modo === "item")) alvo.fotos.push({ seq: f.seq, id: f.id, pagina: f.pagina, w: f.pw, h: f.ph, ref: f.ref, arquivo: "" });
        else naoAssociadas.push({ seq: f.seq, id: f.id, pagina: f.pagina, w: f.pw, h: f.ph, ref: f.ref, ambiente, servico: item?.servico || "" });
        continue;
      }
      const l = ev, t = l.texto, n = norm(t);
      const acima = ultimaLinha; ultimaLinha = t;
      // cabeçalho/rodapé das páginas
      if (RODAPE.test(n) || ehEmail(t)) { if (/^gerado:/.test(n) && !cab.geradoEm) { const m = DATA.exec(t); cab.geradoEm = iso(m); } continue; }
      const mu = /^bl\s*([a-z0-9]{1,3})\s*-\s*apt?o?\.?\s*(t?\d{1,5})\s*\((.*)\)$/i.exec(t);
      if (mu) {
        if (!cab.unidade) {
          cab.bloco = mu[1].toUpperCase(); cab.apto = mu[2].toUpperCase(); cab.unidade = `BL ${cab.bloco} - APT ${cab.apto}`;
          const partes = mu[3].split(">>").map(limpa); if (!cab.obra) cab.obra = partes[0] || ""; cab.pavimento = partes.find((p) => /pavimento|t[ée]rreo/i.test(p)) || "";
        }
        continue;
      }
      // um termo (assinaturas) termina quando começa outro agendamento ou o formulário do checklist: relatórios com
      // mais de um agendamento trazem o termo do agendamento não realizado logo na 1ª página
      if (termo && (/^agendamento\s+\d+/.test(n) || /^formul[aá]rio:/.test(n) || /\|\s*checklist/.test(n))) termo = false;
      if (!termo) {
        let m;
        if ((m = /^obra\s+(.+)$/i.exec(t)) && !cab.obra) { cab.obra = limpa(m[1]); continue; }
        if ((m = /^obra\s+(.+)$/i.exec(t))) { cab.obra = limpa(m[1]); continue; }
        if ((m = /^cliente\s+(.+)$/i.exec(t))) { cab.cliente = limpa(m[1].split("/")[0]); continue; }
        // agendamentos: data e nº de NCs vêm dos REALIZADOS ("Realizado -" = não realizado, não conta)
        const mnd = /n[aã]o conformidades\s+(\d+)\s*$/i.exec(t), linhaNc = mnd && !/^n[aã]o conformidade \d/i.test(t);
        if ((m = /^realizado\s+(\d{2}\/\d{2}\/\d{4})\s+(\d{2}:\d{2})(?:\s+at[ée]\s+(\d{2}\/\d{2}\/\d{4})\s+(\d{2}:\d{2}))?/i.exec(t))) {
          cab.dataVistoria = iso(DATA.exec(m[1])); cab.horaInicio = m[2]; cab.horaFim = m[4] || "";
          if (linhaNc) { ncsRealizados = (ncsRealizados ?? 0) + Number(mnd[1]); cab.agendamentosRealizados++; }
        } else if (linhaNc && !/^realizado\b/i.test(t)) ncsSoltas = Number(mnd[1]);
        if ((m = /^formul[aá]rio:\s*(.+?)\s*(\|.*)?$/i.exec(t))) { cab.formulario = limpa(m[1]); continue; }
      }
      if (/^termo de /.test(n)) { fechaItem(); termo = true; }
      if (termo) {
        // assinatura do termo: nome logo acima do rótulo "Responsável"
        // vale o último termo (o do agendamento realizado, que vem depois do checklist)
        const rot = l.itens.find((i) => norm(i.str) === "responsavel");
        if (rot) {
          const prev = ls.filter((x) => x.y > l.y + 4 && x.y < l.y + 22).flatMap((x) => x.itens)
            .filter((i) => !DATA.test(i.str)).sort((a, b) => Math.abs(a.x - rot.x) - Math.abs(b.x - rot.x));
          if (prev[0]) cab.responsavel = limpa(prev[0].str);
        }
        continue;
      }
      // colunas do checklist
      if (/^nr\b/.test(n) && /descri/.test(n) && /resposta/.test(n)) {
        for (const it of l.itens) { const s = norm(it.str); if (s.startsWith("descri")) col.desc = it.x; else if (s.startsWith("resposta")) col.resp = it.x; else if (s.startsWith("observa")) col.obs = it.x; }
        continue;
      }
      // ambiente: a linha logo acima de "Vistoria do Cliente | CHECKLIST ..."
      if (/\|\s*checklist/.test(n)) { fechaItem(); ambiente = limpa(acima || anterior); if (ambiente && !ambientes.includes(ambiente)) ambientes.push(ambiente); continue; }
      // NC
      const mnc = /^n[aã]o conformidade\s+(\d+)$/i.exec(t);
      if (mnc) {
        fechaNc(); if (alvo) fechaAlvo();
        nc = { numero: Number(mnc[1]), ambiente, servicoOriginal: item?.servico || "", itemNr: item?.nr ?? null, descricao: "", situacao: "", criadaEm: "",
          paragrafos: null, fotos: [], arquivos: [], nc: Number(mnc[1]), pagina: ev.y && pg.numero };
        if (!item) avisos.push(`NC ${nc.numero}: sem item do checklist identificado antes dela`);
        ncs.push(nc); anterior = t; continue;
      }
      // linha de item do checklist (número + data, antes da coluna Descrição): encerra a NC aberta, mesmo sem anexos
      const p0 = l.itens[0];
      const ehItem = p0 && /^\d{1,3}$/.test(limpa(p0.str)) && p0.x < col.desc - 20 && DATA.test(t) && !(nc && nc.paragrafos && p0.x > 20);
      if (ehItem && nc && !modo) fechaNc();
      if (nc && !modo) {
        if (n === "descricao") { nc.paragrafos = []; descUltY = null; continue; }
        if (/^resumo das a[cç][oõ]es/.test(n)) { fechaDesc(); continue; }
        const ma = /^anexos da n[aã]o conformidade\s+(\d+)/i.exec(t);
        if (ma) { fechaDesc(); alvo = nc; modo = "nc"; if (Number(ma[1]) !== nc.numero) avisos.push(`Anexos da NC ${ma[1]} dentro da NC ${nc.numero}`); continue; }
        if (nc.paragrafos) {
          const novo = descUltY === null || descUltY - l.y > 18 || !nc.paragrafos.length;
          if (novo) nc.paragrafos.push(t); else nc.paragrafos[nc.paragrafos.length - 1] += " " + t;
          descUltY = l.y; continue;
        }
        if (/^situa[cç][aã]o\b/.test(n) || /^tipo\b/.test(n)) continue;
        if (!nc.situacao && /^(aberta|fechada|resolvida|em andamento|cancelada)\b/i.test(t)) { nc.situacao = limpa(t.split(/\s{2,}|\d{2}\/\d{2}/)[0]); const md = /(\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2})/.exec(t); if (md) nc.criadaEm = md[1]; continue; }
        continue;
      }
      // dentro de um bloco de anexos: rótulos "Imagem k" e a lista "Imagem k: arquivo"
      if (modo) {
        const mi = /^imagem\s+(\d+):\s*(.+)$/i.exec(t);
        if (mi) { alvo.arquivos[Number(mi[1]) - 1] = limpa(mi[2]); continue; }
        if (/^(imagem\s+\d+\s*)+$/i.test(t)) continue;           // rótulos sob as fotos (uma ou duas colunas)
        // qualquer outra linha encerra o bloco de anexos
        if (modo === "nc") fechaNc(); else fechaAlvo();
      }
      if (/^anexos do item$/.test(n)) {
        if (item) { item.anexo = { nc: null, ambiente: item.ambiente, servicoOriginal: item.servico, itemNr: item.nr, fotos: [], arquivos: [] }; fotosItem.push(item.anexo); alvo = item.anexo; modo = "item"; }
        else avisos.push("Anexos de item sem item identificado");
        continue;
      }
      // linha de item do checklist: número + data
      if (ehItem) {
        fechaItem();
        item = { nr: Number(limpa(p0.str)), ambiente, servico: "", resposta: "", observacao: "" };
        for (const it of l.itens) {
          if (it.x >= col.obs - 4) item.observacao += " " + it.str;
          else if (it.x >= col.resp - 4) item.resposta = limpa(it.str);
          else if (it.x >= col.desc - 4) item.servico += " " + it.str;
        }
        item.servico = limpa(item.servico); item.observacao = limpa(item.observacao); itens.push(item);
        anterior = t; continue;
      }
      if (item && !nc && l.itens.every((it) => it.x >= col.desc - 4)) {           // continuação do item
        for (const it of l.itens) {
          if (it.x >= col.obs - 4) item.observacao = limpa(item.observacao + " " + it.str);
          else if (it.x < col.resp - 4) item.servico = limpa(item.servico + " " + it.str);
          else if (!item.resposta) item.resposta = limpa(it.str);
        }
        continue;
      }
      anterior = t;
    }
  }
  fechaItem();
  cab.ncsDeclaradas = ncsRealizados ?? ncsSoltas;
  ncs.forEach((x) => { delete x.arquivos; delete x.paragrafos; });
  fotosItem.forEach((x) => delete x.arquivos);
  const reprovados = itens.filter((i) => /reprov/i.test(i.resposta));
  const totalFotos = ncs.reduce((n, x) => n + x.fotos.length, 0) + fotosItem.reduce((n, x) => n + x.fotos.length, 0) + naoAssociadas.length;
  if (cab.ncsDeclaradas != null && cab.ncsDeclaradas !== ncs.length) avisos.push(`O Mobuss declara ${cab.ncsDeclaradas} não conformidade(s) e foram encontradas ${ncs.length}`);
  const vistos = new Set(); for (const x of ncs) { if (vistos.has(x.numero)) avisos.push(`NC ${x.numero} repetida no documento`); vistos.add(x.numero); }
  return { cabecalho: cab, ambientes, itens, ncs, fotosItem: fotosItem.filter((x) => x.fotos.length), naoAssociadas, avisos,
    totais: { ncs: ncs.length, itensAvaliados: itens.length, itensReprovados: reprovados.length, fotos: totalFotos,
      fotosNc: ncs.reduce((n, x) => n + x.fotos.length, 0), fotosItem: fotosItem.reduce((n, x) => n + x.fotos.length, 0), fotosNaoAssociadas: naoAssociadas.length, assinaturasIgnoradas: assinaturas,
      ncsSemFoto: ncs.filter((x) => !x.fotos.length).length, ncsSemDescricao: ncs.filter((x) => !x.descricao).length } };
}
