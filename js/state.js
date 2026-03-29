// ═══════════════════════════════════════════════════════════════════════════
// state.js — Centralized app state, localStorage, Google Sheets sync
// ═══════════════════════════════════════════════════════════════════════════

// ── Core data ────────────────────────────────────────────────────────────────
export let books = [], sales = [], restocks = [];
function localDate() {
  const d = new Date();
  return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
}
export let period = { from: localDate().slice(0,7)+'-01', to: localDate() };

// ── UI / Scanner / Import / Bundle state ─────────────────────────────────────
export let currentTab = 'dashboard';
export let stokSearch = '', stokPub = '', stokCat = '';
export let searchDebounceTimer = null;
export let scannerJustFired = false;
export let scanMode = null, scanResult = null, scanQty = 1;
export let scanOverPrice = null, scanOverNote = '';
export let barcodeBuffer = '', lastKeyTime = 0;
export let scanBundleMode = false, scanBundleItems = [];
export let importRows = [], importDone = false, showImportPanel = false;
export let bundleItems = [], bundlePrice = 0, bundleNote = '';

// ── Setters (needed because only declaring module can reassign) ──────────────
export const set = {
  books(v){ books=v; }, sales(v){ sales=v; }, restocks(v){ restocks=v; }, period(v){ period=v; },
  currentTab(v){ currentTab=v; }, stokSearch(v){ stokSearch=v; }, stokPub(v){ stokPub=v; },
  stokCat(v){ stokCat=v; }, searchDebounceTimer(v){ searchDebounceTimer=v; },
  scannerJustFired(v){ scannerJustFired=v; }, scanMode(v){ scanMode=v; },
  scanResult(v){ scanResult=v; }, scanQty(v){ scanQty=v; },
  scanOverPrice(v){ scanOverPrice=v; }, scanOverNote(v){ scanOverNote=v; },
  barcodeBuffer(v){ barcodeBuffer=v; }, lastKeyTime(v){ lastKeyTime=v; },
  scanBundleMode(v){ scanBundleMode=v; }, scanBundleItems(v){ scanBundleItems=v; },
  importRows(v){ importRows=v; }, importDone(v){ importDone=v; },
  showImportPanel(v){ showImportPanel=v; },
  bundleItems(v){ bundleItems=v; }, bundlePrice(v){ bundlePrice=v; }, bundleNote(v){ bundleNote=v; },
};

// ═══════════════════════════════════════════════════════════════════════════
// LocalStorage
// ═══════════════════════════════════════════════════════════════════════════
const LS = 'perpbrian_v1';

export function load() {
  try {
    const d = JSON.parse(localStorage.getItem(LS));
    if (d && Array.isArray(d.books)) {
      books = d.books; sales = d.sales||[]; restocks = d.restocks||[]; period = d.period||period;
      return true;
    }
  } catch(e) {}
  return false;
}

export function save() {
  try { localStorage.setItem(LS, JSON.stringify({ books, sales, restocks, period })); }
  catch(e) { console.warn('localStorage save failed'); }
  scheduleSync();
}

// ═══════════════════════════════════════════════════════════════════════════
// Google Sheets Sync
// ═══════════════════════════════════════════════════════════════════════════
const GS_KEY = 'perpbrian_gs_url';
export let gsUrl = localStorage.getItem(GS_KEY) || '';
let syncTimer = null;
let bootFetching = false;  // Phase 2: block sync while fetching from Sheets

export function setGsUrl(url) { gsUrl = url; localStorage.setItem(GS_KEY, url); }

export function updateSyncUI(state) {
  const btn = document.getElementById('sync-btn'), dot = document.getElementById('sync-dot'), lbl = document.getElementById('sync-label');
  if (!btn) return;
  btn.className = 'sync-btn'; dot.className = 'sync-dot';
  if (state==='syncing') { btn.classList.add('syncing'); dot.classList.add('pulse'); lbl.textContent='Syncing...'; }
  else if (state==='synced'||state==='connected') { btn.classList.add('synced'); lbl.textContent='Synced ✓'; }
  else if (state==='error') { btn.classList.add('error'); lbl.textContent='Sync gagal'; }
  else { lbl.textContent = gsUrl ? 'Google Sheets' : 'Setup Sheets'; }
}

function scheduleSync() {
  if (!gsUrl) return;
  if (bootFetching) return;  // Phase 2: don't sync while boot fetch in progress
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(() => syncToSheets(), 1500);
}

export async function syncToSheets(showFeedback=false) {
  if (!gsUrl) return;
  if (bootFetching) return;  // Phase 2: never sync during boot fetch
  if (location.protocol==='file:') { updateSyncUI('error'); return; }
  updateSyncUI('syncing');
  try {
    const res = await fetch(gsUrl, { method:'POST', headers:{'Content-Type':'text/plain;charset=utf-8'},
      body: JSON.stringify({ action:'sync', data:{ books, sales, restocks } }), redirect:'follow' });
    const json = JSON.parse(await res.text());
    if (json.ok) { updateSyncUI('connected'); if(showFeedback) console.log('Sync OK'); return; }
    throw new Error(json.error);
  } catch(err) {
    try {
      const enc = encodeURIComponent(JSON.stringify({ books, sales, restocks }));
      const json2 = await (await fetch(`${gsUrl}?action=sync&payload=${enc}`, {redirect:'follow'})).json();
      if (json2.ok) { updateSyncUI('connected'); return; }
    } catch(e2) {}
    updateSyncUI('error');
  }
}

export async function loadFromSheets() {
  if (!gsUrl) return false;
  updateSyncUI('syncing');
  try {
    const json = await (await fetch(gsUrl+'?action=load&t='+Date.now())).json();
    if (json.ok && json.data) {
      books = json.data.books||[]; sales = json.data.sales||[]; restocks = json.data.restocks||[];
      save(); updateSyncUI('connected'); return true;
    }
  } catch(e) {}
  updateSyncUI('error'); return false;
}

// ── Phase 2: Sheets-first boot fetch ─────────────────────────────────────────
export async function fetchFromSheetsOnBoot() {
  if (!gsUrl) return { ok: false, reason: 'no-url' };
  if (location.protocol === 'file:') return { ok: false, reason: 'file-protocol' };
  bootFetching = true;  // Block all syncs until fetch completes
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000); // 8s timeout
    const res = await fetch(gsUrl+'?action=load&t='+Date.now(), { redirect:'follow', signal: controller.signal });
    clearTimeout(timeout);
    const json = JSON.parse(await res.text());
    if (json.ok && json.data) {
      const sheetBooks = json.data.books||[];
      const sheetSales = json.data.sales||[];
      const sheetRestocks = json.data.restocks||[];
      // Only overwrite if Sheets has data (prevent empty Sheets from wiping local data)
      if (sheetBooks.length > 0 || sheetSales.length > 0) {
        books = sheetBooks; sales = sheetSales; restocks = sheetRestocks;
        // Save to localStorage (but scheduleSync is blocked, so won't push back to Sheets)
        try { localStorage.setItem(LS, JSON.stringify({ books, sales, restocks, period })); }
        catch(e) {}
      }
      bootFetching = false;
      return { ok: true };
    }
    bootFetching = false;
    return { ok: false, reason: 'bad-response' };
  } catch(e) {
    bootFetching = false;
    return { ok: false, reason: e.name === 'AbortError' ? 'timeout' : 'network' };
  }
}

updateSyncUI('idle');
