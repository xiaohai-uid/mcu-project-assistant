import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname, ".") },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    pool: "forks",
    poolOptions: {
      forks: {
        // The compiler contract suite verifies process-wide cwd isolation around
        // a real child process. Keep the test process single so that this
        // intentional chdir cannot race another worker.
        singleFork: true,
      },
    },
  },
});
