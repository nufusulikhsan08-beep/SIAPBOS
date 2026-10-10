(function(ns){
'use strict';

// Cek apakah Supabase tersedia dan sudah dikonfigurasi
function useSupabase() {
  return typeof window.SIAP_BOS_SUPABASE !== 'undefined' &&
         typeof window.SIAP_BOS_SUPABASE.isConfigured === 'function' &&
         window.SIAP_BOS_SUPABASE.isConfigured();
}

const DB_NAME='SPMU_OTOMATIS_PROJECTS';
const DB_VERSION=3;
const STORE_NAME='projects';
const LS_PREFIX='SPMU_PROJECT_FALLBACK_V3_';
const LS_INDEX='SPMU_PROJECT_INDEX_V3';
const LS_MAX_BYTES=4*1024*1024;
let activeProjectId=null;
let activeProjectName='';
let autoSaveTimer=null;

const INDO_MONTHS = {
  'januari': 1, 'jan': 1, 'january': 1,
  'februari': 2, 'pebruari': 2, 'feb': 2, 'february': 2,
  'maret': 3, 'mar': 3, 'march': 3,
  'april': 4, 'apr': 4,
  'mei': 5, 'may': 5,
  'juni': 6, 'jun': 6, 'june': 6,
  'juli': 7, 'jul': 7, 'july': 7,
  'agustus': 8, 'agt': 8, 'ags': 8, 'agust': 8, 'august': 8,
  'september': 9, 'sep': 9, 'sept': 9,
  'oktober': 10, 'okt': 10, 'oct': 10, 'october': 10,
  'november': 11, 'nopember': 11, 'nov': 11,
  'desember': 12, 'des': 12, 'dec': 12, 'december': 12
};

function getMonthName(num){
  const names = ['', 'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
  return names[num] || ('Bulan ' + num);
}

function detectMonthFromText(text){
  if(!text || typeof text !== 'string') return 0;
  const lower = text.toLowerCase();
  for(const [name, num] of Object.entries(INDO_MONTHS)){
    const reg = new RegExp('\\b' + name + '\\b', 'i');
    if(reg.test(lower)) return num;
  }
  return 0;
}

function validMonth(m){m=Number(m);return Number.isInteger(m)&&m>=1&&m<=12?m:0;}
function normYear(y){y=Number(y);if(!y)return 0;if(y<100)y+=2000;return y>=2000&&y<=2100?y:0;}
// Baca bulan & tahun dari satu teks tanggal (DD-MM-YYYY, YYYY-MM-DD, atau nama bulan).
function parseMonthYear(t){
  const s=String(t??'');
  if(!s)return null;
  let m=s.match(/\b(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\b/);
  if(m&&validMonth(m[2]))return {month:+m[2],year:normYear(m[1])};
  m=s.match(/\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})\b/);
  if(m&&validMonth(m[2]))return {month:+m[2],year:normYear(m[3])};
  m=s.match(/\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{2})\b/);
  if(m&&validMonth(m[2]))return {month:+m[2],year:normYear(m[3])};
  const nm=detectMonthFromText(s);
  if(nm){const y=s.match(/\b(20\d{2})\b/);return {month:nm,year:y?Number(y[1]):0};}
  return null;
}
// Bulan BKU = bulan yang paling banyak muncul pada tanggal transaksi.
function periodFromRows(rows){
  if(!Array.isArray(rows)||!rows.length)return null;
  const count=new Map();
  for(const r of rows){
    if(!r)continue;
    const my=parseMonthYear(r.tanggal||r.tgl||r.date);
    if(!my)continue;
    const key=my.year*100+my.month;
    count.set(key,(count.get(key)||0)+1);
  }
  if(!count.size)return null;
  let best=null;
  for(const [key,n] of count){
    if(!best||n>best.n||(n===best.n&&key<best.key))best={key,n};
  }
  return {month:best.key%100,year:Math.floor(best.key/100)};
}
function makePeriod(month,year){
  if(!month)return {month:999,year:0,monthName:'Lainnya',label:'Lainnya',key:999};
  const monthName=getMonthName(month);
  return {month,year:year||0,monthName,label:year?`${monthName} ${year}`:monthName,key:(year||0)*100+month};
}
function detectMonthFromProject(p){
  if(!p)return makePeriod(0,0);
  const s=p.state||{};
  const ident=s.identity||{};
  // 1) Sumber utama: tanggal transaksi pada BKU.
  const fromRows=periodFromRows(Array.isArray(s.rows)&&s.rows.length?s.rows:s.rawRows);
  if(fromRows)return makePeriod(fromRows.month,fromRows.year);
  // 2) Cadangan: identitas/nama file/nama pekerjaan.
  const texts=[ident.periode,ident.bulan,ident.periodeBulan,ident.month,ident.namaBulan,p.monthName,p.file?.name,p.name];
  for(const t of texts){
    const my=parseMonthYear(t);
    if(my&&my.month)return makePeriod(my.month,my.year);
  }
  return makePeriod(0,0);
}
// Nama pekerjaan otomatis = bulan (+ tahun) yang terbaca dari BKU.
function projectDisplayName(p){
  const info=detectMonthFromProject(p);
  return info.month!==999?info.label:String(p?.name||'Pekerjaan BKU');
}
function autoProjectName(){
  const st=ns.state||{};
  const info=detectMonthFromProject({state:{rows:st.rows,rawRows:st.rawRows,identity:st.identity},file:st.file,name:''});
  return info.month!==999?info.label:'';
}
function sortProjectsByMonth(arr){
  return [...(arr||[])].sort((a,b)=>{
    const mA=detectMonthFromProject(a),mB=detectMonthFromProject(b);
    if(mA.year!==mB.year)return mA.year-mB.year;
    if(mA.month!==mB.month)return mA.month-mB.month;
    return Number(a.createdAt||0)-Number(b.createdAt||0);
  });
}

function q(id){return ns.$?ns.$(id):document.getElementById(id)}
function setText(id,text){const el=q(id);if(el)el.textContent=text||''}
function setSaveStatus(text,kind){
  const el=q('projectSaveStatus');
  if(!el)return;
  el.textContent=text||'';
  el.className='project-save-status'+(kind?' '+kind:'');
}
function safeEsc(v){return typeof ns.esc==='function'?ns.esc(String(v)):String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}

function normalizeError(err){
  const msg=err?.message||String(err||'Kesalahan tidak diketahui.');
  if(/security|denied|not.?allowed/i.test(msg)) return 'Penyimpanan browser diblokir untuk halaman ini.';
  return msg;
}

function openDb(){
  return new Promise((resolve,reject)=>{
    if(!('indexedDB' in window)) return reject(new Error('IndexedDB tidak tersedia.'));
    let req;
    try{req=window.indexedDB.open(DB_NAME,DB_VERSION);}catch(e){reject(e);return;}
    req.onupgradeneeded=()=>{
      const db=req.result;
      if(db.objectStoreNames.contains(STORE_NAME)) db.deleteObjectStore(STORE_NAME);
      const store=db.createObjectStore(STORE_NAME,{keyPath:'id'});
      store.createIndex('updatedAt','updatedAt',{unique:false});
      store.createIndex('name','name',{unique:false});
    };
    req.onsuccess=()=>resolve(req.result);
    req.onerror=()=>reject(req.error||new Error('Gagal membuka IndexedDB.'));
    req.onblocked=()=>reject(new Error('Penyimpanan terkunci.'));
  });
}

function txDone(tx){
  return new Promise((resolve,reject)=>{
    tx.oncomplete=()=>resolve();
    tx.onerror=()=>reject(tx.error||new Error('Transaksi penyimpanan gagal.'));
    tx.onabort=()=>reject(tx.error||new Error('Transaksi dibatalkan.'));
  });
}

function getFallbackIndex(){
  try{
    const a=JSON.parse(localStorage.getItem(LS_INDEX)||'[]');
    return Array.isArray(a)?a:[];
  }catch(_){return []}
}
function setFallbackIndex(arr){
  localStorage.setItem(LS_INDEX,JSON.stringify(arr));
}
function putFallback(project){
  const json=JSON.stringify(project);
  localStorage.setItem(LS_PREFIX+project.id,json);
  const index=getFallbackIndex().filter(x=>x.id!==project.id);
  index.push({id:project.id,name:project.name,createdAt:project.createdAt,updatedAt:project.updatedAt,fileName:project.file?.name||'BKU',count:project.state?.rows?.length||0,backend:'localStorage'});
  setFallbackIndex(index.sort((a,b)=>Number(b.updatedAt||0)-Number(a.updatedAt||0)));
}
function getFallback(id){
  try{
    const raw=localStorage.getItem(LS_PREFIX+id);
    return raw?JSON.parse(raw):null;
  }catch(_){return null}
}
function deleteFallback(id){
  localStorage.removeItem(LS_PREFIX+id);
  setFallbackIndex(getFallbackIndex().filter(x=>x.id!==id));
}
function listFallback(){
  return getFallbackIndex().map(x=>({
    id:x.id,name:x.name,createdAt:x.createdAt,updatedAt:x.updatedAt,
    file:{name:x.fileName,size:0},state:{rows:Array(x.count||0)},backend:'localStorage',_fallback:true
  }));
}

async function getAllProjects(){
  // 1. Supabase Cloud (utama untuk GitHub Pages)
  if (useSupabase()) {
    try {
      const supabaseProjects = await window.SIAP_BOS_SUPABASE.getProjects();
      if (Array.isArray(supabaseProjects)) {
        return supabaseProjects.sort((a,b)=>Number(b.updatedAt||0)-Number(a.updatedAt||0));
      }
    } catch(e) {
      console.warn('Supabase gagal, memakai cadangan lokal sementara:', e.message);
    }
  }

  // 2. Fallback IndexedDB + localStorage (offline saja; bukan database bersama)
  let idb=[];
  try{
    const db=await openDb();
    idb=await new Promise((resolve,reject)=>{
      const tx=db.transaction(STORE_NAME,'readonly');
      const req=tx.objectStore(STORE_NAME).getAll();
      req.onsuccess=()=>resolve(req.result||[]);
      req.onerror=()=>reject(req.error||new Error('Gagal'));
    });
    try{db.close()}catch(_){}
  }catch(_){}
  const merged=new Map();
  [...listFallback(),...idb].forEach(p=>merged.set(p.id,p));
  return [...merged.values()].sort((a,b)=>Number(b.updatedAt||0)-Number(a.updatedAt||0));
}

async function getProject(id){
  // 1. Supabase Cloud
  if (useSupabase()) {
    try {
      const p = await window.SIAP_BOS_SUPABASE.getProject(id);
      if (p) return p;
    } catch(e) {
      console.warn('Supabase getProject gagal, memakai cadangan lokal:', e.message);
    }
  }

  // 2. IndexedDB lokal
  try{
    const db=await openDb();
    const p=await new Promise((resolve,reject)=>{
      const tx=db.transaction(STORE_NAME,'readonly');
      const req=tx.objectStore(STORE_NAME).get(id);
      req.onsuccess=()=>resolve(req.result||null);
      req.onerror=()=>reject(req.error||new Error('Gagal'));
    });
    try{db.close()}catch(_){}
    if(p)return p;
  }catch(_){}

  // 3. Fallback localStorage
  return getFallback(id);
}

async function deleteProject(id){
  // 1. Hapus dari Supabase Cloud
  if (useSupabase()) {
    try {
      await window.SIAP_BOS_SUPABASE.deleteProject(id);
      if (typeof BroadcastChannel !== 'undefined') {
        const bc = new BroadcastChannel('SIAP_BOS_REALTIME');
        bc.postMessage({ type: 'DATA_UPDATED' });
        bc.close();
      }
    } catch(e) {
      console.warn('Supabase deleteProject gagal:', e.message);
      throw e;
    }
  }

  // 2. Hapus cadangan lokal
  let deleted=false;
  try{
    const db=await openDb();
    const tx=db.transaction(STORE_NAME,'readwrite');
    tx.objectStore(STORE_NAME).delete(id);
    await txDone(tx);
    try{db.close()}catch(_){}
    deleted=true;
  }catch(_){}
  try{deleteFallback(id);deleted=true}catch(_){}
  ns.renderDashboard?.();
}

function activeTabName(){
  const map=[['tabBku','bku'],['tabSurat','surat'],['tabPajak','pajak']];
  for(const [id,name] of map){const el=q(id);if(el?.classList.contains('active'))return name}
  return 'bku';
}
function baseName(){
  const school=String(ns.state?.identity?.school||'').trim();
  const file=String(ns.state?.file?.name||'').replace(/\.[^.]+$/,'').trim();
  return school||file||'Pekerjaan BKU';
}
function cloneState(){
  const state={
    rows:Array.isArray(ns.state?.rows)?ns.state.rows:[],
    rawRows:Array.isArray(ns.state?.rawRows)?ns.state.rawRows:[],
    result:ns.state?.result||null,
    identity:ns.state?.identity||null,
    surat:ns.state?.surat||null,
    suratByBukti:ns.state?.suratByBukti||{},
    search:String(ns.state?.search||''),
    activeTab:activeTabName(),
    category:String(ns.state?.category||'')
  };
  const cloned=JSON.parse(JSON.stringify(state));
  const info=detectMonthFromProject({state:cloned,file:ns.state?.file,name:''});
  if(info.month!==999){
    cloned.identity={...(cloned.identity||{}),bulan:info.monthName,periode:info.label};
  }
  return cloned;
}

async function fileToDataUrl(file){
  if(!file)throw new Error('File BKU tidak ada.');
  const ab=await file.arrayBuffer();
  const bytes=new Uint8Array(ab);
  let binary='';
  const chunk=0x8000;
  for(let i=0;i<bytes.length;i+=chunk)binary+=String.fromCharCode(...bytes.subarray(i,Math.min(i+chunk,bytes.length)));
  return 'data:'+(file.type||'application/octet-stream')+';base64,'+btoa(binary);
}
async function dataUrlToBlob(dataUrl,type){
  const parts=String(dataUrl||'').split(',');
  if(parts.length<2)throw new Error('Cadangan BKU tidak valid.');
  const bin=atob(parts[1]);
  const out=new Uint8Array(bin.length);
  for(let i=0;i<bin.length;i++)out[i]=bin.charCodeAt(i);
  return new Blob([out],{type:type||'application/octet-stream'});
}

async function buildPayload(name,id){
  if(!ns.state?.file)throw new Error('Belum ada file BKU yang dipilih.');
  const now=Date.now();
  const file=ns.state.file;
  const blob=new Blob([await file.arrayBuffer()],{type:file.type||'application/octet-stream'});
  let createdAt=now;
  if(id){const old=await getProject(id);createdAt=old?.createdAt||now}
  return {
    id:id||('p_'+now+'_'+Math.random().toString(36).slice(2,10)),
    name:String(autoProjectName()||name||baseName()).trim()||'Pekerjaan BKU',
    createdAt,updatedAt:now,version:3,
    file:{name:file.name||'BKU',type:file.type||'',size:file.size||blob.size,lastModified:file.lastModified||now,blob},
    state:cloneState()
  };
}

async function writeProject(payload){
  // 1. Tulis ke Supabase Cloud sebagai sumber data utama.
  if (useSupabase()) {
    const portable = await makePortableObject(payload);
    await window.SIAP_BOS_SUPABASE.saveProject(portable);
    if (typeof BroadcastChannel !== 'undefined') {
      const bc = new BroadcastChannel('SIAP_BOS_REALTIME');
      bc.postMessage({ type: 'DATA_UPDATED', id: payload.id });
      bc.close();
    }
  } else {
    throw new Error('Supabase belum dikonfigurasi. Aplikasi online tidak dapat menyimpan ke database cloud.');
  }

  // 2. Simpan salinan lokal untuk pemulihan/offline.
  try{
    const db=await openDb();
    const tx=db.transaction(STORE_NAME,'readwrite');
    tx.objectStore(STORE_NAME).put(payload);
    await txDone(tx);
    try{db.close()}catch(_){}
  }catch(e){}

  return { backend: 'Supabase Cloud ☁️', project: payload };
}

async function saveActiveProject(){
  if(!activeProjectId) return null;
  const payload=await buildPayload(activeProjectName||baseName(),activeProjectId);
  const result=await writeProject(payload);
  activeProjectId=payload.id;
  activeProjectName=payload.name;
  markSaved(payload,result.backend);
  ns.renderDashboard?.();
  return payload;
}

async function putProject(name,id){
  const payload=await buildPayload(name,id);
  const result=await writeProject(payload);
  activeProjectId=payload.id;
  activeProjectName=payload.name;
  markSaved(payload,result.backend);
  ns.renderDashboard?.();
  return payload;
}

function markSaved(project,backend){
  setText('projectSaveName',project?.name?`Pekerjaan aktif: ${project.name}`:'Belum ada pekerjaan tersimpan.');
  setSaveStatus(`✓ TERSIMPAN • ${backend||'Database'} • ${new Date(project.updatedAt||Date.now()).toLocaleTimeString('id-ID')}`,'ok');
  if(ns.state)ns.state._projectDirty=false;
  renderSuratMonthNav();
}
function markDirty(){
  if(!activeProjectId)return;
  if(ns.state)ns.state._projectDirty=true;
  setSaveStatus('● Ada perubahan yang belum disimpan','dirty');
}
function scheduleAutoSave(){
  markDirty();
  if(!activeProjectId)return;
  clearTimeout(autoSaveTimer);
  autoSaveTimer=setTimeout(async()=>{
    try{await putProject(activeProjectName||baseName(),activeProjectId)}catch(e){}
  },1000);
}

// Simpan otomatis: nama = bulan BKU. Jika bulan yang sama sudah tersimpan, tawarkan untuk menimpanya.
async function saveCurrentAuto(){
  if(!ns.state?.file){window.alert('Pilih/upload file BKU terlebih dahulu.');return null;}
  let id=activeProjectId;
  if(!id){
    const label=autoProjectName();
    if(label){
      const all=await getAllProjects();
      const dup=all.find(p=>detectMonthFromProject(p).label===label);
      if(dup){
        const ok=window.confirm(`Pekerjaan bulan ${label} sudah tersimpan.\n\nTimpa dengan BKU yang sedang dibuka? Data SPMU yang tersimpan pada bulan tersebut akan diganti.`);
        if(!ok)return null;
        id=dup.id;
      }
    }
  }
  const p=await putProject(null,id);
  await renderProjectList();
  return p;
}
async function saveCurrentFromUi(){return saveCurrentAuto();}

// Simpan dulu bila ada perubahan sebelum pindah ke pekerjaan lain.
async function flushIfDirty(){
  if(activeProjectId&&ns.state?._projectDirty){
    clearTimeout(autoSaveTimer);
    await putProject(null,activeProjectId);
  }
}

async function renderProjectList(){
  const box=q('projectList');if(!box)return;
  try{
    const arr=await getAllProjects();
    if(!arr.length){
      box.innerHTML='<div class="project-empty">Belum ada pekerjaan yang disimpan.<br><small>Setelah klik SIMPAN, pekerjaan akan muncul di sini dengan nama sesuai bulan BKU.</small></div>';
      return;
    }
    const sorted=sortProjectsByMonth(arr);
    box.innerHTML=sorted.map(p=>{
      const count=p.state?.rows?.length||0;
      const file=safeEsc(p.file?.name||'BKU');
      const name=safeEsc(projectDisplayName(p));
      const when=new Date(p.updatedAt||0).toLocaleString('id-ID');
      const backend=p._fallback?'cadangan':'Supabase Cloud ☁️';
      const active=p.id===activeProjectId?' active':'';
      const emptyBadge=count===0?`<span style="display:inline-block; background:#f1f5f9; color:#475569; border:1px solid #cbd5e1; font-size:11px; font-weight:700; padding:2px 7px; border-radius:4px; margin-left:6px;">⚪ BKU Kosong</span>`:'';
      const countDesc=count===0?'0 transaksi (BKU Kosong)':`${count} transaksi`;
      return `<div class="project-item${active}"><div class="project-main"><b>📅 ${name}</b>${emptyBadge}<span>${file} • ${countDesc} • ${when} • ${backend}</span></div><div class="project-actions"><button type="button" class="btn project-open-btn" data-action="open" data-id="${safeEsc(p.id)}">Buka</button><button type="button" class="btn project-download-btn" data-action="download" data-id="${safeEsc(p.id)}">Cadangan</button><button type="button" class="btn project-delete-btn" data-action="delete" data-id="${safeEsc(p.id)}">Hapus</button></div></div>`;
    }).join('');

    box.querySelectorAll('button[data-action]').forEach(btn=>btn.addEventListener('click',async e=>{
      const action=e.currentTarget.dataset.action,id=e.currentTarget.dataset.id;
      try{
        if(action==='open'){await flushIfDirty();await loadProject(id);closeProjectDialog();}
        else if(action==='download')await downloadProject(id);
        else if(action==='delete'){
          const p=await getProject(id);
          if(!p || window.confirm(`Hapus pekerjaan "${p?projectDisplayName(p):id}" secara permanen?`)){
            await deleteProject(id);
            if(activeProjectId===id)detachActiveProject();
            await renderProjectList();
            renderSuratMonthNav();
          }
        }
      }catch(err){window.alert(normalizeError(err));}
    }));
  }catch(e){box.innerHTML=`<div class="project-empty error">${safeEsc(normalizeError(e))}</div>`}
}

// ===== Navigasi bulan pada tab Surat Perintah (di atas pratinjau) =====
const SHORT_MONTHS=['','Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des'];
function shortMonth(m){return SHORT_MONTHS[m]||getMonthName(m);}
let navBusy=false;
async function renderSuratMonthNav(){
  const box=q('suratMonthNav');if(!box)return;
  let arr=[];
  try{arr=sortProjectsByMonth(await getAllProjects());}catch(_){}
  const chips=arr.map(p=>{
    const isActive=p.id===activeProjectId;
    const info=detectMonthFromProject(p);
    const short=info.month!==999?shortMonth(info.month):projectDisplayName(p);
    return `<button type="button" class="sv-month-chip${isActive?' active':''}" data-id="${safeEsc(p.id)}" title="${safeEsc(projectDisplayName(p))}" aria-pressed="${isActive}">${safeEsc(short)}</button>`;
  });
  const hasRows=Array.isArray(ns.state?.rows)&&ns.state.rows.length>0;
  if(!activeProjectId&&hasRows){
    const cur=detectMonthFromProject({state:{rows:ns.state.rows,rawRows:ns.state.rawRows,identity:ns.state.identity},file:ns.state.file,name:''});
    const label=cur.month!==999?shortMonth(cur.month):'Baru';
    chips.push(`<span class="sv-month-chip unsaved" title="${safeEsc(autoProjectName()||'BKU baru')} — belum disimpan. Klik SIMPAN PEKERJAAN atau Simpan Data SPMU.">● ${safeEsc(label)}</span>`);
  }
  box.innerHTML=`<span class="sv-month-label">📅 Pekerjaan tersimpan</span><div class="sv-month-chips">${chips.length?chips.join(''):'<span class="sv-month-empty">Belum ada pekerjaan tersimpan.</span>'}</div>`;
  box.querySelectorAll('button[data-id]').forEach(btn=>btn.addEventListener('click',async e=>{
    const id=e.currentTarget.dataset.id;
    if(!id||id===activeProjectId||navBusy)return;
    navBusy=true;box.classList.add('busy');
    try{
      ns.readSuratFields?.();
      await flushIfDirty();
      await loadProject(id,{tab:'surat'});
    }catch(err){window.alert(normalizeError(err));}
    finally{navBusy=false;box.classList.remove('busy');renderSuratMonthNav();}
  }));
}

async function loadProject(id,opts){
  opts=opts||{};
  let p=await getProject(id);
  if(!p)throw new Error('Pekerjaan tidak ditemukan.');
  let blob=p.file?.blob;
  if(!blob&&p.file?.dataUrl)blob=await dataUrlToBlob(p.file.dataUrl,p.file.type);
  if(!blob)throw new Error('File BKU pada pekerjaan ini tidak ditemukan.');
  const s=p.state||{};
  ns.state.category=String(s.category||'');
  ns.state.file=new File([blob],p.file.name||'BKU',{type:p.file.type||blob.type||'application/octet-stream',lastModified:p.file.lastModified||Date.now()});
  ns.state.rows=Array.isArray(s.rows)?s.rows:[];
  ns.state.rawRows=Array.isArray(s.rawRows)?s.rawRows:[];
  ns.state.result=s.result||null;
  ns.state.identity=s.identity||{school:'',kecamatan:'',alamat:'',npsn:'',headName:'',headNip:'',treasurerName:'',treasurerNip:'',kabupaten:'',provinsi:''};
  ns.state.surat={...(ns.state.surat||{}),...(s.surat||{})};
  ns.applySavedProfile?.();
  ns.state.suratByBukti=(s.suratByBukti&&typeof s.suratByBukti==='object'&&!Array.isArray(s.suratByBukti))?s.suratByBukti:{};
  ns.state.search=String(s.search||'');
  activeProjectId=p.id;activeProjectName=p.name||'';
  if(q('searchRows'))q('searchRows').value=ns.state.search;
  if(q('categorySelect'))q('categorySelect').value=ns.state.category||'';
  if(q('status'))q('status').textContent=`Pekerjaan dibuka: ${p.name}.`;
  if(q('readBtn'))q('readBtn').disabled=!ns.state.file;
  if(ns.state.result&&ns.state.rows.length){
    ns.applyIdentityToSurat?.(ns.state.identity||{});
    ns.syncSurat?.();
    ns.enableSuratSection?.();
  }else ns.disableSuratSection?.();
  ns.syncSurat?.();
  ns.render?.();
  if(typeof ns.renderSurat==='function'&&ns.state.rows.length)ns.renderSurat();
  ns.renderTaxes?.();
  const ready=Boolean(ns.state.result&&ns.state.rows.length);
  if(opts.tab==='surat'&&ready){
    ns.setTab?.('surat');
    ns.refreshSuratSuggestions?.();
    ns.renderSurat?.();
  }else ns.setTab?.(opts.tab&&opts.tab!=='surat'?opts.tab:(s.activeTab||'bku'));
  markSaved(p,'Supabase Cloud ☁️');
  return p;
}

async function makePortableObject(p){
  let dataUrl=p.file?.dataUrl;
  if(!dataUrl&&p.file?.blob){
    const pseudoFile=new File([p.file.blob],p.file.name||'BKU',{type:p.file.type||'application/octet-stream',lastModified:p.file.lastModified||Date.now()});
    dataUrl=await fileToDataUrl(pseudoFile);
  }
  return {
    format:'SPMU_PROJECT',version:3,
    id:p.id,name:p.name,createdAt:p.createdAt,updatedAt:p.updatedAt,
    file:{name:p.file?.name||'BKU',type:p.file?.type||'',size:p.file?.size||0,lastModified:p.file?.lastModified||Date.now(),dataUrl},
    state:p.state||{}
  };
}
async function downloadProject(id){
  const p=await getProject(id);if(!p)throw new Error('Pekerjaan tidak ditemukan.');
  const portable=await makePortableObject(p);
  const blob=new Blob([JSON.stringify(portable)],{type:'application/json'});
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=(String(p.name||'SPMU_Pekerjaan').replace(/[\\/:*?"<>|]+/g,'_')||'SPMU_Pekerjaan')+'.spmu';document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),1000);
}

function closeProjectDialog(){const o=q('projectModal');if(o){o.classList.remove('show');o.setAttribute('aria-hidden','true')}}
function showProjectDialog(){
  const overlay=q('projectModal');if(!overlay)return;
  overlay.dataset.mode='open';overlay.classList.add('show');overlay.setAttribute('aria-hidden','false');
  const title=q('projectModalTitle');const subtitle=q('projectModalSubtitle');
  if(title)title.textContent='Buka Pekerjaan Tersimpan';
  if(subtitle)subtitle.textContent='Pekerjaan diberi nama otomatis sesuai bulan BKU dan tersimpan di Supabase Cloud.';
  renderProjectList();
}

function detachActiveProject(){
  activeProjectId=null;activeProjectName='';clearTimeout(autoSaveTimer);
  if(ns.state)ns.state._projectDirty=false;
  setText('projectSaveName','Pekerjaan baru belum disimpan.');
  setSaveStatus('Pekerjaan baru — belum disimpan.','warn');
  renderSuratMonthNav();
}

async function importProjectFile(file){
  if(!file) throw new Error('Pilih file .spmu terlebih dahulu.');
  const text = await file.text();
  const p = JSON.parse(text);
  if(p.format !== 'SPMU_PROJECT' || !p.file?.dataUrl) throw new Error('File .spmu tidak valid.');
  const blob = await dataUrlToBlob(p.file.dataUrl, p.file.type);
  const payload = {
    id: p.id || ('p_' + Date.now()),
    name: projectDisplayName({state:p.state,file:p.file,name:p.name}) || 'Pekerjaan BKU',
    createdAt: p.createdAt || Date.now(),
    updatedAt: Date.now(),
    version: 3,
    file: { name: p.file.name || 'BKU', type: p.file.type || '', size: p.file.size || blob.size, lastModified: p.file.lastModified || Date.now(), blob },
    state: p.state || {}
  };
  await writeProject(payload);
  activeProjectId = payload.id;
  activeProjectName = payload.name;
  markSaved(payload, 'Supabase Cloud ☁️');
  await loadProject(payload.id);
  ns.renderDashboard?.();
  return payload;
}

async function initProjectStore(){
  const close=q('projectModalClose');if(close)close.addEventListener('click',closeProjectDialog);
  const cancel=q('projectCancelBtn');if(cancel)cancel.addEventListener('click',closeProjectDialog);
  const saveTrigger=q('saveProjectBtn');if(saveTrigger)saveTrigger.addEventListener('click',async()=>{
    if(!ns.state?.file){window.alert('Pilih/upload file BKU terlebih dahulu.');return}
    try{
      saveTrigger.disabled=true;
      const p=await saveCurrentAuto();
      if(p)setSaveStatus(`✓ TERSIMPAN sebagai "${p.name}" • ${new Date(p.updatedAt).toLocaleTimeString('id-ID')}`,'ok');
    }catch(e){window.alert(normalizeError(e));}
    finally{saveTrigger.disabled=false}
  });
  const openTrigger=q('openProjectBtn');if(openTrigger)openTrigger.addEventListener('click',()=>showProjectDialog());
  const overlay=q('projectModal');if(overlay)overlay.addEventListener('click',e=>{if(e.target===overlay)closeProjectDialog()});
    const backupInput = q('projectImportInput');
  if(backupInput) backupInput.addEventListener('change', async e => {
    try {
      await importProjectFile(e.target.files?.[0]);
      showProjectDialog();
    } catch(err) {
      window.alert(normalizeError(err));
    } finally {
      e.target.value = '';
    }
  });
  const backupButton = q('projectImportBtn');
  if(backupButton) backupButton.addEventListener('click', () => backupInput?.click());
  document.addEventListener('keydown',e=>{if(e.key==='Escape')closeProjectDialog()});

  q('tabSuratBtn')?.addEventListener('click',()=>renderSuratMonthNav());
  await renderProjectList();
  renderSuratMonthNav();
  ns.renderDashboard?.();
}

Object.assign(ns,{
  initProjectStore,showProjectDialog,closeProjectDialog,loadProject,sortProjectsByMonth,detectMonthFromProject,projectDisplayName,autoProjectName,getMonthName,
  saveCurrentFromUi,saveActiveProjectNow:saveCurrentAuto,saveActiveProject,renderSuratMonthNav,
  markProjectDirty:markDirty,scheduleProjectAutoSave:scheduleAutoSave,
  getActiveProjectId:()=>activeProjectId,getAllProjects,getProject,deleteProject,detachActiveProject
});
})(window.SPMU=window.SPMU||{});