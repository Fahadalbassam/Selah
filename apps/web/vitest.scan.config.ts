import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Upload scanning against a real ClamAV daemon. Needs CLAMD_HOST (see README).
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "server-only": fileURLToPath(
        new URL("./tests/stubs/server-only.ts", import.meta.url),
      ),
    },
  },
  test: { include: ["tests/scan/**/*.test.ts"], testTimeout: 60_000 },
});
