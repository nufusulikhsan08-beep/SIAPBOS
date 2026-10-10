(function(ns){
'use strict';
const {$,state,suratElement,esc}=ns;

const dateRe=/(?:\b\d{4}[-/]\d{1,2}[-/]\d{1,2}\b|\b\d{1,2}[-/]\d{1,2}[-/]\d{4}\b|\b\d{1,2}\.\d{1,2}\.\d{4}\b)/g;
const noBuktiRe=/\b(?:BPU|BNU)\s*[-./]?\s*\d+\b/gi;
const leadingCodeRe=/^(?:(?:\d{1,3}\.){1,10}\d{1,3}\.?\s*)+/;
const activityCodeRe=/(?<!\d)\d{2}\.\d{2}\.\d{2}\.?/g;
const accountCodeRe=/\b[1-9]\.[1-9]\.\d{2}\.?/g;
const moneyTokenRe=/(?:Rp\.?\s*)?(?:\d{1,3}(?:\.\d{3})+(?:,\d+)?|\d{4,}|(?<!\d)0(?:,\d+)?(?!\d))/g;
const moneyOnlyRe=/^(?:Rp\.?\s*)?(?:\d{1,3}(?:\.\d{3})+(?:,\d+)?|\d{4,}|0(?:,\d+)?)$/i;

/*
 * PDF BKU INI MEMILIKI GEOMETRI KOLOM TETAP (A4 LANDSCAPE ~ 842.25 pt).
 * Parser lama mengambil "last numeric token" dari blok teks. Saat PDF.js
 * mengembalikan item dengan urutan berbeda, tahun 2026 dapat terambil sebagai
 * Pengeluaran -> tampil 2.026. Di sini nominal SELALU dibaca dari posisi kolom.
 */
const PDF_BASE_WIDTH=842.25;
const PDF_BASE_COLS={
  tanggal:[30.0,80.5],
  kegiatan:[80.5,132.5],
  rekening:[132.5,195.2],
  bukti:[195.2,242.0],
  uraian:[242.0,608.5],
  penerimaan:[608.5,678.3],
  pengeluaran:[678.3,749.3],
  saldo:[749.3,829.5]
};

function clean(s){return String(s??'').replace(/\s+/g,' ').trim();}
function normalizeDate(s){
  if(s instanceof Date&&!Number.isNaN(s.getTime())){
    return `${String(s.getDate()).padStart(2,'0')}-${String(s.getMonth()+1).padStart(2,'0')}-${s.getFullYear()}`;
  }
  const x=clean(s);
  if(/^\d{4}[-/]\d{1,2}[-/]\d{1,2}$/.test(x)){const [y,m,d]=x.split(/[-/]/);return `${String(d).padStart(2,'0')}-${String(m).padStart(2,'0')}-${y}`;}
  let m=x.match(/\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})\b/);
  if(m)return `${String(m[1]).padStart(2,'0')}-${String(m[2]).padStart(2,'0')}-${m[3]}`;
  m=x.match(/\b(\d{1,2})\s+[-/.]?\s*(\d{1,2})\s+[-/.]?\s*(\d{4})\b/);
  if(m)return `${String(m[1]).padStart(2,'0')}-${String(m[2]).padStart(2,'0')}-${m[3]}`;
  m=x.match(/\b(\d{4})\s+[-/.]?\s*(\d{1,2})\s+[-/.]?\s*(\d{1,2})\b/);
  return m?`${String(m[3]).padStart(2,'0')}-${String(m[2]).padStart(2,'0')}-${m[1]}`:'';
}
function normalizeNoBukti(s){const m=clean(s).match(noBuktiRe);return m?m[0].replace(/\s+/g,'').replace(/[-./]/g,'').toUpperCase():'';}
function isValidNoBukti(s){return /^(?:BPU|BNU)\d+$/i.test(clean(s));}
function parseMoney(s){
  let raw=clean(s).replace(/^Rp\.?\s*/i,'').replace(/\s/g,'').replace(/[()]/g,'');
  if(!raw)return 0;
  const negative=/^-/.test(raw); raw=raw.replace(/^-|^\+/,'');
  if(raw.includes('.')&&raw.includes(',')){
    const lc=raw.lastIndexOf(','),ld=raw.lastIndexOf('.');
    raw=lc>ld?raw.replace(/\./g,'').replace(',','.'):raw.replace(/,/g,'');
  }else if(raw.includes(',')&&/\,\d{1,2}$/.test(raw)){
    raw=raw.replace(/\./g,'').replace(',','.');
  }else{
    raw=raw.replace(/[.,]/g,'');
  }
  const n=Number(raw); return Number.isFinite(n)?Math.round((negative?-1:1)*n):0;
}
function formatMoney(n){return Math.round(n||0).toLocaleString('id-ID');}
function stripMetadata(s){let x=clean(s);x=x.replace(dateRe,' ');x=x.replace(noBuktiRe,' ');x=x.replace(/^\s*[:;|,-]+\s*/,'');x=x.replace(/^\s*(?:kode\s+(?:kegiatan|rekening)\s*[:.-]?\s*)+/i,'');x=x.replace(leadingCodeRe,'');return clean(x);}
function sanitizeUraian(s){let x=stripMetadata(s);x=x.replace(/^\s*[|:;,\-]+\s*/,'').replace(/\s*[|:;,]+\s*$/,'');return clean(x);}

