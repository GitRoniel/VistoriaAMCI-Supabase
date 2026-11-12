// Central Offline: armazenamento local (IndexedDB), um banco por usuário (nomeBanco(userId)): outra conta no mesmo
// aparelho abre outro banco e não vê estes documentos. Nada de senha ou token aqui: só os PDFs e os metadados.
//
// Objetos:
//   docs       metadados de cada documento guardado (id "original:<rel>" / "convertido:<rel>"), versaoOk = versão
//              do arquivo válido guardado, arquivo = chave em "arquivos", status ok | falha, hash SHA-256, bytes…
//   arquivos   os bytes do PDF (ArrayBuffer — o Safari guarda melhor que Blob), chave "<doc>@<versao>"
//   obras      um registro por condomínio: nome, tipos escolhidos, data da preparação e da última sincronização
//   fila       downloads pendentes (sobrevive ao fechamento do Safari; retomados ao abrir de novo com internet)
//   checklists pendências (texto) de cada unidade, para consulta offline
// Troca de versão: o arquivo novo é gravado com outra chave e só depois o documento passa a apontar para ele;
// o antigo é apagado por último. Assim um download interrompido nunca substitui um arquivo válido.
import { nomeBanco } from "./model.js";

const VERSAO = 1;
export function abrirBanco(userId) {
  return new Promise((ok, erro) => {
    if (!("indexedDB" in globalThis)) { erro(new Error("Este navegador não permite guardar arquivos (IndexedDB indisponível).")); return; }
    const req = indexedDB.open(nomeBanco(userId), VERSAO);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("docs")) db.createObjectStore("docs", { keyPath: "id" }).createIndex("projeto", "projectId");
      if (!db.objectStoreNames.contains("arquivos")) db.createObjectStore("arquivos");
      if (!db.objectStoreNames.contains("obras")) db.createObjectStore("obras", { keyPath: "projectId" });
      if (!db.objectStoreNames.contains("fila")) db.createObjectStore("fila", { keyPath: "id" });
      if (!db.objectStoreNames.contains("checklists")) db.createObjectStore("checklists", { keyPath: "unitId" });
      if (!db.objectStoreNames.contains("meta")) db.createObjectStore("meta");
    };
    req.onsuccess = () => ok(criarStore(req.result));
    req.onerror = () => erro(req.error || new Error("Não foi possível abrir o armazenamento local."));
    req.onblocked = () => erro(new Error("Feche as outras abas do aplicativo e tente de novo."));
  });
}

const prom = (req) => new Promise((ok, erro) => { req.onsuccess = () => ok(req.result); req.onerror = () => erro(req.error); });
const fim = (tx) => new Promise((ok, erro) => { tx.oncomplete = () => ok(); tx.onerror = () => erro(tx.error); tx.onabort = () => erro(tx.error || new Error("Gravação cancelada (sem espaço no aparelho?)")); });

