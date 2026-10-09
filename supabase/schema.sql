-- ================================================================
-- SIAP BOS v3 — Supabase / GitHub Pages
-- Jalankan SELURUH file ini sekali di Supabase SQL Editor.
-- Arsitektur: GitHub Pages (frontend) + Supabase PostgreSQL (backend).
-- Tidak ada lagi ketergantungan pada server.js / SQLite.
-- ================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------
-- 1) Tabel data aplikasi
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.projects (
  id TEXT PRIMARY KEY,
  npsn TEXT,
  school_name TEXT,
  kecamatan TEXT,
  month_name TEXT,
  month_number INTEGER,
  name TEXT,
  file_name TEXT,
  file_size BIGINT,
  total_rows INTEGER,
  state_json TEXT,
  file_data TEXT,
  created_at BIGINT,
  updated_at BIGINT
);

ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS month_number INTEGER;

CREATE TABLE IF NOT EXISTS public.bku_transactions (
  id TEXT PRIMARY KEY,
  project_id TEXT REFERENCES public.projects(id) ON DELETE CASCADE,
  npsn TEXT,
  month_name TEXT,
  no_bukti TEXT,
  tanggal TEXT,
  uraian TEXT,
  debit DOUBLE PRECISION,
  kredit DOUBLE PRECISION,
  saldo DOUBLE PRECISION,
  kode_rekening TEXT
);

CREATE TABLE IF NOT EXISTS public.spmu_letters (
  id TEXT PRIMARY KEY,
  project_id TEXT REFERENCES public.projects(id) ON DELETE CASCADE,
  npsn TEXT,
  no_bukti TEXT,
  category TEXT,
  nominal DOUBLE PRECISION,
  untuk_pembayaran TEXT,
  saved_at BIGINT
);

CREATE TABLE IF NOT EXISTS public.npsn_activations (
  npsn TEXT PRIMARY KEY,
  is_active INTEGER DEFAULT 0,
  school_name TEXT,
  kecamatan TEXT,
  activated_at BIGINT,
  activated_by TEXT,
  notes TEXT,
  pin_hash TEXT,
  pin_set_at BIGINT,
  failed_pin_attempts INTEGER DEFAULT 0,
  pin_locked_until BIGINT
);

-- Kolom PIN login sekolah (ditambahkan belakangan — aman dijalankan ulang).
ALTER TABLE public.npsn_activations ADD COLUMN IF NOT EXISTS pin_hash TEXT;
ALTER TABLE public.npsn_activations ADD COLUMN IF NOT EXISTS pin_set_at BIGINT;
ALTER TABLE public.npsn_activations ADD COLUMN IF NOT EXISTS failed_pin_attempts INTEGER DEFAULT 0;
ALTER TABLE public.npsn_activations ADD COLUMN IF NOT EXISTS pin_locked_until BIGINT;

-- ---------------------------------------------------------------
-- 2) Admin + session sekolah
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.admin_auth (
  id TEXT PRIMARY KEY,
  password_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  updated_at BIGINT,
  failed_attempts INTEGER DEFAULT 0,
  locked_until BIGINT
);

ALTER TABLE public.admin_auth ADD COLUMN IF NOT EXISTS failed_attempts INTEGER DEFAULT 0;
ALTER TABLE public.admin_auth ADD COLUMN IF NOT EXISTS locked_until BIGINT;

CREATE TABLE IF NOT EXISTS public.admin_sessions (
  token TEXT PRIMARY KEY,
  created_at BIGINT NOT NULL,
  expires_at BIGINT NOT NULL,
  revoked_at BIGINT
);

CREATE TABLE IF NOT EXISTS public.school_sessions (
  token TEXT PRIMARY KEY,
  npsn TEXT NOT NULL,
  school_name TEXT,
  kecamatan TEXT,
  created_at BIGINT NOT NULL,
  expires_at BIGINT NOT NULL,
  revoked_at BIGINT,
  last_seen_at BIGINT
);

