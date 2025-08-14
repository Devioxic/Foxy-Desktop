import { defineConfig } from "vite";
import path from "path";

export default defineConfig({
  // Vite handles TSX via esbuild; React plugin is optional
  root: ".",
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  build: {
    rollupOptions: {
      input: "index.html",
    },
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});
