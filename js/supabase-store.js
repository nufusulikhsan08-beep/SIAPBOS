/**
 * SIAP BOS v3 — Supabase Cloud Store
 * Semua operasi online untuk GitHub Pages dilakukan melalui RPC Supabase.
 * Tidak ada lagi ketergantungan ke server.js / SQLite.
 */
(function () {
  'use strict';

  const SUPABASE_URL = window.SUPABASE_URL || '';
  const SUPABASE_KEY = window.SUPABASE_ANON_KEY || '';
  const ADMIN_TOKEN_KEY = 'SIAP_BOS_ADMIN_TOKEN';
  const SCHOOL_TOKEN_KEY = 'SIAP_BOS_SCHOOL_TOKEN';
  const SCHOOL_NPSN_KEY = 'SIAP_BOS_NPSN_SESSION';
  const SCHOOL_NAME_KEY = 'SIAP_BOS_SCHOOL_NAME';
  const SCHOOL_KEC_KEY = 'SIAP_BOS_SCHOOL_KECAMATAN';

  function isConfigured() {
    return !!(
      SUPABASE_URL &&
      SUPABASE_KEY &&
      /^https:\/\/[^/]+\.supabase\.co$/i.test(SUPABASE_URL)
    );
  }

  function getAdminToken() { return sessionStorage.getItem(ADMIN_TOKEN_KEY) || ''; }
  function getSchoolToken() { return sessionStorage.getItem(SCHOOL_TOKEN_KEY) || ''; }
  function getCurrentNpsn() { return sessionStorage.getItem(SCHOOL_NPSN_KEY) || window.SIAP_BOS_CURRENT_NPSN || ''; }
  function getCurrentSchool() { return sessionStorage.getItem(SCHOOL_NAME_KEY) || window.SIAP_BOS_CURRENT_SCHOOL || ''; }

  function clearSchoolSession() {
    sessionStorage.removeItem(SCHOOL_TOKEN_KEY);
    sessionStorage.removeItem(SCHOOL_NPSN_KEY);
    sessionStorage.removeItem(SCHOOL_NAME_KEY);
    sessionStorage.removeItem(SCHOOL_KEC_KEY);
    window.SIAP_BOS_CURRENT_NPSN = null;
    window.SIAP_BOS_CURRENT_SCHOOL = '';
  }

  async function rpc(functionName, body = {}) {
    if (!isConfigured()) throw new Error('Supabase belum dikonfigurasi. Periksa js/supabase-config.js.');
    const res = await fetch(SUPABASE_URL + '/rest/v1/rpc/' + encodeURIComponent(functionName), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_KEY,
        'Authorization': 'Bearer ' + SUPABASE_KEY
      },
      body: JSON.stringify(body)
    });
    const raw = await res.text();
    let data = null;
    try { data = raw ? JSON.parse(raw) : null; } catch (_) {}
    if (!res.ok) {
      const message = data?.message || data?.hint || raw || res.statusText;
      throw new Error('Supabase RPC ' + res.status + ': ' + message);
    }
    if (data && data.success === false) throw new Error(data.error || 'Supabase menolak permintaan.');
    return data;
  }

  function parseState(value) {
    if (!value) return {};
    if (typeof value === 'object') return value;
    try { return JSON.parse(value); } catch (_) { return {}; }
  }

  function normalizeProject(r) {
    const state = parseState(r.state_json);
    if (!state.identity) state.identity = {};
    if (!state.identity.school && r.school_name) state.identity.school = r.school_name;
    if (!state.identity.kecamatan && r.kecamatan) state.identity.kecamatan = r.kecamatan;
    if (!state.identity.npsn && r.npsn) state.identity.npsn = r.npsn;
    if (!state.identity.bulan && r.month_name) state.identity.bulan = r.month_name;
    return {
      id: r.id,
      name: r.name,
      npsn: r.npsn || state.identity?.npsn || '',
      schoolName: r.school_name || state.identity?.school || '',
      kecamatan: r.kecamatan || state.identity?.kecamatan || '',
      monthName: r.month_name || state.identity?.bulan || '',
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      file: {
        name: r.file_name || 'BKU',
        size: Number(r.file_size) || 0,
        dataUrl: r.file_data || null,
        type: ''
      },
      state,
      backend: 'Supabase Cloud'
    };
  }

  // ---------------- School login ----------------
  async function schoolCheck(npsn) {
    return rpc('siap_school_check', { p_npsn: String(npsn || '').trim() });
  }

  async function schoolLogin(npsn) {
    const data = await rpc('siap_school_login', { p_npsn: String(npsn || '').trim() });
    if (!data?.success || !data.token) throw new Error(data?.error || 'NPSN belum diaktifkan oleh Administrator.');
    sessionStorage.setItem(SCHOOL_TOKEN_KEY, data.token);
    sessionStorage.setItem(SCHOOL_NPSN_KEY, data.npsn || npsn);
    sessionStorage.setItem(SCHOOL_NAME_KEY, data.school_name || '');
    sessionStorage.setItem(SCHOOL_KEC_KEY, data.kecamatan || '');
    window.SIAP_BOS_CURRENT_NPSN = data.npsn || npsn;
    window.SIAP_BOS_CURRENT_SCHOOL = data.school_name || '';
    return data;
  }

  async function schoolVerify() {
    const token = getSchoolToken();
    if (!token) return { success: false, authenticated: false };
    try {
      const data = await rpc('siap_school_verify', { p_token: token });
      if (!data?.authenticated) clearSchoolSession();
      else {
        sessionStorage.setItem(SCHOOL_NPSN_KEY, data.npsn || getCurrentNpsn());
        sessionStorage.setItem(SCHOOL_NAME_KEY, data.school_name || getCurrentSchool());
        window.SIAP_BOS_CURRENT_NPSN = data.npsn || getCurrentNpsn();
        window.SIAP_BOS_CURRENT_SCHOOL = data.school_name || getCurrentSchool();
      }
      return data;
    } catch (e) {
      clearSchoolSession();
      return { success: false, authenticated: false, error: e.message };
    }
  }

  async function schoolLogout() {
    const token = getSchoolToken();
    if (token) {
      try { await rpc('siap_school_logout', { p_token: token }); } catch (_) {}
    }
    clearSchoolSession();
    return { success: true };
  }

  // ---------------- School project CRUD ----------------
  async function getProjects() {
    const token = getSchoolToken();
    if (!token) return [];
    const data = await rpc('siap_school_get_projects', { p_token: token });
    if (!data?.success) throw new Error(data?.error || 'Gagal mengambil pekerjaan.');
    return Array.isArray(data.projects) ? data.projects.map(normalizeProject) : [];
  }

  async function getProject(id) {
    const token = getSchoolToken();
    if (!token) throw new Error('Sesi sekolah belum aktif.');
    const data = await rpc('siap_school_get_project', { p_token: token, p_id: String(id) });
    if (!data?.success) throw new Error(data?.error || 'Gagal mengambil pekerjaan.');
    return data.project ? normalizeProject(data.project) : null;
  }

  async function saveProject(portable) {
    const token = getSchoolToken();
    if (!token) throw new Error('Belum login sebagai sekolah.');
    // Blob tidak bisa di-JSON-kan; file diserialisasikan menjadi data URL oleh project-store.js.
    const data = await rpc('siap_school_save_project', { p_token: token, p_payload: portable });
    if (!data?.success) throw new Error(data?.error || 'Gagal menyimpan pekerjaan.');
    return data;
  }

  async function deleteProject(id) {
    const token = getSchoolToken();
    if (!token) throw new Error('Belum login sebagai sekolah.');
    const data = await rpc('siap_school_delete_project', { p_token: token, p_id: String(id) });
    if (!data?.success) throw new Error(data?.error || 'Gagal menghapus pekerjaan.');
    return data;
  }

  // ---------------- Admin auth ----------------
  async function adminLogin(password) {
    const data = await rpc('siap_admin_login', { p_password: String(password || '') });
    if (!data?.success || !data.token) throw new Error(data?.error || 'Login Administrator gagal.');
    sessionStorage.setItem(ADMIN_TOKEN_KEY, data.token);
    return data;
  }

  async function adminVerify() {
    const token = getAdminToken();
    if (!token) return { success: false, authenticated: false };
    try { return await rpc('siap_admin_verify', { p_token: token }); }
    catch (e) { return { success: false, authenticated: false, error: e.message }; }
  }

  async function adminLogout() {
    const token = getAdminToken();
    if (token) {
      try { await rpc('siap_admin_logout', { p_token: token }); } catch (_) {}
    }
    sessionStorage.removeItem(ADMIN_TOKEN_KEY);
    return { success: true };
  }

  async function adminChangePassword(currentPassword, newPassword) {
    const token = getAdminToken();
    if (!token) throw new Error('Sesi Administrator tidak tersedia.');
    return rpc('siap_admin_change_password', {
      p_token: token,
      p_current_password: String(currentPassword || ''),
      p_new_password: String(newPassword || '')
    });
  }

  // ---------------- Admin project/activation APIs ----------------
  async function adminGetProjects() {
    const token = getAdminToken();
    if (!token) throw new Error('Sesi Administrator tidak tersedia.');
    const data = await rpc('siap_admin_get_projects', { p_token: token });
    if (!data?.success) throw new Error(data?.error || 'Gagal mengambil data panel admin.');
    return Array.isArray(data.projects) ? data.projects.map(normalizeProject) : [];
  }

  async function adminDeleteProject(id) {
    const token = getAdminToken();
    if (!token) throw new Error('Sesi Administrator tidak tersedia.');
    return rpc('siap_admin_delete_project', { p_token: token, p_id: String(id) });
  }

  async function adminGetActivations() {
    const token = getAdminToken();
    if (!token) throw new Error('Sesi Administrator tidak tersedia.');
    return rpc('siap_admin_get_activations', { p_token: token });
  }

  async function adminToggleActivation(npsn, schoolName, kecamatan, isActive, activatedBy) {
    const token = getAdminToken();
    if (!token) throw new Error('Sesi Administrator tidak tersedia.');
    return rpc('siap_admin_toggle_activation', {
      p_token: token,
      p_npsn: String(npsn || '').trim(),
      p_school_name: String(schoolName || ''),
      p_kecamatan: String(kecamatan || ''),
      p_is_active: !!isActive,
      p_activated_by: activatedBy || 'Pengawas Monitoring'
    });
  }

  async function adminBatchActivation(items, isActive, activatedBy) {
    const token = getAdminToken();
    if (!token) throw new Error('Sesi Administrator tidak tersedia.');
    return rpc('siap_admin_batch_activation', {
      p_token: token,
      p_items: Array.isArray(items) ? items : [],
      p_is_active: !!isActive,
      p_activated_by: activatedBy || 'Pengawas Monitoring'
    });
  }

  window.SIAP_BOS_SUPABASE = {
    isConfigured,
    rpc,
    getAdminToken,
    getSchoolToken,
    getCurrentNpsn,
    getCurrentSchool,
    clearSchoolSession,
    schoolCheck,
    schoolLogin,
    schoolVerify,
    schoolLogout,
    getProjects,
    getProject,
    saveProject,
    deleteProject,
    adminLogin,
    adminVerify,
    adminLogout,
    adminChangePassword,
    adminGetProjects,
    adminDeleteProject,
    adminGetActivations,
    adminToggleActivation,
    adminBatchActivation
  };

  if (isConfigured()) console.log('✓ SIAP BOS: Supabase Cloud siap.');
  else console.warn('⚠️ SIAP BOS: Supabase belum dikonfigurasi.');
})();
