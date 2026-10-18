import path from "node:path";
import { defineConfig } from "vitest/config";

process.loadEnvFile(".env");

export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  test: { fileParallelism: false, include: ["src/**/*.test.ts"] },
});
