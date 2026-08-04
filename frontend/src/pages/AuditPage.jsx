import React, { useState, useEffect } from "react";
import { auditApi } from "../services/api";

/**
 * 審計日誌頁面
 * 敏感操作留痕：改價、刪菜、退款、折扣
 */
export default function AuditPage() {
  const [logs, setLogs] = useState([]);
  const [filter, setFilter] = useState("all");

  useEffect(() => {
    loadLogs();
  }, [filter]);

  const loadLogs = async () => {
    try {
      const params = {};
      if (filter !== "all") params.action_type = filter;
      const data = await auditApi.list(params);
      setLogs(data.logs);
    } catch (e) {
      console.error("審計載入失敗:", e);
    }
  };

  const actionLabels = {
    delete_item: "刪菜",
    apply_discount: "折扣",
    refund: "退款",
  };

  const actionBadge = (type) => {
    switch (type) {
      case "delete_item": return "badge badge-danger";
      case "apply_discount": return "badge badge-warning";
      case "refund": return "badge badge-danger";
      default: return "badge";
    }
  };

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <div className="flex items-center justify-between mb-12">
        <h2 style={{ fontSize: "var(--font-size-xl)" }}>操作審計日誌</h2>
        <div className="flex gap-8">
          {[
            { key: "all", label: "全部" },
            { key: "delete_item", label: "刪菜" },
            { key: "apply_discount", label: "折扣" },
            { key: "refund", label: "退款" },
          ].map((tab) => (
            <button
              key={tab.key}
              className={`btn ${filter === tab.key ? "btn-primary" : "btn-secondary"}`}
              onClick={() => setFilter(tab.key)}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div style={{ flex: 1, overflowY: "auto" }}>
        <div className="card">
          <table className="table-touch">
            <thead>
              <tr>
                <th>時間</th>
                <th>操作類型</th>
                <th>對象</th>
                <th>原值</th>
                <th>新值</th>
                <th>原因</th>
                <th>操作人</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => (
                <tr key={log.id}>
                  <td>{log.created_at ? new Date(log.created_at).toLocaleString("zh-HK") : "-"}</td>
                  <td><span className={actionBadge(log.action_type)}>{actionLabels[log.action_type] || log.action_type}</span></td>
                  <td className="text-sm">{log.target_type}:{log.target_id?.slice(0, 8)}</td>
                  <td className="text-sm">{log.old_value || "-"}</td>
                  <td className="text-sm">{log.new_value || "-"}</td>
                  <td className="text-sm text-muted">{log.reason || "-"}</td>
                  <td>{log.operator}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {logs.length === 0 && (
            <div className="text-center text-muted" style={{ padding: 40 }}>暫無審計記錄</div>
          )}
        </div>
      </div>
    </div>
  );
}
