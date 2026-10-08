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

function detectMonthFromProject(p){
  if(!p) return { month: 999, monthName: 'Lainnya' };
  const s = p.state || {};
  const ident = s.identity || {};

  const identFields = [ident.bulan, ident.periode, ident.periodeBulan, ident.month, ident.namaBulan];
  for(const f of identFields){
    const m = detectMonthFromText(f);
    if(m > 0) return { month: m, monthName: getMonthName(m) };
  }

  const fileMonth = detectMonthFromText(p.file?.name);
  if(fileMonth > 0) return { month: fileMonth, monthName: getMonthName(fileMonth) };

  const nameMonth = detectMonthFromText(p.name);
  if(nameMonth > 0) return { month: nameMonth, monthName: getMonthName(nameMonth) };

  const rows = Array.isArray(s.rows) && s.rows.length ? s.rows : (Array.isArray(s.rawRows) ? s.rawRows : []);
  if(rows && rows.length){
    for(const r of rows){
      const tgl = String(r.tanggal || r.tgl || r.date || '');
      const tm = detectMonthFromText(tgl);
      if(tm > 0) return { month: tm, monthName: getMonthName(tm) };

      const m1 = tgl.match(/\b\d{4}[-/](\d{1,2})[-/]\d{1,2}\b/);
      if(m1){
        const mon = parseInt(m1[1], 10);
        if(mon >= 1 && mon <= 12) return { month: mon, monthName: getMonthName(mon) };
      }
      const m2 = tgl.match(/\b\d{1,2}[-/](\d{1,2})[-/]\d{2,4}\b/);
      if(m2){
        const mon = parseInt(m2[1], 10);
        if(mon >= 1 && mon <= 12) return { month: mon, monthName: getMonthName(mon) };
      }
    }
  }

  return { month: 999, monthName: 'Lainnya' };
}

