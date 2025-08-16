/// <reference types="vite/client" />

interface ElectronAPI {
  dbSave: (data: Uint8Array | ArrayBuffer) => Promise<void>;
  dbLoad: () => Promise<ArrayBuffer | null>;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

export {};
