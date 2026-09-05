import { build } from "esbuild";
import { copyFile, cp, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const www = resolve(root, "www");
const watch = process.argv.includes("--watch");

// Estes dois valores são públicos por definição: o navegador precisa recebê-los.
// Variáveis da Vercel continuam tendo prioridade e permitem trocar de ambiente.
const productionDefaults = {
  SUPABASE_URL: "https://lelverljfukbekitqcjm.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "sb_publishable_zvlhpZaRvPuaeYrBgOsndw_2eHO-4zK"
};

const config = {
  SUPABASE_URL: process.env.SUPABASE_URL ?? productionDefaults.SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY:
    process.env.SUPABASE_PUBLISHABLE_KEY ?? productionDefaults.SUPABASE_PUBLISHABLE_KEY,
  APP_PROJECT_SLUG: process.env.APP_PROJECT_SLUG ?? "alto-do-jeriva"
};

await mkdir(www, { recursive: true });
await cp(resolve(root, "assets"), resolve(www, "assets"), { recursive: true });
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

if (watch) {
  const { context } = await import("esbuild");
  const ctx = await context(buildOptions);
  await ctx.watch();
  console.log("Build em observação. Pressione Ctrl+C para encerrar.");
} else {
  await build(buildOptions);
  // Mantém o index da raiz sincronizado para quem abrir o projeto localmente.
  await copyFile(resolve(www, "index.html"), resolve(root, "index.html"));
  console.log("Build concluído em www/.");
}
