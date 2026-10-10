(function(ns){
'use strict';

const CATEGORY={
  modalMesin:'Belanja Modal : Peralatan dan Mesin',
  modalLain:'Belanja Modal : Aset Tetap Lainya',
  operBarang:'Belanja Operasional : Barang dan Jasa',
  operPegawai:'Belanja Operasional : Pegawai'
};
const CAT_CLS={[CATEGORY.modalMesin]:'c1',[CATEGORY.modalLain]:'c2',[CATEGORY.operBarang]:'c3',[CATEGORY.operPegawai]:'c4'};
const CAT_SHORT={[CATEGORY.modalMesin]:'Modal: Peralatan & Mesin',[CATEGORY.modalLain]:'Modal: Aset Tetap Lainnya',[CATEGORY.operBarang]:'Operasional: Barang & Jasa',[CATEGORY.operPegawai]:'Operasional: Pegawai'};

function pill(n){return `<span class="cat-pill ${CAT_CLS[n]||''}">${ns.esc(n)}</span>`;}
function money(n){return typeof ns.formatMoney==='function'?ns.formatMoney(n):new Intl.NumberFormat('id-ID',{style:'currency',currency:'IDR',maximumFractionDigits:0}).format(Number(n)||0);}

function sPMUItems(project){
  const state=project?.state||{};
  const rows=Array.isArray(state.rows)?state.rows:[];
  const drafts=state.suratByBukti&&typeof state.suratByBukti==='object'&&!Array.isArray(state.suratByBukti)?Object.values(state.suratByBukti):[];
  return drafts.filter(d=>d&&d.savedAt&&String(d.category||'').trim()).map(d=>{
    const no=String(d.bukti||'').trim();
    const row=rows.find(r=>{
      const a=typeof ns.normalizeNoBukti==='function'?ns.normalizeNoBukti(r?.noBukti||''):String(r?.noBukti||'').trim().toUpperCase();
      const b=typeof ns.normalizeNoBukti==='function'?ns.normalizeNoBukti(no):no.toUpperCase();
      return a&&b&&a===b;
    });
    const nominal=Math.max(0,Number(d.nominal??row?.pengeluaran)||0);
    return {category:String(d.category),nominal,bukti:no,untukPembayaran:String(d.untukPembayaran||''),savedAt:Number(d.savedAt)||0};
  });
}

function barHtml(label,value,max){
  const pct=max>0?Math.max(0,Math.min(100,value/max*100)):0;
  return `<div class="dash-bar-row"><div class="dash-bar-label"><span>${ns.esc(label)}</span><b>${money(value)}</b></div><div class="dash-bar-track"><i style="width:${pct}%;${value<=0?'min-width:0;':''}"></i></div></div>`;
}

let allItems=[];
let categoryFilter='all';
let periodFilter='all';   // all | m1..m12 | tw1..tw4 | th1..th2
let yearFilter='auto';    // auto | all | 2026 ...

const MONTHS=['','Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];
const TRIWULAN=[
  {id:'tw1',label:'Triwulan I',from:1,to:3},{id:'tw2',label:'Triwulan II',from:4,to:6},
  {id:'tw3',label:'Triwulan III',from:7,to:9},{id:'tw4',label:'Triwulan IV',from:10,to:12}
];
const TAHAP=[{id:'th1',label:'Tahap 1',from:1,to:6},{id:'th2',label:'Tahap 2',from:7,to:12}];
function periodDef(id){
  if(!id||id==='all')return null;
  let m=/^m(\d{1,2})$/.exec(id);
  if(m){const n=Number(m[1]);return {id,label:MONTHS[n]||id,from:n,to:n};}
  return TRIWULAN.find(x=>x.id===id)||TAHAP.find(x=>x.id===id)||null;
}
const rangeText=d=>d.from===d.to?MONTHS[d.from]:`${MONTHS[d.from].slice(0,3)}–${MONTHS[d.to].slice(0,3)}`;

let tablePage=1;
let pageSize=10;
function drawTable(){
  const tbody=document.getElementById('dashboardTableBody');if(!tbody)return;
  const q=(document.getElementById('dashSearch')?.value||'').trim().toLowerCase();
  const items=allItems.filter(it=>(categoryFilter==='all'||it.category===categoryFilter)&&(!q||[it.projectName,it.untukPembayaran,it.category,it.bukti].join(' ').toLowerCase().includes(q)));
  const pages=Math.max(1,Math.ceil(items.length/pageSize));
  tablePage=Math.min(Math.max(1,tablePage),pages);
  const offset=(tablePage-1)*pageSize;
  const status=document.getElementById('dashTableStatus'),info=document.getElementById('dashPageInfo');
  if(status)status.textContent=items.length?`${offset+1}–${Math.min(offset+pageSize,items.length)} dari ${items.length} SPMU`: '0 SPMU';
  if(info)info.textContent=`Halaman ${tablePage} / ${pages}`;
  const prev=document.getElementById('dashPagePrev'),next=document.getElementById('dashPageNext');
  if(prev)prev.disabled=tablePage<=1;if(next)next.disabled=tablePage>=pages;
  if(!allItems.length){tbody.innerHTML='<tr><td colspan="6" class="empty">Belum ada SPMU tersimpan untuk periode ini. Baca BKU dan simpan Surat Perintah untuk memulai.</td></tr>';return;}
  if(!items.length){tbody.innerHTML='<tr><td colspan="6" class="empty">Tidak ada data yang cocok. Ubah pencarian atau reset filter kategori.</td></tr>';return;}
  const total=items.reduce((a,x)=>a+x.nominal,0);
  tbody.innerHTML=items.slice(offset,offset+pageSize).map((item,i)=>`<tr><td>${offset+i+1}</td><td><div class="dash-job-name">${ns.esc(item.projectName)}</div>${item.bukti?`<div class="small">No. Bukti: ${ns.esc(item.bukti)}</div>`:''}</td><td><div class="dash-payment-purpose">${ns.esc(item.untukPembayaran||'— Belum diisi —')}</div></td><td>${pill(item.category)}</td><td>${item.savedAt?new Date(item.savedAt).toLocaleDateString('id-ID',{day:'2-digit',month:'short',year:'numeric'}):'-'}</td><td class="num">${money(item.nominal)}</td></tr>`).join('')+`<tr class="dash-total-row"><td colspan="5">Total seluruh hasil filter (${items.length} SPMU, bukan hanya halaman ini)</td><td class="num">${money(total)}</td></tr>`;
}

document.getElementById('dashSearch')?.addEventListener('input',()=>{tablePage=1;drawTable();});
document.getElementById('dashCategoryFilter')?.addEventListener('change',e=>{categoryFilter=e.target.value||'all';tablePage=1;paintComposition();drawTable();});
document.getElementById('dashPageSize')?.addEventListener('change',e=>{pageSize=[10,25,50].includes(Number(e.target.value))?Number(e.target.value):10;tablePage=1;drawTable();});
document.getElementById('dashPagePrev')?.addEventListener('click',()=>{tablePage--;drawTable();});
document.getElementById('dashPageNext')?.addEventListener('click',()=>{tablePage++;drawTable();});
document.getElementById('dashResetFilters')?.addEventListener('click',()=>{
  categoryFilter='all';periodFilter='all';yearFilter='auto';tablePage=1;
  const category=document.getElementById('dashCategoryFilter'),search=document.getElementById('dashSearch');
  if(category)category.value='all';if(search)search.value='';renderDashboard();
});
document.getElementById('dashPeriodFilter')?.addEventListener('change',e=>{periodFilter=e.target.value||'all';renderDashboard();});
document.getElementById('dashYearFilter')?.addEventListener('change',e=>{yearFilter=e.target.value||'all';renderDashboard();});
document.getElementById('dashGoBku')?.addEventListener('click',()=>{ns.setTab?.('bku');});
document.getElementById('dashGoSurat')?.addEventListener('click',()=>{const b=document.getElementById('tabSuratBtn');if(b&&!b.disabled)b.click();else window.alert('Tab Surat Perintah akan aktif setelah data BKU selesai dibaca.');});
document.getElementById('dashGoPajak')?.addEventListener('click',()=>{const b=document.getElementById('tabPajakBtn');if(b&&!b.disabled)b.click();else window.alert('Tab Hitung Pajak akan aktif setelah data BKU selesai dibaca.');});

function aggregateProject(p){
  const info=typeof ns.detectMonthFromProject==='function'?ns.detectMonthFromProject(p):{month:999,year:0,monthName:'Lainnya',label:'Lainnya'};
  const projectName=typeof ns.projectDisplayName==='function'?ns.projectDisplayName(p):(p?.name||'Tanpa nama');
  const items=sPMUItems(p).map(item=>({...item,projectName}));
  const sums={[CATEGORY.modalMesin]:0,[CATEGORY.modalLain]:0,[CATEGORY.operBarang]:0,[CATEGORY.operPegawai]:0};
  items.forEach(it=>{if(it.category in sums)sums[it.category]+=it.nominal;});
  const rawRows=Array.isArray(p?.state?.rawRows)?p.state.rawRows:[];
  const t=typeof ns.getTaxSummary==='function'?ns.getTaxSummary(rawRows):{};
  const taxRows=typeof ns.getTaxRows==='function'?ns.getTaxRows(rawRows):[];
  const byType={};
  taxRows.forEach(x=>{const k=x.type||'Lainnya',b=byType[k]||(byType[k]={amount:0,count:0,siplah:0,non:0});b.amount+=x.amount;b.count++;b[x.siplah?'siplah':'non']+=x.amount;});
  return {p,info,projectName,items,sums,tax:{siplah:Number(t.siplahTotal)||0,non:Number(t.nonSiplahTotal)||0,grand:Number(t.grandTotal)||0,count:taxRows.length,sCount:taxRows.filter(x=>x.siplah).length,byType}};
}
function inRange(a,def){return !def||(a.info.month>=def.from&&a.info.month<=def.to);}
function sumAggs(list){
  return list.reduce((acc,a)=>{
    acc.spmu+=a.items.length;
    acc.modal+=a.sums[CATEGORY.modalMesin]+a.sums[CATEGORY.modalLain];
    acc.oper+=a.sums[CATEGORY.operBarang]+a.sums[CATEGORY.operPegawai];
    acc.tax+=a.tax.grand;
    return acc;
  },{spmu:0,modal:0,oper:0,tax:0});
}
function monthsPresent(list,def){
  const set=new Set(list.filter(a=>a.info.month!==999&&inRange(a,def)).map(a=>a.info.month));
  return [...set].sort((x,y)=>x-y);
}
function drawRecap(bodyId,defs,yearAggs,yearText){
  const body=document.getElementById(bodyId);if(!body)return;
  const rows=defs.map(def=>{
    const list=yearAggs.filter(a=>a.info.month!==999&&inRange(a,def));
    const t=sumAggs(list);
    const months=monthsPresent(list,def).map(m=>MONTHS[m].slice(0,3));
    const active=periodFilter===def.id?' dash-recap-active':'';
    return `<tr class="dash-recap-row${active}" data-period="${def.id}" tabindex="0" aria-label="Pilih ${ns.esc(def.label)}" title="Klik atau tekan Enter untuk memfilter dashboard"><td><b>${ns.esc(def.label)}</b><div class="small">${rangeText(def)}</div></td><td>${months.length?`${months.join(', ')} <span class="small">(${months.length}/${def.to-def.from+1} bulan)</span>`:'<span class="small">Belum ada BKU</span>'}</td><td class="num">${t.spmu}</td><td class="num">${money(t.modal)}</td><td class="num">${money(t.oper)}</td><td class="num"><b>${money(t.modal+t.oper)}</b></td><td class="num">${money(t.tax)}</td></tr>`;
  });
  const all=sumAggs(yearAggs.filter(a=>a.info.month!==999));
  rows.push(`<tr class="dash-total-row"><td colspan="2">Total ${ns.esc(yearText)}</td><td class="num">${all.spmu}</td><td class="num">${money(all.modal)}</td><td class="num">${money(all.oper)}</td><td class="num">${money(all.modal+all.oper)}</td><td class="num">${money(all.tax)}</td></tr>`);
  body.innerHTML=rows.join('');
  body.querySelectorAll('tr[data-period]').forEach(tr=>{
    const choose=()=>{periodFilter=tr.dataset.period||'all';const sel=document.getElementById('dashPeriodFilter');if(sel)sel.value=periodFilter;renderDashboard();};
    tr.addEventListener('click',choose);
    tr.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();choose();}});
  });
}

