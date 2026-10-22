'use strict';
/* ============================================================
   LAPANGANKU APP - vanilla JS, single file
   Sections: helpers, demo data, storage, toast, modal, theme,
   auth, data layer (GViz + Apps Script), router, views.
   ============================================================ */

/* ---------- helpers ---------- */
const $ = (s, el) => (el || document).querySelector(s);
const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));
const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
// WHY: sanitasi URL - cegah javascript: protocol dan URL berbahaya lainnya
const safeUrl = (url) => {
  // WHY cek null/undefined dulu: String(null) = "null" yang merupakan path URL valid,
  // jadi new URL("null", base) tidak melempar exception dan mengembalikan URL palsu.
  if (url == null) return '#';
  try {
    // WHY String(url): new URL(123, base) melempar TypeError untuk input non-string.
    // Data dari server (mis. picture Google) bisa jadi angka - jangan sampai
    // exception di sini membuat halaman blank.
    const u = new URL(String(url), location.href);
    if (u.protocol === 'http:' || u.protocol === 'https:' || u.protocol === 'mailto:' || u.protocol === 'tel:') return u.href;
    return '#';
  } catch (e) { return '#'; }
};
const fmtRp = (n) => 'Rp ' + Number(n || 0).toLocaleString('id-ID');
const pad2 = (n) => String(n).padStart(2, '0');
const ymd = (d) => d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
const addDays = (base, n) => { const d = new Date(base); d.setDate(d.getDate() + n); return d; };
/* ---------- recurring booking mingguan (FITUR 2, spek 2026-10-10) ---------- */
// WHY: tanggal seri = hari yang sama, +7 hari per minggu. Dibangun dari komponen
// tanggal lokal (new Date(y, m-1, d), tengah malam) lalu addDays - aman lintas zona
// waktu & DST karena tidak pernah menyentuh jam/waktu (round-trip lokal).
// Fungsi pure: HARUS identik di app.js dan index.html (test mengekstrak dari app.js).
function recurringDates(startDateStr, weeks) {
  if (!Number.isInteger(weeks) || weeks < 2 || weeks > 8) return [];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDateStr || '')) return [];
  const [y, m, d] = startDateStr.split('-').map(Number);
  const base = new Date(y, m - 1, d);
  if (isNaN(base.getTime())) return [];
  const out = [];
  for (let i = 0; i < weeks; i++) out.push(ymd(addDays(base, i * 7)));
  return out;
}
const DAY_ID = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];
const MON_ID = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
const fmtDate = (s) => { const [y, m, d] = s.split('-').map(Number); const dt = new Date(y, m - 1, d); return DAY_ID[dt.getDay()] + ', ' + d + ' ' + MON_ID[m - 1]; };
const fmtHour = (h) => pad2(h) + '.00';
// WHY: "hari ini" menurut WIB (Asia/Jakarta), bukan jam device - user di zona waktu lain tidak boleh melihat slot
// kemarin tergolong hari ini (draft/lead time/slot past semuanya bergantung fungsi ini; paritas dengan server TZ Asia/Jakarta)
const todayStr = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
const isToday = (s) => s === todayStr();
// WHY: menit sekarang diukur di WIB, bukan zona device - pasangan todayStr() WIB; kalau jam device dipakai,
// user di luar WIB melihat slot hari ini "sudah lewat"/"belum boleh dibooking" bergeser berjam-jam (paritas server Asia/Jakarta).
// Formatter dibuat sekali (pembuatan Intl.DateTimeFormat mahal; dipanggil per slot saat render grid).
const WIB_TIME_FMT = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const nowMin = () => { const p = WIB_TIME_FMT.formatToParts(new Date()); const g = (t) => Number(p.find(x => x.type === t).value); return g('hour') * 60 + g('minute'); };
const randCode = () => { const c = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; let r = ''; for (let i = 0; i < 4; i++) r += c[Math.floor(Math.random() * c.length)]; return r; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const ICONS = {
  clock: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/></svg>',
  calendar: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 3v4M16 3v4M3 10h18"/></svg>',
  doc: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M9 13h6M9 17h6"/></svg>',
  sun: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
  moon: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>',
  check: '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="square" stroke-linejoin="miter" aria-hidden="true"><path d="M20 6L9 17l-5-5"/></svg>',
  x: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="square" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12"/></svg>',
  plus: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="square" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
  chev: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="square" stroke-linejoin="miter" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>',
  left: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="square" stroke-linejoin="miter" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>',
  right: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="square" stroke-linejoin="miter" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>',
  info: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></svg>',
  alert: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="square" stroke-linejoin="miter" aria-hidden="true"><path d="M12 3l10 18H2L12 3z" fill="none"/><path d="M12 10v4M12 17.5h.01"/></svg>',
  out: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="square" stroke-linejoin="miter" aria-hidden="true"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/></svg>',
  users: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.2 3.4-5 6.5-5s5.7 1.8 6.5 5"/><circle cx="17.5" cy="9" r="2.5"/><path d="M17 15c2.4.3 4 1.8 4.5 4"/></svg>',
  download: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="square" stroke-linejoin="miter" aria-hidden="true"><path d="M12 3v12M7 10l5 5 5-5M4 21h16"/></svg>',
  copy: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="square" stroke-linejoin="miter" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="1"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>',
  search: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.5-4.5"/></svg>',
  trash: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="square" stroke-linejoin="miter" aria-hidden="true"><path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13M10 11v6M14 11v6"/></svg>',
  chart: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="square" aria-hidden="true"><path d="M4 20V10M10 20V4M16 20v-7M21 20H3"/></svg>',
  bell: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="square" stroke-linejoin="miter" aria-hidden="true"><path d="M18 9a6 6 0 1 0-12 0c0 6-2 7-2 7h16s-2-1-2-7M10.5 20a2 2 0 0 0 3 0"/></svg>',
  list: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="square" aria-hidden="true"><path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01"/></svg>',
  wa: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M12 3a9 9 0 0 0-7.8 13.5L3 21l4.6-1.2A9 9 0 1 0 12 3z"/><path d="M9 8.5c0 4 2.5 6.5 6.5 6.5l1-2-2.2-1.3-1 .9a5.3 5.3 0 0 1-1.9-1.9l.9-1L11 7.5l-2 1z"/></svg>',
  star: '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2l3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z"/></svg>',
  quote: '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 6C4.8 6 3 7.8 3 10s1.8 4 4 4c.3 0 .6 0 .9-.1-.5 1.8-2 3-3.9 3.2V19c3.9-.2 7-3.4 7-7.4V10c0-2.2-1.8-4-4-4zm10 0c-2.2 0-4 1.8-4 4s1.8 4 4 4c.3 0 .6 0 .9-.1-.5 1.8-2 3-3.9 3.2V19c3.9-.2 7-3.4 7-7.4V10c0-2.2-1.8-4-4-4z"/></svg>',
  // Ikon fasilitas venue. Sumber: Lucide (ISC) - stroke 1.8px, konsisten dengan ikon lain.
  facCar: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2"/><circle cx="7" cy="17" r="2"/><path d="M9 17h6"/><circle cx="17" cy="17" r="2"/></svg>',
  facLock: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>',
  facBag: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M16 10a4 4 0 0 1-8 0"/><path d="M3.103 6.034h17.794"/><path d="M3.4 5.467a2 2 0 0 0-.4 1.2V20a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6.667a2 2 0 0 0-.4-1.2l-2-2.667A2 2 0 0 0 17 2H7a2 2 0 0 0-1.6.8z"/></svg>',
  facUtensils: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2"/><path d="M7 2v20"/><path d="M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7"/></svg>',
  facArmchair: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 9V6a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v3"/><path d="M3 16a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5a2 2 0 0 0-4 0v1.5a.5.5 0 0 1-.5.5h-9a.5.5 0 0 1-.5-.5V11a2 2 0 0 0-4 0z"/><path d="M5 18v2"/><path d="M19 18v2"/></svg>',
  facBulb: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/><path d="M9 18h6"/><path d="M10 22h4"/></svg>',
  facMoonStar: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 5h4"/><path d="M20 3v4"/><path d="M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803a6 6 0 0 0 8.268 8.268c.344-.215.825-.004.803.401"/></svg>',
  facWifi: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h.01"/><path d="M2 8.82a15 15 0 0 1 20 0"/><path d="M5 12.859a10 10 0 0 1 14 0"/><path d="M8.5 16.429a5 5 0 0 1 7 0"/></svg>',
  // Ikon kebijakan (section 04). Sumber: Lucide (ISC).
  ruleShield: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/></svg>',
  ruleCancel: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>',
  ruleResched: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M16 14v2.2l1.6 1"/><path d="M16 2v3"/><path d="M21 7.338V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h2.338"/><path d="M3 9h5.859"/><path d="M8 2v3"/><circle cx="16" cy="16" r="6"/></svg>',
  rulePay: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 17V7"/><path d="M16 8h-6a2 2 0 0 0 0 4h4a2 2 0 0 1 0 4H8"/><path d="M4 3a1 1 0 0 1 1-1 1.3 1.3 0 0 1 .7.2l.933.6a1.3 1.3 0 0 0 1.4 0l.934-.6a1.3 1.3 0 0 1 1.4 0l.933.6a1.3 1.3 0 0 0 1.4 0l.933-.6a1.3 1.3 0 0 1 1.4 0l.934.6a1.3 1.3 0 0 0 1.4 0l.933-.6A1.3 1.3 0 0 1 19 2a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1 1.3 1.3 0 0 1-.7-.2l-.933-.6a1.3 1.3 0 0 0-1.4 0l-.934.6a1.3 1.3 0 0 1-1.4 0l-.933-.6a1.3 1.3 0 0 0-1.4 0l-.933.6a1.3 1.3 0 0 1-1.4 0l-.934-.6A1.3 1.3 0 0 0 8 21a1 1 0 0 1-1-1z"/></svg>'
};

/* ---------- storage ---------- */
// WHY: store dideklarasikan sebelum state karena state memakai store.get() saat inisialisasi draft persist
const store = {
  get(k, def) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : def; } catch (e) { return def; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { console.warn('storage failed', e); } },
  del(k) { try { localStorage.removeItem(k); } catch (e) {} }
};

/* ---------- state ---------- */
/**
 * @typedef {Object} User
 * @property {string} name
 * @property {string} email
 * @property {string} picture
 */

/**
 * @typedef {Object} Booking
 * @property {string} booking_id
 * @property {string} email
 * @property {string} nama
 * @property {string} venue_id
 * @property {string} tanggal
 * @property {string} jam_mulai
 * @property {number} durasi
 * @property {number} total_harga
 * @property {string} payment_option
 * @property {string} payment_status
 * @property {string} status
 */

/**
 * @typedef {Object} AppState
 * @property {User|null} user
 * @property {string|null} credential
 * @property {Object|null} data
 * @property {Object} slots
 * @property {Booking[]} myBookings
 * @property {Array} waitlist
 * @property {string[]} reviewed
 * @property {string|null} loadError
 * @property {Booking[]} allBookings
 * @property {string|null} intended
 * @property {Object} booking
 * @property {Object} owner
 */

/** @type {AppState} */
const state = {
  user: null, credential: null,
  data: null,
  slots: {},
  myBookings: [],
  waitlist: [],
  reviewed: [],
  loadError: null,
  allBookings: [],
  intended: null,
  booking: Object.assign({ tab: 'baru', date: todayStr(), hour: null, duration: 1, court: null, pay: 'full', addons: {}, splitCount: null, recurWeeks: null }, store.get('lk-draft-v1', {})),
  owner: { tab: 'dash', date: todayStr(), fDate: '', fCourt: '', fStatus: '', q: '' },
  // Feature flags for A/B testing
  flags: {
    newBookingFlow: false,
    enhancedSearch: false,
    darkModeDefault: false,
    pushNotifications: false
  }
};

// A/B test assignment
function assignTest(testName, variants) {
  const key = 'lk-ab-' + testName;
  let variant = store.get(key, null);
  if (!variant) {
    variant = variants[Math.floor(Math.random() * variants.length)];
    store.set(key, variant);
  }
  return variant;
}

