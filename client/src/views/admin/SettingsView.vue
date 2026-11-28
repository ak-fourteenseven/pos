<script setup>
import { onMounted, reactive, ref, watch } from 'vue';
import { api } from '@shared/api';
import { useCatalogStore } from '@shared/stores/catalog';
import { useToastStore } from '@shared/stores/toast';
import { fmtNum } from '@shared/utils/format';
import { fetchPrinters, testPrint } from '@shared/utils/print';

const catalog = useCatalogStore();
const toast = useToastStore();

const form = reactive({
  store_name: '',
  store_address: '',
  store_phone: '',
  receipt_footer: '',
  service_fee_rate: '0',
  currency: 'NT$',
  business_mode: 'table',
});

const saving = ref(false);
const backupDir = ref('');
const backing = ref(false);
const info = ref(null);
const restoring = ref(false);
const printers = ref([]);
const printersError = ref('');
const printersLoading = ref(false);
const chromePath = ref('');
const printerEnv = reactive({
  OPEN_DRAWER_PRINTER_NAME: '',
  PRINTER_NAME: '',
});
const printerPlatform = ref('');
const testingReal = ref(false);
const testingFake = ref(false);
const testResult = ref(null);

onMounted(async () => {
  try {
    await catalog.loadAll();
  } catch { /* ignore */ }
  Object.assign(form, {
    store_name: catalog.settings.store_name || '',
    store_address: catalog.settings.store_address || '',
    store_phone: catalog.settings.store_phone || '',
    receipt_footer: catalog.settings.receipt_footer || '',
    service_fee_rate: catalog.settings.service_fee_rate || '0',
    currency: catalog.settings.currency || 'NT$',
    business_mode: catalog.settings.business_mode || 'table',
  });
  await loadInfo();
  await loadPrinters();
});

async function loadPrinters() {
  printersLoading.value = true;
  printersError.value = '';
  try {
    const data = await fetchPrinters();
    printers.value = data.printers || [];
    chromePath.value = data.chromePath || '';
    printerPlatform.value = data.platform || '';
    printerEnv.OPEN_DRAWER_PRINTER_NAME = data.env?.OPEN_DRAWER_PRINTER_NAME || '';
    printerEnv.PRINTER_NAME = data.env?.PRINTER_NAME || '';
    if (data.error) printersError.value = data.error;
  } catch (e) {
    printers.value = [];
    printersError.value = e.message || '無法取得印表機列表';
  } finally {
    printersLoading.value = false;
  }
}

async function loadInfo() {
  try {
    info.value = await api.get('/system/info');
  } catch { /* ignore */ }
}

async function runTestPrint(simulate) {
  if (simulate) testingFake.value = true;
  else testingReal.value = true;
  testResult.value = null;
  try {
    const data = await testPrint({ simulate, openDrawer: true });
    testResult.value = { ok: true, simulate, data };
    toast.success(simulate
      ? `模擬成功（PDF ${data.pdfBytes || 0} bytes → ${data.printer}）`
      : `已送交真實列印（${data.printer}${data.jobId ? ` · ${data.jobId}` : ''}）`);
  } catch (e) {
    testResult.value = { ok: false, simulate, message: e.message };
    toast.error(e.message || (simulate ? '模擬列印失敗' : '真實列印失敗'));
  } finally {
    testingReal.value = false;
    testingFake.value = false;
  }
}

async function save() {
  saving.value = true;
  try {
    await api.put('/settings', form);
    await catalog.loadAll();
    toast.success('設定已儲存');
  } catch (e) {
    toast.error(e.message);
  } finally {
    saving.value = false;
  }
}

async function backup() {
  backing.value = true;
  try {
    const r = await api.post('/system/backup', { dir: backupDir.value });
    toast.success(`備份完成：${r.file}`);
  } catch (e) {
    toast.error(e.message);
  } finally {
    backing.value = false;
  }
}

function downloadDb() {
  window.open('/api/system/backup/download', '_blank');
}

