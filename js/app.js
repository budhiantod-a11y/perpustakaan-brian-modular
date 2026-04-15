// ═══════════════════════════════════════════════════════════════════════════
// app.js — Application entry point
//
// Imports all modules, initializes them with render(), exposes necessary
// functions to window.* for inline HTML handlers, then boots the app.
// ═══════════════════════════════════════════════════════════════════════════

import * as S from './state.js';
import { showToast, closeModal, fmt } from './helpers.js';
import { totalStock, fifoSim } from './fifo.js';
import { render } from './render.js';

import * as Books    from './books.js';
import * as Sales    from './sales.js';
import * as Scanner  from './scanner.js';
import * as Import   from './import.js';
import * as Sync     from './sync.js';
import * as Preorder from './preorder.js';
import * as Cashflow from './cashflow.js';

// ── Initialize modules with render callback ──────────────────────────────────
Books.init(render);
Sales.init(render);
Scanner.init(render);
Import.init(render);
Sync.init(render);
Preorder.init(render);
Cashflow.init(render);

// ── Expose cashflow helpers to render.js via window (render.js uses window._cf*) ──
window._cfBuildLedger    = Cashflow.buildLedger;
window._cfCalcSummary    = Cashflow.calcSummary;
window._cfCategoryLabels = Cashflow.CATEGORY_LABELS;

// ── goTab ────────────────────────────────────────────────────────────────────
function goTab(tab, btn) {
  S.set.currentTab(tab);
  document.querySelectorAll('.nav-tab').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  else {
    const tabs = ['dashboard','stok','scanner','penjualan','restock','laporan','preorder','cashflow'];
    document.querySelectorAll('.nav-tab')[tabs.indexOf(tab)]?.classList.add('active');
  }
  S.set.stokSearch(''); S.set.stokPub(''); S.set.stokCat('');
  if (tab !== 'stok') { S.set.showImportPanel(false); S.set.importRows([]); S.set.importDone(false); }
  render();
}

// ── exportCSV ────────────────────────────────────────────────────────────────
function exportCSV() {
  const filt = S.sales.filter(s => s.date >= S.period.from && s.date <= S.period.to);
  if (!filt.length) { showToast('Tidak ada data', 'err'); return; }
  const rows = filt.map(s => ({
    Tanggal: s.date,
    Buku: s.isBundle
      ? (s.bundleItems ? s.bundleItems.map(i=>`${i.bookTitle} x${i.qty}`).join(' + ') : s.bookTitle)
      : s.bookTitle,
    Qty: s.qty,
    Tipe: s.isBundle ? 'Bundle' : 'Satuan',
    'Harga Modal/pcs': s.buyPrice || Math.round((s.cogs||0)/(s.qty||1)),
    'Harga Final': s.finalPrice || s.finalSellPrice || 0,
    Diskon: (!s.isBundle && s.priceOverride) ? 'Ya' : 'Tidak',
    Catatan: s.note || '',
    'Total HPP': s.cogs,
    Revenue: s.isBundle ? (s.finalPrice||s.finalSellPrice||0) : s.qty*(s.finalPrice||s.finalSellPrice||0),
    Profit: s.profit, Via: s.via
  }));
  const hdr = Object.keys(rows[0]);
  const csv = [hdr.join(','), ...rows.map(r => hdr.map(h => `"${r[h]}"`).join(','))].join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['\uFEFF'+csv], {type:'text/csv;charset=utf-8;'}));
  a.download = `laporan-${S.period.from}-${S.period.to}.csv`; a.click();
  showToast('CSV siap didownload ✓');
}