/* ---------- demo data (labeled, used until CONFIG is filled) ---------- */
const DEMO_CONFIG = {
  jam_buka_mulai: 6, jam_buka_selesai: 22, slot_minutes: 60, max_advance_days: 14,
  cancel_cutoff_hours: 2, booking_lead_hours: 2, max_hours_per_booking: 3, harga_default: 45000,
  owner_emails: ['owner@lapanganku.id'],
  peak_hours: '18,19,20', peak_days: '1,2,3,4,5', peak_multiplier: 1.5,
  // WHY: jam sepi (adopsi riset kompetitor) - diskon 20% jam yang biasanya kosong
  off_hours: '6,7,8,21', off_days: '1,2,3,4,5', off_multiplier: 0.8,
  // WHY (2026-10-11): sistem voucher DIHAPUS total atas keputusan Mas.
  // WHY: harga dinamis (FITUR 4, spek 2026-10-10) - diskon otomatis jam sepi bila okupansi
  // menjelang hari-H di bawah ambang. Aktif default di demo agar perilaku terlihat tanpa setup.
  dyn_enabled: '1', dyn_threshold: 30, dyn_days_before: 1, dyn_extra_pct: 10,
  // WHY (revisi 2026-10-11): katalog reward loyalty - format "ID:Nama:poin,ID:Nama:poin".
  // Client (venue owner) bisa ubah nama & biaya poin via config. ID stabil untuk tracking.
  loyalty_rewards: 'DRINK:Minuman segar:50,SNACK:Snack ringan:75,FREE1H:Gratis 1 jam lapangan:500'
};
const DEMO_COURTS = [
  { id: 'LK1', nama: 'Lapangan 1', olahraga: 'Bulu Tangkis', harga_per_jam: 45000, status: 'aktif' },
  { id: 'LK2', nama: 'Lapangan 2', olahraga: 'Bulu Tangkis', harga_per_jam: 45000, status: 'aktif' },
  { id: 'LK3', nama: 'Lapangan 3', olahraga: 'Bulu Tangkis', harga_per_jam: 45000, status: 'aktif' },
  { id: 'LK4', nama: 'Lapangan 4', olahraga: 'Bulu Tangkis', harga_per_jam: 45000, status: 'aktif' }
];
// WHY: rating & ulasan contoh untuk mode demo - supaya tampilan bintang/ulasan bisa dinilai
// tanpa setup live. Semua berlabel jelas lewat banner "Mode Demo" yang sudah ada.
const DEMO_RATINGS = {
  LK1: { avg: 4.8, count: 23 }, LK2: { avg: 4.6, count: 17 },
  LK3: { avg: 4.9, count: 31 }, LK4: { avg: 4.5, count: 12 }
};
const DEMO_REVIEWS = [
  { nama: 'Budi S.', venue_id: 'LK3', rating: 5, komentar: 'Lantainya bersih, penerangan merata. Net-nya juga masih prima, enak buat smash.', tanggal: '2026-09-28' },
  { nama: 'Rina W.', venue_id: 'LK1', rating: 5, komentar: 'Booking online gampang, datang tinggal tunjukin kode. Nggak perlu telepon-teleponan lagi.', tanggal: '2026-09-26' },
  { nama: 'Andi P.', venue_id: 'LK2', rating: 4, komentar: 'Parkirnya luas, ada musala juga. Cuma AC-nya agak kurang dingin kalau jam ramai.', tanggal: '2026-09-24' },
  { nama: 'Dewi A.', venue_id: 'LK3', rating: 5, komentar: 'Sewa raket di kantin murah, shuttle-nya juga oke. Recommended buat yang lupa bawa alat.', tanggal: '2026-09-21' }
];
// WHY: satu booking lampau di demo sudah diulas - supaya kedua keadaan tombol ("Beri ulasan"
// vs sudah diulas) bisa dilihat tanpa setup live.
const DEMO_REVIEWED = ['LK-DEMO-REVIEWED'];
// WHY: produk tambahan (adopsi pola AYO "Produk Tambahan"). Harga di sini hanya untuk preview -
// server tetap menghitung ulang dari sheet AddOn dan mengabaikan harga kiriman client.
const DEMO_ADDONS = [
  { id: 'RAKET', nama: 'Rental raket', harga: 15000, satuan: 'unit', max_qty: 4 },
  { id: 'SHUTTLE', nama: 'Shuttlecock (3 pcs)', harga: 25000, satuan: 'set', max_qty: 3 },
  { id: 'AIR', nama: 'Air mineral 600ml', harga: 5000, satuan: 'botol', max_qty: 6 }
];
const DEMO_BOOKINGS = (() => {
  const t = todayStr(), d1 = ymd(addDays(new Date(), 1)), d3 = ymd(addDays(new Date(), -3));
  const mk = (id, email, nama, venue, tanggal, jam, durasi, opt, pay, status) =>
    ({ booking_id: id, created_at: new Date().toISOString(), email, nama, venue_id: venue, tanggal, jam_mulai: fmtHour(jam), durasi, total_harga: 45000 * durasi, payment_option: opt, payment_status: pay, status });
  return [
    mk('LK-DEMO-001', 'alice@mail.com', 'Alice Putri', 'LK1', t, 9, 2, 'full', 'paid', 'active'),
    mk('LK-DEMO-002', 'budi@mail.com', 'Budi Santoso', 'LK2', t, 10, 1, 'full', 'paid', 'active'),
    mk('LK-DEMO-003', 'citra@mail.com', 'Citra Dewi', 'LK3', t, 19, 3, 'dp', 'dp', 'active'),
    mk('LK-DEMO-004', 'dodi@mail.com', 'Dodi Pratama', 'LK4', t, 20, 1, 'full', 'unpaid', 'active'),
    mk('LK-DEMO-005', 'erik@mail.com', 'Erik Nugraha', 'LK1', d1, 8, 2, 'full', 'paid', 'active'),
    mk('LK-DEMO-006', 'fitri@mail.com', 'Fitri Handayani', 'LK2', d1, 19, 2, 'dp', 'dp', 'active'),
    mk('LK-DEMO-007', 'gilang@mail.com', 'Gilang Ramadhan', 'LK3', d1, 10, 1, 'full', 'paid', 'active'),
    mk('LK-DEMO-008', 'hana@mail.com', 'Hana Salsabila', 'LK4', d1, 15, 3, 'full', 'paid', 'active'),
    mk('LK-DEMO-009', 'alice@mail.com', 'Alice Putri', 'LK2', d3, 9, 1, 'full', 'paid', 'cancelled'),
    // WHY: booking lampau milik penyewa demo - tanpa ini tombol "Beri ulasan" tak pernah muncul
    // di mode demo, sehingga fitur ulasan tidak bisa dinilai sebelum setup live.
    mk('LK-DEMO-010', 'penyewa@demo.id', 'Budi Santoso', 'LK3', d3, 16, 2, 'full', 'paid', 'active'),
    mk('LK-DEMO-011', 'penyewa@demo.id', 'Budi Santoso', 'LK1', ymd(addDays(new Date(), -5)), 10, 1, 'full', 'paid', 'active')
  ];
})();

/* ---------- demo storage ---------- */
const demoStore = {
  key: 'lk-demo-bookings',
  all() { return store.get(this.key, []); },
  save(list) { store.set(this.key, list); },
  mine() { const u = effectiveUser(); return u ? this.all().filter(b => b.email === u.email) : []; }
};
// WHY: waitlist demo di localStorage - fitur live (server) punya alur sama via sheet Waitlist
const demoWaitlistStore = {
  key: 'lk-demo-waitlist',
  all() { return store.get(this.key, []); },
  save(list) { store.set(this.key, list); },
  mine() { const u = effectiveUser(); return u ? this.all().filter(w => w.email === u.email && w.status === 'active') : []; }
};

/* ---------- toast ---------- */
// WHY (Jakob #12): toast mendukung aksi opsional (mis. Undo) - aksi menghentikan auto-dismiss.
function toast(msg, type, action) {
  type = type || 'info';
  const icons = { ok: ICONS.check, err: ICONS.alert, info: ICONS.info };
  const el = document.createElement('div');
  el.className = 'toast toast-' + (type === 'ok' ? 'ok' : type === 'err' ? 'err' : 'info');
  el.innerHTML = '<span class="t-icon">' + (icons[type] || icons.info) + '</span><span>' + esc(msg) + '</span>' +
    (action ? '<button class="t-act" type="button"></button>' : '');
  $('#toasts').appendChild(el);
  // WHY: spring enter ala iOS notification - interruptible, velocity-aware
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!reduce) {
    el.style.transform = 'translateY(12px)';
    el.style.opacity = '0';
    requestAnimationFrame(() => requestAnimationFrame(() => {
      springAnimate({ from: 12, to: 0, damping: 0.8, response: 0.3,
        onUpdate: (y) => { el.style.transform = 'translateY(' + y + 'px)'; el.style.opacity = String(1 - y / 12); } });
    }));
  }
  let dismissed = false;
  const dismiss = () => {
    if (dismissed) return; dismissed = true;
    if (!reduce) {
      springAnimate({ from: 0, to: 12, damping: 1, response: 0.2,
        onUpdate: (y) => { el.style.transform = 'translateY(' + y + 'px)'; el.style.opacity = String(1 - y / 12); },
        onEnd: () => el.remove() });
    } else { el.remove(); }
  };
  if (action) {
    const act = $('.t-act', el);
    act.textContent = action.label;
    act.addEventListener('click', () => { dismiss(); action.onClick(); });
    setTimeout(dismiss, 8000); // WHY: aksi butuh waktu baca lebih lama dari toast biasa
  } else {
    setTimeout(dismiss, 3500);
  }
}

/* ---------- modal ---------- */
/* ---------- modal (apple-design: mobile = spring sheet, desktop = scale+fade) ---------- */
// WHY state module-level, fungsi pecah-peran (Rule 12.1) - facade `Modal` di akhir blok menjaga API pemanggil lama.
let modalLastFocus = null, modalCurrent = null;
function buildBackdrop(opts) {
  const back = document.createElement('div');
  back.className = 'modal-backdrop';
  back.innerHTML = '<div class="modal-panel" role="dialog" aria-modal="true" aria-label="' + esc(opts.title) + '" aria-labelledby="modal-title" tabindex="-1">' +
    '<div class="sheet-grip" aria-hidden="true"></div>' +
    '<div class="modal-head"><h2 style="font-size:20px">' + esc(opts.title) + '</h2>' +
    '<button class="icon-btn" data-close aria-label="Tutup dialog">' + ICONS.x + '</button></div>' +
    '<div class="modal-body">' + opts.body + '</div></div>';
  return back;
}
function modalOpen(opts) {
  if (modalCurrent) modalClose(true);
  modalLastFocus = document.activeElement;
  const back = buildBackdrop(opts);
  $('#modal-root').appendChild(back);
  modalCurrent = back;
  const panel = $('.modal-panel', back);
  if (matchMedia('(max-width:639px)').matches) animateSheetIn(back, panel);
  else requestAnimationFrame(() => back.classList.add('open'));
  bindModalEvents(back, panel);
  if (opts.onMount) opts.onMount(panel);
  (panel.querySelector('button, input, [tabindex]') || panel).focus();
  // WHY: lock saat proses async berjalan (bayar/batal) - menutup modal di tengah proses menyembunyikan
  // side effect yang sudah terjadi (booking tersimpan) dan mengundang double-submit.
  return { panel, close: () => modalClose(), lock: (v) => { back.dataset.busy = v ? '1' : ''; } };
}
function bindModalEvents(back, panel) {
  $('[data-close]', back).addEventListener('click', () => modalClose());
  back.addEventListener('mousedown', (e) => { if (e.target === back) modalClose(); });
  back.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); modalClose(); }
    if (e.key === 'Tab') trapTabFocus(e, panel);
  });
}
function modalClose(instant) {
  const back = modalCurrent; if (!back) return;
  if (back.dataset.busy) return; // lock: proses async berjalan, side effect sudah terjadi
  modalCurrent = null;
  const restore = () => { if (modalLastFocus && modalLastFocus.isConnected) modalLastFocus.focus(); };
  if (instant) { back.remove(); restore(); return; }
  back.classList.add('closing');
  const panel = $('.modal-panel', back);
  if (matchMedia('(max-width:639px)').matches && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    animateSheetOut(back, panel, currentTranslateY(panel), restore); // §7: exit jalur sama dari bawah
  } else {
    setTimeout(() => { back.remove(); restore(); }, 220);
  }
}
const Modal = { open: modalOpen, close: modalClose };
/* WHY pecahan modal (Rule 12.1): tab trap di luar blok modal.
   getClientRects, bukan offsetParent - elemen di backdrop position:fixed selalu offsetParent null
   sehingga filter lama mengosongkan daftar dan focus trap tak pernah aktif (Rule 1.9). */
