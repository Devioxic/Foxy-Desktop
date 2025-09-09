import { defineConfig } from "vite";
import path from "path"; 
export default defineConfig({
  optimizeDeps: {
    exclude: ["discord-rpc", "ws", "bufferutil", "utf-8-validate"],
  },
  resolve: {
    alias: {
      "register-scheme": path.resolve(__dirname, "src/empty-register-scheme.ts"),
      bufferutil: false as any,
      "utf-8-validate": false as any,
    },
  },
  build: {
    lib: { entry: "src/main.ts", formats: ["cjs"] }, // keep CJS
    outDir: ".vite/build",
    rollupOptions: {
      external: ["electron", "discord-rpc", "ws", "bufferutil", "utf-8-validate"],
    },
    commonjsOptions: {
      ignoreTryCatch: false,
      transformMixedEsModules: true,
    },
  },
});