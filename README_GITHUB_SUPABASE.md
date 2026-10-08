# SIAP BOS v3 — GitHub Pages + Supabase

Versi ini sudah dipindahkan dari backend **Node.js + SQLite** ke:

**GitHub Pages (frontend) + Supabase PostgreSQL/RPC (backend cloud).**

Tidak perlu menjalankan `server.js` untuk versi GitHub Pages.

## 1. Siapkan Supabase

1. Buka project Supabase yang URL-nya sudah tercantum di `js/supabase-config.js`.
2. Buka **SQL Editor → New query**.
3. Jalankan seluruh isi `SUPABASE_SETUP.sql`.
4. Setelah itu, bila ingin memindahkan data dari arsip lama, jalankan `supabase/IMPORT_DATA_FROM_SQLITE.sql`.

`IMPORT_DATA_FROM_SQLITE.sql` berisi data yang ada di `data/siap_bos.db` pada arsip yang Anda upload.

## 2. Login administrator

Password awal mengikuti aplikasi lama:

`Loading2008`

Setelah berhasil masuk Panel Admin, gunakan menu **Ganti Kata Sandi Administrator** dan segera ubah password tersebut.

## 3. Upload ke GitHub

Upload isi paket GitHub ini ke repository Anda, lalu aktifkan:

**Settings → Pages → Deploy from a branch → branch utama → root (/)**

Halaman utama akan tersedia di:

`https://USERNAME.github.io/NAMA-REPOSITORY/`

Panel admin:

`https://USERNAME.github.io/NAMA-REPOSITORY/monitoring/`

## 4. Penting — jangan upload database SQLite

Versi GitHub ini sengaja **tidak menyertakan** `data/siap_bos.db`, `server.js`, file `.bat`, dan file backup lama yang masih berisi koneksi API lokal.

Semua data online harus berada di Supabase.

## 5. Struktur Supabase

RPC yang dipakai aplikasi mencakup:

- login / verify / logout administrator
- ganti password administrator
- login / verify / logout sekolah berdasarkan NPSN aktif
- baca / simpan / hapus pekerjaan BKU
- panel admin membaca dan menghapus pekerjaan
- cek, toggle, dan batch aktivasi NPSN

Tabel tetap menggunakan `projects`, `bku_transactions`, `spmu_letters`, dan `npsn_activations`, ditambah tabel session untuk administrator dan sekolah.

## 6. Catatan keamanan

Repository boleh berisi **Supabase publishable/anon key** karena key tersebut memang untuk frontend. Keamanan data bergantung pada RLS dan RPC pada `SUPABASE_SETUP.sql`.

Jangan pernah memasukkan `service_role` key Supabase ke file JavaScript frontend atau repository GitHub.