function trapTabFocus(e, panel) {
  const f = $$('a[href], button:not([disabled]), input, select, [tabindex="0"]', panel).filter(el => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden');
  if (!f.length) return;
  const first = f[0], last = f[f.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
}
/* ---------- apple-design §4: sheet masuk spring damping .8 response .3 (tabel skill) - sedikit bounce karena
   datang sebagai gesture; keluar critical damped response .2 (settle analitik = 4xresponse utk ζ=1); §7 jalur sama dari bawah. */
function animateSheetOut(back, panel, from, onDone) {
  panel.style.transition = 'none';
  springAnimate({ from, to: window.innerHeight, damping: 1, response: 0.2,
    onUpdate: (y) => { panel.style.transform = 'translateY(' + y + 'px)'; },
    onEnd: () => { back.remove(); if (onDone) onDone(); } });
}
function animateSheetIn(back, panel) {
  panel.style.transition = 'none';
  panel.style.transform = 'translateY(100%)';
  requestAnimationFrame(() => requestAnimationFrame(() => {
    back.classList.add('open');
    springAnimate({ from: window.innerHeight, to: 0, damping: 0.8, response: 0.3, onUpdate: (y) => { panel.style.transform = 'translateY(' + Math.max(0, y) + 'px)'; } });
  }));
  bindSheetDrag(back, panel);
}
// WHY: baca posisi Y live dari computed transform (§3 interruptibility - animasi selalu dari presentation value)
function currentTranslateY(el) {
  const t = getComputedStyle(el).transform;
  if (!t || t === 'none') return 0;
  const m = t.match(/matrix\(([^)]+)\)/);
  return m ? parseFloat(m[1].split(',')[5]) || 0 : 0;
}
/* ---------- apple-design §2/§5/§6/§9: drag-to-dismiss sheet dengan momentum + rubber-band ---------- */
// Pola: 1:1 tracking (setPointerCapture), threshold 10px sebelum commit, grab di mana pun pada panel (bukan hanya grip),
// rubber-band saat ditarik ke atas melewati 0, velocity handoff + momentum projection (decel 0.998) menentukan dismiss vs kembali.
/* helper pecahan (Rule 12.1): velocity saat release dari riwayat sampel ~100ms terakhir (px/s) */
function releaseVelocityFrom(samples, clientY) {
  const now = performance.now();
  const old = samples.find(s => now - s.t < 100) || samples[0];
  const dt = Math.max(now - old.t, 1) / 1000;
  return (clientY - old.y) / dt;
}
/* helper pecahan (Rule 12.1): animasi dismiss + cleanup; identitas backdrop dicek eksplisit agar
   tidak menghapus modal BARU yang kebetulan sudah terbuka saat spring lama masih berjalan */
function dismissWithVelocity(back, panel, from, vy, focusRef) {
  back.classList.add('closing');
  springAnimate({ from, to: window.innerHeight + 60, velocity: vy, damping: 1, response: 0.25,
    onUpdate: (y) => { panel.style.transform = 'translateY(' + y + 'px)'; },
    onEnd: () => { const c = document.querySelector('.modal-backdrop'); if (c === back) { c.remove(); if (focusRef && focusRef.isConnected) focusRef.focus(); } } });
}
/* konstanta fisika drag (apple-design §6/§9): decel 0.998 = momentum scroll iOS; rubber 0.55 = resistensi progresif */
const SHEET_DECEL = 0.998;
const sheetProject = (v) =>
  (v / 1000) * SHEET_DECEL / (1 - SHEET_DECEL);

const sheetRubber = (over) =>
  (over * 360 * 0.55) / (360 + 0.55 * Math.abs(over));
function bindSheetDrag(back, panel) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const lastFocusRef = document.activeElement; // fokus saat modal dibuka - direstore setelah dismiss via drag
  let startY = 0, startT = 0, tracking = false, committed = false;
  const samples = [];
  panel.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button, input, select, a, label')) return; // kontrol interaktif tetap normal
    if (panel.scrollTop > 0) return; // WHY: izinkan scroll isi; drag dismiss hanya dari posisi paling atas
    tracking = true; committed = false;
    startY = e.clientY - currentTranslateY(panel);
    startT = performance.now();
    samples.length = 0;
    samples.push({ y: e.clientY, t: startT });
    panel.style.transition = 'none';
    try { panel.setPointerCapture(e.pointerId); } catch (err) {}
  });
  panel.addEventListener('pointermove', (e) => {
    if (!tracking) return;
    const y = e.clientY - startY;
    samples.push({ y: e.clientY, t: performance.now() });
    if (samples.length > 6) samples.shift(); // riwayat pendek utk velocity saat release
    if (!committed) {
      if (Math.abs(y) < 10) return; // §10 hysteresis: jangan keliru saat intent belum jelas
      committed = true;
      panel.style.touchAction = 'none';
    }
    panel.style.transform = 'translateY(' + (y < 0 ? sheetRubber(y) : y) + 'px)'; // 1:1 ke bawah, rubber-band ke atas
  });
  panel.addEventListener('pointerleave', () => { tracking = tracking && committed ? tracking : false; });
  function finish(e) {
    if (!tracking) return;
    tracking = false;
    if (!committed) return;
    panel.style.touchAction = '';
    const vy = releaseVelocityFrom(samples, e.clientY);
    const cur = currentTranslateY(panel);
    // §6 momentum projection: keputusan dismiss dari velocity, bukan posisi (§10)
    const projected = cur + sheetProject(vy);
    if (projected > 120 || e.type === 'pointercancel') {
      haptic(6);
      dismissWithVelocity(back, panel, cur, vy, lastFocusRef);
    } else {
      // kembali ke 0 dengan spring; velocity dibawa agar tanpa "brick wall" (§5)
      springAnimate({ from: cur, to: 0, velocity: vy, damping: 0.8, response: 0.3,
        onUpdate: (y) => { panel.style.transform = 'translateY(' + Math.max(0, y) + 'px)'; } });
    }
  }
  panel.addEventListener('pointerup', finish);
  panel.addEventListener('pointercancel', finish);
}

/* ---------- theme ---------- */
function applyTheme(t) {
  document.documentElement.setAttribute('data-theme', t);
  store.set('lk-theme', t);
  $('#theme-toggle').setAttribute('aria-label', t === 'dark' ? 'Aktifkan tema terang' : 'Aktifkan tema gelap');
  const mc = document.querySelector('meta[name="theme-color"]'); if (mc) mc.content = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim(); // WHY: dari token, bukan hex hardcoded (Rule 1.3)
}
function initTheme() {
  const saved = store.get('lk-theme', null);
  applyTheme(saved || 'light'); // WHY: light default sesuai revisi user (22 Sep 2026); pilihan user tetap persist
  paintThemeBtn();
  $('#theme-toggle').addEventListener('click', () => {
    const cur = document.documentElement.getAttribute('data-theme');
    const next = cur === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    paintThemeBtn();
    toast(next === 'dark' ? 'Tema gelap aktif' : 'Tema terang aktif', 'info');
  });
}
// WHY (Jakob #1/#6): ikon tema dibarengi label "Tema" - jelas fungsinya tanpa menebak simbol
function paintThemeBtn() {
  const dark = document.documentElement.getAttribute('data-theme') === 'dark';
  $('#theme-toggle').innerHTML = (dark ? ICONS.sun : ICONS.moon) + '<span class="lbl">Tema</span>';
}

/* ---------- auth ---------- */
function decodeJwt(token) {
  try {
    const p = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(decodeURIComponent(atob(p).split('').map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)).join('')));
  } catch (e) { console.warn('jwt decode failed', e); return null; }
}
// WHY: credential Google (JWT) mati ~1 jam (claim exp) - exp disimpan agar restore sesi bisa
// membedakan sesi Google basi (wajib login ulang, API live pasti menolak) dari sesi demo (tanpa exp = tetap sah).
function jwtExp(credential) {
  // WHY guard: credential demo ('demo-token') bukan JWT - tanpa cek titik ini console jadi berisik 'jwt decode failed'
  if (!credential || typeof credential !== 'string' || credential.split('.').length < 2) return 0;
  const p = decodeJwt(credential);
  return p && p.exp ? Number(p.exp) : 0;
}
// WHY dipisah: keputusan sesi masih layak pakai - bisa di-unit-test (tests/auth-session.test.mjs)
// CATATAN: claim exp JWT dalam DETIK - konversi x1000 sebelum dibanding Date.now() (ms)
function sessionUsable(sess, nowMs) {
  if (!sess || !sess.user) return false;
  const expMs = (Number(sess.exp) || 0) * 1000;
  return !expMs || nowMs < expMs; // demo tanpa exp = selalu sah; Google basi = tidak sah
}
function setSession(profile, credential) {
  state.user = { name: profile.name || 'Pengguna', email: profile.email || '', picture: profile.picture || '' };
  state.credential = credential || null;
  state.credentialExp = credential ? jwtExp(credential) : 0;
  updateAuthUI(); renderNav();
  // WHY (Jakob #3): kembalikan user ke halaman yang memintanya masuk (tombol Masuk menyimpan state.intended);
  // kalau user membuka gate langsung (tanpa tombol Masuk), biarkan di rute sekarang.
  // WHY konsumsi dulu: intended SEKALI PAKAI - yang tersimpan di lk-session selalu null, kalau tidak,
  // reload berikutnya me-restore tujuan basi dan user "ter-yank" lagi ke sana (tertangkap test session-flow).
  const dest = (state.intended && state.intended !== location.hash) ? state.intended : null;
  state.intended = null;
  store.set('lk-session', { user: state.user, credential: state.credential, exp: state.credentialExp, intended: null });
  if (dest) location.hash = dest;
  else route();
}
function logout() {
  // WHY: konfirmasi logout via modal custom - accessible (focus trap, Escape, aria)
  const m = Modal.open({
    title: 'Keluar dari LapanganKu?',
    body: '<p class="t-sm muted">Sesi kamu akan dihapus dari browser ini. Kamu perlu masuk lagi untuk booking.</p>' +
      '<div style="display:flex;gap:8px;margin-top:16px"><button class="btn btn-ghost" data-no style="flex:1">Batal</button>' +
      '<button class="btn btn-danger" data-yes style="flex:1">Ya, Keluar</button></div>',
    onMount: (panel) => {
      $('[data-no]', panel).addEventListener('click', () => m.close());
      $('[data-yes]', panel).addEventListener('click', () => {
        m.close();
        state.user = null; state.credential = null; store.del('lk-session');
        state.myBookings = []; state.allBookings = []; state.slots = {}; state.waitlist = [];
        state.intended = null;
        // WHY (Batch A, security): antrean offline + draft milik user lama tidak boleh terbaca
        // atau ter-replay oleh pengguna berikutnya di perangkat bersama.
        syncQueue.length = 0; store.del('lk-sync-queue'); store.del('lk-draft-v1');
        updateAuthUI(); renderNav(); route();
        toast('Kamu sudah keluar. Sampai jumpa!', 'info');
      });
    }
  });
}
function initGIS() {
  if (!CONFIG.GOOGLE_CLIENT_ID || !window.google || !google.accounts) return false;
  try {
    google.accounts.id.initialize({
      client_id: CONFIG.GOOGLE_CLIENT_ID,
      callback: (resp) => {
        const p = decodeJwt(resp.credential);
        if (p) setSession(p, resp.credential);
        toast('Masuk berhasil. Selamat datang, ' + (p ? (p.given_name || p.name) : '') + '!', 'ok');
      }
    });
    return true;
  } catch (e) { console.warn('GIS init failed', e); return false; }
}
// WHY: GIS tidak bisa dipakai tanpa script-nya; muat lazy hanya saat live mode (Rule 1.11 lazy load, Rule 1.13 graceful degradation)
function loadGsi() {
  if (document.getElementById('lk-gsi')) return;
  const s = document.createElement('script');
  s.id = 'lk-gsi'; s.src = 'https://accounts.google.com/gsi/client'; s.async = true; s.defer = true;
  s.onerror = () => console.warn('GIS script gagal dimuat');
  document.head.appendChild(s);
}
function loadGsiThen(ready) {
  loadGsi();
  const t0 = Date.now();
  const iv = setInterval(() => {
    if (initGIS()) { clearInterval(iv); ready(); }
    else if (Date.now() - t0 > 8000) { clearInterval(iv); console.warn('GIS load timeout'); }
  }, 250);
}
function updateAuthUI() {
  const area = $('#auth-area');
  if (!state.user) {
    // WHY CLS: tombol Masuk sudah ada sejak HTML statis (SSR shell) - jangan replace ulang bila sudah ada (identik = tanpa shift)
    if (!$('#btn-login')) {
      area.innerHTML = '<button class="btn btn-primary btn-sm" id="btn-login" style="min-height:44px">Masuk</button>';
    }
    // WHY guard dataset.bound: updateAuthUI dipanggil ulang tiap setSession/logout - tanpa guard,
    // listener klik menumpuk di tombol yang sama (satu klik = handler jalan N kali).
    const loginBtn = $('#btn-login');
    if (!loginBtn.dataset.bound) {
      loginBtn.dataset.bound = '1';
      loginBtn.addEventListener('click', (e) => { e.stopPropagation(); state.intended = location.hash || '#/'; location.hash = '#/booking'; });
    }
    return;
  }
  const initial = (state.user.name || '?').trim().charAt(0).toUpperCase();
  // WHY safeUrl: state.user.picture datang dari token Google - kalau nilainya bukan http(s)
  // (mis. "javascript:"), src tidak boleh dipasang mentah. Ini satu-satunya jalur di mana
  // data pihak ketiga masuk ke atribut URL.
  const rawAvatar = state.user.picture || 'https://ui-avatars.com/api/?name=' + encodeURIComponent(state.user.name || '?') + '&background=random&color=fff&size=64';
  const avatarUrl = safeUrl(rawAvatar);
  area.innerHTML = '<button class="user-chip" id="user-chip" aria-haspopup="true" aria-expanded="false" aria-label="Menu akun ' + esc(state.user.name) + '">' +
    '<span class="avatar" aria-hidden="true"><img src="' + esc(avatarUrl) + '" alt="" width="32" height="32" style="border-radius:50%;object-fit:cover"></span>' +
    '<span class="t-sm" style="max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(state.user.name.split(' ')[0]) + '</span></button>' +
    '<div class="user-menu" id="user-menu" role="menu"><div class="um-name">' + esc(state.user.name) + '</div><div class="um-email">' + esc(state.user.email) + '</div>' +
    '<button role="menuitem" id="btn-logout">' + ICONS.out + ' Keluar</button></div>';
  const chip = $('#user-chip'), menu = $('#user-menu');
  chip.addEventListener('click', (e) => {
    e.stopPropagation();
    const openNow = menu.classList.toggle('open');
    chip.setAttribute('aria-expanded', String(openNow));
  });
  // WHY: menu harus bisa ditutup keyboard juga (Rule 1.9), bukan hanya klik luar
  chip.addEventListener('keydown', (e) => { if (e.key === 'Escape' && menu.classList.contains('open')) { menu.classList.remove('open'); chip.setAttribute('aria-expanded', 'false'); chip.focus(); } });
  document.addEventListener('click', () => { menu.classList.remove('open'); chip.setAttribute('aria-expanded', 'false'); }, { once: true });
  $('#btn-logout').addEventListener('click', logout);
}

