import React, { useState, useEffect } from "react";
import { reportsApi } from "../services/api";

/**
 * 報表頁面
 * 五張核心報表：日銷售、商品排行、毛利、對賬、退貨原因
 */
export default function ReportsPage() {
  const [activeReport, setActiveReport] = useState("daily");
  const [dailyData, setDailyData] = useState(null);
  const [rankingData, setRankingData] = useState([]);
  const [profitData, setProfitData] = useState(null);
  const [refundData, setRefundData] = useState(null);
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadReport();
  }, [activeReport, date]);

  const loadReport = async () => {
    setLoading(true);
    try {
      switch (activeReport) {
        case "daily": {
          const data = await reportsApi.dailySales(date);
          setDailyData(data);
          break;
        }
        case "ranking": {
          const data = await reportsApi.productRanking(date);
          setRankingData(data.ranking);
          break;
        }
        case "profit": {
          const data = await reportsApi.grossProfit(date);
          setProfitData(data);
          break;
        }
        case "refund": {
          const data = await reportsApi.refundReasons(date);
          setRefundData(data);
          break;
        }
      }
    } catch (e) {
      console.error("報表載入失敗:", e);
    }
    setLoading(false);
  };

  const paymentMethods = {
    cash: "現金",
    wechat: "微信",
    alipay: "支付寶",
    card: "刷卡",
  };

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      {/* 頂部導航 */}
      <div className="flex items-center justify-between mb-12">
        <div className="flex gap-8">
          {[
            { key: "daily", label: "日銷售" },
            { key: "ranking", label: "商品排行" },
            { key: "profit", label: "毛利" },
            { key: "refund", label: "退貨原因" },
          ].map((tab) => (
            <button
              key={tab.key}
              className={`btn btn-large ${activeReport === tab.key ? "btn-primary" : "btn-secondary"}`}
              onClick={() => setActiveReport(tab.key)}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <input
          type="date"
          className="input"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          style={{ width: 200 }}
        />
      </div>

      {/* 報表內容 */}
      <div style={{ flex: 1, overflowY: "auto" }}>
        {loading ? (
          <div className="text-center text-muted" style={{ padding: 40 }}>載入中...</div>
        ) : activeReport === "daily" && dailyData ? (
          <div>
            <div className="grid grid-4 gap-12 mb-12">
              <div className="card text-center">
                <div className="text-sm text-muted">訂單數</div>
                <div style={{ fontSize: "var(--font-size-xl)", fontWeight: 700 }}>{dailyData.totalOrders}</div>
              </div>
              <div className="card text-center">
                <div className="text-sm text-muted">銷售額</div>
                <div className="amount" style={{ fontSize: "var(--font-size-xl)", fontWeight: 700 }}>${dailyData.totalSales}</div>
              </div>
              <div className="card text-center">
                <div className="text-sm text-muted">退款</div>
                <div className="amount-negative" style={{ fontSize: "var(--font-size-xl)", fontWeight: 700 }}>${dailyData.totalRefund}</div>
              </div>
              <div className="card text-center">
                <div className="text-sm text-muted">淨收入</div>
                <div className="amount-positive" style={{ fontSize: "var(--font-size-xl)", fontWeight: 700 }}>${dailyData.netSales}</div>
              </div>
            </div>
            <div className="card">
              <div className="card-title">支付方式分布</div>
              <table className="table-touch">
                <thead>
                  <tr>
                    <th>支付方式</th>
                    <th>金額</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(dailyData.paymentBreakdown || {}).map(([method, amount]) => (
                    <tr key={method}>
                      <td>{paymentMethods[method] || method}</td>
                      <td className="amount">${amount.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : activeReport === "ranking" ? (
          <div className="card">
            <div className="card-title">商品銷售排行</div>
            <table className="table-touch">
              <thead>
                <tr>
                  <th>排名</th>
                  <th>商品</th>
                  <th>銷量</th>
                  <th>銷售額</th>
                </tr>
              </thead>
              <tbody>
                {rankingData.map((item, i) => (
                  <tr key={item.productName}>
                    <td style={{ fontWeight: 700, color: i < 3 ? "var(--accent)" : "inherit" }}>#{i + 1}</td>
                    <td>{item.productName}</td>
                    <td>{item.quantity}</td>
                    <td className="amount">${item.totalSales.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : activeReport === "profit" && profitData ? (
          <div>
            <div className="grid grid-4 gap-12 mb-12">
              <div className="card text-center">
                <div className="text-sm text-muted">總收入</div>
                <div style={{ fontSize: "var(--font-size-xl)", fontWeight: 700 }}>${profitData.totalRevenue}</div>
              </div>
              <div className="card text-center">
                <div className="text-sm text-muted">總成本</div>
                <div style={{ fontSize: "var(--font-size-xl)", fontWeight: 700 }}>${profitData.totalCost}</div>
              </div>
              <div className="card text-center">
                <div className="text-sm text-muted">毛利額</div>
                <div className="amount-positive" style={{ fontSize: "var(--font-size-xl)", fontWeight: 700 }}>${profitData.totalProfit}</div>
              </div>
              <div className="card text-center">
                <div className="text-sm text-muted">毛利率</div>
                <div style={{ fontSize: "var(--font-size-xl)", fontWeight: 700 }}>{profitData.totalMargin}%</div>
              </div>
            </div>
            <div className="card">
              <div className="card-title">商品毛利明細</div>
              <table className="table-touch">
                <thead>
                  <tr>
                    <th>商品</th>
                    <th>銷量</th>
                    <th>收入</th>
                    <th>成本</th>
                    <th>毛利</th>
                    <th>毛利率</th>
                  </tr>
                </thead>
                <tbody>
                  {(profitData.items || []).map((item) => (
                    <tr key={item.productName}>
                      <td>{item.productName}</td>
                      <td>{item.quantity}</td>
                      <td className="amount">${item.revenue.toFixed(2)}</td>
                      <td className="amount">${item.costTotal.toFixed(2)}</td>
                      <td className="amount-positive">${item.profit.toFixed(2)}</td>
                      <td>{item.margin}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : activeReport === "refund" && refundData ? (
          <div className="card">
            <div className="card-title">退貨記錄 - 共 {refundData.count} 筆</div>
            <table className="table-touch">
              <thead>
                <tr>
                  <th>時間</th>
                  <th>操作人</th>
                  <th>金額</th>
                  <th>原因</th>
                </tr>
              </thead>
              <tbody>
                {refundData.refunds.map((r, i) => (
                  <tr key={i}>
                    <td>{r.time ? new Date(r.time).toLocaleTimeString("zh-HK") : "-"}</td>
                    <td>{r.operator}</td>
                    <td className="amount-negative">${r.amount}</td>
                    <td>{r.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="text-center text-muted" style={{ padding: 40 }}>暫無數據</div>
        )}
      </div>
    </div>
  );
}
