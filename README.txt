SIAP BOS v3 — GITHUB PAGES + SUPABASE

Versi ini menggunakan GitHub Pages sebagai frontend dan Supabase sebagai backend cloud.
Tidak perlu menjalankan server.js untuk penggunaan online.

SETUP:
1. Buka project Supabase sesuai URL pada js/supabase-config.js.
2. Jalankan seluruh SUPABASE_SETUP.sql di Supabase SQL Editor.
3. Untuk membawa data lama dari arsip, jalankan supabase/IMPORT_DATA_FROM_SQLITE.sql.
4. Upload paket ini ke GitHub.
5. Aktifkan GitHub Pages dari Settings > Pages > Deploy from a branch > root (/).

LOGIN ADMIN DEFAULT:
Loading2008

Setelah login, segera ganti password dari menu Ganti Kata Sandi Administrator.

Catatan keamanan:
- Jangan upload database SQLite, server.js, atau file backup lama ke repository publik.
- Jangan pernah memasukkan Supabase service_role key ke JavaScript frontend.
- SUPABASE_SETUP.sql adalah file wajib untuk membuat tabel, RLS, session, dan RPC.

Panduan lebih lengkap: README_GITHUB_SUPABASE.md