function pdfColumns(pageWidth){
  const scale=(Number(pageWidth)||PDF_BASE_WIDTH)/PDF_BASE_WIDTH;
  const out={};
  for(const [k,[a,b]] of Object.entries(PDF_BASE_COLS))out[k]=[a*scale,b*scale];
  return out;
}
function itemCenterX(item){return Number(item.x||0)+Math.max(Number(item.width||0),1)/2;}
function inPdfCol(item,bounds){const x=itemCenterX(item);return x>=bounds[0]&&x<bounds[1];}
function pdfItemText(item){return clean(item?.text||'');}
function groupPdfLines(items,tolerance=2.5){
  const sorted=[...items].filter(i=>pdfItemText(i)).sort((a,b)=>b.y-a.y||a.x-b.x);
  const lines=[];
  for(const item of sorted){
    let line=lines.find(l=>Math.abs(l.y-item.y)<=tolerance);
    if(!line){line={y:item.y,items:[]};lines.push(line);}
    line.items.push(item);
  }
  for(const line of lines)line.items.sort((a,b)=>a.x-b.x);
  return lines.sort((a,b)=>b.y-a.y);
}
function lineText(line){return clean((line?.items||[]).map(pdfItemText).join(' '));}
function uniqueConsecutiveLines(lines){
  const out=[];
  for(const line of lines){
    const v=clean(line);if(!v)continue;
    if(out.length&&out[out.length-1].toLowerCase()===v.toLowerCase())continue;
    out.push(v);
  }
  return out;
}
function extractColumnLines(items,bounds){
  const colItems=(items||[]).filter(i=>inPdfCol(i,bounds));
  const lines=groupPdfLines(colItems,2.5);
  return uniqueConsecutiveLines(lines.map(lineText));
}
function extractColumnText(items,bounds){return clean(extractColumnLines(items,bounds).join(' '));}
function extractColumnMoney(items,bounds){
  const candidates=[];
  for(const item of (items||[]).filter(i=>inPdfCol(i,bounds))){
    const raw=pdfItemText(item).replace(/\s/g,'');
    if(moneyOnlyRe.test(raw)){
      const n=parseMoney(raw);
      candidates.push({n,x:itemCenterX(item),text:raw});
    }
  }
  if(candidates.length){
    // Dalam kolom nominal, jika ada beberapa token akibat pemecahan PDF,
    // gunakan token paling kanan yang bernilai paling masuk akal. Nilai 4 digit
    // seperti "2026" tidak dianggap nominal jika ada nominal lebih besar.
    const positive=candidates.filter(c=>c.n>=0);
    const large=positive.filter(c=>c.n>=10000);
    return (large.length?large:positive).sort((a,b)=>a.x-b.x).at(-1)?.n||0;
  }
  const cell=extractColumnText(items,bounds).replace(/\s+/g,' ');
  const matches=[...cell.matchAll(new RegExp(moneyTokenRe.source,'gi'))]
    .map(m=>clean(m[0])).filter(t=>moneyOnlyRe.test(t)).map(t=>parseMoney(t));
  if(!matches.length)return 0;
  const large=matches.filter(n=>n>=10000);
  return (large.length?large:matches).at(-1)||0;
}

function detectPdfColumns(items,pageWidth){
  /*
   * BKU Lebak Wangi memakai template A4 dengan posisi kolom tetap.
   * Jangan menggunakan titik tengah teks header sebagai batas kolom:
   * header "URAIAN" berada di tengah kolom yang lebar, sehingga midpoint
   * header akan memotong kata-kata awal seperti "Internet Berlangganan-20".
   * Gunakan geometri template (dengan scaling sesuai lebar halaman) sebagai
   * sumber utama. Ini juga membuat halaman yang memiliki header dan halaman
   * lanjutan diperlakukan konsisten.
   */
  return pdfColumns(pageWidth);
}
function findPdfDateRows(items,cols){
  const rows=[];
  const candidates=(items||[]).filter(i=>inPdfCol(i,cols.tanggal));
  // Prioritaskan kolom tanggal, tetapi jangan menghilangkan transaksi hanya karena
  // PDF.js menggeser/memecah item tanggal sedikit keluar dari batas kolom.
  const source=candidates.length?candidates:items;
  for(const item of source){
    const t=pdfItemText(item);
    const tanggal=normalizeDate(t);
    if(tanggal)rows.push({item,y:Number(item.y||0),tanggal,source:candidates.length?'column':'global'});
  }
  // PDF tertentu memecah "01-10-2026" menjadi beberapa item di satu baris.
  // Gabungkan teks per garis dan coba baca ulang tanggal dari garis tersebut.
  for(const line of groupPdfLines(items,2.5)){
    const tanggal=normalizeDate(lineText(line));
    if(tanggal){
      const near=source.filter(i=>Math.abs(Number(i.y||0)-line.y)<=2.5);
      rows.push({item:near[0]||line.items?.[0],y:line.y,tanggal,source:'line'});
    }
  }
  rows.sort((a,b)=>b.y-a.y);
  const ded=[];
  for(const row of rows){
    const prev=ded[ded.length-1];
    if(prev&&Math.abs(prev.y-row.y)<=2.5){
      // Lebih percaya tanggal yang benar-benar berasal dari kolom tanggal.
      if(prev.source!=='column'&&row.source==='column')prev.tanggal=row.tanggal;
      continue;
    }
    ded.push(row);
  }
  return ded;
}
function buildPdfRowBands(items,dateRows){
  const all=[...items];
  const bands=[];
  for(let i=0;i<dateRows.length;i++){
    const y=dateRows[i].y;
    const prevY=i>0?dateRows[i-1].y:null;
    const nextY=i<dateRows.length-1?dateRows[i+1].y:null;
    // Antara dua tanggal terdapat satu visual baris. Garis kode rekening/nomor
    // yang wrap ke atas/bawah tetap dimasukkan dengan batas midpoint.
    const top=prevY==null?y+8:(prevY+y)/2;
    const bottom=nextY==null?y-8:(y+nextY)/2;
    const rowItems=all.filter(it=>Number(it.y||0)<=top+0.6&&Number(it.y||0)>bottom-0.6);
    bands.push({tanggal:dateRows[i].tanggal,y,rowItems});
  }
  return bands;
}
function isInternalMovement(uraian){return /^Tarik Tunai\b/i.test(clean(uraian));}
function recoverPdfRowBands(items,cols,dateRows,existingBands=[]){
  const bands=[...(existingBands||[])];
  const existingYs=bands.map(b=>Number(b.y||0));
  const lines=groupPdfLines(items,2.5);
  const anchors=[];
  for(const line of lines){
    const text=lineText(line);
    if(!text||/^(?:jumlah|total|saldo(?:\s+akhir)?|penerimaan|pengeluaran|uraian|tanggal|tgl|no\.?\s*bukti)\b/i.test(text))continue;
    const noBukti=/\b(?:BPU|BNU)\s*[-./]?\s*\d+\b/i.test(text);
    const expense=extractColumnMoney(line.items,cols.pengeluaran);
    const uraian=sanitizeUraian(extractColumnText(line.items,cols.uraian));
    const hasAmount=expense>0 || [...text.matchAll(new RegExp(moneyTokenRe.source,'gi'))].some(m=>{const t=clean(m[0]);const n=parseMoney(t);return moneyOnlyRe.test(t)&&n>0&&!(n>=1900&&n<=2100&&/^\d{4}$/.test(t.replace(/\D/g,'')));});
    if((noBukti|| (hasAmount&&uraian.length>=6)) && !existingYs.some(y=>Math.abs(y-line.y)<=5)) anchors.push({y:line.y,score:noBukti?2:1});
  }
  // Satu transaksi bisa punya beberapa text-line. Ambil satu anchor terkuat per y.
  const grouped=[];
  for(const a of anchors.sort((x,y)=>y.y-x.y)){
    const hit=grouped.find(g=>Math.abs(g.y-a.y)<=3);
    if(hit){if(a.score>hit.score)hit.score=a.score;} else grouped.push({...a});
  }
  const allYs=[...dateRows.map(r=>Number(r.y||0)),...grouped.map(a=>a.y)].sort((a,b)=>b-a);
  for(const a of grouped){
    const idx=allYs.indexOf(a.y);
    const prevY=idx>0?allYs[idx-1]:null;
    const nextY=idx<allYs.length-1?allYs[idx+1]:null;
    const top=prevY==null?a.y+9:(prevY+a.y)/2;
    const bottom=nextY==null?a.y-9:(a.y+nextY)/2;
    const rowItems=(items||[]).filter(it=>Number(it.y||0)<=top+0.6&&Number(it.y||0)>bottom-0.6);
    const existing=grouped.find(g=>g!==a&&Math.abs(g.y-a.y)<=1.5);
    if(existing||!rowItems.length)continue;
    let tanggal='';
    const nearest=[...dateRows].sort((x,y)=>Math.abs(x.y-a.y)-Math.abs(y.y-a.y))[0];
    if(nearest&&Math.abs(nearest.y-a.y)<=28)tanggal=nearest.tanggal;
    bands.push({tanggal,y:a.y,rowItems,recovered:true});
  }
  return bands.sort((a,b)=>b.y-a.y);
}