/* ---------- gate login (core): dipakai chunk booking DAN monitoring ---------- */
// WHY pindah ke core (rev 3z): kedua rute memanggil renderLoginGate saat belum login;
// kalau tinggal di satu chunk, rute lain kena ReferenceError saat dimuat langsung (nav fresh ke #/monitoring).
function renderLoginGate(el, target) {
  const demo = state.data.demo;
  el.innerHTML = '<div class="gate">' +
    '<p class="kicker" style="margin-bottom:8px">Akses penyewa</p>' +
    '<h1>Masuk dengan Google</h1>' +
    '<p class="muted" style="margin:8px 0 16px">Booking wajib login Google supaya jadwalmu tersimpan dan bisa dibatalkan kapan saja.</p>' +
    '<div class="card">' +
      '<div id="gsi-holder"></div>' +
      '<p class="t-xs faint" style="margin-top:8px">Dengan masuk kamu setuju pada <button class="link-plain" data-open-privacy>Kebijakan Privasi</button>.</p>' +
    '</div></div>';
  const holder = $('#gsi-holder', el);
  holder.style.minWidth = '104px'; // WHY CLS: renderButton GIS menyuntik iframe 120px tinggi - ruang dicadangkan agar gate tidak melompat
  if (initGIS()) {
    try {
      google.accounts.id.renderButton(holder, { theme: 'filled_black', size: 'large', shape: 'rectangular', text: 'signin_with', locale: 'id' });
    } catch (e) { holder.innerHTML = '<p class="t-sm muted">Tombol Google gagal dimuat. Cek koneksi lalu refresh.</p>'; }
  } else if (CONFIG.GOOGLE_CLIENT_ID) {
    loadGsiThen(() => { if (el.isConnected) renderLoginGate(el, target); }); // WHY: script GIS dimuat on-demand lalu gate dirender ulang
  } else {
    holder.innerHTML = '<p class="t-sm muted">Login Google belum dikonfigurasi. Isi GOOGLE_CLIENT_ID di CONFIG (lihat SETUP.md).</p>';
  }
  bindLegalButtons();
}

/* ---------- data layer: data venue publik (tanpa PII) ---------- */
// WHY VULN-001: jalur GViz DIHAPUS. Dulu client membaca sheet langsung lewat /gviz/tq, yang
// mewajibkan spreadsheet di-share "Anyone with the link" - sehingga sheet Booking & Waitlist
// (nama, email, jadwal seluruh pelanggan) bisa diunduh siapa pun yang tahu SHEET_ID.
// Sekarang data venue dibaca lewat endpoint Apps Script yang mengembalikan whitelist field aman saja.
let publicCache = { ts: 0, data: null };
async function loadPublic() {
  const configured = !!(CONFIG.APPS_SCRIPT_URL && CONFIG.GOOGLE_CLIENT_ID);
  if (!configured) {
    return { config: DEMO_CONFIG, courts: DEMO_COURTS, demo: true, ownerEmails: DEMO_CONFIG.owner_emails,
             ratings: DEMO_RATINGS, reviews: DEMO_REVIEWS, addOns: DEMO_ADDONS };
  }
  if (publicCache.data && Date.now() - publicCache.ts < 300000) return publicCache.data; // WHY: cache 5 menit - data venue jarang berubah
  try {
    const d = await api('getPublicData', {});
    const config = Object.assign({}, DEMO_CONFIG, d.config || {});
    // WHY (FITUR 4): dyn_* opt-in di live - jangan warisi default DEMO_CONFIG bila server
    // (versi lama) tidak mengirimnya; tanpa ini live menampilkan diskon yang server tak terapkan.
    ['dyn_enabled', 'dyn_threshold', 'dyn_days_before', 'dyn_extra_pct'].forEach(k => {
      if (!d.config || d.config[k] == null) delete config[k];
    });
    const courts = (d.courts || []).map(c => ({
      id: String(c.id), nama: String(c.nama), olahraga: c.olahraga || 'Bulu Tangkis',
      harga_per_jam: Number(c.harga_per_jam) || DEMO_CONFIG.harga_default, status: c.status || 'aktif'
    }));
    // WHY: rating & ulasan dari server (nama sudah disamarkan di sisi server - email tak pernah dikirim)
    const data = { config, courts, demo: false, ownerEmails: [],
                   ratings: d.ratings || {}, reviews: d.reviews || [], addOns: d.addOns || [] };
    publicCache = { ts: Date.now(), data };
    return data;
  } catch (e) {
    console.warn('loadPublic failed, fallback demo', e);
    toast('Gagal memuat data online, menampilkan data demo.', 'err');
    return { config: DEMO_CONFIG, courts: DEMO_COURTS, demo: true, ownerEmails: DEMO_CONFIG.owner_emails,
             ratings: DEMO_RATINGS, reviews: DEMO_REVIEWS, addOns: DEMO_ADDONS };
  }
}
/* ---------- rating & ulasan (adopsi pola AYO) ---------- */
// WHY: bintang + ulasan = sinyal kepercayaan sebelum booking. Semua angka dari data nyata
// (Rule 1.8) - tidak ada rating karangan; kalau belum ada ulasan, tampil ajakan jadi yang pertama.
function ratingFor(courtId) {
  const r = (state.data && state.data.ratings) || {};
  return r[courtId] || null;
}
function starHtml(rating, size) {
  const s = size || 14;
  let out = '<span class="stars" role="img" aria-label="Rating ' + rating.toFixed(1) + ' dari 5">';
  for (let i = 1; i <= 5; i++) {
    // WHY: setengah bintang untuk .5+ agar 4.5 tidak tampil sama dengan 4
    const fill = rating >= i ? 'full' : (rating >= i - 0.5 ? 'half' : 'empty');
    out += '<span class="star ' + fill + '" aria-hidden="true">' + ICONS.star + '</span>';
  }
  return out + '</span>';
}
function ratingLine(courtId) {
  const r = ratingFor(courtId);
  if (!r || !r.count) return '<span class="cmeta rating-none">Belum ada ulasan</span>';
  return '<span class="cmeta rating-line">' + starHtml(r.avg) +
    '<b>' + r.avg.toFixed(1) + '</b><span class="muted">(' + r.count + ' ulasan)</span></span>';
}

/* ---------- peak & off-peak pricing ---------- */
// WHY: mirror perhitungan server (bookingTotal) - hanya untuk preview UI; server tetap sumber kebenaran.
function peakCfg() {
  const cfg = state.data.config;
  return { hours: String(cfg.peak_hours || '').split(/[\s,]+/).filter(Boolean).map(Number), days: String(cfg.peak_days || '').split(/[\s,]+/).filter(Boolean).map(Number), mult: Number(cfg.peak_multiplier) || 1 };
}
// WHY: harga jam sepi (adopsi riset kompetitor) - cermin offConfig() di Code.gs.
// Guard mult >= 1 diperlakukan nonaktif, sama seperti server.
function offCfg() {
  const cfg = state.data.config;
  let mult = Number(cfg.off_multiplier) || 1;
  if (mult >= 1 || mult <= 0) mult = 1;
  return { hours: String(cfg.off_hours || '').split(/[\s,]+/).filter(Boolean).map(Number), days: String(cfg.off_days || '').split(/[\s,]+/).filter(Boolean).map(Number), mult: mult };
}
// WHY: voucher kode promo (adopsi AYO harga coret) - isi jam sepi.
// Config: cfg.vouchers = "HEMAT20:20,HEMAT50:50" (kode:persen diskon)
// WHY server-authoritative (audit P0-3): server kini mengirim `vouchers` di getPublicData dan
// menghitung potongan di createBooking. Di mode live daftar ini TIDAK boleh berasal dari
// DEMO_CONFIG (dulu bocor via Object.assign -> user melihat diskon yang server tidak terapkan).
/* ---------- loyalty points (FITUR 5, spek 2026-10-10) ---------- */
// WHY: earn 1 poin per Rp10.000 dari total booking selesai
// (case-insensitive) -> diskon flat Rp10.000. Deterministik, tanpa akses state.
// Fungsi pure: HARUS identik di app.js dan index.html (test mengekstrak dari app.js).
function loyaltyEarn(totalHarga) {
  if (!Number.isFinite(totalHarga) || totalHarga <= 0) return 0;
  return Math.floor(totalHarga / 10000);
}
// WHY (revisi 2026-10-11): parse katalog reward dari string config "ID:Nama:poin".
// Fungsi pure: HARUS identik di app.js dan index.html (test mengekstrak dari app.js).
function loyaltyRewardsParse(raw) {
  return String(raw || '').split(',').map(s => {
    const [id, name, pts] = s.split(':');
    const points = Number(pts);
    return { id: (id || '').trim(), name: (name || '').trim(), points: points };
  }).filter(r => r.id && r.name && Number.isFinite(r.points) && r.points > 0);
}
// WHY: DOW dihitung dari komponen tanggal via Date.UTC + getUTCDay - sifat tanggal kalender WIB,
// identik di zona waktu runtime mana pun (getDay() biasa membaca TZ device: di Amerika, Senin WIB terbaca Minggu).
// Paritas dengan server (isPeakHour/isOffHour) dijamin karena kedua sisi memakai rumus deterministik yang sama.
function dowOf(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}
function isPeak(dateStr, hour) {
  const p = peakCfg();
  if (!p.hours.length || p.mult <= 1 || !p.hours.includes(hour)) return false;
  if (!p.days.length) return true;
  return p.days.includes(dowOf(dateStr));
}
function isOffPeak(dateStr, hour) {
  const p = offCfg();
  if (!p.hours.length || p.mult >= 1 || !p.hours.includes(hour)) return false;
  if (!p.days.length) return true;
  return p.days.includes(dowOf(dateStr));
}
// WHY: peak menang atas off-peak - paritas persis dengan hourPrice() di server.
function hourPriceAt(court, dateStr, hour) {
  if (isPeak(dateStr, hour)) return Math.round(court.harga_per_jam * peakCfg().mult);
  if (isOffPeak(dateStr, hour)) return Math.round(court.harga_per_jam * offCfg().mult * dynHourMult(dateStr, hour));
  return court.harga_per_jam;
}
/* ---------- dynamic off-peak pricing (FITUR 4, spek 2026-10-10) ---------- */
// WHY: diskon otomatis jam sepi berbasis okupansi - nilai jual ke owner (riset kompetitor).
// Berlaku HANYA untuk jam off-peak yang tanggalnya dalam jendela H- dan okupansi tanggal itu
// di bawah ambang. Semua input primitif agar testable tanpa state; parameter todayStr
// men-shadow global todayStr (lihat spek). Fungsi pure: HARUS identik di app.js dan index.html.
function dynDiscountMult(isOffPeakHour, dynEnabled, daysBefore, bookingDateStr, todayStr, occupancyPct, thresholdPct, extraPct) {
  var on = dynEnabled === true || dynEnabled === 1 || String(dynEnabled) === '1';
  if (!on || !isOffPeakHour) return 1;
  if (occupancyPct == null || !isFinite(occupancyPct)) return 1; // fail-safe: data okupansi belum ada
  if (Number(occupancyPct) >= Number(thresholdPct)) return 1;
  // WHY selisih hari via Date.UTC: deterministik lintas zona runtime (pola sama seperti dowOf).
  var bd = String(bookingDateStr).split('-').map(Number);
  var td = String(todayStr).split('-').map(Number);
  var diff = (Date.UTC(bd[0], bd[1] - 1, bd[2]) - Date.UTC(td[0], td[1] - 1, td[2])) / 86400000;
  if (!isFinite(diff)) return 1; // fail-safe: format tanggal rusak
  var win = Number(daysBefore);
  if (!(win >= 0)) win = 1; // default jendela H-1
  if (diff < 0 || diff > win) return 1;
  var extra = Math.min(100, Math.max(0, Number(extraPct) || 0));
  return 1 - extra / 100;
}
// WHY: baca config harga dinamis dari state.data.config (demo: DEMO_CONFIG; live: config server).
// Live: gabung override owner dari localStorage `lk-dyn-cfg` (server belum punya API simpan config).
function dynCfg() {
  var cfg = state.data.config || {};
  if (state.data.demo !== true) {
    var local = store.get('lk-dyn-cfg', null);
    if (local && typeof local === 'object') cfg = Object.assign({}, cfg, local);
  }
  return {
    enabled: cfg.dyn_enabled === true || cfg.dyn_enabled === 1 || String(cfg.dyn_enabled) === '1',
    threshold: Number(cfg.dyn_threshold) || 30,
    daysBefore: (cfg.dyn_days_before === undefined || cfg.dyn_days_before === null || cfg.dyn_days_before === '') ? 1 : Number(cfg.dyn_days_before),
    extraPct: (cfg.dyn_extra_pct === undefined || cfg.dyn_extra_pct === null || cfg.dyn_extra_pct === '') ? 10 : Number(cfg.dyn_extra_pct)
  };
}
// WHY: okupansi harian dari state.slots yang sudah di-load via loadSlots:
// jam terisi / (lapangan aktif x jam operasional) x 100. Return null bila data belum ada -> tanpa diskon.
function dayOccupancy(dateStr) {
  var m = state.slots && state.slots[dateStr];
  if (!m || typeof m !== 'object') return null;
  var cfg = state.data.config || {};
  var hours = Number(cfg.jam_buka_selesai) - Number(cfg.jam_buka_mulai);
  var courts = (state.data.courts || []).filter(function (c) { return c.status === 'aktif'; });
  var cap = courts.length * hours;
  if (!(cap > 0)) return null;
  var filled = 0;
  for (var i = 0; i < courts.length; i++) {
    var h = m[courts[i].id];
    if (Array.isArray(h)) filled += h.length;
  }
  return filled / cap * 100;
}
// WHY: jembatan state -> fungsi pure. Hanya off-peak yang dievaluasi (peak tidak pernah didiskon).
function dynHourMult(dateStr, hour) {
  var d = dynCfg();
  if (!d.enabled || !isOffPeak(dateStr, hour)) return 1;
  return dynDiscountMult(true, true, d.daysBefore, dateStr, todayStr(), dayOccupancy(dateStr), d.threshold, d.extraPct);
}
function bookingPrice(court, dateStr, hour, duration) {
  let total = 0;
  for (let i = 0; i < duration; i++) total += hourPriceAt(court, dateStr, hour + i);
  return total;
}
/* ---------- split-bill / patungan (FITUR 1, spek 2026-10-10) ---------- */
// WHY: total dibelah ke N share INTEGER yang jumlahnya tetap = total.
// Sisa pembulatan (+1) jatuh ke share pertama - deterministik, mudah dijelaskan ke penyewa.
// Fungsi pure: HARUS identik di app.js dan index.html (test mengekstrak dari app.js).
function splitBillShares(total, count) {
  if (!Number.isFinite(total) || total <= 0) return [];
  if (!Number.isInteger(count) || count < 2 || count > 8) return [];
  const base = Math.floor(total / count);
  const rest = total % count;
  const shares = [];
  for (let i = 0; i < count; i++) shares.push(base + (i < rest ? 1 : 0));
  return shares;
}
function splitBillProgress(shares) {
  const list = Array.isArray(shares) ? shares : [];
  const paid = list.filter(s => s && s.paid).length;
  return { paid: paid, total: list.length, allPaid: list.length > 0 && paid === list.length };
}
/* ---------- verified skill rating (FITUR 3, spek 2026-10-10) ---------- */
// WHY: rating Elo terverifikasi dari hasil match tercatat - melawan label level self-claim kompetitor.
// K = 32, rating awal 1200. Fungsi pure: HARUS identik di app.js dan index.html (test mengekstrak dari app.js).
function eloUpdate(rA, rB, scoreA) {
  const expA = 1 / (1 + Math.pow(10, (rB - rA) / 400));
  const expB = 1 / (1 + Math.pow(10, (rA - rB) / 400));
  return { a: Math.round(rA + 32 * (scoreA - expA)), b: Math.round(rB + 32 * ((1 - scoreA) - expB)) };
}
// WHY: parseSets hanya validasi format, bukan penentuan pemenang - "21-15" per set, dipisah
// koma/spasi, maks 3 set, tiap set dua angka 0-30 dan tidak boleh seri.
function parseSets(str) {
  if (typeof str !== 'string') return null;
  const parts = str.split(/[,\s]+/).filter(s => s);
  if (parts.length < 1 || parts.length > 3) return null;
  const out = [];
  for (const p of parts) {
    const m = /^(\d{1,2})-(\d{1,2})$/.exec(p);
    if (!m) return null;
    const a = Number(m[1]), b = Number(m[2]);
    if (a > 30 || b > 30 || a === b) return null;
    out.push([a, b]);
  }
  return out;
}
// WHY: pemenang = menang 2 set, set dimenangkan skor lebih tinggi. Skor imbang (1-1) -> null.
function matchWinner(sets) {
  if (!Array.isArray(sets)) return null;
  let a = 0, b = 0;
  for (const s of sets) {
    if (!Array.isArray(s) || s.length !== 2 || s[0] === s[1]) return null;
    if (s[0] > s[1]) a++; else b++;
  }
  if (a >= 2 && b < 2) return 'A';
  if (b >= 2 && a < 2) return 'B';
  return null;
}
function bookingTarifLabel(court, dateStr, hour, duration) {
  const prices = [];
  for (let i = 0; i < duration; i++) prices.push(hourPriceAt(court, dateStr, hour + i));
  const uniq = [...new Set(prices)];
  if (uniq.length === 1) {
    const tag = isPeak(dateStr, hour) ? ' (jam sibuk)' : (isOffPeak(dateStr, hour) ? ' (jam sepi)' : '');
    const dyn = isOffPeak(dateStr, hour) && !isPeak(dateStr, hour) && dynHourMult(dateStr, hour) < 1 ? ' (dinamis)' : '';
    return fmtRp(uniq[0]) + '/jam' + tag + dyn;
  }
  const min = Math.min.apply(null, uniq), max = Math.max.apply(null, uniq);
  return fmtRp(min) + ' - ' + fmtRp(max) + '/jam (harga per jam berbeda)';
}

