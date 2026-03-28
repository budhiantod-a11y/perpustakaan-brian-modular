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