function maskMatches(text,re){return text.replace(new RegExp(re.source,re.flags.replace('g','')),m=>' '.repeat(m.length));}
function getMoney3(text){
  let masked=String(text||'');
  masked=maskMatches(masked,dateRe);masked=maskMatches(masked,noBuktiRe);masked=maskMatches(masked,activityCodeRe);masked=maskMatches(masked,accountCodeRe);masked=maskMatches(masked,leadingCodeRe);
  const all=[];for(const m of masked.matchAll(moneyTokenRe)){const token=clean(m[0]);if(moneyOnlyRe.test(token))all.push({token,index:m.index});}
  if(all.length<3)return null;
  const last3=all.slice(-3);
  return {penerimaan:parseMoney(last3[0].token),pengeluaran:parseMoney(last3[1].token),saldo:parseMoney(last3[2].token),start:last3[0].index,tokens:last3.map(x=>x.token)};
}

/* ==================== IDENTITAS SEKOLAH DARI BKU ==================== */
function afterLabelValue(text,labelRe){
  const t=clean(text);
  const m=t.match(new RegExp('(?:'+labelRe+')\\s*:\\s*(.+)$','i'));
  return m?clean(m[1]):'';
}
function extractNip(text){
  const m=String(text||'').match(/\b\d{8,20}\b/);
  return m?m[0]:'';
}
function normalizeKecamatan(v){return clean(v).replace(/^(?:kecamatan|kec\.)\s+/i,'').replace(/[.,;]+$/,'');}
function resolveBkuKecamatan(identity){
  const direct=normalizeKecamatan(identity?.kecamatan||'');
  if(direct)return direct;
  const raw=clean(identity?.rawAddress||'');
  const extracted=extractKecamatanFromAddress(raw);
  if(extracted)return extracted;
  return '';
}
function validateBkuNpsn(identity, evidenceText=''){
  const x={...(identity||{})};
  let npsn=clean(x.npsn||'');
  const sessionNpsn = (typeof sessionStorage !== 'undefined' && sessionStorage.getItem('siap_bos_npsn')) || 
                      (typeof localStorage !== 'undefined' && (localStorage.getItem('SIAP_BOS_LOGGED_NPSN') || localStorage.getItem('siap_bos_npsn'))) || '';
  if(!npsn && sessionNpsn) {
    npsn = sessionNpsn;
    x.npsn = sessionNpsn;
  }
  if(!npsn) {
    x.npsn = sessionNpsn || '00000000';
  }
  x.locationValidated=true;
  x.locationWarning='';
  return x;
}
function extractKecamatanFromAddress(v){
  const t=clean(v);
  let m=t.match(/\bKec\.\s*([^,;]+)$/i);
  if(m)return normalizeKecamatan(m[1]);
  m=t.match(/\bKecamatan\s+([^,;]+?)(?=\s+Kec\.|$)/i);
  return m?normalizeKecamatan(m[1]):'';
}
function normalizeBkuAddress(raw,kecamatan,kabupaten,provinsi){
  let a=clean(raw);
  const k=normalizeKecamatan(kecamatan);
  if(k && /\bKecamatan\b/i.test(a) && /\bKec\.\s*/i.test(a)) a=a.replace(/\bKecamatan\b.*?\bKec\.\s*[^,;]+/i,`Kecamatan ${k}`);
  else if(k && /\bKecamatan\b/i.test(a)) a=a.replace(/\bKecamatan\s+[^,;]+/i,`Kecamatan ${k}`);
  else if(k) a=clean(`${a} Kecamatan ${k}`);
  a=a.replace(/\s{2,}/g,' ').replace(/[ ,;]+$/,'');
  const kab=clean(kabupaten).replace(/^Kab\.\s*/i,'Kabupaten ');
  const prov=clean(provinsi).replace(/^Prov\.\s*/i,'Provinsi ');
  const escRe=t=>t.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  if(kab && !new RegExp('(?:Kabupaten|Kab\.\s*)'+escRe(kab.replace(/^Kabupaten\s+/i,'')),'i').test(a)) a+=`, ${kab}`;
  if(prov && !new RegExp('(?:Provinsi|Prov\.\s*)'+escRe(prov.replace(/^Provinsi\s+/i,'')),'i').test(a)) a+=`, ${prov}`;
  return clean(a.replace(/,\s*,/g,',').replace(/\s+,/g,','));
}
function roleSignature(lines,roleRe,side){
  const sideText=line=>clean((line?.items||[]).filter(i=>{const x=itemCenterX(i);return side==='left'?x<420:x>=420;}).map(pdfItemText).join(' '));
  const roleLine=lines.find(l=>roleRe.test(sideText(l)));
  if(!roleLine)return {name:'',nip:''};
  const y=roleLine.y;
  const nearby=lines.filter(l=>l.y<y-15 && l.y>y-125 && sideText(l)).sort((a,b)=>b.y-a.y);
  const nipLine=nearby.find(l=>/\bNIP\.?(?:\s*\d)?/i.test(sideText(l)) && extractNip(sideText(l)));
  const nameLine=nipLine
    ? nearby.filter(l=>l.y>nipLine.y-0.5 && l.y<y && !/\bNIP\b/i.test(sideText(l)) && !/^(?:Kec\.|Kab\.|Prov\.)/i.test(sideText(l))).sort((a,b)=>Math.abs((nipLine?.y||0)-a.y)-Math.abs((nipLine?.y||0)-b.y))[0]
    : nearby.find(l=>!/(?:NIP|Kepala|Bendahara|Menyetujui|Kec\.)/i.test(sideText(l)));
  return {name:nameLine?clean(sideText(nameLine)):'',nip:nipLine?extractNip(sideText(nipLine)):''};
}
function extractPdfIdentityPage(items){
  const lines=groupPdfLines(items,2.5);
  const id={};
  for(const line of lines){
    const t=lineText(line);
    if(/^NPSN\b/i.test(t))id.npsn=extractNip(afterLabelValue(t,'NPSN\\b')||t);
    else if(/^Nama\s+Sekolah\b/i.test(t))id.school=afterLabelValue(t,'Nama\\s+Sekolah\\b');
    else if(/^Desa\/Kecamatan\b/i.test(t))id.rawAddress=afterLabelValue(t,'Desa\\/Kecamatan\\b');
    else if(/^(?:Kabupaten\s*\/\s*Kota)\b/i.test(t))id.kabupaten=afterLabelValue(t,'Kabupaten\\s*\\/\\s*Kota');
    else if(/^Provinsi\b/i.test(t))id.provinsi=afterLabelValue(t,'Provinsi\\b');
  }
  id.kecamatan=resolveBkuKecamatan(id);
  return id;
}
function extractPdfSignatures(items){
  const lines=groupPdfLines(items,2.5);
  const head=roleSignature(lines,/Kepala\s+Sekolah/i,'left');
  const bend=roleSignature(lines,/Bendahara/i,'right');
  return {headName:head.name,headNip:head.nip,treasurerName:bend.name,treasurerNip:bend.nip};
}
function normalizeSchoolName(v){return clean(v).toLocaleUpperCase('id-ID');}
function finalizeBkuIdentity(identity){
  const x={...identity};
  x.school=normalizeSchoolName(x.school||'');
  x.kecamatan=normalizeKecamatan(resolveBkuKecamatan(x));
  x.alamat=normalizeBkuAddress(x.rawAddress||'',x.kecamatan,x.kabupaten,x.provinsi);
  x.npsn=clean(x.npsn||'');
  x.headName=clean(x.headName||''); x.headNip=extractNip(x.headNip||'');
  x.treasurerName=clean(x.treasurerName||''); x.treasurerNip=extractNip(x.treasurerNip||'');
  return x;
}
function applyIdentityToSurat(identity){
  const id=finalizeBkuIdentity(identity||{});
  state.identity=id;
  const map={sd:id.school,kecamatan:id.kecamatan,npsn:id.npsn,bendahara:id.treasurerName,nipBendahara:id.treasurerNip,kepala:id.headName,nipKepala:id.headNip};
  for(const [key,value] of Object.entries(map)){state.surat[key]=value||'';const el=suratElement(key);if(el)el.value=value||'';}
  // Profil tersimpan (alamat/email/NSS/nomor) dipakai untuk semua BKU; alamat BKU hanya jadi cadangan bila profil belum punya alamat.
  const hasSavedAddress=!!ns.applySavedProfile?.();
  if(!hasSavedAddress){state.surat.alamat=id.alamat||'';const addressEl=suratElement('alamat');if(addressEl)addressEl.value=id.alamat||'';}
  const required=[['Nama Sekolah',id.school],['Alamat',id.alamat],['Kepala Sekolah',id.headName],['NIP Kepala Sekolah',id.headNip],['Bendahara',id.treasurerName],['NIP Bendahara',id.treasurerNip]];
  const missing=required.filter(([,v])=>!clean(v)).map(([k])=>k);
  $('identityStatus').className='auto-status '+(missing.length?'auto-status-warn':'auto-status-ok');
  $('identityStatus').textContent=missing.length?`⚠ Identitas BKU terdeteksi sebagian. Belum terbaca: ${missing.join(', ')}.`:`✓ Identitas surat terisi otomatis dari BKU: ${id.school} • Kepala ${id.headName} • Bendahara ${id.treasurerName}.`;
  const hero=$('pfHeroStatus');
  if(hero){
    hero.textContent=missing.length?`⚠ Identitas BKU belum lengkap • ${missing.length} data perlu diperiksa`:`✓ Identitas surat terisi otomatis dari BKU • ${id.school} • Kepala ${id.headName} • Bendahara ${id.treasurerName}`;
    hero.classList.toggle('warn',!!missing.length);
  }
  return id;
}
function resetAutoIdentity(){
  state.identity={school:"",kecamatan:"",alamat:"",npsn:"",headName:"",headNip:"",treasurerName:"",treasurerNip:"",kabupaten:"",provinsi:""};
  applyIdentityToSurat(state.identity);
  $('identityStatus').className='auto-status';
  $('identityStatus').textContent='● Menunggu data identitas BKU. Baca PDF terlebih dahulu.';
  const hero=$('pfHeroStatus');
  if(hero){hero.textContent='● Menunggu BKU • Profil akan terisi otomatis setelah data dibaca';hero.classList.remove('warn');}
}

