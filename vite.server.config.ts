import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  resolve: {
    alias: { "@": root },
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
