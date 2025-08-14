import { defineConfig } from "vite";

export default defineConfig({
  build: {
    lib: {
      entry: "src/preload.ts",
      formats: ["cjs"],
      fileName: () => "preload.js",
    },
    outDir: ".vite/build",
    rollupOptions: {
      external: ["electron"],
    },
  },
});
