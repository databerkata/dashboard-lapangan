/* Menjaga chunk-booking.js tetap sinkron dengan master index.html.
   ============================================================================
   WHY file ini ada: index.html adalah single-file master yang DIKIRIM ke user,
   tapi sebagian test mengekstrak fungsi booking dari chunk-booking.js. Dulu chunk
   menyimpang diam-diam (22 fungsi beda + 14 fungsi mati yang tidak pernah dikirim),
   sehingga test menguji kode BASI sementara bug di versi live lolos.

   Aturan yang dijaga di sini: setiap deklarasi top-level di chunk-booking.js
   WAJIB ada di index.html dengan isi identik (spasi dinormalisasi). Fungsi yang
   hanya ada di chunk = dead code, harus dibuang, bukan dipertahankan.

   Perbaikan drift: samakan isi fungsi di chunk dengan versi index.html
   (index selalu menang), atau jalankan sinkronisasi ulang dari index. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readSrc, extract } from './helpers/extract.mjs';

const CHUNK = readSrc('lapanganku/chunk-booking.js');
const INDEX = readSrc('lapanganku/index.html');

const norm = (s) => s.replace(/\s+/g, ' ').trim();

function topLevelNames(src) {
  const re = /^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(|^((?:const|let|var))\s+([A-Za-z_$][\w$]*)\s*=/gm;
  const names = [];
  let m;
  while ((m = re.exec(src))) names.push(m[1] || m[3]);
  return names;
}

test('booking-sync: setiap fungsi chunk-booking identik dengan index.html', () => {
  const names = topLevelNames(CHUNK);
  assert.ok(names.length > 40, 'chunk-booking harus memuat puluhan fungsi, ketemu ' + names.length);
  const drift = [];
  for (const n of names) {
    let idx;
    try { idx = extract(INDEX, n); } catch { drift.push(n + ' (tidak ada di index.html = dead code)'); continue; }
    if (norm(extract(CHUNK, n)) !== norm(idx)) drift.push(n + ' (isi beda dengan index.html)');
  }
  assert.deepEqual(drift, [], 'drift chunk-booking vs index.html:\n' + drift.join('\n'));
});
