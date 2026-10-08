(function(ns){
'use strict';
const {$,state}=ns;

const sv={page:1,zoom:1,total:0,fitted:false,lastRow:null};
function svApply(){
  const pv=$('suratPreview');
  const pages=[...pv.querySelectorAll('.surat-page')];
  sv.total=pages.length;
  if(sv.page>sv.total)sv.page=sv.total;
  if(sv.page<1)sv.page=1;
  pages.forEach((pg,i)=>pg.classList.toggle('sv-hidden',i!==sv.page-1));
  pv.style.setProperty('--sv-zoom',String(sv.zoom));
  $('svPageInfo').innerHTML=sv.total?`Halaman <b>${sv.page} / ${sv.total}</b>`:'Halaman <b>– / –</b>';
  $('svZoomInfo').innerHTML=`Zoom <b>${Math.round(sv.zoom*100)}%</b>`;
  $('svPrevPage').disabled=!sv.total||sv.page<=1;
  $('svNextPage').disabled=!sv.total||sv.page>=sv.total;
  $('svZoomOut').disabled=!sv.total||sv.zoom<=0.5;
  $('svZoomIn').disabled=!sv.total||sv.zoom>=2;
}
function suratViewerUpdate(){
  const pv=$('suratPreview');
  if(!pv)return;
  if(pv.style.display==='none'){sv.total=0;svApply();return;}
  const row=state.surat.rowIndex;
  if(sv.lastRow!==row){sv.page=1;sv.lastRow=row;}
  if(!sv.fitted){
    const stage=pv.parentElement;
    const w=stage?stage.clientWidth:0;
    if(w>0){
      const fit=(w-56)/794;
      sv.zoom=Math.max(0.5,Math.min(1,Math.floor(fit*20)/20));
      sv.fitted=true;
    }
  }
  svApply();
}
function svGo(d){sv.page+=d;svApply();const st=$('suratPreview').parentElement;if(st)st.scrollTop=0;}
function svZoom(d){sv.zoom=Math.min(2,Math.max(0.5,Math.round((sv.zoom+d)*100)/100));svApply();}
$('svPrevPage').addEventListener('click',()=>svGo(-1));
$('svNextPage').addEventListener('click',()=>svGo(1));
$('svZoomOut').addEventListener('click',()=>svZoom(-0.1));
$('svZoomIn').addEventListener('click',()=>svZoom(0.1));

function printSurat(){
  if(!state.rows.length)return;
  ns.renderSurat();
  const pages=$('suratPreview').querySelector('.surat-pages');
  if(!pages)return;
  const win=window.open('','_blank','width=900,height=1100');
  if(!win){
    $('status').textContent='Popup diblokir browser. Izinkan popup untuk mencetak / menyimpan PDF Surat Perintah.';
    return;
  }
  const styles=`
    @page{size:A4 portrait;margin:0}
    html,body{margin:0;padding:0;background:#fff}
    body{font-family:Arial,Helvetica,sans-serif;color:#000;-webkit-print-color-adjust:exact;print-color-adjust:exact}
    .surat-pages{display:block}
    .surat-page{
      position:relative;width:210mm;height:297mm;min-height:297mm;
      box-sizing:border-box;margin:0;padding:11mm 15mm 17mm;
      background:#fff;overflow:hidden;
      break-after:page;page-break-after:always;
    }
    .surat-page:last-child{break-after:auto;page-break-after:auto}
    .surat-page-content{height:269mm;overflow:hidden}
    .surat-page-footer{
      position:absolute;left:15mm;right:15mm;bottom:5mm;min-height:8mm;
      display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.8fr) auto;
      align-items:center;gap:4mm;
      border-top:1px solid #aaa;padding-top:1.5mm;box-sizing:border-box;
      font-size:8pt;font-style:italic;line-height:1.15;
    }
    .surat-page-footer .sf-bku{justify-self:start;white-space:nowrap}
    .surat-page-footer .sf-category{justify-self:center;text-align:center;min-width:0;overflow-wrap:anywhere;word-break:break-word}
    .surat-page-footer .sf-page{justify-self:end;white-space:nowrap}
    .surat-bku-box{position:absolute;top:4mm;right:7mm;width:22mm;min-width:22mm;height:6mm;padding:0 2mm;box-sizing:border-box;border:1.25px solid #000;display:flex;align-items:center;justify-content:center;font-size:9pt;font-weight:700;color:#000;background:#fff;z-index:10}
    .page-block{break-inside:avoid;page-break-inside:avoid}
    .uraian-table-block{break-inside:auto;page-break-inside:auto}
    .surat-uraian-table{break-inside:auto;page-break-inside:auto}
    .kop{position:relative;min-height:27mm;padding:0 22mm 3mm;text-align:center;border-bottom:3px double #000;box-sizing:border-box;width:100%;max-width:100%}
    .surat-page .kop .kop-logo{position:absolute;top:1mm;width:18mm;height:18mm;object-fit:contain;display:block}
    .surat-page .kop .kop-logo-kabupaten{left:0!important;right:auto!important}
    .surat-page .kop .kop-logo-sekolah{right:0!important;left:auto!important}
    .kop .prov{font-size:13.5pt;font-weight:700;line-height:1.15;word-break:break-word;overflow-wrap:break-word}
    .kop .school{font-size:14pt;font-weight:700;line-height:1.2;margin-top:2px;text-transform:uppercase;word-break:break-word;overflow-wrap:break-word;max-width:100%}
    .kop .addr,.kop .mail{font-size:8.5pt;line-height:1.35;word-break:break-word;overflow-wrap:break-word;max-width:100%}
    .paper h2,h2{text-align:center;font-size:15pt;line-height:1.2;margin:7mm 0 1.5mm;text-decoration:underline}
    .nomor{text-align:center;font-size:11pt;line-height:1.2;margin-bottom:8mm}
    .surat-page p{font-size:11pt;line-height:1.45;margin:4mm 0}
     .identity .line{display:grid;grid-template-columns:42mm 5mm minmax(0,1fr);margin:2.5mm 0;font-size:11pt;line-height:1.35}.identity .line>.colon{text-align:center}
    .payment{margin:0}.payment .row{display:grid;grid-template-columns:52mm 5mm minmax(0,1fr);column-gap:1.5mm;margin:2.6mm 0;font-size:11pt;line-height:1.4;align-items:start}.payment .row>b,.payment .row>.colon{white-space:nowrap}.payment .row>.colon{text-align:center}
    .payment .row>span:last-child,.payment .row>div:last-child{min-width:0;overflow-wrap:anywhere;word-break:break-word;white-space:pre-wrap}.payment-heading{margin:5mm 0 2.5mm!important}.amount{font-weight:700;white-space:nowrap}.terbilang{text-transform:capitalize;font-style:italic}
    .uraian-heading-block{margin-top:1mm}.uraian-label-row{margin-bottom:1mm!important}.uraian-item-wrap{margin-left:58.5mm}.uraian-item{display:grid;grid-template-columns:7mm minmax(0,1fr);column-gap:2mm;margin:1.4mm 0;line-height:1.45}.uraian-no{font-weight:700}.uraian-text{min-width:0;overflow-wrap:anywhere;word-break:break-word}
    /* FIX: tabel Uraian harus ikut tampil saat CETAK / SIMPAN PDF */
    .uraian-table-block{display:block!important;visibility:visible!important;opacity:1!important;overflow:visible!important}
    .surat-uraian-table-wrap{display:block!important;visibility:visible!important;opacity:1!important;margin-left:58.5mm;margin-top:1mm;max-width:calc(100% - 58.5mm);width:calc(100% - 58.5mm);overflow:visible!important}
    .surat-uraian-table{display:table!important;visibility:visible!important;opacity:1!important;width:100%;border-collapse:collapse;table-layout:fixed;font-size:10.5pt;color:#000!important}
    .surat-uraian-table th,.surat-uraian-table td{border:1px solid #000!important;padding:1.7mm 2mm;vertical-align:top;line-height:1.3;color:#000!important;background:#fff!important}
    .surat-uraian-table thead{display:table-header-group!important}
    .surat-uraian-table tbody{display:table-row-group!important}
    .surat-uraian-table tr{display:table-row!important;break-inside:avoid;page-break-inside:avoid}
    .surat-uraian-table th{font-weight:700;text-align:center}
    .surat-uraian-table th:first-child,.surat-uraian-table td:first-child{width:11mm;text-align:center}
    .surat-uraian-table th:last-child,.surat-uraian-table td:last-child{width:34mm;text-align:right;white-space:nowrap}
    .surat-uraian-table td:nth-child(2){text-align:left;overflow-wrap:anywhere;word-break:break-word;white-space:normal}
    .surat-uraian-table tfoot{display:table-footer-group!important}
    .surat-uraian-table tfoot td{font-weight:700}
    .surat-uraian-table tfoot td:last-child{text-align:right}
    .sign{width:62mm;margin:14mm 0 0 auto;text-align:center;font-size:11pt;line-height:1.25}
    .sign img{width:48mm;height:27mm;object-fit:contain;display:block;margin:1mm auto -1mm}.sign .name{font-weight:700;text-decoration:underline}
  `+(ns.KWITANSI_PRINT_CSS||'');
  const clone=pages.cloneNode(true);
  clone.querySelectorAll('img').forEach(img=>{
    const src=img.getAttribute('src');
    if(src){try{img.setAttribute('src',new URL(src,location.href).href);}catch(_){}}
  });
  const childScript='<scr'+'ipt>window.addEventListener("load",()=>setTimeout(()=>window.print(),180));window.addEventListener("afterprint",()=>setTimeout(()=>window.close(),120));</scr'+'ipt>';
  const doc=`<!doctype html><html><head><meta charset="utf-8"><title>${state.docMode==='kwitansi'?'Kwitansi':'Surat Perintah'}</title><style>${styles}</style></head><body>${clone.outerHTML}${childScript}</body></html>`;
  win.document.open();win.document.write(doc);win.document.close();
}


function openBatchPrintDialog(){
  if(!state.rows.length)return;
  try{ns.readSuratFields();ns.captureCurrentSuratDraft?.();}catch(_){ }
  const modal=$('batchPrintModal');
  if(!modal)return;
  const list=$('batchPrintList');
  const count=$('batchPrintCount');
  const action=$('batchPrintAction');
  const onlyBpu=$('batchFilterBpu'),onlyBnu=$('batchFilterBnu');
  let filter='ALL';
  const render=()=>{
    const items=state.rows.map((r,i)=>({r,i})).filter(({r})=>{
      if(filter==='ALL')return true;
      return cleanBatchType(r?.noBukti)===filter;
    });
    if(!items.length){list.innerHTML='<div class="batch-empty">Tidak ada No. Bukti sesuai filter.</div>';count.textContent='0 dipilih';if(action)action.disabled=true;return;}
    list.innerHTML=items.map(({r,i})=>{
      const draft=ns.getSuratDraft?.(i);
      const ready=ns.suratDraftReady?.(i);
      const label=ready?'Lengkap & tersimpan':(draft?'Belum lengkap':'Belum disimpan');
      const cls=ready?'ready':'not-ready';
      return `<label class="batch-item ${cls}"><input type="checkbox" class="batch-check" value="${i}" ${ready?'checked':''}><span class="batch-main"><b>${escBatch(r.noBukti||'Tanpa No. Bukti')}</b><span>${escBatch(r.tanggal||'')} • ${escBatch(String(r.uraian||'').slice(0,120))}</span></span><span class="batch-status">${label}</span></label>`;
    }).join('');
    sync();
  };
  const sync=()=>{
    const checks=[...list.querySelectorAll('.batch-check')];
    const selected=checks.filter(c=>c.checked).map(c=>Number(c.value));
    const invalid=selected.some(i=>!ns.suratDraftReady?.(i));
    count.textContent=`${selected.length} dipilih`;
    if(action)action.disabled=!selected.length||invalid;
    const reason=$('batchPrintHint');
    if(reason)reason.textContent=invalid?'Pilih hanya surat dengan status “Lengkap & tersimpan”.':'Semua surat yang dipilih siap dicetak / disimpan sebagai PDF.';
  };
  list.onclick=e=>{if(e.target?.classList?.contains('batch-check'))sync();};
  $('batchSelectAll').onclick=()=>{list.querySelectorAll('.batch-check').forEach(c=>c.checked=ns.suratDraftReady?.(Number(c.value)));sync();};
  $('batchClearAll').onclick=()=>{list.querySelectorAll('.batch-check').forEach(c=>c.checked=false);sync();};
  $('batchFilterAll').onclick=()=>{filter='ALL';setBatchFilterButtons();render();};
  $('batchFilterBpu').onclick=()=>{filter='BPU';setBatchFilterButtons();render();};
  $('batchFilterBnu').onclick=()=>{filter='BNU';setBatchFilterButtons();render();};
  $('batchPrintCancel').onclick=()=>{modal.style.display='none';modal.setAttribute('aria-hidden','true');};
  $('batchPrintAction').onclick=()=>{
    const selected=[...list.querySelectorAll('.batch-check:checked')].map(c=>Number(c.value));
    if(!selected.length||selected.some(i=>!ns.suratDraftReady?.(i)))return;
    printBatchSurat(selected,document.querySelector('input[name="batchDocType"]:checked')?.value||'surat');
  };
  function setBatchFilterButtons(){
    for(const [id,val] of [['batchFilterAll','ALL'],['batchFilterBpu','BPU'],['batchFilterBnu','BNU']])$(id)?.classList.toggle('active',filter===val);
  }
  list.onchange=sync;
  list.ondblclick=undefined;
  modal.style.display='flex';modal.setAttribute('aria-hidden','false');
  setBatchFilterButtons();render();
}
function cleanBatchType(v){
  const m=String(v||'').trim().toUpperCase().match(/^(BPU|BNU)/);
  return m?m[1]:'';
}
function escBatch(v){return String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));}
function printBatchSurat(indices,docType='surat'){
  if(!Array.isArray(indices)||!indices.length)return;
  const master=document.createElement('div');master.className='surat-pages';
  const added=[];
  for(const idx of indices){
    if(!ns.suratDraftReady?.(idx))continue;
    const sets=[];
    if(docType!=='kwitansi')sets.push(ns.buildSuratPagesForIndex?.(idx));
    if(docType!=='surat')sets.push(ns.buildKwitansiPagesForIndex?.(idx));
    for(const pages of sets){
      if(!pages)continue;
      [...pages.querySelectorAll('.surat-page')].forEach(pg=>{master.appendChild(pg.cloneNode(true));added.push(idx);});
      if(pages.parentNode)pages.parentNode.removeChild(pages);
    }
  }
  if(!added.length){window.alert('Tidak ada surat yang lengkap dan tersimpan untuk dicetak.');return;}
  const win=window.open('','_blank','width=900,height=1100');
  if(!win){$('status').textContent='Popup diblokir browser. Izinkan popup untuk cetak / simpan PDF massal.';return;}
  const styles=`
    @page{size:A4 portrait;margin:0}
    html,body{margin:0;padding:0;background:#fff}
    body{font-family:Arial,Helvetica,sans-serif;color:#000;-webkit-print-color-adjust:exact;print-color-adjust:exact}
    .surat-pages{display:block}
    .surat-page{position:relative;width:210mm;height:297mm;min-height:297mm;box-sizing:border-box;margin:0;padding:11mm 15mm 17mm;background:#fff;overflow:hidden;break-after:page;page-break-after:always}
    .surat-page:last-child{break-after:auto;page-break-after:auto}
    .surat-page-content{height:269mm;overflow:hidden}
    .surat-page-footer{position:absolute;left:15mm;right:15mm;bottom:4mm;min-height:9mm;display:grid;grid-template-columns:minmax(34mm,1fr) minmax(55mm,1.6fr) minmax(28mm,auto);align-items:center;gap:3mm;border-top:1px solid #aaa;padding:1.5mm 0 0;box-sizing:border-box;font-size:7.5pt;font-style:italic;line-height:1.2;z-index:20;background:#fff}
    .surat-page-footer .sf-bku{justify-self:start;white-space:normal;overflow-wrap:anywhere;word-break:break-word;min-width:0}
    .surat-page-footer .sf-category{justify-self:center;text-align:center;min-width:0;max-width:100%;overflow-wrap:anywhere;word-break:break-word}
    .surat-page-footer .sf-page{justify-self:end;white-space:nowrap}
    .surat-bku-box{position:absolute;top:4mm;right:7mm;width:22mm;min-width:22mm;height:6mm;padding:0 2mm;box-sizing:border-box;border:1.25px solid #000;display:flex;align-items:center;justify-content:center;font-size:9pt;font-weight:700;color:#000;background:#fff;z-index:10}
    .page-block{break-inside:avoid;page-break-inside:avoid}
    .uraian-table-block{break-inside:auto;page-break-inside:auto}
    .surat-uraian-table{break-inside:auto;page-break-inside:auto}
    .kop{position:relative;min-height:27mm;padding:0 22mm 3mm;text-align:center;border-bottom:3px double #000;box-sizing:border-box;width:100%;max-width:100%}
    .surat-page .kop .kop-logo{position:absolute;top:1mm;width:18mm;height:18mm;object-fit:contain;display:block}.surat-page .kop .kop-logo-kabupaten{left:0!important;right:auto!important}.surat-page .kop .kop-logo-sekolah{right:0!important;left:auto!important}
    .kop .prov{font-size:13.5pt;font-weight:700;line-height:1.15;word-break:break-word;overflow-wrap:break-word}.kop .school{font-size:14pt;font-weight:700;line-height:1.2;margin-top:2px;text-transform:uppercase;word-break:break-word;overflow-wrap:break-word;max-width:100%}.kop .kab{font-size:12pt;font-weight:700;line-height:1.15}.kop .addr,.kop .mail{font-size:8.5pt;line-height:1.35;word-break:break-word;overflow-wrap:break-word;max-width:100%}
    h2{text-align:center;font-size:15pt;line-height:1.2;margin:7mm 0 1.5mm;text-decoration:underline}.nomor{text-align:center;font-size:11pt;line-height:1.2;margin-bottom:8mm}.surat-page p{font-size:11pt;line-height:1.45;margin:4mm 0}
    .identity .line{display:grid;grid-template-columns:42mm 5mm minmax(0,1fr);margin:2.5mm 0;font-size:11pt;line-height:1.35}.identity .line>.colon{text-align:center}
    .payment{margin:0}.payment .row{display:grid;grid-template-columns:52mm 5mm minmax(0,1fr);column-gap:1.5mm;margin:2.6mm 0;font-size:11pt;line-height:1.4;align-items:start}.payment .row>b,.payment .row>.colon{white-space:nowrap}.payment .row>.colon{text-align:center}.payment .row>span:last-child,.payment .row>div:last-child{min-width:0;overflow-wrap:anywhere;word-break:break-word;white-space:pre-wrap}.payment-heading{margin:5mm 0 2.5mm!important}.amount{font-weight:700;white-space:nowrap}.terbilang{text-transform:capitalize;font-style:italic}
    .uraian-heading-block{margin-top:1mm}.surat-uraian-table-wrap{display:block!important;visibility:visible!important;opacity:1!important;margin-left:58.5mm;margin-top:1mm;max-width:calc(100% - 58.5mm);width:calc(100% - 58.5mm);overflow:visible!important}.surat-uraian-table{display:table!important;visibility:visible!important;opacity:1!important;width:100%;border-collapse:collapse;table-layout:fixed;font-size:10.5pt;color:#000!important}.surat-uraian-table th,.surat-uraian-table td{border:1px solid #000!important;padding:1.7mm 2mm;vertical-align:top;line-height:1.3;color:#000!important;background:#fff!important}.surat-uraian-table thead{display:table-header-group!important}.surat-uraian-table tbody{display:table-row-group!important}.surat-uraian-table tr{display:table-row!important;break-inside:avoid;page-break-inside:avoid}.surat-uraian-table th{font-weight:700;text-align:center}.surat-uraian-table th:first-child,.surat-uraian-table td:first-child{width:11mm;text-align:center}.surat-uraian-table th:last-child,.surat-uraian-table td:last-child{width:34mm;text-align:right;white-space:nowrap}.surat-uraian-table td:nth-child(2){text-align:left;overflow-wrap:anywhere;word-break:break-word;white-space:normal}.surat-uraian-table tfoot{display:table-footer-group!important}.surat-uraian-table tfoot td{font-weight:700}.surat-uraian-table tfoot td:last-child{text-align:right}
    .sign{width:62mm;margin:14mm 0 0 auto;text-align:center;font-size:11pt;line-height:1.25}.sign img{width:48mm;height:27mm;object-fit:contain;display:block;margin:1mm auto -1mm}.sign .name{font-weight:700;text-decoration:underline}
  `+(ns.KWITANSI_PRINT_CSS||'');
  const clone=master.cloneNode(true);
  clone.querySelectorAll('img').forEach(img=>{const src=img.getAttribute('src');if(src){try{img.setAttribute('src',new URL(src,location.href).href);}catch(_){}}});
  const childScript='<scr'+'ipt>window.addEventListener("load",()=>setTimeout(()=>window.print(),180));window.addEventListener("afterprint",()=>setTimeout(()=>window.close(),120));</scr'+'ipt>';
  const doc=`<!doctype html><html><head><meta charset="utf-8"><title>${docType==='kwitansi'?'Kwitansi Massal':docType==='both'?'SPMU + Kwitansi Massal':'SPMU Massal'}</title><style>${styles}</style></head><body>${clone.outerHTML}${childScript}</body></html>`;
  win.document.open();win.document.write(doc);win.document.close();
  $('batchPrintModal').style.display='none';$('batchPrintModal').setAttribute('aria-hidden','true');
}

Object.assign(ns,{sv,svApply,suratViewerUpdate,svGo,svZoom,printSurat,openBatchPrintDialog,printBatchSurat});
})(window.SPMU=window.SPMU||{});