/* ---------- user feedback ---------- */
// WHY: in-app feedback form untuk collect user feedback tanpa tool eksternal
function openFeedbackModal() {
  Modal.open({
    title: 'Kirim Masukan',
    body: '<p class="t-sm muted" style="margin-bottom:12px">Masukan kamu sangat berarti untuk pengembangan LapanganKu.</p>' +
      '<label class="fld">Nama<input id="fb-nama" placeholder="Nama kamu" maxlength="80"></label>' +
      '<label class="fld">Email<input id="fb-email" type="email" placeholder="email@kamu.com" maxlength="120"></label>' +
      '<label class="fld">Kategori<select id="fb-kategori"><option value="bug">Bug / Error</option><option value="fitur">Request Fitur</option><option value="ux">UX / Tampilan</option><option value="lainnya">Lainnya</option></select></label>' +
      '<label class="fld">Pesan<textarea id="fb-pesan" placeholder="Tulis masukan kamu di sini..." rows="4" maxlength="500" style="resize:vertical"></textarea></label>' +
      '<div style="display:flex;gap:8px"><button class="btn btn-primary" id="fb-send">Kirim</button><button class="btn btn-ghost" id="fb-cancel">Batal</button></div>',
    onMount: (panel) => {
      $('#fb-cancel', panel).addEventListener('click', () => Modal.close());
      $('#fb-send', panel).addEventListener('click', async () => {
        const nama = $('#fb-nama', panel).value.trim();
        const email = $('#fb-email', panel).value.trim();
        const kategori = $('#fb-kategori', panel).value;
        const pesan = $('#fb-pesan', panel).value.trim();
        if (!pesan) { toast('Pesan tidak boleh kosong.', 'err'); return; }
        const btn = $('#fb-send', panel);
        btn.classList.add('loading');
        btn.disabled = true;
        try {
          if (state.data && state.data.demo) {
            await sleep(400);
            toast('Mode demo: masukan tersimpan di browser.', 'ok');
          } else {
            // WHY handleSubmitFeedback (audit P2-7): dulu masukan dikirim ke logError dengan
            // nama+email diselipkan ke field `stack` - PII masuk kolom stack trace dan dua kanal
            // (error teknis vs masukan) bercampur. Kini endpoint + sheet sendiri.
            await api('submitFeedback', { nama: nama, email: email, kategori: kategori, pesan: pesan });
            toast('Masukan terkirim. Terima kasih!', 'ok');
          }
          Modal.close();
        } catch (e) {
          btn.classList.remove('loading');
          btn.disabled = false;
          toast('Gagal mengirim masukan. Coba lagi.', 'err');
        }
      });
    }
  });
}

/* ---------- analytics (dev-only) ---------- */
// WHY JUJUR (audit P2-12): fungsi ini hanya console.log - TIDAK ada backend analytics, jadi
// klaim "funnel analysis" di dokumentasi sebelumnya tidak berdasar dan datanya tidak pernah
// tersimpan. Sekarang hanya aktif di mode demo (alat bantu debug), tidak pernah di produksi,
// dan namanya menyatakan apa adanya. Kalau analitik nyata dibutuhkan, bangun endpoint-nya dulu.
var _funnelLog = [];
var _errorCount = 0;
var _apiLatencyLog = [];
function trackEvent(event, data) {
  const entry = {
    ts: new Date().toISOString(),
    event: event,
    data: data || {},
    route: location.hash,
    loggedIn: !!state.user
  };
  // Always log funnel events, and all events in demo mode
  if ((state.data && state.data.demo) || ['landing_view', 'booking_start', 'booking_complete', 'payment_success', 'booking_cancel'].includes(event)) {
    console.log('[funnel] ' + JSON.stringify(entry));
  }
  // Session replay: store events for debugging
  if (state.data && state.data.demo) {
    const events = store.get('lk-session-events', []);
    events.push(entry);
    // Keep only last 100 events
    if (events.length > 100) events.shift();
    store.set('lk-session-events', events);
  }
}

/* ---------- CSRF ---------- */
// WHY VULN-004: token CSRF lama DIHAPUS. Dulu client membuat token acak dan mengirimnya di header
// X-CSRF-Token, tapi server tidak pernah membacanya - jadi klaim "CSRF protection" itu palsu.
// Untuk Apps Script (tidak bisa baca header HTTP), model pertahanan yang benar adalah:
//   1. autentikasi berbasis token Google di body (bukan cookie) - CSRF klasik tidak berlaku,
//      karena penyerang tidak bisa memaksa browser mengirim credential milik korban;
//   2. verifikasi origin best-effort di server (isValidRequest).
// Tidak ada state yang perlu dipertahankan di sini.

/* ---------- error recovery ---------- */
// WHY: retry logic dengan exponential backoff untuk network errors
async function withRetry(fn, maxRetries = 3, baseDelay = 1000) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (err.code === 'NETWORK' && attempt < maxRetries) {
        const delay = baseDelay * Math.pow(2, attempt);
        await sleep(delay);
        continue;
      }
      throw err;
    }
  }
}

/* ---------- data layer: Apps Script ---------- */
// WHY withRetry dipakai di sini: fetch bisa gagal sesaat (jaringan seluler tidak stabil, WiFi
// pindah). Percobaan ulang otomatis 2x dengan backoff menghindari user melihat error padahal
// tinggal coba lagi. HANYA error NETWORK yang diulang - error validasi/auth tidak ada gunanya
// diulang (hasilnya sama) dan bisa memperlambat respons.
// Background sync queue for offline actions
var syncQueue = [];
var syncInProgress = false;

async function processSyncQueue() {
  if (syncInProgress || !syncQueue.length) return;
  syncInProgress = true;
  while (syncQueue.length) {
    const item = syncQueue[0];
    // WHY (Batch A, security): antrean offline di-replay dengan kredensial sesi SAAT INI.
    // Tanpa cap email, skenario perangkat bersama (A antre offline -> A logout -> B login ->
    // online) menyimpan booking berisi PII A atas identitas B. Item yang email-nya tidak
    // cocok dengan sesi aktif dibuang, bukan di-replay.
    if (item.email && (!state.user || item.email !== state.user.email)) {
      syncQueue.shift();
      continue;
    }
    try {
      await apiOnce(item.action, item.payload);
      syncQueue.shift();
    } catch (e) {
      break; // Stop on failure, retry later
    }
  }
  syncInProgress = false;
}

window.addEventListener('online', () => {
  processSyncQueue();
  toast('Koneksi kembali. Menyimpan perubahan...', 'ok');
});

