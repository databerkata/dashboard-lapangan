#!/usr/bin/env node
/**
 * tools/build-single.mjs — Perkakas single-file LapanganKu.
 *
 * Model kerja (2026-10-10): index.html di folder ini ADALAH single-file master
 * (hasil build, diedit langsung ala DataBerkata). Tool ini punya 2 mode:
 *
 *   1. Rehash (default):  node tools/build-single.mjs
 *      Hitung ulang SHA-256 tiap blok <script> inline dan suntik ke CSP.
 *      Jalankan setiap habis edit manual index.html — kalau tidak, browser
 *      memblokir seluruh script (hash tidak cocok).
 *
 *   2. Venue stamp:  node tools/build-single.mjs --venue=tools/contoh-venue.json --out=<dir-venue>
 *      Terapkan white-label (nama, warna, logo, URL Apps Script, dsb.) ke
 *      salinan master, rehash, lalu tulis paket venue (index.html + sw.js +
 *      manifest.json + icons) ke --out.
 *
 * Keamanan: CSP tetap tanpa 'unsafe-inline' untuk script; hash hanya mengizinkan
 * blok persis hasil tool ini. venue.name/title ditolak bila mengandung < atau >.
 */
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync, readdirSync, statSync } from 'fs';
import { createHash } from 'crypto';
import { join, dirname, resolve, isAbsolute } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const args = Object.fromEntries(process.argv.slice(2)
  .filter(a => a.startsWith('--'))
  .map(a => { const [k, ...r] = a.slice(2).split('='); return [k, r.join('=') || true]; }));

const sha256 = (s) => createHash('sha256').update(s, 'utf8').digest('base64');
const read = (f) => readFileSync(join(ROOT, f), 'utf8');

let html = read('index.html');

// Guard: master harus single-file (5 blok <script> inline). Kalau masih shell lama
// multi-file, tool versi lama yang berlaku — gagal keras supaya tidak korup.
const scriptBlocks = [...html.matchAll(/<script>\n([\s\S]*?)\n<\/script>/g)].map(m => m[1]);
if (scriptBlocks.length !== 5) {
  throw new Error(`FATAL: butuh 5 blok <script> inline, ketemu ${scriptBlocks.length} — index.html bukan master single-file?`);
}
// Guard: literal </script> di dalam blok akan merusak parsing (cek ulang pasca edit manual)
for (const [i, code] of scriptBlocks.entries()) {
  if (code.includes('</script')) throw new Error(`FATAL: blok script #${i + 1} mengandung literal </script>`);
}

// ---------- 1. Venue stamping (opsional) ----------
let venue = {};
if (args.venue) {
  venue = JSON.parse(readFileSync(join(ROOT, args.venue), 'utf8'));
  for (const k of ['name', 'title']) {
    if (venue[k] && /[<>]/.test(venue[k])) throw new Error(`FATAL: venue.${k} mengandung < atau > — tidak diizinkan`);
  }
}

const assetBase = venue.assetBase ? venue.assetBase.replace(/\/?$/, '/') : '';
if (assetBase) {
  const ab = (s) => s.split('images/').join(assetBase + 'images/');
  html = ab(html);
}

