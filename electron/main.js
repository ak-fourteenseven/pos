/**
 * 茶餐廳 POS - Electron 主進程
 * 啟動 Python 後端、Socket.io 服務，載入 React 前端
 */
const { app, BrowserWindow, ipcMain } = require("electron");
const { spawn } = require("child_process");
const path = require("path");
const net = require("net");

let mainWindow = null;
let pythonProcess = null;
let socketProcess = null;

const BACKEND_PORT = 8008;
const SOCKET_PORT = 3000;
const BACKEND_URL = `http://localhost:${BACKEND_PORT}`;

// ---------- 啟動子進程 ----------

function startPythonBackend() {
  const backendDir = path.join(__dirname, "..");
  pythonProcess = spawn("python", ["-m", "uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", String(BACKEND_PORT)], {
    cwd: backendDir,
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, PYTHONUNBUFFERED: "1" },
  });

  pythonProcess.stdout.on("data", (data) => {
    console.log(`[Python] ${data.toString().trim()}`);
  });

  pythonProcess.stderr.on("data", (data) => {
    console.log(`[Python] ${data.toString().trim()}`);
  });

  pythonProcess.on("close", (code) => {
    console.log(`[Python] 進程退出，代碼: ${code}`);
  });
}

function startSocketServer() {
  const socketDir = path.join(__dirname, "..", "socket-server");
  socketProcess = spawn("node", ["server.js"], {
    cwd: socketDir,
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, SOCKET_PORT: String(SOCKET_PORT) },
  });

  socketProcess.stdout.on("data", (data) => {
    console.log(`[Socket] ${data.toString().trim()}`);
  });

  socketProcess.stderr.on("data", (data) => {
    console.log(`[Socket] ${data.toString().trim()}`);
  });
}

function waitForBackend(timeout = 15000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = () => {
      const client = new net.Socket();
      client.connect(BACKEND_PORT, "127.0.0.1", () => {
        client.destroy();
        resolve();
      });
      client.on("error", () => {
        if (Date.now() - start > timeout) {
          reject(new Error("後端啟動超時"));
        } else {
          setTimeout(check, 500);
        }
      });
    };
    check();
  });
}

// ---------- 視窗管理 ----------

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 900,
    fullscreen: true,
    frame: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
    backgroundColor: "#1a1a2e",
  });

  // 開發模式：載入 Vite 開發服務器
  const isDev = process.env.NODE_ENV === "development" || !app.isPackaged;
  if (isDev) {
    mainWindow.loadURL("http://localhost:5173");
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, "..", "frontend", "dist", "index.html"));
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

// ---------- IPC 處理 ----------

ipcMain.handle("get-backend-url", () => BACKEND_URL);
ipcMain.handle("get-socket-url", () => `http://localhost:${SOCKET_PORT}`);

ipcMain.handle("minimize-window", () => mainWindow?.minimize());
ipcMain.handle("maximize-window", () => {
  if (mainWindow?.isMaximized()) {
    mainWindow.unmaximize();
  } else {
    mainWindow?.maximize();
  }
});
ipcMain.handle("close-window", () => mainWindow?.close());

// ---------- 應用生命週期 ----------

app.whenReady().then(async () => {
  startPythonBackend();
  startSocketServer();

  try {
    await waitForBackend();
    console.log("[Electron] 後端已就緒");
  } catch (err) {
    console.error("[Electron] 後端啟動失敗:", err.message);
  }

  createWindow();
});

app.on("window-all-closed", () => {
  if (pythonProcess) pythonProcess.kill();
  if (socketProcess) socketProcess.kill();
  app.quit();
});

app.on("before-quit", () => {
  if (pythonProcess) pythonProcess.kill();
  if (socketProcess) socketProcess.kill();
});