CREATE INDEX IF NOT EXISTS idx_projects_npsn_updated ON public.projects(npsn, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_bku_project_id ON public.bku_transactions(project_id);
CREATE INDEX IF NOT EXISTS idx_spmu_project_id ON public.spmu_letters(project_id);
CREATE INDEX IF NOT EXISTS idx_school_sessions_npsn ON public.school_sessions(npsn);
CREATE INDEX IF NOT EXISTS idx_school_sessions_expiry ON public.school_sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_admin_sessions_expiry ON public.admin_sessions(expires_at);

-- Default admin yang sama dengan server.js lama: Loading2008.
-- Jika admin_auth sudah berisi akun, baris ini tidak mengubah password.
INSERT INTO public.admin_auth(id, password_hash, salt, updated_at, failed_attempts, locked_until)
VALUES (
  'admin',
  encode(digest('Loading2008:' || '31ad1467e9fbe688e2633b2749df1e56', 'sha256'), 'hex'),
  '31ad1467e9fbe688e2633b2749df1e56',
  EXTRACT(EPOCH FROM now())::bigint * 1000,
  0,
  NULL
)
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------
-- 3) Helper validasi session
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.siap_admin_session_valid(p_token TEXT)
RETURNS BOOLEAN
LANGUAGE SQL
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.admin_sessions
    WHERE token = p_token
      AND revoked_at IS NULL
      AND expires_at > (EXTRACT(EPOCH FROM now())::bigint * 1000)
  );
$$;

CREATE OR REPLACE FUNCTION public.siap_school_npsn_from_session(p_token TEXT)
RETURNS TEXT
LANGUAGE SQL
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT npsn FROM public.school_sessions
  WHERE token = p_token
    AND revoked_at IS NULL
    AND expires_at > (EXTRACT(EPOCH FROM now())::bigint * 1000)
  LIMIT 1;
$$;

