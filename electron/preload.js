/**
 * Electron 預加載腳本
 * 安全地暴露後端 API 與 Socket 連接資訊給渲染進程
 */
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  getBackendUrl: () => ipcRenderer.invoke("get-backend-url"),
  getSocketUrl: () => ipcRenderer.invoke("get-socket-url"),
  minimizeWindow: () => ipcRenderer.invoke("minimize-window"),
  maximizeWindow: () => ipcRenderer.invoke("maximize-window"),
  closeWindow: () => ipcRenderer.invoke("close-window"),
});
