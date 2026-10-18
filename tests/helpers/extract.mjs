/* Harness unit test LapanganKu - tanpa dependensi (Rule 1.11 zero build).
   Prinsip: fungsi yang dites adalah KODE PRODUKSI VERBATIM, diekstrak dari
   app.js / chunk-*.js / Code.gs via brace matching, lalu dijalankan di sandbox
   vm dengan stub minimal (localStorage, document). Bukan salinan manual. */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..'); // tests/helpers -> repo root

export function readSrc(rel) {
  return readFileSync(path.join(ROOT, rel), 'utf8');
}

/* Ambil satu deklarasi lengkap dari source: `function name(...) { ... }` atau
   `const/let/var name = ...;`. String-aware + lompati komentar WHY.
   - function: lompati daftar parameter, lalu brace-match BADAN fungsi.
   - const: depth counter dengan floor 0, terminasi di ';' pada depth 0
     (aman utk arrow expression, objek multiline, dan arrow dengan body {}). */
export function extract(src, name) {
  // WHY escape: nama bisa berisi karakter khusus regex ($ pada helper $/$$)
  const nm = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // WHY `async function` didukung: withRetry dideklarasikan sebagai `async function`.
  // Tanpa alternasi ini, extract() melempar "Deklarasi tidak ditemukan" untuk fungsi async.
  const re = new RegExp('(?:(?:async\\s+)?function\\s+' + nm + '\\s*\\(|(?:const|let|var)\\s+' + nm + '\\s*=)');
  const m = re.exec(src);
  if (!m) throw new Error('Deklarasi "' + name + '" tidak ditemukan');
  // WHY /function\s/ bukan startsWith('function') (audit 360): untuk `async function foo()`,
  // m[0] dimulai dengan "async" sehingga startsWith('function') bernilai false dan fungsi async
  // masuk ke cabang const/var - pencarian ';' di depth 0 bisa melewati batas fungsi dan
  // mengembalikan potongan kode yang SALAH (test tetap "hijau" tapi menguji hal lain).
  const isFnDecl = /function\s/.test(m[0]);
  const start = m.index;
  let i = m.index + m[0].length;
  const skipString = (j) => { // j posisi quote pembuka; kembalikan posisi SETELAH kutip penutup
    const q = src[j]; j++;
    while (j < src.length && src[j] !== q) { if (src[j] === '\\') j++; j++; }
    return j + 1;
  };
  const skipLine = (j) => { while (j < src.length && src[j] !== '\n') j++; return j; };
  const skipBlock = (j) => { j += 2; while (j < src.length && !(src[j] === '*' && src[j + 1] === '/')) j++; return j + 2; };
  // Regex literal (mis. replace(/"/g, ...)) berisi kutip: deteksi via heuristik token sebelumnya
  const isRegexStart = (j) => {
    let k = j - 1;
    while (k >= 0 && /\s/.test(src[k])) k--;
    if (k < 0) return true;
    return '([{,;=:!&|?+-*%^<>~'.includes(src[k]);
  };
  const skipRegex = (j) => { // j di '/' pembuka; kembalikan posisi setelah '/' penutup
    let k = j + 1, inCls = false;
    while (k < src.length) {
      const c = src[k];
      if (c === '\\') { k += 2; continue; }
      if (c === '\n') return j + 1; // bukan regex multiline - perlakukan sebagai pembagian
      if (inCls) { if (c === ']') inCls = false; }
      else if (c === '[') inCls = true;
      else if (c === '/') return k + 1;
      k++;
    }
    return j + 1;
  };
  const step = (j) => { // konsumsi satu token non-identifier; kembalikan posisi berikutnya
    const c = src[j], n = src[j + 1];
    if (c === '"' || c === "'" || c === '`') return skipString(j);
    if (c === '/' && n === '/') return skipLine(j);
    if (c === '/' && n === '*') return skipBlock(j);
    if (c === '/' && isRegexStart(j)) return skipRegex(j);
    return j + 1;
  };
  if (isFnDecl) {
    while (i < src.length && src[i] !== '{') i = step(i);
    if (i >= src.length) throw new Error('Body "' + name + '" tidak ketemu');
    let depth = 0, end = -1;
    while (i < src.length) {
      const c = src[i];
      if (c === '{') { depth++; i++; continue; }
      if (c === '}') { depth--; if (depth === 0) { end = i + 1; break; } i++; continue; }
      const ni = step(i);
      if (ni === i) break; // safety
      i = ni;
    }
    if (end < 0) throw new Error('Batas body "' + name + '" tidak ketemu');
    return src.slice(start, end);
  }
  let depth = 0, end = -1;
  while (i < src.length) {
    const c = src[i];
    if (c === '{' || c === '(' || c === '[') depth++;
    else if (c === '}' || c === ')' || c === ']') depth = Math.max(0, depth - 1);
    else if (c === ';' && depth === 0) { end = i + 1; break; }
    const ni = step(i);
    if (ni === i) break; // safety
    i = ni;
  }
  if (end < 0) throw new Error('Batas deklarasi "' + name + '" tidak ketemu');
  return src.slice(start, end);
}

