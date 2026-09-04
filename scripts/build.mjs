import { build } from "esbuild";
import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const www = resolve(root, "www");
const watch = process.argv.includes("--watch");

const config = {
  SUPABASE_URL: process.env.SUPABASE_URL ?? "",
  SUPABASE_PUBLISHABLE_KEY: process.env.SUPABASE_PUBLISHABLE_KEY ?? "",
  APP_PROJECT_SLUG: process.env.APP_PROJECT_SLUG ?? "alto-do-jeriva"
};

if (process.env.VERCEL === "1" && (!config.SUPABASE_URL || !config.SUPABASE_PUBLISHABLE_KEY)) {
  throw new Error(
    "Configure SUPABASE_URL e SUPABASE_PUBLISHABLE_KEY em Vercel > Project Settings > Environment Variables."
  );
}

await mkdir(www, { recursive: true });
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
