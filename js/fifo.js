// ═══════════════════════════════════════════════════════════════════════════
// fifo.js — FIFO inventory costing (totalStock, avgBuy, deduct, simulate)
// ═══════════════════════════════════════════════════════════════════════════
import { books } from './state.js';
import { showToast } from './helpers.js';

export const totalStock = b => b.batches.reduce((s,bt)=>s+bt.remaining,0);

export const avgBuy = b => {
  const t = totalStock(b);
  return t ? Math.round(b.batches.reduce((s,bt)=>s+bt.remaining*bt.buyPrice,0)/t) : 0;
};

export function fifoDeduct(bookId, qty) {
  const book = books.find(b=>b.id===bookId);
  if (qty > totalStock(book)) {
    showToast(`Stok ${book.title} tidak cukup untuk deduct ${qty} pcs!`,'err');
    return { cogs:0, details:[] };
  }
  const sorted = [...book.batches].sort((a,b)=>a.date.localeCompare(b.date));
  let left=qty, cogs=0, details=[];
  for (const bt of sorted) {
    if (left<=0) break;
    const take = Math.min(bt.remaining, left);
    if (!take) continue;
    cogs += take*bt.buyPrice;
    details.push({ batchDate:bt.date, buyPrice:bt.buyPrice, qty:take });
    book.batches.find(b=>b.id===bt.id).remaining -= take;
    left -= take;
  }
  return { cogs, details };
}

export function fifoSim(book, qty) {
  const sorted = [...book.batches].sort((a,b)=>a.date.localeCompare(b.date));
  let left=qty, cogs=0, details=[];
  for (const bt of sorted) {
    if (left<=0) break;
    const take = Math.min(bt.remaining, left);
    if (!take) continue;
    cogs += take*bt.buyPrice;
    details.push({ batchDate:bt.date, buyPrice:bt.buyPrice, qty:take });
    left -= take;
  }
  return { cogs, details };
}

// ── Manual batch override ────────────────────────────────────────────────────
// overrides: [{ batchId, qty }, ...] — user pilih batch mana yang dipakai
// Validasi: tiap batch harus ada & remaining cukup; sum(qty) harus match total qty
export function manualDeduct(bookId, overrides) {
  const book = books.find(b => b.id === bookId);
  if (!book) return { cogs:0, details:[], ok:false, reason:'Buku tidak ditemukan' };
  let cogs = 0, details = [];
  for (const ov of overrides) {
    const bt = book.batches.find(b => b.id === ov.batchId);
    if (!bt)            return { cogs:0, details:[], ok:false, reason:'Batch tidak ditemukan' };
    if (bt.remaining < ov.qty) return { cogs:0, details:[], ok:false, reason:`Batch ${bt.date||'?'} sisa ${bt.remaining} pcs, diminta ${ov.qty}` };
    cogs += ov.qty * bt.buyPrice;
    details.push({ batchDate: bt.date, buyPrice: bt.buyPrice, qty: ov.qty });
  }
  // Semua valid → deduct
  for (const ov of overrides) {
    const bt = book.batches.find(b => b.id === ov.batchId);
    bt.remaining -= ov.qty;
  }
  return { cogs, details, ok:true };
}

export function manualSim(book, overrides) {
  let cogs = 0, details = [], totalQty = 0;
  for (const ov of overrides) {
    const bt = book.batches.find(b => b.id === ov.batchId);
    if (!bt) continue;
    cogs += ov.qty * bt.buyPrice;
    totalQty += ov.qty;
    details.push({ batchDate: bt.date, buyPrice: bt.buyPrice, qty: ov.qty });
  }
  return { cogs, details, totalQty };
}