/* ===== Komposisi Belanja & Rekap Pajak: dinamis & lengkap ===== */
const REDUCED=!!(window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches);
const COMP_COL={c1:'#3159d9',c2:'#8b5cf6',c3:'#0ea5a4',c4:'#f59e0b'};
const TAX_COL=['#3159d9','#8b5cf6','#0ea5a4','#f59e0b','#e11d48','#14865a','#64748b'];
const pctOf=(v,t)=>t>0?(v/t*100).toLocaleString('id-ID',{maximumFractionDigits:1})+'%':'0%';
let lastData=null;

function tween(id,to,fmt){
  const el=document.getElementById(id);if(!el)return;
  fmt=fmt||money;to=Number(to)||0;
  const from=Number(el._v)||0;el._v=to;
  if(el._raf&&typeof cancelAnimationFrame==='function')cancelAnimationFrame(el._raf);
  if(REDUCED||from===to||typeof requestAnimationFrame!=='function'){el.textContent=fmt(to);return;}
  const t0=performance.now();
  const step=now=>{const k=Math.min(1,(now-t0)/520),e=1-Math.pow(1-k,3);el.textContent=fmt(k<1?from+(to-from)*e:to);if(k<1)el._raf=requestAnimationFrame(step);};
  el._raf=requestAnimationFrame(step);
}

