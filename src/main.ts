import { app, BrowserWindow, shell, ipcMain } from "electron";
import * as path from "path";
import * as fs from "fs";
import { logger } from "./lib/logger";

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
      logger.error("Main: db:save failed", e);
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
      logger.error("Main: db:load failed", e);
      return null;
    }
  });

  // IPC for media persistence (downloads)
  const mediaDir = path.join(app.getPath("userData"), "media");
  // Ensure media directory exists
  try {
    if (!fs.existsSync(mediaDir)) {
      fs.mkdirSync(mediaDir, { recursive: true });
    }
  } catch (e) {
    logger.error("Failed to create media directory", e);
  }

  // Save a media file buffer to media dir under a relative path (e.g., "tracks/<id>.mp3")
  ipcMain.handle(
    "media:save",
    async (_evt, relativePath: string, data: ArrayBuffer) => {
      try {
        const safeRel = relativePath.replace(/\\/g, "/").replace(/\.+/g, ".");
        const fullPath = path.join(mediaDir, safeRel);
        await fs.promises.mkdir(path.dirname(fullPath), { recursive: true });
        const tmp = `${fullPath}.tmp`;
        await fs.promises.writeFile(tmp, Buffer.from(data));
        await fs.promises.rename(tmp, fullPath);
        return fullPath;
      } catch (e) {
        logger.error("media:save failed", e);
        throw e;
      }
    }
  );

  // Delete a media file under media dir
  ipcMain.handle("media:delete", async (_evt, relativePath: string) => {
    try {
      const safeRel = relativePath.replace(/\\/g, "/").replace(/\.+/g, ".");
      const fullPath = path.join(mediaDir, safeRel);
      if (fs.existsSync(fullPath)) await fs.promises.unlink(fullPath);
      return true;
    } catch (e) {
      logger.error("media:delete failed", e);
      return false;
    }
  });

  // Resolve an absolute path for a relative media file and return file:// URL
  ipcMain.handle("media:getFileUrl", async (_evt, relativePath: string) => {
    try {
      const safeRel = relativePath.replace(/\\/g, "/").replace(/\.+/g, ".");
      const fullPath = path.join(mediaDir, safeRel);
      if (!fs.existsSync(fullPath)) return null;
      const url = `file://${fullPath.replace(/ /g, "%20")}`;
      return url;
    } catch (e) {
      logger.error("media:getFileUrl failed", e);
      return null;
    }
  });

  // Get the absolute media directory path
  ipcMain.handle("media:getDir", async () => {
    return mediaDir;
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
