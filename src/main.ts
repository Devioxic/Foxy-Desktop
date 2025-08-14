import { app, BrowserWindow, shell } from "electron";
import * as path from "path";

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
