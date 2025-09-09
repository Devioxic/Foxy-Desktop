import { contextBridge, ipcRenderer } from "electron";
import type { TrackPresence } from "./rpc";

contextBridge.exposeInMainWorld("rpc", {
  update: (p: TrackPresence) => ipcRenderer.invoke("rpc:update", p),
  clear: () => ipcRenderer.invoke("rpc:clear"),
});
// Expose a minimal, safe API if needed by the renderer
contextBridge.exposeInMainWorld("electronAPI", {
  // Persist/load the sql.js database bytes to/from a file in userData
  dbSave: async (data: Uint8Array | ArrayBuffer) => {
    const buffer =
      data instanceof Uint8Array
        ? data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)
        : data;
    await ipcRenderer.invoke("db:save", buffer);
  },
  dbLoad: async (): Promise<ArrayBuffer | null> => {
    const result = await ipcRenderer.invoke("db:load");
    return result ?? null;
  },
  // Media persistence helpers
  mediaSave: async (relativePath: string, data: Uint8Array | ArrayBuffer) => {
    const buffer =
      data instanceof Uint8Array
        ? data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)
        : data;
    return ipcRenderer.invoke("media:save", relativePath, buffer);
  },
  mediaDelete: async (relativePath: string) => {
    return ipcRenderer.invoke("media:delete", relativePath);
  },
  mediaGetFileUrl: async (relativePath: string) => {
    return ipcRenderer.invoke("media:getFileUrl", relativePath);
  },
  mediaGetDir: async () => {
    return ipcRenderer.invoke("media:getDir");
  },
});
