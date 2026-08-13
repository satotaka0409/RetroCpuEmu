import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["test/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: [
        "src/ioboard/**/*.ts",
        "src/cpuboard/**/*.ts",
        "src/shared/**/*.ts",
        "src/code_test/**/*.ts",
        "src/log/**/*.ts",
      ],
      exclude: ["**/*.test.ts"],
    },
  },
});
