// ═══════════════════════════════════════════════════════════════════════════
// repair.js — one-shot utility to fix duplicate IDs from legacy bulk imports.
// Exposes window.previewRepair() and window.executeRepair() for console use.
// Run ONLY after the "Syncing…" banner disappears on app boot.
// ═══════════════════════════════════════════════════════════════════════════
import * as S from './state.js';
import { uid } from './helpers.js';

function groupById(arr) {
  const groups = new Map();
  for (const item of arr) {
    const k = String(item.id);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(item);
  }
  return groups;
}

function analyze() {
  const bookGroups = groupById(S.books);
  const dupBookGroups = [...bookGroups.entries()].filter(([, v]) => v.length > 1);

  const resolvable = [], ambiguous = [];
  for (const [id, group] of dupBookGroups) {
    const titles = new Set(group.map(b => b.title));
    if (titles.size < group.length) ambiguous.push({ id, group });
    else resolvable.push({ id, group });
  }

  const affectedSales = S.sales.filter(s => {
    if (s.bookId && bookGroups.get(String(s.bookId))?.length > 1) return true;
    if (s.bundleItems?.some(i => bookGroups.get(String(i.bookId))?.length > 1)) return true;
    return false;
  });
  const affectedRestocks = S.restocks.filter(r => bookGroups.get(String(r.bookId))?.length > 1);

  const dupSaleIds    = [...groupById(S.sales).entries()].filter(([, v]) => v.length > 1);
  const dupRestockIds = [...groupById(S.restocks).entries()].filter(([, v]) => v.length > 1);

  const allBatches = S.books.flatMap(b => (b.batches || []).map(bt => ({ id: bt.id, bookTitle: b.title })));
  const dupBatchIds = [...groupById(allBatches).entries()].filter(([, v]) => v.length > 1);

  return { dupBookGroups, resolvable, ambiguous, affectedSales, affectedRestocks, dupSaleIds, dupRestockIds, dupBatchIds };
}

window.previewRepair = function () {
  const a = analyze();
  console.log('%c=== REPAIR PREVIEW ===', 'font-weight:bold;color:#7c3aed');
  console.log(`Total books: ${S.books.length}`);
  console.log(`Book groups with duplicate IDs: ${a.dupBookGroups.length}`);
  console.log(`  ├─ Resolvable (titles differ): ${a.resolvable.length}`);
  console.log(`  └─ Ambiguous (title also collides): ${a.ambiguous.length}`);
  console.log(`Affected sales rows: ${a.affectedSales.length}`);
  console.log(`Affected restock rows: ${a.affectedRestocks.length}`);
  console.log(`Duplicate sale IDs: ${a.dupSaleIds.length}`);
  console.log(`Duplicate restock IDs: ${a.dupRestockIds.length}`);
  console.log(`Duplicate batch IDs: ${a.dupBatchIds.length}`);

  if (a.resolvable.length) {
    console.log('\n--- Resolvable book groups ---');
    a.resolvable.forEach(({ id, group }) => {
      console.log(`id=${id}:`);
      group.forEach((b, i) => console.log(`  [${i}] "${b.title}" · barcode=${b.barcode || '—'} · batches=${b.batches?.length || 0}`));
    });
  }

  if (a.ambiguous.length) {
    console.log('\n%c--- ⚠️ AMBIGUOUS (need manual review) ---', 'color:#dc2626;font-weight:bold');
    a.ambiguous.forEach(({ id, group }) => {
      console.log(`id=${id}:`);
      group.forEach((b, i) => console.log(`  [${i}] "${b.title}" · barcode=${b.barcode || '—'} · batches=${b.batches?.length || 0}`));
    });
    console.log('\nResolve manually: edit one of the titles in Google Sheets, reload app, re-run previewRepair().');
    console.log('Or: call executeRepair({ acceptAmbiguous: true }) — first book in each ambiguous group keeps the id; references with that title stay pointed at it, which may or may not be correct.');
  }

  if (!a.dupBookGroups.length && !a.dupSaleIds.length && !a.dupRestockIds.length && !a.dupBatchIds.length) {
    console.log('%c✓ No duplicate IDs found. Nothing to repair.', 'color:#16a34a;font-weight:bold');
  } else {
    console.log('\nWhen ready: executeRepair()');
  }

  return a;
};