// ═══════════════════════════════════════════════════════════════════════════
// Window bridge — expose functions used by inline onclick/onchange/oninput
// handlers in HTML templates (render.js, modal HTML, etc.)
//
// This is the pragmatic bridge between ES modules and inline handlers.
// Each function is explicitly listed here for traceability.
// ═══════════════════════════════════════════════════════════════════════════
Object.assign(window, {
  // Navigation
  goTab,

  // Period changes (used in dashboard/laporan date inputs)
  setPeriodFrom(v) { S.period.from = v; S.save(); render(); },
  setPeriodTo(v)   { S.period.to = v;   S.save(); render(); },

  // Render (for handlers that call render() directly)
  render,

  // State setters used by inline handlers
  setStokPub(v)  { S.set.stokPub(v);  render(); },
  setStokCat(v)  { S.set.stokCat(v);  render(); },
  clearSearch()  { S.set.stokSearch(''); document.getElementById('stok-search-input').value=''; render(); },
  toggleImportPanel() { S.set.showImportPanel(!S.showImportPanel); S.set.importRows([]); S.set.importDone(false); render(); },

  // Scanner mode setters
  setScanModeSale()    { S.set.scanMode('sale'); S.set.scanBundleMode(false); S.set.scanResult(null); S.set.scanBundleItems([]); S.set.scanOverPrice(null); S.set.scanOverNote(''); render(); },
  setScanModeBundle()  { S.set.scanMode('sale'); S.set.scanBundleMode(true);  S.set.scanResult(null); S.set.scanBundleItems([]); S.set.scanOverPrice(null); render(); },
  setScanModeRestock() { S.set.scanMode('restock'); S.set.scanBundleMode(false); S.set.scanResult(null); S.set.scanBundleItems([]); render(); },
  closeScanMode()      { S.set.scanMode(null); S.set.scanBundleMode(false); S.set.scanResult(null); S.set.scanBundleItems([]); render(); },
  cancelScanResult()   { S.set.scanResult(null); render(); },
  resetScanBundleList(){ S.set.scanBundleItems([]); render(); },
  setScanQty(v)        { S.set.scanQty(v); render(); },

  // Books
  openAddBook:    Books.openAddBook,
  openEditBook:   Books.openEditBook,
  openAddRestock: Books.openAddRestock,
  openStokOpname: Books.openStokOpname,
  saveStokOpname: Books.saveStokOpname,
  deleteBook:     Books.deleteBook,
  deleteRestock:  Books.deleteRestock,
  saveBook:       Books.saveBook,
  updateBook:     Books.updateBook,
  saveRestock:    Books.saveRestock,

  // Sales
  openSaleManual:    Sales.openSaleManual,
  saleSearchFilter:  Sales.saleSearchFilter,
  saleSelectBook:    Sales.saleSelectBook,
  saleClearBook:     Sales.saleClearBook,
  onBookChange:      Sales.onBookChange,
  onSaleChange:      Sales.onSaleChange,
  onScanPriceInput:  Sales.onScanPriceInput,
  onScanNoteInput:   Sales.onScanNoteInput,
  saveSaleManual:    Sales.saveSaleManual,
  deleteSale:        Sales.deleteSale,
  deleteSaleBundle:  Sales.deleteSaleBundle,

  // Bundle
  openBundleModal:    Sales.openBundleModal,
  renderBundleModal:  Sales.renderBundleModal,
  bundleSearchFilter: Sales.bundleSearchFilter,
  bundleAddById:      Sales.bundleAddById,
  bundleRemoveItem:   Sales.bundleRemoveItem,
  bundleChangeQty:    Sales.bundleChangeQty,
  saveBundleSale:     Sales.saveBundleSale,
  setBundlePrice(v)   {
    S.set.bundlePrice(v);
    const profitEl = document.getElementById('bundle-profit-display');
    if (profitEl) {
      let totalHPP = 0;
      for (const item of S.bundleItems) {
        const b = S.books.find(x => x.id === item.bookId);
        if (b) {
          const { cogs } = fifoSim(b, item.qty);
          totalHPP += cogs;
        }
      }
      const profit = v - totalHPP;
      profitEl.textContent = fmt(profit);
      profitEl.style.color = profit >= 0 ? 'var(--green)' : 'var(--red)';
    }
    const btn = document.getElementById('bundle-submit-btn');
    if (btn) {
      const canSubmit = S.bundleItems.length && v > 0;
      btn.disabled = !canSubmit;
      btn.style.opacity = canSubmit ? '' : '.5';
      btn.style.cursor = canSubmit ? '' : 'not-allowed';
    }
  },
  setBundleNote(v)    { S.set.bundleNote(v); },

  // Scanner bundle
  processScan:           Scanner.processScan,
  processScanBundle:     Sales.processScanBundle,
  confirmScan:           Scanner.confirmScan,
  removeScanBundleItem:  Sales.removeScanBundleItem,
  changeScanBundleQty:   Sales.changeScanBundleQty,
  confirmScanBundle:     Sales.confirmScanBundle,

  // Search
  onSearchInput:   Scanner.onSearchInput,
  onSearchKeydown: Scanner.onSearchKeydown,

  // Import
  downloadTemplate: Import.downloadTemplate,
  handleImportFile: Import.handleImportFile,
  toggleImportRow:  Import.toggleImportRow,
  commitImport:     Import.commitImport,
  selectAllImport() { S.importRows.forEach(r=>{ if(r._status!=='error') r._checked=true; }); render(); },
  unselectAllImport() { S.importRows.forEach(r=>r._checked=false); render(); },

  // Sync
  openSyncSettings:    Sync.openSyncSettings,
  testGsConnection:    Sync.testGsConnection,
  testGsPost:          Sync.testGsPost,
  loadFromSheetsModal: Sync.loadFromSheetsModal,
  saveGsUrl:           Sync.saveGsUrl,

  // Preorder
  openAddPreorder:   Preorder.openAddPreorder,
  savePreorder:      Preorder.savePreorder,
  openEditPreorder:  Preorder.openEditPreorder,
  updatePreorder:    Preorder.updatePreorder,
  deletePreorder:    Preorder.deletePreorder,
  openQuickPayPo:    Preorder.openQuickPayPo,
  saveQuickPayPo:    Preorder.saveQuickPayPo,
  openBukuDatang:    Preorder.openBukuDatang,
  confirmBukuDatang: Preorder.confirmBukuDatang,
  bdBarcodeKeydown:  Preorder.bdBarcodeKeydown,
  saveNewBookFromPo: Preorder.saveNewBookFromPo,
  poAddItem:         Preorder.poAddItem,
  poRemoveItem:      Preorder.poRemoveItem,
  poUpdateTotal:     Preorder.poUpdateTotal,

  // Cashflow
  openAddCashflow:   Cashflow.openAddCashflow,
  saveCashflow:      Cashflow.saveCashflow,
  openEditCashflow:  Cashflow.openEditCashflow,
  updateCashflow:    Cashflow.updateCashflow,
  deleteCashflow:    Cashflow.deleteCashflow,
  cfMarkDelivered:   Cashflow.markDelivered,
  cfSetType:         Cashflow.cfSetType,
  cfOnCategoryChange:Cashflow.cfOnCategoryChange,
  cfOnAdvanceChange: Cashflow.cfOnAdvanceChange,

  // Helpers
  closeModal,
  exportCSV,
  save: S.save,
});

