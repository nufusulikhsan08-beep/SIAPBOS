(function(ns){
'use strict';

const $ = id => document.getElementById(id);
const state = {
  file:null, rows:[], rawRows:[], result:null, search:"", category:"",
  identity:{school:"",kecamatan:"",alamat:"",npsn:"",headName:"",headNip:"",treasurerName:"",treasurerNip:"",kabupaten:"",provinsi:""},
  surat:{rowIndex:-1,bukti:"",nomor:"SD.123",tanggal:"",sd:"",kecamatan:"",alamat:"",email:"",npsn:"",nss:"",bendahara:"",nipBendahara:"",kepada:"",uraian:"",untukPembayaran:"",kepala:"",nipKepala:"",tandaTangan:"",tandaTanganBendahara:"",logoSekolah:"",logoKabupaten:"assets/logo_kabupaten_serang.png"},
  suratByBukti:{}
};
if(window.pdfjsLib){ window.pdfjsLib.GlobalWorkerOptions.workerSrc=''; }

const SURAT_FIELD_KEYS=['bukti','nomor','tanggal','sd','kecamatan','alamat','email','npsn','nss','bendahara','nipBendahara','kepada','uraian','untukPembayaran','kepala','nipKepala'];
function suratElement(key){
  const ids={sd:'suratSD',kecamatan:'suratKecamatan',alamat:'suratAlamat',email:'suratEmail',npsn:'suratNpsn',nss:'suratNss',bendahara:'suratBendahara',nipBendahara:'suratNipBendahara',kepada:'suratKepada',uraian:'suratUraian',untukPembayaran:'suratUntukPembayaran',kepala:'suratKepala',nipKepala:'suratNipKepala',nomor:'suratNomor',tanggal:'suratTanggal',bukti:'suratBukti'};
  return $(ids[key] || ('surat'+key.charAt(0).toUpperCase()+key.slice(1)));
}
function setTab(name){
  const isDashboard=name==='dashboard', isBku=name==='bku', isSurat=name==='surat', isPajak=name==='pajak';
  if($('tabDashboard'))$('tabDashboard').classList.toggle('active',isDashboard);
  $('tabBku').classList.toggle('active',isBku); $('tabSurat').classList.toggle('active',isSurat); $('tabPajak').classList.toggle('active',isPajak);
  if($('tabDashboardBtn')){ $('tabDashboardBtn').classList.toggle('active',isDashboard); $('tabDashboardBtn').setAttribute('aria-selected',String(isDashboard)); }
  $('tabBkuBtn').classList.toggle('active',isBku); $('tabSuratBtn').classList.toggle('active',isSurat); $('tabPajakBtn').classList.toggle('active',isPajak);
  $('tabBkuBtn').setAttribute('aria-selected',String(isBku));
  const context=$('topbarSectionName');
  if(context)context.textContent=isDashboard?'Dashboard SPMU':isBku?'Ekstraksi BKU':isSurat?'Surat Perintah':isPajak?'Hitung Pajak':'SIAP BOS'; $('tabSuratBtn').setAttribute('aria-selected',String(isSurat)); $('tabPajakBtn').setAttribute('aria-selected',String(isPajak));
}
function setSuratTabLocked(locked){
  const btn=$('tabSuratBtn'); btn.disabled=locked; btn.classList.toggle('locked',locked);
  if(locked && $('tabSurat').classList.contains('active')) setTab('bku');
}
function setPajakTabLocked(locked){
  const btn=$('tabPajakBtn'); btn.disabled=locked; btn.classList.toggle('locked',locked);
  if(locked && $('tabPajak').classList.contains('active')) setTab('bku');
}
function esc(s){return String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));}

Object.assign(ns,{ $,state,SURAT_FIELD_KEYS,suratElement,setTab,setSuratTabLocked,setPajakTabLocked,esc });
})(window.SPMU=window.SPMU||{});
