import fs from 'node:fs';
import path from 'node:path';

/**
 * `shared/` 位於各應用根目錄之外，Vite/Rollup 解析 shared 內的裸模組引用
 * （vue / pinia / vue-router）時會從 shared/ 開始往上找 node_modules 而失敗，
 * 因此統一指向「使用方應用」自己的 node_modules（兩個應用版本一致，避免多實例）。
 *
 * @param {string} appDir 應用根目錄（client/ 或 admin/）
 * @returns {Record<string, string>} resolve.alias 用的映射
 */
export function appDepAliases(appDir) {
  const deps = ['vue', 'pinia', 'vue-router'];
  const out = {};
  for (const dep of deps) {
    const p = path.join(appDir, 'node_modules', dep);
    if (fs.existsSync(path.join(p, 'package.json'))) out[dep] = p;
  }
  return out;
}
