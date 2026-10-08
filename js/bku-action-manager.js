/**
 * SIAP BOS - BKU Action Manager with Realtime Surat & Monitoring Sync
 * 1. Menghapus transaksi dari layar & memory state.rows
 * 2. Membersihkan transaksi yang dihapus dari Surat Perintah (SPMU)
 * 3. Mengirim pembaruan ke database Supabase Cloud agar Panel Monitoring langsung update
 */
(function() {
  const ns = window.SPMU = window.SPMU || {};
  const state = ns.state;

  window.selectedBkuIndices = window.selectedBkuIndices || new Set();
  const selectedIndices = window.selectedBkuIndices;

  function fmtRp(val) {
    if (typeof ns.formatMoney === 'function') return 'Rp ' + ns.formatMoney(val);
    const num = Number(val) || 0;
    return 'Rp ' + Math.round(num).toLocaleString('id-ID');
  }

  // A. Backup Data Awal
  function backupOriginalRows() {
    const state = ns.state || {};
    if (!state.originalRows || state.originalRows.length === 0) {
      if (state.rows && state.rows.length > 0) {
        state.originalRows = JSON.parse(JSON.stringify(state.rows));
      }
    }
    const tb = document.getElementById('tbody');
    if (tb && !window._originalBkuHtml && tb.children.length > 0) {
      window._originalBkuHtml = tb.innerHTML;
    }
  }

  // B. Sinkronisasi Surat Perintah (SPMU) agar data terhapus langsung hilang dari Surat
  function syncSuratPerintah() {
    const state = ns.state || {};
    const rows = state.rows || [];

    // Himpunan No Bukti dan Uraian yang masih aktif tersisa
    const activeNoBukti = new Set();
    const activeUraian = new Set();

    rows.forEach(r => {
      if (r.noBukti) activeNoBukti.add(String(r.noBukti).trim().toLowerCase());
      if (r.uraian) activeUraian.add(String(r.uraian).trim().toLowerCase());
    });

    // 1. Bersihkan state.letters
    if (Array.isArray(state.letters)) {
      state.letters = state.letters.filter(letter => {
        const nb = String(letter.noBukti || letter.nomorBukti || '').trim().toLowerCase();
        const ur = String(letter.uraian || letter.keperluan || '').trim().toLowerCase();

        // Jika surat memiliki rincian sub-items
        if (Array.isArray(letter.items) && letter.items.length > 0) {
          letter.items = letter.items.filter(item => {
            const inb = String(item.noBukti || '').trim().toLowerCase();
            const iur = String(item.uraian || '').trim().toLowerCase();
            return activeNoBukti.has(inb) || activeUraian.has(iur);
          });
          letter.nominal = letter.items.reduce((s, it) => s + (Number(it.pengeluaran || it.nominal || it.jumlah || 0)), 0);
          letter.jumlah = letter.nominal;
          return letter.items.length > 0;
        }

        if (nb) return activeNoBukti.has(nb);
        if (ur) return activeUraian.has(ur);
        return false;
      });
    }

    // 2. Bersihkan state.spmuList
    if (Array.isArray(state.spmuList)) {
      state.spmuList = state.spmuList.filter(l => {
        const nb = String(l.noBukti || l.nomorBukti || '').trim().toLowerCase();
        const ur = String(l.uraian || l.keperluan || '').trim().toLowerCase();
        if (Array.isArray(l.items) && l.items.length > 0) {
          l.items = l.items.filter(it => activeNoBukti.has(String(it.noBukti || '').trim().toLowerCase()));
          l.nominal = l.items.reduce((s, it) => s + (Number(it.pengeluaran || it.nominal || 0)), 0);
          return l.items.length > 0;
        }
        if (nb) return activeNoBukti.has(nb);
        if (ur) return activeUraian.has(ur);
        return false;
      });
    }

    // 3. Bersihkan state.surat
    if (Array.isArray(state.surat)) {
      state.surat = state.surat.filter(s => {
        const nb = String(s.noBukti || '').trim().toLowerCase();
        return activeNoBukti.has(nb);
      });
    }

    // 4. Picu regenerasi surat jika modul surat memiliki generator
    if (ns.surat) {
      if (typeof ns.surat.buildLetters === 'function') {
        try { ns.surat.buildLetters(); } catch(e) {}
      } else if (typeof ns.surat.generate === 'function') {
        try { ns.surat.generate(); } catch(e) {}
      }
    }

    // 5. Render ulang tampilan Surat & Viewer
    if (ns.suratUi && typeof ns.suratUi.render === 'function') {
      try { ns.suratUi.render(); } catch(e) {}
    }
    if (ns.suratViewer && typeof ns.suratViewer.render === 'function') {
      try { ns.suratViewer.render(); } catch(e) {}
    }
    if (ns.kwitansiUi && typeof ns.kwitansiUi.render === 'function') {
      try { ns.kwitansiUi.render(); } catch(e) {}
    }
    if (ns.pajakUi && typeof ns.pajakUi.render === 'function') {
      try { ns.pajakUi.render(); } catch(e) {}
    }
  }

  // C. Sinkronisasi ke Supabase Cloud & Panel Monitoring
  async function syncToDatabaseAndMonitoring() {
    try {
      if (typeof ns.saveActiveProject === 'function') {
        await ns.saveActiveProject();
        console.log('✓ Supabase Cloud diperbarui setelah perubahan transaksi BKU.');
      } else {
        console.warn('Project Store Supabase belum siap; perubahan belum tersinkron ke cloud.');
      }
    } catch (err) {
      console.warn('Gagal menyimpan perubahan BKU ke Supabase Cloud:', err.message);
    }
  }

  // D. Eksekusi Sinkronisasi Penuh Setelah Baris Dihapus dari Tabel
  function syncAfterDomChange() {
    const tb = document.getElementById('tbody');
    if (!tb) return;

    const validRows = Array.from(tb.querySelectorAll('tr')).filter(tr => !tr.querySelector('td[colspan]'));

    // 1. Rekonstruksi ulang state.rows langsung dari baris yang tersisa di tabel
    const remainingRows = [];
    const origRows = ns.state.originalRows || ns.state.rows || [];

    validRows.forEach((tr, i) => {
      const cells = tr.querySelectorAll('td');
      // Urutkan nomor urut di kolom No (sel index 1)
      if (cells.length > 1) {
        cells[1].textContent = i + 1;
      }
      const cb = tr.querySelector('.bku-row-check');
      if (cb) cb.dataset.idx = i;
      const btn = tr.querySelector('.btn-del-single');
      if (btn) btn.dataset.idx = i;

      const noBukti = tr.querySelector('code') ? tr.querySelector('code').textContent.trim() : (cells[3] ? cells[3].textContent.trim() : '');
      const uraian = cells[4] ? cells[4].textContent.trim() : '';

      // Cocokkan ke data asli
      const found = origRows.find(r => (noBukti && r.noBukti === noBukti) || (uraian && r.uraian === uraian));
      if (found) {
        remainingRows.push(found);
      } else {
        remainingRows.push({
          tanggal: cells[2] ? cells[2].textContent.trim() : '',
          noBukti: noBukti,
          uraian: uraian,
          penerimaan: cells[5] ? parseFloat(cells[5].textContent.replace(/[^\d.-]/g, '')) || 0 : 0,
          pengeluaran: cells[6] ? parseFloat(cells[6].textContent.replace(/[^\d.-]/g, '')) || 0 : 0,
          saldo: cells[7] ? parseFloat(cells[7].textContent.replace(/[^\d.-]/g, '')) || 0 : 0
        });
      }
    });

    ns.state.rows = remainingRows;

    // 2. Jika seluruh baris habis terhapus
    if (validRows.length === 0) {
      const colCount = (tb.closest('table')?.querySelector('thead tr')?.children.length) || 9;
      tb.innerHTML = `<tr><td colspan="${colCount}" style="text-align:center;padding:26px;color:#94a3b8;font-size:13px;">Semua transaksi telah dihapus. Klik tombol "Pulihkan Data Awal" untuk membatalkan.</td></tr>`;
    }

    // 3. Update DOM Kartu Ringkasan
    let totalKeluar = 0;
    let totalMasuk = 0;
    remainingRows.forEach(r => {
      totalKeluar += Number(r.pengeluaran || 0);
      totalMasuk += Number(r.penerimaan || 0);
    });

    const elRows = document.getElementById('totalRows') || document.getElementById('statTotalRows') || document.getElementById('bkuCount');
    if (elRows) elRows.textContent = remainingRows.length.toLocaleString('id-ID');

    const elKeluar = document.getElementById('totalPengeluaran') || document.getElementById('statTotalPengeluaran') || document.getElementById('bkuTotalPengeluaran');
    if (elKeluar) elKeluar.textContent = fmtRp(totalKeluar);

    const elMasuk = document.getElementById('totalPenerimaan') || document.getElementById('statTotalPenerimaan') || document.getElementById('bkuTotalPenerimaan');
    if (elMasuk) elMasuk.textContent = fmtRp(totalMasuk);

    const elSaldo = document.getElementById('saldoKas') || document.getElementById('statSaldo') || document.getElementById('bkuSaldo');
    if (elSaldo) {
      const saldoAwal = Number(ns.state.summary?.saldoAwal || 0);
      elSaldo.textContent = fmtRp((saldoAwal + totalMasuk) - totalKeluar);
    }

    updateToolbarState();

    // 4. SINKRONKAN SURAT PERINTAH (Hapus data dari SPMU)
    syncSuratPerintah();

    // 5. SINKRONKAN KE DATABASE SQLITE & PANEL MONITORING
    syncToDatabaseAndMonitoring();
  }

  // E. Update Toolbar
  function updateToolbarState() {
    const tb = document.getElementById('tbody');
    const checkedBoxes = tb ? tb.querySelectorAll('.bku-row-check:checked') : [];
    const count = checkedBoxes.length;

    const btnDel = document.getElementById('btnDeleteSelectedBku');
    const badge = document.getElementById('badgeSelectedCount');
    const masterCheck = document.getElementById('checkAllBku');
    const info = document.getElementById('bkuRowCountInfo');

    if (badge) badge.textContent = count;
    if (btnDel) {
      if (count > 0) {
        btnDel.style.opacity = '1';
        btnDel.style.pointerEvents = 'auto';
        btnDel.disabled = false;
      } else {
        btnDel.style.opacity = '0.5';
        btnDel.style.pointerEvents = 'none';
        btnDel.disabled = true;
      }
    }

    const rows = tb ? tb.querySelectorAll('tr') : [];
    const validRows = Array.from(rows).filter(tr => !tr.querySelector('td[colspan]'));

    if (info) {
      info.textContent = `Menampilkan ${validRows.length} transaksi`;
    }

    if (masterCheck && validRows.length > 0) {
      const allChecked = (count === validRows.length);
      masterCheck.checked = allChecked;
      masterCheck.indeterminate = (count > 0 && !allChecked);
    } else if (masterCheck) {
      masterCheck.checked = false;
      masterCheck.indeterminate = false;
    }
  }

  // F. Handler Hapus Terpilih
  function deleteSelectedRows() {
    const tb = document.getElementById('tbody');
    if (!tb) return;

    const checkedBoxes = Array.from(tb.querySelectorAll('.bku-row-check:checked'));
    if (checkedBoxes.length === 0) {
      alert('Silakan centang transaksi yang ingin dihapus.');
      return;
    }

    if (!confirm(`Hapus ${checkedBoxes.length} baris transaksi yang dipilih?\n(Transaksi juga akan otomatis dihapus dari Surat Perintah dan Database).`)) {
      return;
    }

    backupOriginalRows();

    checkedBoxes.forEach(cb => {
      const tr = cb.closest('tr');
      if (tr) {
        tr.style.transition = 'all 0.2s ease';
        tr.style.backgroundColor = '#fee2e2';
        tr.style.opacity = '0';
        setTimeout(() => tr.remove(), 180);
      }
    });

    setTimeout(() => {
      syncAfterDomChange();
      alert(`✓ ${checkedBoxes.length} transaksi berhasil dihapus dari BKU, Surat Perintah, dan Panel Monitoring.`);
    }, 240);
  }

  // G. Handler Pulihkan Data Awal
  function restoreOriginalRows() {
    const state = ns.state || {};
    if (!confirm('Pulihkan seluruh data awal hasil ekstraksi BKU?')) return;

    if (state.originalRows && state.originalRows.length > 0) {
      state.rows = JSON.parse(JSON.stringify(state.originalRows));
      if (ns.bkuUi && typeof ns.bkuUi.renderRows === 'function') {
        ns.bkuUi.renderRows();
      }
    } else if (window._originalBkuHtml) {
      const tb = document.getElementById('tbody');
      if (tb) tb.innerHTML = window._originalBkuHtml;
    }

    setTimeout(() => {
      enhanceBkuTable();
      syncAfterDomChange();
      alert('✓ Seluruh data awal transaksi berhasil dipulihkan!');
    }, 150);
  }

  // H. Injeksi Toolbar & Checkbox ke Tabel
  function enhanceBkuTable() {
    const tb = document.getElementById('tbody');
    if (!tb) return;
    const table = tb.closest('table');
    if (!table) return;

    backupOriginalRows();

    if (!document.getElementById('bkuSelectionToolbar')) {
      const toolbar = document.createElement('div');
      toolbar.id = 'bkuSelectionToolbar';
      toolbar.className = 'bku-selection-toolbar';
      toolbar.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:10px;margin:12px 0 10px 0;padding:10px 14px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;flex-wrap:wrap;box-shadow:0 1px 2px rgba(0,0,0,0.04);';
      toolbar.innerHTML = `
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
          <button type="button" id="btnDeleteSelectedBku" style="background:#dc2626;color:white;border:none;border-radius:6px;padding:7px 14px;font-size:13px;font-weight:600;cursor:pointer;display:inline-flex;align-items:center;gap:6px;opacity:0.5;pointer-events:none;transition:all 0.2s;" title="Hapus semua baris yang dicentang">
            <span>🗑 Hapus Terpilih</span>
            <span id="badgeSelectedCount" style="background:rgba(255,255,255,0.3);border-radius:10px;padding:1px 7px;font-size:11px;font-weight:bold;">0</span>
          </button>
          <button type="button" id="btnSelectAllBku" style="background:#ffffff;color:#334155;border:1px solid #cbd5e1;border-radius:6px;padding:7px 12px;font-size:12px;font-weight:600;cursor:pointer;" title="Pilih semua baris">☑ Pilih Semua</button>
          <button type="button" id="btnDeselectAllBku" style="background:#ffffff;color:#334155;border:1px solid #cbd5e1;border-radius:6px;padding:7px 12px;font-size:12px;font-weight:600;cursor:pointer;" title="Batalkan pilihan">☐ Batal Pilihan</button>
        </div>
        <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
          <button type="button" id="btnRestoreOriginalBku" style="background:#f0fdf4;color:#166534;border:1px solid #86efac;border-radius:6px;padding:7px 14px;font-size:12px;font-weight:600;cursor:pointer;display:inline-flex;align-items:center;gap:5px;" title="Kembalikan semua data asli jika ada transaksi yang salah hapus">
            <span>↺ Pulihkan Data Awal</span>
          </button>
          <span id="bkuRowCountInfo" style="font-size:12px;color:#64748b;font-weight:600;"></span>
        </div>
      `;

      const container = table.closest('.table-wrap') || table;
      container.parentElement.insertBefore(toolbar, container);

      toolbar.querySelector('#btnDeleteSelectedBku').addEventListener('click', deleteSelectedRows);
      toolbar.querySelector('#btnSelectAllBku').addEventListener('click', () => toggleAll(true));
      toolbar.querySelector('#btnDeselectAllBku').addEventListener('click', () => toggleAll(false));
      toolbar.querySelector('#btnRestoreOriginalBku').addEventListener('click', restoreOriginalRows);
    }

    const thead = table.querySelector('thead');
    if (thead) {
      const tr = thead.querySelector('tr');
      if (tr) {
        if (!tr.querySelector('.th-bku-check')) {
          const thCheck = document.createElement('th');
          thCheck.className = 'th-bku-check';
          thCheck.style.cssText = 'width:38px;text-align:center;padding:8px 4px;';
          thCheck.innerHTML = '<input type="checkbox" id="checkAllBku" title="Pilih / Batal Semua" style="cursor:pointer;width:16px;height:16px;">';
          tr.insertBefore(thCheck, tr.firstChild);

          thCheck.querySelector('#checkAllBku').addEventListener('change', (e) => {
            toggleAll(e.target.checked);
          });
        }
        if (!tr.querySelector('.th-bku-action')) {
          const thAction = document.createElement('th');
          thAction.className = 'th-bku-action';
          thAction.style.cssText = 'width:65px;text-align:center;padding:8px 4px;';
          thAction.textContent = 'Aksi';
          tr.appendChild(thAction);
        }
      }
    }

    const trs = tb.querySelectorAll('tr');
    trs.forEach((tr, position) => {
      if (tr.querySelector('td[colspan]')) return;
      if (tr.querySelector('.bku-row-check')) return;

      const tdCheck = document.createElement('td');
      tdCheck.style.cssText = 'text-align:center;vertical-align:middle;padding:6px 4px;';
      tdCheck.innerHTML = `<input type="checkbox" class="bku-row-check" data-idx="${position}" style="cursor:pointer;width:16px;height:16px;">`;
      tr.insertBefore(tdCheck, tr.firstChild);

      const tdAction = document.createElement('td');
      tdAction.style.cssText = 'text-align:center;vertical-align:middle;padding:6px 4px;';
      tdAction.innerHTML = `<button type="button" class="btn-del-single" data-idx="${position}" title="Hapus transaksi ini" style="background:#fee2e2;color:#dc2626;border:1px solid #fca5a5;border-radius:4px;padding:3px 8px;cursor:pointer;font-size:12px;font-weight:bold;transition:0.15s;" onmouseover="this.style.background='#fecaca'" onmouseout="this.style.background='#fee2e2'">🗑</button>`;
      tr.appendChild(tdAction);
    });

    updateToolbarState();
  }

  function toggleAll(checked) {
    const tb = document.getElementById('tbody');
    if (!tb) return;
    tb.querySelectorAll('.bku-row-check').forEach(cb => {
      cb.checked = checked;
      cb.closest('tr').style.backgroundColor = checked ? '#eff6ff' : '';
    });
    updateToolbarState();
  }

  // I. Event Listener Klik Tombol Hapus Sampah Merah (1 Baris)
  document.addEventListener('click', function(e) {
    const btn = e.target.closest('.btn-del-single');
    if (!btn) return;

    e.preventDefault();
    e.stopPropagation();

    const tr = btn.closest('tr');
    if (!tr) return;

    const cells = tr.querySelectorAll('td');
    const noBukti = tr.querySelector('code') ? tr.querySelector('code').textContent.trim() : (cells[3] ? cells[3].textContent.trim() : '');
    const uraian = cells[4] ? cells[4].textContent.trim() : 'transaksi ini';

    const desc = noBukti ? `${noBukti} (${uraian})` : uraian;
    if (!confirm(`Hapus baris transaksi:\n"${desc}"?\n\n(Transaksi ini juga akan otomatis dihapus dari Surat Perintah dan Database).`)) {
      return;
    }

    backupOriginalRows();

    tr.style.transition = 'all 0.2s ease';
    tr.style.backgroundColor = '#fee2e2';
    tr.style.opacity = '0';
    setTimeout(() => {
      tr.remove();
      syncAfterDomChange();
    }, 180);
  });

  document.addEventListener('change', function(e) {
    const cb = e.target.closest('.bku-row-check');
    if (cb) {
      cb.closest('tr').style.backgroundColor = cb.checked ? '#eff6ff' : '';
      updateToolbarState();
    }
  });

  // J. Pasang Hook pada Menu Tab Surat Perintah agar selalu bersih saat dibuka
  function hookTabButtons() {
    const tabSuratBtn = document.getElementById('tabSuratBtn');
    if (tabSuratBtn && !tabSuratBtn._syncHooked) {
      tabSuratBtn._syncHooked = true;
      tabSuratBtn.addEventListener('click', () => {
        syncSuratPerintah();
      });
    }

    if (ns.bkuUi && typeof ns.bkuUi.renderRows === 'function' && !ns.bkuUi._syncHooked) {
      ns.bkuUi._syncHooked = true;
      const orig = ns.bkuUi.renderRows;
      ns.bkuUi.renderRows = function() {
        const res = orig.apply(this, arguments);
        enhanceBkuTable();
        return res;
      };
    }
    enhanceBkuTable();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', hookTabButtons);
  } else {
    hookTabButtons();
  }

  setInterval(hookTabButtons, 800);
})();