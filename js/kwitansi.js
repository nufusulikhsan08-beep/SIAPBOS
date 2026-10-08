(function(ns){
'use strict';
const {$,state,esc,clean,formatMoney,dateToInput,dateDisplay,normalizeNoBukti,normalizeKecamatan}=ns;

state.docMode=state.docMode||'surat';

/* CSS kwitansi dipakai bersama oleh pratinjau (styles.css), Cetak/PDF, dan Cetak Massal. */
const KWITANSI_PRINT_CSS=`
.surat-page.kwitansi-page{font-family:Calibri,Carlito,"Segoe UI",Arial,sans-serif;font-size:11pt;line-height:1.35;padding:18mm 20mm 17mm}
.kwitansi-page .kwitansi-content{height:262mm;overflow:hidden}
.kwitansi-page .kw-title{text-align:center;font-size:17pt;font-weight:700;font-style:italic;letter-spacing:.12em;margin:0 0 9mm}
.kwitansi-page .kw-row{display:grid;grid-template-columns:44mm 5mm minmax(0,1fr);align-items:start;margin:0 0 2.6mm;font-size:11pt;line-height:1.4}
.kwitansi-page .kw-row .kw-c{text-align:left}
.kwitansi-page .kw-row .kw-v{min-width:0;overflow-wrap:anywhere;word-break:break-word;white-space:pre-wrap}
.kwitansi-page .kw-row .kw-v.kw-bold{font-weight:700}
.kwitansi-page .kw-row .kw-v.kw-italic{font-style:italic}
.kwitansi-page .kw-row.kw-cont{margin-top:-1mm}
.kwitansi-page .kw-box{display:inline-block;box-sizing:border-box;min-width:82mm;margin:9mm 0 0 3mm;padding:4.5mm 5mm;border:1px solid #000;border-right-width:2px;border-bottom-width:2px;font-style:italic;font-weight:700;font-size:12pt;white-space:nowrap}
.kwitansi-page .kw-box .kw-box-sep{display:inline-block;margin-left:10mm}
.kwitansi-page .kw-sign{display:grid;grid-template-columns:1fr 1fr 1fr;column-gap:6mm;margin-top:12mm;text-align:center;font-size:11pt;line-height:1.3}
.kwitansi-page .kw-sign .kw-space{height:24mm;display:flex;align-items:center;justify-content:center;overflow:hidden}
.kwitansi-page .kw-sign .kw-space img{max-width:100%;max-height:24mm;object-fit:contain;display:block}
.kwitansi-page .kw-sign .kw-name{font-weight:700;text-decoration:underline;min-height:1.3em;overflow-wrap:anywhere}
.kwitansi-page .kw-sign .kw-nip{font-size:10pt;min-height:1.3em}
`;

function titleCase(s){
  return String(s||'').toLocaleLowerCase('id-ID').replace(/(^|\s)(\S)/g,(m,a,b)=>a+b.toLocaleUpperCase('id-ID'));
}
/* Nama sekolah: huruf kapital di awal kata, singkatan jenjang (SD/SMP/MI/dst) tetap kapital. Contoh: SD Negeri Krian */
function schoolCase(s){
  return titleCase(s).replace(/\b(Sd|Smp|Sma|Smk|Mi|Mts|Ma|Tk|Paud|Sdn|Smpn|Sdit|Smpit)\b/g,m=>m.toLocaleUpperCase('id-ID'));
}
function dmy(s){
  const p=dateToInput(s).split('-');
  return p.length===3?`${p[2]}/${p[1]}/${p[0]}`:dateDisplay(s);
}

/* Semua isi kwitansi diturunkan dari transaksi (index baris BKU) yang sama dengan Surat Perintah. */
function kwitansiDataForIndex(index){
  const d=ns.suratDataForIndex(index);
  const dt=dateToInput(d.tanggal).split('-');
  const tahun=dt.length===3?dt[0]:'';
  const noBukti=clean(d.bukti||'').toLocaleUpperCase('id-ID');
  const school=ns.normalizeSchoolName(d.sd||'');
  const untuk=clean(d.untukPembayaran||'')||clean(d.untukPembayaran||'');
  return {
    nomor:`${noBukti||'-'}/BOSP/${tahun||''}`.replace(/\/$/,''),
    dari:school?`Bendahara BOSP ${schoolCase(school)}`:'Bendahara BOSP',
    nominal:d.nominal||0,
    banyaknya:titleCase(ns.moneyWords(d.nominal)),
    untuk,
    kepala:clean(d.kepala),nipKepala:clean(d.nipKepala),
    bendahara:clean(d.bendahara),nipBendahara:clean(d.nipBendahara),
    penerima:clean(d.kepada),
    tempat:normalizeKecamatan(d.kecamatan||''),
    tanggal:dmy(d.tanggal),
    bukti:d.bukti,
    category:clean(d.category||''),
    ttdKepala:state.surat?.tandaTangan||'assets/s_perintah_img_2.png',
    ttdBendahara:state.surat?.tandaTanganBendahara||''
  };
}

function kwitansiHtml(k){
  const row=(l,v,cls='')=>`<div class="kw-row"><span>${l}</span><span class="kw-c">:</span><span class="kw-v ${cls}">${v}</span></div>`;
  const nip=v=>v?`NIP. ${esc(v)}`:'&nbsp;';
  const ttd=(src,alt)=>src?`<img src="${esc(src)}" alt="${alt}">`:'';
  return `<div class="kw-title">K W I T A N S I</div>`+
    row('Nomor',esc(k.nomor))+
    row('Sudah Terima Dari',esc(k.dari))+
    row('Banyaknya Uang',esc(k.banyaknya),'kw-bold kw-italic')+
    row('Untuk Pembayaran',esc(k.untuk||'........................................................'))+
    `<div class="kw-row kw-cont"><span></span><span></span><span class="kw-v">Sebagaimana terlampir pada faktur</span></div>`+
    `<div class="kw-box">Total<span class="kw-box-sep">: Rp ${formatMoney(k.nominal)},-</span></div>`+
    `<div class="kw-sign">`+
      `<div><div>Mengetahui,</div><div>Kepala Sekolah</div><div class="kw-space">${ttd(k.ttdKepala,'Tanda tangan Kepala Sekolah')}</div><div class="kw-name">${esc(k.kepala)||'&nbsp;'}</div><div class="kw-nip">${nip(k.nipKepala)}</div></div>`+
      `<div><div>Lunas dibayar</div><div>Bendahara Sekolah,</div><div class="kw-space">${ttd(k.ttdBendahara,'Tanda tangan Bendahara')}</div><div class="kw-name">${esc(k.bendahara)||'&nbsp;'}</div><div class="kw-nip">${nip(k.nipBendahara)}</div></div>`+
      `<div><div>${esc([k.tempat,k.tanggal].filter(Boolean).join(', '))||'&nbsp;'}</div><div>Yang Menerima Uang,</div><div class="kw-space"></div><div class="kw-name">${esc(k.penerima)||'&nbsp;'}</div><div class="kw-nip">&nbsp;</div></div>`+
    `</div>`;
}

/* Mengembalikan elemen .surat-pages berisi 1 halaman A4, kompatibel dengan viewer & cetak yang sudah ada. */
function buildKwitansiPagesForIndex(index){
  const host=document.createElement('div');
  host.className='surat-pages';
  const data=kwitansiDataForIndex(index);
  const page=document.createElement('div');
  page.className='surat-page kwitansi-page';
  page.innerHTML='<div class="surat-page-content kwitansi-content"></div><div class="surat-page-footer"></div>';
  page.querySelector('.kwitansi-content').innerHTML=kwitansiHtml(data);
  host.appendChild(page);
  if(typeof ns.decorateSuratPages==='function')ns.decorateSuratPages(host,data.bukti,data.category);
  return host;
}

function setDocMode(mode){
  state.docMode=mode==='kwitansi'?'kwitansi':'surat';
  const k=state.docMode==='kwitansi';
  $('suratPreviewBtn')?.classList.toggle('sv-pill-active',!k);
  $('kwitansiPreviewBtn')?.classList.toggle('sv-pill-active',k);
  const t=$('svDocTitle');if(t)t.textContent=k?'Kwitansi hasil pratinjau':'Surat Perintah hasil pratinjau';
  ns.renderSurat();
}

Object.assign(ns,{KWITANSI_PRINT_CSS,kwitansiDataForIndex,kwitansiHtml,buildKwitansiPagesForIndex,setDocMode});
})(window.SPMU=window.SPMU||{});
