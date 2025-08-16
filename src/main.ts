import { app, BrowserWindow, shell, ipcMain } from "electron";
import * as path from "path";
import * as fs from "fs";

// These are injected by @electron-forge/plugin-vite at build/dev time
// eslint-disable-next-line @typescript-eslint/no-unused-vars
declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
declare const MAIN_WINDOW_VITE_NAME: string | undefined;

const createWindow = async () => {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
    autoHideMenuBar: true,
    icon: path.join(__dirname, "../public/icon.png"),
  });

  const devServerUrl =
    typeof MAIN_WINDOW_VITE_DEV_SERVER_URL === "string"
      ? MAIN_WINDOW_VITE_DEV_SERVER_URL
      : undefined;
  const viteName =
    (typeof MAIN_WINDOW_VITE_NAME === "string" && MAIN_WINDOW_VITE_NAME) ||
    "main_window";

  if (devServerUrl) {
    await win.loadURL(devServerUrl);
  } else {
    await win.loadFile(
      path.join(__dirname, `../renderer/${viteName}/index.html`)
    );
  }

  // Open external links in default browser
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  win.setMenu(null); // Hide the menu bar
};

app.whenReady().then(async () => {
  // IPC for database persistence
  const dbPath = path.join(app.getPath("userData"), "foxy.sqlite");
  ipcMain.handle("db:save", async (_evt, data: ArrayBuffer) => {
    try {
      // Ensure userData dir exists (it always should) and write atomically
      const tmp = `${dbPath}.tmp`;
      await fs.promises.writeFile(tmp, Buffer.from(data));
      await fs.promises.rename(tmp, dbPath);
      return true;
    } catch (e) {
      console.error("Main: db:save failed", e);
      throw e;
    }
  });
  ipcMain.handle("db:load", async () => {
    try {
      const exists = fs.existsSync(dbPath);
      if (!exists) return null;
      const buf = await fs.promises.readFile(dbPath);
      return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    } catch (e) {
      console.error("Main: db:load failed", e);
      return null;
    }
  });

  await createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