export function extractAll(src, names) {
  return names.map(n => extract(src, n)).join('\n');
}

// Fungsi-fungsi yang perlu diekstrak untuk test backend
export const BACKEND_FNS = [
  'validateBookingRequest', 'hasBookingClash', 'allCourtsBooked',
  'handleCancelBooking', 'handleOwnerUpdateBooking', 'handleOwnerCreateBooking',
  'handleMonthlyReportNow', 'buildMonthlyReport', 'checkRateLimit',
  'logStructured', 'isValidRequest', 'getAllowedOrigins', 'appUrl', 'sanitizeString',
  'courtsList', 'activeBookings', 'readSheet', 'readConfig', 'isOwner',
  'sendBookingEmail', 'waitlistNotifyOnCancel', 'logErrorSafe',
  'unwrap', 'ok', 'err', 'pad', 'randCode', 'hoursOf', 'bookingDetailText', 'fmtTanggalId',
  'bookingTotal', 'peakConfig', 'hourPrice', 'isPeakHour', 'leadTimeOk',
  'findBookingRow', 'ss', 'findOwnedActiveRow', 'hoursUntilStart', 'allBookings', 'voucherList', 'resolveVoucher', 'tokenCacheKey', 'cancelBookingTx', 'rescheduleBookingTx'
];

/* Sandbox vm: stub localStorage (Map) + document no-op + (opsional) Date semu
   dengan instant tetap - slot/lead/cancel jadi deterministik di zona waktu mana pun. */
export function makeCtx(fixedMs) {
  const map = new Map();
  const storage = {
    getItem: (k) => map.has(k) ? map.get(k) : null,
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k)
  };
  const sandbox = {
    console,
    localStorage: storage,
    atob: (s) => Buffer.from(s, 'base64').toString('binary'), // utk decodeJwt (bukan intrinsik ECMAScript)
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    requestAnimationFrame: (cb) => setTimeout(cb, 0),
    cancelAnimationFrame: (id) => clearTimeout(id),
    performance: { now: (() => { let t = 0; return () => (t += 16); })() },
    confirm: () => true,
    crypto: { getRandomValues: (arr) => { for (let i = 0; i < arr.length; i++) arr[i] = Math.floor(Math.random() * 256); return arr; } },
    document: { querySelector: () => null, querySelectorAll: () => [], addEventListener() {}, createElement: () => ({ style: {}, setAttribute() {}, addEventListener() {}, click() {} }) },
    Modal: { open: () => ({ panel: null, close: () => {}, lock: () => {} }), close: () => {} },
    $: () => null,
    $$: () => [],
    setTimeout, clearTimeout,
    URL, URLSearchParams
  };
  if (fixedMs != null) {
    class FakeDate extends Date {
      constructor(...args) { if (args.length === 0) super(fixedMs); else super(...args); }
      static now() { return fixedMs; }
    }
    sandbox.Date = FakeDate;
  }
  const ctx = vm.createContext(sandbox);
  return { ctx, storage };
}

export function define(ctx, code) {
  vm.runInContext(code, ctx);
}

export function get(ctx, name) {
  return vm.runInContext(name, ctx);
}