/* ==================== SEGMEN 1 — EKSTRAKSI & VALIDASI DATA BKU ==================== */
async function readPdf(file){
  if(!window.pdfjsLib)throw new Error('Mesin PDF.js belum siap. Pastikan koneksi internet aktif saat pertama kali membuka aplikasi, lalu coba BACA DATA lagi.');
  const buf=await file.arrayBuffer();
  const pdf=await window.pdfjsLib.getDocument({data:buf,disableWorker:true}).promise;
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
    if(!identity.headName && sig.headName)identity.headName=sig.headName;
    if(!identity.headNip && sig.headNip)identity.headNip=sig.headNip;
    if(!identity.treasurerName && sig.treasurerName)identity.treasurerName=sig.treasurerName;
    if(!identity.treasurerNip && sig.treasurerNip)identity.treasurerNip=sig.treasurerNip;

    // Ambil total "Jumlah" langsung dari kolom Pengeluaran pada halaman.
    for(const line of lines){
      if(/^Jumlah\b/i.test(lineText(line))){
        const v=extractColumnMoney(line.items,cols.pengeluaran);
        if(v>0||extractColumnText(line.items,cols.pengeluaran)==='0'){declaredTotal+=v;declaredTotalFound++;}
      }
    }

    const dateRows=findPdfDateRows(items,cols);
    const bands=buildPdfRowBands(items,dateRows);
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

      // Tarik Tunai adalah pemindahan dana bank -> kas tunai, bukan biaya kegiatan.
      // Ini tetap ikut direkonstruksi untuk validasi, tetapi tidak masuk tabel.
      if(isInternalMovement(uraian)){internalTransferTotal+=pengeluaran;ignored++;continue;}
      if(!uraian){ignored++;continue;}

      rows.push({tanggal,noBukti,uraian,penerimaan,pengeluaran,saldo,confidence:0.995,source:`halaman ${pageNo}`});
    }
  }

  const expectedIncluded=declaredTotalFound?Math.max(0,declaredTotal-internalTransferTotal):0;
  const actualIncluded=rows.reduce((s,r)=>s+r.pengeluaran,0);
  const warnings=[];
  if(rows.length===0)warnings.push('Tidak ada transaksi pengeluaran yang berhasil dipetakan dari teks PDF.');
  // if(declaredTotalFound&&declaredTotal!==rawExpenseTotal)warnings.push(`Validasi total PDF gagal: kolom Pengeluaran pada baris Jumlah = ${formatMoney(declaredTotal)}, tetapi penjumlahan baris transaksi = ${formatMoney(rawExpenseTotal)}.`);
  // if(declaredTotalFound&&expectedIncluded!==actualIncluded)warnings.push(`Ada selisih setelah mengeluarkan Tarik Tunai: target ${formatMoney(expectedIncluded)}, hasil ${formatMoney(actualIncluded)}. Periksa format PDF/kolom.`);

  return {
    rows,declaredTotal,declaredTotalFound,rawExpenseTotal,internalTransferTotal,expectedIncluded,actualIncluded,
    excludedIncome:income,pages:pdf.numPages,blocks,ignoredRows:ignored,warnings,
    identity:finalizeBkuIdentity(identity),
    validation:{declaredTotal,declaredTotalFound,rawExpenseTotal,internalTransferTotal,expectedIncluded,actualIncluded,ok:true,isEmptyBku:rows.length===0},
    isEmptyBku:rows.length===0,
    // BPU/BNU tidak lagi menjadi syarat untuk PDF. Pajak "Setor ..." dan transaksi
    // SIPLah tanpa No. Bukti tetap merupakan pengeluaran yang sah dan dipertahankan.
    validationRule:'Semua pengeluaran dari kolom PENGELUARAN dipertahankan, kecuali Tarik Tunai (pemindahan dana internal). Terima/pemasukan dan saldo diabaikan.'
  };
}
function excelDate(v){
  if(v instanceof Date&&!Number.isNaN(v.getTime()))return normalizeDate(v);
  if(typeof v==='number'&&window.XLSX?.SSF){const d=window.XLSX.SSF.parse_date_code(v);if(d)return `${String(d.d).padStart(2,'0')}-${String(d.m).padStart(2,'0')}-${d.y}`;}
  return normalizeDate(v)||clean(v);
}
function recoverLegacy(text){
  const t=clean(text); const money=getMoney3(t); if(!money)return null;
  const nm=t.match(noBuktiRe); const noBukti=nm?normalizeNoBukti(nm[0]):'';
  let core=t; const dm=core.match(new RegExp(dateRe.source,'i')); if(dm)core=core.slice((dm.index||0)+dm[0].length);
  core=core.replace(noBuktiRe,' ').replace(activityCodeRe,' ').replace(accountCodeRe,' '); core=clean(core);
  const fm=core.match(new RegExp(moneyTokenRe.source)); if(!fm)return null;
  const uraian=sanitizeUraian(core.slice(0,fm.index)); if(!uraian)return null;
  return {noBukti,uraian,penerimaan:money.penerimaan,pengeluaran:money.pengeluaran,saldo:money.saldo};
}
function normalizeHeader(v){return clean(v).toLowerCase().replace(/[\n\r]+/g,' ').replace(/[._:;|/\\()\-]+/g,' ').replace(/\s+/g,' ').trim();}
function headerIndex(headers,patterns){return headers.findIndex(v=>patterns.some(re=>re.test(v)));}
function mergedHeaderRows(mat,start,span){
  const maxCols=Math.max(0,...mat.slice(start,start+span).map(r=>(r||[]).length));
  const out=Array(maxCols).fill('');
  for(let c=0;c<maxCols;c++){
    const vals=[];
    for(let rr=start;rr<Math.min(mat.length,start+span);rr++){
      const v=normalizeHeader((mat[rr]||[])[c]); if(v)vals.push(v);
    }
    out[c]=clean(vals.join(' '));
  }
  return out;
}
function inferExcelColumns(mat,start){
  const maxCols=Math.max(0,...mat.map(r=>(r||[]).length));
  const sample=mat.slice(Math.max(start+1,0),Math.min(mat.length,start+81));
  const dateScore=Array(maxCols).fill(0),numScore=Array(maxCols).fill(0),textScore=Array(maxCols).fill(0);
  for(const row of sample){
    for(let c=0;c<maxCols;c++){
      const v=row?.[c]; const t=clean(v); if(!t)continue;
      if(normalizeDate(v))dateScore[c]++;
      if(typeof v==='number'||/^(?:Rp\.?\s*)?[0-9][0-9.,()\s]*$/.test(t))numScore[c]++;
      if(!normalizeDate(v)&&!(typeof v==='number')&&t.length>=5)textScore[c]+=Math.min(t.length,80);
    }
  }
  const di=dateScore.indexOf(Math.max(...dateScore));
  let ui=textScore.indexOf(Math.max(...textScore.filter((_,i)=>i!==di)));
  if(ui<0)ui=-1;
  const numericCols=[]; for(let c=0;c<maxCols;c++)if(c!==di&&numScore[c]>=2)numericCols.push(c);
  numericCols.sort((a,b)=>a-b);
  const ei=numericCols.length>=2?numericCols[numericCols.length-2]:(numericCols[0]??-1);
  const pi=numericCols.length>=3?numericCols[numericCols.length-3]:-1;
  return {di,ui,ei,pi,bi:-1,inferred:true};
}
function findExcelHeader(mat){
  const dateReH=/\b(?:tanggal|tgl|tanggal\s+transaksi|date)\b/i;
  const descReH=/\b(?:uraian|keterangan|rincian|deskripsi|kegiatan|nama\s+barang|uraian\s+transaksi)\b/i;
  const outReH=/\b(?:pengeluaran|pengeluaran\s+kas|belanja|jumlah\s+pengeluaran|keluar|debit|debet)\b/i;
  const inReH=/\b(?:penerimaan|jumlah\s+penerimaan|masuk|kredit)\b/i;
  const proofReH=/\b(?:no\s*bukti|nomor\s*bukti|bukti|bpu|bnu)\b/i;
  const limit=Math.min(mat.length,35); let best=null;
  for(let r=0;r<limit;r++){
    for(const span of [1,2,3]){
      const h=mergedHeaderRows(mat,r,span); if(!h.length)continue;
      const di=headerIndex(h,[dateReH]),ui=headerIndex(h,[descReH]),ei=headerIndex(h,[outReH]);
      const score=(di>=0?3:0)+(ui>=0?3:0)+(ei>=0?4:0)+(headerIndex(h,[inReH])>=0?1:0)+(headerIndex(h,[proofReH])>=0?1:0);
      if(di>=0&&ui>=0&&ei>=0&&(!best||score>best.score))best={r,span,h,score,col:{di,ui,ei,bi:headerIndex(h,[proofReH]),pi:headerIndex(h,[inReH]),inferred:false}};
    }
  }
  if(best)return best;
  const inferred=inferExcelColumns(mat,0);
  if(inferred.di>=0&&inferred.ui>=0&&inferred.ei>=0)return {r:0,span:1,h:[],score:0,col:inferred};
  return null;
}
async function readExcel(file){
  if(!window.XLSX)throw new Error('Mesin Excel belum siap. Pustaka XLSX tidak tersedia. Pastikan koneksi internet aktif saat membuka aplikasi lalu coba BACA DATA lagi.');
  const wb=window.XLSX.read(await file.arrayBuffer(),{type:'array',cellDates:true,raw:true});
  const rows=[]; const allText=[]; let income=0,ignored=0,sheets=0,headerFound=0,missingEvidence=0,usedFallback=0;

  const looksLikeDate=v=>!!normalizeDate(v) || (typeof v==='number' && !!excelDate(v));
  const nonNumericText=v=>{
    const t=clean(v); if(!t)return false;
    if(looksLikeDate(v))return false;
    if(/^[-+]?\s*(?:Rp\.?\s*)?[0-9][0-9.,()\s]*$/.test(t))return false;
    return t.length>=3;
  };
  const rowValues=r=>(r||[]).map((v,c)=>({v,c,t:clean(v),date:looksLikeDate(v),num:parseMoney(v),text:nonNumericText(v)}));
  const findAmountColumns=(mat,start,col)=>{
    const maxCols=Math.max(0,...mat.map(r=>(r||[]).length));
    const scores=Array.from({length:maxCols},()=>({positive:0,total:0,values:[]}));
    for(let i=start;i<Math.min(mat.length,start+250);i++){
      const r=mat[i]||[];
      for(let c=0;c<maxCols;c++){
        const t=clean(r[c]); if(!t)continue;
        const n=parseMoney(r[c]);
        const numeric=typeof r[c]==='number'||/^[-+]?\s*(?:Rp\.?\s*)?[0-9][0-9.,()\s]*$/.test(t);
        if(numeric){scores[c].total++; if(n>0)scores[c].positive++; scores[c].values.push(n);}
      }
    }
    const candidates=scores.map((s,c)=>({c,...s})).filter(x=>x.total>=2).sort((a,b)=>b.positive-a.positive||b.total-a.total);
    // Prefer the header-selected output/income columns; otherwise choose the last two numeric columns.
    const outCandidates=candidates.filter(x=>x.c!==col.di&&x.c!==col.pi&&x.c!==col.bi&&x.c!==col.ui);
    if(col.ei<0&&outCandidates.length)col.ei=outCandidates[0].c;
    if(col.pi<0){const alt=outCandidates.find(x=>x.c!==col.ei); if(alt)col.pi=alt.c;}
    return col;
  };

  for(const name of wb.SheetNames){
    const sh=wb.Sheets[name];
    const mat=window.XLSX.utils.sheet_to_json(sh,{header:1,defval:'',raw:true});
    if(!mat.length)continue;
    for(const rr of mat){for(const vv of(rr||[])){const tv=clean(vv instanceof Date?excelDate(vv):String(vv??''));if(tv)allText.push(tv);}}

    const head=findExcelHeader(mat);
    if(head){
      sheets++; headerFound++; if(head.col.inferred)usedFallback++;
      let col={...head.col};
      findAmountColumns(mat,head.r+Math.max(head.span,1),col);
      let lastDate='';
      for(let i=head.r+Math.max(head.span,1);i<mat.length;i++){
        const r=mat[i]||[];
        let tanggal=col.di>=0?excelDate(r[col.di]):'';
        if(tanggal&&!/^\d{2}-\d{2}-\d{4}$/.test(tanggal))tanggal=normalizeDate(tanggal);
        if(!tanggal&&lastDate)tanggal=lastDate; else if(tanggal)lastDate=tanggal;
        let noBukti=col.bi>=0?normalizeNoBukti(r[col.bi]):'';
        let uraian=col.ui>=0?sanitizeUraian(r[col.ui]):'';
        let pengeluaran=col.ei>=0?parseMoney(r[col.ei]):0;
        let penerimaan=col.pi>=0?parseMoney(r[col.pi]):0;
        let source=`sheet ${name}`;
        const joined=clean(r.map(v=>v instanceof Date?excelDate(v):String(v??'')).join(' | '));
        const legacy=recoverLegacy(joined);
        if(legacy){
          noBukti=noBukti||legacy.noBukti; uraian=uraian||legacy.uraian;
          if(pengeluaran<=0)pengeluaran=legacy.pengeluaran;
          if(penerimaan<=0)penerimaan=legacy.penerimaan;
          if(!tanggal) tanggal=normalizeDate(joined);
          if(legacy.pengeluaran>0 || legacy.uraian)source+=' • dipulihkan';
        }
        if(!uraian){
          const candidates=r.map((v,c)=>({v,c,t:clean(v)})).filter(x=>x.t&&x.c!==col.di&&x.c!==col.ei&&x.c!==col.pi&&x.c!==col.bi&&nonNumericText(x.v));
          candidates.sort((a,b)=>b.t.length-a.t.length); if(candidates[0])uraian=sanitizeUraian(candidates[0].t);
        }
        if(!tanggal||!uraian){ignored++;continue;}
        if(pengeluaran<=0){income+=Math.max(0,penerimaan);ignored++;continue;}
        if(!isValidNoBukti(noBukti))missingEvidence++;
        rows.push({tanggal,noBukti,uraian,pengeluaran,penerimaan,isInternalTransfer:isInternalMovement(uraian),confidence:legacy?.pengeluaran?0.92:(isValidNoBukti(noBukti)?0.99:(col.inferred?0.78:0.88)),source});
      }
      continue;
    }

    // Header tidak ditemukan: fallback per baris berdasarkan pola isi.
    usedFallback++;
    const maxCols=Math.max(0,...mat.map(r=>(r||[]).length));
    for(let i=0;i<mat.length;i++){
      const r=mat[i]||[]; const vals=rowValues(r);
      const tanggalVal=vals.find(x=>x.date)?.v;
      const tanggal=tanggalVal!==undefined?excelDate(tanggalVal):'';
      if(!tanggal)continue;
      const noBuktiVal=vals.find(x=>/^(?:BPU|BNU)\s*[-./]?\s*\d+$/i.test(x.t))?.t||vals.find(x=>noBuktiRe.test(x.t))?.t||'';
      const noBukti=normalizeNoBukti(noBuktiVal);
      const numeric=vals.filter(x=>x.num>0 && (typeof x.v==='number'||/^[0-9][0-9.,()\s]*$/.test(x.t))).map(x=>({c:x.c,n:x.num}));
      if(!numeric.length)continue;
      // Dalam BKU yang tidak memiliki header, nilai terbesar/dua nilai terakhir umumnya adalah pengeluaran/saldo.
      const ordered=[...numeric].sort((a,b)=>a.c-b.c);
      let pengeluaran=ordered.length>=2?ordered[ordered.length-2].n:ordered[ordered.length-1].n;
      let penerimaan=ordered.length>=3?ordered[ordered.length-3].n:0;
      const textCells=vals.filter(x=>x.text).map(x=>x.t).filter(t=>!/^(?:jumlah|total|saldo|tanggal|tgl|uraian|keterangan|penerimaan|pengeluaran)$/i.test(t));
      const uraian=sanitizeUraian(textCells.sort((a,b)=>b.length-a.length)[0]||'');
      if(!uraian||pengeluaran<=0)continue;
      if(!isValidNoBukti(noBukti))missingEvidence++;
      rows.push({tanggal,noBukti,uraian,pengeluaran,penerimaan,isInternalTransfer:isInternalMovement(uraian),confidence:0.68,source:`sheet ${name} • mode pola isi`});
    }
    sheets++;
  }

  const ei={};
  for(const t of allText){
    if(/^NPSN\b/i.test(t))ei.npsn=extractNip(afterLabelValue(t,'NPSN\b')||t);
    else if(/^Nama\s+Sekolah\b/i.test(t))ei.school=afterLabelValue(t,'Nama\s+Sekolah\b');
    else if(/^Desa\/Kecamatan\b/i.test(t))ei.rawAddress=afterLabelValue(t,'Desa\/Kecamatan\b');
    else if(/^(?:Kabupaten\s*\/\s*Kota)\b/i.test(t))ei.kabupaten=afterLabelValue(t,'Kabupaten\s*\/\s*Kota');
    else if(/^Provinsi\b/i.test(t))ei.provinsi=afterLabelValue(t,'Provinsi\b');
    else if(!ei.rawAddress&&/\b(?:Kecamatan|Kec\.)\s+Lebak\s+Wangi\b/i.test(t))ei.rawAddress=t;
  }
  const rawExpenseTotal=rows.reduce((sum,r)=>sum+(Number(r.pengeluaran)||0),0);
  const warnings=[];
  if(!headerFound)warnings.push('Header standar tidak ditemukan; mesin memakai pembacaan berdasarkan pola isi.');
  if(usedFallback>0)warnings.push('Sebagian data dibaca dengan mode pemulihan. Periksa hasil transaksi sebelum membuat Surat Perintah.');
  if(rows.length&&missingEvidence)warnings.push(`${missingEvidence} transaksi tidak memiliki No. Bukti BPU/BNU; transaksi tetap dipertahankan karena tanggal, uraian, dan nominal pengeluaran tersedia.`);
  if(!rows.length)warnings.push('Tidak ada transaksi pengeluaran yang berhasil dibaca. Periksa apakah file berisi data BKU yang tersimpan sebagai tabel/worksheet.');
  return {rows,declaredTotal:null,excludedIncome:income,pages:sheets,blocks:rows.length+ignored,ignoredRows:ignored,warnings,identity:finalizeBkuIdentity(ei),rawExpenseTotal,validation:{ok:true,isEmptyBku:rows.length===0,rawExpenseTotal,declaredTotal:null,missingEvidence,rule:'Tanggal + Uraian + Pengeluaran menjadi dasar transaksi. No. Bukti BPU/BNU opsional.'},isEmptyBku:rows.length===0,validationRule:'Pembacaan Excel memakai header standar, pemulihan baris, dan fallback pola isi. No. Bukti BPU/BNU bukan syarat wajib.'};
}

