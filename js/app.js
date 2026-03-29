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

import * as Books from './books.js';
import * as Sales from './sales.js';
import * as Scanner from './scanner.js';
import * as Import from './import.js';
import * as Sync from './sync.js';

// ── Initialize modules with render callback ──────────────────────────────────
Books.init(render);
Sales.init(render);
Scanner.init(render);
Import.init(render);
Sync.init(render);

// ── goTab ────────────────────────────────────────────────────────────────────
function goTab(tab, btn) {
  S.set.currentTab(tab);
  document.querySelectorAll('.nav-tab').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  else {
    const tabs = ['dashboard','stok','scanner','penjualan','restock','laporan'];
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
  // These are inline lambdas so we define them here
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
  deleteBook:     Books.deleteBook,
  deleteRestock:  Books.deleteRestock,
  saveBook:       Books.saveBook,
  updateBook:     Books.updateBook,
  saveRestock:    Books.saveRestock,

  // Sales
  openSaleManual:    Sales.openSaleManual,
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
  bundleAddItem:      Sales.bundleAddItem,
  bundleRemoveItem:   Sales.bundleRemoveItem,
  bundleChangeQty:    Sales.bundleChangeQty,
  saveBundleSale:     Sales.saveBundleSale,
  setBundlePrice(v)   {
    S.set.bundlePrice(v);
    // Update profit display in-place (no modal rebuild = no cursor jump)
    const profitEl = document.getElementById('bundle-profit-display');
    const hppEl    = document.getElementById('bundle-hpp-display');
    if (profitEl && hppEl) {
      // Recalculate totalHPP from current bundle items
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
  openSyncSettings:   Sync.openSyncSettings,
  testGsConnection:   Sync.testGsConnection,
  testGsPost:         Sync.testGsPost,
  loadFromSheetsModal: Sync.loadFromSheetsModal,
  saveGsUrl:          Sync.saveGsUrl,

  // Helpers
  closeModal,
  exportCSV,
  save: S.save,
});

// ═══════════════════════════════════════════════════════════════════════════
// Boot
// ═══════════════════════════════════════════════════════════════════════════
S.load();
Scanner.setupKeyboardScanner();
render();