async function onRestoreFile(e) {
  const file = e.target.files?.[0];
  if (!file) return;
  if (!confirm('還原將以備份檔案覆蓋目前所有資料，確定繼續？（建議先備份）')) {
    e.target.value = '';
    return;
  }
  restoring.value = true;
  try {
    const buf = await file.arrayBuffer();
    await api.upload('/system/restore', buf);
    toast.success('資料已還原，即將重新載入…');
    setTimeout(() => location.reload(), 1200);
  } catch (err) {
    toast.error(err.message);
  } finally {
    restoring.value = false;
    e.target.value = '';
  }
}

/* ---------------- 時段設定 ---------------- */
const slots = ref([]);
watch(() => catalog.timeSlots, (v) => {
  slots.value = (v || []).map((s) => ({ ...s }));
}, { immediate: true });

function addSlot() {
  slots.value.push({
    code: `slot_${Date.now()}`,
    name: '新時段',
    start_time: '00:00',
    end_time: '23:59',
    drink_all_free: 0,
    drink_cold_extra: 0,
    drink_hot_free: 0,
  });
}
function removeSlot(i) {
  slots.value.splice(i, 1);
}
async function saveSlots() {
  try {
    await api.put('/time-slots', { slots: slots.value });
    await catalog.reloadTimeSlots();
    toast.success('時段設定已儲存');
  } catch (e) {
    toast.error(e.message);
  }
}

const TABLE_LABELS = {
  products: '菜品', orders: '訂單', order_items: '訂單明細',
  tables: '桌台', staff: '員工', business_days: '營業日紀錄',
};
</script>

