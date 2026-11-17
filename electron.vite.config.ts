import { resolve } from "node:path";
import { defineConfig } from "electron-vite";
import react from "@vitejs/plugin-react";

// Main stays ESM (package.json "type": "module"); the sandboxed preload must be CommonJS.
export default defineConfig({
  main: {
    build: {
      outDir: "out/main",
      rollupOptions: {
        input: { index: resolve("src/app/main/index.ts") },
        output: { format: "es", entryFileNames: "[name].js" },
      },
    },
  },
  preload: {
    build: {
      outDir: "out/preload",
      rollupOptions: {
        input: { index: resolve("src/app/preload/index.ts") },
        output: { format: "cjs", entryFileNames: "[name].cjs" },
      },
    },
  },
  renderer: {
    root: resolve("src/app/renderer"),
    plugins: [react()],
    build: {
      outDir: resolve("out/renderer"),
      emptyOutDir: true,
      // The page's CSP is default-src 'self', which blocks data: URLs, so fonts and the grain texture must stay files.
      assetsInlineLimit: 0,
      rollupOptions: { input: resolve("src/app/renderer/index.html") },
    },
  },
});
