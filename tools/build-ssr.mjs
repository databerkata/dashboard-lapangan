/* Regenerasi SSR shell di index.html dari sumber kebenaran chunk-landing.js.
   ============================================================================
   WHY: shell landing ditanam STATIS di index.html agar LCP cepat tanpa menunggu JS.
   Sumber kebenarannya tetap fungsi landing di chunk-landing.js. Skrip ini menjalankan
   fungsi-fungsi itu di sandbox vm (tanpa browser) lalu menulis ulang isi blok
   <!-- SSR:START --> ... <!-- SSR:END -->.

   Pakai: node tools/build-ssr.mjs
   Penjaga drift: tests/ssr-sync.test.mjs (gagal bila shell != render JS). */
import vm from 'node:vm';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readSrc, extract } from '../tests/helpers/extract.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const INDEX_PATH = join(ROOT, 'lapanganku/index.html');

const INDEX = readSrc('lapanganku/index.html');
const LANDING = readSrc('lapanganku/chunk-landing.js');
const APP = readSrc('lapanganku/app.js');

// Nilai demo - harus sama dengan tests/ssr-sync.test.mjs dan DEMO_CONFIG di app.js
const DEMO_CONFIG = {
  jam_buka_mulai: 6, jam_buka_selesai: 22, slot_minutes: 60, max_advance_days: 14,
  cancel_cutoff_hours: 2, booking_lead_hours: 2, max_hours_per_booking: 3, harga_default: 45000,
  peak_hours: '18,19,20', peak_days: '1,2,3,4,5', peak_multiplier: 1.5,
  off_hours: '6,7,8,21', off_days: '1,2,3,4,5', off_multiplier: 0.8,
  vouchers: 'HEMAT20:20,PAGI10:10'
};
const DEMO_COURTS = [1, 2, 3, 4].map((n) => ({
  id: 'LK' + n, nama: 'Lapangan ' + n, olahraga: 'Bulu Tangkis', harga_per_jam: 45000, status: 'aktif'
}));

// Ikon diambil dari ICONS asli di app.js agar shell memuat SVG yang sama dengan runtime.
const iconBlock = extract(APP, 'ICONS');
const ICONS = vm.runInNewContext('(' + iconBlock.replace(/^const ICONS = /, '').replace(/;\s*$/, '') + ')', {});

const sb = {
  console, Date, Math, JSON, Number, String, Object, Array, isNaN, parseInt,
  ICONS,
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
  applyVoucher: () => null,
  ratingFor: (id) => sb.state.data.ratings[id] || null
};
const ctx = vm.createContext(sb);
const fromLanding = ['landingFaqs', 'landingHeroHtml', 'galleryHtml', 'landingRulesHtml',
  'landingReviewsHtml', 'courtPriceHtml', 'secHargaHtml', 'secFasilitasHtml', 'secCaraHtml',
  'secDenahHtml', 'secFaqHtml', 'landingSectionsHtml', 'cachedPeakCfg', 'landingStripCell', 'courtPriceAria'];
const fromApp = ['starHtml', 'ratingLine', 'ratingFor'];
for (const fn of fromLanding) { try { vm.runInContext(extract(LANDING, fn), ctx); } catch (e) { /* opsional */ } }
for (const fn of fromApp) { try { vm.runInContext(extract(APP, fn), ctx); } catch (e) { /* opsional */ } }
vm.runInContext('var _peakCfgCache = null;', ctx);
vm.runInContext('var LANDING_FACS = ' + extract(LANDING, 'LANDING_FACS').replace(/^const LANDING_FACS = /, '').replace(/;\s*$/, '') + ';', ctx);

const minPrice = Math.min(...DEMO_COURTS.map((c) => c.harga_per_jam));
const html = vm.runInContext(`landingHeroHtml(state.data.config, state.data.courts, ${minPrice}) + landingSectionsHtml(state.data.courts, ${minPrice})`, ctx);

// WHY (P2, fix 2026-10-22): gambar first-paint di-inline sebagai data URI agar shell
// TIDAK pecah saat index.html dibuka sendirian (file:// — mis. file demo yang dikirim
// ke calon venue; itulah janji produk single-file). Sebelumnya shell memakai path
// images/ relatif yang hanya selamat bila folder images/ kebetulan ada di sebelahnya.
// Runtime pasca-hydration tetap memakai path images/ relatif (konteks deploy normal:
// folder images/ ikut tersaji, atau assetBase venue menunjuk ke host aset).
// Biaya jujur: blok SSR membesar sebesar total base64 gambar-gambar ini.
const MIME = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp' };
const inlined = html.replace(/src="images\/([^"]+)"/g, (whole, f) => {
  const p = join(ROOT, 'lapanganku', 'images', f);
  if (!existsSync(p)) return whole;
  const ext = f.slice(f.lastIndexOf('.')).toLowerCase();
  return `src="data:${MIME[ext] || 'application/octet-stream'};base64,${readFileSync(p).toString('base64')}"`;
});

const START = '<!-- SSR:START -->';
const END = '<!-- SSR:END -->';
const i0 = INDEX.indexOf(START);
const i1 = INDEX.indexOf(END);
if (i0 === -1 || i1 === -1) { console.error('Blok SSR tidak ditemukan di index.html'); process.exit(1); }

const next = INDEX.slice(0, i0 + START.length) + inlined + INDEX.slice(i1);
writeFileSync(INDEX_PATH, next);
console.log('SSR shell diperbarui. Panjang:', inlined.length, 'char');
