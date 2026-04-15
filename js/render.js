// ═══════════════════════════════════════════════════════════════════════════
// render.js — Main render function (renders current tab into #main)
// ═══════════════════════════════════════════════════════════════════════════
import * as S from './state.js';
import { fmt, today, getNormalPrice, allPubs, allCats } from './helpers.js';
import { totalStock, fifoSim } from './fifo.js';
import { getPoStatus, getPoTotal, getStatusLabel } from './preorder.js';

export function render() {
  const lowStock = S.books.filter(b => totalStock(b) <= 5);
  const pill = document.getElementById('low-pill');
  const txt  = document.getElementById('low-text');
  if (pill && txt) { pill.classList.toggle('show', lowStock.length > 0); txt.textContent = `${lowStock.length} buku hampir habis`; }

  // Helper: truncate bundle title for mobile-friendly display
  const bundleShort = (x) => {
    if (!x.bundleItems || !x.bundleItems.length) return x.bookTitle;
    const first = x.bundleItems[0];
    const rest = x.bundleItems.length - 1;
    return rest > 0
      ? `${first.bookTitle} ×${first.qty} <span style="color:var(--text3)">+${rest} lainnya</span>`
      : `${first.bookTitle} ×${first.qty}`;
  };
  const bundleFull = (x) => {
    if (!x.bundleItems || !x.bundleItems.length) return x.bookTitle;
    return x.bundleItems.map(i => `${i.bookTitle} ×${i.qty}`).join(' + ');
  };

  const filtered = S.sales.filter(s => s.date >= S.period.from && s.date <= S.period.to);
  const totalRev  = filtered.reduce((s,x) => x.isBundle ? s + (x.finalPrice||x.finalSellPrice||0) : s + x.qty*(x.finalPrice||x.finalSellPrice||0), 0);
  const totalCOGS = filtered.reduce((s,x) => s + x.cogs, 0);
  const totalProfit = totalRev - totalCOGS;
  const overCount  = filtered.filter(s=>s.priceOverride&&!s.isBundle).length;
  const bundleCount = filtered.filter(s=>s.isBundle).length;

  const area = document.getElementById('main');
  if (!area) return;

  // ── DASHBOARD ──────────────────────────────────────────────────────────────
  if (S.currentTab === 'dashboard') {
    area.innerHTML = `
      <div class="page-hdr">
        <div><div class="page-title">Dashboard</div><div class="page-sub">Ringkasan performa toko</div></div>
        <div class="period-bar" style="margin-bottom:0">
          <label>Periode</label>
          <input type="date" value="${S.period.from}" onchange="setPeriodFrom(this.value)">
          <span class="period-sep">—</span>
          <input type="date" value="${S.period.to}" onchange="setPeriodTo(this.value)">
        </div>
      </div>

      <div class="save-notice"><div class="save-dot"></div>Data tersimpan di browser ini · <strong style="color:var(--text2)">${S.books.length} buku</strong> terdaftar</div>

      ${lowStock.length ? `<div class="alert-bar" id="alert-bar-wrap">
        <div class="alert-bar-toggle" onclick="
          const body=document.getElementById('alert-bar-body');
          const chev=document.getElementById('alert-bar-chev');
          body.classList.toggle('open');
          chev.classList.toggle('open');
        ">
          <span>⚠ Stok hampir habis: <strong>${lowStock.length} buku</strong></span>
          <span class="alert-bar-chevron" id="alert-bar-chev">▼</span>
        </div>
        <div class="alert-bar-body" id="alert-bar-body">
          <div class="low-stock-chips" style="margin-top:8px">
            ${lowStock.map(b=>`<span class="low-chip">${b.title} <strong>(${totalStock(b)})</strong></span>`).join('')}
          </div>
        </div>
      </div>` : ''}

      <div class="stat-grid">
        <div class="stat-card">
          <div class="stat-icon" style="background:#dcfce7">💰</div>
          <div class="stat-label">Revenue</div>
          <div class="stat-value" style="color:var(--green)">${fmt(totalRev)}</div>
          <div class="stat-sub">${filtered.reduce((s,x)=>s+x.qty,0)} buku terjual</div>
        </div>
        <div class="stat-card">
          <div class="stat-icon" style="background:#fee2e2">📦</div>
          <div class="stat-label">HPP (FIFO)</div>
          <div class="stat-value" style="color:var(--red)">${fmt(totalCOGS)}</div>
          <div class="stat-sub">Harga modal akurat</div>
        </div>
        <div class="stat-card">
          <div class="stat-icon" style="background:#ede9fe">✨</div>
          <div class="stat-label">Profit Bersih</div>
          <div class="stat-value" style="color:var(--accent)">${fmt(totalProfit)}</div>
          <div class="stat-sub">Margin ${totalRev?Math.round(totalProfit/totalRev*100):0}%</div>
        </div>
        <div class="stat-card">
          <div class="stat-icon" style="background:#ffedd5">🏷️</div>
          <div class="stat-label">Diskon</div>
          <div class="stat-value" style="color:var(--orange)">${overCount}</div>
          <div class="stat-sub">+${bundleCount} bundling</div>
        </div>
      </div>

      <div class="card">
        <div class="card-title">Transaksi Terakhir</div>
        ${filtered.length === 0 ? `<div style="text-align:center;padding:32px;color:var(--text3);font-size:13px">Belum ada transaksi di periode ini</div>` : `
        <div class="table-wrap hide-mobile">
          <table>
            <thead><tr><th>Tanggal</th><th>Buku</th><th>Qty</th><th>Harga Final</th><th>Profit</th><th>Via</th></tr></thead>
            <tbody>
              ${[...filtered].reverse().slice(0,7).map(x => `
                <tr class="${x.isBundle?'bundle-row':''}">
                  <td style="color:var(--text3)">${x.date}</td>
                  <td style="font-weight:600">${x.isBundle?`<span class="badge bundle-badge" style="font-size:10px;margin-right:4px">📦</span>`:''}<span style="color:${x.isBundle?'#7c3aed':'inherit'}">${x.isBundle ? bundleShort(x) : x.bookTitle}</span></td>
                  <td>${x.qty}</td>
                  <td>${x.isBundle
                    ? `<strong style="color:#7c3aed">${fmt(x.finalPrice||x.finalSellPrice)}</strong>`
                    : x.priceOverride
                      ? `<strong style="color:var(--orange)">${fmt(x.finalPrice||x.finalSellPrice)}</strong>`
                      : `<strong>${fmt(x.finalPrice||x.finalSellPrice)}</strong>`}</td>
                  <td style="color:var(--green);font-weight:600">${fmt(x.profit)}</td>
                  <td><span class="badge ${x.via==='scan'?'badge-accent':'badge-gray'}">${x.via}</span></td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>
        <div class="mobile-cards show-mobile">
          ${[...filtered].reverse().slice(0,7).map(x => `
            <div class="trx-card ${x.isBundle?'trx-bundle':''}">
              <div class="trx-card-top">
                <span class="trx-card-title">${x.isBundle ? `📦 Bundle (${x.qty} buku)` : x.bookTitle}${!x.isBundle && x.qty>1 ? ` ×${x.qty}` : ''}</span>
                <span class="trx-card-date">${x.date}</span>
              </div>
              ${x.isBundle ? `<div class="trx-card-detail">${bundleShort(x)}</div>` : ''}
              <div class="trx-card-bottom">
                <span class="trx-card-price" style="color:${x.isBundle?'#7c3aed':x.priceOverride?'var(--orange)':'var(--text)'}">${fmt(x.finalPrice||x.finalSellPrice)}</span>
                <span class="trx-card-profit">+${fmt(x.profit)}</span>
                <span class="badge ${x.via==='scan'?'badge-accent':'badge-gray'}" style="font-size:10px">${x.via}</span>
              </div>
            </div>`).join('')}
        </div>`}
      </div>`;
  }

  // ── STOK ───────────────────────────────────────────────────────────────────
  if (S.currentTab === 'stok') {
    const pubs = allPubs(), cats = allCats();
    const q = S.stokSearch.toLowerCase().trim();
    const fb = S.books.filter(b => {
      const ms = !q || [b.title, b.author, b.publisher, String(b.barcode||''), b.category].some(v => v?.toLowerCase().includes(q));
      return ms && (!S.stokPub||b.publisher===S.stokPub) && (!S.stokCat||b.category===S.stokCat);
    });

    area.innerHTML = `
      <div class="page-hdr">
        <div><div class="page-title">Stok Buku</div><div class="page-sub">${fb.length} dari ${S.books.length} judul</div></div>
        <div class="page-actions">
          <button class="btn btn-ghost" onclick="toggleImportPanel()" style="${S.showImportPanel?'background:var(--accent-s);color:var(--accent);border-color:var(--accent-t)':''}">
            ↑ Import CSV
          </button>
          <button class="btn btn-primary" onclick="openAddBook()">+ Tambah Buku</button>
        </div>
      </div>

      <!-- IMPORT PANEL (inline, collapsible) -->
      ${S.showImportPanel ? `
      <div class="card" style="border:1.5px solid var(--accent-t);background:linear-gradient(to bottom,var(--accent-s),var(--surface));margin-bottom:20px">

        <!-- Header -->
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:18px">
          <div>
            <div style="font-size:14px;font-weight:700;color:var(--accent)">↑ Import Buku via CSV</div>
            <div style="font-size:12px;color:var(--text3);margin-top:2px">Upload banyak buku sekaligus · barcode duplikat otomatis jadi batch FIFO baru</div>
          </div>
          <button class="btn btn-ghost btn-sm" onclick="toggleImportPanel()">✕ Tutup</button>
        </div>

        <!-- Step 1: Template -->
        <div style="display:flex;align-items:center;gap:14px;padding:12px 16px;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-s);margin-bottom:12px;flex-wrap:wrap">
          <div style="width:28px;height:28px;border-radius:50%;background:var(--accent);color:#fff;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;flex-shrink:0">1</div>
          <div style="flex:1;min-width:180px">
            <div style="font-size:13px;font-weight:600">Download template CSV</div>
            <div style="font-size:11px;color:var(--text3);margin-top:2px">
              Kolom: <code style="background:var(--bg);padding:1px 5px;border-radius:3px">judul</code>
              <code style="background:var(--bg);padding:1px 5px;border-radius:3px">penulis</code>
              <code style="background:var(--bg);padding:1px 5px;border-radius:3px">penerbit</code>
              <code style="background:var(--bg);padding:1px 5px;border-radius:3px">kategori</code>
              <code style="background:var(--bg);padding:1px 5px;border-radius:3px">barcode</code>
              <code style="background:var(--bg);padding:1px 5px;border-radius:3px">harga_beli</code>
              <code style="background:var(--bg);padding:1px 5px;border-radius:3px">harga_normal</code>
              <code style="background:var(--bg);padding:1px 5px;border-radius:3px">stok_awal</code>
            </div>
          </div>
          <button class="btn btn-ghost btn-sm" onclick="downloadTemplate()">↓ Download Template (.xlsx)</button>
        </div>

        <!-- Step 2: Upload -->
        <div style="display:flex;align-items:flex-start;gap:14px;padding:12px 16px;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-s);margin-bottom:${S.importRows.length?'12px':'0'};flex-wrap:wrap">
          <div style="width:28px;height:28px;border-radius:50%;background:${S.importRows.length?'var(--green)':'var(--accent)'};color:#fff;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;flex-shrink:0;margin-top:2px">2</div>
          <div style="flex:1;min-width:180px">
            <div style="font-size:13px;font-weight:600;margin-bottom:8px">${S.importRows.length ? `File dibaca — ${S.importRows.length} baris ditemukan` : 'Upload file CSV'}</div>
            <label style="display:inline-flex;align-items:center;gap:8px;padding:9px 16px;background:var(--bg);border:1.5px dashed var(--border2);border-radius:var(--radius-s);cursor:pointer;font-size:12px;font-weight:500;color:var(--text2);transition:all .15s"
              onmouseover="this.style.borderColor='var(--accent)';this.style.color='var(--accent)'"
              onmouseout="this.style.borderColor='var(--border2)';this.style.color='var(--text2)'">
              📄 Pilih file Excel atau CSV
              <input type="file" accept=".xlsx,.xls,.csv,.ods" style="display:none" onchange="handleImportFile(this)">
            </label>
            ${S.importRows.length ? `
            <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap">
              <span class="badge badge-accent">✦ ${S.importRows.filter(r=>r._status==='new').length} buku baru</span>
              <span class="badge badge-blue">+ ${S.importRows.filter(r=>r._status==='batch').length} batch baru</span>
              ${S.importRows.filter(r=>r._status==='error').length ? `<span class="badge badge-red">✕ ${S.importRows.filter(r=>r._status==='error').length} error</span>` : ''}
            </div>` : ''}
          </div>
          ${S.importRows.length ? `<button class="btn btn-ghost btn-sm" onclick="toggleImportPanel()" style="margin-top:2px">Ganti file</button>` : ''}
        </div>

        <!-- Step 3: Preview table -->
        ${S.importRows.length ? `
        <div style="padding:12px 16px;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-s)">
          <div style="display:flex;align-items:center;gap:14px;margin-bottom:14px;flex-wrap:wrap;gap:10px">
            <div style="width:28px;height:28px;border-radius:50%;background:var(--accent);color:#fff;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;flex-shrink:0">3</div>
            <div style="flex:1">
              <div style="font-size:13px;font-weight:600">Review & konfirmasi</div>
              <div style="font-size:11px;color:var(--text3)">${S.importRows.filter(r=>r._checked&&r._status!=='error').length} baris dipilih</div>
            </div>
            <div style="display:flex;gap:6px;flex-wrap:wrap">
              <button class="btn btn-ghost btn-sm" onclick="selectAllImport()">Pilih Semua</button>
              <button class="btn btn-ghost btn-sm" onclick="unselectAllImport()">Batal Semua</button>
              <button class="btn btn-primary btn-sm" onclick="commitImport()" ${S.importRows.filter(r=>r._checked&&r._status!=='error').length===0?'disabled style="opacity:.5;cursor:not-allowed"':''}>
                ✓ Import ${S.importRows.filter(r=>r._checked&&r._status!=='error').length} Buku
              </button>
            </div>
          </div>
          <div class="table-wrap">
            <table>
              <thead><tr>
                <th style="width:32px"></th>
                <th>Judul</th><th>Penerbit</th><th>Barcode</th>
                <th>Modal</th><th>Normal</th><th>Stok</th><th>Status</th>
              </tr></thead>
              <tbody>
                ${S.importRows.map((r,i) => `
                  <tr style="cursor:${r._status!=='error'?'pointer':'default'};${r._status==='error'?'opacity:.5':''}" onclick="${r._status!=='error'?`toggleImportRow(${i})`:''}">
                    <td>
                      ${r._status==='error'
                        ? `<span style="color:var(--red);font-size:15px">✕</span>`
                        : `<input type="checkbox" ${r._checked?'checked':''} onclick="event.stopPropagation();toggleImportRow(${i})" style="width:15px;height:15px;cursor:pointer;accent-color:var(--accent)">`}
                    </td>
                    <td><div style="font-weight:600">${r.judul||'—'}</div>${r.penulis?`<div style="font-size:11px;color:var(--text3)">${r.penulis}</div>`:''}</td>
                    <td style="font-size:12px;color:var(--text2)">${r.penerbit||'—'}</td>
                    <td style="font-family:monospace;font-size:11px;color:var(--text3)">${r.barcode||'—'}</td>
                    <td style="color:var(--text2)">${r.hargaBeli?fmt(r.hargaBeli):'—'}</td>
                    <td style="font-weight:600">${r.hargaNormal?fmt(r.hargaNormal):'—'}</td>
                    <td>${r.stokAwal||0} pcs</td>
                    <td>
                      ${r._status==='new'   ? `<span class="badge badge-green">Buku baru</span>` : ''}
                      ${r._status==='batch' ? `<span class="badge badge-blue">+ Batch baru</span><div style="font-size:10px;color:var(--text3);margin-top:2px">${r._note}</div>` : ''}
                      ${r._status==='error' ? `<span class="badge badge-red">${r._note}</span>` : ''}
                    </td>
                  </tr>`).join('')}
              </tbody>
            </table>
          </div>
        </div>` : `
        <div style="margin-top:10px;padding:12px 16px;background:var(--surface);border:1px dashed var(--border);border-radius:var(--radius-s);font-size:12px;color:var(--text3);line-height:2">
          <strong style="color:var(--text2)">Tips:</strong>
          Barcode sudah ada → otomatis jadi batch FIFO baru ·
          <code style="background:var(--bg);padding:1px 4px;border-radius:3px">stok_awal</code> &
          <code style="background:var(--bg);padding:1px 4px;border-radius:3px">harga_beli</code> boleh 0 ·
          Upload <strong>.xlsx</strong> langsung dari Excel tanpa perlu convert, atau .csv juga bisa
        </div>`}

        ${S.importDone && !S.importRows.length ? `
        <div style="margin-top:12px;display:flex;align-items:center;gap:10px;padding:12px 16px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:var(--radius-s)">
          <span style="font-size:18px">✅</span>
          <div style="font-size:13px;font-weight:600;color:var(--green)">Import berhasil! Data sudah tersimpan.</div>
          <button class="btn btn-ghost btn-sm" style="margin-left:auto" onclick="toggleImportPanel()">Import lagi</button>
        </div>` : ''}
      </div>` : ''}

      <div class="search-row">
        <div style="position:relative;flex:1;min-width:200px">
          <input
            class="search-input"
            id="stok-search-input"
            placeholder="Cari judul, penulis, penerbit, barcode / ISBN..."
            value="${S.stokSearch}"
            oninput="onSearchInput(this)"
            onkeydown="onSearchKeydown(this,event)"
            style="width:100%;padding-right:${S.stokSearch?'80px':'12px'}"
            autocomplete="off"
          >
          ${S.stokSearch ? `
          <button onclick="clearSearch()"
            style="position:absolute;right:8px;top:50%;transform:translateY(-50%);background:var(--border);border:none;border-radius:4px;padding:2px 8px;font-size:11px;cursor:pointer;color:var(--text2);font-family:inherit">
            ✕ Clear
          </button>` : ''}
        </div>
        <div style="display:flex;align-items:center;gap:6px;padding:7px 12px;background:var(--surface);border:1px solid var(--border2);border-radius:var(--radius-s);font-size:11px;color:var(--text3);white-space:nowrap;cursor:default" title="Klik field search lalu scan barcode dengan scanner fisik">
          <span style="font-size:14px">⌖</span> Scanner ready
        </div>
      </div>

      ${pubs.length ? `<div class="filter-row">
        <span class="filter-label">Penerbit</span>
        <span class="filter-chip ${!S.stokPub?'active':''}" onclick="setStokPub('')">Semua</span>
        ${pubs.map(p=>`<span class="filter-chip ${S.stokPub===p?'active':''}" onclick="setStokPub('${p.replace(/'/g,"\\'")}')">${p}</span>`).join('')}
      </div>` : ''}

      ${cats.length ? `<div class="filter-row">
        <span class="filter-label">Kategori</span>
        <span class="filter-chip ${!S.stokCat?'active':''}" onclick="setStokCat('')">Semua</span>
        ${cats.map(c=>`<span class="filter-chip ${S.stokCat===c?'active':''}" onclick="setStokCat('${c.replace(/'/g,"\\'")}')">${c}</span>`).join('')}
      </div>` : ''}

      ${S.books.length === 0 ? `
        <div class="card" style="text-align:center;padding:48px 24px">
          <div style="font-size:40px;margin-bottom:12px">📚</div>
          <div style="font-size:16px;font-weight:600;color:var(--text);margin-bottom:6px">Belum ada buku</div>
          <div style="font-size:13px;color:var(--text3);margin-bottom:20px">Tambah buku pertama kamu untuk mulai mencatat stok dan penjualan</div>
          <button class="btn btn-primary" onclick="openAddBook()">+ Tambah Buku Pertama</button>
        </div>` :
        fb.length === 0 ? `<div class="card" style="text-align:center;padding:32px;color:var(--text3)">
          <div style="font-size:24px;margin-bottom:8px">🔍</div>
          <div style="font-size:13px;font-weight:600;color:var(--text2);margin-bottom:4px">Tidak ada buku yang cocok</div>
          <div style="font-size:12px">${S.stokSearch ? `Barcode / kata kunci "<strong>${S.stokSearch}</strong>" tidak ditemukan` : 'Coba ubah filter'}</div>
          ${S.stokSearch && S.scannerJustFired ? `<div style="margin-top:12px"><button class="btn btn-primary btn-sm" onclick="openAddBook()">+ Tambah buku baru dengan barcode ini</button></div>` : ''}
        </div>` :
        fb.map(b => {
          const stock = totalStock(b);
          const active = b.batches.filter(bt=>bt.remaining>0).sort((a,c)=>a.date.localeCompare(c.date));
          const nextBP = active.length ? active[0].buyPrice : 0;
          return `
          <div class="book-card">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:8px">
              <div style="flex:1;min-width:200px">
                <div style="font-size:15px;font-weight:700;color:var(--text)">${b.title}</div>
                <div class="book-meta">
                  ${b.author ? `<span style="color:var(--text2);font-size:12px">✍ ${b.author}</span>` : ''}
                  ${b.publisher ? `<span class="badge badge-blue">🏢 ${b.publisher}</span>` : ''}
                  ${b.category ? `<span class="badge badge-gray">${b.category}</span>` : ''}
                  <span style="font-family:monospace;font-size:11px;color:var(--text3)">${b.barcode}</span>
                </div>
                <div style="display:flex;gap:16px;margin-top:10px;font-size:12px;flex-wrap:wrap">
                  ${nextBP ? `<span style="color:var(--text3)">Modal: <strong style="color:var(--text2)">${fmt(nextBP)}</strong></span>` : ''}
                  <span>Normal: <strong style="color:var(--accent)">${fmt(getNormalPrice(b))}</strong></span>
                  ${nextBP ? `<span>Margin: <strong style="color:${getNormalPrice(b)>nextBP?'var(--green)':'var(--red)'}">${Math.round((getNormalPrice(b)-nextBP)/getNormalPrice(b)*100)}%</strong></span>` : ''}
                </div>
              </div>
              <div class="book-actions">
                <span class="badge ${stock<=5?'badge-red':'badge-green'}" style="font-size:12px;padding:4px 10px">${stock} pcs</span>
                <button class="btn btn-ghost btn-sm" onclick="openEditBook(${b.id})">Edit</button>
                <button class="btn btn-green btn-sm" onclick="openAddRestock(${b.id})">+ Restock</button>
                <button class="btn btn-ghost btn-sm" onclick="openStokOpname(${b.id})" style="color:var(--amber);border-color:var(--amber-s)">📋 Opname</button>
                <button class="btn btn-danger btn-sm" onclick="deleteBook(${b.id})">Hapus</button>
              </div>
            </div>
            ${active.length ? `
            <div class="batch-list">
              <div style="font-size:11px;font-weight:600;color:var(--text3);text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px">Antrian Batch FIFO</div>
              ${active.map((bt,i) => `
                <div class="batch-item">
                  <div class="batch-num ${i===0?'next':'later'}">${i+1}</div>
                  <div style="flex:1"><strong>${bt.remaining}</strong> pcs <span style="color:var(--text3)">sisa dari ${bt.qty}</span></div>
                  <div>Beli: <strong>${fmt(bt.buyPrice)}</strong></div>
                  <div style="color:var(--text3)">Masuk: ${bt.date}</div>
                  ${i===0 ? `<span class="badge badge-accent">next</span>` : ''}
                </div>`).join('')}
            </div>` : `<div style="margin-top:10px;font-size:12px;color:var(--red)">⚠ Stok habis</div>`}
          </div>`;
        }).join('')}`;
  }

  // ── SCANNER ────────────────────────────────────────────────────────────────
  if (S.currentTab === 'scanner') {
    area.innerHTML = `
      <div class="page-hdr">
        <div><div class="page-title">Scanner Barcode</div><div class="page-sub">Catat buku masuk atau keluar dengan scan</div></div>
      </div>
      <div class="mode-cards">
        <div class="mode-card ${S.scanMode==='sale'&&!S.scanBundleMode?'active-sale':''}" onclick="setScanModeSale()">
          <div class="mode-card-icon" style="background:var(--green-s)">🛒</div>
          <div class="mode-card-title" style="color:${S.scanMode==='sale'&&!S.scanBundleMode?'var(--green)':'var(--text)'}">Mode Jual</div>
          <div class="mode-card-desc">Scan → stok keluar satuan (FIFO)</div>
        </div>
        <div class="mode-card ${S.scanBundleMode?'active-sale':''}" style="${S.scanBundleMode?'border-color:#7c3aed;background:#fdf4ff':''}" onclick="setScanModeBundle()">
          <div class="mode-card-icon" style="background:#f3e8ff">📦</div>
          <div class="mode-card-title" style="color:${S.scanBundleMode?'#7c3aed':'var(--text)'}">Mode Bundle</div>
          <div class="mode-card-desc">Scan beberapa buku → 1 harga bundle</div>
        </div>
        <div class="mode-card ${S.scanMode==='restock'?'active-restock':''}" onclick="setScanModeRestock()">
          <div class="mode-card-icon" style="background:var(--blue-s)">📥</div>
          <div class="mode-card-title" style="color:${S.scanMode==='restock'?'var(--blue)':'var(--text)'}">Mode Restock</div>
          <div class="mode-card-desc">Scan → batch baru masuk stok</div>
        </div>
      </div>
      ${(S.scanMode||S.scanBundleMode) ? `
      <div class="scan-area">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
          <div style="font-weight:700;color:${S.scanBundleMode?'#7c3aed':S.scanMode==='sale'?'var(--green)':'var(--blue)'}">
            ${S.scanBundleMode?'📦 Mode Bundle Aktif':S.scanMode==='sale'?'🟢 Mode Jual Aktif':'🔵 Mode Restock Aktif'}
          </div>
          <button class="btn btn-ghost btn-sm" onclick="closeScanMode()">Tutup Mode</button>
        </div>
        <div class="field">
          <label>${S.scanBundleMode?'Scan buku satu per satu':'Scan barcode di sini'}</label>
          <input class="inp" id="scan-hw-input" autofocus
            placeholder="${S.scanBundleMode?'Scan buku pertama, lanjut scan buku berikutnya...':'Arahkan scanner atau ketik barcode...'}"
            style="font-size:15px;letter-spacing:2px;font-family:monospace;${S.scanBundleMode?'border-color:#7c3aed;':''}"
            onkeydown="if(event.key==='Enter'){${S.scanBundleMode?'processScanBundle(this.value)':'processScan(this.value)'};this.value=''}">
          <div class="hint" style="margin-top:6px">
            ${S.scanBundleMode
              ? '📦 Scan tiap buku → otomatis masuk list bundle · scan buku sama = qty +1'
              : '💡 Scanner USB/Bluetooth langsung terbaca otomatis · atau klik buku di bawah untuk simulasi'}
          </div>
        </div>

        ${S.scanBundleMode ? `
        <!-- ── BUNDLE SCAN UI ── -->
        <div style="margin-top:4px">
          ${S.scanBundleItems.length ? `
          <div style="margin-bottom:12px">
            <div style="font-size:12px;font-weight:600;color:#7c3aed;margin-bottom:8px">
              📦 Buku dalam bundle (${S.scanBundleItems.length} judul · ${S.scanBundleItems.reduce((s,i)=>s+i.qty,0)} buku):
            </div>
            ${S.scanBundleItems.map(item => {
              const { cogs } = fifoSim(item.book, item.qty);
              return `<div class="bundle-item-row" style="border-color:#e9d5ff">
                <div style="flex:1">
                  <div style="font-weight:600;font-size:13px">${item.book.title}</div>
                  <div style="font-size:11px;color:var(--text3)">HPP FIFO: ${fmt(Math.round(cogs/item.qty))}/pcs · Stok: ${totalStock(item.book)}</div>
                </div>
                <div style="display:flex;align-items:center;gap:6px">
                  <button class="btn btn-ghost btn-xs" onclick="changeScanBundleQty(${item.bookId},-1)">−</button>
                  <span style="font-weight:700;min-width:20px;text-align:center">${item.qty}</span>
                  <button class="btn btn-ghost btn-xs" onclick="changeScanBundleQty(${item.bookId},+1)">+</button>
                  <button class="btn btn-danger btn-xs" style="margin-left:4px" onclick="removeScanBundleItem(${item.bookId})">✕</button>
                </div>
              </div>`;
            }).join('')}

            ${(()=>{
              const totalHPP = S.scanBundleItems.reduce((s,item)=>{ const{cogs}=fifoSim(item.book,item.qty); return s+cogs; }, 0);
              const price = +( document.getElementById('scan-bundle-price')?.value || 0 );
              const profit = price - totalHPP;
              return `<div class="bundle-summary-bar" style="margin-top:10px">
                <div style="flex:1;font-size:12px">
                  <div>Total HPP modal: <strong style="color:var(--red)">${fmt(totalHPP)}</strong></div>
                </div>
                ${price ? `<div style="font-size:12px;text-align:right">
                  <div style="color:var(--text3)">Profit:</div>
                  <div style="font-weight:700;font-size:15px;color:${profit>=0?'var(--green)':'var(--red)'}">${fmt(profit)}</div>
                </div>` : ''}
              </div>`;
            })()}

            <div style="margin-top:12px;background:var(--bg);border:1px solid var(--border);border-radius:var(--radius-s);padding:12px">
              <div class="field" style="margin-bottom:8px">
                <label style="font-size:12px">Harga Jual Total Bundle (Rp) *</label>
                <input class="inp" id="scan-bundle-price" type="number" placeholder="Masukkan harga bundle..."
                  oninput="render()" style="border-color:#7c3aed">
              </div>
              <div class="field" style="margin-bottom:0">
                <label style="font-size:12px">Catatan (opsional)</label>
                <input class="inp" id="scan-bundle-note" placeholder="e.g. paket hemat..." value="">
              </div>
              <div class="field" style="margin-top:8px;margin-bottom:0">
                <label style="font-size:12px">Tanggal</label>
                <input class="inp" id="scan-bundle-date" type="date" value="${today()}" max="${today()}" style="max-width:180px">
              </div>
            </div>

            <div style="display:flex;gap:8px;margin-top:12px">
              <button class="btn btn-primary" style="background:#7c3aed;border-color:#7c3aed" onclick="confirmScanBundle()">
                ✓ Simpan Bundle
              </button>
              <button class="btn btn-ghost" onclick="resetScanBundleList()">Reset List</button>
            </div>
          </div>` : `
          <div style="text-align:center;padding:20px;color:var(--text3);font-size:13px;background:var(--bg);border-radius:var(--radius-s)">
            Scan buku pertama untuk memulai bundle...
          </div>`}

          <!-- Daftar buku untuk klik simulasi (bundle mode) -->
          <div style="margin-top:16px;border-top:1px solid var(--border);padding-top:14px">
            <div style="font-size:11px;font-weight:600;color:var(--text3);text-transform:uppercase;letter-spacing:.5px;margin-bottom:10px">Klik untuk tambah ke bundle</div>
            <div style="display:flex;flex-direction:column;gap:6px">
              ${S.books.filter(b=>totalStock(b)>0).map(b=>`
                <div onclick="processScanBundle('${b.barcode}')"
                  style="cursor:pointer;display:flex;justify-content:space-between;align-items:center;padding:10px 14px;background:var(--bg);border:1px solid ${S.scanBundleItems.find(i=>i.bookId===b.id)?'#7c3aed':'var(--border)'};border-radius:var(--radius-s);transition:all .15s"
                  onmouseover="this.style.borderColor='#7c3aed'" onmouseout="this.style.borderColor='${S.scanBundleItems.find(i=>i.bookId===b.id)?'#7c3aed':'var(--border)'}'">
                  <div>
                    <span style="font-weight:600">${b.title}</span>
                    ${S.scanBundleItems.find(i=>i.bookId===b.id) ? `<span class="badge bundle-badge" style="margin-left:6px;font-size:10px">×${S.scanBundleItems.find(i=>i.bookId===b.id).qty}</span>` : ''}
                  </div>
                  <span class="badge ${totalStock(b)<=5?'badge-red':'badge-green'}">${totalStock(b)}</span>
                </div>`).join('')}
            </div>
          </div>
        </div>` :

        S.scanResult ? `
        <div class="scan-result">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px;flex-wrap:wrap;gap:8px">
            <div>
              <div style="font-size:15px;font-weight:700">${S.scanResult.title}</div>
              <div style="font-size:12px;color:var(--text3);margin-top:3px">${S.scanResult.author||''} ${S.scanResult.publisher?`· <span class="badge badge-blue" style="font-size:10px">🏢 ${S.scanResult.publisher}</span>`:''}</div>
            </div>
            <span class="badge ${totalStock(S.scanResult)<=5?'badge-red':'badge-green'}" style="font-size:12px;padding:4px 10px">${totalStock(S.scanResult)} pcs</span>
          </div>

          ${S.scanMode==='sale' ? `
          <div style="background:var(--accent-s);border-radius:var(--radius-s);padding:10px 12px;margin-bottom:12px;font-size:12px;color:var(--accent)">
            <strong>Batch FIFO berikutnya:</strong><br>
            ${S.scanResult.batches.filter(b=>b.remaining>0).sort((a,c)=>a.date.localeCompare(c.date)).slice(0,2).map((bt,i)=>`${i+1}. ${bt.remaining} pcs · Beli ${fmt(bt.buyPrice)} · Masuk ${bt.date}`).join('<br>')}
          </div>` : ''}

          <div style="display:flex;gap:10px;align-items:center;margin-bottom:12px">
            <label style="font-size:12px;font-weight:600;color:var(--text2);white-space:nowrap">Jumlah:</label>
            <input type="number" class="inp" style="width:90px" min="1" value="${S.scanQty}" oninput="setScanQty(+this.value)">
          </div>

          ${S.scanMode==='sale' ? `
          <div class="override-panel">
            <div class="override-title">💰 Harga Jual</div>
            <div style="display:flex;gap:10px;align-items:flex-end">
              <div style="flex:1">
                <div style="font-size:11px;font-weight:600;color:var(--text3);margin-bottom:4px">Harga Normal</div>
                <input class="inp" type="number" value="${getNormalPrice(S.scanResult)}" readonly style="background:var(--bg)">
              </div>
              <div style="flex:1">
                <div style="font-size:11px;font-weight:600;color:var(--text3);margin-bottom:4px">Harga Final <span id="scan-over-tag" style="display:${(S.scanOverPrice!=null&&S.scanOverPrice!==getNormalPrice(S.scanResult))?'inline':'none'};color:var(--orange);font-size:10px">✎ diskon</span></div>
                <input class="inp" type="number"
                  value="${S.scanOverPrice!=null?S.scanOverPrice:getNormalPrice(S.scanResult)}"
                  id="scan-price-final" oninput="onScanPriceInput(this)" style="border-color:var(--accent)">
              </div>
              ${(()=>{const normalP=getNormalPrice(S.scanResult);const d=(S.scanOverPrice!=null?S.scanOverPrice:normalP)-normalP;
                if(d<0)return`<div class="price-diff-pill diff-down" id="scan-diff-pill">${fmt(d)}</div>`;
                if(d>0)return`<div class="price-diff-pill diff-up" id="scan-diff-pill">+${fmt(d)}</div>`;
                return`<div class="price-diff-pill diff-same" id="scan-diff-pill">—</div>`;
              })()}
            </div>
            <div id="scan-note-wrap" style="display:${(S.scanOverPrice!=null&&S.scanOverPrice!==getNormalPrice(S.scanResult))?'block':'none'};margin-top:10px;margin-bottom:0">
            <div class="field" style="margin-bottom:0">
              <label>Catatan <span style="color:var(--text3);font-weight:400">(wajib diisi)</span></label>
              <input class="inp" placeholder="e.g. diskon, harga event..." id="scan-note-input" value="${S.scanOverNote}" oninput="onScanNoteInput(this)">
            </div>
            </div>
          </div>

          ${(()=>{
            const fp=S.scanOverPrice!=null?S.scanOverPrice:getNormalPrice(S.scanResult);
            const{cogs,details}=fifoSim(S.scanResult,S.scanQty);
            const rev=S.scanQty*fp,profit=rev-cogs;
            return`<div class="preview-box" style="margin-top:10px">
              <strong>Preview FIFO:</strong><br>${details.map(d=>`Batch ${d.batchDate}: ${d.qty} × ${fmt(d.buyPrice)}`).join('<br>')}
              <div class="preview-stats">
                <div><div class="preview-stat-label">Revenue</div><div class="preview-stat-value" style="color:var(--green)" id="scan-prev-rev">${fmt(rev)}</div></div>
                <div><div class="preview-stat-label">HPP</div><div class="preview-stat-value" style="color:var(--red)" id="scan-prev-hpp">${fmt(cogs)}</div></div>
                <div><div class="preview-stat-label">Profit</div><div class="preview-stat-value" style="color:${profit>=0?'var(--green)':'var(--red)'}" id="scan-prev-prof">${fmt(profit)}</div></div>
              </div>
            </div>`;
          })()}` : ''}

          <div style="display:flex;gap:8px;margin-top:14px;align-items:flex-end">
            <button class="btn ${S.scanMode==='sale'?'btn-primary':'btn-green'}" onclick="confirmScan()">
              ✓ Konfirmasi ${S.scanMode==='sale'?'Jual':'Restock'}
            </button>
            <button class="btn btn-ghost" onclick="cancelScanResult()">Batal</button>
            ${S.scanMode==='sale'?`<div class="field" style="margin-bottom:0;margin-left:auto"><label style="font-size:11px">Tanggal</label><input class="inp" id="scan-sale-date" type="date" value="${today()}" max="${today()}" style="max-width:160px;font-size:12px"></div>`:''}
          </div>
        </div>` : ''}

        ${!S.scanBundleMode ? `<div style="margin-top:16px;border-top:1px solid var(--border);padding-top:14px">
          <div style="font-size:11px;font-weight:600;color:var(--text3);text-transform:uppercase;letter-spacing:.5px;margin-bottom:10px">Klik untuk simulasi scan</div>
          <div style="display:flex;flex-direction:column;gap:6px">
            ${S.books.map(b=>`
              <div onclick="processScan('${b.barcode}')" style="cursor:pointer;display:flex;justify-content:space-between;align-items:center;padding:10px 14px;background:var(--bg);border:1px solid var(--border);border-radius:var(--radius-s);transition:all .15s" onmouseover="this.style.borderColor='var(--accent)'" onmouseout="this.style.borderColor='var(--border)'">
                <div>
                  <span style="font-weight:600">${b.title}</span>
                  ${b.publisher?`<span class="badge badge-blue" style="font-size:10px;margin-left:6px">${b.publisher}</span>`:''}
                </div>
                <div style="display:flex;gap:8px;align-items:center">
                  <span style="font-family:monospace;font-size:11px;color:var(--text3)">${b.barcode}</span>
                  <span class="badge ${totalStock(b)<=5?'badge-red':'badge-green'}">${totalStock(b)}</span>
                </div>
              </div>`).join('')}
          </div>
        </div>` : ''}
      </div>` : `
      <div class="card" style="text-align:center;padding:40px 24px;color:var(--text3)">
        <div style="font-size:36px;margin-bottom:12px">📷</div>
        <div style="font-size:14px;font-weight:600;color:var(--text2);margin-bottom:4px">Pilih mode di atas untuk mulai scan</div>
        <div style="font-size:12px">Mode Jual untuk catat penjualan · Mode Restock untuk catat barang masuk</div>
      </div>`}`;
  }

  // ── PENJUALAN ──────────────────────────────────────────────────────────────
  if (S.currentTab === 'penjualan') {
    const penjualanFiltered = S.sales.filter(s => s.date >= S.period.from && s.date <= S.period.to);
    area.innerHTML = `
      <div class="page-hdr">
        <div><div class="page-title">Riwayat Penjualan</div><div class="page-sub">${penjualanFiltered.length} transaksi periode ini · hapus = stok kembali</div></div>
        <div class="page-actions">
          <button class="btn btn-ghost" onclick="openSaleManual()">+ Catat Manual</button>
          <button class="btn btn-ghost" onclick="openBundleModal()" style="background:#f3e8ff;color:#7c3aed;border-color:#e9d5ff">📦 Bundling</button>
          <button class="btn btn-primary" onclick="goTab('scanner')">⌖ Scanner</button>
        </div>
      </div>
      <div class="period-bar" style="margin-bottom:16px">
        <label>Periode</label>
        <input type="date" value="${S.period.from}" onchange="setPeriodFrom(this.value)">
        <span class="period-sep">—</span>
        <input type="date" value="${S.period.to}" onchange="setPeriodTo(this.value)">
      </div>
      ${penjualanFiltered.length === 0 ? `
        <div class="card" style="text-align:center;padding:48px 24px">
          <div style="font-size:36px;margin-bottom:12px">💳</div>
          <div style="font-size:15px;font-weight:600;margin-bottom:6px">${S.sales.length === 0 ? 'Belum ada transaksi' : 'Tidak ada transaksi di periode ini'}</div>
          <div style="font-size:13px;color:var(--text3);margin-bottom:20px">${S.sales.length === 0 ? 'Catat penjualan manual atau gunakan scanner' : 'Coba ubah rentang tanggal di atas'}</div>
          ${S.sales.length === 0 ? `<div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap">
            <button class="btn btn-ghost" onclick="openSaleManual()">+ Catat Manual</button>
            <button class="btn btn-ghost" onclick="openBundleModal()" style="background:#f3e8ff;color:#7c3aed;border-color:#e9d5ff">📦 Bundling</button>
            <button class="btn btn-primary" onclick="goTab('scanner')">⌖ Buka Scanner</button>
          </div>` : ''}
        </div>` : `
      <div class="card">
        <div class="table-wrap">
          <table>
            <thead><tr><th>Tanggal</th><th>Buku / Bundle</th><th>Qty</th><th>Modal/pcs</th><th>Harga Final</th><th>Profit</th><th>Via</th><th>Catatan</th><th></th></tr></thead>
            <tbody>
              ${[...penjualanFiltered].reverse().map(x => {
                if (x.isBundle) {
                  return `
                    <tr class="bundle-row">
                      <td style="color:var(--text3);white-space:nowrap">${x.date}</td>
                      <td><span class="badge bundle-badge" style="font-size:10px;margin-right:4px">📦</span><strong style="color:#7c3aed" title="${bundleFull(x)}">${bundleShort(x)}</strong></td>
                      <td style="color:#7c3aed;font-size:12px">${x.qty} buku</td>
                      <td style="color:var(--text2);font-size:12px">${fmt(Math.round((x.cogs||0)/(x.qty||1)))}</td>
                      <td><strong style="color:#7c3aed">${fmt(x.finalPrice||x.finalSellPrice)}</strong></td>
                      <td style="color:var(--green);font-weight:600;white-space:nowrap">${fmt(x.profit)}</td>
                      <td><span class="badge badge-gray">${x.via}</span></td>
                      <td style="color:var(--text3);font-size:12px;max-width:120px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${x.note||'—'}</td>
                      <td><button class="btn btn-danger btn-xs" onclick="deleteSaleBundle(${x.id})">Hapus</button></td>
                    </tr>`;
                }
                return `
                  <tr>
                    <td style="color:var(--text3);white-space:nowrap">${x.date}</td>
                    <td style="font-weight:600">${x.bookTitle}</td>
                    <td>${x.qty}</td>
                    <td style="color:var(--text2);font-size:12px">${fmt(x.buyPrice||Math.round((x.cogs||0)/(x.qty||1)))}</td>
                    <td>${x.priceOverride
                      ? `<strong style="color:var(--orange)">${fmt(x.finalPrice||x.finalSellPrice)}</strong> <span class="badge badge-orange" style="font-size:10px">diskon</span>`
                      : `<strong>${fmt(x.finalPrice||x.finalSellPrice)}</strong>`}</td>
                    <td style="color:var(--green);font-weight:600;white-space:nowrap">${fmt(x.profit)}</td>
                    <td><span class="badge ${x.via==='scan'?'badge-accent':'badge-gray'}">${x.via}</span></td>
                    <td style="color:var(--text3);font-size:12px;max-width:120px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${x.note||'—'}</td>
                    <td><button class="btn btn-danger btn-xs" onclick="deleteSale(${x.id})" title="Hapus transaksi & kembalikan stok">Hapus</button></td>
                  </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>`}`;
  }

  // ── RESTOCK ────────────────────────────────────────────────────────────────
  if (S.currentTab === 'restock') {
    area.innerHTML = `
      <div class="page-hdr">
        <div><div class="page-title">Restock / Buku Masuk</div><div class="page-sub">${S.restocks.length} riwayat masuk</div></div>
      </div>
      ${S.restocks.length === 0 ? `
        <div class="card" style="text-align:center;padding:48px 24px">
          <div style="font-size:36px;margin-bottom:12px">📥</div>
          <div style="font-size:15px;font-weight:600;margin-bottom:6px">Belum ada restock</div>
          <div style="font-size:13px;color:var(--text3)">Tambahkan stok dari halaman Stok Buku atau gunakan Scanner mode Restock</div>
        </div>` : `
      <div class="card">
        <div class="table-wrap">
          <table>
            <thead><tr><th>Tanggal</th><th>Buku</th><th>Qty Masuk</th><th>Harga Beli</th><th>Total Modal</th><th></th></tr></thead>
            <tbody>
              ${[...S.restocks].reverse().map(x => `
                <tr>
                  <td style="color:var(--text3)">${x.date}</td>
                  <td style="font-weight:600">${x.bookTitle}</td>
                  <td><span class="badge badge-blue">+${x.qty}</span></td>
                  <td>${fmt(x.buyPrice)}</td>
                  <td style="font-weight:600">${fmt(x.qty*x.buyPrice)}</td>
                  <td><button class="btn btn-danger btn-xs" onclick="deleteRestock(${x.id})">Hapus</button></td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>`}`;
  }

  // ── LAPORAN ────────────────────────────────────────────────────────────────
  if (S.currentTab === 'laporan') {
    // Bundle data
    const bundles = filtered.filter(s => s.isBundle);

    // Profit per buku dari penjualan satuan
    const profitByBook = S.books.map(b => {
      const bs = filtered.filter(s => s.bookId===b.id && !s.isBundle);
      const rev  = bs.reduce((s,x) => s+x.qty*(x.finalPrice||x.finalSellPrice||0), 0);
      const cogs = bs.reduce((s,x) => s+x.cogs, 0);
      // Tambahkan kontribusi dari bundling (HPP per buku dalam bundle)
      const bundleSales = filtered.filter(s => s.isBundle && s.bundleItems?.some(i=>i.bookId===b.id));
      const bundleQty   = bundleSales.reduce((s,x) => s + (x.bundleItems?.find(i=>i.bookId===b.id)?.qty||0), 0);
      const bundleCogs  = bundleSales.reduce((s,x) => s + (x.bundleItems?.find(i=>i.bookId===b.id)?.cogs||0), 0);
      return { ...b, revenue:rev, profit:rev-cogs, unitsSold:bs.reduce((s,x)=>s+x.qty,0)+bundleQty, bundleQty, bundleCogs };
    }).sort((a,b) => b.profit-a.profit);
    // Bundle summary
    const bundleSummary = bundles.reduce((acc, x) => {
      acc.count++;
      acc.revenue += x.finalPrice||x.finalSellPrice||0;
      acc.cogs    += x.cogs||0;
      acc.profit  += x.profit||0;
      acc.qty     += x.qty||0;
      return acc;
    }, { count:0, revenue:0, cogs:0, profit:0, qty:0 });
    const maxP = Math.max(...profitByBook.map(b=>b.profit), 1);
    const overrides = filtered.filter(s => s.priceOverride && !s.isBundle);

    area.innerHTML = `
      <div class="page-hdr">
        <div><div class="page-title">Laporan Keuangan</div><div class="page-sub">Profit akurat berdasarkan FIFO</div></div>
        <button class="btn btn-primary" onclick="exportCSV()">↓ Export CSV</button>
      </div>

      <div class="period-bar">
        <label>Periode</label>
        <input type="date" value="${S.period.from}" onchange="setPeriodFrom(this.value)">
        <span class="period-sep">—</span>
        <input type="date" value="${S.period.to}" onchange="setPeriodTo(this.value)">
        <span class="period-count">${filtered.length} transaksi ditemukan</span>
      </div>

      <div class="stat-grid">
        <div class="stat-card"><div class="stat-label">Revenue</div><div class="stat-value" style="color:var(--green)">${fmt(totalRev)}</div></div>
        <div class="stat-card"><div class="stat-label">HPP Total (FIFO)</div><div class="stat-value" style="color:var(--red)">${fmt(totalCOGS)}</div></div>
        <div class="stat-card"><div class="stat-label">Profit Bersih</div><div class="stat-value" style="color:var(--accent)">${fmt(totalProfit)}</div></div>
        <div class="stat-card"><div class="stat-label">Margin</div><div class="stat-value" style="color:var(--amber)">${totalRev?Math.round(totalProfit/totalRev*100):0}%</div></div>
      </div>

      ${bundleSummary.count ? `
      <div style="background:#fdf4ff;border:1px solid #e9d5ff;border-radius:var(--radius);padding:16px 20px;margin-bottom:16px">
        <div style="font-size:13px;font-weight:700;color:#7c3aed;margin-bottom:12px">📦 Ringkasan Penjualan Bundling (${bundleSummary.count} transaksi)</div>
        <div class="stat-grid" style="grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;margin-bottom:14px">
          <div class="stat-card" style="border-color:#e9d5ff"><div class="stat-label">Total Buku</div><div class="stat-value" style="font-size:18px;color:#7c3aed">${bundleSummary.qty}</div></div>
          <div class="stat-card" style="border-color:#e9d5ff"><div class="stat-label">Revenue Bundle</div><div class="stat-value" style="font-size:18px;color:var(--green)">${fmt(bundleSummary.revenue)}</div></div>
          <div class="stat-card" style="border-color:#e9d5ff"><div class="stat-label">HPP Bundle</div><div class="stat-value" style="font-size:18px;color:var(--red)">${fmt(bundleSummary.cogs)}</div></div>
          <div class="stat-card" style="border-color:#e9d5ff"><div class="stat-label">Profit Bundle</div><div class="stat-value" style="font-size:18px;color:#7c3aed">${fmt(bundleSummary.profit)}</div></div>
        </div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Tanggal</th><th>Isi Bundle</th><th>Total Buku</th><th>HPP Modal</th><th>Harga Jual</th><th>Profit</th><th>Catatan</th></tr></thead>
            <tbody>
              ${[...bundles].reverse().map(x=>`<tr>
                <td style="color:var(--text3)">${x.date}</td>
                <td style="font-size:12px;color:#7c3aed" title="${x.bundleItems?bundleFull(x):x.bookTitle}">${x.bundleItems?bundleShort(x):x.bookTitle}</td>
                <td>${x.qty}</td>
                <td style="color:var(--text2)">${fmt(x.cogs||0)}</td>
                <td style="font-weight:600;color:#7c3aed">${fmt(x.finalPrice||x.finalSellPrice)}</td>
                <td style="font-weight:600;color:var(--green)">${fmt(x.profit)}</td>
                <td style="color:var(--text3);font-size:12px">${x.note||'—'}</td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>` : ''}

      ${overrides.length ? `
      <div class="override-section">
        <div style="font-size:13px;font-weight:700;color:var(--orange);margin-bottom:12px">⬦ Transaksi Harga Diskon / Custom (${overrides.length})</div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Tanggal</th><th>Buku</th><th>Qty</th><th>Modal/pcs</th><th>Harga Final</th><th>Selisih vs Normal</th><th>Catatan</th></tr></thead>
            <tbody>
              ${[...overrides].reverse().map(x => {
                const normP = x.normalPrice||x.sellPrice||0;
                const finP  = x.finalPrice||x.finalSellPrice||0;
                const diff  = x.qty*(finP-normP);
                return `<tr>
                  <td style="color:var(--text3)">${x.date}</td>
                  <td style="font-weight:600">${x.bookTitle}</td>
                  <td>${x.qty}</td>
                  <td style="color:var(--text2);font-size:12px">${fmt(x.buyPrice||Math.round((x.cogs||0)/(x.qty||1)))}</td>
                  <td style="color:var(--orange);font-weight:600">${fmt(finP)}</td>
                  <td style="font-weight:600;color:${diff<0?'var(--red)':'var(--green)'}">${diff>=0?'+':''}${fmt(diff)} (${fmt(normP)} normal)</td>
                  <td style="color:var(--text3);font-size:12px">${x.note||'—'}</td>
                </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>` : ''}

      <div class="card">
        <div class="card-title">Profit per Judul Buku</div>
        ${profitByBook.filter(b=>b.unitsSold>0).length===0
          ? `<div style="text-align:center;padding:24px;color:var(--text3);font-size:13px">Tidak ada penjualan di periode ini</div>`
          : profitByBook.filter(b=>b.unitsSold>0).map(b=>`
            <div style="margin-bottom:16px">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;flex-wrap:wrap;gap:4px">
                <div>
                  <span style="font-weight:600;font-size:13px">${b.title}</span>
                  ${b.publisher?`<span class="badge badge-blue" style="font-size:10px;margin-left:6px">${b.publisher}</span>`:''}
                </div>
                <div style="display:flex;gap:12px;align-items:center">
                  <span style="font-size:12px;color:var(--text3)">${b.unitsSold} terjual</span>
                  <span style="font-weight:700;color:var(--green)">${fmt(b.profit)}</span>
                </div>
              </div>
              <div class="profit-bar-wrap">
                <div class="profit-bar-fill" style="width:${Math.max((b.profit/maxP)*100,2)}%"></div>
              </div>
            </div>`).join('')}
      </div>

      ${filtered.length > 0 ? `
      <div class="card">
        <div class="card-title">Detail Transaksi Periode Ini</div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Tanggal</th><th>Buku</th><th>Qty</th><th>Harga Final</th><th>Revenue</th><th>HPP Modal</th><th>Profit</th></tr></thead>
            <tbody>
              ${filtered.map(x=>`
                <tr>
                  <td style="color:var(--text3)">${x.date}</td>
                  <td style="font-weight:600">${x.bookTitle}</td>
                  <td>${x.qty}</td>
                  <td>${x.priceOverride?`<strong style="color:var(--orange)">${fmt(x.finalPrice||x.finalSellPrice)}</strong>`:fmt(x.finalPrice||x.finalSellPrice)}</td>
                  <td>${fmt(x.qty*(x.finalPrice||x.finalSellPrice||0))}</td>
                  <td style="color:var(--text2)">${fmt(x.cogs)}</td>
                  <td style="font-weight:600;color:var(--green)">${fmt(x.profit)}</td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>` : ''}`;
  }

  // ── PREORDER ───────────────────────────────────────────────────────────────
  if (S.currentTab === 'preorder') {
    const fmtDate = d => { if (!d) return '—'; const [y,m,day]=d.split('-'); return `${day}/${m}/${y}`; };
    const pos = (S.preorders || []).map(po => ({ ...po, status: getPoStatus(po), total: getPoTotal(po) }));

    const filterStatus = document.getElementById('po-filter-status')?.value || 'all';
    const searchQ = (document.getElementById('po-search')?.value || '').toLowerCase().trim();

    const poFiltered = pos.filter(po => {
      const matchStatus = filterStatus === 'all' || po.status === filterStatus;
      const matchSearch = !searchQ || po.publisher.toLowerCase().includes(searchQ) ||
        (po.items||[]).some(i => i.title.toLowerCase().includes(searchQ));
      return matchStatus && matchSearch;
    });

    poFiltered.sort((a,b) => {
      const order = { overdue:0, unpaid:1, partial:2, paid:3 };
      if (order[a.status] !== order[b.status]) return order[a.status] - order[b.status];
      return (a.dueDate||a.openDate||'').localeCompare(b.dueDate||b.openDate||'');
    });

    const totalOutstanding = pos.filter(p=>p.status!=='paid').reduce((s,p)=>s+(p.total-(p.paidAmount||0)),0);
    const totalPaid    = pos.filter(p=>p.status==='paid').reduce((s,p)=>s+p.total,0);
    const countOverdue = pos.filter(p=>p.status==='overdue').length;
    const countUnpaid  = pos.filter(p=>p.status==='unpaid').length;

    const statusCfg = {
      paid:    { label: 'Lunas',          dot: '#22c55e', bg: '#f0fdf4', color: '#16a34a', border: '#bbf7d0' },
      partial: { label: 'Bayar Sebagian', dot: '#a78bfa', bg: '#faf5ff', color: '#7c3aed', border: '#e9d5ff' },
      unpaid:  { label: 'Belum Bayar',    dot: '#fbbf24', bg: '#fffbeb', color: '#b45309', border: '#fde68a' },
      overdue: { label: 'Terlambat',      dot: '#f87171', bg: '#fff1f2', color: '#e11d48', border: '#fecdd3' },
    };

    const urgBadge = (dueDate, status) => {
      if (status === 'paid' || !dueDate) return '';
      const days = Math.round((new Date(dueDate).setHours(0,0,0,0) - new Date().setHours(0,0,0,0)) / 86400000);
      if (days < 0)   return `<span class="po2-urgency po2-urgency-overdue">Lewat ${Math.abs(days)}h</span>`;
      if (days === 0) return `<span class="po2-urgency po2-urgency-today">Hari ini!</span>`;
      if (days <= 3)  return `<span class="po2-urgency po2-urgency-soon">${days} hari lagi</span>`;
      if (days <= 7)  return `<span class="po2-urgency po2-urgency-week">${days} hari lagi</span>`;
      return '';
    };

    const tableRows = poFiltered.length === 0
      ? `<tr><td colspan="7" style="text-align:center;padding:40px;color:var(--text3);font-size:13px">
          ${searchQ ? `Tidak ada hasil untuk "${searchQ}"` : 'Belum ada preorder. Buat PO pertama kamu.'}
         </td></tr>`
      : poFiltered.map(po => {
          const cfg       = statusCfg[po.status] || statusCfg.unpaid;
          const remaining = po.total - (po.paidAmount || 0);
          const isPaid    = po.status === 'paid';
          const isOverdue = po.status === 'overdue';
          const bookCount = (po.items||[]).reduce((s,i) => s + Number(i.qty||0), 0);
          const pct       = po.total > 0 ? Math.min(100, Math.round((po.paidAmount||0) / po.total * 100)) : 0;

          // Item list
          const itemsHtml = (po.items||[]).map(item =>
            `<div class="po-row-item">
              <span class="po-row-item-title">${item.title}</span>
              <span class="po-row-item-meta">${item.qty} pcs · ${fmt(item.pricePerPcs)}/pcs</span>
            </div>`
          ).join('');

          // Expand detail row (dates + progress)
          const expandId = 'po-expand-' + po.id;
          const dateItems = [
            po.openDate  ? `<div class="po-date-item"><span class="po-date-label">Open</span><span class="po-date-val">${fmtDate(po.openDate)}</span></div>`  : '',
            po.closeDate ? `<div class="po-date-item"><span class="po-date-label">Close</span><span class="po-date-val">${fmtDate(po.closeDate)}</span></div>` : '',
            po.readyDate ? `<div class="po-date-item"><span class="po-date-label">Ready</span><span class="po-date-val">${fmtDate(po.readyDate)}</span></div>` : '',
            po.dueDate   ? `<div class="po-date-item"><span class="po-date-label">Deadline</span><span class="po-date-val">${fmtDate(po.dueDate)}</span></div>` : '',
          ].filter(Boolean).join('');

          const expandRow = `
            <tr class="po-expand-row" id="${expandId}" style="display:none">
              <td colspan="7" class="po-expand-cell">
                <div class="po-expand-inner">
                  <div class="po-expand-dates">${dateItems}</div>
                  ${po.total > 0 ? `
                  <div class="po-expand-progress">
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;font-size:12px">
                      <span style="color:var(--text3);font-weight:600">Pembayaran</span>
                      <span style="color:var(--text2)">${pct}% terbayar · ${fmt(po.paidAmount||0)} dari ${fmt(po.total)}</span>
                    </div>
                    <div style="background:var(--border);border-radius:3px;height:6px;overflow:hidden">
                      <div style="height:100%;border-radius:3px;width:${pct}%;background:${isPaid?'#22c55e':isOverdue?'#f87171':'var(--accent)'}"></div>
                    </div>
                  </div>` : ''}
                  ${po.lastPayDate ? `<div style="font-size:11px;color:var(--text3);margin-top:8px">Bayar terakhir: ${fmtDate(po.lastPayDate)}</div>` : ''}
                </div>
              </td>
            </tr>`;

          const mainRow = `
            <tr class="po-row${isOverdue ? ' po-row-overdue' : ''}" style="cursor:pointer"
              onclick="(function(){const r=document.getElementById('${expandId}');const open=r.style.display==='table-row';r.style.display=open?'none':'table-row';})()">
              <td class="po-row-publisher-cell">
                <div class="po-row-publisher-name">
                  ${po.publisher}
                  ${urgBadge(po.dueDate, po.status)}
                </div>
                <div class="po-row-items">${itemsHtml}</div>
                <div class="po-row-bookmeta">${bookCount} buku · ${(po.items||[]).length} judul
                  ${po.bookArrived ? `<span class="po-row-arrived">✓ Stok masuk</span>` : ''}
                </div>
              </td>
              <td class="po-row-date-cell">${fmtDate(po.openDate)}</td>
              <td class="po-row-date-cell">${fmtDate(po.dueDate)}</td>
              <td>
                <span class="po2-status-pill" style="background:${cfg.bg};color:${cfg.color};border-color:${cfg.border}">
                  <span class="po2-status-dot" style="background:${cfg.dot}"></span>
                  ${cfg.label}
                </span>
              </td>
              <td class="po-row-amount-cell">
                <div class="po-row-amount-total">${fmt(po.total)}</div>
                ${po.paidAmount > 0 && !isPaid ? `<div class="po-row-amount-sub">Bayar: ${fmt(po.paidAmount)}</div>` : ''}
              </td>
              <td class="po-row-amount-cell">
                ${remaining > 0
                  ? `<span class="po-row-sisa">${fmt(remaining)}</span>`
                  : `<span class="po-row-lunas">Lunas</span>`}
              </td>
              <td class="po-row-actions-cell" onclick="event.stopPropagation()">
                ${!isPaid
                  ? `<button class="btn btn-ghost btn-sm" onclick="openQuickPayPo('${po.id}')" style="color:var(--accent);border-color:var(--accent-t)">Bayar</button>`
                  : ''}
                ${isPaid && !po.bookArrived
                  ? `<button class="btn btn-ghost btn-sm" onclick="openBukuDatang('${po.id}')" style="color:#16a34a;border-color:#bbf7d0">Buku Datang</button>`
                  : ''}
                <button class="btn btn-ghost btn-xs" onclick="openEditPreorder('${po.id}')" title="Edit">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                </button>
                <button class="btn btn-ghost btn-xs" onclick="deletePreorder('${po.id}')" title="Hapus" style="color:var(--red)">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                </button>
              </td>
            </tr>
            ${expandRow}`;

          return mainRow;
        }).join('');

    area.innerHTML = `
      <div class="page-hdr">
        <div>
          <div class="page-title">Preorder Buku</div>
          <div class="page-sub">Kelola PO ke penerbit & track pembayaran</div>
        </div>
        <button class="btn btn-primary" onclick="openAddPreorder()">+ Buat PO</button>
      </div>

      <div class="stat-grid">
        <div class="stat-card">
          <div class="stat-icon" style="background:#dbeafe">💳</div>
          <div class="stat-label">Outstanding</div>
          <div class="stat-value" style="color:#2563eb">${fmt(totalOutstanding)}</div>
          <div class="stat-sub">Belum lunas</div>
        </div>
        <div class="stat-card">
          <div class="stat-icon" style="background:#fff1f2">⚠️</div>
          <div class="stat-label">Terlambat</div>
          <div class="stat-value" style="color:#e11d48">${countOverdue} <span style="font-size:14px;font-weight:500">PO</span></div>
          <div class="stat-sub">Lewat deadline</div>
        </div>
        <div class="stat-card">
          <div class="stat-icon" style="background:#fffbeb">⏳</div>
          <div class="stat-label">Belum Bayar</div>
          <div class="stat-value" style="color:#b45309">${countUnpaid} <span style="font-size:14px;font-weight:500">PO</span></div>
          <div class="stat-sub">Perlu dibayar</div>
        </div>
        <div class="stat-card">
          <div class="stat-icon" style="background:#f0fdf4">✅</div>
          <div class="stat-label">Total Lunas</div>
          <div class="stat-value" style="color:#16a34a">${fmt(totalPaid)}</div>
          <div class="stat-sub">Sudah dibayar</div>
        </div>
      </div>

      <div class="search-row" style="margin-bottom:10px">
        <div style="position:relative;flex:1;min-width:180px">
          <input class="search-input" type="text" id="po-search"
            placeholder="Cari penerbit, judul buku..."
            oninput="render()" value="${searchQ}" style="width:100%">
        </div>
      </div>
      <div class="filter-row" style="margin-bottom:16px">
        <span class="filter-label">Status</span>
        ${['all','overdue','unpaid','partial','paid'].map(s => {
          const labels = { all:'Semua', overdue:'Terlambat', unpaid:'Belum Bayar', partial:'Sebagian', paid:'Lunas' };
          const counts = {
            all:     pos.length,
            overdue: pos.filter(p=>p.status==='overdue').length,
            unpaid:  pos.filter(p=>p.status==='unpaid').length,
            partial: pos.filter(p=>p.status==='partial').length,
            paid:    pos.filter(p=>p.status==='paid').length,
          };
          return `<span class="filter-chip ${filterStatus===s?'active':''}"
            onclick="document.getElementById('po-filter-status').value='${s}';render()">
            ${labels[s]}${counts[s]>0?`<span style="margin-left:4px;font-size:10px;opacity:.7">${counts[s]}</span>`:''}
          </span>`;
        }).join('')}
        <select id="po-filter-status" style="display:none" onchange="render()">
          <option value="all">all</option>
          <option value="overdue">overdue</option>
          <option value="unpaid">unpaid</option>
          <option value="partial">partial</option>
          <option value="paid">paid</option>
        </select>
      </div>

      <div class="card" style="padding:0;overflow:hidden">
        <div class="table-wrap">
          <table class="po-table">
            <colgroup>
              <col style="width:auto">
              <col style="width:100px">
              <col style="width:100px">
              <col style="width:145px">
              <col style="width:120px">
              <col style="width:110px">
              <col style="width:170px">
            </colgroup>
            <thead>
              <tr>
                <th>Penerbit / Buku</th>
                <th>Tgl PO</th>
                <th>Deadline</th>
                <th>Status</th>
                <th style="text-align:right">Total PO</th>
                <th style="text-align:right">Sisa</th>
                <th>Aksi</th>
              </tr>
            </thead>
            <tbody>${tableRows}</tbody>
          </table>
        </div>
      </div>
      <div style="font-size:11px;color:var(--text3);margin-top:8px">↕ Klik baris untuk lihat detail tanggal & progress bayar</div>`;

    const sel = document.getElementById('po-filter-status');
    if (sel) sel.value = filterStatus;
  }

  // ── CASHFLOW ───────────────────────────────────────────────────────────────
  if (S.currentTab === 'cashflow') {
    // Import helpers from cashflow module (available via window bridge)
    const ledger  = window._cfBuildLedger  ? window._cfBuildLedger(S.period.from, S.period.to)  : [];
    const summary = window._cfCalcSummary  ? window._cfCalcSummary(ledger) : { totalCashIn:0, totalCashOut:0, netCashflow:0, dpPending:0 };

    const filterType = document.getElementById('cf-filter-type')?.value || 'all';
    const filterCat  = document.getElementById('cf-filter-cat')?.value  || 'all';
    const searchQ    = (document.getElementById('cf-search')?.value || '').toLowerCase().trim();

    const displayLedger = ledger.filter(e => {
      const matchType   = filterType === 'all' || e.type === filterType;
      const matchCat    = filterCat  === 'all' || e.category === filterCat;
      const matchSearch = !searchQ   || e.note.toLowerCase().includes(searchQ) || (window._cfCategoryLabels?.[e.category]||'').toLowerCase().includes(searchQ);
      return matchType && matchCat && matchSearch;
    });

    const fmtDate = d => { if (!d) return '—'; const [y,m,day]=d.split('-'); return `${day}/${m}/${y}`; };

    const catLabel = c => window._cfCategoryLabels?.[c] || c;

    const categoryBadgeStyle = (cat, type) => {
      const styles = {
        penjualan:   'background:#dcfce7;color:#16a34a',
        dp_customer: 'background:#faf5ff;color:#7c3aed',
        bayar_po:    'background:#fee2e2;color:#dc2626',
        ongkir:      'background:#fff7ed;color:#c2410c',
        operasional: 'background:#f0f9ff;color:#0369a1',
        lainnya:     'background:#f5f5f4;color:#57534e',
      };
      return styles[cat] || (type==='income' ? 'background:#dcfce7;color:#16a34a' : 'background:#fee2e2;color:#dc2626');
    };

    const rows = displayLedger.length === 0
      ? `<tr><td colspan="6" style="text-align:center;padding:32px;color:var(--text3);font-size:13px">
          ${ledger.length === 0 ? 'Belum ada data cashflow di periode ini' : 'Tidak ada entri yang cocok dengan filter'}
         </td></tr>`
      : displayLedger.map(e => {
          const isPending  = e.isAdvance && !e.delivered;
          const isAuto     = e.source === 'auto';
          const isIncome   = e.type   === 'income';

          return `<tr style="${isPending ? 'opacity:.75;font-style:italic' : ''}">
            <td style="color:var(--text3);white-space:nowrap;font-size:12px">${fmtDate(e.date)}</td>
            <td>
              <div style="font-size:13px;font-weight:${isAuto?'500':'600'}">${e.note}</div>
              ${isPending ? `<div style="font-size:11px;color:#7c3aed;margin-top:2px">⏳ Buku belum dikirim</div>` : ''}
            </td>
            <td>
              <span style="font-size:11px;font-weight:600;padding:3px 8px;border-radius:20px;${categoryBadgeStyle(e.category, e.type)}">
                ${catLabel(e.category)}
              </span>
              ${isAuto ? `<span style="font-size:10px;color:var(--text3);margin-left:4px">auto</span>` : ''}
            </td>
            <td style="text-align:right;font-weight:600;color:var(--green)">
              ${isIncome ? fmt(e.amount) : '—'}
            </td>
            <td style="text-align:right;font-weight:600;color:var(--red)">
              ${!isIncome ? fmt(e.amount) : '—'}
            </td>
            <td style="text-align:right">
              ${isAuto ? '' : `
                <div style="display:flex;gap:4px;justify-content:flex-end;align-items:center">
                  ${isPending ? `
                    <button class="btn btn-ghost btn-xs" onclick="cfMarkDelivered('${e.id}')" title="Tandai sudah dikirim" style="color:var(--green);border-color:var(--green);font-size:10px;padding:3px 7px">
                      ✓ Delivered
                    </button>` : ''}
                  <button class="btn btn-ghost btn-xs" onclick="openEditCashflow('${e.id}')" title="Edit">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                  </button>
                  <button class="btn btn-ghost btn-xs" onclick="deleteCashflow('${e.id}')" title="Hapus" style="color:var(--red);border-color:var(--red-s)">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                  </button>
                </div>`}
            </td>
          </tr>`;
        }).join('');

    area.innerHTML = `
      <div class="page-hdr">
        <div>
          <div class="page-title">Cashflow</div>
          <div class="page-sub">Ledger pemasukan &amp; pengeluaran toko</div>
        </div>
        <button class="btn btn-primary" onclick="openAddCashflow()">+ Tambah Entri</button>
      </div>

      <div class="period-bar" style="margin-bottom:16px">
        <label>Periode</label>
        <input type="date" value="${S.period.from}" onchange="setPeriodFrom(this.value)">
        <span class="period-sep">—</span>
        <input type="date" value="${S.period.to}" onchange="setPeriodTo(this.value)">
      </div>

      <!-- Summary strip -->
      <div class="stat-grid">
        <div class="stat-card">
          <div class="stat-icon" style="background:#dcfce7">💰</div>
          <div class="stat-label">Total Cash In</div>
          <div class="stat-value" style="color:var(--green)">${fmt(summary.totalCashIn)}</div>
          <div class="stat-sub">Termasuk DP pending</div>
        </div>
        <div class="stat-card">
          <div class="stat-icon" style="background:#fee2e2">💸</div>
          <div class="stat-label">Total Cash Out</div>
          <div class="stat-value" style="color:var(--red)">${fmt(summary.totalCashOut)}</div>
          <div class="stat-sub">Semua pengeluaran</div>
        </div>
        <div class="stat-card">
          <div class="stat-icon" style="background:#ede9fe">📊</div>
          <div class="stat-label">Net Cashflow</div>
          <div class="stat-value" style="color:${summary.netCashflow>=0?'var(--accent)':'var(--red)'}">${fmt(summary.netCashflow)}</div>
          <div class="stat-sub">Diluar DP pending</div>
        </div>
        <div class="stat-card">
          <div class="stat-icon" style="background:#faf5ff">⏳</div>
          <div class="stat-label">DP Pending</div>
          <div class="stat-value" style="color:#7c3aed">${fmt(summary.dpPending)}</div>
          <div class="stat-sub">Buku belum dikirim</div>
        </div>
      </div>

      ${summary.dpPending > 0 ? `
      <div style="display:flex;align-items:center;gap:10px;padding:10px 14px;background:#faf5ff;border:1px solid #e9d5ff;border-radius:var(--radius-s);margin-bottom:16px;font-size:12px;color:#7c3aed">
        <span style="font-size:16px">⚠</span>
        <span><strong>${fmt(summary.dpPending)}</strong> uang muka belum dipenuhi — tandai sebagai Delivered setelah buku dikirim</span>
      </div>` : ''}

      <!-- Filters -->
      <div class="search-row" style="margin-bottom:12px">
        <div style="position:relative;flex:1;min-width:180px">
          <input class="search-input" type="text" id="cf-search"
            placeholder="Cari keterangan, kategori..."
            oninput="render()" value="${searchQ}"
            style="width:100%">
        </div>
        <select class="inp" id="cf-filter-type" onchange="render()" style="max-width:140px;font-size:13px">
          <option value="all"     ${filterType==='all'    ?'selected':''}>Semua Tipe</option>
          <option value="income"  ${filterType==='income' ?'selected':''}>Pemasukan</option>
          <option value="expense" ${filterType==='expense'?'selected':''}>Pengeluaran</option>
        </select>
        <select class="inp" id="cf-filter-cat" onchange="render()" style="max-width:160px;font-size:13px">
          <option value="all"         ${filterCat==='all'        ?'selected':''}>Semua Kategori</option>
          <option value="penjualan"   ${filterCat==='penjualan'  ?'selected':''}>Penjualan</option>
          <option value="dp_customer" ${filterCat==='dp_customer'?'selected':''}>DP / Uang Muka</option>
          <option value="bayar_po"    ${filterCat==='bayar_po'   ?'selected':''}>Bayar PO</option>
          <option value="ongkir"      ${filterCat==='ongkir'     ?'selected':''}>Ongkir</option>
          <option value="operasional" ${filterCat==='operasional'?'selected':''}>Operasional</option>
          <option value="lainnya"     ${filterCat==='lainnya'    ?'selected':''}>Lainnya</option>
        </select>
      </div>

      <!-- Ledger table -->
      <div class="card" style="padding:0;overflow:hidden">
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Tanggal</th>
                <th>Keterangan</th>
                <th>Kategori</th>
                <th style="text-align:right">Masuk</th>
                <th style="text-align:right">Keluar</th>
                <th style="text-align:right"></th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
            ${displayLedger.length > 0 ? `
            <tfoot>
              <tr style="background:var(--surface);font-weight:700;font-size:13px">
                <td colspan="3" style="padding:10px 12px;color:var(--text2)">Total periode ini</td>
                <td style="text-align:right;padding:10px 12px;color:var(--green)">${fmt(displayLedger.filter(e=>e.type==='income').reduce((s,e)=>s+e.amount,0))}</td>
                <td style="text-align:right;padding:10px 12px;color:var(--red)">${fmt(displayLedger.filter(e=>e.type==='expense').reduce((s,e)=>s+e.amount,0))}</td>
                <td></td>
              </tr>
            </tfoot>` : ''}
          </table>
        </div>
      </div>

      <p style="font-size:11px;color:var(--text3);margin-top:12px;line-height:1.6">
        * Pemasukan dari penjualan dicatat saat transaksi diproses, bukan saat dana Shopee cair.<br>
        * Entri <span style="font-size:10px;color:var(--text3)">auto</span> tidak bisa diedit — ubah langsung di tab Penjualan atau Preorder.
      </p>`;
  }

    // Reset scanner flag after each render
  setTimeout(() => { S.set.scannerJustFired(false); }, 100);

  // Keep focus on search input after render so scanner can fire again
  if (S.currentTab === 'stok' && S.stokSearch) {
    setTimeout(() => {
      const inp = document.getElementById('stok-search-input');
      if (inp && document.activeElement !== inp) inp.focus();
    }, 80);
  }
}


