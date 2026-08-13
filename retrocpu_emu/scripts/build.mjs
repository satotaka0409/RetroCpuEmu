import { build } from "esbuild";
import { cpSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

mkdirSync(join(root, "dist/electron"), { recursive: true });
mkdirSync(join(root, "dist/renderer"), { recursive: true });

/** winston は動的 require を含むためバンドルせず node_modules から解決させる */
const nodeExternal = ["electron", "winston"];

await build({
  entryPoints: [join(root, "src/electron/main.ts")],
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20",
  outfile: join(root, "dist/electron/main.js"),
  external: nodeExternal,
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

const workers = [
  ["src/cpuboard/worker.ts", "cpu_worker.js"],
  ["src/ioboard/worker.ts", "io_worker.js"],
];
for (const [entry, outfile] of workers) {
  await build({
    entryPoints: [join(root, entry)],
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node20",
    outfile: join(root, `dist/electron/${outfile}`),
    external: nodeExternal,
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

const monIhx = join(root, "../retrocpu_boot_monitor/build/hex/mn1613_mon.ihx");
const monDestDir = join(root, "dist/assets");
if (existsSync(monIhx)) {
  mkdirSync(monDestDir, { recursive: true });
  cpSync(monIhx, join(monDestDir, "boot_monitor.ihx"));
  console.log("copied boot_monitor.ihx -> dist/assets/");
} else {
  console.warn("boot monitor IHX not found (make ihx in retrocpu_boot_monitor):", monIhx);
}

console.log("build ok -> dist/");