async function api(action, payload) {
  // Queue mutations when offline
  if (!navigator.onLine && ['createBooking', 'cancelBooking', 'rescheduleBooking', 'ownerUpdateBooking', 'ownerCreateBooking', 'waitlistJoin', 'waitlistCancel', 'submitReview'].includes(action)) {
    syncQueue.push({ action, payload, email: state.user ? state.user.email : null }); // WHY (Batch A): cap identitas saat enqueue, lihat processSyncQueue.
    store.set('lk-sync-queue', syncQueue);
    throw new Error('Koneksi terputus. Perubahan akan disimpan saat online.');
  }
  // WHY: Track booking funnel events with latency monitoring (P2-12)
  const startTime = performance.now();
  try {
    const result = await withRetry(() => apiOnce(action, payload), 2, 600);
    const latency = performance.now() - startTime;
    // Log API latency for performance monitoring
    if (state.data && state.data.demo || ['createBooking', 'cancelBooking', 'rescheduleBooking'].includes(action)) {
      console.log('[api] ' + JSON.stringify({ action: action, latencyMs: Math.round(latency), status: 'ok' }));
    }
    // Track booking funnel events
    if (action === 'createBooking') trackEvent('booking_complete', { latency: Math.round(latency) });
    if (action === 'cancelBooking') trackEvent('booking_cancel', { latency: Math.round(latency) });
    if (action === 'rescheduleBooking') trackEvent('booking_reschedule', { latency: Math.round(latency) });
    return result;
  } catch (err) {
    const latency = performance.now() - startTime;
    if (state.data && state.data.demo || ['createBooking', 'cancelBooking', 'rescheduleBooking'].includes(action)) {
      console.log('[api] ' + JSON.stringify({ action: action, latencyMs: Math.round(latency), status: 'error' }));
    }
    trackError(err, 'api_' + action);
    throw err;
  }
}
function trackError(err, context) {
  _errorCount++;
  const entry = {
    ts: new Date().toISOString(),
    error: err.message || String(err),
    context: context || 'unknown',
    route: location.hash,
    loggedIn: !!state.user,
    userAgent: navigator.userAgent
  };
  console.error('[error] ' + JSON.stringify(entry));
  if (state.data && state.data.demo) {
    var log = store.get('lk-error-log', []);
    log.push(entry);
    if (log.length > 50) log.shift();
    store.set('lk-error-log', log);
  }
}
async function apiOnce(action, payload) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  const startTime = performance.now();
  let res;
  try {
    res = await fetch(CONFIG.APPS_SCRIPT_URL + '?origin=' + encodeURIComponent(location.origin), {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(Object.assign({ action, credential: state.credential }, payload || {})),
      signal: ctrl.signal
    });
  } catch (e) {
    const err = new Error(e.name === 'AbortError' ? 'Koneksi lambat. Cek internet lalu coba lagi.' : 'Jaringan bermasalah. Cek koneksi internet lalu coba lagi.');
    err.code = 'NETWORK';
    throw err;
  } finally {
    clearTimeout(timer);
  }
  const json = await res.json();
  const duration = performance.now() - startTime;
  // Performance metrics: log slow requests
  if (duration > 1000) {
    console.warn('[perf] ' + action + ' took ' + Math.round(duration) + 'ms');
  }
  if (!json.ok) { const err = new Error(json.error && json.error.message || 'Terjadi kesalahan'); err.code = json.error && json.error.code; throw err; }
  return json.data;
}
/* ---------- structured logging (client) ---------- */
// WHY: logStructured dipakai init() & triggerClientWebhook tapi tidak pernah didefinisikan di client -
// setiap page load melempar ReferenceError (unhandled rejection). Definisi client: structured console log,
// paritas dengan logStructured() di Code.gs (server memakai Stackdriver).
function logStructured(level, message, context) {
  try {
    console.log(JSON.stringify({ ts: new Date().toISOString(), level: level || 'info', message: String(message).slice(0, 500), context: context || {}, route: location.hash }));
  } catch (e) { /* logging tidak boleh melempar */ }
}

/* ---------- progress bar global (Jakob #8) ---------- */
// WHY: proses >300ms (fetch API/sheet) wajib ada indikator; bar tipis di tepi atas, non-blocking.
let progressUsers = 0;
function progressStart() {
  progressUsers++;
  const bar = $('#topbar-progress');
  if (bar) bar.classList.add('on');
}
function progressEnd() {
  progressUsers = Math.max(0, progressUsers - 1);
  if (!progressUsers) { const bar = $('#topbar-progress'); if (bar) bar.classList.remove('on'); }
}
async function withProgress(promise) {
  progressStart();
  try { return await promise; } finally { progressEnd(); }
}

async function loadSlots(date) {
  if (state.data.demo) {
    const all = DEMO_BOOKINGS.concat(demoStore.all()).filter(b => b.status === 'active' && b.tanggal === date);
    const map = {};
    all.forEach(b => { (map[b.venue_id] = map[b.venue_id] || []).push(...hoursOf(b)); });
    state.slots[date] = map;
    return map;
  }
  const d = await withProgress(api('getData', { date })); // WHY: fetch live bisa >1 detik - butuh indikator
  state.slots[date] = d.slots && d.slots[date] ? d.slots[date] : {};
  // WHY VULN-001: ownerAccess + ownerEmails hanya dikirim server ke owner terverifikasi.
  if (d.ownerAccess) { state.allBookings = d.bookings || []; state.data.ownerEmails = d.ownerEmails || []; }
  return state.slots[date];
}
const hoursOf = (b) => { const h = parseInt(b.jam_mulai, 10); const out = []; for (let i = 0; i < Number(b.durasi || 1); i++) out.push(h + i); return out; };
// WHY di core: dipakai dua chunk (booking: slot grid; monitoring: timeline + KPI + walk-in)
function hoursRange(cfg) { const out = []; for (let h = cfg.jam_buka_mulai; h < cfg.jam_buka_selesai; h++) out.push(h); return out; }
const isBooked = (date, court, h) => { const m = state.slots[date] || {}; return (m[court] || []).includes(h); };
// WHY: booking dianggap selesai bila tanggalnya sudah lewat, atau hari ini tapi jam akhirnya sudah lewat.
// Dipakai gerbang tombol "Beri ulasan" - server tetap memvalidasi ulang (reviewableBookings).
function isPastBooking(b) {
  const t = todayStr();
  if (b.tanggal < t) return true;
  if (b.tanggal > t) return false;
  return (parseInt(b.jam_mulai, 10) + Number(b.durasi || 1)) * 60 <= nowMin();
}

/* ---------- booking domain helpers ---------- */
function slotBlockedByLead(date, h) {
  if (!isToday(date)) return false;
  return h * 60 - nowMin() < (state.data.config.booking_lead_hours || 2) * 60;
}
function slotPast(date, h) {
  if (!isToday(date)) return false;
  return h * 60 <= nowMin();
}
function isMine(date, court, h) {
  return state.myBookings.some(b => b.status === 'active' && b.tanggal === date && b.venue_id === court && hoursOf(b).includes(h));
}
function courtFree(court, date, h, dur) {
  for (let i = 0; i < dur; i++) {
    const hh = h + i;
    if (hh >= state.data.config.jam_buka_selesai) return false;
    if (isBooked(date, court, hh)) return false;
    if (slotPast(date, hh)) return false;
  }
  return true;
}
function canCancel(b) {
  if (b.status !== 'active') return false;
  const [y, m, d] = b.tanggal.split('-').map(Number);
  // WHY: jam mulai WIB dikonversi ke epoch via Date.UTC(..., h-7) - cutoff tidak tergantung zona device
  // (new Date(y,m-1,d,h) lama membaca TZ device: cutoff 2 jam bergeser sesuai offset zona user)
  const start = Date.UTC(y, m - 1, d, parseInt(b.jam_mulai, 10) - 7, 0);
  const diff = (start - Date.now()) / 3600000;
  return diff >= (state.data.config.cancel_cutoff_hours || 2);
}
/* Tag status + bookingMaxDate: core karena dipakai dua chunk (booking & monitoring) - rev 3z */
function payTag(b) { return '<span class="tag ' + (b.payment_status === 'paid' ? 'tag-ok' : b.payment_status === 'dp' ? 'tag-warn' : 'tag-bad') + '">' + (b.payment_status === 'paid' ? 'Lunas' : b.payment_status === 'dp' ? 'DP 50%' : 'Belum bayar') + '</span>'; }
function statusTag(b) { return '<span class="tag ' + (b.status === 'active' ? 'tag-brand' : 'tag-neutral') + '">' + (b.status === 'active' ? 'Aktif' : 'Dibatalkan') + '</span>'; }
// WHY: batas H-N harus dari kalender WIB, bukan TZ device.
// ymd(addDays(new Date(), N)) bisa geser 1 hari di TZ+14
// (uji: 23:30 WIB di Kiritimati -> 2026-10-16, seharusnya 2026-10-15).
function bookingMaxDate() {
  const [y, m, d] = todayStr().split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + state.data.config.max_advance_days));
  return t.getUTCFullYear() + '-' + pad2(t.getUTCMonth() + 1) + '-' + pad2(t.getUTCDate());
}

/* ---------- router ---------- */
// WHY: arrow lazy - fungsi render tinggal di chunk on-demand; referensi langsung di sini = ReferenceError saat core dimuat
const routes = { '/': (el) => renderLanding(el), '/booking': (el) => renderBooking(el), '/monitoring': (el) => renderMonitoring(el) };
/* WHY unused-JS (LH: 97 KB): kode per rute dipecah jadi chunk on-demand (script klasik, fungsi tetap global).
   Di mode demo, landing bahkan tidak butuh chunk: SSR shell di HTML + hidrasi behaviour dari core. */
