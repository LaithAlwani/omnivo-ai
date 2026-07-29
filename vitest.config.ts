import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Convex functions run in an edge-like runtime; convex-test needs this.
    environment: "edge-runtime",
    include: ["convex/**/*.test.ts"],
    server: { deps: { inline: ["convex-test"] } },
    // Run test files sequentially. Every file passes on its own; only the
    // multi-worker run races — a background scheduled function's console log can
    // be mid-flight when a worker's RPC closes ("Closing rpc while
    // onUserConsoleLog was pending"), flipping the exit code despite 60/60
    // passing. No parallelism removes that race; the suite is small (~2s).
    fileParallelism: false,
  },
});