window.executeRepair = function (opts = {}) {
  const { acceptAmbiguous = false } = opts;
  const a = analyze();

  if (a.ambiguous.length && !acceptAmbiguous) {
    console.error('⚠️ Ambiguous cases present. Run previewRepair() to review. To proceed anyway: executeRepair({ acceptAmbiguous: true })');
    return;
  }

  let booksReassigned = 0, salesRepointed = 0, bundleItemsRepointed = 0, restocksRepointed = 0;

  for (const [oldId, group] of a.dupBookGroups) {
    const titleMap = new Map();
    group.forEach((b, idx) => {
      if (idx === 0) {
        titleMap.set(b.title, b.id);
      } else {
        const newId = uid();
        b.id = newId;
        booksReassigned++;
        if (!titleMap.has(b.title)) titleMap.set(b.title, newId);
      }
    });

    for (const s of S.sales) {
      if (String(s.bookId) === String(oldId)) {
        const newBookId = titleMap.get(s.bookTitle);
        if (newBookId !== undefined && newBookId !== s.bookId) {
          s.bookId = newBookId;
          salesRepointed++;
        }
      }
      if (s.bundleItems) {
        for (const item of s.bundleItems) {
          if (String(item.bookId) === String(oldId)) {
            const newBookId = titleMap.get(item.bookTitle);
            if (newBookId !== undefined && newBookId !== item.bookId) {
              item.bookId = newBookId;
              bundleItemsRepointed++;
            }
          }
        }
      }
    }

    for (const r of S.restocks) {
      if (String(r.bookId) === String(oldId)) {
        const newBookId = titleMap.get(r.bookTitle);
        if (newBookId !== undefined && newBookId !== r.bookId) {
          r.bookId = newBookId;
          restocksRepointed++;
        }
      }
    }
  }

  let saleIdsReassigned = 0, restockIdsReassigned = 0, batchIdsReassigned = 0;

  const seenSale = new Set();
  for (const s of S.sales) {
    const k = String(s.id);
    if (seenSale.has(k)) { s.id = uid(); saleIdsReassigned++; } else seenSale.add(k);
  }
  const seenRestock = new Set();
  for (const r of S.restocks) {
    const k = String(r.id);
    if (seenRestock.has(k)) { r.id = uid(); restockIdsReassigned++; } else seenRestock.add(k);
  }
  const seenBatch = new Set();
  for (const b of S.books) {
    for (const bt of (b.batches || [])) {
      const k = String(bt.id);
      if (seenBatch.has(k)) { bt.id = uid(); batchIdsReassigned++; } else seenBatch.add(k);
    }
  }

  S.save();

  console.log('%c=== REPAIR DONE ===', 'font-weight:bold;color:#16a34a');
  console.log(`Books reassigned:     ${booksReassigned}`);
  console.log(`Sales repointed:      ${salesRepointed}`);
  console.log(`Bundle items repointed: ${bundleItemsRepointed}`);
  console.log(`Restocks repointed:   ${restocksRepointed}`);
  console.log(`Sale IDs dedup'd:     ${saleIdsReassigned}`);
  console.log(`Restock IDs dedup'd:  ${restockIdsReassigned}`);
  console.log(`Batch IDs dedup'd:    ${batchIdsReassigned}`);
  console.log('\nLocal save done. Sheets sync triggered — watch the sync indicator. After it completes, hard-refresh the app and spot-check.');
};

// ─── Orphan recovery ───────────────────────────────────────────────────────
// Single-item sales whose bookId was lost (e.g. from the state.js num() bug
// that turned string bookIds into NaN → null on Sheets round-trip).
// Recover by matching bookTitle → book.id.
window.previewOrphanSales = function () {
  const orphans = S.sales.filter(s => !s.isBundle && !s.bookId && s.bookTitle);
  console.log('%c=== ORPHAN SALES PREVIEW ===', 'font-weight:bold;color:#7c3aed');
  console.log(`Single-item sales with empty bookId: ${orphans.length}`);
  const resolvable = [], unresolvable = [];
  for (const s of orphans) {
    const matches = S.books.filter(b => b.title === s.bookTitle);
    if (matches.length === 1) resolvable.push({ sale: s, book: matches[0] });
    else unresolvable.push({ sale: s, matchCount: matches.length });
  }
  console.log(`  ├─ Resolvable (exact title match, 1 book): ${resolvable.length}`);
  console.log(`  └─ Unresolvable (0 or >1 books match title): ${unresolvable.length}`);
  if (resolvable.length) {
    console.log('\n--- Resolvable ---');
    resolvable.forEach(({ sale, book }) => console.log(`  sale=${sale.id} date=${sale.date} "${sale.bookTitle}" → book.id=${book.id}`));
  }
  if (unresolvable.length) {
    console.log('\n--- ⚠️ Unresolvable ---');
    unresolvable.forEach(({ sale, matchCount }) => console.log(`  sale=${sale.id} date=${sale.date} "${sale.bookTitle}" → ${matchCount} book matches`));
  }
  return { resolvable, unresolvable };
};

window.executeOrphanSales = function () {
  const { resolvable, unresolvable } = window.previewOrphanSales();
  if (!resolvable.length) { console.log('Nothing to repair.'); return; }
  for (const { sale, book } of resolvable) sale.bookId = book.id;
  S.save();
  console.log(`%c✓ Repointed ${resolvable.length} orphan sales. Sync triggered.`, 'color:#16a34a;font-weight:bold');
  if (unresolvable.length) console.log(`⚠️ ${unresolvable.length} still unresolvable — handle manually.`);
};
