import { defineConfig } from "vitest/config";
import path from "node:path";
import { readFileSync } from "node:fs";
import { configureTestTempEnvironment } from "./tests/helpers/test-temp";

configureTestTempEnvironment();

// issues/12：与两个 vite 构建同源注入版本身份，契约测试断言 /healthz 的 version 字段。
const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as { version: string };

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname, ".") },
  },
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  test: {
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
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
