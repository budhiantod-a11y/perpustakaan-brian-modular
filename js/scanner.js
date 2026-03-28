// ═══════════════════════════════════════════════════════════════════════════
// scanner.js — Barcode scanner logic (keyboard detection + processScan)
// ═══════════════════════════════════════════════════════════════════════════
import * as S from './state.js';
import { showToast, uid, today, fmt, getNormalPrice } from './helpers.js';
import { totalStock, avgBuy, fifoDeduct } from './fifo.js';

let _render = () => {};
export function init(renderFn) { _render = renderFn; }

// ── Keyboard barcode scanner detection ───────────────────────────────────────
export function setupKeyboardScanner() {
  document.addEventListener('keydown', e => {
    if (!S.scanMode) return;
    if (e.target.tagName === 'INPUT' && e.target.id !== 'scan-hw-input') return;
    const now = Date.now();
    if (now - S.lastKeyTime > 350) S.set.barcodeBuffer('');
    S.set.lastKeyTime(now);
    if (e.key === 'Enter') {
      if (S.barcodeBuffer.length >= 6) processScan(S.barcodeBuffer);
      S.set.barcodeBuffer('');
    } else if (e.key.length === 1) {
      S.set.barcodeBuffer(S.barcodeBuffer + e.key);
    }
  });
}

export function processScan(code) {
  const book = S.books.find(b => b.barcode === code.trim());
  if (!book) { showToast('Barcode tidak ditemukan', 'err'); return; }
  S.set.scanResult(book);
  S.set.scanQty(1);
  S.set.scanOverPrice(null);
  S.set.scanOverNote('');
  _render();
}

export function confirmScan() {
  if (!S.scanResult) return;
  const normalP  = getNormalPrice(S.scanResult);
  const finalP   = S.scanOverPrice != null ? S.scanOverPrice : normalP;
  const isDiskon = finalP !== normalP;
  if (isDiskon && !S.scanOverNote.trim()) { showToast('Isi catatan untuk harga final yang berbeda', 'err'); return; }
  if (S.scanMode === 'sale') {
    if (S.scanQty > totalStock(S.scanResult)) { showToast('Stok tidak cukup!', 'err'); return; }
    const { cogs } = fifoDeduct(S.scanResult.id, S.scanQty);
    S.sales.push({
      id:uid(), bookId:S.scanResult.id, bookTitle:S.scanResult.title, qty:S.scanQty,
      buyPrice: Math.round(cogs/S.scanQty),
      normalPrice: normalP, sellPrice: normalP,
      finalPrice: finalP, finalSellPrice: finalP,
      cogs, profit: S.scanQty*finalP-cogs,
      date:today(), via:'scan', priceOverride: isDiskon, note: S.scanOverNote
    });
    showToast(`✓ ${S.scanResult.title} — ${S.scanQty} terjual`);
  } else {
    const bp = S.scanResult.batches.length ? avgBuy(S.scanResult) : 0;
    const bpRaw = prompt('Harga modal / beli per pcs (Rp):\n(Bisa berbeda dari batch sebelumnya — FIFO akan mencatat sebagai batch baru)', bp);
    if (bpRaw === null) return;
    const bpVal = parseInt(bpRaw);
    if (!bpVal || bpVal <= 0) { showToast('Harga modal harus lebih dari 0', 'err'); return; }
    S.scanResult.batches.push({ id:uid(), qty:S.scanQty, remaining:S.scanQty, buyPrice:bpVal, date:today() });
    S.restocks.push({ id:uid(), bookId:S.scanResult.id, bookTitle:S.scanResult.title, qty:S.scanQty, buyPrice:bpVal, date:today() });
    showToast(`✓ ${S.scanResult.title} — +${S.scanQty} masuk`);
  }
  S.set.scanResult(null); S.save(); _render();
}

// ── Search helpers (for stok tab search + scanner detection) ─────────────────
let _searchBuf = '', _searchBufTime = 0;

export function onSearchInput(el) {
  clearTimeout(S.searchDebounceTimer);
  S.set.stokSearch(el.value);
  S.set.searchDebounceTimer(setTimeout(() => _render(), 150));
}

export function onSearchKeydown(el, e) {
  const now = Date.now();
  if (e.key === 'Enter') {
    e.preventDefault();
    clearTimeout(S.searchDebounceTimer);
    S.set.stokSearch(el.value.trim());
    S.set.scannerJustFired(true);
    _render();
    setTimeout(() => {
      const first = document.querySelector('.book-card');
      if (first) {
        first.style.outline = '2px solid var(--accent)';
        first.scrollIntoView({ behavior:'smooth', block:'nearest' });
        setTimeout(() => first.style.outline='', 1200);
      }
      el.focus();
    }, 60);
    return;
  }
  if (now - _searchBufTime < 60) {
    clearTimeout(S.searchDebounceTimer);
    S.set.stokSearch(el.value);
    S.set.searchDebounceTimer(setTimeout(() => _render(), 80));
  }
  _searchBufTime = now;
}
