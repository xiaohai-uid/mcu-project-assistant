import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const root = fileURLToPath(new URL(".", import.meta.url));

// issues/12：版本身份构建期注入（/healthz 暴露；与 app/vite.config.ts、vitest.config.ts 同源）。
const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as { version: string };

export default defineConfig({
  resolve: {
    alias: { "@": root },
  },
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  build: {
    ssr: fileURLToPath(new URL("src/infrastructure/server.ts", import.meta.url)),
    outDir: fileURLToPath(new URL("dist/server", import.meta.url)),
    emptyOutDir: true,
    rollupOptions: {
      output: {
        entryFileNames: "server.js",
      },
    },
  },
});