-- ---------------------------------------------------------------
-- 4) ADMIN AUTH
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.siap_admin_login(p_password TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_row public.admin_auth%ROWTYPE;
  v_now BIGINT := EXTRACT(EPOCH FROM now())::bigint * 1000;
  v_hash TEXT;
  v_token TEXT;
  v_ttl BIGINT := 24 * 60 * 60 * 1000;
BEGIN
  SELECT * INTO v_row FROM public.admin_auth WHERE id = 'admin' FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Akun Administrator belum siap.');
  END IF;

  IF COALESCE(v_row.locked_until, 0) > v_now THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Login Administrator dikunci sementara karena terlalu banyak percobaan gagal. Coba lagi beberapa menit lagi.'
    );
  END IF;

  v_hash := encode(digest(COALESCE(trim(p_password), '') || ':' || v_row.salt, 'sha256'), 'hex');

  IF v_hash <> v_row.password_hash THEN
    UPDATE public.admin_auth
      SET failed_attempts = COALESCE(failed_attempts, 0) + 1,
          locked_until = CASE WHEN COALESCE(failed_attempts, 0) + 1 >= 5
                              THEN v_now + 15 * 60 * 1000 ELSE NULL END,
          updated_at = v_now
    WHERE id = 'admin';

    RETURN jsonb_build_object('success', false, 'error', 'Kata sandi Administrator salah. Akses ditolak.');
  END IF;

  v_token := encode(gen_random_bytes(32), 'hex');
  INSERT INTO public.admin_sessions(token, created_at, expires_at)
  VALUES (v_token, v_now, v_now + v_ttl);

  UPDATE public.admin_auth
    SET failed_attempts = 0, locked_until = NULL, updated_at = v_now
  WHERE id = 'admin';

  RETURN jsonb_build_object(
    'success', true,
    'token', v_token,
    'expiresIn', v_ttl
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.siap_admin_verify(p_token TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE v_ok BOOLEAN;
BEGIN
  v_ok := public.siap_admin_session_valid(p_token);
  RETURN jsonb_build_object('success', v_ok, 'authenticated', v_ok);
END;
$$;

CREATE OR REPLACE FUNCTION public.siap_admin_logout(p_token TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  UPDATE public.admin_sessions SET revoked_at = EXTRACT(EPOCH FROM now())::bigint * 1000
  WHERE token = p_token;
  RETURN jsonb_build_object('success', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.siap_admin_change_password(
  p_token TEXT,
  p_current_password TEXT,
  p_new_password TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_row public.admin_auth%ROWTYPE;
  v_now BIGINT := EXTRACT(EPOCH FROM now())::bigint * 1000;
  v_new_salt TEXT;
BEGIN
  IF NOT public.siap_admin_session_valid(p_token) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Sesi Administrator tidak valid atau telah kedaluwarsa.');
  END IF;
  IF COALESCE(length(trim(p_new_password)), 0) < 6 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Kata sandi baru minimal 6 karakter.');
  END IF;

  SELECT * INTO v_row FROM public.admin_auth WHERE id = 'admin' FOR UPDATE;
  IF encode(digest(COALESCE(trim(p_current_password), '') || ':' || v_row.salt, 'sha256'), 'hex') <> v_row.password_hash THEN
    RETURN jsonb_build_object('success', false, 'error', 'Kata sandi lama salah.');
  END IF;

  v_new_salt := encode(gen_random_bytes(16), 'hex');
  UPDATE public.admin_auth
    SET password_hash = encode(digest(trim(p_new_password) || ':' || v_new_salt, 'sha256'), 'hex'),
        salt = v_new_salt,
        updated_at = v_now,
        failed_attempts = 0,
        locked_until = NULL
  WHERE id = 'admin';

  RETURN jsonb_build_object('success', true, 'message', 'Kata sandi Administrator berhasil diperbarui!');
END;
$$;

-- ---------------------------------------------------------------
-- 5) LOGIN / SESSION SEKOLAH BERDASARKAN NPSN AKTIF
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.siap_school_check(p_npsn TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE v_row public.npsn_activations%ROWTYPE;
BEGIN
  SELECT * INTO v_row FROM public.npsn_activations WHERE npsn = trim(p_npsn);
  RETURN jsonb_build_object(
    'npsn', trim(p_npsn),
    'active', COALESCE(v_row.is_active, 0) = 1,
    'school_name', COALESCE(v_row.school_name, ''),
    'kecamatan', COALESCE(v_row.kecamatan, ''),
    'activated_at', v_row.activated_at
  );
END;
$$;

-- Ganti signature lama (hanya NPSN) dengan versi yang mewajibkan PIN.
DROP FUNCTION IF EXISTS public.siap_school_login(TEXT);

CREATE OR REPLACE FUNCTION public.siap_school_login(p_npsn TEXT, p_pin TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_row public.npsn_activations%ROWTYPE;
  v_now BIGINT := EXTRACT(EPOCH FROM now())::bigint * 1000;
  v_token TEXT;
  v_ttl BIGINT := 24 * 60 * 60 * 1000;
  v_npsn TEXT := trim(COALESCE(p_npsn, ''));
  v_pin TEXT := trim(COALESCE(p_pin, ''));
BEGIN
  SELECT * INTO v_row FROM public.npsn_activations WHERE npsn = v_npsn FOR UPDATE;
  IF NOT FOUND OR COALESCE(v_row.is_active, 0) <> 1 THEN
    RETURN jsonb_build_object(
      'success', false,
      'active', false,
      'error', 'NPSN belum diaktifkan oleh Administrator.'
    );
  END IF;

  IF v_row.pin_hash IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'PIN login belum diatur untuk sekolah ini. Hubungi Administrator/Pengawas untuk mendapatkan PIN.'
    );
  END IF;

  IF COALESCE(v_row.pin_locked_until, 0) > v_now THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Login dikunci sementara karena terlalu banyak percobaan PIN yang salah. Coba lagi beberapa menit lagi.'
    );
  END IF;

  IF v_pin = '' OR crypt(v_pin, v_row.pin_hash) <> v_row.pin_hash THEN
    UPDATE public.npsn_activations
      SET failed_pin_attempts = COALESCE(failed_pin_attempts, 0) + 1,
          pin_locked_until = CASE WHEN COALESCE(failed_pin_attempts, 0) + 1 >= 5
                                  THEN v_now + 15 * 60 * 1000 ELSE pin_locked_until END
    WHERE npsn = v_npsn;

    RETURN jsonb_build_object('success', false, 'error', 'PIN salah. Akses ditolak.');
  END IF;

  v_token := encode(gen_random_bytes(32), 'hex');
  INSERT INTO public.school_sessions(token, npsn, school_name, kecamatan, created_at, expires_at, last_seen_at)
  VALUES (v_token, v_npsn, COALESCE(v_row.school_name, ''), COALESCE(v_row.kecamatan, ''), v_now, v_now + v_ttl, v_now);

  UPDATE public.npsn_activations
    SET failed_pin_attempts = 0, pin_locked_until = NULL
  WHERE npsn = v_npsn;

  RETURN jsonb_build_object(
    'success', true,
    'token', v_token,
    'expiresIn', v_ttl,
    'npsn', v_npsn,
    'school_name', COALESCE(v_row.school_name, ''),
    'kecamatan', COALESCE(v_row.kecamatan, '')
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.siap_admin_set_pin(p_token TEXT, p_npsn TEXT, p_pin TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_npsn TEXT := trim(COALESCE(p_npsn, ''));
  v_pin TEXT := trim(COALESCE(p_pin, ''));
  v_now BIGINT := EXTRACT(EPOCH FROM now())::bigint * 1000;
BEGIN
  IF NOT public.siap_admin_session_valid(p_token) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Akses ditolak: Otorisasi Administrator diperlukan.');
  END IF;
  IF v_npsn = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'NPSN tidak boleh kosong.');
  END IF;

  -- PIN kosong = minta sistem buatkan PIN 6 digit acak.
  IF v_pin = '' THEN
    v_pin := lpad(floor(random() * 1000000)::TEXT, 6, '0');
  ELSIF v_pin !~ '^[0-9]{4,8}$' THEN
    RETURN jsonb_build_object('success', false, 'error', 'PIN harus berupa 4-8 digit angka.');
  END IF;

  INSERT INTO public.npsn_activations(npsn, is_active, pin_hash, pin_set_at, failed_pin_attempts, pin_locked_until)
  VALUES (v_npsn, 0, crypt(v_pin, gen_salt('bf')), v_now, 0, NULL)
  ON CONFLICT(npsn) DO UPDATE SET
    pin_hash = crypt(v_pin, gen_salt('bf')),
    pin_set_at = v_now,
    failed_pin_attempts = 0,
    pin_locked_until = NULL;

  RETURN jsonb_build_object('success', true, 'npsn', v_npsn, 'pin', v_pin);
END;
$$;

CREATE OR REPLACE FUNCTION public.siap_school_verify(p_token TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE v_row public.school_sessions%ROWTYPE;
BEGIN
  SELECT * INTO v_row FROM public.school_sessions
  WHERE token = p_token AND revoked_at IS NULL
    AND expires_at > (EXTRACT(EPOCH FROM now())::bigint * 1000)
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'authenticated', false);
  END IF;

  UPDATE public.school_sessions
    SET last_seen_at = EXTRACT(EPOCH FROM now())::bigint * 1000
  WHERE token = p_token;

  RETURN jsonb_build_object(
    'success', true,
    'authenticated', true,
    'npsn', v_row.npsn,
    'school_name', COALESCE(v_row.school_name, ''),
    'kecamatan', COALESCE(v_row.kecamatan, '')
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.siap_school_logout(p_token TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  UPDATE public.school_sessions SET revoked_at = EXTRACT(EPOCH FROM now())::bigint * 1000
  WHERE token = p_token;
  RETURN jsonb_build_object('success', true);
END;
$$;

-- ---------------------------------------------------------------
-- 6) DATA PROYEK SEKOLAH — SEMUA VIA RPC
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.siap_school_get_projects(p_token TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE v_npsn TEXT;
BEGIN
  v_npsn := public.siap_school_npsn_from_session(p_token);
  IF v_npsn IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Sesi sekolah tidak valid atau telah kedaluwarsa.');
  END IF;

  UPDATE public.school_sessions SET last_seen_at = EXTRACT(EPOCH FROM now())::bigint * 1000 WHERE token = p_token;

  RETURN jsonb_build_object(
    'success', true,
    'projects', COALESCE((
      SELECT jsonb_agg(to_jsonb(x) ORDER BY x.updated_at DESC)
      FROM (
        SELECT id,npsn,school_name,kecamatan,month_name,name,file_name,file_size,total_rows,state_json,created_at,updated_at
        FROM public.projects WHERE npsn = v_npsn
      ) x
    ), '[]'::jsonb)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.siap_school_get_project(p_token TEXT, p_id TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE v_npsn TEXT; v_project JSONB;
BEGIN
  v_npsn := public.siap_school_npsn_from_session(p_token);
  IF v_npsn IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Sesi sekolah tidak valid atau telah kedaluwarsa.');
  END IF;

  SELECT to_jsonb(x) INTO v_project
  FROM (
    SELECT id,npsn,school_name,kecamatan,month_name,name,file_name,file_size,total_rows,state_json,file_data,created_at,updated_at
    FROM public.projects WHERE id = p_id AND npsn = v_npsn LIMIT 1
  ) x;

  RETURN jsonb_build_object('success', true, 'project', COALESCE(v_project, 'null'::jsonb));
END;
$$;

CREATE OR REPLACE FUNCTION public.siap_school_save_project(p_token TEXT, p_payload JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_npsn TEXT;
  v_id TEXT := trim(COALESCE(p_payload->>'id',''));
  v_name TEXT := COALESCE(NULLIF(p_payload->>'name',''), 'Pekerjaan BKU');
  v_file JSONB := COALESCE(p_payload->'file','{}'::jsonb);
  v_state JSONB := COALESCE(p_payload->'state','{}'::jsonb);
  v_ident JSONB := COALESCE(v_state->'identity','{}'::jsonb);
  v_rows JSONB := COALESCE(v_state->'rows','[]'::jsonb);
  v_school TEXT;
  v_kec TEXT;
  v_month TEXT;
  v_now BIGINT := EXTRACT(EPOCH FROM now())::bigint * 1000;
  v_created BIGINT;
BEGIN
  v_npsn := public.siap_school_npsn_from_session(p_token);
  IF v_npsn IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Sesi sekolah tidak valid atau telah kedaluwarsa.');
  END IF;
  IF v_id = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'ID pekerjaan tidak valid.');
  END IF;

  -- Cegah sekolah lain menimpa/mengambil-alih proyek yang bukan miliknya (IDOR).
  IF EXISTS (SELECT 1 FROM public.projects WHERE id = v_id AND npsn <> v_npsn) THEN
    RETURN jsonb_build_object('success', false, 'error', 'ID pekerjaan ini sudah dipakai oleh sekolah lain.');
  END IF;

  SELECT school_name, kecamatan INTO v_school, v_kec FROM public.npsn_activations WHERE npsn = v_npsn;
  v_school := COALESCE(NULLIF(v_ident->>'school',''), NULLIF(v_ident->>'namaSekolah',''), v_school, '');
  v_kec := COALESCE(NULLIF(v_ident->>'kecamatan',''), v_kec, '');
  v_month := COALESCE(NULLIF(v_ident->>'bulan',''), NULLIF(v_ident->>'periode',''), '');
  v_created := COALESCE(NULLIF(p_payload->>'createdAt','')::BIGINT, v_now);

  INSERT INTO public.projects(
    id,npsn,school_name,kecamatan,month_name,month_number,name,file_name,file_size,total_rows,
    state_json,file_data,created_at,updated_at
  ) VALUES (
    v_id,v_npsn,v_school,v_kec,v_month,
    CASE WHEN v_month ~ '^[0-9]+$' THEN NULLIF(v_month,'')::INTEGER ELSE NULL END,
    v_name,
    COALESCE(v_file->>'name','BKU'),
    COALESCE(NULLIF(v_file->>'size','')::BIGINT,0),
    COALESCE(jsonb_array_length(v_rows),0),
    v_state::TEXT,
    NULLIF(v_file->>'dataUrl',''),
    v_created,v_now
  )
  ON CONFLICT(id) DO UPDATE SET
    npsn = excluded.npsn,
    school_name = excluded.school_name,
    kecamatan = excluded.kecamatan,
    month_name = excluded.month_name,
    month_number = excluded.month_number,
    name = excluded.name,
    file_name = excluded.file_name,
    file_size = excluded.file_size,
    total_rows = excluded.total_rows,
    state_json = excluded.state_json,
    file_data = excluded.file_data,
    created_at = projects.created_at,
    updated_at = excluded.updated_at;

  DELETE FROM public.bku_transactions WHERE project_id = v_id;

  INSERT INTO public.bku_transactions(
    id,project_id,npsn,month_name,no_bukti,tanggal,uraian,debit,kredit,saldo,kode_rekening
  )
  SELECT
    v_id || '_' || ord::TEXT,
    v_id,
    v_npsn,
    v_month,
    COALESCE(r->>'noBukti',''),
    COALESCE(r->>'tanggal',''),
    COALESCE(r->>'uraian',''),
    COALESCE(NULLIF(r->>'debit','')::DOUBLE PRECISION, NULLIF(r->>'penerimaan','')::DOUBLE PRECISION, 0),
    COALESCE(NULLIF(r->>'kredit','')::DOUBLE PRECISION, NULLIF(r->>'pengeluaran','')::DOUBLE PRECISION, 0),
    COALESCE(NULLIF(r->>'saldo','')::DOUBLE PRECISION, 0),
    COALESCE(r->>'kodeRekening','')
  FROM jsonb_array_elements(v_rows) WITH ORDINALITY AS a(r,ord);

  UPDATE public.school_sessions SET last_seen_at = v_now WHERE token = p_token;

  RETURN jsonb_build_object('success', true, 'id', v_id, 'backend', 'Supabase Cloud');
EXCEPTION WHEN others THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

CREATE OR REPLACE FUNCTION public.siap_school_delete_project(p_token TEXT, p_id TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE v_npsn TEXT; v_count INTEGER;
BEGIN
  v_npsn := public.siap_school_npsn_from_session(p_token);
  IF v_npsn IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Sesi sekolah tidak valid atau telah kedaluwarsa.');
  END IF;

  SELECT count(*) INTO v_count FROM public.projects WHERE id=p_id AND npsn=v_npsn;
  IF v_count = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Pekerjaan tidak ditemukan atau bukan milik sekolah ini.');
  END IF;

  DELETE FROM public.bku_transactions WHERE project_id = p_id;
  DELETE FROM public.spmu_letters WHERE project_id = p_id;
  DELETE FROM public.projects WHERE id=p_id AND npsn=v_npsn;
  RETURN jsonb_build_object('success', true, 'deletedId', p_id);
END;
$$;

-- ---------------------------------------------------------------
-- 7) PANEL ADMIN — PROYEK
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.siap_admin_get_projects(p_token TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF NOT public.siap_admin_session_valid(p_token) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Sesi Administrator tidak valid atau telah kedaluwarsa.');
  END IF;
  RETURN jsonb_build_object(
    'success', true,
    'projects', COALESCE((
      SELECT jsonb_agg(to_jsonb(x) ORDER BY x.updated_at DESC)
      FROM (
        SELECT id,npsn,school_name,kecamatan,month_name,name,file_name,file_size,total_rows,state_json,created_at,updated_at
        FROM public.projects
      ) x
    ), '[]'::jsonb)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.siap_admin_delete_project(p_token TEXT, p_id TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF NOT public.siap_admin_session_valid(p_token) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Sesi Administrator tidak valid atau telah kedaluwarsa.');
  END IF;
  DELETE FROM public.bku_transactions WHERE project_id=p_id;
  DELETE FROM public.spmu_letters WHERE project_id=p_id;
  DELETE FROM public.projects WHERE id=p_id;
  RETURN jsonb_build_object('success', true, 'deletedId', p_id);
END;
$$;

-- ---------------------------------------------------------------
-- 8) PANEL ADMIN — AKTIVASI NPSN
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.siap_admin_get_activations(p_token TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE v_map JSONB;
BEGIN
  IF NOT public.siap_admin_session_valid(p_token) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Sesi Administrator tidak valid atau telah kedaluwarsa.');
  END IF;

  SELECT COALESCE(jsonb_object_agg(npsn, jsonb_build_object(
    'active', is_active=1,
    'school_name', COALESCE(school_name,''),
    'kecamatan', COALESCE(kecamatan,''),
    'activated_at', activated_at,
    'activated_by', activated_by,
    'pin_set', pin_hash IS NOT NULL
  )), '{}'::jsonb)
  INTO v_map
  FROM public.npsn_activations;

  RETURN jsonb_build_object(
    'success', true,
    'count', (SELECT count(*) FROM public.npsn_activations),
    'activations', v_map,
    'list', COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.npsn) FROM (
      SELECT npsn,is_active,school_name,kecamatan,activated_at,activated_by,(pin_hash IS NOT NULL) AS pin_set
      FROM public.npsn_activations
    ) x), '[]'::jsonb)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.siap_admin_toggle_activation(
  p_token TEXT,
  p_npsn TEXT,
  p_school_name TEXT,
  p_kecamatan TEXT,
  p_is_active BOOLEAN,
  p_activated_by TEXT DEFAULT 'Pengawas Monitoring'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE v_now BIGINT := EXTRACT(EPOCH FROM now())::bigint * 1000;
BEGIN
  IF NOT public.siap_admin_session_valid(p_token) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Akses ditolak: Otorisasi Administrator diperlukan.');
  END IF;
  IF trim(COALESCE(p_npsn,'')) = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'NPSN tidak boleh kosong.');
  END IF;

  INSERT INTO public.npsn_activations(npsn,is_active,school_name,kecamatan,activated_at,activated_by)
  VALUES (trim(p_npsn), CASE WHEN p_is_active THEN 1 ELSE 0 END, COALESCE(p_school_name,''), COALESCE(p_kecamatan,''), CASE WHEN p_is_active THEN v_now ELSE NULL END, COALESCE(NULLIF(p_activated_by,''),'Pengawas Monitoring'))
  ON CONFLICT(npsn) DO UPDATE SET
    is_active = excluded.is_active,
    school_name = CASE WHEN excluded.school_name <> '' THEN excluded.school_name ELSE npsn_activations.school_name END,
    kecamatan = CASE WHEN excluded.kecamatan <> '' THEN excluded.kecamatan ELSE npsn_activations.kecamatan END,
    activated_at = excluded.activated_at,
    activated_by = excluded.activated_by;

  RETURN jsonb_build_object('success', true, 'npsn', trim(p_npsn), 'active', p_is_active, 'activatedAt', CASE WHEN p_is_active THEN v_now ELSE NULL END);
END;
$$;

CREATE OR REPLACE FUNCTION public.siap_admin_batch_activation(
  p_token TEXT,
  p_items JSONB,
  p_is_active BOOLEAN,
  p_activated_by TEXT DEFAULT 'Pengawas Monitoring'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_item JSONB;
  v_count INTEGER := 0;
  v_now BIGINT := EXTRACT(EPOCH FROM now())::bigint * 1000;
BEGIN
  IF NOT public.siap_admin_session_valid(p_token) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Akses ditolak: Otorisasi Administrator diperlukan.');
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(p_items,'[]'::jsonb)) LOOP
    IF trim(COALESCE(v_item->>'npsn','')) <> '' THEN
      INSERT INTO public.npsn_activations(npsn,is_active,school_name,kecamatan,activated_at,activated_by)
      VALUES (
        trim(v_item->>'npsn'), CASE WHEN p_is_active THEN 1 ELSE 0 END,
        COALESCE(v_item->>'school_name',''), COALESCE(v_item->>'kecamatan',''),
        CASE WHEN p_is_active THEN v_now ELSE NULL END,
        COALESCE(NULLIF(p_activated_by,''),'Pengawas Monitoring')
      )
      ON CONFLICT(npsn) DO UPDATE SET
        is_active = excluded.is_active,
        school_name = CASE WHEN excluded.school_name <> '' THEN excluded.school_name ELSE npsn_activations.school_name END,
        kecamatan = CASE WHEN excluded.kecamatan <> '' THEN excluded.kecamatan ELSE npsn_activations.kecamatan END,
        activated_at = excluded.activated_at,
        activated_by = excluded.activated_by;
      v_count := v_count + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('success', true, 'count', v_count, 'active', p_is_active);
END;
$$;

-- ---------------------------------------------------------------
-- 9) Keamanan: tidak ada akses tabel langsung dari browser anon.
-- Semua akses melalui RPC SECURITY DEFINER.
-- ---------------------------------------------------------------

-- Cabut EXECUTE default dari PUBLIC terlebih dahulu, lalu berikan
-- hanya fungsi RPC yang memang dibutuhkan browser.
REVOKE ALL ON FUNCTION public.siap_admin_session_valid(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.siap_school_npsn_from_session(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.siap_admin_login(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.siap_admin_verify(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.siap_admin_logout(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.siap_admin_change_password(TEXT,TEXT,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.siap_school_check(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.siap_school_login(TEXT,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.siap_admin_set_pin(TEXT,TEXT,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.siap_school_verify(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.siap_school_logout(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.siap_school_get_projects(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.siap_school_get_project(TEXT,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.siap_school_save_project(TEXT,JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.siap_school_delete_project(TEXT,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.siap_admin_get_projects(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.siap_admin_delete_project(TEXT,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.siap_admin_get_activations(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.siap_admin_toggle_activation(TEXT,TEXT,TEXT,TEXT,BOOLEAN,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.siap_admin_batch_activation(TEXT,JSONB,BOOLEAN,TEXT) FROM PUBLIC;
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bku_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.spmu_letters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.npsn_activations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_auth ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.school_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS allow_all_projects ON public.projects;
DROP POLICY IF EXISTS allow_all_bku ON public.bku_transactions;
DROP POLICY IF EXISTS allow_all_spmu ON public.spmu_letters;
DROP POLICY IF EXISTS allow_all_npsn_activations ON public.npsn_activations;
DROP POLICY IF EXISTS allow_all_admin_auth ON public.admin_auth;
DROP POLICY IF EXISTS allow_all_admin_sessions ON public.admin_sessions;
DROP POLICY IF EXISTS allow_all_school_sessions ON public.school_sessions;

REVOKE ALL ON TABLE public.projects, public.bku_transactions, public.spmu_letters,
  public.npsn_activations, public.admin_auth, public.admin_sessions, public.school_sessions
FROM anon, authenticated;

GRANT EXECUTE ON FUNCTION public.siap_admin_login(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.siap_admin_verify(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.siap_admin_logout(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.siap_admin_change_password(TEXT,TEXT,TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.siap_school_check(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.siap_school_login(TEXT,TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.siap_admin_set_pin(TEXT,TEXT,TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.siap_school_verify(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.siap_school_logout(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.siap_school_get_projects(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.siap_school_get_project(TEXT,TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.siap_school_save_project(TEXT,JSONB) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.siap_school_delete_project(TEXT,TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.siap_admin_get_projects(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.siap_admin_delete_project(TEXT,TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.siap_admin_get_activations(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.siap_admin_toggle_activation(TEXT,TEXT,TEXT,TEXT,BOOLEAN,TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.siap_admin_batch_activation(TEXT,JSONB,BOOLEAN,TEXT) TO anon, authenticated;

-- Bersihkan session kadaluarsa.
DELETE FROM public.admin_sessions WHERE expires_at < (EXTRACT(EPOCH FROM now())::bigint * 1000);
DELETE FROM public.school_sessions WHERE expires_at < (EXTRACT(EPOCH FROM now())::bigint * 1000);

-- Selesai.