<template>
  <div class="h-full overflow-y-auto p-5 space-y-5">
    <!-- 門店資訊 -->
    <div class="card p-6 max-w-2xl">
      <h2 class="font-extrabold text-lg mb-4">門店資訊（顯示於小票表頭）</h2>
      <div class="grid sm:grid-cols-2 gap-4">
        <div>
          <label class="label">店名</label>
          <input v-model="form.store_name" class="input" />
        </div>
        <div>
          <label class="label">聯絡電話</label>
          <input v-model="form.store_phone" class="input" />
        </div>
        <div class="sm:col-span-2">
          <label class="label">地址</label>
          <input v-model="form.store_address" class="input" />
        </div>
        <div class="sm:col-span-2">
          <label class="label">小票頁尾文字</label>
          <input v-model="form.receipt_footer" class="input" />
        </div>
        <div>
          <label class="label">服務費率（%）</label>
          <input v-model="form.service_fee_rate" type="number" min="0" step="0.5" class="input" />
        </div>
        <div>
          <label class="label">貨幣符號</label>
          <input v-model="form.currency" class="input" />
        </div>
        <div>
          <label class="label">營業模式</label>
          <select v-model="form.business_mode" class="input">
            <option value="table">桌台模式（正餐）</option>
            <option value="fastfood">快餐模式（無桌台）</option>
          </select>
        </div>
      </div>
      <div class="mt-5">
        <button class="btn-primary" :disabled="saving" @click="save">
          {{ saving ? '儲存中…' : '儲存設定' }}
        </button>
      </div>
    </div>

    <div class="grid lg:grid-cols-2 gap-5">
      <!-- 備份與還原 -->
      <div class="card p-6">
        <h2 class="font-extrabold text-lg mb-1">資料備份與還原</h2>
        <p class="text-sm text-gray-500 mb-4">所有資料存放於本地 SQLite 檔案，建議定期備份至 USB 隨身碟或雲端硬碟。</p>
        <div class="space-y-3">
          <div>
            <label class="label">備份目標資料夾（留空 = 伺服器預設備份目錄）</label>
            <input v-model="backupDir" class="input" placeholder="例如：D:\POS-Backups" />
          </div>
          <div class="flex gap-2 flex-wrap">
            <button class="btn-primary" :disabled="backing" @click="backup">{{ backing ? '備份中…' : '一鍵備份' }}</button>
            <button class="btn-ghost" @click="downloadDb">下載目前資料庫</button>
          </div>
          <div class="pt-3 border-t border-gray-100">
            <label class="label">還原備份（.db 檔案）</label>
            <input type="file" accept=".db,.sqlite" class="input" :disabled="restoring" @change="onRestoreFile" />
            <p class="text-xs text-red-400 mt-1">注意：還原會覆蓋目前所有資料，且無法復原。</p>
          </div>
        </div>
      </div>

      <!-- 資料庫資訊 -->
      <div class="card p-6">
        <h2 class="font-extrabold text-lg mb-4">資料庫資訊</h2>
        <div v-if="info" class="space-y-3">
          <div class="text-sm">
            <div class="text-gray-400 text-xs font-bold">資料庫位置</div>
            <div class="font-mono text-xs break-all text-gray-600">{{ info.db_path }}</div>
          </div>
          <div class="text-sm">
            <div class="text-gray-400 text-xs font-bold">檔案大小</div>
            <div>{{ (info.size_bytes / 1024).toFixed(1) }} KB</div>
          </div>
          <div class="grid grid-cols-3 gap-2 pt-2">
            <div v-for="(v, k) in info.counts" :key="k" class="bg-gray-50 rounded-xl p-3 text-center">
              <div class="text-lg font-extrabold">{{ fmtNum(v) }}</div>
              <div class="text-xs text-gray-400">{{ TABLE_LABELS[k] || k }}</div>
            </div>
          </div>
        </div>
        <div v-else class="text-sm text-gray-300">載入中…</div>
      </div>
    </div>

    <!-- 時段設定（飲品計價規則） -->
    <div class="card p-6 max-w-3xl">
      <h2 class="font-extrabold text-lg mb-1">時段設定（飲品計價規則）</h2>
      <p class="text-sm text-gray-500 mb-4">
        收銀台依當前時間自動套用：下午茶時段飲品免費；午/晚市熱飲免費、凍飲加價。時間格式 HH:MM（24 小時制）。
      </p>
      <table class="w-full text-sm">
        <thead>
          <tr class="text-left text-xs text-gray-400 border-b">
            <th class="py-2">時段名稱</th><th class="py-2">開始</th><th class="py-2">結束</th>
            <th class="py-2 text-center">全免</th><th class="py-2 text-center">熱飲免費</th>
            <th class="py-2">凍飲加價</th><th class="py-2"></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(s, i) in slots" :key="i" class="border-b border-gray-50">
            <td class="py-2 pr-2"><input v-model="s.name" class="input !py-1" /></td>
            <td class="py-2 pr-2"><input v-model="s.start_time" class="input !py-1 !w-24" placeholder="11:00" /></td>
            <td class="py-2 pr-2"><input v-model="s.end_time" class="input !py-1 !w-24" placeholder="15:00" /></td>
            <td class="py-2 text-center"><input v-model="s.drink_all_free" type="checkbox" class="accent-brand-500" :true-value="1" :false-value="0" /></td>
            <td class="py-2 text-center"><input v-model="s.drink_hot_free" type="checkbox" class="accent-brand-500" :true-value="1" :false-value="0" /></td>
            <td class="py-2 pr-2"><input v-model.number="s.drink_cold_extra" type="number" min="0" class="input !py-1 !w-20" /></td>
            <td class="py-2 text-right"><button class="btn-ghost btn-sm !text-red-500" @click="removeSlot(i)">刪除</button></td>
          </tr>
        </tbody>
      </table>
      <div class="flex gap-2 mt-3">
        <button class="btn-ghost btn-sm" @click="addSlot">＋ 新增時段</button>
        <button class="btn-primary btn-sm" @click="saveSlots">儲存時段設定</button>
      </div>
    </div>

    <!-- 印表機（由 server/.env 固定） -->
    <div class="card p-6 max-w-2xl">
      <div class="flex items-start justify-between gap-3 mb-1">
        <h2 class="font-extrabold text-lg">印表機設定</h2>
        <button type="button" class="btn-ghost btn-sm" :disabled="printersLoading" @click="loadPrinters">
          {{ printersLoading ? '重新整理中…' : '重新整理列表' }}
        </button>
      </div>
      <p class="text-sm text-gray-500 mb-4">
        印表機名稱由 <span class="font-mono text-xs">server/.env</span> 設定（生產機為 Windows）。
        有列印工作時：<span class="font-mono text-xs">OPEN_DRAWER_PRINTER_NAME</span> 會列印並開錢箱；
        <span class="font-mono text-xs">PRINTER_NAME</span> 只列印。此處僅顯示，請改 env 後重啟服務。
      </p>
      <p v-if="printersError" class="text-sm text-amber-600 mb-3">{{ printersError }}</p>
      <div class="grid sm:grid-cols-1 gap-4">
        <div>
          <label class="label">OPEN_DRAWER_PRINTER_NAME（列印 + 開錢箱）</label>
          <input
            class="input bg-gray-50"
            readonly
            :value="printerEnv.OPEN_DRAWER_PRINTER_NAME || '（未設定）'"
          />
        </div>
        <div>
          <label class="label">PRINTER_NAME（僅列印）</label>
          <input
            class="input bg-gray-50"
            readonly
            :value="printerEnv.PRINTER_NAME || '（未設定）'"
          />
        </div>
      </div>
      <div v-if="printers.length" class="mt-4">
        <div class="text-xs font-bold text-gray-400 mb-1">本機已安裝印表機（{{ printerPlatform || 'unknown' }}）</div>
        <ul class="text-sm text-gray-600 space-y-0.5 max-h-36 overflow-y-auto">
          <li v-for="p in printers" :key="p.name" class="font-mono text-xs">
            {{ p.name }}<span v-if="p.isDefault" class="text-gray-400">（預設）</span>
          </li>
        </ul>
      </div>
      <p class="text-xs text-gray-400 mt-3">
        HTML 轉 PDF 使用本機 Chrome／Edge：
        <span class="font-mono">{{ chromePath || '未偵測到（請安裝 Chrome 或設定 CHROME_PATH）' }}</span>
      </p>
      <div class="flex flex-wrap gap-2 mt-4">
        <button
          type="button"
          class="btn-primary btn-sm"
          :disabled="testingReal || testingFake"
          @click="runTestPrint(false)"
        >
          {{ testingReal ? '真實測試中…' : '測試列印（真實）' }}
        </button>
        <button
          type="button"
          class="btn-ghost btn-sm"
          :disabled="testingReal || testingFake"
          @click="runTestPrint(true)"
        >
          {{ testingFake ? '模擬中…' : '測試列印（模擬成功）' }}
        </button>
      </div>
      <p class="text-xs text-gray-400 mt-2">
        真實：HTML → PDF → 送交印表機（名稱不正確時會失敗）。
        模擬：同樣走 HTML → PDF，但不送交 spooler，回傳假裝成功。
      </p>
      <pre
        v-if="testResult"
        class="mt-3 text-xs font-mono whitespace-pre-wrap break-all rounded-xl p-3 max-h-40 overflow-y-auto"
        :class="testResult.ok ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-700'"
      >{{ testResult.ok
        ? JSON.stringify(testResult.data, null, 2)
        : testResult.message
      }}</pre>
    </div>

    <!-- 硬體說明 -->
    <div class="card p-6 max-w-2xl">
      <h2 class="font-extrabold text-lg mb-2">硬體設定說明</h2>
      <ul class="text-sm text-gray-500 space-y-1.5 list-disc pl-5">
        <li>印表機名稱請寫入 <span class="font-mono text-xs">server/.env</span>，須與 Windows「裝置和印表機」顯示名稱一致。</li>
        <li>本機資料夾即為資料中心：直接複製 <span class="font-mono text-xs">server/data/pos.db</span> 即可完成遷移。</li>
        <li>系統完全離線運作，不依賴任何雲端服務。</li>
      </ul>
    </div>
  </div>
</template>
