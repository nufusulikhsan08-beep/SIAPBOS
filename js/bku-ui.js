(function(ns){
'use strict';
const {
  $,state,esc,formatMoney,clean,groupRowsByBukti,validateBkuNpsn,finalizeBkuIdentity,applyIdentityToSurat,
  readPdf,readExcel,resetAutoIdentity,normalizeNoBukti,getTaxRows,getTaxSummary,sanitizeUraian,
  pdfColumns,detectPdfColumns,groupPdfLines,lineText,extractPdfIdentityPage,extractPdfSignatures,
  extractColumnText,extractColumnMoney,findPdfDateRows,buildPdfRowBands,recoverPdfRowBands,isInternalMovement
}=ns;
const syncSurat=()=>ns.syncSurat();
const enableSuratSection=()=>ns.enableSuratSection();
const disableSuratSection=()=>ns.disableSuratSection();

function renderRawRows(){
  const tb=$('rawTbody'), rows=state.rawRows||[];
  $('rawTotal').textContent=formatMoney(rows.reduce((s,r)=>s+(Number(r.pengeluaran)||0),0));
  $('exportRawBtn').disabled=!rows.length;
  if(!rows.length){tb.innerHTML='<tr><td colspan="5" class="empty">Belum ada data murni.</td></tr>';return;}
  tb.innerHTML=rows.map((r,i)=>`<tr><td>${i+1}</td><td>${esc(r.tanggal||'—')}</td><td>${esc(r.noBukti||'—')}</td><td>${esc(r.uraian||'—')}</td><td class="num">${formatMoney(r.pengeluaran)}</td></tr>`).join('');
}
function renderTaxes(){
  const all=getTaxRows(), s=all.filter(x=>x.siplah), n=all.filter(x=>!x.siplah);
  const summary=getTaxSummary();
  const st=summary.siplahTotal, nt=summary.nonSiplahTotal;
  $('taxSiplahTotal').textContent=formatMoney(st); $('taxNonSiplahTotal').textContent=formatMoney(nt); $('taxGrandTotal').textContent=formatMoney(summary.grandTotal); $('taxCount').textContent=summary.count;
  $('taxSiplahFooter').textContent=formatMoney(st); $('taxNonSiplahFooter').textContent=formatMoney(nt);
  const paint=(rows,el)=>{
    if(!rows.length){el.innerHTML='<tr><td colspan="6" class="empty">Tidak ada transaksi pajak pada kategori ini.</td></tr>';return;}
    el.innerHTML=rows.map((x,i)=>`<tr><td>${i+1}</td><td>${esc(x.row.tanggal||'—')}</td><td>${esc(x.row.noBukti||'—')}</td><td><span class="tax-type">${esc(x.type)}</span></td><td>${esc(x.row.uraian||'—')}</td><td class="num">${formatMoney(x.amount)}</td></tr>`).join('');
  };
  paint(s,$('taxSiplahBody')); paint(n,$('taxNonSiplahBody'));
}
function render(){
  // Ringkasan metrik mFile/mPages/mRows/mTotal/mIncome ada pada layout lama,
  // tetapi memang tidak ditampilkan pada layout FIXED. Jangan biarkan elemen
  // opsional yang hilang menghentikan seluruh render, ekstraksi, dan Project Store.
  const setText=(id,value)=>{const el=$(id);if(el)el.textContent=value;};
  setText('mFile',state.file?.name||'—');
  setText('mPages',state.result?.pages??0);
  setText('mRows',state.rows.length);
  setText('mTotal',formatMoney(state.rows.reduce((s,r)=>s+r.pengeluaran,0)));
  setText('mIncome',formatMoney(state.result?.excludedIncome||0));
  $('sourceInfo').textContent=state.result?`${state.result.blocks} blok/baris diperiksa • ${state.result.rawRowCount??state.rows.length} transaksi murni → ${state.rows.length} rincian setelah penggabungan kode BPU/BNU • ${state.result.ignoredRows} diabaikan`:'Belum ada file dibaca.';
  const tb=$('tbody'); const shown=state.rows.map((r,i)=>({...r,_index:i})).filter(r=>!state.search||`${r.tanggal} ${r.noBukti} ${r.uraian}`.toLowerCase().includes(state.search.toLowerCase()));
  if(!shown.length){
    if(state.result && !state.rows.length){
      tb.innerHTML=`<tr><td colspan="5" class="empty bku-empty-cell"><div class="bku-empty-callout"><div class="bku-empty-callout-icon">📋</div><div class="bku-empty-callout-title">BKU KOSONG (NIHIL)</div><div class="bku-empty-callout-desc">Dokumen ini terbaca sebagai <b>BKU Kosong</b> tanpa transaksi belanja/pengeluaran.<br>Tersimpan dalam database dan pekerjaan sebagai mutasi nihil.</div></div></td></tr>`;
    }else{
      tb.innerHTML=`<tr><td colspan="5" class="empty">${state.rows.length?'Tidak ada transaksi yang cocok dengan pencarian.':'Belum ada data. Impor dokumen untuk memulai.'}</td></tr>`;
    }
  }else tb.innerHTML=shown.map(r=>`<tr><td>${r._index+1}</td><td>${esc(r.tanggal)}</td><td>${esc(r.noBukti||'—')}</td><td>${esc(r.uraian)}</td><td class="num">${formatMoney(r.pengeluaran)}</td></tr>`).join('');
  const w=state.result?.warnings||[]; $('warnings').innerHTML=w.length?w.map(x=>`<div class="warn">${esc(x)}</div>`).join(''):'';
  $('exportBtn').disabled=!state.rows.length;
  renderRawRows(); renderTaxes();
}
function mrLoading(stage,detail,progress){
  const ov=$('mrLoadingOverlay');
  if(!ov)return;
  ov.classList.remove('success','error'); ov.classList.add('show'); ov.setAttribute('aria-hidden','false');
  $('mrLoadingText').textContent=stage||'MR. LOADING sedang bekerja…';
  $('mrLoadingDetail').textContent=detail||'Mohon tunggu, data sedang dibaca dengan teliti.';
  $('mrLoadingProgress').style.width=Math.max(4,Math.min(100,Number(progress)||4))+'%';
  $('mrLoadingAvatar').innerHTML='<div class="mr-spinner"></div>';
}
function mrLoadingSuccess(detail){
  const ov=$('mrLoadingOverlay');
  if(!ov)return Promise.resolve();
  ov.classList.remove('error');ov.classList.add('show','success');ov.setAttribute('aria-hidden','false');
  $('mrLoadingText').textContent='MR. LOADING BERHASIL MEMBACA DATA BKU';
  $('mrLoadingDetail').textContent=detail||'Data BKU berhasil dibaca dan divalidasi.';
  $('mrLoadingProgress').style.width='100%';
  $('mrLoadingAvatar').innerHTML='<svg class="mr-check" viewBox="0 0 52 52"><path d="M15 27 l8 8 l15 -17"/></svg>';
  return new Promise(resolve=>setTimeout(()=>{ov.classList.remove('show');ov.setAttribute('aria-hidden','true');resolve();},1300));
}
function mrLoadingError(detail){
  const ov=$('mrLoadingOverlay');
  if(!ov)return;
  ov.classList.remove('success');ov.classList.add('show','error');ov.setAttribute('aria-hidden','false');
  $('mrLoadingText').textContent='MR. LOADING GAGAL MEMBACA DATA';
  $('mrLoadingDetail').textContent=detail||'Pembacaan berhenti. Periksa file dan coba lagi.';
  $('mrLoadingProgress').style.width='100%';
  $('mrLoadingAvatar').innerHTML='<svg class="mr-x" viewBox="0 0 52 52"><path d="M16 16 l20 20 M36 16 l-20 20"/></svg>';
  setTimeout(()=>{ov.classList.remove('show');ov.setAttribute('aria-hidden','true');},2200);
}

async function extractBkuData(){
  if(!state.file)return;
  const isPdf=state.file.name.toLowerCase().endsWith('.pdf');
  $('readBtn').disabled=true;$('exportBtn').disabled=true;
  $('status').textContent='MR. LOADING: menyiapkan mesin pembacaan…';
  mrLoading('MR. LOADING SEDANG MEMBACA BKU', isPdf?'Membuka PDF dan menyiapkan halaman untuk dibaca satu per satu.':'Membuka file dan menyiapkan lembar data untuk dibaca.',8);
  state.rows=[];state.rawRows=[];state.result=null;state.surat.rowIndex=-1;state.surat.bukti='';render();syncSurat();
  try{
    await new Promise(r=>setTimeout(r,120));
    mrLoading('MR. LOADING MEMBACA STRUKTUR DOKUMEN', isPdf?'Mendeteksi kolom tanggal, uraian, bukti, penerimaan, pengeluaran, dan saldo.':'Mendeteksi kolom tanggal, uraian, bukti, dan pengeluaran.',18);
    const rawResult=isPdf?await readPdfWithProgress(state.file,(page,total)=>{
      const pct=22+Math.round((page/Math.max(total,1))*62);
      mrLoading(`MR. LOADING MEMBACA HALAMAN ${page}/${total}`,`Menganalisis teks dan posisi kolom halaman ${page}.`,pct);
      $('status').textContent=`Membaca BKU: halaman ${page} dari ${total}…`;
    }):await readExcel(state.file);
    const evidenceText=[rawResult?.identity?.rawAddress, ...(rawResult?.identity?Object.values(rawResult.identity):[]), rawResult?.locationEvidence||''].map(v=>String(v||'')).join(' | ');
    rawResult.identity=validateBkuNpsn(finalizeBkuIdentity(rawResult.identity||{}), evidenceText);
    if(rawResult.identity.locationWarning){
      rawResult.warnings=rawResult.warnings||[];
      rawResult.warnings.unshift('⚠ '+rawResult.identity.locationWarning);
    }
    const rawRows=rawResult.rows||[];
    rawResult.rawRowCount=rawRows.length;
    rawResult.groupedRowCount=groupRowsByBukti(rawRows).length;
    state.rawRows=rawRows.map(r=>({...r}));
    state.rows=groupRowsByBukti(rawRows.filter(r=>!r.isInternalTransfer));
    state.result=rawResult;
    applyIdentityToSurat(rawResult.identity||{});
    state.result.identity=state.identity;
    state.result.groupedByBukti=true;
    syncSurat();
    render();
    if(!state.rows.length){
      state.result.isEmptyBku = true;
      $('status').textContent = 'BKU Kosong (Nihil) berhasil dibaca dan dimasukkan ke pekerjaan. Terbaca sebagai BKU kosong tanpa mutasi.';
      $('warnings').innerHTML = '<div class="warn"><b>BKU Kosong (Nihil)</b>: Dokumen ini tidak memiliki transaksi pengeluaran. Telah dimasukkan ke dalam database dan pekerjaan sebagai BKU kosong.</div>';
      disableSuratSection();
      ns.scheduleProjectAutoSave?.();
      await mrLoadingSuccess('BKU Kosong (Nihil) terbaca • Berhasil dimasukkan ke database pekerjaan.');
      return;
    }
    const v=state.result.validation;
    if(v?.ok)$('status').textContent=`Ekstraksi BKU selesai. ${state.rows.length} transaksi pengeluaran valid. Total ${formatMoney(v.actualIncluded ?? v.rawExpenseTotal ?? 0)}.`;
    else $('status').textContent=`Ekstraksi BKU selesai. ${state.rows.length} transaksi pengeluaran berhasil dipetakan.`;
    if(v && typeof v==='object' && v.rawExpenseTotal!==undefined && v.declaredTotal!==undefined && v.rawExpenseTotal===v.declaredTotal){
      state.result.warnings.unshift(`Validasi PDF OK: total Pengeluaran tercetak ${formatMoney(v.declaredTotal)} = total seluruh baris transaksi. Tarik Tunai ${formatMoney(v.internalTransferTotal)} dikeluarkan sebagai pemindahan dana internal; total biaya kegiatan ${formatMoney(v.actualIncluded)}.`);
    }
    syncSurat();
    enableSuratSection();
    ns.scheduleProjectAutoSave?.();
    const identityReady=!!(state.identity.school&&state.identity.headName&&state.identity.headNip&&state.identity.treasurerName&&state.identity.treasurerNip);
    await mrLoadingSuccess(`${state.rows.length} transaksi terbaca${identityReady?' • identitas sekolah, Kepala Sekolah, dan Bendahara ikut terbaca otomatis.':'.'}`);
  }catch(e){
    $('status').textContent='Gagal membaca BKU: '+(e?.message||e);
    $('warnings').innerHTML='<div class="danger">'+esc(e?.message||'Pastikan file PDF/Excel valid.')+'</div>';
    disableSuratSection();
    mrLoadingError(e?.message||'Pastikan file PDF/Excel valid.');
  }finally{$('readBtn').disabled=!state.file;render();}
}

async function readPdfWithProgress(file,onProgress){
  if(!window.pdfjsLib)throw new Error('Mesin PDF.js belum siap. Pastikan koneksi internet aktif saat pertama kali membuka aplikasi, lalu coba BACA DATA lagi.');
  const buf=await file.arrayBuffer();
  const pdf=await window.pdfjsLib.getDocument({data:buf,disableWorker:true}).promise;
  // Ulangi pembacaan inti PDF sambil memberi progress per halaman.
  const rows=[];const identity={school:"",kecamatan:"",alamat:"",rawAddress:"",npsn:"",headName:"",headNip:"",treasurerName:"",treasurerNip:"",kabupaten:"",provinsi:""};
  let income=0,blocks=0,ignored=0,internalTransferTotal=0,rawExpenseTotal=0,declaredTotal=0,declaredTotalFound=0;
  for(let pageNo=1;pageNo<=pdf.numPages;pageNo++){
    const page=await pdf.getPage(pageNo);
    const viewport=page.getViewport({scale:1});
    const c=await page.getTextContent();
    const items=(c.items||[]).map(x=>({text:String(x.str||''),x:Number(x.transform?.[4]||0),y:Number(x.transform?.[5]||0),width:Number(x.width||0),height:Number(x.height||0)}));
    const cols=detectPdfColumns(items,viewport.width);
    const lines=groupPdfLines(items,2.5);
    if(pageNo===1)Object.assign(identity,extractPdfIdentityPage(items));
    const sig=extractPdfSignatures(items);
    if(!identity.headName&&sig.headName)identity.headName=sig.headName;
    if(!identity.headNip&&sig.headNip)identity.headNip=sig.headNip;
    if(!identity.treasurerName&&sig.treasurerName)identity.treasurerName=sig.treasurerName;
    if(!identity.treasurerNip&&sig.treasurerNip)identity.treasurerNip=sig.treasurerNip;
    for(const line of lines){
      if(/^Jumlah\b/i.test(lineText(line))){
        const v=extractColumnMoney(line.items,cols.pengeluaran);
        if(v>0||extractColumnText(line.items,cols.pengeluaran)==='0'){declaredTotal+=v;declaredTotalFound++;}
      }
    }
    const dateRows=findPdfDateRows(items,cols);
    const primaryBands=buildPdfRowBands(items,dateRows);
    const bands=recoverPdfRowBands(items,cols,dateRows,primaryBands);
    blocks+=bands.length;
    for(const band of bands){
      const rowItems=band.rowItems;
      const tanggal=band.tanggal;
      const noBukti=normalizeNoBukti(extractColumnText(rowItems,cols.bukti));
      const uraian=sanitizeUraian(extractColumnText(rowItems,cols.uraian));
      const penerimaan=extractColumnMoney(rowItems,cols.penerimaan);
      const pengeluaran=extractColumnMoney(rowItems,cols.pengeluaran);
      const saldo=extractColumnMoney(rowItems,cols.saldo);
      if(pengeluaran>0)rawExpenseTotal+=pengeluaran;
      if(pengeluaran<=0){if(penerimaan>0)income+=penerimaan;ignored++;continue;}
      if(isInternalMovement(uraian)){internalTransferTotal+=pengeluaran;ignored++;continue;}
      if(!uraian){ignored++;continue;}
      rows.push({tanggal,noBukti,uraian,penerimaan,pengeluaran,saldo,confidence:0.995,source:`halaman ${pageNo}`});
    }
    if(typeof onProgress==='function')onProgress(pageNo,pdf.numPages);
  }
  const expectedIncluded=declaredTotalFound?Math.max(0,declaredTotal-internalTransferTotal):0;
  const actualIncluded=rows.filter(r=>!r.isInternalTransfer).reduce((s,r)=>s+r.pengeluaran,0);
  const warnings=[];
  if(rows.length===0)warnings.push('Tidak ada transaksi pengeluaran yang berhasil dipetakan dari teks PDF.');
  if(declaredTotalFound&&declaredTotal!==rawExpenseTotal)warnings.push(`Validasi total PDF gagal: kolom Pengeluaran pada baris Jumlah = ${formatMoney(declaredTotal)}, tetapi penjumlahan baris transaksi = ${formatMoney(rawExpenseTotal)}.`);
  if(declaredTotalFound&&expectedIncluded!==actualIncluded)warnings.push(`Ada selisih setelah mengeluarkan Tarik Tunai: target ${formatMoney(expectedIncluded)}, hasil ${formatMoney(actualIncluded)}. Periksa format PDF/kolom.`);
  if(internalTransferTotal>0)warnings.push(`Tarik Tunai sebesar ${formatMoney(internalTransferTotal)} tetap disimpan di Data Murni, tetapi tidak dimasukkan ke transaksi Surat Perintah karena merupakan pemindahan dana internal.`);
  return {rows,declaredTotal,declaredTotalFound,rawExpenseTotal,internalTransferTotal,expectedIncluded,actualIncluded,excludedIncome:income,pages:pdf.numPages,blocks,ignoredRows:ignored,warnings,identity:finalizeBkuIdentity(identity),validation:{declaredTotal,declaredTotalFound,rawExpenseTotal,internalTransferTotal,expectedIncluded,actualIncluded,ok:declaredTotalFound?(declaredTotal===rawExpenseTotal&&expectedIncluded===actualIncluded):rows.length>0},validationRule:'Semua pengeluaran dari kolom PENGELUARAN dipertahankan, kecuali Tarik Tunai (pemindahan dana internal). Terima/pemasukan dan saldo diabaikan.'};
}

Object.assign(ns,{renderRawRows,renderTaxes,render,mrLoading,mrLoadingSuccess,mrLoadingError,extractBkuData,readPdfWithProgress});
})(window.SPMU=window.SPMU||{});
