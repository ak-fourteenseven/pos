/**
 * 開發入口：預設啟用 POS_SEED=1（每次啟動覆寫預設 settings，保留營業日／訂單）。
 * 若環境已設定 POS_SEED，則尊重既有值（例如 POS_SEED=0 關閉）。
 */
const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

if (process.env.POS_SEED === undefined || process.env.POS_SEED === '') {
  process.env.POS_SEED = '1';
}
require('./index.js');
