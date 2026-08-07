import { build } from "esbuild";
import { cpSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

mkdirSync(join(root, "dist/electron"), { recursive: true });
mkdirSync(join(root, "dist/renderer"), { recursive: true });

await build({
  entryPoints: [join(root, "src/electron/main.ts")],
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20",
  outfile: join(root, "dist/electron/main.js"),
  external: ["electron"],
  sourcemap: true,
});

await build({
  entryPoints: [join(root, "src/electron/preload.ts")],
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20",
  outfile: join(root, "dist/electron/preload.js"),
  external: ["electron"],
  sourcemap: true,
});

for (const name of ["cpu_worker", "io_worker"]) {
  await build({
    entryPoints: [join(root, `src/workers/${name}.ts`)],
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node20",
    outfile: join(root, `dist/electron/${name}.js`),
    sourcemap: true,
  });
}

await build({
  entryPoints: [join(root, "src/renderer/app.ts")],
  bundle: true,
  platform: "browser",
  format: "iife",
  target: "chrome120",
  outfile: join(root, "dist/renderer/app.js"),
  sourcemap: true,
});

cpSync(join(root, "src/renderer/index.html"), join(root, "dist/renderer/index.html"));
cpSync(join(root, "src/renderer/styles"), join(root, "dist/renderer/styles"), {
  recursive: true,
});

console.log("build ok -> dist/");