const ROUTE_CHUNKS = { '/': 'chunk-landing.js', '/booking': 'chunk-booking.js', '/monitoring': 'chunk-monitoring.js' };
window.__lkChunks = {};
function loadChunk(name, done) {
  if (window.__lkChunks[name]) { done(); return; }
  progressStart(); // WHY (Jakob #8): pemuatan chunk bisa >300ms di jaringan lambat
  const sc = document.createElement('script');
  sc.src = name + '?v=9b'; // WHY: cache-busting - server dev tanpa cache header, browser bisa sajikan versi basi
  sc.onload = () => { window.__lkChunks[name] = true; progressEnd(); done(); };
  sc.onerror = () => { progressEnd(); toast('Gagal memuat modul halaman. Cek koneksi lalu coba lagi.', 'err'); };
  document.head.appendChild(sc);
}
function route() {
  const hash = location.hash || '#/';
  const path = hash.replace(/^#/, '').split('?')[0] || '/';
  state.route = path;
  const view = $('#view');
  const render = routes[path] || renderNotFound;
  const titles = { '/': 'LapanganKu - Booking Lapangan Bulu Tangkis', '/booking': 'Booking - LapanganKu', '/monitoring': 'Monitoring - LapanganKu' };
  // WHY LCP/CLS (trace LH: LCP candidate digantung, img hero re-paint @+2.8s): SSR shell identik dengan
  // output renderLanding demo - re-render mengganti img hero yang sudah termuat dan menggantung kandidat LCP.
  // Cukup pasang behaviour pada shell, DOM tidak disentuh.
  // WHY flag ?ssr-render: tools/build-ssr.mjs merender halaman ini untuk MENGHASILKAN shell baru.
  // Tanpa flag, route() memakai fast-path shell lama -> ekstraksi mengembalikan shell lama itu juga
  // (sirkular: section baru tidak pernah masuk). Dengan flag, chunk-landing.js dirender penuh.
  const ssrRender = location.search.indexOf('ssr-render') !== -1;
  const ssrHero = $('#view .view > section.hero');
  if (path === '/' && state.data && state.data.demo && ssrHero && !ssrRender) {
    bindLandingBehaviours(ssrHero.parentElement);
    renderNav();
    document.title = titles[path] || 'LapanganKu';
    setNavCurrent(path);
    return;
  }
  const chunk = ROUTE_CHUNKS[path];
  if (chunk && !window.__lkChunks[chunk]) { loadChunk(chunk, route); return; } // muat dulu, jalankan ulang route saat siap
  view.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.className = 'view';
  view.appendChild(wrap);
  render(wrap);
  renderNav();
  document.title = titles[path] || 'LapanganKu';
  setNavCurrent(path);
  window.scrollTo(0, 0);
  // WHY: page transition halus - fade+slide 200ms, interruptible, reduced-motion safe
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!reduce) {
    wrap.style.opacity = '0';
    wrap.style.transform = 'translateY(8px)';
    requestAnimationFrame(() => requestAnimationFrame(() => {
      springAnimate({ from: 8, to: 0, damping: 0.8, response: 0.3,
        onUpdate: (y) => { wrap.style.transform = 'translateY(' + y + 'px)'; wrap.style.opacity = String(1 - y / 8); } });
    }));
  }
  // WHY: fokus ke H1 setelah navigasi - screen reader & keyboard user tahu halaman sudah ganti
  const h1 = wrap.querySelector('h1');
  if (h1) { h1.setAttribute('tabindex', '-1'); h1.focus({ preventScroll: true }); }
}
function setNavCurrent(path) {
  $$('#main-nav a').forEach(a => {
    const href = a.getAttribute('href');
    if (href === '#' + path) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  // Update bottom nav
  $$('#bottom-nav a').forEach(a => {
    const href = a.getAttribute('href');
    if (href === '#' + path) a.classList.add('active'); else a.classList.remove('active');
  });
  // Show/hide owner-only nav
  const isOwner = isOwnerUser();
  $$('#bottom-nav a.owner-only').forEach(a => {
    a.style.display = isOwner ? '' : 'none';
  });
}
function bindLandingBehaviours(el) {
  observeReveals(el);
  $$('[data-scroll]', el).forEach(b => b.addEventListener('click', () => {
    const target = $(b.dataset.scroll);
    if (target) target.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
  }));
  bindLegalButtons();
}
// WHY VULN-001: daftar owner TIDAK lagi berasal dari data publik (GViz dihapus).
// Server mengirim `ownerEmails` hanya setelah token Google terverifikasi (handleGetData).
function isOwnerUser() {
  const list = (state.data && state.data.ownerEmails) || [];
  return !!(state.user && list.includes(state.user.email.toLowerCase()));
}
// WHY: AggregateRating hanya boleh ada di JSON-LD bila benar-benar ada ulasan (count > 0) -
// kalau tidak, Google menandainya structured data tidak valid. Jadi disuntik saat runtime
// dari data server, bukan ditulis statis di index.html.
function injectAggregateRating() {
  const ratings = (state.data && state.data.ratings) || {};
  const ids = Object.keys(ratings).filter(k => ratings[k] && ratings[k].count > 0);
  if (!ids.length) return;
  const totalCount = ids.reduce((s, k) => s + ratings[k].count, 0);
  const totalSum = ids.reduce((s, k) => s + ratings[k].avg * ratings[k].count, 0);
  const avg = Math.round(totalSum / totalCount * 10) / 10;
  const el = document.getElementById('ld-venue');
  if (!el) return;
  try {
    const doc = JSON.parse(el.textContent);
    const graph = doc['@graph'] || [];
    const venue = graph.filter(n => n['@type'] === 'SportsActivityLocation')[0];
    if (!venue || venue.aggregateRating) return;
    venue.aggregateRating = { '@type': 'AggregateRating', ratingValue: avg, reviewCount: totalCount, bestRating: 5, worstRating: 1 };
    el.textContent = JSON.stringify(doc);
  } catch (e) { console.warn('injectAggregateRating gagal', e); }
}
function renderNav() {
  const nav = $('#main-nav');
  const isOwner = isOwnerUser();
  let links = '<a href="#/">Beranda</a><a href="#/booking">Booking</a>';
  if (isOwner) links += '<a href="#/monitoring">Monitoring</a>';
  nav.innerHTML = links;
}
function renderNotFound(el) {
  el.innerHTML = '<div class="gate"><p class="kicker" style="margin-bottom:8px">Error 404</p><h1>Halaman tidak ditemukan</h1><p class="muted" style="margin:8px 0 16px">Cek lagi alamatnya ya.</p><a class="btn btn-primary" style="margin-top:8px" href="#/">Ke Beranda</a></div>';
}

function bindLegalButtons() {
  $$('[data-open-privacy]').forEach(b => b.addEventListener('click', openPrivacy));
  $$('[data-open-a11y]').forEach(b => b.addEventListener('click', openA11y));
  $$('[data-open-feedback]').forEach(b => b.addEventListener('click', openFeedbackModal));
  $$('[data-open-terms]').forEach(b => b.addEventListener('click', openTerms));
  $$('[data-open-refund]').forEach(b => b.addEventListener('click', openRefund));
  $$('[data-open-cookies]').forEach(b => b.addEventListener('click', openCookies));
}
function openTerms() {
  Modal.open({
    title: 'Syarat Layanan',
    body: '<p class="t-sm muted"><b>1. Akun.</b> Kamu masuk dengan akun Google. Kamu bertanggung jawab menjaga keamanan akunmu dan atas semua aktivitas yang dilakukan lewat akun itu.</p>' +
      '<p class="t-sm muted" style="margin-top:8px"><b>2. Booking.</b> Booking terkonfirmasi setelah pembayaran (penuh atau DP) berhasil. Satu booking maksimal 3 jam. Slot terkunci untuk kamu begitu pembayaran selesai.</p>' +
      '<p class="t-sm muted" style="margin-top:8px"><b>3. Harga.</b> Harga dihitung sistem kami pada saat booking dan mengikat. Harga dapat berbeda menurut jam (jam sibuk / jam sepi) dan ditampilkan sebelum kamu membayar.</p>' +
      '<p class="t-sm muted" style="margin-top:8px"><b>4. Kewajiban penyewa.</b> Pakai sepatu olahraga bersol karet, jaga kebersihan, dan patuhi aturan venue. Kerusakan fasilitas akibat kelalaian dapat dibebankan ke penyewa.</p>' +
      '<p class="t-sm muted" style="margin-top:8px"><b>5. Pembatalan.</b> Diatur dalam Kebijakan Refund &amp; Pembatalan. Lewat batas waktu, pembayaran tidak dikembalikan.</p>' +
      '<p class="t-sm muted" style="margin-top:8px"><b>6. Perubahan.</b> Kami dapat mengubah syarat ini; versi terbaru selalu tampil di halaman ini.</p>' +
      '<p class="t-xs faint" style="margin-top:12px">Catatan: teks ini contoh untuk keperluan demo. Sebelum dipakai komersial, mintakan peninjauan ahli hukum.</p>'
  });
}
function openRefund() {
  const cfg = state.data && state.data.config ? state.data.config : {};
  const cutoff = cfg.cancel_cutoff_hours || 2;
  Modal.open({
    title: 'Kebijakan Refund & Pembatalan',
    body: '<p class="t-sm muted"><b>Batal gratis.</b> Kamu bisa membatalkan booking tanpa biaya sampai ' + cutoff + ' jam sebelum jam main. Slot langsung dibuka untuk orang lain.</p>' +
      '<p class="t-sm muted" style="margin-top:8px"><b>Lewat batas.</b> Pembatalan setelah ' + cutoff + ' jam sebelum jadwal tidak dapat dilakukan, dan pembayaran tidak dikembalikan.</p>' +
      '<p class="t-sm muted" style="margin-top:8px"><b>Reschedule.</b> Gratis 1 kali, maksimal ' + cutoff + ' jam sebelum jadwal, selama slot tujuan tersedia. Ajukan lewat kontak venue.</p>' +
      '<p class="t-sm muted" style="margin-top:8px"><b>No-show.</b> Booking yang tidak dihadiri dianggap selesai. Tidak ada refund.</p>' +
      '<p class="t-sm muted" style="margin-top:8px"><b>DP 50%.</b> Sisa pembayaran dilunasi tunai di venue saat check-in.</p>' +
      '<p class="t-sm muted" style="margin-top:8px"><b>Pembatalan oleh venue.</b> Bila venue membatalkan (mis. pemeliharaan mendadak), kamu dapat memilih jadwal pengganti atau pengembalian penuh.</p>'
  });
}
function openCookies() {
  Modal.open({
    title: 'Kebijakan Cookie',
    body: '<p class="t-sm muted">LapanganKu memakai penyimpanan lokal browser (localStorage) dan cache service worker - bukan cookie pelacak pihak ketiga.</p>' +
      '<p class="t-sm muted" style="margin-top:8px"><b>Yang kami simpan:</b> sesi login (agar tidak perlu masuk ulang), draft booking, dan preferensi tema.</p>' +
      '<p class="t-sm muted" style="margin-top:8px"><b>Yang TIDAK kami simpan:</b> tidak ada cookie iklan, tidak ada pelacakan lintas situs, tidak ada penjualan data ke pihak ketiga.</p>' +
      '<p class="t-sm muted" style="margin-top:8px"><b>Menghapusnya:</b> bersihkan data situs di pengaturan browser, atau klik Keluar untuk menghapus sesi.</p>'
  });
}
function openPrivacy() {
  Modal.open({
    title: 'Kebijakan Privasi',
    body: '<p class="t-sm muted">LapanganKu mengumpulkan nama, email, dan foto profil dari akun Google kamu saat login, plus data booking (jadwal, lapangan, pembayaran simulasi).</p>' +
      '<p class="t-sm muted" style="margin-top:8px">Data dipakai hanya untuk operasional booking venue: konfirmasi jadwal, check-in, dan rekap internal pemilik venue.</p>' +
      '<p class="t-sm muted" style="margin-top:8px">Data disimpan selama venue beroperasi dan tidak dibagikan ke pihak lain. Kamu berhak minta akses atau hapus data kapan saja lewat kontak venue.</p>' +
      '<p class="t-xs faint" style="margin-top:8px;">Sesuai UU PDP No. 27 Tahun 2022.</p>'
  });
}
function openA11y() {
  Modal.open({
    title: 'Pernyataan Aksesibilitas',
    body: '<p class="t-sm muted">LapanganKu berkomitmen memenuhi WCAG 2.1 level AA: kontras warna memadai, navigasi keyboard penuh, label untuk pembaca layar, dan dukungan preferensi reduced motion.</p>' +
      '<p class="t-sm muted" style="margin-top:8px">Menemukan hambatan akses? Laporkan ke kontak venue, kami perbaiki secepatnya.</p>'
  });
}

/* ---------- reveal on scroll ---------- */
// WHY bukan IntersectionObserver: IO per-frame bisa melewatkan elemen saat scroll cepat (konten stuck invisible).
// Scroll-sweep sinkron + throttle 100ms: deterministik tanpa bergantung produksi frame (rAF/IO bisa skip di tab latar).
let lastSweep = 0;
function sweepReveals(force) {
  const now = performance.now();
  if (!force && now - lastSweep < 100) return; // WHY force: render async (chips/slots) harus langsung ter-sweep walau baru saja sweep
  lastSweep = now;
  const vh = window.innerHeight;
  document.querySelectorAll('.reveal:not(.in), [data-stagger]:not(.in)').forEach(el => {
    const r = el.getBoundingClientRect();
    // WHY hanya cek top: elemen yang terlewat lompatan (anchor/End) ikut di-reveal - mustahil ada konten stuck invisible
    if (r.top < vh + 80) el.classList.add('in');
  });
}
let revealBound = false; // WHY: listener global dipasang sekali, bukan per render
function observeReveals(scope) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) { $$('.reveal, [data-stagger]', scope).forEach(x => x.classList.add('in')); return; }
  sweepReveals(true);
  if (!revealBound) {
    revealBound = true;
    // capture:true menangkap scroll dari container apapun (scroll elemen tidak bubble, tapi lewat fase capture)
    document.addEventListener('scroll', sweepReveals, { passive: true, capture: true });
    window.addEventListener('resize', sweepReveals, { passive: true });
    window.addEventListener('wheel', sweepReveals, { passive: true });
    window.addEventListener('touchmove', sweepReveals, { passive: true });
    // WHY (critique P1): header translusen bikin konten terbaca sebagai ghost-text saat scroll.
    // Jadi solid setelah scroll >8px - pola iOS Safari.
    const hdr = document.querySelector('.hdr');
    if (hdr) {
      const onScrollHdr = () => hdr.classList.toggle('scrolled', window.scrollY > 8);
      window.addEventListener('scroll', onScrollHdr, { passive: true });
      onScrollHdr();
    }
  }
}

/* ---------- apple springs (skill apple-design §4/§5) ---------- */
// WHY vanilla: proyek zero-build; engine spring sendiri = interruptible + velocity-aware, tak mungkin dengan CSS transition.
// Parametrik gaya Apple (damping ratio + response, bukan mass/stiffness/damping). Settle threshold 0.5px/0.5px-per-frame.
function springAnimate(opts) {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const { from, to, velocity = 0, damping = 1, response = 0.3, onUpdate, onEnd } = opts;
  if (reduce || Math.abs(to - from) < 0.5) { if (onUpdate) onUpdate(to); if (onEnd) onEnd(); return () => {}; }
  const c = 2 / Math.max(response, 0.01);
  const k = c * c, dmp = 2 * damping * c;
  let x = from, v = velocity, last = performance.now(), raf = 0, stopped = false;
  function frame(now) {
    if (stopped) return;
    let dt = Math.min((now - last) / 1000, 1 / 30); last = now;
    const steps = Math.max(1, Math.ceil(dt / (1 / 240)));
    const h = dt / steps;
    for (let i = 0; i < steps; i++) { const a = -k * (x - to) - dmp * v; v += a * h; x += v * h; }
    if (Math.abs(x - to) < 0.5 && Math.abs(v) < 40) { if (onUpdate) onUpdate(to); if (onEnd) onEnd(); return; } // WHY: v<40px/s - ekor eksponensial 0.5px/s bikin settle >1.3s; lompatan 0.5px @40px/s tak terlihat
    if (onUpdate) onUpdate(x);
    raf = requestAnimationFrame(frame);
  }
  raf = requestAnimationFrame(frame);
  return () => { stopped = true; if (raf) cancelAnimationFrame(raf); };
}
// WHY §13 (harmony): haptic ringan pada momen commit/snap - hanya diperlukan di saat itu, API aman (diabaikan browser tanpa dukungan)
function haptic(pattern) {
  try { if (navigator.vibrate) navigator.vibrate(pattern || 8); } catch (e) { /* diam saja */ }
}

/* ---------- empty & error state helpers ---------- */
function emptyStateHtml(icon, title, desc, actionLabel, actionId) {
  return '<div class="empty-state">' +
    '<div class="es-icon">' + (icon || ICONS.info) + '</div>' +
    '<div class="es-title">' + esc(title) + '</div>' +
    (desc ? '<div class="es-desc">' + esc(desc) + '</div>' : '') +
    (actionLabel ? '<button class="btn btn-primary es-action" id="' + esc(actionId) + '">' + esc(actionLabel) + '</button>' : '') +
  '</div>';
}
function errorStateHtml(icon, title, desc, actionLabel, actionId) {
  return '<div class="error-state">' +
    '<div class="es-icon">' + (icon || ICONS.alert) + '</div>' +
    '<div class="es-title">' + esc(title) + '</div>' +
    (desc ? '<div class="es-desc">' + esc(desc) + '</div>' : '') +
    (actionLabel ? '<button class="btn btn-ghost es-action" id="' + esc(actionId) + '">' + esc(actionLabel) + '</button>' : '') +
  '</div>';
}