function trendHtml(key,color,label){
  const m=lastData.monthly,def=lastData.def,max=Math.max(0,...m.map(x=>x[key]));
  if(!(max>0))return `<div class="comp-empty">Belum ada data ${label} pada ${ns.esc(lastData.yearText.toLowerCase())}.</div>`;
  return `<div class="dx2-trend" role="group" aria-label="Tren ${label} per bulan">`+m.map((x,i)=>{
    const n=i+1,on=!def||(n>=def.from&&n<=def.to),h=x[key]>0?Math.max(.06,x[key]/max):.02;
    return `<button type="button" class="dx2-tbar${on?'':' dim'}${def&&def.from===n&&def.to===n?' sel':''}" data-month="${n}" title="${MONTHS[n]}: ${money(x[key])}"><i style="height:calc((100% - 18px)*${h.toFixed(3)});background:${color}"></i><em>${MONTHS[n].slice(0,3)}</em></button>`;
  }).join('')+'</div>';
}

function paintComposition(){
  const host=document.getElementById('dashComposition');if(!host||!lastData)return;
  const expanded=!!host.querySelector('.dash-fold[open]');
  const E=ns.esc,{rows,total,period,items}=lastData.comp;
  const sub=document.getElementById('dashCompSub');
  if(sub)sub.textContent=`Porsi tiap kategori terhadap total pengeluaran SPMU tersimpan • ${period}. Klik kategori untuk membuka detail SPMU tersaring.`;
  if(!(total>0)){host.innerHTML=`<div class="comp-empty">Belum ada SPMU pada periode ${E(period)}.</div>`;return;}
  const sel=categoryFilter!=='all'?categoryFilter:null;
  let acc=0;
  const stops=rows.map(([n,v])=>{const s=acc,e=acc+v/total*100;acc=e;const c=COMP_COL[CAT_CLS[n]];return (sel&&sel!==n?c+'33':c)+' '+s+'% '+e+'%';}).join(',');
  const cnt={};items.forEach(it=>{cnt[it.category]=(cnt[it.category]||0)+1;});
  const modal=rows.filter(([n])=>/Modal/.test(n)).reduce((a,[,v])=>a+v,0),oper=total-modal;
  const top=[...rows].sort((a,b)=>b[1]-a[1])[0];
  const big=items.reduce((m,x)=>x.nominal>m?x.nominal:m,0);
  const hl=sel?CAT_SHORT[sel]:'Total belanja',hv=sel?(rows.find(r=>r[0]===sel)||[0,0])[1]:total;
  host.innerHTML=`<div class="dx-donut-wrap"><div class="dx-donut" style="background:conic-gradient(${stops})"><div class="dx-donut-hole" data-l="${E(hl)}" data-v="${money(hv)}"><span>${E(hl)}</span><b>${money(hv)}</b></div></div>`+
    `<ul class="dx-legend">${rows.map(([n,v])=>`<li class="dx2-leg${sel===n?' on':''}${sel&&sel!==n?' off':''}" data-cat="${E(n)}" tabindex="0" role="button" aria-pressed="${sel===n}" title="Klik untuk memfilter tabel rekap"><s style="background:${COMP_COL[CAT_CLS[n]]}"></s><span>${E(CAT_SHORT[n])}<small>${cnt[n]||0} SPMU</small></span><em>${money(v)}</em><b>${pctOf(v,total)}</b><u style="width:${(v/total*100).toFixed(1)}%;background:${COMP_COL[CAT_CLS[n]]}"></u></li>`).join('')}</ul></div>`+
    `<div class="dx2-split" title="Modal vs Operasional"><i style="width:${(modal/total*100).toFixed(1)}%"></i><i class="o" style="width:${(oper/total*100).toFixed(1)}%"></i></div>`+
    `<div class="dx2-split-l"><span><s></s>Modal ${pctOf(modal,total)}</span><span><s class="o"></s>Operasional ${pctOf(oper,total)}</span></div>`+
    `<details class="dash-fold"${expanded?' open':''}><summary>Statistik &amp; tren belanja bulanan</summary><div class="dx2-stats"><div><span>Jumlah SPMU</span><b>${items.length}</b></div><div><span>Rata-rata / SPMU</span><b>${money(total/Math.max(1,items.length))}</b></div><div><span>Kategori terbesar</span><b>${E(CAT_SHORT[top[0]])}</b></div><div><span>SPMU terbesar</span><b>${money(big)}</b></div></div>`+
    `<div class="dx2-sub">Tren belanja per bulan • ${E(lastData.yearText)} <small>(klik bulan untuk memfilter)</small></div>${trendHtml('spend','#3159d9','belanja')}</details>`;
}

