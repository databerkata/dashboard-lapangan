/* Menjaga SSR shell di index.html tetap sinkron dengan chunk-landing.js.
   ============================================================================
   WHY file ini ada: shell landing ditanam STATIS di index.html (agar LCP cepat tanpa
   menunggu JS), tapi sumber kebenarannya tetap fungsi JS di chunk-landing.js. Kalau
   salah satu berubah tanpa yang lain, landing demo menampilkan konten BASI - dan itu
   tidak terlihat sebagai error, hanya teks lama.

   Ini bukan risiko teoretis: refactor audit 360 memecah landingSectionsHtml jadi 5
   fungsi + mengubah satu teks (em-dash). Tanpa penjaga, shell bisa tertinggal diam-diam.

   Cara kerja: jalankan fungsi landing yang sesungguhnya di sandbox vm dengan data demo,
   lalu bandingkan TEKS yang dihasilkan dengan teks di dalam blok SSR shell. Browser
   tidak diperlukan - eksekusi JS + perbandingan teks sudah cukup untuk menangkap drift. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readSrc, extract } from './helpers/extract.mjs';

const INDEX = readSrc('lapanganku/index.html');
const LANDING = readSrc('lapanganku/chunk-landing.js');
const APP = readSrc('lapanganku/app.js');

const shell = INDEX.slice(
  INDEX.indexOf('<!-- SSR:START -->') + '<!-- SSR:START -->'.length,
  INDEX.indexOf('<!-- SSR:END -->')
);

// Data demo: disalin dari DEMO_CONFIG/DEMO_COURTS di app.js (nilai yang dipakai mode demo)
const DEMO_CONFIG = {
  jam_buka_mulai: 6, jam_buka_selesai: 22, slot_minutes: 60, max_advance_days: 14,
  cancel_cutoff_hours: 2, booking_lead_hours: 2, max_hours_per_booking: 3, harga_default: 45000,
  peak_hours: '18,19,20', peak_days: '1,2,3,4,5', peak_multiplier: 1.5,
  off_hours: '6,7,8,21', off_days: '1,2,3,4,5', off_multiplier: 0.8
  // WHY (2026-10-22): kunci 'vouchers' dibuang - sistem voucher dihapus total 2026-10-11.
};
const DEMO_COURTS = [1, 2, 3, 4].map((n) => ({
  id: 'LK' + n, nama: 'Lapangan ' + n, olahraga: 'Bulu Tangkis', harga_per_jam: 45000, status: 'aktif'
}));

function renderLanding() {
  const sb = {
    console, Date, Math, JSON, Number, String, Object, Array, isNaN, parseInt,
    ICONS: {
      chev: '<svg></svg>', plus: '<svg></svg>', right: '<svg></svg>', star: '<svg></svg>', quote: '<svg></svg>',
      facCar: '<svg></svg>', facLock: '<svg></svg>', facBag: '<svg></svg>', facUtensils: '<svg></svg>',
      facArmchair: '<svg></svg>', facBulb: '<svg></svg>', facMoonStar: '<svg></svg>', facWifi: '<svg></svg>',
      ruleShield: '<svg></svg>', ruleCancel: '<svg></svg>', ruleResched: '<svg></svg>', rulePay: '<svg></svg>'
    },
    esc: (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
    fmtRp: (n) => 'Rp ' + Number(n || 0).toLocaleString('id-ID'),
    fmtHour: (h) => String(h).padStart(2, '0') + '.00',
    fmtDate: (s) => { const [y, m, d] = s.split('-').map(Number); return ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'][new Date(y, m - 1, d).getDay()] + ', ' + d + ' ' + ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'][m - 1]; },
    state: {
      data: {
        config: DEMO_CONFIG, courts: DEMO_COURTS,
        ratings: { LK1: { avg: 4.8, count: 23 }, LK2: { avg: 4.6, count: 17 }, LK3: { avg: 4.9, count: 31 }, LK4: { avg: 4.5, count: 12 } },
        reviews: [
          { nama: 'Budi S.', venue_id: 'LK3', rating: 5, komentar: 'Lantainya bersih, penerangan merata. Net-nya juga masih prima, enak buat smash.', tanggal: '2026-09-28' },
          { nama: 'Rina W.', venue_id: 'LK1', rating: 5, komentar: 'Booking online gampang, datang tinggal tunjukin kode. Nggak perlu telepon-teleponan lagi.', tanggal: '2026-09-26' },
          { nama: 'Andi P.', venue_id: 'LK2', rating: 4, komentar: 'Parkirnya luas, ada musala juga. Cuma AC-nya agak kurang dingin kalau jam ramai.', tanggal: '2026-09-24' },
          { nama: 'Dewi A.', venue_id: 'LK3', rating: 5, komentar: 'Sewa raket di kantin murah, shuttle-nya juga oke. Recommended buat yang lupa bawa alat.', tanggal: '2026-09-21' }
        ]
      }
    },
    peakCfg: () => ({ hours: [18, 19, 20], days: [1, 2, 3, 4, 5], mult: 1.5 }),
    offCfg: () => ({ hours: [6, 7, 8, 21], days: [1, 2, 3, 4, 5], mult: 0.8 }),
    // WHY (2026-10-11): applyVoucher dihapus - sistem voucher DIHAPUS total.
    ratingFor: (id) => sb.state.data.ratings[id] || null
  };
  const ctx = vm.createContext(sb);
  // WHY dua sumber: sebagian helper dipakai bersama - ratingLine/starHtml ada di app.js (core),
  // sisanya di chunk-landing.js. Ambil dari file yang benar, bukan dari satu file saja.
  const fromLanding = ['landingFaqs', 'landingHeroHtml', 'galleryHtml', 'landingRulesHtml',
    'landingReviewsHtml', 'courtPriceHtml', 'secHargaHtml', 'secFasilitasHtml', 'secCaraHtml',
    'secDenahHtml', 'secFaqHtml', 'landingSectionsHtml', 'cachedPeakCfg', 'landingStripCell', 'courtPriceAria'];
  const fromApp = ['starHtml', 'ratingLine', 'ratingFor'];
  for (const fn of fromLanding) { try { vm.runInContext(extract(LANDING, fn), ctx); } catch (e) { /* opsional */ } }
  for (const fn of fromApp) { try { vm.runInContext(extract(APP, fn), ctx); } catch (e) { /* opsional */ } }
  // WHY deklarasi ini harus ditulis manual: extract() hanya mengambil BADAN fungsi, jadi
  // variabel module-level (var _peakCfgCache = null) tidak ikut terbawa.
  vm.runInContext("var _peakCfgCache = null;", ctx);
  vm.runInContext("var LANDING_FACS = [['facCar','Parkir mobil & motor'],['facLock','Locker & kamar mandi'],['facBag','Rental raket + shuttle'],['facUtensils','Kantin'],['facArmchair','Ruang tunggu'],['facBulb','Penerangan standar'],['facMoonStar','Musala'],['facWifi','Wi-Fi gratis']];", ctx);
  const minPrice = Math.min(...DEMO_COURTS.map((c) => c.harga_per_jam));
  return vm.runInContext(`landingHeroHtml(state.data.config, state.data.courts, ${minPrice}) + landingSectionsHtml(state.data.courts, ${minPrice})`, ctx);
}

