<script setup>
import { onMounted, reactive, ref } from 'vue';
import { api } from '../api';
import { useCatalogStore } from '../stores/catalog';
import { useToastStore } from '../stores/toast';
import { fmtNum } from '../utils/format';

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
});

async function loadInfo() {
  try {
    info.value = await api.get('/system/info');
  } catch { /* ignore */ }
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

const TABLE_LABELS = {
  products: '菜品', orders: '訂單', order_items: '訂單明細',
  tables: '桌台', staff: '員工', shift_records: '交接班紀錄',
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

    <!-- 硬體說明 -->
    <div class="card p-6 max-w-2xl">
      <h2 class="font-extrabold text-lg mb-2">硬體設定說明</h2>
      <ul class="text-sm text-gray-500 space-y-1.5 list-disc pl-5">
        <li>印表機、錢箱、客顯副屏等硬體，需在桌面殼（Tauri/Electron）中透過本地外殼程式呼叫作業系統 API。</li>
        <li>本機資料夾即為資料中心：直接複製 <span class="font-mono text-xs">server/data/pos.db</span> 即可完成遷移。</li>
        <li>系統完全離線運作，不依賴任何雲端服務。</li>
      </ul>
    </div>
  </div>
</template>
