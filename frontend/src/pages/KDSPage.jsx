import React, { useState, useEffect } from "react";
import { ordersApi, kdsApi } from "../services/api";
import { connectSocket, registerDevice, onKdsNewOrder, updateKdsStatus } from "../services/socket";

/**
 * 廚房顯示系統 (KDS)
 * 顯示待製作、製作中、已完成的菜品
 */
export default function KDSPage() {
  const [items, setItems] = useState([]);
  const [activeTab, setActiveTab] = useState("pending"); // pending / cooking / done
  const [soundEnabled, setSoundEnabled] = useState(true);

  useEffect(() => {
    loadItems();
    const interval = setInterval(loadItems, 5000);

    const socket = connectSocket();
    registerDevice("kds", "廚房顯示器");

    const unsub = onKdsNewOrder((data) => {
      if (soundEnabled) playNotification();
      loadItems();
    });

    return () => {
      clearInterval(interval);
      unsub();
    };
  }, [soundEnabled]);

  const loadItems = async () => {
    try {
      const data = await ordersApi.kdsPending();
      setItems(data.items || []);
    } catch (e) {
      console.error("KDS 載入失敗:", e);
    }
  };

  const updateStatus = async (item, newStatus) => {
    try {
      await kdsApi.updateItemStatus(item.id, newStatus, "kitchen");
      updateKdsStatus(item.id, newStatus, item.orderNumber);
      loadItems();
    } catch (e) {
      console.error("狀態更新失敗:", e);
    }
  };

  const playNotification = () => {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = 880;
      osc.type = "sine";
      gain.gain.value = 0.3;
      osc.start();
      setTimeout(() => { osc.stop(); ctx.close(); }, 200);
    } catch (e) {}
  };

  const filteredItems = items.filter((item) => {
    if (activeTab === "pending") return item.status === "sent_to_kitchen";
    if (activeTab === "cooking") return item.status === "cooking";
    if (activeTab === "done") return item.status === "ready" || item.status === "served";
    return true;
  });

  const counts = {
    pending: items.filter((i) => i.status === "sent_to_kitchen").length,
    cooking: items.filter((i) => i.status === "cooking").length,
    done: items.filter((i) => ["ready", "served"].includes(i.status)).length,
  };

  const statusLabel = (status) => {
    switch (status) {
      case "sent_to_kitchen": return "待製作";
      case "cooking": return "製作中";
      case "ready": return "已完成";
      case "served": return "已出餐";
      default: return status;
    }
  };

  const statusBadge = (status) => {
    switch (status) {
      case "sent_to_kitchen": return "badge badge-warning";
      case "cooking": return "badge badge-warning";
      case "ready": return "badge badge-success";
      case "served": return "badge badge-info";
      default: return "badge";
    }
  };

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      {/* 頂部操作欄 */}
      <div className="flex items-center justify-between mb-12">
        <div className="flex gap-8">
          <button
            className={`btn btn-large ${activeTab === "pending" ? "btn-primary" : "btn-secondary"}`}
            onClick={() => setActiveTab("pending")}
            style={{ fontSize: "var(--font-size-lg)" }}
          >
            待製作 ({counts.pending})
          </button>
          <button
            className={`btn btn-large ${activeTab === "cooking" ? "btn-primary" : "btn-secondary"}`}
            onClick={() => setActiveTab("cooking")}
            style={{ fontSize: "var(--font-size-lg)" }}
          >
            製作中 ({counts.cooking})
          </button>
          <button
            className={`btn btn-large ${activeTab === "done" ? "btn-primary" : "btn-secondary"}`}
            onClick={() => setActiveTab("done")}
            style={{ fontSize: "var(--font-size-lg)" }}
          >
            已完成 ({counts.done})
          </button>
        </div>
        <button
          className={`btn ${soundEnabled ? "btn-success" : "btn-secondary"}`}
          onClick={() => setSoundEnabled(!soundEnabled)}
        >
          {soundEnabled ? "音效: 開" : "音效: 關"}
        </button>
      </div>

      {/* 菜品卡片網格 */}
      <div style={{ flex: 1, overflowY: "auto" }}>
        {filteredItems.length === 0 ? (
          <div className="text-center text-muted" style={{ padding: "60px 0", fontSize: "var(--font-size-xl)" }}>
            暫無訂單
          </div>
        ) : (
          <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))" }}>
            {filteredItems.map((item) => (
              <div key={item.id} className="card" style={{ borderLeft: `4px solid ${item.status === "sent_to_kitchen" ? "var(--warning)" : item.status === "cooking" ? "#3498db" : "var(--success)"}` }}>
                <div className="flex items-center justify-between mb-8">
                  <span style={{ fontSize: "var(--font-size-lg)", fontWeight: 700 }}>{item.productName}</span>
                  <span className={statusBadge(item.status)}>{statusLabel(item.status)}</span>
                </div>
                <div className="flex items-center justify-between text-sm text-muted mb-8">
                  <span>桌號: {item.tableName}</span>
                  <span>訂單: {item.orderNumber}</span>
                  <span>x{item.quantity}</span>
                </div>
                {item.note && (
                  <div className="text-sm" style={{ color: "var(--accent)", marginBottom: 8 }}>
                    備註: {item.note}
                  </div>
                )}
                {/* 等待時間 */}
                {item.sentToKitchenAt && (
                  <div className="text-sm text-muted mb-8">
                    等待: {Math.floor((Date.now() - new Date(item.sentToKitchenAt).getTime()) / 60000)} 分鐘
                  </div>
                )}
                {/* 操作按鈕 */}
                <div className="flex gap-8 mt-8">
                  {item.status === "sent_to_kitchen" && (
                    <button className="btn btn-primary btn-block" onClick={() => updateStatus(item, "cooking")}>
                      開始製作
                    </button>
                  )}
                  {item.status === "cooking" && (
                    <button className="btn btn-success btn-block" onClick={() => updateStatus(item, "ready")}>
                      製作完成
                    </button>
                  )}
                  {item.status === "ready" && (
                    <button className="btn btn-secondary btn-block" onClick={() => updateStatus(item, "served")}>
                      確認出餐
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
