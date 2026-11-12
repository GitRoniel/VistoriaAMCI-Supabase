// Service Worker da plataforma (gerado por scripts/build.mjs a partir de scripts/sw-template.js — não edite www/sw.js).
// Objetivo: o aplicativo abrir sem internet (Central Offline e telas já visitadas). Os RELATÓRIOS guardados NÃO
// ficam aqui: ficam no IndexedDB da Central Offline (por usuário), com controle de versão e integridade.
//   • páginas e scripts do próprio site: rede primeiro (o funcionamento online continua igual e sempre atualizado);
//     sem rede, a cópia guardada; página não guardada → Central Offline;
//   • fontes do Google: cache primeiro;
//   • Supabase (dados, login, arquivos): nunca passa por aqui (sempre direto, com a sessão e o RLS).
const VERSAO = "__VERSAO__";
const CACHE = "amci-app-" + VERSAO, FONTES = "amci-fontes-v1";
const PRECACHE = __PRECACHE__;
const ESPERA_REDE = 6000;

self.addEventListener("install", (ev) => {
  ev.waitUntil(caches.open(CACHE).then((c) => Promise.all(PRECACHE.map((u) => c.add(new Request(u, { cache: "reload" })).catch(() => null)))).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (ev) => {
  ev.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k.startsWith("amci-app-") && k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

/** Endereço canônico (Vercel com cleanUrls): /index.html → /, /offline.html → /offline. */
function chave(url) {
  const u = new URL(url);
  let p = u.pathname;
  if (p === "/index.html") p = "/";
  else if (p.endsWith(".html")) p = p.slice(0, -5);
  return u.origin + p;
}
/** O Safari recusa respostas com redirecionamento vindas do Service Worker em navegações: devolve uma cópia limpa. */
async function limpa(res) {
  if (!res || !res.redirected) return res;
  const corpo = await res.blob();
  return new Response(corpo, { status: res.status, statusText: res.statusText, headers: res.headers });
}
function comTempo(p, ms) { return Promise.race([p, new Promise((_, n) => setTimeout(() => n(new Error("tempo")), ms))]); }

async function redePrimeiro(req, navegacao) {
  const cache = await caches.open(CACHE), k = navegacao ? chave(req.url) : req.url.split("#")[0];
  try {
    const res = await limpa(await comTempo(fetch(req), ESPERA_REDE));
    if (res && res.ok && (res.type === "basic" || res.type === "default")) cache.put(k, res.clone()).catch(() => {});
    return res;
  } catch (err) {
    const salvo = (await cache.match(k, { ignoreSearch: !navegacao })) || (navegacao ? null : await caches.match(req, { ignoreSearch: true }));
    if (salvo) return salvo;
    if (navegacao) {
      const central = await cache.match(new URL("/offline", self.location.origin).href);
      if (central) return central;
    }
    return new Response("Sem conexão.", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }
}
async function cachePrimeiro(req) {
  const cache = await caches.open(FONTES), salvo = await cache.match(req);
  if (salvo) return salvo;
  try { const res = await fetch(req); if (res && (res.ok || res.type === "opaque")) cache.put(req, res.clone()).catch(() => {}); return res; }
  catch { return new Response("", { status: 503 }); }
}

self.addEventListener("fetch", (ev) => {
  const req = ev.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin) {
    if (url.pathname === "/sw.js") return;
    ev.respondWith(redePrimeiro(req, req.mode === "navigate"));
  } else if (url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com") {
    ev.respondWith(cachePrimeiro(req));
  }
  // demais origens (Supabase etc.): sem interceptar
});