const stripTags = (h) => h.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
const renderedText = stripTags(renderLanding());
const shellText = stripTags(shell);

test('SSR: jumlah <section> di shell sama dengan hasil render JS', () => {
  const nShell = (shell.match(/<section/g) || []).length;
  const nJs = (renderLanding().match(/<section/g) || []).length;
  assert.equal(nShell, nJs, `shell punya ${nShell} section, render JS menghasilkan ${nJs}`);
});

test('SSR: setiap heading (h2) di shell ada di hasil render JS', () => {
  const h2 = (s) => [...s.matchAll(/<h2[^>]*>(.*?)<\/h2>/g)].map((m) => m[1].trim());
  const shellH2 = h2(shell);
  const jsH2 = h2(renderLanding());
  assert.ok(shellH2.length >= 7, `hanya ${shellH2.length} h2 di shell - konten mungkin hilang`);
  for (const t of shellH2) {
    assert.ok(jsH2.includes(t), `h2 shell "${t}" tidak ada di hasil render JS (shell basi?)`);
  }
});

test('SSR: teks shell tidak memuat konten basi (semua paragraf ada di render JS)', () => {
  // ambil kalimat panjang (>= 40 char) dari shell, pastikan ada di render JS
  const sentences = shellText.split(/(?<=[.!?])\s+/).filter((s) => s.length >= 40);
  const missing = sentences.filter((s) => !renderedText.includes(s));
  assert.deepEqual(missing, [],
    'teks di shell tidak lagi dihasilkan JS:\n' + missing.slice(0, 3).join('\n'));
});

test('SSR: shell dan render JS memuat teks yang SAMA (perbandingan penuh)', () => {
  assert.equal(shellText, renderedText,
    'teks shell berbeda dari hasil render JS - jalankan: node tools/build-ssr.mjs');
});

test('SSR: tidak ada em-dash di teks landing (shell maupun JS)', () => {
  assert.equal(shellText.includes('—') || shellText.includes('–'), false, 'shell memuat em-dash');
  assert.equal(renderedText.includes('—') || renderedText.includes('–'), false, 'render JS memuat em-dash');
});
