// ═══════════════════════════════════════════════════════════════════════════
// sync.js — Google Sheets settings modal, test connection, save URL
// ═══════════════════════════════════════════════════════════════════════════
import * as S from './state.js';
import { openModal, closeModal, showToast } from './helpers.js';

let _render = () => {};
export function init(renderFn) { _render = renderFn; }

export function openSyncSettings() {
  openModal(`
    <div class="modal-title">⚡ Koneksi Google Sheets</div>

    <div style="background:var(--accent-s);border-radius:var(--radius-s);padding:12px 14px;margin-bottom:18px;font-size:12px;color:var(--accent);line-height:1.7">
      <strong>Cara setup (sekali saja):</strong><br>
      1. Buka Google Sheets baru<br>
      2. Klik <strong>Extensions → Apps Script</strong><br>
      3. Paste kode dari file <code>tokoku_google_apps_script.gs</code><br>
      4. Klik <strong>Deploy → New deployment → Web App</strong><br>
      &nbsp;&nbsp;&nbsp;&nbsp;• Execute as: <strong>Me</strong><br>
      &nbsp;&nbsp;&nbsp;&nbsp;• Who has access: <strong>Anyone</strong><br>
      5. Copy URL deployment → paste di bawah
    </div>

    <div class="field">
      <label>URL Google Apps Script Deployment</label>
      <input class="inp" id="gs-url-input" placeholder="https://script.google.com/macros/s/..." value="${S.gsUrl}">
      <div class="hint">URL berbentuk: https://script.google.com/macros/s/ABC.../exec</div>
    </div>

    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">
      <button class="btn btn-ghost btn-sm" onclick="testGsConnection()">🔗 Test Koneksi (GET)</button>
      <button class="btn btn-ghost btn-sm" onclick="testGsPost()">📤 Test Sync (POST)</button>
      <button class="btn btn-ghost btn-sm" onclick="loadFromSheetsModal()">↓ Load dari Sheets</button>
    </div>

    <div id="gs-test-result" style="font-size:12px;min-height:20px;color:var(--text3)"></div>

    <div class="modal-footer">
      <button class="btn btn-ghost" onclick="closeModal()">Batal</button>
      <button class="btn btn-primary" onclick="saveGsUrl()">Simpan & Sync Sekarang</button>
    </div>`);
}

export async function testGsConnection() {
  const url = document.getElementById('gs-url-input')?.value?.trim();
  const res_el = document.getElementById('gs-test-result');
  if (!url) { if (res_el) res_el.textContent = '⚠ URL belum diisi'; return; }
  if (res_el) res_el.textContent = '⏳ Menghubungkan…';
  try {
    const res = await fetch(url + '?action=ping&t=' + Date.now(), { method: 'GET', redirect: 'follow' });
    const text = await res.text();
    const json = JSON.parse(text);
    if (json.ok) {
      if (res_el) res_el.innerHTML = '<span style="color:var(--green)">✓ Koneksi GET berhasil! Lanjut test POST →</span>';
    } else {
      throw new Error(json.error);
    }
  } catch (err) {
    if (res_el) res_el.innerHTML = `<span style="color:var(--red)">✗ GET gagal: ${err.message}</span>`;
  }
}

export async function testGsPost() {
  const url = document.getElementById('gs-url-input')?.value?.trim();
  const res_el = document.getElementById('gs-test-result');
  if (!url) { if (res_el) res_el.textContent = '⚠ URL belum diisi'; return; }
  if (res_el) res_el.innerHTML = '⏳ Mengirim data test via POST…';
  try {
    const testData = { books: [], sales: [], restocks: [] };
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: 'sync', data: testData }),
      redirect: 'follow',
    });
    const text = await res.text();
    let json;
    try { json = JSON.parse(text); } catch(e) {
      throw new Error('Response bukan JSON. Script perlu di-deploy ulang.');
    }
    if (json.ok) {
      if (res_el) res_el.innerHTML = '<span style="color:var(--green)">✓ POST berhasil! Coba Simpan & Sync sekarang.</span>';
    } else {
      throw new Error(json.error || JSON.stringify(json));
    }
  } catch (err) {
    if (res_el) res_el.innerHTML = `<span style="color:var(--red)">✗ POST gagal: ${err.message}</span>`;
  }
}

export async function loadFromSheetsModal() {
  const url = document.getElementById('gs-url-input')?.value?.trim();
  if (!url) { showToast('Isi URL dulu', 'err'); return; }
  S.setGsUrl(url);
  closeModal();
  const ok = await S.loadFromSheets();
  if (ok) _render();
}

export async function saveGsUrl() {
  const url = document.getElementById('gs-url-input')?.value?.trim();
  if (!url) { showToast('URL tidak boleh kosong', 'err'); return; }
  S.setGsUrl(url);
  closeModal();
  await S.syncToSheets(true);
  S.updateSyncUI('idle');
}
