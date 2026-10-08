(function(ns){
'use strict';
const {state}=ns;
function exportXlsx(){const data=state.rows.map((r,i)=>({No:i+1,Tanggal:r.tanggal,'No. Bukti':r.noBukti,Uraian:r.uraian,Pengeluaran:r.pengeluaran}));const ws=window.XLSX.utils.json_to_sheet(data);const wb=window.XLSX.utils.book_new();window.XLSX.utils.book_append_sheet(wb,ws,'Pengeluaran');window.XLSX.writeFile(wb,'BKU_HASIL_AKURAT.xlsx');}
function exportRawXlsx(){
  const data=(state.rawRows||[]).map((r,i)=>({No:i+1,Tanggal:r.tanggal,'No. Bukti':r.noBukti,'Nama Barang / Kegiatan':r.uraian,Harga:r.pengeluaran,Source:r.source||''}));
  if(!data.length)return;
  const ws=window.XLSX.utils.json_to_sheet(data);const wb=window.XLSX.utils.book_new();window.XLSX.utils.book_append_sheet(wb,ws,'Data Murni');window.XLSX.writeFile(wb,'BKU_DATA_MURNI_TANPA_GABUNG.xlsx');
}
Object.assign(ns,{exportXlsx,exportRawXlsx});
})(window.SPMU=window.SPMU||{});
