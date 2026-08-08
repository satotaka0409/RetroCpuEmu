import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@emu": path.join(here, "../retrocpu_emu/src"),
      "@asm": path.join(here, "../retrocpu_asm/src/main"),
    },
  },
  server: {
    fs: {
      allow: [path.join(here, "..")],
    },
  },
});
