import React, { useState, useEffect } from "react";
import {
  BrowserRouter,
  Routes,
  Route,
  NavLink,
  useNavigate,
} from "react-router-dom";
import { connectSocket, registerDevice } from "./services/socket";
import CashierPage from "./pages/CashierPage";
import KDSPage from "./pages/KDSPage";
import ReportsPage from "./pages/ReportsPage";
import ConfigPage from "./pages/ConfigPage";
import InventoryPage from "./pages/InventoryPage";
import AuditPage from "./pages/AuditPage";

function AppLayout() {
  const [time, setTime] = useState("");
  const navigate = useNavigate();

  useEffect(() => {
    const update = () => {
      const now = new Date();
      setTime(
        now.toLocaleString("zh-HK", {
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        })
      );
    };
    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const socket = connectSocket();
    registerDevice("cashier", "收銀主機");
    return () => socket?.disconnect();
  }, []);

  return (
    <div className="app-layout">
      <header className="top-bar">
        <div className="brand">祥興茶餐廳</div>
        <nav className="nav-tabs">
          <NavLink to="/" end className={({ isActive }) => `nav-tab${isActive ? " active" : ""}`}>
            收銀
          </NavLink>
          <NavLink to="/kds" className={({ isActive }) => `nav-tab${isActive ? " active" : ""}`}>
            KDS
          </NavLink>
          <NavLink to="/reports" className={({ isActive }) => `nav-tab${isActive ? " active" : ""}`}>
            報表
          </NavLink>
          <NavLink to="/inventory" className={({ isActive }) => `nav-tab${isActive ? " active" : ""}`}>
            庫存
          </NavLink>
          <NavLink to="/audit" className={({ isActive }) => `nav-tab${isActive ? " active" : ""}`}>
            審計
          </NavLink>
          <NavLink to="/config" className={({ isActive }) => `nav-tab${isActive ? " active" : ""}`}>
            設定
          </NavLink>
        </nav>
        <div className="time-display">{time}</div>
      </header>
      <main className="main-content">
        <Routes>
          <Route path="/" element={<CashierPage />} />
          <Route path="/kds" element={<KDSPage />} />
          <Route path="/reports" element={<ReportsPage />} />
          <Route path="/inventory" element={<InventoryPage />} />
          <Route path="/audit" element={<AuditPage />} />
          <Route path="/config" element={<ConfigPage />} />
        </Routes>
      </main>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AppLayout />
    </BrowserRouter>
  );
}