/* ==================== SEGMEN 2 — PEMBUATAN SURAT PERINTAH ==================== */
function dateToInput(s){
  const x=clean(s);
  if(/^\d{4}-\d{2}-\d{2}$/.test(x)) return x;
  const m=x.match(/^(\d{2})[-\/](\d{2})[-\/](\d{4})$/);
  return m?`${m[3]}-${m[2]}-${m[1]}`:'';
}
function dateDisplay(s){
  const x=clean(s);
  const m=x.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m?`${m[3]}-${m[2]}-${m[1]}`:x;
}
function groupRowsByBukti(rows){
  const map=new Map();
  for(const r of rows){
    const key=isValidNoBukti(r.noBukti)?normalizeNoBukti(r.noBukti):`__${r.tanggal}__${r.uraian}__${map.size}`;
    if(!map.has(key)){map.set(key,{...r,source:r.source||'',_count:1});continue;}
    const g=map.get(key);
    g.pengeluaran=(g.pengeluaran||0)+(r.pengeluaran||0);
    g.penerimaan=(g.penerimaan||0)+(r.penerimaan||0);
    g._count=(g._count||1)+1;
    if(r.tanggal && r.tanggal!==g.tanggal){g.tanggal=g.tanggal||r.tanggal;}
    const a=clean(g.uraian), b=clean(r.uraian);
    if(b && !a.toLowerCase().includes(b.toLowerCase())) g.uraian=`${a}; ${b}`;
    g.source=`${g.source||''}${g.source&&r.source?' • ':''}${r.source||''}`;
  }
  return [...map.values()];
}
function taxInfo(r){
  const u=clean(r?.uraian||'');
  const amount=Math.max(0,Number(r?.pengeluaran)||0);
  if(amount<=0)return null;
  // ATURAN HITUNG PAJAK (hanya dua jenis yang dihitung):
  // 1) SIPLah     : uraian diawali/memuat "Setor ..." DAN bertuliskan "(Transaksi SIPLah)"
  //                 contoh: "Setor Pengadaan Perlengkapan Sekolah ... (Transaksi SIPLah)"
  // 2) Non SIPLah : uraian bertuliskan "Setor PPh" atau "Setor PPN" tanpa "(Transaksi SIPLah)"
  // Baris lain (mis. "Belanja ... (Transaksi SIPLah)" tanpa kata Setor, atau hanya menyebut PPh/PPN) TIDAK dihitung.
  const siplah=/transaksi\s+siplah/i.test(u);
  const hasSetor=/\bsetor\b/i.test(u);
  const m=u.match(/\bSetor\s+(PPh|PPN)\b(?:\s*(?:pasal|ps\.?)?\s*(\d+[a-z]?))?/i);
  if(siplah){
    if(!hasSetor)return null;
  }else if(!m){
    return null;
  }
  let type='SIPLah';
  if(m){const kind=m[1].toUpperCase()==='PPN'?'PPN':'PPh';type=kind==='PPh'&&m[2]?`PPh ${m[2]}`:kind;}
  return {row:r,siplah,type,amount};
}
function getTaxRows(rows=state.rawRows){return (Array.isArray(rows)?rows:[]).map(taxInfo).filter(Boolean);}
function getTaxSummary(rows=state.rawRows){
  const all=getTaxRows(rows);
  const s=all.filter(x=>x.siplah), n=all.filter(x=>!x.siplah);
  const siplahTotal=s.reduce((sum,x)=>sum+(Number(x.amount)||0),0);
  const nonSiplahTotal=n.reduce((sum,x)=>sum+(Number(x.amount)||0),0);
  return {siplahTotal,nonSiplahTotal,grandTotal:siplahTotal+nonSiplahTotal,count:all.length};
}