/* ---------- micro-interactions rich (2.x) ---------- */
// WHY ripple: feedback klik universal di semua .btn; layer radial opacity+transform yang menghapus dirinya sendiri (tanpa kebocoran node).
document.addEventListener('click', (e) => {
  const btn = e.target.closest('.btn');
  if (!btn || btn.disabled || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const r = btn.getBoundingClientRect();
  const d = Math.max(r.width, r.height);
  const rip = document.createElement('span');
  rip.className = 'ripple';
  rip.style.width = rip.style.height = d + 'px';
  rip.style.left = (e.clientX - r.left - d / 2) + 'px';
  rip.style.top = (e.clientY - r.top - d / 2) + 'px';
  btn.appendChild(rip);
  rip.addEventListener('animationend', () => rip.remove(), { once: true });
}, true);

/* ---------- apple-design §10: tap = highlight di pointer-down, commit di up, cancel by drag-away ---------- */
document.addEventListener('pointerdown', (e) => {
  const t = e.target.closest('button, .slot, .date-chip, .pay-opt, .radio-pill label');
  if (!t || t.disabled || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  t.dataset.pressed = '1';
  const release = () => { delete t.dataset.pressed; };
  t.addEventListener('pointerup', release, { once: true });
  t.addEventListener('pointerleave', release, { once: true });
  t.addEventListener('pointercancel', release, { once: true });
}, true);

// WHY tile pop: konfirmasi klik pada tile (slot/chip/pill/kpi) via animasi scale singkat; class dilepas sendiri setelah selesai.
const POP_SEL = '.slot, .date-chip, .tab, .radio-pill label, .kpi, .chip, .court-pick, .datebar .dnav';
function popTile(el) {
  el.classList.remove('pop');
  void el.offsetWidth; /* restart animation */
  el.classList.add('pop');
  el.addEventListener('animationend', () => el.classList.remove('pop'), { once: true });
}
document.addEventListener('click', (e) => {
  const t = e.target.closest(POP_SEL);
  if (t && !matchMedia('(prefers-reduced-motion: reduce)').matches) { popTile(t); haptic(5); } // §13: haptic sinkron dengan visual
}, true);

/* ---------- error reporting produksi (P2) ---------- */
// WHY: tanpa layanan eksternal; error tak tertangani dikirim ke Apps Script (tab ErrorLog) supaya owner bisa lihat.
// Debounce + hanya di live mode: demo tidak perlu, dan jangan spam kalau API mati.
let errQueue = 0;
function reportError(context, ex) {
  if (state.data && state.data.demo) return;
  if (errQueue >= 5) return;
  errQueue++;
  try {
    return api('logError', {
      context: String(context).slice(0, 80),
      message: String(ex && ex.message || ex).slice(0, 300),
      stack: String(ex && ex.stack || '').slice(0, 500),
      userAgent: navigator.userAgent,
      screenSize: window.innerWidth + 'x' + window.innerHeight,
      route: location.hash,
      timestamp: new Date().toISOString()
    }).catch(() => {});
  } catch (e) { /* logging tidak boleh melempar */ }
}
window.addEventListener('error', e => reportError('window.onerror: ' + location.hash, e.error || e.message));
window.addEventListener('unhandledrejection', e => reportError('unhandledrejection: ' + location.hash, e.reason));

/* ---------- service worker (P1 offline) ---------- */
function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  if (location.protocol !== 'https:' && location.hostname !== '127.0.0.1' && location.hostname !== 'localhost') return;
  navigator.serviceWorker.register('./sw.js').then(reg => {
    reg.addEventListener('updatefound', () => {
      const newWorker = reg.installing;
      newWorker.addEventListener('statechange', () => {
        if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
          toast('Versi baru tersedia. Refresh untuk update.', 'info', {
            label: 'Refresh',
            onClick: () => window.location.reload()
          });
        }
      });
    });
  }).catch(ex => console.warn('SW registrasi gagal (app tetap jalan normal):', ex.message));
}

/* ---------- offline detection ---------- */
// WHY: PWA harus tahu status koneksi - user dapat feedback saat offline
let offlineToastShown = false;
function updateOnlineStatus() {
  const online = navigator.onLine;
  if (!online && !offlineToastShown) {
    offlineToastShown = true;
    toast('Koneksi terputus. Beberapa fitur mungkin tidak tersedia.', 'err');
  } else if (online && offlineToastShown) {
    offlineToastShown = false;
    toast('Koneksi kembali. Semua fitur tersedia.', 'ok');
  }
}
window.addEventListener('online', updateOnlineStatus);
window.addEventListener('offline', updateOnlineStatus);

/* ---------- keyboard shortcuts ---------- */
// WHY: power user navigation - shortcut cepat tanpa mouse
document.addEventListener('keydown', (e) => {
  // Skip jika sedang mengetik di input
  if (e.target && e.target.matches && e.target.matches('input, select, textarea')) return;
  // Skip jika modifier key (Ctrl/Cmd/Alt)
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  // Skip jika modal terbuka
  if (document.querySelector('.modal-backdrop.open')) return;
  switch (e.key) {
    case 'b':
    case 'B':
      if (state.user) location.hash = '#/booking';
      break;
    case 'm':
    case 'M':
      if (state.user && isOwnerUser()) {
        location.hash = '#/monitoring';
      }
      break;
    case 'h':
    case 'H':
      location.hash = '#/';
      break;
    case '?':
      toast('Shortcut: H = Beranda, B = Booking, M = Monitoring (owner), / = Cari', 'info');
      break;
    case '/':
      if (state.route === '/booking') {
        const searchInput = document.querySelector('#f-q');
        if (searchInput) { searchInput.focus(); e.preventDefault(); }
      }
      break;
  }
});

/* ---------- web vitals monitoring ---------- */
// WHY: monitor Core Web Vitals (LCP, CLS, FID, TTFB, INP) untuk performance tracking
function initWebVitals() {
  // LCP: Largest Contentful Paint
  new PerformanceObserver((list) => {
    const entries = list.getEntries();
    const lastEntry = entries[entries.length - 1];
    if (lastEntry) {
      const lcp = Math.round(lastEntry.startTime);
      console.log(JSON.stringify({ metric: 'LCP', value: lcp, unit: 'ms' }));
      trackEvent('web_vital_LCP', { value: lcp });
    }
  }).observe({ entryTypes: ['largest-contentful-paint'] });

  // CLS: Cumulative Layout Shift
  let clsValue = 0;
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      if (!entry.hadRecentInput) {
        clsValue += entry.value;
      }
    }
    const cls = Math.round(clsValue * 1000) / 1000;
    console.log(JSON.stringify({ metric: 'CLS', value: cls, unit: 'unitless' }));
    trackEvent('web_vital_CLS', { value: cls });
  }).observe({ entryTypes: ['layout-shift'] });

  // FID: First Input Delay
  new PerformanceObserver((list) => {
    const entries = list.getEntries();
    const firstEntry = entries[0];
    if (firstEntry) {
      const fid = Math.round(firstEntry.processingStart - firstEntry.startTime);
      console.log(JSON.stringify({ metric: 'FID', value: fid, unit: 'ms' }));
      trackEvent('web_vital_FID', { value: fid });
    }
  }).observe({ entryTypes: ['first-input'] });

  // TTFB: Time to First Byte
  const navEntry = performance.getEntriesByType('navigation')[0];
  if (navEntry) {
    const ttfb = Math.round(navEntry.responseStart);
    console.log(JSON.stringify({ metric: 'TTFB', value: ttfb, unit: 'ms' }));
    trackEvent('web_vital_TTFB', { value: ttfb });
  }
}


/* ---------- init ---------- */
// WHY dipisah dari init(): keputusan sesi saat boot bisa di-unit-test (tests/session-flow.test.mjs)
function restoreSession() {
  const sess = store.get('lk-session', null);
  if (sessionUsable(sess, Date.now())) {
    state.user = sess.user; state.credential = sess.credential;
    state.intended = sess.intended || null; // tujuan tersimpan tetap dihormati setelah refresh
    return true;
  }
  if (sess && sess.user) {
    // WHY: sesi Google kedaluwarsa - jangan tampilkan user "pura-pura masuk" (semua API live akan menolak
    // credential mati); tujuan awal tetap diingat agar setelah masuk ulang user kembali ke sana.
    store.del('lk-session');
    state.intended = sess.intended || null;
    console.warn('Sesi Google kedaluwarsa. Silakan masuk lagi.');
  }
  return false;
}
let deferredPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  // Show install banner after 3 seconds
  setTimeout(() => {
    if (deferredPrompt) {
      toast('Instal LapanganKu sebagai aplikasi?', 'info', {
        label: 'Instal',
        onClick: async () => {
          deferredPrompt.prompt();
          const { outcome } = await deferredPrompt.userChoice;
          if (outcome === 'accepted') toast('LapanganKu terinstal!', 'ok');
          deferredPrompt = null;
        }
      });
    }
  }, 3000);
});

async function init() {
  initTheme();
  initLang();
  applyWhiteLabel(CONFIG);
  initWebVitals();
  trackEvent('landing_view', { demo: state.data && state.data.demo });
  restoreSession();
  progressStart(); // WHY (Jakob #8): load awal (GViz live) bisa >1 detik - halaman tidak kosong tanpa kabar
  state.data = await loadPublic(); // WHY CLS: di mode demo, index.html SSR sudah mengisi #view sebelum app.js load. Di live, #view kosong selama await - route() di bawah menggantikannya. Tanpa skeleton, konten kemungkinan loncat (harus diuji di live mode dengan jaringan lambat).
  progressEnd();
  $('#demo-banner').innerHTML = state.data.demo
    ? '<div class="demo-banner"><span style="display:inline-flex">' + ICONS.info + '</span><span><b>Mode Demo</b></span></div>'
    : '';
  renderNav();
  injectAggregateRating(); // WHY: setelah data venue+rating termuat, baru aman menyuntik aggregateRating
  route(); // WHY sebelum updateAuthUI: konten halaman dirender dulu dalam frame yang sama, lalu auth chip di header -
  // menyatukan keduanya mencegah 2 reflow terpisah (trace LH: header 52->150px @+2202 mendorong footer = CLS 0.82)
  updateAuthUI();
  window.addEventListener('hashchange', route);
  registerSW();
  console.log('LapanganKu siap. Demo mode:', state.data.demo);
  logStructured('info', 'App initialized', { demo: state.data.demo, user: state.user ? state.user.email : null });
}

// WHY: init() dipanggil di AKHIR file - const/let top-level (i18n, currentLang)
// harus sudah diinisialisasi sebelum initLang() di dalam init() mengaksesnya.
// Memanggil init() lebih awal = ReferenceError TDZ dan seluruh boot mati.

// Multi-language support
const i18n = {
  id: {
    'booking.title': 'Booking',
    'booking.new': 'Booking Baru',
    'booking.my': 'Booking Saya',
    'booking.date': 'Tanggal',
    'booking.time': 'Jam',
    'booking.duration': 'Durasi',
    'booking.court': 'Lapangan',
    'booking.total': 'Total',
    'booking.pay': 'Bayar Sekarang',
    'booking.cancel': 'Batalkan',
    'booking.success': 'Booking Terkonfirmasi',
    'booking.code': 'Kode Booking',
    'common.loading': 'Memuat...',
    'common.error': 'Terjadi kesalahan',
    'common.retry': 'Coba Lagi',
    'common.close': 'Tutup',
    'common.save': 'Simpan',
    'common.delete': 'Hapus',
    'common.search': 'Cari',
    'common.filter': 'Filter',
    'common.sort': 'Urutkan',
    'common.export': 'Export',
    'common.settings': 'Pengaturan',
    'common.help': 'Bantuan',
    'common.logout': 'Keluar',
    'common.login': 'Masuk'
  },
  en: {
    'booking.title': 'Booking',
    'booking.new': 'New Booking',
    'booking.my': 'My Bookings',
    'booking.date': 'Date',
    'booking.time': 'Time',
    'booking.duration': 'Duration',
    'booking.court': 'Court',
    'booking.total': 'Total',
    'booking.pay': 'Pay Now',
    'booking.cancel': 'Cancel',
    'booking.success': 'Booking Confirmed',
    'booking.code': 'Booking Code',
    'common.loading': 'Loading...',
    'common.error': 'An error occurred',
    'common.retry': 'Retry',
    'common.close': 'Close',
    'common.save': 'Save',
    'common.delete': 'Delete',
    'common.search': 'Search',
    'common.filter': 'Filter',
    'common.sort': 'Sort',
    'common.export': 'Export',
    'common.settings': 'Settings',
    'common.help': 'Help',
    'common.logout': 'Logout',
    'common.login': 'Login'
  }
};

let currentLang = 'id';
function t(key) {
  return (i18n[currentLang] && i18n[currentLang][key]) || i18n.id[key] || key;
}
function setLang(lang) {
  if (i18n[lang]) {
    currentLang = lang;
    store.set('lk-lang', lang);
    document.documentElement.lang = lang;
  }
}
function initLang() {
  const saved = store.get('lk-lang', 'id');
  setLang(saved);
}

// White-label support
function applyWhiteLabel(config) {
  if (!config) return;
  const root = document.documentElement;
  if (config.brandColor) root.style.setProperty('--brand', config.brandColor);
  if (config.brandColor2) root.style.setProperty('--brand2', config.brandColor2);
  if (config.bgColor) root.style.setProperty('--bg', config.bgColor);
  if (config.textColor) root.style.setProperty('--text', config.textColor);
  if (config.logo && /^https?:\/\//i.test(config.logo)) {
    const logo = document.querySelector('.logo');
    // WHY: nama + URL logo di-escape & dibatasi http(s) — CONFIG bisa datang dari venue file.
    if (logo) logo.innerHTML = '<img src="' + esc(config.logo) + '" alt="" style="height:26px"> <span>' + esc(config.name || 'LapanganKu') + '</span>';
  }
  if (config.name) document.title = config.name;
}

// Boot aplikasi - HARUS di akhir file setelah semua deklarasi top-level.
init();
