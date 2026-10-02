import { build } from "esbuild";
import { copyFile, cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { inject as injectDarkTheme } from "./theme-dark.mjs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const www = resolve(root, "www");
const watch = process.argv.includes("--watch");

// Estes dois valores são públicos por definição: o navegador precisa recebê-los.
// Variáveis da Vercel continuam tendo prioridade e permitem trocar de ambiente.
const productionDefaults = {
  SUPABASE_URL: "https://lelverljfukbekitqcjm.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "sb_publishable_zvlhpZaRvPuaeYrBgOsndw_2eHO-4zK",
  APP_PUBLIC_URL: "https://www.amci.com.br"
};

const config = {
  SUPABASE_URL: process.env.SUPABASE_URL ?? productionDefaults.SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY:
    process.env.SUPABASE_PUBLISHABLE_KEY ?? productionDefaults.SUPABASE_PUBLISHABLE_KEY,
  APP_PROJECT_SLUG: process.env.APP_PROJECT_SLUG ?? "alto-do-jeriva",
  // Endereço público da versão WEB. No app iOS a página roda em capacitor://localhost, então o
  // link de confirmação de e-mail precisa apontar para o site publicado.
  APP_PUBLIC_URL: process.env.APP_PUBLIC_URL ?? productionDefaults.APP_PUBLIC_URL
};

await mkdir(www, { recursive: true });
// Mantém o Modo Escuro sincronizado com o CSS do Modo Claro.
const pagePath = resolve(www, "index.html");
const page = await readFile(pagePath, "utf8");
const themed = injectDarkTheme(page);
if (themed !== page) await writeFile(pagePath, themed, "utf8");
await cp(resolve(root, "assets"), resolve(www, "assets"), { recursive: true });
// Navegadores pedem /favicon.ico automaticamente.
await copyFile(resolve(root, "assets/icons/favicon.ico"), resolve(www, "favicon.ico"));
await writeFile(
  resolve(www, "config.js"),
  `window.APP_CONFIG = Object.freeze(${JSON.stringify(config)});\n`,
  "utf8"
);

const buildOptions = {
  absWorkingDir: root,
  entryPoints: ["./src/supabase-entry.js"],
  outfile: "www/supabase-client.js",
  bundle: true,
  minify: true,
  sourcemap: false,
  platform: "browser",
  format: "iife",
  target: ["es2022"]
};

// Leitor de Excel da importação de agendamentos: carregado só quando o usuário importa.
const xlsxOptions = { ...buildOptions, entryPoints: ["./src/xlsx-entry.js"], outfile: "www/xlsx-reader.js" };

// Plataforma: estilos compartilhados e páginas dos módulos (src/platform + src/modules).
// Para uma página nova, acrescente { js, css, out } aqui e o HTML em www/<modulo>/<pagina>.html.
const PLATFORM_PAGES = [
  // Relatórios: abas Suprimentos (pedidos) e Contratos. /suprimentos/pedidos redireciona para cá.
  { js: "./src/modules/relatorios/index.js", css: "./src/modules/relatorios/relatorios.css", out: "www/relatorios" }
];
const platformBuilds = [
  { ...buildOptions, entryPoints: ["./src/platform/styles/platform.css"], outfile: "www/platform/platform.css", format: undefined, platform: undefined, target: ["chrome100", "safari15", "firefox100"] },
  ...PLATFORM_PAGES.flatMap((p) => [
    { ...buildOptions, entryPoints: [p.js], outfile: `${p.out}.js` },
    { ...buildOptions, entryPoints: [p.css], outfile: `${p.out}.css`, format: undefined, platform: undefined, target: ["chrome100", "safari15", "firefox100"] }
  ])
];

if (watch) {
  const { context } = await import("esbuild");
  const ctx = await context(buildOptions);
  await ctx.watch();
  await (await context(xlsxOptions)).watch();
  for (const options of platformBuilds) await (await context(options)).watch();
  console.log("Build em observação. Pressione Ctrl+C para encerrar.");
} else {
  await build(buildOptions);
  await build(xlsxOptions);
  await Promise.all(platformBuilds.map((options) => build(options)));
  // Mantém o index da raiz sincronizado para quem abrir o projeto localmente.
  await copyFile(resolve(www, "index.html"), resolve(root, "index.html"));
  console.log("Build concluído em www/.");
}
