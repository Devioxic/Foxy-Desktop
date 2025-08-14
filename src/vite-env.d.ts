/// <reference types="vite/client" />

interface ElectronAPI {
  ping: () => Promise<string>;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

export {};