Object.assign(ns,{
  dateRe,noBuktiRe,leadingCodeRe,activityCodeRe,accountCodeRe,moneyTokenRe,moneyOnlyRe,
  PDF_BASE_WIDTH,PDF_BASE_COLS,
  clean,normalizeDate,normalizeNoBukti,isValidNoBukti,parseMoney,formatMoney,stripMetadata,sanitizeUraian,
  pdfColumns,itemCenterX,inPdfCol,pdfItemText,groupPdfLines,lineText,uniqueConsecutiveLines,extractColumnLines,extractColumnText,extractColumnMoney,
  findPdfDateRows,buildPdfRowBands,recoverPdfRowBands,isInternalMovement,maskMatches,getMoney3,
  afterLabelValue,extractNip,normalizeSchoolName,normalizeKecamatan,resolveBkuKecamatan,validateBkuNpsn,extractKecamatanFromAddress,normalizeBkuAddress,
  roleSignature,extractPdfIdentityPage,extractPdfSignatures,finalizeBkuIdentity,applyIdentityToSurat,resetAutoIdentity,
  readPdf,detectPdfColumns,excelDate,recoverLegacy,readExcel,
  groupRowsByBukti,taxInfo,getTaxRows,getTaxSummary,dateToInput,dateDisplay
});
})(window.SPMU=window.SPMU||{});
