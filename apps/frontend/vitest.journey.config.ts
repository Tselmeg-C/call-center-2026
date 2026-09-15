import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

// Separate, slower config: these tests spawn the real FastAPI backend (CALL_CENTER_STORAGE=memory)
// as a child process and exercise the actual services/http.ts adapter over real HTTP. Kept out of
// the default `npm test` run (see vitest.config.ts's exclude) so CI's fast lane never needs Python.
export default defineConfig({
  resolve: { alias: { "@": resolve(process.cwd(), "src") } },
  test: {
    environment: "node",
    include: ["src/**/*.journey.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    fileParallelism: false,
  },
});