// ═══════════════════════════════════════════════════════════════════════════
// Boot — Phase 2: Sheets-first with localStorage fallback
// ═══════════════════════════════════════════════════════════════════════════
S.load();
Scanner.setupKeyboardScanner();
render();

if (S.gsUrl) {
  const banner = document.getElementById('sync-banner');
  if (banner) { banner.style.display = 'flex'; banner.className = 'sync-banner syncing'; banner.innerHTML = '<span class="sync-banner-dot"></span> Mengambil data dari Google Sheets…'; }
  S.updateSyncUI('syncing');

  S.fetchFromSheetsOnBoot().then(result => {
    if (result.ok) {
      render();
      S.updateSyncUI('connected');
      if (banner) { banner.className = 'sync-banner synced'; banner.innerHTML = '✓ Data dari Google Sheets berhasil dimuat'; setTimeout(() => banner.style.display = 'none', 3000); }
    } else {
      S.updateSyncUI(result.reason === 'no-url' ? 'idle' : 'error');
      if (banner) {
        if (result.reason === 'timeout') {
          banner.className = 'sync-banner error'; banner.innerHTML = '⚠ Timeout — menggunakan data lokal (offline mode)';
        } else if (result.reason === 'network') {
          banner.className = 'sync-banner error'; banner.innerHTML = '⚠ Tidak bisa terhubung — menggunakan data lokal';
        } else {
          banner.style.display = 'none';
        }
        setTimeout(() => banner.style.display = 'none', 5000);
      }
    }
  });
}
