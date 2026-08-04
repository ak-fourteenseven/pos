/**
 * Socket.io 客戶端服務
 * 連接 Node.js Socket 伺服器（KDS 即時推送、局域網同步）
 */
import { io } from "socket.io-client";

let socket = null;

export function connectSocket(serverUrl = "http://localhost:3000") {
  if (socket?.connected) return socket;

  socket = io(serverUrl, {
    transports: ["websocket"],
    autoConnect: true,
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionAttempts: 10,
  });

  socket.on("connect", () => {
    console.log("[Socket] 已連接:", socket.id);
  });

  socket.on("disconnect", () => {
    console.log("[Socket] 已斷開");
  });

  socket.on("connect_error", (err) => {
    console.error("[Socket] 連接錯誤:", err.message);
  });

  return socket;
}

export function getSocket() {
  return socket;
}

export function registerDevice(role, deviceName) {
  socket?.emit("register", { role, deviceName });
}

export function sendToKitchen(orderData) {
  socket?.emit("send_to_kitchen", orderData);
}

export function updateKdsStatus(itemId, status, orderNumber) {
  socket?.emit("kds_status_update", { itemId, status, orderNumber });
}

export function notifyOrderChanged(data) {
  socket?.emit("order_changed", data);
}

// 監聽事件
export function onKdsNewOrder(callback) {
  socket?.on("kds_new_order", callback);
  return () => socket?.off("kds_new_order", callback);
}

export function onKdsStatusChanged(callback) {
  socket?.on("kds_status_changed", callback);
  return () => socket?.off("kds_status_changed", callback);
}

export function onOrderUpdated(callback) {
  socket?.on("order_updated", callback);
  return () => socket?.off("order_updated", callback);
}

export function onDeviceUpdate(callback) {
  socket?.on("device_update", callback);
  return () => socket?.off("device_update", callback);
}