function paintTax(){
  const host=document.getElementById('dashTaxExtra');if(!host||!lastData)return;
  const E=ns.esc,t=lastData.tax,spend=lastData.comp.total,period=lastData.comp.period;
  const txt=(id,v)=>{const el=document.getElementById(id);if(el)el.textContent=v;};
  txt('dashTaxSub',`Akumulasi pajak ${period} dari ${lastData.bkuCount} BKU tersimpan.`);
  txt('dashTaxSiplahMeta',`${t.sCount} transaksi • ${pctOf(t.siplah,t.grandTotal)} dari pajak`);
  txt('dashTaxNonSiplahMeta',`${t.count-t.sCount} transaksi • ${pctOf(t.non,t.grandTotal)} dari pajak`);
  if(!(t.grandTotal>0)){host.innerHTML=`<div class="comp-empty">Belum ada pajak (Setor PPh/PPN/SIPLah) pada periode ${E(period)}.</div>`;return;}
  const types=Object.entries(t.byType).sort((a,b)=>b[1].amount-a[1].amount),maxT=types[0][1].amount||1;
  host.innerHTML=`<div class="dx2-taxhead"><div><span>Total pajak</span><b>${money(t.grandTotal)}</b></div><div><span>Rasio terhadap belanja</span><b>${spend>0?pctOf(t.grandTotal,spend):'—'}</b></div><div><span>Transaksi pajak</span><b>${t.count}</b></div><div><span>Jumlah BKU</span><b>${lastData.bkuCount}</b></div></div>`+
    `<div class="dx2-split" title="SIPLah vs Non-SIPLah"><i style="width:${(t.siplah/t.grandTotal*100).toFixed(1)}%"></i><i class="o" style="width:${(t.non/t.grandTotal*100).toFixed(1)}%"></i></div>`+
    `<div class="dx2-split-l tax"><span><s></s>SIPLah ${pctOf(t.siplah,t.grandTotal)}</span><span><s class="o"></s>Non-SIPLah ${pctOf(t.non,t.grandTotal)}</span></div>`+
    `<div class="dx2-sub">Rincian per jenis pajak</div><ul class="dx2-types">${types.map(([k,v],i)=>{const c=TAX_COL[i%TAX_COL.length];return `<li><s style="background:${c}"></s><span>${E(k)}<small>${v.count} transaksi${v.siplah&&v.non?' • SIPLah '+money(v.siplah)+' / Non '+money(v.non):v.siplah?' • SIPLah':' • Non-SIPLah'}</small></span><b>${money(v.amount)}</b><u style="width:${(v.amount/maxT*100).toFixed(1)}%;background:${c}"></u></li>`;}).join('')}</ul>`+
    `<div class="dx2-sub">Tren pajak per bulan • ${E(lastData.yearText)} <small>(klik bulan untuk memfilter)</small></div>${trendHtml('tax','#14a468','pajak')}`;
}

