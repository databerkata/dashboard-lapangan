/* Menjaga app.js tetap sinkron dengan master index.html.
   ============================================================================
   WHY file ini ada: index.html adalah single-file master yang DIKIRIM ke user,
   tapi banyak test mengekstrak fungsi dari app.js. Dulu app.js menyimpang
   diam-diam: 7 fungsi + 4 struktur data basi (termasuk DEMO_CONFIG yang masih
   memuat sistem voucher yang sudah DIHAPUS dari produk 2026-10-11, dan draft
   booking tanpa field split-bill/recurring), plus sisa pull-to-refresh yang
   sudah dihapus dari produk. Test menguji kode basi; bug versi live lolos.

   Aturan: setiap deklarasi top-level di app.js WAJIB ada di index.html dengan
   KODE identik. Komentar boleh beda (dokumentasi bukan perilaku); spasi dan
   komentar dinormalisasi sebelum dibandingkan.

   Ekstraksi memakai jangkar awal-baris: extract() polos mengambil kecocokan
   pertama di file, dan untuk nama generik seperti `t` (fungsi i18n) ia bisa
   menangkap `const t` lokal di dalam fungsi lain yang kebetulan lebih dulu
   muncul - membandingkan dua lokal yang tidak berhubungan. Di sini sumber
   dipotong mulai posisi deklarasi top-level sebelum extract() dipanggil.

   Perbaikan drift: samakan isi di app.js dengan versi index.html
   (index selalu menang). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readSrc, extract } from './helpers/extract.mjs';

const APP = readSrc('lapanganku/app.js');
const INDEX = readSrc('lapanganku/index.html');

const norm = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\/\/[^\n]*/g, '')
  .replace(/\s+/g, ' ')
  .trim();

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

test('app-sync: setiap deklarasi top-level app.js identik dengan index.html', () => {
  const names = anchoredNames(APP);
  assert.ok(names.length > 100, 'app.js harus memuat 100+ deklarasi top-level, ketemu ' + names.length);
  const drift = [];
  for (const n of names) {
    const a = anchoredExtract(APP, n);
    let b = anchoredExtract(INDEX, n);
    if (b === null) {
      // Sebagian helper index tidak di awal baris (mis. $ dan $$) - fallback
      // ke extract polos sebelum menyimpulkan dead code.
      try { b = extract(INDEX, n); } catch { b = null; }
    }
    if (b === null) { drift.push(n + ' (tidak ada di index.html = dead code)'); continue; }
    if (norm(a) !== norm(b)) drift.push(n + ' (isi beda dengan index.html)');
  }
  assert.deepEqual(drift, [], 'drift app.js vs index.html:\n' + drift.join('\n'));
});

test('app-sync: kode yang sudah dihapus dari produk tidak hidup lagi di app.js', () => {
  // Pull-to-refresh dihapus total dari produk (Batch C 2026-10-10) dan helper
  // isEnabled tidak punya pemanggil - keduanya sempat bertahan di app.js.
  for (const ghost of ['function isEnabled', 'pullStartY', 'PULL_THRESHOLD', 'Pull-to-refresh']) {
    assert.ok(!APP.includes(ghost), 'app.js memuat lagi kode mati: ' + ghost);
  }
});
