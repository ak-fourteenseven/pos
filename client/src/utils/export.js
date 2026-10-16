/** 匯出工具：CSV（純前端） / Excel（SheetJS，動態載入） */

function triggerDownload(blob, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(a.href);
}

/** rows: 二維陣列，第一列為標題 */
export function downloadCSV(filename, rows) {
  const csv = '\uFEFF' + rows
    .map((r) => r.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(','))
    .join('\r\n');
  triggerDownload(new Blob([csv], { type: 'text/csv;charset=utf-8' }), filename);
}

/** sheets: [{ name, rows }]，rows 為二維陣列 */
export async function downloadExcel(filename, sheets) {
  const XLSX = await import('xlsx');
  const wb = XLSX.utils.book_new();
  for (const s of sheets) {
    const ws = XLSX.utils.aoa_to_sheet(s.rows);
    XLSX.utils.book_append_sheet(wb, ws, s.name.slice(0, 28) || 'Sheet');
  }
  XLSX.writeFile(wb, filename);
}
