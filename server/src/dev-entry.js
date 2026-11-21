/**
 * 開發入口：預設啟用每次啟動重種（POS_SEED=1）。
 * 若環境已設定 POS_SEED，則尊重既有值（例如 POS_SEED=0 關閉）。
 */
if (process.env.POS_SEED === undefined || process.env.POS_SEED === '') {
  process.env.POS_SEED = '1';
}
require('./index.js');