function criarStore(db) {
  const tx = (lojas, modo = "readonly") => db.transaction(lojas, modo);
  const todos = (loja) => prom(tx(loja).objectStore(loja).getAll());
  const um = (loja, chave) => prom(tx(loja).objectStore(loja).get(chave));
  const gravar = async (loja, valor, chave) => { const t = tx(loja, "readwrite"); t.objectStore(loja).put(valor, chave); await fim(t); };
  const apagar = async (loja, chave) => { const t = tx(loja, "readwrite"); t.objectStore(loja).delete(chave); await fim(t); };
  return {
    db,
    fechar: () => db.close(),
    docs: () => todos("docs"),
    doc: (id) => um("docs", id),
    obras: () => todos("obras"),
    obra: (id) => um("obras", Number(id)),
    salvarObra: (o) => gravar("obras", o),
    apagarObraRegistro: (id) => apagar("obras", Number(id)),
    fila: () => todos("fila"),
    salvarFila: async (itens) => { const t = tx("fila", "readwrite"); const s = t.objectStore("fila"); for (const i of itens) s.put(i); await fim(t); },
    tirarDaFila: (id) => apagar("fila", id),
    limparFila: async (projectId = null) => {
      const t = tx("fila", "readwrite"), s = t.objectStore("fila");
      const itens = await prom(s.getAll());
      for (const i of itens) if (projectId == null || Number(i.projectId) === Number(projectId)) s.delete(i.id);
      await fim(t);
    },
    meta: (k) => um("meta", k),
    salvarMeta: (k, v) => gravar("meta", v, k),
    checklist: (unitId) => um("checklists", Number(unitId)),
    salvarChecklists: async (lista) => { const t = tx("checklists", "readwrite"); const s = t.objectStore("checklists"); for (const c of lista) s.put(c); await fim(t); },
    /** Bytes do PDF guardado (ArrayBuffer) ou null. */
    async bytes(id) { const d = await um("docs", id); if (!d?.arquivo) return null; const a = await um("arquivos", d.arquivo); return a || null; },
    /** Grava a versão nova já validada e, na mesma transação, passa o documento a apontar para ela; apaga a antiga. */
    async guardar(doc, buffer, hash) {
      const chave = `${doc.id}@${doc.versao}`;
      const t = tx(["docs", "arquivos"], "readwrite"), sd = t.objectStore("docs"), sa = t.objectStore("arquivos");
      const antigo = await prom(sd.get(doc.id));
      sa.put(buffer, chave);
      sd.put({ ...doc, status: "ok", erro: "", versaoOk: doc.versao, arquivo: chave, bytes: buffer.byteLength, hash, baixadoEm: new Date().toISOString() });
      if (antigo?.arquivo && antigo.arquivo !== chave) sa.delete(antigo.arquivo);
      await fim(t);
    },
    /** Marca a falha sem mexer no arquivo válido que já estiver guardado. */
    async falha(doc, erro) {
      const t = tx("docs", "readwrite"), s = t.objectStore("docs");
      const antigo = await prom(s.get(doc.id));
      s.put({ ...(antigo || doc), ...(antigo ? { versaoServidor: doc.versao } : {}), status: "falha", erro: String(erro || "falha no download").slice(0, 300), tentativaEm: new Date().toISOString() });
      await fim(t);
    },
    /** Remove do aparelho (nunca do servidor). */
    async remover(ids) {
      const t = tx(["docs", "arquivos", "fila"], "readwrite"), sd = t.objectStore("docs"), sa = t.objectStore("arquivos"), sf = t.objectStore("fila");
      for (const id of ids) { const d = await prom(sd.get(id)); if (d?.arquivo) sa.delete(d.arquivo); sd.delete(id); sf.delete(id); }
      await fim(t);
    },
    async removerObra(projectId) {
      const docs = (await todos("docs")).filter((d) => Number(d.projectId) === Number(projectId));
      await this.remover(docs.map((d) => d.id));
      const t = tx(["obras", "checklists", "fila"], "readwrite");
      t.objectStore("obras").delete(Number(projectId));
      const sc = t.objectStore("checklists"), sf = t.objectStore("fila");
      for (const c of await prom(sc.getAll())) if (Number(c.projectId) === Number(projectId)) sc.delete(c.unitId);
      for (const f of await prom(sf.getAll())) if (Number(f.projectId) === Number(projectId)) sf.delete(f.id);
      await fim(t);
    },
    async limparTudo() {
      const t = tx(["docs", "arquivos", "obras", "fila", "checklists", "meta"], "readwrite");
      for (const l of ["docs", "arquivos", "obras", "fila", "checklists", "meta"]) t.objectStore(l).clear();
      await fim(t);
    }
  };
}

/** Bancos offline de outras contas neste aparelho (quando o navegador permite listar). */
export async function bancosDeOutrasContas(userId) {
  try {
    if (!indexedDB.databases) return null;
    const meu = nomeBanco(userId);
    return (await indexedDB.databases()).map((d) => d.name).filter((n) => n && n.startsWith("amci-offline:") && n !== meu);
  } catch { return null; }
}
export function apagarBanco(nome) {
  return new Promise((ok) => { const r = indexedDB.deleteDatabase(nome); r.onsuccess = r.onerror = r.onblocked = () => ok(); });
}