function toggleCat(c){
  categoryFilter=categoryFilter===c?'all':c;tablePage=1;
  setDashboardView('details');
  const sel=document.getElementById('dashCategoryFilter');if(sel)sel.value=categoryFilter;
  paintComposition();drawTable();
}
document.addEventListener('click',e=>{
  const bar=e.target.closest?e.target.closest('.dx2-tbar'):null;
  if(bar){const id='m'+bar.dataset.month;periodFilter=periodFilter===id?'all':id;renderDashboard();return;}
  const li=e.target.closest?e.target.closest('.dx2-leg'):null;
  if(li)toggleCat(li.dataset.cat);
});
document.addEventListener('keydown',e=>{
  const t=e.target;
  if((e.key==='Enter'||e.key===' ')&&t.classList&&t.classList.contains('dx2-leg')){e.preventDefault();toggleCat(t.dataset.cat);}
});
const compHost=document.getElementById('dashComposition');
if(compHost){
  const reset=()=>{const h=compHost.querySelector('.dx-donut-hole');if(h){h.querySelector('span').textContent=h.dataset.l;h.querySelector('b').textContent=h.dataset.v;}};
  compHost.addEventListener('mouseover',e=>{
    const h=compHost.querySelector('.dx-donut-hole');if(!h||!lastData)return;
    const li=e.target.closest('.dx2-leg');if(!li){reset();return;}
    const r=lastData.comp.rows.find(x=>x[0]===li.dataset.cat);
    h.querySelector('span').textContent=CAT_SHORT[li.dataset.cat]||'';h.querySelector('b').textContent=money(r?r[1]:0);
  });
  compHost.addEventListener('mouseleave',reset);
}
document.addEventListener('visibilitychange',()=>{
  if(!document.hidden&&document.getElementById('tabDashboard')?.classList.contains('active'))renderDashboard();
});

