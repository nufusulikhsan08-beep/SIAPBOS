(function(ns){
'use strict';
const {$,state,SURAT_FIELD_KEYS,suratElement,esc,clean,formatMoney,normalizeNoBukti,normalizeKecamatan,dateToInput,dateDisplay,setSuratTabLocked,setPajakTabLocked}=ns;

function suratRow(){
  const el=$('suratBukti');
  const idx=Number(el?.value);
  if(Number.isInteger(idx) && idx>=0 && idx<state.rows.length)return state.rows[idx];
  return null;
}

function suratDraftKey(index=state.surat.rowIndex){
  const i=Number(index);
  const r=Number.isInteger(i)&&i>=0&&i<state.rows.length?state.rows[i]:null;
  const no=normalizeNoBukti(r?.noBukti||'');
  return no?`bukti:${no}`:`row:${i}`;
}
function ensureSuratDraftStore(){
  if(!state.suratByBukti || typeof state.suratByBukti!=='object' || Array.isArray(state.suratByBukti))state.suratByBukti={};
  return state.suratByBukti;
}

const SURAT_SUGGESTION_CONFIG={
  kepada:{inputId:'suratKepada',listId:'suratKepadaDatalist',boxId:'suratKepadaSuggestions',label:'Harap Dibayar Kepada'},
  untukPembayaran:{inputId:'suratUntukPembayaran',listId:'suratUntukPembayaranDatalist',boxId:'suratUntukPembayaranSuggestions',label:'Untuk Pembayaran'}
};

function normalizeSuggestionText(value){
  return String(value??'').replace(/\s+/g,' ').trim();
}
function rankSuggestionValues(items,limit=8){
  const map=new Map();
  for(const item of items){
    const value=normalizeSuggestionText(item?.value??item);
    if(!value)continue;
    const key=value.toLocaleLowerCase('id-ID');
    const prev=map.get(key)||{value,count:0,last:0};
    prev.count+=Number(item?.count||1);
    prev.last=Math.max(prev.last,Number(item?.last||0));
    if(value.length>prev.value.length && !prev.value)prev.value=value;
    map.set(key,prev);
  }
  return [...map.values()]
    .sort((a,b)=>b.count-a.count || b.last-a.last || a.value.length-b.value.length || a.value.localeCompare(b.value,'id'))
    .slice(0,limit)
    .map(x=>x.value);
}

async function getStoredSuratSuggestionValues(){
  const kepada=[],untuk=[];
  const pushDraft=(draft,projectUpdatedAt=0)=>{
    if(!draft||typeof draft!=='object')return;
    const last=Math.max(Number(draft.savedAt)||0,Number(projectUpdatedAt)||0);
    const k=normalizeSuggestionText(draft.kepada);
    const u=normalizeSuggestionText(draft.untukPembayaran);
    if(k)kepada.push({value:k,count:1,last});
    if(u)untuk.push({value:u,count:1,last});
  };

  // Data yang sudah tersimpan pada pekerjaan BKU yang sedang aktif.
  for(const draft of Object.values(ensureSuratDraftStore()))pushDraft(draft);
  pushDraft(state.surat);

  // Tambahkan riwayat dari pekerjaan BKU lain yang sudah disimpan di browser.
  // Semua sumber tetap berupa isian yang pernah disimpan user; tidak membuat/menebak nama baru.
  try{
    const projects=typeof ns.getAllProjects==='function'?await ns.getAllProjects():[];
    for(const project of projects||[]){
      let source=project;
      // localStorage fallback index intentionally stores lightweight metadata.
      // Hydrate only when needed so old saved BKU/SPMU data can still provide suggestions.
      if((!source?.state?.suratByBukti || typeof source.state.suratByBukti!=='object') && project?._fallback && typeof ns.getProject==='function'){
        try{source=await ns.getProject(project.id)||project;}catch(_){source=project;}
      }
      const drafts=source?.state?.suratByBukti;
      if(!drafts||typeof drafts!=='object'||Array.isArray(drafts))continue;
      for(const draft of Object.values(drafts))pushDraft(draft,source.updatedAt||project.updatedAt);
    }
  }catch(e){
    // Saran dari pekerjaan aktif tetap ditampilkan bila daftar pekerjaan historis tidak dapat dibaca.
    console.warn('Riwayat sugesti Surat Perintah tidak dapat dibaca:',e);
  }

  return {
    kepada:rankSuggestionValues(kepada,8),
    untukPembayaran:rankSuggestionValues(untuk,8)
  };
}

function paintSuratSuggestionField(field,values){
  const cfg=SURAT_SUGGESTION_CONFIG[field];
  if(!cfg)return;
  const list=$(cfg.listId),box=$(cfg.boxId);
  if(list){
    list.innerHTML=values.map(v=>`<option value="${esc(v)}"></option>`).join('');
  }
  if(box){
    box.innerHTML='';
    box.style.display='none';
  }
}

async function refreshSuratSuggestions(){
  try{
    const suggestions=await getStoredSuratSuggestionValues();
    paintSuratSuggestionField('kepada',suggestions.kepada);
    paintSuratSuggestionField('untukPembayaran',suggestions.untukPembayaran);
    return suggestions;
  }catch(e){
    paintSuratSuggestionField('kepada',[]);
    paintSuratSuggestionField('untukPembayaran',[]);
    return {kepada:[],untukPembayaran:[]};
  }
}
function getSuratDraft(index=state.surat.rowIndex){
  const store=ensureSuratDraftStore();
  const key=suratDraftKey(index);
  const draft=store[key];
  return draft&&typeof draft==='object'?draft:null;
}
function captureCurrentSuratDraft(){
  const idx=Number(state.surat.rowIndex);
  if(!Number.isInteger(idx)||idx<0||idx>=state.rows.length)return null;
  const d=state.surat;
  const elK=suratElement('kepada'),elU=suratElement('untukPembayaran');
  const draft={
    bukti:state.rows[idx]?.noBukti||d.bukti||'',
    kepada:String(elK?.value??d.kepada??''),
    untukPembayaran:String(elU?.value??d.untukPembayaran??''),
    category:String(state.category||''),
    nominal:Math.max(0,Number(state.rows[idx]?.pengeluaran)||0),
    savedAt:Date.now()
  };
  ensureSuratDraftStore()[suratDraftKey(idx)]=draft;
  state.surat.kepada=draft.kepada;
  state.surat.untukPembayaran=draft.untukPembayaran;
  return draft;
}
function restoreSuratDraft(index){
  const draft=getSuratDraft(index);
  const k=suratElement('kepada'),u=suratElement('untukPembayaran');
  // Untuk No. Bukti yang belum pernah disimpan, JANGAN warisi data transaksi lain.
  const kepada=draft?.kepada??'';
  const untuk=draft?.untukPembayaran??'';
  state.surat.kepada=kepada;
  state.surat.untukPembayaran=untuk;
  state.category=String(draft?.category||'');
  const categoryEl=$('categorySelect');
  if(categoryEl)categoryEl.value=state.category;
  if(k)k.value=kepada;
  if(u)u.value=untuk;
  updateSuratDraftStatus();
  refreshSuratSaveState();
  return draft;
}
function updateSuratDraftStatus(message){
  const el=$('suratDraftSaveStatus');
  if(!el)return;
  const idx=Number(state.surat.rowIndex);
  const r=Number.isInteger(idx)&&idx>=0&&idx<state.rows.length?state.rows[idx]:null;
  const saved=getSuratDraft(idx);
  if(message){el.textContent=message;el.className='surat-draft-save-status ok';return;}
  el.textContent=saved?`Tersimpan untuk No. Bukti ${saved.bukti||r?.noBukti||'-'}.`:'Belum ada data tersimpan untuk No. Bukti ini.';
  el.className='surat-draft-save-status'+(saved?' ok':'');
}
function suratFormChecks(){
  const idx=Number($('suratBukti')?.value);
  const hasRow=($('suratBukti')?.value||'')!==''&&Number.isInteger(idx)&&idx>=0&&idx<state.rows.length;
  const has=id=>String($(id)?.value||'').trim()!=='';
  return [
    {label:'No. Bukti',ok:hasRow},
    {label:'Tanggal Surat',ok:has('suratTanggal')},
    {label:'Harap Dibayar Kepada',ok:has('suratKepada')},
    {label:'Untuk Pembayaran',ok:has('suratUntukPembayaran')},
    {label:'Kategori Belanja',ok:has('categorySelect')}
  ];
}
function refreshSuratSaveState(){
  const btn=$('suratSaveDataBtn'),box=$('suratSaveChecklist');
  const checks=suratFormChecks();
  const missing=checks.filter(c=>!c.ok);
  if(btn){
    btn.disabled=missing.length>0;
    btn.title=missing.length?('Lengkapi dahulu: '+missing.map(c=>c.label).join(', ')):'Simpan data SPMU untuk No. Bukti ini';
  }
  if(box){
    box.innerHTML=missing.length
      ? '<span class="isi-check-head">Lengkapi untuk menyimpan:</span>'+checks.map(c=>`<span class="isi-chip ${c.ok?'ok':''}">${c.ok?'✓':'○'} ${esc(c.label)}</span>`).join('')
      : '<span class="isi-check-head ok">✓ Semua isi surat sudah lengkap. Siap disimpan.</span>';
  }
}
function showSuratSavedPopup(draft){
  const m=$('suratSavedModal'); if(!m)return;
  const b=$('suratSavedBukti'); if(b)b.textContent=draft?.bukti||'-';
  const meta=$('suratSavedMeta'); if(meta)meta.textContent=draft?.category||'';
  m.classList.add('show'); m.setAttribute('aria-hidden','false');
  $('suratSavedOk')?.focus();
}
function hideSuratSavedPopup(){
  const m=$('suratSavedModal'); if(!m)return;
  m.classList.remove('show'); m.setAttribute('aria-hidden','true');
}
async function saveCurrentSuratData(){
  if(!state.file){window.alert('Pilih/upload BKU terlebih dahulu.');return false;}
  if(!state.rows.length){window.alert('Baca data BKU terlebih dahulu.');return false;}
  if(!String(state.category||'').trim()){window.alert('Pilih Kategori Belanja terlebih dahulu untuk menyimpan SPMU ini.');$('categorySelect')?.focus();return false;}
  readSuratFields();
  const draft=captureCurrentSuratDraft();
  if(!draft)return false;
  let savedProject=true;
  if(typeof ns.saveActiveProjectNow==='function')savedProject=await ns.saveActiveProjectNow();
  else if(typeof ns.saveCurrentFromUi==='function')savedProject=await ns.saveCurrentFromUi();
  if(savedProject===null){updateSuratDraftStatus('Penyimpanan dibatalkan.');return false;}
  updateSuratDraftStatus(`✓ Data No. Bukti ${draft.bukti||'-'} berhasil disimpan.`);
  showSuratSavedPopup(draft);
  return true;
}
function enableSuratSection(){
  const ready=Boolean(state.result && state.rows.length>0);
  $('suratBukti').disabled=!ready;
  $('suratPreviewBtn').disabled=!ready;
  if($('kwitansiPreviewBtn'))$('kwitansiPreviewBtn').disabled=!ready;
  $('suratPrintBtn').disabled=!ready;
  if($('suratBatchPrintBtn'))$('suratBatchPrintBtn').disabled=!ready;
  updateSuratNextInfo();
  setSuratTabLocked(!ready);
  if(!ready)$('suratBukti').innerHTML='<option value="">Tidak ada transaksi BKU yang dapat dibuatkan surat</option>';
  setPajakTabLocked(!ready);
  refreshSuratSaveState();
}
function disableSuratSection(){
  $('suratBukti').disabled=true;$('suratPreviewBtn').disabled=true;if($('kwitansiPreviewBtn'))$('kwitansiPreviewBtn').disabled=true;$('suratPrintBtn').disabled=true;if($('suratBatchPrintBtn'))$('suratBatchPrintBtn').disabled=true;$('suratPrevBtn').disabled=true;$('suratNextBtn').disabled=true;
  $('suratBukti').innerHTML='<option value="">Baca data BKU terlebih dahulu</option>';
  $('suratPreview').style.display='none';
  try{ns.suratViewerUpdate();}catch(_){}
  setSuratTabLocked(true); setPajakTabLocked(true);
  refreshSuratSaveState();
}
function rawRowsForSurat(){
  const r=suratRow(); if(!r)return [];
  const key=normalizeNoBukti(r.noBukti||'');
  const matches=(state.rawRows||[]).filter(x=>key?normalizeNoBukti(x.noBukti||'')===key:(x.tanggal===r.tanggal&&clean(x.uraian)===clean(r.uraian)));
  return matches.length?matches:[r];
}
function suratUraianText(){return rawRowsForSurat().map(x=>clean(x.uraian)).filter(Boolean).join('; ');}
function moneyWords(n){n=Math.round(Number(n)||0);if(!n)return 'nol rupiah';const a=['','satu','dua','tiga','empat','lima','enam','tujuh','delapan','sembilan','sepuluh','sebelas'];function w(x){if(x<12)return a[x];if(x<20)return w(x-10)+' belas';if(x<100)return w(Math.floor(x/10))+' puluh'+(x%10?' '+w(x%10):'');if(x<200)return 'seratus'+(x%100?' '+w(x%100):'');if(x<1000)return w(Math.floor(x/100))+' ratus'+(x%100?' '+w(x%100):'');if(x<2000)return 'seribu'+(x%1000?' '+w(x%1000):'');if(x<1000000)return w(Math.floor(x/1000))+' ribu'+(x%1000?' '+w(x%1000):'');if(x<1000000000)return w(Math.floor(x/1000000))+' juta'+(x%1000000?' '+w(x%1000000):'');return String(n);}return w(n)+' rupiah';}
function roman(m){return ['I','II','III','IV','V','VI','VII','VIII','IX','X','XI','XII'][m-1]||'';}
function suratData(){return suratDataForIndex(state.surat.rowIndex);}
function suratDataForIndex(index){
  const i=Number(index);
  const r=Number.isInteger(i)&&i>=0&&i<state.rows.length?state.rows[i]:null;
  const d={...state.surat};
  const draft=getSuratDraft(i);
  if(draft){
    d.kepada=String(draft.kepada||'');
    d.untukPembayaran=String(draft.untukPembayaran||'');
    d.bukti=draft.bukti||r?.noBukti||'';
  }
  d.category=String(draft?.category ?? state.category ?? '');
  const raw=r?((state.rawRows||[]).filter(x=>{const key=normalizeNoBukti(r.noBukti||'');return key?normalizeNoBukti(x.noBukti||'')===key:(x.tanggal===r.tanggal&&clean(x.uraian)===clean(r.uraian));})):[ ];
  const rawItems=raw.length?raw:(r?[r]:[]);
  return {...d,bukti:r?.noBukti||d.bukti||'',tanggal:r?.tanggal||d.tanggal,uraian:rawItems.map(x=>clean(x.uraian)).filter(Boolean).join('; '),rawItems,nominal:r?.pengeluaran||0,kepada:d.kepada||'',untukPembayaran:d.untukPembayaran||'',category:d.category};
}
function decorateSuratPages(pages,noBku,category){
  const allPages=[...pages.querySelectorAll('.surat-page')];
  const bku=clean(noBku||'-')||'-';
  const cat=clean(category||'-')||'-';
  allPages.forEach((pg,i)=>{
    let foot=pg.querySelector('.surat-page-footer');
    if(!foot){
      foot=document.createElement('div');
      foot.className='surat-page-footer';
      pg.appendChild(foot);
    }
    foot.innerHTML=`<span class="sf-bku">NO BKU: ${esc(bku)}</span><span class="sf-category">Kategori Belanja: ${esc(cat)}</span><span class="sf-page">Halaman ${i+1} dari ${allPages.length}</span>`;
  });
  const firstPage=allPages[0];
  if(firstPage){
    const oldBox=firstPage.querySelector('.surat-bku-box');
    if(oldBox)oldBox.remove();
    const box=document.createElement('div');
    box.className='surat-bku-box';
    box.textContent=bku;
    firstPage.appendChild(box);
  }
  return pages;
}
function buildSuratPagesForIndex(index){
  const d=suratDataForIndex(index);
  d.sd=normalizeSchoolName(d.sd);
  d.kecamatan=normalizeKecamatan(d.kecamatan);
  d.alamat=clean(d.alamat);
  const dt=dateToInput(d.tanggal).split('-');
  const dateText=dt.length===3?`${dt[2]}-${dt[1]}-${dt[0]}`:dateDisplay(d.tanggal);
  const nomorUrut=clean(d.nomor||'').replace(/^400\.3\.5\s*\/\s*/i,'').replace(/\s+/g,'');
  const jenisBukti=clean(d.bukti||'BPU').toLocaleUpperCase('id-ID');
  const bulan=dt.length===3?roman(Number(dt[1])):'I';
  const tahun=dt.length===3?dt[0]:'2026';
  const num=`400.3.5/${nomorUrut||'001'}/${jenisBukti}/${bulan}/${tahun}`;
  const tandaTangan=state.surat.tandaTangan||'assets/s_perintah_img_2.png';
  const logoSekolah=state.surat.logoSekolah||'';
  const logoKabupaten=state.surat.logoKabupaten||'assets/logo_kabupaten_serang.png';
  const blocks=buildSuratBlocks(d,num,dateText,tandaTangan,logoSekolah,logoKabupaten);
  return decorateSuratPages(paginateSurat(blocks),d.bukti,d.category);
}
function suratDraftReady(index){
  const draft=getSuratDraft(index);
  return Boolean(draft && String(draft.kepada||'').trim() && String(draft.untukPembayaran||'').trim());
}
function syncSurat(){
  const ready=Boolean(state.result && state.rows.length>0);
  const opts=ready?['<option value="">Pilih transaksi hasil ekstraksi BKU</option>',...state.rows.map((r,i)=>`<option value="${i}">${esc(r.noBukti||'Tanpa No. Bukti')} — ${esc(r.tanggal)} — ${esc(r.uraian.slice(0,100))}${r._count>1?` (${r._count} baris digabung)`:''}</option>` )]:['<option value="">Baca data BKU terlebih dahulu</option>'];
  $('suratBukti').innerHTML=opts.join('');
  $('suratBukti').disabled=!ready;
  if($('suratBatchPrintBtn'))$('suratBatchPrintBtn').disabled=!ready;
  if(ready && state.surat.rowIndex>=0 && state.surat.rowIndex<state.rows.length){
    $('suratBukti').value=String(state.surat.rowIndex);
  } else if(ready && state.surat.bukti){
    const idx=state.rows.findIndex(r=>normalizeNoBukti(r.noBukti)===normalizeNoBukti(state.surat.bukti));
    if(idx>=0){state.surat.rowIndex=idx;$('suratBukti').value=String(idx);}
  }
  $('suratPreviewBtn').disabled=!ready;
  if($('kwitansiPreviewBtn'))$('kwitansiPreviewBtn').disabled=!ready;
  $('suratPrintBtn').disabled=!ready;
  if($('suratBatchPrintBtn'))$('suratBatchPrintBtn').disabled=!ready;
  updateSuratNextInfo();
  setSuratTabLocked(!ready);
  refreshSuratSaveState();
}
function readSuratFields(){
  for(const k of SURAT_FIELD_KEYS){
    const el=suratElement(k);
    if(!el)continue;
    // No. Bukti adalah SELECT berbasis index transaksi, bukan nilai No. Bukti.
    // Jangan menimpa rowIndex/state.bukti dengan value option saat render.
    if(k==='bukti'){
      const idx=Number(el.value);
      if(Number.isInteger(idx)&&idx>=0&&idx<state.rows.length){
        state.surat.rowIndex=idx;
        state.surat.bukti=state.rows[idx].noBukti||'';
      }
      continue;
    }
    state.surat[k]=el.value;
  }
}
function updateSuratNextInfo(){
  const info=$('suratNextInfo');
  if(!info)return;
  const total=state.rows.length;
  const currentIndex=Number.isInteger(state.surat.rowIndex)?state.surat.rowIndex:-1;
  if(!total){
    info.innerHTML='Pilih transaksi BKU untuk mengaktifkan perpindahan surat otomatis.';
    return;
  }
  if(currentIndex<0 || currentIndex>=total){
    info.innerHTML=`${total} transaksi tersedia. Pilih transaksi pertama untuk memulai.`;
    $('suratPrevBtn').disabled=true;
    $('suratNextBtn').disabled=true;
    return;
  }
  const atFirst=currentIndex===0;
  const atLast=currentIndex===total-1;
  const prev=atFirst?null:state.rows[currentIndex-1];
  const next=atLast?null:state.rows[currentIndex+1];
  info.innerHTML=`Surat <b>${currentIndex+1}</b> dari <b>${total}</b> • ${atFirst?'Sudah di awal.':'Sebelumnya: <b>'+esc(prev.noBukti||'Tanpa No. Bukti')+'</b>'} • ${atLast?'Sudah di akhir.':'Berikutnya: <b>'+esc(next.noBukti||'Tanpa No. Bukti')+'</b>'}`;
  const ready=Boolean(state.result&&total>1);
  $('suratPrevBtn').disabled=!ready || atFirst;
  $('suratNextBtn').disabled=!ready || atLast;
}
function nextSurat(){
  const total=state.rows.length;
  if(total<2)return;
  captureCurrentSuratDraft();
  readSuratFields();
  const currentIndex=Number.isInteger(state.surat.rowIndex)?state.surat.rowIndex:-1;
  if(currentIndex<0){
    const el=suratElement('bukti');
    if(el)el.value='0';
    fillSurat();
    return;
  }
  if(currentIndex>=total-1){
    updateSuratNextInfo();
    return;
  }
  const nextIndex=currentIndex+1;
  const buktiEl=suratElement('bukti');
  if(buktiEl)buktiEl.value=String(nextIndex);
  fillSurat();
}
function prevSurat(){
  const total=state.rows.length;
  if(total<2)return;
  captureCurrentSuratDraft();
  readSuratFields();
  const currentIndex=Number.isInteger(state.surat.rowIndex)?state.surat.rowIndex:-1;
  if(currentIndex<=0){
    updateSuratNextInfo();
    return;
  }
  const prevIndex=currentIndex-1;
  const buktiEl=suratElement('bukti');
  if(buktiEl)buktiEl.value=String(prevIndex);
  fillSurat();
}
function fillSurat(){
  const el=suratElement('bukti');
  const idx=Number(el?.value);
  const r=(Number.isInteger(idx)&&idx>=0&&idx<state.rows.length)?state.rows[idx]:null;
  if(!r)return;
  state.surat.rowIndex=idx;
  state.surat.bukti=r.noBukti||'';
  state.surat.tanggal=dateToInput(r.tanggal);
  state.surat.uraian=suratUraianText();
  const buktiEl=suratElement('bukti'), tanggalEl=suratElement('tanggal'), uraianEl=suratElement('uraian');
  if(buktiEl)buktiEl.value=String(idx);
  if(tanggalEl)tanggalEl.value=state.surat.tanggal;
  if(uraianEl)uraianEl.value=state.surat.uraian;
  restoreSuratDraft(idx);
  renderSurat();
  updateSuratNextInfo();
  refreshSuratSaveState();
}

function normalizeSchoolName(v){return clean(v).toLocaleUpperCase('id-ID');}
function addressWithKecamatan(address,kecamatan){
  let a=clean(address);
  const k=normalizeKecamatan(kecamatan);
  if(!a)return '';
  if(/kecamatan\s+[^,;]+?(?=\s+kabupaten|\s+kab\.|$)/i.test(a)){
    a=a.replace(/kecamatan\s+[^,;]+?(?=\s+kabupaten|\s+kab\.|$)/i,`Kecamatan ${k}`);
  }else if(k && !new RegExp(`\\bkecamatan\\s+${k.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}\\b`,'i').test(a)){
    a += ` Kecamatan ${k}`;
  }
  return a;
}
function splitUraianItems(text){
  const src=clean(text||'');
  if(!src)return [];
  const base=src.split(/\s*;\s*/).map(x=>clean(x)).filter(Boolean);
  const out=[];
  for(const part of (base.length?base:[src])){
    // Uraian yang sangat panjang dipecah pada batas kata agar tidak pernah
    // hilang ketika satu item saja lebih tinggi dari ruang halaman.
    const words=part.split(/\s+/).filter(Boolean);
    let chunk='';
    for(const word of words){
      const test=chunk?`${chunk} ${word}`:word;
      if(test.length>420 && chunk){
        out.push(chunk);
        chunk=word;
      }else{
        chunk=test;
      }
    }
    if(chunk)out.push(chunk);
  }
  return out;
}
function renderUraianHtml(text){
  const items=splitUraianItems(text);
  if(!items.length)return '<span class="muted-dash">—</span>';
  return '<div class="uraian-list">'+items.map((item,i)=>`<div class="uraian-item"><span class="uraian-no">${i+1}.</span><span class="uraian-text">${esc(item)}</span></div>`).join('')+'</div>';
}

function suratBlock(html, cls=''){
  return `<div class="page-block ${cls}">${html}</div>`;
}
function getKopSchoolFontSize(name){
  const len=(name||'').trim().length;
  if(len<=26)return '15pt';
  if(len<=35)return '13.5pt';
  if(len<=45)return '12pt';
  if(len<=58)return '10.5pt';
  if(len<=72)return '9.5pt';
  return '8.5pt';
}

function buildSuratBlocks(d, num, dateText, tandaTangan, logoSekolah, logoKabupaten){
  const blocks=[];
  const kabSrc=logoKabupaten||'assets/logo_kabupaten_serang.png';
  const schoolLogo=clean(logoSekolah)?`<img class="kop-logo kop-logo-sekolah" src="${esc(logoSekolah)}" alt="Logo Sekolah">`:'';
  const rawSchool=[d.sd,d.kecamatan].filter(Boolean).join(' ').replace(/\s+/g,' ').toLocaleUpperCase('id-ID')||'SD NEGERI';
  const schoolFontSize=getKopSchoolFontSize(rawSchool);
  const rawKab=clean(d.kabupaten||state.identity?.kabupaten||'');
  const isKota=/^kota\b/i.test(rawKab);
  const kabupatenBku=rawKab.replace(/^(?:kabupaten|kab\.?|kota)\s+/i,'').trim();
  const provText='PEMERINTAH '+(isKota?'KOTA':'KABUPATEN')+(kabupatenBku?' '+kabupatenBku.toLocaleUpperCase('id-ID'):'');
  const introKec = d.kecamatan ? `Kecamatan ${esc(d.kecamatan)} ` : '';
  const introKab = rawKab ? `${esc(rawKab)} ` : '';
  blocks.push(suratBlock(`<div class="kop"><img class="kop-logo kop-logo-kabupaten" src="${esc(kabSrc)}" alt="Logo Daerah">${schoolLogo}<div class="prov">${esc(provText)}</div><div class="school" style="font-size:${schoolFontSize};">${esc(rawSchool)}</div><div class="addr">Alamat : ${esc(d.alamat||'')}</div><div class="mail">E-Mail : ${esc(d.email||'')} &nbsp;&nbsp; NPSN: ${esc(d.npsn||'')} &nbsp;&nbsp; NSS: ${esc(d.nss||'')}</div></div>`,'kop-block'));
  blocks.push(suratBlock(`<h2>SURAT PERINTAH MENGELUARKAN UANG</h2><div class="nomor">Nomor : ${esc(num)}</div>`,'title-block'));
  blocks.push(suratBlock(`<p>Kepala ${esc(d.sd||'SD')} ${introKec}${introKab}memerintahkan kepada:</p>`,'intro-block'));
  blocks.push(suratBlock(`<div class="identity"><div class="line"><b>Nama</b><span class="colon">:</span><span>${esc(d.bendahara)}</span></div><div class="line"><b>NIP</b><span class="colon">:</span><span>${esc(d.nipBendahara)}</span></div><div class="line"><b>Jabatan</b><span class="colon">:</span><span>Bendahara BOSP ${esc(d.sd||'SDN KRIAN')}</span></div></div>`,'identity-block'));
  blocks.push(suratBlock(`<p class="payment-heading"><b>Untuk mengeluarkan uang :</b></p>`,'payment-title-block'));
  blocks.push(suratBlock(`<div class="payment"><div class="row"><b>Harap dibayar kepada</b><span class="colon">:</span><span>${esc(d.kepada||'........................................................')}</span></div></div>`,'payment-row-block'));
  blocks.push(suratBlock(`<div class="payment"><div class="row"><b>Uang Sebesar</b><span class="colon">:</span><span class="amount">Rp&nbsp;${formatMoney(d.nominal)}</span></div></div>`,'payment-row-block'));
  blocks.push(suratBlock(`<div class="payment"><div class="row"><b>Terbilang</b><span class="colon">:</span><span class="terbilang">${esc(moneyWords(d.nominal))}</span></div></div>`,'payment-row-block'));
  blocks.push(suratBlock(`<div class="payment"><div class="row"><b>Untuk Pembayaran</b><span class="colon">:</span><span class="manual-text">${esc(d.untukPembayaran||'........................................................')}</span></div></div>`,'payment-row-block'));
  blocks.push(suratBlock(`<div class="payment"><div class="row uraian-label-row"><b>Uraian</b><span class="colon">:</span><div></div></div></div>`,'uraian-heading-block'));
  const rawItems=(d.rawItems||[]).filter(x=>clean(x.uraian));
  if(rawItems.length){
    const rowsHtml=rawItems.map((item,i)=>`<tr><td>${i+1}</td><td>${esc(item.uraian)}</td><td>${formatMoney(item.pengeluaran)}</td></tr>`).join('');
    const total=rawItems.reduce((s,x)=>s+(Number(x.pengeluaran)||0),0);
    blocks.push(suratBlock(`<div class="surat-uraian-table-wrap"><table class="surat-uraian-table"><thead><tr><th>NO</th><th>NAMA BARANG / KEGIATAN</th><th>HARGA</th></tr></thead><tbody>${rowsHtml}</tbody><tfoot><tr><td colspan="2">TOTAL</td><td>${formatMoney(total)}</td></tr></tfoot></table></div>`,'uraian-table-block'));
  }else{
    blocks.push(suratBlock(`<div class="surat-uraian-table-wrap"><table class="surat-uraian-table"><thead><tr><th>NO</th><th>NAMA BARANG / KEGIATAN</th><th>HARGA</th></tr></thead><tbody><tr><td>1</td><td>—</td><td>0</td></tr></tbody></table></div>`,'uraian-table-block'));
  }
  blocks.push(suratBlock(`<div class="sign"><div>${esc(d.kecamatan||'................................')}, ${esc(dateText||'................................')}</div><div>Kepala Sekolah</div><img src="${esc(tandaTangan)}" alt="Tanda tangan Kepala Sekolah"><div class="name">${esc(d.kepala)}</div><div>NIP: ${esc(d.nipKepala)}</div></div>`,'sign-block'));
  return blocks;
}

function createSuratPage(){
  const page=document.createElement('div');
  page.className='surat-page';
  page.innerHTML='<div class="surat-page-content"></div><div class="surat-page-footer"></div>';
  return page;
}

function paginateSurat(blocks){
  const host=document.createElement('div');
  host.className='surat-pages';

  // Pengukuran dilakukan memakai DOM asli browser agar pagination mengikuti
  // font, ukuran layar, dan wrapping yang benar-benar dipakai saat cetak.
  host.style.position='absolute';
  host.style.left='-100000px';
  host.style.top='0';
  host.style.width='210mm';
  host.style.visibility='hidden';
  document.body.appendChild(host);

  let page=createSuratPage();
  host.appendChild(page);
  let content=page.querySelector('.surat-page-content');

  const isOverflow=()=>content.scrollHeight>content.clientHeight+1;

  function newPage(){
    page=createSuratPage();
    host.appendChild(page);
    content=page.querySelector('.surat-page-content');
  }

  // Tabel Uraian sengaja dipaginasi PER BARIS. Sebelumnya tabel diperlakukan
  // sebagai satu blok utuh sehingga saat seluruh tabel tidak muat di halaman 1,
  // browser memindahkannya seluruhnya ke halaman 2.
  function appendUraianTablePaginated(block){
    const sourceTable=block.querySelector('.surat-uraian-table');
    if(!sourceTable){
      content.appendChild(block);
      if(isOverflow() && content.children.length>1){
        content.removeChild(block);
        newPage();
        content.appendChild(block);
      }
      return;
    }

    const sourceHead=sourceTable.querySelector('thead');
    const sourceBodyRows=[...sourceTable.querySelectorAll('tbody > tr')];
    const sourceFoot=sourceTable.querySelector('tfoot');
    if(!sourceBodyRows.length){
      content.appendChild(block);
      if(isOverflow() && content.children.length>1){
        content.removeChild(block);
        newPage();
        content.appendChild(block);
      }
      return;
    }

    let tableBlock=null;
    let table=null;
    let tbody=null;

    const startChunk=()=>{
      tableBlock=block.cloneNode(true);
      table=tableBlock.querySelector('.surat-uraian-table');
      tbody=table.querySelector('tbody');
      tbody.innerHTML='';
      const oldFoot=table.querySelector('tfoot');
      if(oldFoot)oldFoot.remove();
      content.appendChild(tableBlock);

      // Pastikan header tabel sendiri tidak memaksa seluruh tabel ke halaman berikutnya.
      if(isOverflow() && content.children.length>1){
        content.removeChild(tableBlock);
        newPage();
        tableBlock=block.cloneNode(true);
        table=tableBlock.querySelector('.surat-uraian-table');
        tbody=table.querySelector('tbody');
        tbody.innerHTML='';
        const foot=table.querySelector('tfoot');
        if(foot)foot.remove();
        content.appendChild(tableBlock);
      }
    };

    const moveChunkToNextPage=()=>{
      // Chunk yang sudah penuh harus tetap tinggal di halaman sebelumnya.
      // Hanya baris berikutnya yang dimulai pada halaman baru.
      newPage();
      startChunk();
    };

    startChunk();

    for(const row of sourceBodyRows){
      const candidate=row.cloneNode(true);
      tbody.appendChild(candidate);

      if(isOverflow()){
        tbody.removeChild(candidate);
        if(tbody.children.length>0){
          moveChunkToNextPage();
          tbody.appendChild(candidate);
        }else{
          // Tidak ada baris di chunk saat ini: pindahkan chunk ke halaman baru,
          // sehingga halaman sebelumnya tidak dipaksa menerima seluruh tabel.
          if(content.children.length>1){
            if(tableBlock.parentNode===content)content.removeChild(tableBlock);
            newPage();
            startChunk();
          }
          tbody.appendChild(candidate);
        }
      }
    }

    // TOTAL hanya ditambahkan pada chunk terakhir. Jika tidak muat,
    // pindahkan baris terakhir + TOTAL ke halaman berikutnya.
    if(sourceFoot){
      const totalCandidate=sourceFoot.cloneNode(true);
      table.appendChild(totalCandidate);

      if(isOverflow()){
        table.removeChild(totalCandidate);
        const rows=[...tbody.children];
        const lastRow=rows.pop();
        if(lastRow)tbody.removeChild(lastRow);

        if(tbody.children.length===0 && tableBlock.parentNode===content){
          content.removeChild(tableBlock);
        }

        newPage();
        startChunk();
        if(lastRow)tbody.appendChild(lastRow);
        table.appendChild(totalCandidate);
      }
    }
  }

  for(const blockHtml of blocks){
    const holder=document.createElement('div');
    holder.innerHTML=blockHtml;
    const block=holder.firstElementChild;

    if(block && block.classList.contains('uraian-table-block')){
      appendUraianTablePaginated(block);
      continue;
    }

    content.appendChild(block);

    if(block && block.classList.contains('kop-block')){
      const kopEl=block.querySelector('.kop')||block;
      const school=kopEl.querySelector('.school');
      if(school){
        const comp=window.getComputedStyle(kopEl);
        const padL=parseFloat(comp.paddingLeft)||0;
        const padR=parseFloat(comp.paddingRight)||0;
        const maxW=(kopEl.clientWidth||680)-padL-padR;
        if(maxW>50){
          let curPt=parseFloat(window.getComputedStyle(school).fontSize)||16;
          let iter=0;
          while((school.scrollWidth>maxW+1||school.clientHeight>curPt*2.8)&&curPt>9&&iter<15){
            curPt-=0.5;
            school.style.fontSize=curPt+'px';
            iter++;
          }
        }
      }
    }

    if(isOverflow() && content.children.length>1){
      content.removeChild(block);
      newPage();
      content.appendChild(block);
    }
  }

  // Tanda tangan tidak boleh tertinggal/terpotong. Jika tidak cukup ruang,
  // pindahkan seluruh blok tanda tangan ke halaman berikutnya.
  const lastPage=host.querySelector('.surat-page:last-child');
  if(lastPage){
    const c=lastPage.querySelector('.surat-page-content');
    const sign=lastPage.querySelector('.sign-block');
    if(sign && c.scrollHeight>c.clientHeight+1){
      sign.remove();
      const np=createSuratPage();
      host.appendChild(np);
      np.querySelector('.surat-page-content').appendChild(sign);
    }
  }

  const finalPages=[...host.querySelectorAll('.surat-page')];
  finalPages.forEach((p,i)=>{
    p.querySelector('.surat-page-footer').textContent=`Halaman ${i+1} dari ${finalPages.length}`;
  });

  host.style.position='';
  host.style.left='';
  host.style.top='';
  host.style.width='';
  host.style.visibility='';
  return host;
}

function renderSurat(){
  if(!state.rows.length){$('suratPreview').style.display='none';ns.suratViewerUpdate();return;}
  readSuratFields();
  if(state.docMode==='kwitansi' && typeof ns.buildKwitansiPagesForIndex==='function'){
    const kp=ns.buildKwitansiPagesForIndex(state.surat.rowIndex);
    $('suratPreview').innerHTML='';
    $('suratPreview').appendChild(kp);
    $('suratPreview').style.display='block';
    ns.suratViewerUpdate();
    return;
  }
  const d=suratData();
  d.sd=normalizeSchoolName(d.sd);
  d.kecamatan=normalizeKecamatan(d.kecamatan);
  d.alamat=clean(d.alamat);
  const dt=dateToInput(d.tanggal).split('-');
  const dateText=dt.length===3?`${dt[2]}-${dt[1]}-${dt[0]}`:dateDisplay(d.tanggal);
  const nomorUrut=clean(d.nomor||'').replace(/^400\.3\.5\s*\/\s*/i,'').replace(/\s+/g,'');
  const jenisBukti=clean(d.bukti||'BPU').toLocaleUpperCase('id-ID');
  const bulan=dt.length===3?roman(Number(dt[1])):'I';
  const tahun=dt.length===3?dt[0]:'2026';
  const num=`400.3.5/${nomorUrut||'001'}/${jenisBukti}/${bulan}/${tahun}`;
  const tandaTangan=state.surat.tandaTangan||'assets/s_perintah_img_2.png';
  const logoSekolah=state.surat.logoSekolah||'';
  const logoKabupaten=state.surat.logoKabupaten||'assets/logo_kabupaten_serang.png';

  const blocks=buildSuratBlocks(d,num,dateText,tandaTangan,logoSekolah,logoKabupaten);
  const pages=paginateSurat(blocks);
  decorateSuratPages(pages,clean(d.bukti||'')||'-',clean(d.category||'')||'-');

  $('suratPreview').innerHTML='';
  $('suratPreview').appendChild(pages);
  $('suratPreview').style.display='block';
  ns.suratViewerUpdate();
}

Object.assign(ns,{
  dateToInput,dateDisplay,suratRow,enableSuratSection,disableSuratSection,rawRowsForSurat,suratUraianText,moneyWords,roman,suratData,syncSurat,readSuratFields,updateSuratNextInfo,nextSurat,prevSurat,fillSurat,
  normalizeSchoolName,addressWithKecamatan,splitUraianItems,renderUraianHtml,suratBlock,buildSuratBlocks,createSuratPage,paginateSurat,renderSurat,
  refreshSuratSaveState,showSuratSavedPopup,hideSuratSavedPopup,suratDraftKey,getSuratDraft,captureCurrentSuratDraft,restoreSuratDraft,updateSuratDraftStatus,saveCurrentSuratData,suratDataForIndex,decorateSuratPages,buildSuratPagesForIndex,suratDraftReady,refreshSuratSuggestions,getStoredSuratSuggestionValues
});
})(window.SPMU=window.SPMU||{});