function sortProjectsByMonth(arr){
  return [...(arr || [])].sort((a, b) => {
    const mA = detectMonthFromProject(a);
    const mB = detectMonthFromProject(b);
    if(mA.month !== mB.month) return mA.month - mB.month;
    return Number(a.createdAt || 0) - Number(b.createdAt || 0);
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
  return JSON.parse(JSON.stringify(state));
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
    name:String(name||baseName()).trim()||'Pekerjaan BKU',
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

async function saveCurrentFromUi(name){
  const p=await putProject(name||baseName(),activeProjectId);
  closeProjectDialog();
  await renderProjectList();
  return p;
}

async function renderProjectList(){
  const box=q('projectList');if(!box)return;
  try{
    const arr=await getAllProjects();
    if(!arr.length){
      box.innerHTML='<div class="project-empty">Belum ada pekerjaan yang disimpan.<br><small>Setelah klik SIMPAN, pekerjaan akan muncul di sini.</small></div>';
      return;
    }

    const sorted = sortProjectsByMonth(arr);

    const headerHtml = `
      <div class="open-all-projects-box" style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px; padding:12px 14px; background:#eff6ff; border:1px solid #bfdbfe; border-radius:8px;">
        <div>
          <b style="color:#1d4ed8; font-size:14px;">📂 Buka Semua Pekerjaan (${sorted.length} File)</b>
          <div style="font-size:12px; color:#475569; margin-top:3px;">Otomatis diurutkan berurutan per <b>Bulan BKU</b>.</div>
        </div>
        <button type="button" class="btn btn-primary" id="openAllProjectsBtn" style="background:#2563eb; color:#fff; font-weight:700; padding:8px 16px; border:none; border-radius:6px; cursor:pointer;">
          Buka Semua
        </button>
      </div>
    `;

    const itemsHtml = sorted.map(p=>{
      const count=p.state?.rows?.length||0;
      const file=safeEsc(p.file?.name||'BKU');
      const name=safeEsc(p.name||'Tanpa nama');
      const when=new Date(p.updatedAt||0).toLocaleString('id-ID');
      const backend=p._fallback?'cadangan':'Supabase Cloud ☁️';
      const active=p.id===activeProjectId?' active':'';
      const mInfo=detectMonthFromProject(p);
      const monthBadge=`<span style="display:inline-block; background:#e0f2fe; color:#0369a1; border:1px solid #bae6fd; font-size:11px; font-weight:600; padding:2px 7px; border-radius:4px; margin-left:6px;">📅 ${safeEsc(mInfo.monthName)}</span>`;
      const emptyBadge=count===0?`<span style="display:inline-block; background:#f1f5f9; color:#475569; border:1px solid #cbd5e1; font-size:11px; font-weight:700; padding:2px 7px; border-radius:4px; margin-left:6px;">⚪ BKU Kosong</span>`:'';
      const countDesc=count===0?'0 transaksi (BKU Kosong) &bull; Sah Masuk Pekerjaan':`${count} transaksi`;
      return `<div class="project-item${active}"><div class="project-main"><b>${name}</b>${monthBadge}${emptyBadge}<span>${file} • ${countDesc} • ${when} • ${backend}</span></div><div class="project-actions"><button type="button" class="btn project-open-btn" data-action="open" data-id="${safeEsc(p.id)}">Buka</button><button type="button" class="btn project-download-btn" data-action="download" data-id="${safeEsc(p.id)}">Cadangan</button><button type="button" class="btn project-delete-btn" data-action="delete" data-id="${safeEsc(p.id)}">Hapus</button></div></div>`;
    }).join('');

    box.innerHTML = headerHtml + itemsHtml;

    const openAllBtn = q('openAllProjectsBtn');
    if(openAllBtn){
      openAllBtn.addEventListener('click', async()=>{
        try{
          openAllBtn.disabled = true;
          openAllBtn.textContent = 'Memproses...';
          await loadAllProjects();
        }catch(err){
          window.alert(normalizeError(err));
        }finally{
          openAllBtn.disabled = false;
          openAllBtn.textContent = 'Buka Semua';
        }
      });
    }

    box.querySelectorAll('button[data-action]').forEach(btn=>btn.addEventListener('click',async e=>{
      const action=e.currentTarget.dataset.action,id=e.currentTarget.dataset.id;
      try{
        if(action==='open'){await loadProject(id);closeProjectDialog();}
        else if(action==='download')await downloadProject(id);
        else if(action==='delete'){
          const p=await getProject(id);
          if(!p || window.confirm(`Hapus pekerjaan "${p.name||id}" secara permanen?`)){
            await deleteProject(id);
            if(activeProjectId===id)detachActiveProject();
            await renderProjectList();
          }
        }
      }catch(err){window.alert(normalizeError(err));}
    }));
  }catch(e){box.innerHTML=`<div class="project-empty error">${safeEsc(normalizeError(e))}</div>`}
}

async function loadProject(id){
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
  ns.setTab?.(s.activeTab||'bku');
  markSaved(p,'Supabase Cloud ☁️');
  return p;
}

async function loadAllProjects(){
  const all = await getAllProjects();
  if(!all.length){ window.alert('Belum ada pekerjaan tersimpan.'); return; }
  const fullProjects = [];
  for(const item of all){
    const full = await getProject(item.id);
    if(full) fullProjects.push(full);
  }
  if(!fullProjects.length) throw new Error('Tidak dapat memuat detail pekerjaan.');

  const sorted = sortProjectsByMonth(fullProjects);
  let combinedRows = [];
  let combinedRawRows = [];
  let combinedSuratByBukti = {};
  let totalBlocks = 0;
  let totalPages = 0;
  let sampleBlob = null;
  let sampleFileType = '';
  const monthNames = [];

  for(const p of sorted){
    const s = p.state || {};
    const pRows = Array.isArray(s.rows) ? s.rows : [];
    const pRawRows = Array.isArray(s.rawRows) ? s.rawRows : [];
    const mInfo = detectMonthFromProject(p);
    monthNames.push(mInfo.monthName);

    pRows.forEach(r => { if(!r.bulanBku) r.bulanBku = mInfo.monthName; });
    combinedRows = combinedRows.concat(pRows);
    combinedRawRows = combinedRawRows.concat(pRawRows);

    if(s.suratByBukti && typeof s.suratByBukti === 'object') Object.assign(combinedSuratByBukti, s.suratByBukti);
    if(s.result?.blocks) totalBlocks += Number(s.result.blocks) || 0;
    if(s.result?.pages) totalPages += Number(s.result.pages) || 0;

    let b = p.file?.blob;
    if(!b && p.file?.dataUrl) b = await dataUrlToBlob(p.file.dataUrl, p.file.type);
    if(b && !sampleBlob){ sampleBlob = b; sampleFileType = p.file?.type || b.type; }
  }

  const uniqueMonths = monthNames.filter((v, i, a) => a.indexOf(v) === i).join(', ');
  const baseIdentity = { ...(sorted[0].state?.identity || {}) };
  baseIdentity.bulan = uniqueMonths;
  baseIdentity.periode = uniqueMonths;

  const combinedResult = { rows: combinedRows, declaredTotal: null, excludedIncome: null, pages: totalPages || sorted.length, blocks: combinedRows.length };
  const combinedTitle = `Semua Pekerjaan (${sorted.length} Bulan: ${uniqueMonths})`;

  ns.state.category = '';
  if(sampleBlob){
    ns.state.file = new File([sampleBlob], combinedTitle + '.bku', { type: sampleFileType || 'application/octet-stream', lastModified: Date.now() });
  } else {
    ns.state.file = new File([new Blob(['BKU Gabungan'])], combinedTitle + '.bku', { type: 'text/plain', lastModified: Date.now() });
  }

  ns.state.rows = combinedRows;
  ns.state.rawRows = combinedRawRows;
  ns.state.result = combinedResult;
  ns.state.identity = baseIdentity;
  ns.state.suratByBukti = combinedSuratByBukti;
  ns.state.search = '';

  activeProjectId = 'all_' + Date.now();
  activeProjectName = combinedTitle;

  if(q('status')) q('status').textContent = `Berhasil membuka ${sorted.length} pekerjaan berurutan (${uniqueMonths}). Total ${combinedRows.length} transaksi.`;
  if(q('readBtn')) q('readBtn').disabled = false;
  if(ns.state.result && ns.state.rows.length){
    ns.applyIdentityToSurat?.(ns.state.identity || {});
    ns.syncSurat?.();
    ns.enableSuratSection?.();
  }
  ns.render?.();
  if(typeof ns.renderSurat === 'function' && ns.state.rows.length) ns.renderSurat();
  ns.renderTaxes?.();
  ns.setTab?.('bku');
  setText('projectSaveName', `Pekerjaan aktif: ${combinedTitle}`);
  setSaveStatus(`✓ DIBUKA: ${sorted.length} PEKERJAAN BERURUTAN (${uniqueMonths})`, 'ok');
  closeProjectDialog();
  return { count: sorted.length, rows: combinedRows.length };
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
function showProjectDialog(mode){
  const overlay=q('projectModal');if(!overlay)return;
  overlay.dataset.mode=mode||'open';overlay.classList.add('show');overlay.setAttribute('aria-hidden','false');
  const saveBox=q('projectSaveBox');
  const title=q('projectModalTitle');const subtitle=q('projectModalSubtitle');
  if(mode==='save'){
    title.textContent=activeProjectId?'Simpan Perubahan Pekerjaan':'Simpan Pekerjaan BKU';
    subtitle.textContent='Klik SIMPAN untuk menulis file BKU + seluruh hasil kerja ke Supabase Cloud.';
    if(saveBox)saveBox.style.display='block';
    const input=q('projectNameInput');if(input){input.value=activeProjectName||baseName();input.focus();input.select()}
  }else{
    title.textContent='Buka Pekerjaan Tersimpan';
    subtitle.textContent='Pekerjaan yang tersimpan di Supabase Cloud akan tampil di bawah.';
    if(saveBox)saveBox.style.display='none';
  }
  renderProjectList();
}

function detachActiveProject(){
  activeProjectId=null;activeProjectName='';clearTimeout(autoSaveTimer);
  if(ns.state)ns.state._projectDirty=false;
  setText('projectSaveName','Pekerjaan baru belum disimpan.');
  setSaveStatus('Pekerjaan baru — belum disimpan.','warn');
}

async function importProjectFile(file){
  if(!file) throw new Error('Pilih file .spmu terlebih dahulu.');
  const text = await file.text();
  const p = JSON.parse(text);
  if(p.format !== 'SPMU_PROJECT' || !p.file?.dataUrl) throw new Error('File .spmu tidak valid.');
  const blob = await dataUrlToBlob(p.file.dataUrl, p.file.type);
  const payload = {
    id: p.id || ('p_' + Date.now()),
    name: p.name || 'Pekerjaan BKU',
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
  const saveBtn=q('projectConfirmSaveBtn');
  if(saveBtn)saveBtn.addEventListener('click',async()=>{
    const input=q('projectNameInput');
    try{
      saveBtn.disabled=true;await putProject(String(input?.value||'').trim()||baseName(),activeProjectId);
      await renderProjectList();
      closeProjectDialog();
    }catch(e){window.alert(normalizeError(e));}
    finally{saveBtn.disabled=false}
  });
  const saveTrigger=q('saveProjectBtn');if(saveTrigger)saveTrigger.addEventListener('click',()=>{
    if(!ns.state?.file){window.alert('Pilih/upload file BKU terlebih dahulu.');return}
    showProjectDialog('save');
  });
  const openTrigger=q('openProjectBtn');if(openTrigger)openTrigger.addEventListener('click',()=>showProjectDialog('open'));
  const overlay=q('projectModal');if(overlay)overlay.addEventListener('click',e=>{if(e.target===overlay)closeProjectDialog()});
    const backupInput = q('projectImportInput');
  if(backupInput) backupInput.addEventListener('change', async e => {
    try {
      await importProjectFile(e.target.files?.[0]);
      showProjectDialog('open');
    } catch(err) {
      window.alert(normalizeError(err));
    } finally {
      e.target.value = '';
    }
  });
  const backupButton = q('projectImportBtn');
  if(backupButton) backupButton.addEventListener('click', () => backupInput?.click());
  document.addEventListener('keydown',e=>{if(e.key==='Escape')closeProjectDialog()});

  await renderProjectList();
  ns.renderDashboard?.();
}

Object.assign(ns,{
  initProjectStore,showProjectDialog,closeProjectDialog,loadProject,loadAllProjects,sortProjectsByMonth,detectMonthFromProject,saveCurrentFromUi,saveActiveProject,
  markProjectDirty:markDirty,scheduleProjectAutoSave:scheduleAutoSave,
  getActiveProjectId:()=>activeProjectId,getAllProjects,getProject,deleteProject,detachActiveProject
});
})(window.SPMU=window.SPMU||{});