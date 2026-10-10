/* Panel Impor Dokumen BKU: langkah dinamis, info berkas, ringkasan hasil baca, seret-lepas, baca otomatis. */
(function(ns){
'use strict';
const $=id=>document.getElementById(id);
const esc=s=>typeof ns.esc==='function'?ns.esc(s):String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const money=n=>typeof ns.formatMoney==='function'?ns.formatMoney(n):Math.round(n||0).toLocaleString('id-ID');
const AUTO_KEY='siapbos.autoRead';
let pickedAt=0,timer=0;
const getAuto=()=>{try{return localStorage.getItem(AUTO_KEY)==='1';}catch(e){return false;}};
const setAuto=v=>{try{localStorage.setItem(AUTO_KEY,v?'1':'0');}catch(e){}};
const fmtSize=b=>b>=1048576?(b/1048576).toFixed(1).replace('.',',')+' MB':Math.max(1,Math.round(b/1024))+' KB';

function snapshot(){
  const st=ns.state||{},res=st.result,stat=$('projectSaveStatus');
  return {
    st,res,rows:st.rows||[],raw:st.rawRows||[],
    saved:!!stat&&stat.classList.contains('ok'),
    reading:!!st.file&&!res&&!!$('readBtn')&&$('readBtn').disabled,
    failed:!!st.file&&!res&&/^Gagal/i.test(($('status')||{}).textContent||'')
  };
}

function renderSteps(s){
  const el=$('bkuSteps');if(!el)return;
  const file=!!s.st.file,read=!!s.res,saved=read&&s.saved;
  const list=[
    ['Pilih berkas',file?'done':'active','Pilih berkas PDF/XLSX/XLS BKU'],
    ['Baca data',read?'done':file?(s.reading?'active busy':'active'):'','Tekan BACA DATA untuk mengekstrak transaksi'],
    ['Simpan pekerjaan',saved?'done':read?'active':'','Simpan agar masuk ke dashboard'],
    ['Surat & pajak',read&&s.rows.length?'active':'','Susun Surat Perintah dan Hitung Pajak']
  ];
  el.innerHTML=list.map((x,i)=>`<li class="${x[1]}" title="${esc(x[2])}"><b>${x[1].indexOf('done')===0?'✓':i+1}</b>${esc(x[0])}</li>`).join('');
}

function renderChip(s){
  const el=$('bkuFileChip');if(!el)return;
  const f=s.st.file;
  if(!f){el.classList.remove('show');el.innerHTML='';return;}
  const ext=(f.name.split('.').pop()||'').toLowerCase();
  let pill=['Belum dibaca','warn'];
  if(s.reading)pill=['Membaca…','busy'];
  else if(s.failed)pill=['Gagal dibaca','err'];
  else if(s.res)pill=[s.res.isEmptyBku?'BKU kosong (nihil)':`Terbaca • ${s.rows.length} transaksi`,'ok'];
  const at=new Date(pickedAt||Date.now()).toLocaleTimeString('id-ID',{hour:'2-digit',minute:'2-digit'});
  el.innerHTML=`<div class="ico${ext==='pdf'?'':' x'}">${esc(ext.toUpperCase().slice(0,4))}</div><div class="meta"><b>${esc(f.name)}</b><small>${fmtSize(f.size||0)} • dipilih ${at}${s.res&&s.res.pages?` • ${s.res.pages} halaman`:''}</small></div><span class="bkx-pill ${pill[1]}">${esc(pill[0])}</span><button type="button" class="bkx-swap" id="bkuSwapFile">Ganti berkas</button>`;
  el.classList.add('show');
}

function renderSummary(s){
  const el=$('bkuSummary');if(!el)return;
  if(!s.res){el.classList.remove('show');el.innerHTML='';return;}
  const st=s.st,id=st.identity||{},res=s.res,v=res.validation||{};
  const info=typeof ns.detectMonthFromProject==='function'?ns.detectMonthFromProject({state:{rows:st.rows,rawRows:st.rawRows,identity:id},file:st.file,name:''}):null;
  const period=info&&info.month!==999?info.label:'Tidak terdeteksi';
  const tax=typeof ns.getTaxSummary==='function'?ns.getTaxSummary():{siplahTotal:0,nonSiplahTotal:0,grandTotal:0,count:0};
  const total=s.rows.reduce((a,r)=>a+(Number(r.pengeluaran)||0),0);
  const spmu=Object.values(st.suratByBukti||{}).filter(d=>d&&d.savedAt).length;
  const pct=s.rows.length?Math.min(100,Math.round(spmu/s.rows.length*100)):0;
  const idOk=!!(id.school&&id.headName&&id.headNip&&id.treasurerName&&id.treasurerNip);
  const warn=(res.warnings||[]).filter(w=>!/^Validasi PDF OK/.test(w)).length;
  const checked=!!v.declaredTotalFound,vOk=!checked||!!v.ok;
  const tile=(l,b,sm,c)=>`<div class="bkx-tile${c?' '+c:''}"><span>${l}</span><b>${b}</b>${sm?`<small>${sm}</small>`:''}</div>`;
  const btn=(go,label)=>{const b=$(go);return `<button type="button" data-go="${go}"${b&&b.disabled?' disabled':''}>${label}</button>`;};
  el.innerHTML=`<div class="bkx-tiles">`+
    tile('Periode BKU',esc(period),esc(st.file?st.file.name:''))+
    tile('Sekolah',esc(id.school||'—'),`NPSN ${esc(id.npsn||'—')}${id.kecamatan?' • Kec. '+esc(id.kecamatan):''}`)+
    tile('Transaksi',`${s.rows.length} rincian`,`${s.raw.length} baris murni • ${res.ignoredRows||0} diabaikan`)+
    tile('Total pengeluaran',money(total),v.internalTransferTotal>0?`Tarik tunai ${money(v.internalTransferTotal)} dikecualikan`:'Tanpa pemindahan dana internal')+
    tile('Pajak terdeteksi',money(tax.grandTotal),`${tax.count} transaksi • SIPLah ${money(tax.siplahTotal)} • Non ${money(tax.nonSiplahTotal)}`)+
    tile('Validasi',checked?(vOk?'Sesuai ✓':'Periksa ⚠'):'Terbaca',(checked?(vOk?'Total tercetak cocok':'Ada selisih total'):'Tanpa total tercetak untuk dicocokkan')+(warn?` • ${warn} peringatan`:''),checked&&vOk&&!warn?'ok':(vOk&&!warn?'':'warn'))+
    tile('Identitas & penandatangan',idOk?'Lengkap ✓':'Belum lengkap',idOk?'Kepala Sekolah & Bendahara terbaca':'Lengkapi di Profil / Surat Perintah',idOk?'ok':'warn')+
    `<div class="bkx-tile"><span>SPMU tersimpan</span><b>${spmu} / ${s.rows.length}</b><div class="bkx-prog"><i style="width:${pct}%"></i></div></div></div>`+
    `<div class="bkx-actions">${btn('tabSuratBtn','Buka Surat Perintah')}${btn('tabPajakBtn','Lihat Hitung Pajak')}${btn('tabDashboardBtn','Ke Dashboard')}</div>`;
  el.classList.add('show');
}

function refresh(){const s=snapshot();renderSteps(s);renderChip(s);renderSummary(s);}
const soon=()=>{clearTimeout(timer);timer=setTimeout(refresh,40);};

function init(){
  const card=$('bkuImportCard');if(!card)return;
  const auto=$('bkuAutoRead');if(auto)auto.checked=getAuto();
  if(typeof MutationObserver==='function'){
    const mo=new MutationObserver(soon);
    ['status','projectSaveStatus','projectSaveName','sourceInfo','tbody','warnings'].forEach(id=>{const e=$(id);if(e)mo.observe(e,{childList:true,characterData:true,subtree:true,attributes:true,attributeFilter:['class']});});
    ['readBtn','tabSuratBtn','tabPajakBtn'].forEach(id=>{const e=$(id);if(e)mo.observe(e,{attributes:true,attributeFilter:['disabled']});});
  }
  const input=$('fileInput');
  if(input)input.addEventListener('change',()=>{
    pickedAt=Date.now();soon();
    if(getAuto()&&ns.state&&ns.state.file)setTimeout(()=>{const b=$('readBtn');if(b&&!b.disabled)b.click();},80);
  });
  card.addEventListener('change',e=>{if(e.target&&e.target.id==='bkuAutoRead')setAuto(e.target.checked);});
  card.addEventListener('click',e=>{
    if(e.target.closest('#bkuSwapFile')){if(input)input.click();return;}
    const go=e.target.closest('[data-go]');
    if(go){const b=$(go.dataset.go);if(b&&!b.disabled)b.click();}
  });
  // Seret & lepas berkas ke kartu impor
  let depth=0;
  const hasFiles=e=>!!e.dataTransfer&&Array.prototype.indexOf.call(e.dataTransfer.types||[],'Files')>-1;
  card.addEventListener('dragenter',e=>{if(!hasFiles(e))return;e.preventDefault();depth++;card.classList.add('bkx-drag');});
  card.addEventListener('dragover',e=>{if(!hasFiles(e))return;e.preventDefault();e.dataTransfer.dropEffect='copy';});
  card.addEventListener('dragleave',()=>{depth=Math.max(0,depth-1);if(!depth)card.classList.remove('bkx-drag');});
  card.addEventListener('drop',e=>{
    if(!hasFiles(e))return;
    e.preventDefault();depth=0;card.classList.remove('bkx-drag');
    const f=Array.prototype.find.call(e.dataTransfer.files||[],x=>/\.(pdf|xlsx|xls)$/i.test(x.name));
    const status=$('status');
    if(!f){if(status)status.textContent='Format tidak didukung. Gunakan berkas PDF, XLSX, atau XLS.';return;}
    try{const dt=new DataTransfer();dt.items.add(f);input.files=dt.files;input.dispatchEvent(new Event('change',{bubbles:true}));}
    catch(err){if(status)status.textContent='Browser tidak mendukung seret-lepas. Gunakan tombol Choose File.';}
  });
  // Pintasan Ctrl/Cmd+S di tab BKU = SIMPAN PEKERJAAN
  document.addEventListener('keydown',e=>{
    if(!(e.ctrlKey||e.metaKey)||String(e.key).toLowerCase()!=='s')return;
    const tab=$('tabBku'),b=$('saveProjectBtn');
    if(tab&&tab.classList.contains('active')&&b&&ns.state&&ns.state.file){e.preventDefault();b.click();}
  });
  refresh();
}
init();
Object.assign(ns,{refreshImportPanel:refresh});
})(window.SPMU=window.SPMU||{});