if (venue.name) {
  const vt = venue.title || `${venue.name} - Booking Lapangan Bulu Tangkis`;
  // CONFIG: suntik kredensial + branding (Object.assign setelah deklarasi CONFIG)
  const cfgAssign = {};
  if (venue.appScriptUrl) cfgAssign.APPS_SCRIPT_URL = venue.appScriptUrl;
  if (venue.googleClientId) cfgAssign.GOOGLE_CLIENT_ID = venue.googleClientId;
  for (const k of ['name', 'brandColor', 'brandColor2', 'bgColor', 'textColor', 'logo']) {
    if (venue[k]) cfgAssign[k] = venue[k];
  }
  // Guard: terima placeholder kosong ATAU terisi — master boleh sudah berisi CONFIG live
  // (dulu regex menuntut "" kosong sehingga --venue selalu FATAL pasca CONFIG terisi).
  const cfgRe = /var CONFIG = \{\n  APPS_SCRIPT_URL: "[^"]*",\n  GOOGLE_CLIENT_ID: "[^"]*"\n\};/;
  if (!cfgRe.test(html)) throw new Error('FATAL: blok var CONFIG tidak ketemu — format berubah?');
  html = html.replace(cfgRe, (m) => {
    let out = m;
    if (venue.appScriptUrl) out = out.replace(/APPS_SCRIPT_URL: "[^"]*"/, `APPS_SCRIPT_URL: ${JSON.stringify(venue.appScriptUrl)}`);
    if (venue.googleClientId) out = out.replace(/GOOGLE_CLIENT_ID: "[^"]*"/, `GOOGLE_CLIENT_ID: ${JSON.stringify(venue.googleClientId)}`);
    return out + `\nObject.assign(CONFIG, ${JSON.stringify(cfgAssign)});`;
  });

  // Brand strings user-visible (gagal keras bila pola tak ketemu = cegah bocor brand)
  const brandPairs = [
    ['<p class="kicker">LapanganKu</p>', `<p class="kicker">${venue.name}</p>`],
    ['tata letak gedung LapanganKu.', `tata letak gedung ${venue.name}.`],
    ['alt="Denah gedung LapanganKu"', `alt="Denah gedung ${venue.name}"`],
    ['<a class="logo" href="#/" aria-label="LapanganKu, ke halaman utama">', `<a class="logo" href="#/" aria-label="${venue.name}, ke halaman utama">`],
    ['<span>LapanganKu</span>', `<span>${venue.name}</span>`],
    ['<h3>LapanganKu</h3>', `<h3>${venue.name}</h3>`],
    ['&copy; 2026 LapanganKu', `&copy; 2026 ${venue.name}`],
    ['content="LapanganKu - Booking Lapangan Bulu Tangkis"', `content="${vt}"`],
    [`'/': 'LapanganKu - Booking Lapangan Bulu Tangkis'`, `'/': '${vt}'`],
    [`'Booking - LapanganKu'`, `'Booking - ${venue.name}'`],
    [`'Monitoring - LapanganKu'`, `'Monitoring - ${venue.name}'`],
    [`|| 'LapanganKu'`, `|| '${venue.name}'`],
    [`'Keluar dari LapanganKu?'`, `'Keluar dari ${venue.name}?'`],
    [`pengembangan LapanganKu.`, `pengembangan ${venue.name}.`],
    [`pengalamanmu di LapanganKu.`, `pengalamanmu di ${venue.name}.`],
    [`LapanganKu memakai penyimpanan`, `${venue.name} memakai penyimpanan`],
    [`LapanganKu mengumpulkan`, `${venue.name} mengumpulkan`],
    [`LapanganKu berkomitmen`, `${venue.name} berkomitmen`],
    [`'Instal LapanganKu sebagai aplikasi?'`, `'Instal ${venue.name} sebagai aplikasi?'`],
    [`'LapanganKu terinstal!'`, `'${venue.name} terinstal!'`],
    [`Terima kasih sudah booking di LapanganKu.`, `Terima kasih sudah booking di ${venue.name}.`],
    [`'LOCATION:LapanganKu,`, `'LOCATION:${venue.name},`],
    [`encodeURIComponent('LapanganKu,`, `encodeURIComponent('${venue.name},`],
    [`<meta name="author" content="LapanganKu">`, `<meta name="author" content="${venue.name}">`],
    [`<meta property="og:site_name" content="LapanganKu">`, `<meta property="og:site_name" content="${venue.name}">`],
    [`"name": "LapanganKu"`, `"name": "${venue.name}"`],
    [`'PRODID:-//LapanganKu//Booking//ID'`, `'PRODID:-//${venue.name}//Booking//ID'`],
    [`+ ' LapanganKu'`, `+ ' ${venue.name}'`],
    [`+ ' - LapanganKu'`, `+ ' - ${venue.name}'`],
    [`font-size:20px;font-weight:var(--fw-bold)">LapanganKu</div>`, `font-size:20px;font-weight:var(--fw-bold)">${venue.name}</div>`],
  ];
  for (const [search, repl] of brandPairs) {
    if (!html.includes(search)) throw new Error(`FATAL: pola brand tidak ketemu: ${search.slice(0, 50)} — file sudah di-stamp?`);
    html = html.split(search).join(repl);
  }

  // Canonical & OG URL -> domain venue
  if (venue.canonical) {
    html = html.split('https://databerkata.github.io/prototype-lapanganku').join(venue.canonical.replace(/\/$/, ''));
  }
  if (venue.ogImage) {
    html = html.replace(/(<meta property="og:image" content=")[^"]*(")/, `$1${venue.ogImage}$2`);
  }
  // Title & meta description
  html = html.replace(/<title>[^<]*<\/title>/, `<title>${vt}</title>`);
  if (venue.metaDescription) {
    html = html.replace(/(<meta name="description" content=")[^"]*(")/, `$1${venue.metaDescription}$2`);
  }
  // img-src: izinkan domain assetBase
  if (assetBase) {
    try {
      const origin = new URL(assetBase).origin;
      html = html.replace(/(img-src [^;]*);/, `$1 ${origin};`);
    } catch { /* relatif — 'self' mencakup */ }
  }
}

// ---------- 2. Rehash CSP ----------
// Ekstrak ulang blok script SETELAH stamping (hash = isi persis blok final)
const finalBlocks = [...html.matchAll(/<script>\n([\s\S]*?)\n<\/script>/g)].map(m => m[1]);
if (finalBlocks.length !== 5) throw new Error('FATAL: jumlah blok script berubah setelah stamping');
const hashes = finalBlocks.map(c => `'sha256-${sha256(`\n${c}\n`)}'`);
const cspRe = /(script-src 'self')(?: 'sha256-[A-Za-z0-9+/=]+')*/;
if (!cspRe.test(html)) throw new Error('FATAL: direktif script-src CSP tidak ketemu');
html = html.replace(cspRe, `$1 ${hashes.join(' ')}`);

// ---------- 3. Tulis output ----------
if (args.venue) {
  if (!args.out) throw new Error('FATAL: mode venue butuh --out=<dir-venue>');
  const OUT = isAbsolute(args.out) ? args.out : join(ROOT, args.out);
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, 'index.html'), html);
  // sw.js varian venue (cache name = hash konten)
  let sw = read('sw.js');
  const slug = (venue.slug || 'venue').replace(/[^a-z0-9-]/gi, '-').toLowerCase();
  const chash = sha256(html).slice(0, 12).replace(/[^a-zA-Z0-9]/g, '');
  sw = sw.replace(/var CACHE = '[^']+';/, `var CACHE = 'lapanganku-single-${slug}-${chash}';`);
  writeFileSync(join(OUT, 'sw.js'), sw);
  // manifest.json white-label
  let manifest = read('manifest.json');
  manifest = manifest.replace(/"name":\s*"[^"]*"/, `"name": "${venue.title || venue.name + ' - Booking Lapangan Bulu Tangkis'}"`);
  manifest = manifest.replace(/"short_name":\s*"[^"]*"/, `"short_name": "${venue.name}"`);
  if (venue.metaDescription) manifest = manifest.replace(/"description":\s*"[^"]*"/, `"description": "${venue.metaDescription}"`);
  if (venue.brandColor) manifest = manifest.replace(/"theme_color":\s*"[^"]*"/, `"theme_color": "${venue.brandColor}"`);
  if (assetBase) manifest = manifest.split('images/').join(assetBase + 'images/');
  writeFileSync(join(OUT, 'manifest.json'), manifest);
  for (const f of ['icon.svg', 'icons/favicon.svg', 'icons/favicon-32.png', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png']) {
    const src = join(ROOT, f), dst = join(OUT, f);
    if (existsSync(src)) { mkdirSync(dirname(dst), { recursive: true }); copyFileSync(src, dst); }
  }
  console.log(`VENUE OK: ${args.out}/index.html (${(Buffer.byteLength(html, 'utf8') / 1024).toFixed(1)}KB, ${hashes.length} hash CSP)`);
} else {
  writeFileSync(join(ROOT, 'index.html'), html);
  console.log(`REHASH OK: index.html (${hashes.length} hash CSP diperbarui)`);
}
