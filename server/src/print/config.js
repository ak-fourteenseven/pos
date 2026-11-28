/**
 * 印表機環境變數（server/.env）。
 * OPEN_DRAWER_PRINTER_NAME — 列印並開錢箱
 * PRINTER_NAME — 僅列印
 */
function trim(v) {
  return v == null ? '' : String(v).trim();
}

function getPrinterEnv() {
  return {
    openDrawerPrinter: trim(process.env.OPEN_DRAWER_PRINTER_NAME),
    printer: trim(process.env.PRINTER_NAME),
  };
}

/** 後台／API 顯示用（env 有值時固定） */
function getConfiguredPrinters() {
  const env = getPrinterEnv();
  return {
    open_drawer: env.openDrawerPrinter,
    print_only: env.printer,
    /** 相容舊欄位 */
    receipt: env.openDrawerPrinter || env.printer,
    kitchen: env.printer || env.openDrawerPrinter,
    bar: env.printer || env.openDrawerPrinter,
    fromEnv: !!(env.openDrawerPrinter || env.printer),
  };
}

/**
 * @param {object} opts
 * @param {string} [opts.printer] 明確指定名稱時優先
 * @param {'receipt'|'kitchen'|'bar'} [opts.role]
 * @param {boolean} [opts.openDrawer] 需要開錢箱（通常現金結賬）
 * @returns {{ name: string, openDrawer: boolean } | null}
 */
function resolveEnvPrinter({ printer, role, openDrawer } = {}) {
  const env = getPrinterEnv();
  const direct = printer && String(printer).trim();

  if (direct) {
    const shouldOpen = !!(openDrawer && env.openDrawerPrinter && direct === env.openDrawerPrinter);
    return { name: direct, openDrawer: shouldOpen };
  }

  // 現金收據 → 開錢箱機
  if (openDrawer && env.openDrawerPrinter) {
    return { name: env.openDrawerPrinter, openDrawer: true };
  }

  // 一般收據：優先一般機，否則開錢箱機（但不自動開箱，除非 openDrawer）
  if (role === 'receipt') {
    const name = env.printer || env.openDrawerPrinter;
    if (!name) return null;
    return {
      name,
      openDrawer: !!(openDrawer && name === env.openDrawerPrinter),
    };
  }

  // 廚房／水吧 → 一般機（沒有則退回開錢箱機，仍不開箱）
  if (role === 'kitchen' || role === 'bar') {
    const name = env.printer || env.openDrawerPrinter;
    return name ? { name, openDrawer: false } : null;
  }

  // 未指定 role：有 openDrawer 用開錢箱機，否則一般機
  if (openDrawer && env.openDrawerPrinter) {
    return { name: env.openDrawerPrinter, openDrawer: true };
  }
  const name = env.printer || env.openDrawerPrinter;
  return name ? { name, openDrawer: false } : null;
}

module.exports = { getPrinterEnv, getConfiguredPrinters, resolveEnvPrinter };