async function renderDashboard(){
  const tbody=document.getElementById('dashboardTableBody');
  if(!tbody||typeof ns.getAllProjects!=='function')return;
  try{
    const rawProjects=await ns.getAllProjects();
    // Urutkan pekerjaan berdasarkan tahun & bulan BKU
    const projects=typeof ns.sortProjectsByMonth==='function'?ns.sortProjectsByMonth(rawProjects):rawProjects;
    const aggs=projects.map(aggregateProject);

    // Pilihan tahun dari data yang ada
    const years=[...new Set(aggs.map(a=>a.info.year).filter(Boolean))].sort((x,y)=>x-y);
    if(yearFilter==='auto')yearFilter=years.length?String(years[years.length-1]):'all';
    if(yearFilter!=='all'&&!years.includes(Number(yearFilter)))yearFilter=years.length?String(years[years.length-1]):'all';
    const yearSel=document.getElementById('dashYearFilter');
    if(yearSel){
      yearSel.innerHTML='<option value="all">Semua tahun</option>'+years.map(y=>`<option value="${y}">${y}</option>`).join('');
      yearSel.value=yearFilter;
    }
    const periodSel=document.getElementById('dashPeriodFilter');
    if(periodSel)periodSel.value=periodFilter;

    const yearAggs=aggs.filter(a=>yearFilter==='all'||String(a.info.year)===yearFilter);
    const yearText=yearFilter==='all'?'Semua tahun':'Tahun '+yearFilter;
    ['dashRecapTahapYear','dashRecapTwYear'].forEach(id=>{const el=document.getElementById(id);if(el)el.textContent='• '+yearText;});
    drawRecap('dashRecapTahapBody',TAHAP,yearAggs,yearText);
    drawRecap('dashRecapTwBody',TRIWULAN,yearAggs,yearText);

    // Filter periode (bulan / triwulan / tahap)
    const def=periodDef(periodFilter);
    const targetAggs=def?yearAggs.filter(a=>a.info.month!==999&&inRange(a,def)):yearAggs;
    const activeMonthName=(def?def.label:'Semua Periode')+(yearFilter!=='all'?' '+yearFilter:'');

    const savedSPMUs=targetAggs.flatMap(a=>a.items).sort((a,b)=>b.savedAt-a.savedAt);
    const detailCount=document.getElementById('dashDetailCount');if(detailCount)detailCount.textContent=savedSPMUs.length;
    tablePage=1;
    const sums={[CATEGORY.modalMesin]:0,[CATEGORY.modalLain]:0,[CATEGORY.operBarang]:0,[CATEGORY.operPegawai]:0};
    savedSPMUs.forEach(item=>{if(item.category in sums)sums[item.category]+=item.nominal;});

    const taxSummary=targetAggs.reduce((acc,a)=>{
      acc.siplah+=a.tax.siplah;acc.non+=a.tax.non;acc.grandTotal+=a.tax.grand;acc.count+=a.tax.count;acc.sCount+=a.tax.sCount;
      Object.entries(a.tax.byType).forEach(([k,v])=>{const b=acc.byType[k]||(acc.byType[k]={amount:0,count:0,siplah:0,non:0});b.amount+=v.amount;b.count+=v.count;b.siplah+=v.siplah;b.non+=v.non;});
      return acc;
    },{siplah:0,non:0,grandTotal:0,count:0,sCount:0,byType:{}});

    const set=(id,v)=>{const el=document.getElementById(id);if(el)el.textContent=v};
    tween('dashProjectCount',savedSPMUs.length,v=>String(Math.round(v)));
    tween('dashModalTotal',sums[CATEGORY.modalMesin]+sums[CATEGORY.modalLain]);
    tween('dashOperasionalTotal',sums[CATEGORY.operBarang]+sums[CATEGORY.operPegawai]);
    tween('dashTaxSiplah',taxSummary.siplah);
    tween('dashTaxNonSiplah',taxSummary.non);
    tween('dashTaxTotal',taxSummary.grandTotal);

    set('dashTaxDetail',`${taxSummary.count} transaksi pajak • ${targetAggs.length} BKU`);
    set('dashUpdated',def||yearFilter!=='all'
      ?`Filter: ${activeMonthName} • ${targetAggs.length} BKU`
      :`Diperbarui ${new Date().toLocaleString('id-ID',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'})} • ${projects.length} pekerjaan`);

    const cm=document.getElementById('chartModal'),co=document.getElementById('chartOperasional');
    const categoryRows=Object.entries(sums); 
    const categoryTotal=categoryRows.reduce((a,[,v])=>a+v,0);
    const dataBody=document.getElementById('categoryDataBody');
    if(dataBody)dataBody.innerHTML=categoryRows.map(([name,value])=>`<tr><td>${pill(name)}</td><td class="num">${money(value)}</td><td class="num">${categoryTotal>0?(value/categoryTotal*100).toLocaleString('id-ID',{maximumFractionDigits:1})+'%':'0%'}</td></tr>`).join('')+`<tr class="dash-total-row"><td>Total</td><td class="num">${money(categoryTotal)}</td><td class="num">${categoryTotal>0?'100%':'0%'}</td></tr>`;
    
    const COL={c1:'#3159d9',c2:'#8b5cf6',c3:'#0ea5a4',c4:'#f59e0b'};
    const pct=v=>categoryTotal>0?(v/categoryTotal*100).toLocaleString('id-ID',{maximumFractionDigits:1})+'%':'0%';
    const modalSum=sums[CATEGORY.modalMesin]+sums[CATEGORY.modalLain],operSum=sums[CATEGORY.operBarang]+sums[CATEGORY.operPegawai];
    set('dashSpendTotal',money(categoryTotal));
    const unknown=yearAggs.filter(a=>a.info.month===999).length;
    set('dashCoverage',`${targetAggs.length} BKU tersimpan${unknown?' • '+unknown+' BKU tanpa bulan, tidak masuk rekap periodik':''}`);
    set('dashModalPct',pct(modalSum)+' dari total');
    set('dashOperPct',pct(operSum)+' dari total');
    set('dashProjectHint',savedSPMUs.length?`Total nilai (${activeMonthName}) `+money(categoryTotal):'Belum ada data');

    const monthly=Array.from({length:12},()=>({spend:0,tax:0}));
    yearAggs.forEach(g=>{const m=g.info.month;if(m>=1&&m<=12){monthly[m-1].spend+=Object.values(g.sums).reduce((x,y)=>x+y,0);monthly[m-1].tax+=g.tax.grand;}});
    lastData={comp:{rows:categoryRows,total:categoryTotal,period:activeMonthName,items:savedSPMUs},tax:taxSummary,monthly,def,yearText,bkuCount:targetAggs.length};
    paintComposition();paintTax();

    const mm=Math.max(sums[CATEGORY.modalMesin],sums[CATEGORY.modalLain]), om=Math.max(sums[CATEGORY.operBarang],sums[CATEGORY.operPegawai]);
    if(cm)cm.innerHTML=barHtml('Peralatan dan Mesin',sums[CATEGORY.modalMesin],mm)+barHtml('Aset Tetap Lainya',sums[CATEGORY.modalLain],mm);
    if(co)co.innerHTML=barHtml('Barang dan Jasa',sums[CATEGORY.operBarang],om)+barHtml('Pegawai',sums[CATEGORY.operPegawai],om);

    allItems=savedSPMUs;
    drawTable();
  }catch(e){
    if(tbody)tbody.innerHTML=`<tr><td colspan="6" class="empty">Gagal membaca rekap: ${ns.esc(e?.message||e)}</td></tr>`;
  }
}

