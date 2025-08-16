import { contextBridge, ipcRenderer } from "electron";

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
});
