import { app, BrowserWindow, shell, ipcMain, protocol } from "electron";
import * as path from "path";
import * as fs from "fs";
import { logger } from "./lib/logger";

// These are injected by @electron-forge/plugin-vite at build/dev time
// eslint-disable-next-line @typescript-eslint/no-unused-vars
declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
declare const MAIN_WINDOW_VITE_NAME: string | undefined;

const allowDevTools =
  !app.isPackaged || process.env.ELECTRON_ENABLE_DEVTOOLS === "1";
const autoOpenDevTools =
  allowDevTools &&
  (!app.isPackaged || process.env.OPEN_DEVTOOLS_ON_START === "1");

if (process.platform === "win32") {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const squirrel = require("electron-squirrel-startup");
    if (squirrel) app.quit();
  } catch {
    // Ignore if not installed
  }
}

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

  if (allowDevTools) {
    const toggleDevTools = () => {
      if (win.webContents.isDevToolsOpened()) {
        win.webContents.closeDevTools();
      } else {
        win.webContents.openDevTools({ mode: "detach" });
      }
    };

    win.webContents.on("before-input-event", (event, input) => {
      const key = input.key?.toLowerCase();
      const isToggleShortcut =
        (key === "i" && input.control && input.shift) || key === "f12";
      if (isToggleShortcut) {
        event.preventDefault();
        toggleDevTools();
      }
    });

    if (autoOpenDevTools) {
      win.webContents.once("did-finish-load", () => {
        if (!win.webContents.isDevToolsOpened()) {
          win.webContents.openDevTools({ mode: "detach" });
        }
      });
    }
  }
};

// Register custom protocol before app is ready
protocol.registerSchemesAsPrivileged([
  {
    scheme: "media",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
]);

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
      // Return custom protocol URL instead of file:// to avoid renderer restrictions
      const customUrl = `media:///${encodeURI(safeRel)}`;
      return customUrl;
    } catch (e) {
      logger.error("media:getFileUrl failed", e);
      return null;
    }
  });

  // Get the absolute media directory path
  ipcMain.handle("media:getDir", async () => {
    return mediaDir;
  });

  // Register media:// protocol to serve files from the userData/media directory BEFORE window loads
  try {
    protocol.registerFileProtocol("media", (request, callback) => {
      try {
        const url = new URL(request.url);
        // Allow both media:///rel and media://host/rel
        const host = url.host || "";
        const pathname = url.pathname || "";
        const joined = host
          ? `${host}${pathname}`
          : pathname.replace(/^\//, "");
        const rel = decodeURI(joined);
        const safeRel = rel.replace(/\\/g, "/").replace(/\.\./g, "");
        const fullPath = path.join(mediaDir, safeRel);
        callback({ path: fullPath });
      } catch (err) {
        logger.error("media protocol handler error", err);
        callback({ error: -2 }); // FILE_NOT_FOUND
      }
    });
  } catch (e) {
    logger.error("Failed to register media:// protocol", e);
  }

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
