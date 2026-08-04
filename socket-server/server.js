/**
 * 茶餐廳 POS - Socket.io 即時通訊服務
 * 負責 KDS 訂單推送、局域網多機狀態同步
 *
 * 由 Electron 主進程啟動為子進程
 * 默認端口 3000
 */

const { Server } = require("socket.io");

const PORT = process.env.SOCKET_PORT || 3000;

const io = new Server({
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

// 連線管理
io.on("connection", (socket) => {
  console.log(`[Socket] 新連線: ${socket.id}`);

  // 客戶端註冊角色（收銀端 / KDS 端）
  socket.on("register", (data) => {
    const { role, deviceName } = data || {};
    socket.data.role = role;
    socket.data.deviceName = deviceName || socket.id;
    console.log(`[Socket] ${socket.id} 註冊為 ${role} (${socket.data.deviceName})`);

    // 通知所有客戶端設備列表更新
    io.emit("device_update", {
      type: "join",
      socketId: socket.id,
      role,
      deviceName: socket.data.deviceName,
    });
  });

  // 收銀端送廚：推送新訂單菜品到 KDS
  socket.on("send_to_kitchen", (data) => {
    console.log(`[Socket] 送廚: 訂單 ${data.orderNumber}, ${data.items?.length || 0} 個菜品`);
    // 廣播給所有 KDS 端
    io.emit("kds_new_order", {
      ...data,
      sentAt: new Date().toISOString(),
    });
  });

  // KDS 端更新菜品狀態
  socket.on("kds_status_update", (data) => {
    const { itemId, status, orderNumber } = data;
    console.log(`[Socket] KDS 狀態更新: ${itemId} -> ${status}`);
    // 通知收銀端
    io.emit("kds_status_changed", {
      itemId,
      status,
      orderNumber,
      updatedAt: new Date().toISOString(),
    });
  });

  // 訂單變更通知（結帳、退款等）
  socket.on("order_changed", (data) => {
    io.emit("order_updated", {
      ...data,
      timestamp: new Date().toISOString(),
    });
  });

  socket.on("disconnect", () => {
    console.log(`[Socket] 離線: ${socket.id}`);
    io.emit("device_update", {
      type: "leave",
      socketId: socket.id,
      role: socket.data.role,
    });
  });
});

io.listen(PORT);
console.log(`[Socket] 服務已啟動，端口 ${PORT}`);
