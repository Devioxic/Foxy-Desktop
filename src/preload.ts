import { contextBridge } from "electron";

// Expose a minimal, safe API if needed by the renderer
contextBridge.exposeInMainWorld("electronAPI", {
  // add methods here when needed, keeping the surface minimal
});
