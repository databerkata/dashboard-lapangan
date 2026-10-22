/* Menjaga chunk-landing.js tetap sinkron dengan master index.html.
   ============================================================================
   WHY file ini ada: shell SSR dibangun DARI chunk-landing.js, sementara user
   menjalankan salinan fungsi yang sama di index.html. Dulu chunk memuat 10
   fungsi mati yang tidak ada di produk (updateMetaDescription, printPage,
   copyLink, dst - nol pemanggil di seluruh codebase) dan tidak ada penjaga
   yang menangkap drift teks di fungsi landing.

   Aturan: setiap deklarasi top-level di chunk-landing.js WAJIB ada di
   index.html. Semua identik secara kode (komentar/spasi dinormalisasi),
   KECUALI tiga fungsi di ARTIFACT_FORM: di chunk mereka sumber responsif
   (<picture> + srcset + path images/ relatif) yang di-inline build-ssr saat
   membangun shell; di index mereka artefak terkirim (img tunggal data URI,
   supaya file tetap utuh setelah hydration saat dibuka sendirian). Untuk
   ketiganya yang dijaga adalah TEKS tampilnya - teks beda = drift copy,
   kelas bug yang pernah lolos (em-dash di flowchart, 2026-10-11).

   Perbaikan drift: samakan chunk dengan index.html (index selalu menang);
   untuk ARTIFACT_FORM samakan teksnya, jangan samakan bentuk markupnya. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readSrc, extract } from './helpers/extract.mjs';

const CHUNK = readSrc('lapanganku/chunk-landing.js');
const INDEX = readSrc('lapanganku/index.html');

const ARTIFACT_FORM = ['landingHeroHtml', 'galleryHtml', 'secDenahHtml'];
const DEAD = ['updateMetaDescription', 'updateOGImage', 'injectJSONLD', 'createBreadcrumb',
  'createRelatedContent', 'createSocialShare', 'printPage', 'exportToPDF', 'shareViaEmail', 'copyLink'];

const norm = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\/\/[^\n]*/g, '')
  .replace(/\s+/g, ' ')
  .trim();
const stripTags = (h) => h.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

function anchoredNames(src) {
  const re = /^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(|^(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/gm;
  const out = [];
  let m;
  while ((m = re.exec(src))) out.push(m[1] || m[2]);
  return [...new Set(out)];
}
function anchoredExtract(src, name) {
  const nm = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp('^(?:async\\s+)?function\\s+' + nm + '\\s*\\(|^(?:const|let|var)\\s+' + nm + '\\s*=', 'gm');
  const m = re.exec(src);
  if (!m) return null;
  return extract(src.slice(m.index), name);
}
function fromIndex(name) {
  const a = anchoredExtract(INDEX, name);
  if (a !== null) return a;
  try { return extract(INDEX, name); } catch { return null; }
}

test('landing-sync: fungsi chunk-landing identik dengan index.html (kecuali bentuk artefak)', () => {
  const names = anchoredNames(CHUNK);
  assert.ok(names.length >= 15, 'chunk-landing harus memuat 15+ deklarasi, ketemu ' + names.length);
  const drift = [];
  for (const n of names) {
    const idx = fromIndex(n);
    if (idx === null) { drift.push(n + ' (tidak ada di index.html = dead code)'); continue; }
    if (ARTIFACT_FORM.includes(n)) continue;
    if (norm(anchoredExtract(CHUNK, n)) !== norm(idx)) drift.push(n + ' (isi beda dengan index.html)');
  }
  assert.deepEqual(drift, [], 'drift chunk-landing vs index.html:\n' + drift.join('\n'));
});

test('landing-sync: tiga fungsi bentuk-artefak teks rendernya sama, bentuknya sesuai kontrak', () => {
  // WHY render, bukan banding sumber: stripTags di atas KODE sumber menghitung
  // fragmen string markup sebagai teks (picture+source+img = 3 fragmen vs img
  // tunggal = 1) sehingga perbandingan sumber selalu beda walau tampilannya
  // sama. Yang dijaga adalah teks HASIL RENDER - yang dibaca user & crawler.
  function renderSide(src) {
    const ctx = vm.createContext({
      console, Math, JSON,
      ICONS: { chev: '<svg></svg>' },
      fmtRp: (n) => 'Rp ' + Number(n || 0).toLocaleString('id-ID')
    });
    for (const fn of ['landingStripCell', 'landingHeroHtml', 'galleryHtml', 'secDenahHtml']) {
      vm.runInContext(extract(src, fn), ctx);
    }
    return vm.runInContext(
      "landingHeroHtml({}, [{},{},{},{}], 45000) + galleryHtml() + secDenahHtml()", ctx);
  }
  for (const n of ARTIFACT_FORM) {
    const c = anchoredExtract(CHUNK, n);
    const i = fromIndex(n);
    assert.ok(c && i, n + ' harus ada di chunk dan index');
    assert.ok(c.includes('images/'), n + ' di chunk harus berbentuk sumber (path images/ relatif)');
    assert.ok(i.includes('data:image'), n + ' di index harus berbentuk artefak (data URI)');
  }
  assert.equal(stripTags(renderSide(INDEX)), stripTags(renderSide(CHUNK)),
    'teks render landing chunk berbeda dari index (drift copy)');
});

test('landing-sync: fungsi mati yang dibuang tidak hidup lagi di chunk-landing', () => {
  for (const ghost of DEAD) {
    assert.ok(!CHUNK.includes(ghost), 'chunk-landing memuat lagi fungsi mati: ' + ghost);
  }
});
