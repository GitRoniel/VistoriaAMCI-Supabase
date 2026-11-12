// Central Offline → "Baixar no computador": salva os relatórios escolhidos (compactos, originais Mobuss ou os dois)
// numa pasta do computador (Chrome/Edge: o usuário escolhe a pasta; arquivos que já estão lá com o mesmo tamanho
// não são gravados de novo) ou num .zip (qualquer navegador; dividido em partes para não estourar a memória).
// O que já está guardado neste aparelho (IndexedDB) é reaproveitado sem baixar de novo; o resto vem do servidor
// por URL assinada temporária (RLS/Storage valem como em qualquer download). Nada é gravado no banco.
import { validarPdf, LIMITE_ZIP } from "./model.js";
import { assinar, baixar } from "./sync.js";
import { montarZip } from "./zip.js";

export const temPasta = () => typeof window !== "undefined" && typeof window.showDirectoryPicker === "function";

async function pastaDe(raiz, partes, criar) {
  let dir = raiz;
  for (const p of partes) dir = await dir.getDirectoryHandle(p, { create: criar });
  return dir;
}
/** Arquivo já está na pasta com o tamanho do servidor? (não grava de novo) */
async function jaNaPasta(raiz, caminho, tamanho) {
  if (!tamanho) return false;
  try {
    const partes = caminho.split("/"), nome = partes.pop();
    const fh = await (await pastaDe(raiz, partes, false)).getFileHandle(nome);
    return (await fh.getFile()).size === tamanho;
  } catch { return false; }
}
async function gravarNaPasta(raiz, caminho, buf) {
  const partes = caminho.split("/"), nome = partes.pop();
  const fh = await (await pastaDe(raiz, partes, true)).getFileHandle(nome, { create: true });
  const w = await fh.createWritable();
  try { await w.write(buf); await w.close(); } catch (err) { try { await w.abort(); } catch { /* nada */ } throw err; }
  if ((await fh.getFile()).size !== buf.byteLength) throw new Error("o arquivo não foi gravado inteiro na pasta (espaço em disco?)");
}

/**
 * @param o.docs       documentos (catálogo) a exportar
 * @param o.caminhos   Map id → "Pasta/arquivo.pdf" (model.caminhosNoComputador)
 * @param o.lerLocal   async (doc) → ArrayBuffer|null — cópia válida guardada neste aparelho
 * @param o.modo       "pasta" (o.pasta = FileSystemDirectoryHandle) | "zip" (o.entregarZip(pedacos, parte))
 * @param o.online     há internet (sem ela, só o que está no aparelho)
 */
export async function exportar({ sb, docs, caminhos, lerLocal, modo, pasta, entregarZip, online, aoProgresso = () => {}, sinal, simultaneos = 3, limite = LIMITE_ZIP }) {
  const est = { total: docs.length, feitos: 0, falhas: 0, salvos: 0, doAparelho: 0, jaNaPasta: 0, partes: 0, bytes: 0, bytesTotal: docs.reduce((s, d) => s + (d.tamanho || 0), 0), erros: [] };
  const avisar = (fase) => aoProgresso({ ...est, fase });
  const dividir = modo === "zip" && est.bytesTotal > limite;
  let lote = [], loteBytes = 0;
  const fecharParte = () => {
    if (!lote.length) return;
    est.partes++;
    entregarZip(montarZip(lote), dividir ? est.partes : 0);
    lote = []; loteBytes = 0;
  };
  avisar("iniciando");
  try {
    for (let i = 0; i < docs.length; i += 30) {
      if (sinal?.aborted) break;
      const bloco = docs.slice(i, i + 30);
      // assina só o que precisa vir do servidor (as URLs valem 15 min; por isso em blocos)
      const precisa = [], pular = new Set(), locais = new Map();
      for (const d of bloco) {
        if (modo === "pasta" && await jaNaPasta(pasta, caminhos.get(d.id), d.tamanho)) { pular.add(d.id); continue; }
        const buf = await lerLocal(d).catch(() => null);
        if (buf && validarPdf(new Uint8Array(buf)).ok) locais.set(d.id, buf); else precisa.push(d);
      }
      let urls = new Map();
      if (precisa.length && online) {
        try { urls = await assinar(sb, [...new Set(precisa.map((d) => d.caminho))]); } catch (err) { urls = new Map(); console.error(err); }
      }
      const fila = [...bloco];
      const trabalhador = async () => {
        while (fila.length && !sinal?.aborted) {
          const d = fila.shift();
          try {
            if (pular.has(d.id)) { est.jaNaPasta++; continue; }
            let buf = locais.get(d.id);
            if (buf) est.doAparelho++;
            else {
              if (!online) throw new Error("não está guardado neste aparelho (conecte-se à internet para baixar)");
              const url = urls.get(d.caminho);
              if (!url) throw new Error("sem permissão ou arquivo indisponível no servidor");
              buf = (await baixar(url, d, sinal)).buf;
            }
            if (sinal?.aborted) break;
            if (modo === "pasta") await gravarNaPasta(pasta, caminhos.get(d.id), buf);
            else {
              if (dividir && loteBytes && loteBytes + buf.byteLength > limite) fecharParte();
              lote.push({ nome: caminhos.get(d.id), bytes: new Uint8Array(buf), data: d.data ? new Date(d.data) : undefined });
              loteBytes += buf.byteLength;
            }
            est.salvos++; est.bytes += buf.byteLength;
          } catch (err) {
            if (err?.name === "AbortError" || sinal?.aborted) break;
            est.falhas++; est.erros.push({ id: d.id, erro: err?.message || String(err) });
          } finally {
            locais.delete(d.id);
            est.feitos++; avisar("baixando");
          }
        }
      };
      await Promise.all(Array.from({ length: simultaneos }, trabalhador));
    }
    if (sinal?.aborted) { lote = []; avisar("cancelado"); return est; }
    if (modo === "zip") fecharParte();
    avisar("concluido");
  } catch (err) {
    est.erro = err?.message || String(err); avisar("erro");
  }
  return est;
}
