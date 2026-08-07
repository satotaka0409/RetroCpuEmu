import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  root: "src/main",
  plugins: [react()],
  server: {
    port: 5173,
    // WSL 上で Windows 側ブラウザから localhost で触れるよう待受
    host: "127.0.0.1",
    strictPort: true,
  },
  build: {
    outDir: "../../dist",
    emptyOutDir: true,
    sourcemap: true,
  },
  test: {
    globals: true,
    environment: "node",
    include: ["**/*.test.ts", "../test/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["**/*.ts"],
      exclude: ["**/*.test.ts"],
    },
  },
});
