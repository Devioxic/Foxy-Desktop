import { defineConfig } from "vite";

export default defineConfig({
  build: {
    lib: {
      entry: "src/main.ts",
      formats: ["cjs"],
    },
    outDir: ".vite/build",
    rollupOptions: {
      external: ["electron"],
    },
  },
});