// Independent switch groups: install each listener once, never cross-toggle groups.
function initSwitches(buttonSelector,panelSelector,buttonKey,panelKey){
  const buttons=[...document.querySelectorAll(buttonSelector)];
  const panels=[...document.querySelectorAll(panelSelector)];
  const activate=name=>{
    buttons.forEach(b=>{const on=b.dataset[buttonKey]===name;b.classList.toggle('active',on);b.setAttribute('aria-pressed',String(on));});
    panels.forEach(p=>{p.hidden=p.dataset[panelKey]!==name;});
  };
  buttons.forEach(b=>b.addEventListener('click',()=>activate(b.dataset[buttonKey])));
  if(buttons.length)activate(buttons.find(b=>b.classList.contains('active'))?.dataset[buttonKey]||buttons[0].dataset[buttonKey]);
}
initSwitches('#tabDashboard .recap-switch [data-recap]','#tabDashboard [data-recap-panel]','recap','recapPanel');
const categoryButtons=[...document.querySelectorAll('#tabDashboard .category-switch [data-view]')];
categoryButtons.forEach(btn=>btn.addEventListener('click',()=>{
  const view=btn.dataset.view==='data'?'data':'chart';
  categoryButtons.forEach(b=>{b.classList.toggle('active',b===btn);b.setAttribute('aria-pressed',String(b===btn));});
  const chart=document.getElementById('categoryChartView'),data=document.getElementById('categoryDataView');
  if(chart)chart.hidden=view!=='chart';if(data)data.hidden=view!=='data';
}));
categoryButtons.forEach(b=>b.setAttribute('aria-pressed',String(b.classList.contains('active'))));
const dashboardTabs=[...document.querySelectorAll('#tabDashboard [data-dash-view]')];
const dashboardPanels=[...document.querySelectorAll('#tabDashboard [data-dash-panel]')];
function setDashboardView(name,focus=false){
  if(!dashboardTabs.some(b=>b.dataset.dashView===name))return;
  dashboardTabs.forEach(b=>{const on=b.dataset.dashView===name;b.setAttribute('aria-selected',String(on));b.tabIndex=on?0:-1;if(on&&focus)b.focus();});
  dashboardPanels.forEach(p=>{p.hidden=p.dataset.dashPanel!==name;});
}
dashboardTabs.forEach((b,i)=>{
  b.addEventListener('click',()=>setDashboardView(b.dataset.dashView));
  b.addEventListener('keydown',e=>{
    let n;if(e.key==='ArrowRight')n=(i+1)%dashboardTabs.length;else if(e.key==='ArrowLeft')n=(i+dashboardTabs.length-1)%dashboardTabs.length;else if(e.key==='Home')n=0;else if(e.key==='End')n=dashboardTabs.length-1;else return;
    e.preventDefault();setDashboardView(dashboardTabs[n].dataset.dashView,true);
  });
});
document.getElementById('dashboardRefreshBtn')?.addEventListener('click',renderDashboard);

Object.assign(ns,{renderDashboard});
})(window.SPMU=window.SPMU||{});