/**
 * Unit test BACKEND API untuk Code.gs.
 * 
 * Menguji fungsi-fungsi backend yang belum tercakup di backend-time.test.mjs:
 * - validateBookingRequest (validasi input)
 * - hasBookingClash (deteksi konflik)
 * - allCourtsBooked (cek penuh semua lapangan)
 * - handleCancelBooking (pembatalan + cutoff)
 * - handleOwnerUpdateBooking (CRUD owner)
 * - handleOwnerCreateBooking (walk-in)
 * - handleMonthlyReportNow (laporan bulanan)
 * - buildMonthlyReport (rekap data)
 * - checkRateLimit (rate limiting)
 * - logStructured (structured logging)
 * - safeUrl (sanitasi URL)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { makeGsCtx } from './helpers/apps-script-stub.mjs';
const require = createRequire(import.meta.url);

const HERE = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(path.join(HERE, '..', 'apps-script', 'Code.gs'), 'utf8');

function extractFn(src, name) {
  const re = new RegExp('(?:function\\s+' + name + '\\s*\\(|(?:const|let|var)\\s+' + name + '\\s*=)');
  const m = re.exec(src);
  if (!m) throw new Error('Fungsi "' + name + '" tidak ditemukan');
  const start = m.index;
  let i = m.index + m[0].length;
  let depth = 0, started = false;
  while (i < src.length) {
    const c = src[i];
    if (c === '{') { depth++; started = true; }
    else if (c === '}') { depth--; if (started && depth === 0) return src.slice(start, i + 1); }
    i++;
  }
  throw new Error('Batas fungsi "' + name + '" tidak ditemukan');
}

function setup(fixedMs) {
  const gs = makeGsCtx();
  const sandbox = {
    console,
    Date: class extends Date {
      constructor(...args) { if (args.length === 0) super(fixedMs); else super(...args); }
      static now() { return fixedMs; }
    },
    ...gs
  };
  const ctx = vm.createContext(sandbox);
  
  const fns = ['validateBookingRequest', 'hasBookingClash', 'allCourtsBooked',
    'handleCancelBooking', 'handleOwnerUpdateBooking', 'handleOwnerCreateBooking',
    'handleMonthlyReportNow', 'buildMonthlyReport', 'checkRateLimit', 'logStructured',
    'courtsList', 'activeBookings', 'allBookings', 'readSheet', 'readConfig', 'isOwner',
    'sendBookingEmail', 'waitlistNotifyOnCancel', 'logErrorSafe',
    'unwrap', 'ok', 'err', 'pad', 'randCode', 'hoursOf', 'bookingDetailText', 'fmtTanggalId',
    'bookingTotal', 'peakConfig', 'hourPrice', 'isPeakHour', 'leadTimeOk', 'dynConfig', 'dynDiscountMult', 'dayOccupancyPct',
    'findBookingRow', 'ss', 'isValidRequest', 'getAllowedOrigins', 'handleGetPublicData',
    'recentReviews', 'reviewSummary', 'readReviews', 'maskName', 'reviewableBookings',
    'handleSubmitReview', 'handleMyReviewable', 'addOnsList', 'resolveAddOns', 'offConfig', 'isOffHour',
    'voucherList', 'resolveVoucher', 'tokenCacheKey', 'cancelBookingTx', 'rescheduleBookingTx', 'findOwnedActiveRow', 'hoursUntilStart', 'sanitizeText', 'neutralizeFormula', 'ValidationError', 'checkRateLimit', 'checkAnonRateLimit', 'isValidYmd', 'isValidYm', 'isValidEmail', 'handleSubmitFeedback', 'appendBookingRow', 'syncSheetHeaders', 'ensureSheet', 'priceBreakdown', 'addOnItems', 'handleRescheduleBooking', 'sendWebhook',
    'midtransBase', 'midtransAuthHeader', 'midtransSignature', 'midtransEnabled',
    'handleCreateSnapToken', 'handleMidtransWebhook', 'findBookingByOrderId',
    'handleGetMidtransSettings', 'handleSaveMidtransSettings', 'upsertConfig'];
  for (const fn of fns) {
    try { vm.runInContext(extractFn(src, fn), ctx); } catch(e) { /* fungsi mungkin tidak ada */ }
  }
  
  vm.runInContext(`
    var TZ = 'Asia/Jakarta';
    function ss() { return SpreadsheetApp.getActiveSpreadsheet(); }
    function readConfig() {
      return {
        jam_buka_mulai: 6, jam_buka_selesai: 22, slot_minutes: 60,
        max_advance_days: 14, cancel_cutoff_hours: 2, booking_lead_hours: 2,
        max_hours_per_booking: 3, harga_default: 45000,
        owner_emails: ['owner@lapanganku.id'], google_client_id: '',
        peak_hours: '18,19,20', peak_days: '1,2,3,4,5', peak_multiplier: 1.5
      };
    }
  `, ctx);
  
  return ctx;
}

const NOW = new Date('2026-10-05T10:00:00+07:00').getTime();

// ============================================================
// validateBookingRequest
// ============================================================

test('validateBookingRequest: input valid', () => {
  const ctx = setup(NOW);
  const result = vm.runInContext(`
    validateBookingRequest(
      { venue_id: 'LK1', tanggal: '2026-10-05', jam_mulai: '14', durasi: 2, payment_option: 'full' },
      readConfig(),
      [{ id: 'LK1', nama: 'Lapangan 1', harga_per_jam: 45000, status: 'aktif' }]
    )
  `, ctx);
  assert.equal(result.tanggal, '2026-10-05');
  assert.equal(result.jamMulai, 14);
  assert.equal(result.durasi, 2);
  assert.equal(result.opt, 'full');
});

test('validateBookingRequest: tolak lapangan tidak aktif', () => {
  const ctx = setup(NOW);
  assert.throws(() => {
    vm.runInContext(`
      validateBookingRequest(
        { venue_id: 'LK99', tanggal: '2026-10-05', jam_mulai: '14', durasi: 2, payment_option: 'full' },
        readConfig(),
        [{ id: 'LK1', nama: 'Lapangan 1', harga_per_jam: 45000, status: 'aktif' }]
      )
    `, ctx);
  }, /tidak ditemukan/i);
});

test('validateBookingRequest: tolak tanggal lampau', () => {
  const ctx = setup(NOW);
  assert.throws(() => {
    vm.runInContext(`
      validateBookingRequest(
        { venue_id: 'LK1', tanggal: '2026-09-01', jam_mulai: '14', durasi: 2, payment_option: 'full' },
        readConfig(),
        [{ id: 'LK1', nama: 'Lapangan 1', harga_per_jam: 45000, status: 'aktif' }]
      )
    `, ctx);
  }, /lampau/i);
});

test('validateBookingRequest: tolak durasi melebihi max', () => {
  const ctx = setup(NOW);
  assert.throws(() => {
    vm.runInContext(`
      validateBookingRequest(
        { venue_id: 'LK1', tanggal: '2026-10-05', jam_mulai: '14', durasi: 5, payment_option: 'full' },
        readConfig(),
        [{ id: 'LK1', nama: 'Lapangan 1', harga_per_jam: 45000, status: 'aktif' }]
      )
    `, ctx);
  }, /maksimal/i);
});

test('validateBookingRequest: tolak jam di luar operasional', () => {
  const ctx = setup(NOW);
  assert.throws(() => {
    vm.runInContext(`
      validateBookingRequest(
        { venue_id: 'LK1', tanggal: '2026-10-05', jam_mulai: '23', durasi: 1, payment_option: 'full' },
        readConfig(),
        [{ id: 'LK1', nama: 'Lapangan 1', harga_per_jam: 45000, status: 'aktif' }]
      )
    `, ctx);
  }, /jam operasional/i);
});

// ============================================================
// hasBookingClash
// ============================================================

test('hasBookingClash: deteksi bentrok', () => {
  const ctx = setup(NOW);
  vm.runInContext(`
    SpreadsheetApp.getActiveSpreadsheet = () => ({
      getSheetByName: (name) => {
        if (name === 'Booking') return {
          getDataRange: () => ({ getValues: () => [
            ['booking_id','created_at','email','nama','venue_id','tanggal','jam_mulai','durasi','total_harga','payment_option','payment_status','status'],
            ['LK-001', new Date(), 'a@x.com', 'A', 'LK1', '2026-10-05', '09:00', 2, 90000, 'full', 'paid', 'active']
          ]})
        };
        if (name === 'ErrorLog') return { appendRow: () => {} };
        return null;
      }
    });
  `, ctx);
  const result = vm.runInContext(`
    hasBookingClash('LK1', '2026-10-05', 9, 1)
  `, ctx);
  assert.equal(result, true);
});

test('hasBookingClash: tidak bentrok beda lapangan', () => {
  const ctx = setup(NOW);
  vm.runInContext(`
    SpreadsheetApp.getActiveSpreadsheet = () => ({
      getSheetByName: (name) => {
        if (name === 'Booking') return {
          getDataRange: () => ({ getValues: () => [
            ['booking_id','created_at','email','nama','venue_id','tanggal','jam_mulai','durasi','total_harga','payment_option','payment_status','status'],
            ['LK-001', new Date(), 'a@x.com', 'A', 'LK1', '2026-10-05', '09:00', 2, 90000, 'full', 'paid', 'active']
          ]})
        };
        if (name === 'ErrorLog') return { appendRow: () => {} };
        return null;
      }
    });
  `, ctx);
  const result = vm.runInContext(`
    hasBookingClash('LK2', '2026-10-05', 9, 1)
  `, ctx);
  assert.equal(result, false);
});

// ============================================================
// allCourtsBooked
// ============================================================

test('allCourtsBooked: semua lapangan penuh', () => {
  const ctx = setup(NOW);
  vm.runInContext(`
    SpreadsheetApp.getActiveSpreadsheet = () => ({
      getSheetByName: (name) => {
        if (name === 'Booking') return {
          getDataRange: () => ({ getValues: () => [
            ['booking_id','created_at','email','nama','venue_id','tanggal','jam_mulai','durasi','total_harga','payment_option','payment_status','status'],
            ['LK-001', new Date(), 'a@x.com', 'A', 'LK1', '2026-10-05', '09:00', 1, 45000, 'full', 'paid', 'active'],
            ['LK-002', new Date(), 'b@x.com', 'B', 'LK2', '2026-10-05', '09:00', 1, 45000, 'full', 'paid', 'active']
          ]})
        };
        if (name === 'Lapangan') return {
          getDataRange: () => ({ getValues: () => [
            ['id','nama','olahraga','harga_per_jam','status'],
            ['LK1','Lapangan 1','Bulu Tangkis',45000,'aktif'],
            ['LK2','Lapangan 2','Bulu Tangkis',45000,'aktif']
          ]})
        };
        if (name === 'ErrorLog') return { appendRow: () => {} };
        return null;
      }
    });
  `, ctx);
  const result = vm.runInContext(`
    allCourtsBooked('2026-10-05', 9, 1)
  `, ctx);
  assert.equal(result, true);
});

test('allCourtsBooked: ada lapangan kosong', () => {
  const ctx = setup(NOW);
  vm.runInContext(`
    SpreadsheetApp.getActiveSpreadsheet = () => ({
      getSheetByName: (name) => {
        if (name === 'Booking') return {
          getDataRange: () => ({ getValues: () => [
            ['booking_id','created_at','email','nama','venue_id','tanggal','jam_mulai','durasi','total_harga','payment_option','payment_status','status'],
            ['LK-001', new Date(), 'a@x.com', 'A', 'LK1', '2026-10-05', '09:00', 1, 45000, 'full', 'paid', 'active']
          ]})
        };
        if (name === 'Lapangan') return {
          getDataRange: () => ({ getValues: () => [
            ['id','nama','olahraga','harga_per_jam','status'],
            ['LK1','Lapangan 1','Bulu Tangkis',45000,'aktif'],
            ['LK2','Lapangan 2','Bulu Tangkis',45000,'aktif']
          ]})
        };
        if (name === 'ErrorLog') return { appendRow: () => {} };
        return null;
      }
    });
  `, ctx);
  const result = vm.runInContext(`
    allCourtsBooked('2026-10-05', 9, 1)
  `, ctx);
  assert.equal(result, false);
});

// ============================================================
// handleCancelBooking
// ============================================================

test('handleCancelBooking: sukses batalkan', () => {
  const ctx = setup(NOW);
  vm.runInContext(`
    var _cancelled = false;
    SpreadsheetApp.getActiveSpreadsheet = () => ({
      getSheetByName: (name) => {
        if (name === 'Booking') return {
          getDataRange: () => ({ getValues: () => [
            ['booking_id','created_at','email','nama','venue_id','tanggal','jam_mulai','durasi','total_harga','payment_option','payment_status','status'],
            ['LK-001', new Date(), 'a@x.com', 'A', 'LK1', '2026-10-05', '14:00', 2, 90000, 'full', 'paid', 'active']
          ]}),
          getRange: () => ({ setValue: () => { _cancelled = true; } })
        };
        if (name === 'Lapangan') return {
          getDataRange: () => ({ getValues: () => [
            ['id','nama','olahraga','harga_per_jam','status'],
            ['LK1','Lapangan 1','Bulu Tangkis',45000,'aktif']
          ]})
        };
        if (name === 'ErrorLog') return { appendRow: () => {} };
        return null;
      }
    });
  `, ctx);
  const result = vm.runInContext(`
    handleCancelBooking({ booking_id: 'LK-001' }, { email: 'a@x.com' })
  `, ctx);
  assert.equal(result.booking_id, 'LK-001');
  assert.equal(result.status, 'cancelled');
});

test('handleCancelBooking: tolak booking orang lain', () => {
  const ctx = setup(NOW);
  vm.runInContext(`
    SpreadsheetApp.getActiveSpreadsheet = () => ({
      getSheetByName: (name) => {
        if (name === 'Booking') return {
          getDataRange: () => ({ getValues: () => [
            ['booking_id','created_at','email','nama','venue_id','tanggal','jam_mulai','durasi','total_harga','payment_option','payment_status','status'],
            ['LK-001', new Date(), 'a@x.com', 'A', 'LK1', '2026-10-05', '14:00', 2, 90000, 'full', 'paid', 'active']
          ]})
        };
        if (name === 'ErrorLog') return { appendRow: () => {} };
        return null;
      }
    });
  `, ctx);
  const result = vm.runInContext(`
    handleCancelBooking({ booking_id: 'LK-001' }, { email: 'b@x.com' })
  `, ctx);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'FORBIDDEN');
});

test('handleCancelBooking: tolak cutoff lewat', () => {
  const ctx = setup(NOW);
  vm.runInContext(`
    SpreadsheetApp.getActiveSpreadsheet = () => ({
      getSheetByName: (name) => {
        if (name === 'Booking') return {
          getDataRange: () => ({ getValues: () => [
            ['booking_id','created_at','email','nama','venue_id','tanggal','jam_mulai','durasi','total_harga','payment_option','payment_status','status'],
            ['LK-001', new Date(), 'a@x.com', 'A', 'LK1', '2026-10-05', '11:00', 1, 45000, 'full', 'paid', 'active']
          ]})
        };
        if (name === 'ErrorLog') return { appendRow: () => {} };
        return null;
      }
    });
  `, ctx);
  const result = vm.runInContext(`
    handleCancelBooking({ booking_id: 'LK-001' }, { email: 'a@x.com' })
  `, ctx);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'CUTOFF_PASSED');
});

// ============================================================
// handleOwnerUpdateBooking
// ============================================================

test('handleOwnerUpdateBooking: owner bisa update payment', () => {
  const ctx = setup(NOW);
  vm.runInContext(`
    var _updated = false;
    SpreadsheetApp.getActiveSpreadsheet = () => ({
      getSheetByName: (name) => {
        if (name === 'Booking') return {
          getDataRange: () => ({ getValues: () => [
            ['booking_id','created_at','email','nama','venue_id','tanggal','jam_mulai','durasi','total_harga','payment_option','payment_status','status'],
            ['LK-001', new Date(), 'a@x.com', 'A', 'LK1', '2026-10-05', '14:00', 2, 90000, 'full', 'unpaid', 'active']
          ]}),
          getRange: () => ({ setValue: () => { _updated = true; } })
        };
        if (name === 'ErrorLog') return { appendRow: () => {} };
        return null;
      }
    });
  `, ctx);
  const result = vm.runInContext(`
    handleOwnerUpdateBooking({ booking_id: 'LK-001', payment_status: 'paid' }, { email: 'owner@lapanganku.id' })
  `, ctx);
  assert.equal(result.booking_id, 'LK-001');
  assert.equal(result.payment_status, 'paid');
});

test('handleOwnerUpdateBooking: non-owner ditolak', () => {
  const ctx = setup(NOW);
  const result = vm.runInContext(`
    handleOwnerUpdateBooking({ booking_id: 'LK-001', payment_status: 'paid' }, { email: 'user@x.com' })
  `, ctx);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'FORBIDDEN');
});

// ============================================================
// handleOwnerCreateBooking (walk-in)
// ============================================================

test('handleOwnerCreateBooking: sukses walk-in', () => {
  const ctx = setup(NOW);
  vm.runInContext(`
    var _rows = [];
    SpreadsheetApp.getActiveSpreadsheet = () => ({
      getSheetByName: (name) => {
        if (name === 'Booking') return {
          appendRow: (row) => { _rows.push(row); },
          getDataRange: () => ({ getValues: () => [
            ['booking_id','created_at','email','nama','venue_id','tanggal','jam_mulai','durasi','total_harga','payment_option','payment_status','status']
          ]})
        };
        if (name === 'Lapangan') return {
          getDataRange: () => ({ getValues: () => [
            ['id','nama','olahraga','harga_per_jam','status'],
            ['LK1','Lapangan 1','Bulu Tangkis',45000,'aktif']
          ]})
        };
        if (name === 'ErrorLog') return { appendRow: () => {} };
        return null;
      }
    });
  `, ctx);
  const result = vm.runInContext(`
    handleOwnerCreateBooking(
      { venue_id: 'LK1', tanggal: '2026-10-05', jam_mulai: '14', durasi: 2, payment_option: 'full', payment_status: 'paid', nama: 'Walk-in Tamu' },
      { email: 'owner@lapanganku.id' }
    )
  `, ctx);
  assert.equal(result.payment_status, 'paid');
  assert.equal(result.venue_id, 'LK1');
});

// ============================================================
// buildMonthlyReport
// ============================================================

test('buildMonthlyReport: rekap benar', () => {
  const ctx = setup(NOW);
  vm.runInContext(`
    SpreadsheetApp.getActiveSpreadsheet = () => ({
      getSheetByName: (name) => {
        if (name === 'Booking') return {
          getDataRange: () => ({ getValues: () => [
            ['booking_id','created_at','email','nama','venue_id','tanggal','jam_mulai','durasi','total_harga','payment_option','payment_status','status'],
            ['LK-001', new Date(), 'a@x.com', 'A', 'LK1', '2026-09-15', '10:00', 2, 90000, 'full', 'paid', 'active'],
            ['LK-002', new Date(), 'b@x.com', 'B', 'LK2', '2026-09-20', '14:00', 1, 45000, 'full', 'paid', 'active'],
            ['LK-003', new Date(), 'a@x.com', 'A', 'LK1', '2026-09-25', '18:00', 2, 135000, 'full', 'paid', 'cancelled']
          ]})
        };
        if (name === 'Lapangan') return {
          getDataRange: () => ({ getValues: () => [
            ['id','nama','olahraga','harga_per_jam','status'],
            ['LK1','Lapangan 1','Bulu Tangkis',45000,'aktif'],
            ['LK2','Lapangan 2','Bulu Tangkis',45000,'aktif']
          ]})
        };
        if (name === 'ErrorLog') return { appendRow: () => {} };
        return null;
      }
    });
  `, ctx);
  const result = vm.runInContext(`
    buildMonthlyReport('2026-09')
  `, ctx);
  assert.equal(result.revenue, 135000); // 90000 + 45000 (cancelled tidak dihitung)
  assert.equal(result.count, 2);
  assert.equal(result.cancelled, 1);
  assert.equal(result.hours, 3); // 2 + 1
});

// ============================================================
// checkRateLimit
// ============================================================

test('checkRateLimit: izinkan di bawah batas', () => {
  const ctx = setup(NOW);
  vm.runInContext(`
    var _cache = {};
    CacheService.getScriptCache = () => ({
      get: (k) => _cache[k] || null,
      put: (k, v) => { _cache[k] = v; }
    });
  `, ctx);
  const result = vm.runInContext(`
    checkRateLimit('user@x.com')
  `, ctx);
  assert.equal(result, true);
});

test('checkRateLimit: tolak di atas batas', () => {
  const ctx = setup(NOW);
  vm.runInContext(`
    var _cache = { 'rl:user@x.com': '30', 'rl:user@x.com:w': String(Math.floor(Date.now() / 1000)) };
    CacheService.getScriptCache = () => ({
      get: (k) => _cache[k] || null,
      put: (k, v) => { _cache[k] = v; }
    });
  `, ctx);
  const result = vm.runInContext(`
    checkRateLimit('user@x.com')
  `, ctx);
  assert.equal(result, false);
});

// ============================================================
// logStructured
// ============================================================

test('logStructured: output JSON valid', () => {
  const ctx = setup(NOW);
  const logs = [];
  vm.runInContext(`
    var _logs = [];
    console.log = (msg) => { _logs.push(msg); };
  `, ctx);
  vm.runInContext(`
    logStructured('info', 'Test message', { key: 'value' })
  `, ctx);
  const logOutput = vm.runInContext(`_logs[0]`, ctx);
  const parsed = JSON.parse(logOutput);
  assert.equal(parsed.level, 'info');
  assert.equal(parsed.message, 'Test message');
  assert.equal(parsed.context.key, 'value');
  assert.ok(parsed.ts);
});

// ============================================================
// checkRateLimit (per akun) - termasuk fail-open
// ============================================================

test('checkRateLimit: izinkan di bawah batas', () => {
  const ctx = setup(NOW);
  vm.runInContext(`
    var _cache = {};
    CacheService.getScriptCache = () => ({
      get: (k) => _cache[k] || null,
      put: (k, v) => { _cache[k] = v; }
    });
  `, ctx);
  assert.equal(vm.runInContext(`checkRateLimit('a@b.id')`, ctx), true);
});

test('checkRateLimit: tolak di atas batas', () => {
  const ctx = setup(NOW);
  vm.runInContext(`
    var _cache = { 'rl:a@b.id': '30', 'rl:a@b.id:w': String(Math.floor(Date.now() / 1000)) };
    CacheService.getScriptCache = () => ({
      get: (k) => _cache[k] || null,
      put: (k, v) => { _cache[k] = v; }
    });
  `, ctx);
  assert.equal(vm.runInContext(`checkRateLimit('a@b.id')`, ctx), false);
});

test('checkRateLimit: fail-OPEN saat CacheService error (jangan matikan seluruh app)', () => {
  const ctx = setup(NOW);
  vm.runInContext(`
    CacheService.getScriptCache = () => { throw new Error('cache down'); };
  `, ctx);
  // WHY: rate limiter yang fail-closed akan menolak SEMUA request booking saat cache bermasalah.
  assert.equal(vm.runInContext(`checkRateLimit('a@b.id')`, ctx), true);
});

// ============================================================
// handleGetPublicData (VULN-001: pengganti GViz)
// ============================================================

test('handleGetPublicData: kembalikan courts + config whitelist', () => {
  const ctx = setup(NOW);
  vm.runInContext(`
    readConfig = () => ({ jam_buka_mulai: 6, jam_buka_selesai: 22, slot_minutes: 60,
      max_advance_days: 14, cancel_cutoff_hours: 2, booking_lead_hours: 2,
      max_hours_per_booking: 3, harga_default: 45000,
      owner_emails: ['owner@lapanganku.id'], google_client_id: 'secret-client-id.apps.googleusercontent.com',
      peak_hours: '18,19,20', peak_days: '1,2,3,4,5', peak_multiplier: 1.5 });
    courtsList = () => [{ id: 'LK1', nama: 'Lapangan 1', olahraga: 'Bulu Tangkis', harga_per_jam: 45000, status: 'aktif' }];
  `, ctx);
  const out = vm.runInContext(`handleGetPublicData()`, ctx);
  assert.equal(out.courts.length, 1);
  assert.equal(out.courts[0].id, 'LK1');
  assert.equal(out.config.jam_buka_mulai, 6);
  assert.equal(out.config.peak_multiplier, 1.5);
});

test('handleGetPublicData: TIDAK membocorkan owner_emails / google_client_id', () => {
  const ctx = setup(NOW);
  vm.runInContext(`
    readConfig = () => ({ jam_buka_mulai: 6, jam_buka_selesai: 22,
      owner_emails: ['owner@lapanganku.id'], google_client_id: 'secret-client-id.apps.googleusercontent.com' });
    courtsList = () => [];
  `, ctx);
  const out = vm.runInContext(`handleGetPublicData()`, ctx);
  // WHY VULN-001: endpoint ini pra-login. Daftar owner + client id tidak boleh ikut.
  assert.equal(out.config.owner_emails, undefined);
  assert.equal(out.config.google_client_id, undefined);
  assert.equal(JSON.stringify(out).indexOf('owner@lapanganku.id'), -1);
  assert.equal(JSON.stringify(out).indexOf('secret-client-id'), -1);
});

// ============================================================
// Review & rating (adopsi pola AYO)
// ============================================================

test('maskName: samarkan nama belakang untuk tampilan publik', () => {
  const ctx = setup(NOW);
  const f = (n) => vm.runInContext(`maskName(${JSON.stringify(n)})`, ctx);
  assert.equal(f('Budi Santoso'), 'Budi S.');
  assert.equal(f('Rina'), 'Rina');
  assert.equal(f('Andi Putra Wijaya'), 'Andi P.');
  assert.equal(f(''), 'Penyewa');
  assert.equal(f(null), 'Penyewa');
  // WHY: nama lengkap tidak boleh bocor ke halaman publik (UU PDP)
  assert.ok(!f('Budi Santoso').includes('Santoso'));
});

test('reviewSummary: agregat rata-rata & jumlah per lapangan', () => {
  const ctx = setup(NOW);
  vm.runInContext(`
    readReviews = () => [
      { venue_id:'LK1', rating:5, status:'active' }, { venue_id:'LK1', rating:4, status:'active' },
      { venue_id:'LK2', rating:3, status:'active' }
    ];
  `, ctx);
  const s = vm.runInContext(`reviewSummary()`, ctx);
  assert.equal(s.LK1.count, 2);
  assert.equal(s.LK1.avg, 4.5);
  assert.equal(s.LK2.count, 1);
  assert.equal(s.LK2.avg, 3);
});

test('readReviews: buang rating di luar 1-5 dan status non-active', () => {
  const ctx = setup(NOW);
  vm.runInContext(`
    readSheet = () => [
      { venue_id:'LK1', rating:5, status:'active' },
      { venue_id:'LK1', rating:9, status:'active' },
      { venue_id:'LK1', rating:0, status:'active' },
      { venue_id:'LK1', rating:4, status:'cancelled' }
    ];
  `, ctx);
  assert.equal(vm.runInContext(`readReviews().length`, ctx), 1);
});

test('recentReviews: nama disamarkan & email TIDAK ikut keluar', () => {
  const ctx = setup(NOW);
  vm.runInContext(`
    readReviews = () => [{ email:'budi@gmail.com', nama:'Budi Santoso', venue_id:'LK1', rating:5,
      komentar:'Bagus', created_at:'2026-09-20T10:00:00Z', status:'active' }];
  `, ctx);
  const out = vm.runInContext(`recentReviews(6)`, ctx);
  assert.equal(out.length, 1);
  assert.equal(out[0].nama, 'Budi S.');
  // WHY kritis: email penyewa tidak boleh pernah ikut ke jalur publik (pra-login).
  const json = JSON.stringify(out);
  assert.equal(json.indexOf('budi@gmail.com'), -1);
  assert.equal(json.indexOf('Santoso'), -1);
});

test('handleGetPublicData: ikut sertakan reviews + ratings, tetap tanpa PII', () => {
  const ctx = setup(NOW);
  vm.runInContext(`
    readConfig = () => ({ jam_buka_mulai:6, jam_buka_selesai:22, owner_emails:['o@x.id'], google_client_id:'secret' });
    courtsList = () => [{ id:'LK1', nama:'Lapangan 1', harga_per_jam:45000, status:'aktif' }];
    readReviews = () => [{ email:'budi@gmail.com', nama:'Budi Santoso', venue_id:'LK1', rating:5,
      komentar:'Oke', created_at:'2026-09-20T10:00:00Z', status:'active' }];
  `, ctx);
  const out = vm.runInContext(`handleGetPublicData()`, ctx);
  assert.ok(Array.isArray(out.reviews), 'reviews harus ada');
  assert.ok(out.ratings && out.ratings.LK1, 'ratings harus ada');
  assert.equal(out.ratings.LK1.avg, 5);
  const json = JSON.stringify(out);
  assert.equal(json.indexOf('budi@gmail.com'), -1, 'email bocor!');
  assert.equal(json.indexOf('owner_emails'), -1);
  assert.equal(json.indexOf('secret'), -1);
});

test('handleSubmitReview: tolak rating di luar 1-5', () => {
  const ctx = setup(NOW);
  vm.runInContext(`reviewableBookings = () => [{ booking_id:'B1', venue_id:'LK1' }];`, ctx);
  assert.equal(vm.runInContext(`handleSubmitReview({booking_id:'B1', rating:0}, {email:'a@b.id'}).ok`, ctx), false);
  assert.equal(vm.runInContext(`handleSubmitReview({booking_id:'B1', rating:6}, {email:'a@b.id'}).ok`, ctx), false);
  assert.equal(vm.runInContext(`handleSubmitReview({booking_id:'B1', rating:'abc'}, {email:'a@b.id'}).ok`, ctx), false);
});

test('handleSubmitReview: tolak booking milik orang lain (cegah ulasan palsu)', () => {
  const ctx = setup(NOW);
  // WHY: inti integritas fitur - hanya yang benar-benar main di lapangan itu yang boleh mengulas.
  vm.runInContext(`reviewableBookings = () => [{ booking_id:'B1', venue_id:'LK1' }];`, ctx);
  const out = vm.runInContext(`handleSubmitReview({booking_id:'BUKAN-MILIKKU', rating:5}, {email:'a@b.id'})`, ctx);
  assert.equal(out.ok, false);
  assert.equal(out.error.code, 'FORBIDDEN');
});

test('handleSubmitReview: tolak ulasan ganda untuk booking yang sama', () => {
  const ctx = setup(NOW);
  vm.runInContext(`
    reviewableBookings = () => [{ booking_id:'B1', venue_id:'LK1' }];
    readReviews = () => [{ booking_id:'B1', email:'a@b.id', venue_id:'LK1', rating:5, status:'active' }];
  `, ctx);
  const out = vm.runInContext(`handleSubmitReview({booking_id:'B1', rating:4}, {email:'a@b.id'})`, ctx);
  assert.equal(out.ok, false);
  assert.match(out.error.message, /sudah kamu ulas/i);
});

// ============================================================
// Add-on (produk tambahan)
// ============================================================

test('resolveAddOns: hitung subtotal dari harga KATALOG, bukan harga kiriman client', () => {
  const ctx = setup(NOW);
  vm.runInContext(`
    readSheet = () => [{ id:'RAKET', nama:'Rental raket', harga:15000, satuan:'unit', max_qty:4, status:'aktif' }];
  `, ctx);
  // client mencoba menipu: kirim harga 1 rupiah
  const out = vm.runInContext(`resolveAddOns([{id:'RAKET', qty:2, harga:1}], 10)`, ctx);
  assert.equal(out.items.length, 1);
  assert.equal(out.items[0].harga, 15000, 'harga harus dari katalog, bukan kiriman client');
  assert.equal(out.items[0].subtotal, 30000);
  assert.equal(out.total, 30000);
});

test('resolveAddOns: buang item tak dikenal / nonaktif / qty tidak wajar', () => {
  const ctx = setup(NOW);
  vm.runInContext(`
    readSheet = () => [
      { id:'RAKET', nama:'Rental raket', harga:15000, max_qty:4, status:'aktif' },
      { id:'MATI', nama:'Nonaktif', harga:9000, max_qty:2, status:'nonaktif' }
    ];
  `, ctx);
  const out = vm.runInContext(`resolveAddOns([
    {id:'TIDAK-ADA', qty:1}, {id:'MATI', qty:1}, {id:'RAKET', qty:0},
    {id:'RAKET', qty:'abc'}, {id:'RAKET', qty:-5}, {id:'RAKET', qty:2}
  ], 10)`, ctx);
  assert.equal(out.items.length, 1, 'hanya 1 item valid');
  assert.equal(out.total, 30000);
});

test('resolveAddOns: qty dibatasi max_qty katalog', () => {
  const ctx = setup(NOW);
  vm.runInContext(`
    readSheet = () => [{ id:'RAKET', nama:'Rental raket', harga:15000, max_qty:2, status:'aktif' }];
  `, ctx);
  // client minta 999 -> harus dipangkas ke max_qty
  const out = vm.runInContext(`resolveAddOns([{id:'RAKET', qty:999}], 10)`, ctx);
  assert.equal(out.items[0].qty, 2);
  assert.equal(out.total, 30000);
});

test('resolveAddOns: array kosong / bukan array -> total 0, tidak error', () => {
  const ctx = setup(NOW);
  vm.runInContext(`readSheet = () => [{ id:'RAKET', nama:'R', harga:15000, max_qty:4, status:'aktif' }];`, ctx);
  assert.equal(vm.runInContext(`resolveAddOns([], 10).total`, ctx), 0);
  assert.equal(vm.runInContext(`resolveAddOns(null, 10).total`, ctx), 0);
  assert.equal(vm.runInContext(`resolveAddOns('bukan-array', 10).total`, ctx), 0);
  assert.equal(vm.runInContext(`resolveAddOns(undefined, 10).items.length`, ctx), 0);
});

test('addOnsList: hanya item berstatus aktif', () => {
  const ctx = setup(NOW);
  vm.runInContext(`
    readSheet = () => [
      { id:'A', nama:'Aktif', harga:1000, status:'aktif' },
      { id:'B', nama:'Nonaktif', harga:2000, status:'nonaktif' },
      { id:'', nama:'Tanpa id', harga:3000, status:'aktif' }
    ];
  `, ctx);
  const list = vm.runInContext(`addOnsList()`, ctx);
  assert.equal(list.length, 1);
  assert.equal(list[0].id, 'A');
});

// ============================================================
// isValidRequest (CSRF)
// ============================================================

test('isValidRequest: origin valid', () => {
  const ctx = setup(NOW);
  const result = vm.runInContext(`
    isValidRequest({ parameter: { origin: 'https://lapanganku.web.id' } })
  `, ctx);
  assert.equal(result, true);
});

test('isValidRequest: origin tidak valid', () => {
  const ctx = setup(NOW);
  const result = vm.runInContext(`
    isValidRequest({ parameter: { origin: 'https://evil.com' } })
  `, ctx);
  assert.equal(result, false);
});

test('isValidRequest: referer valid', () => {
  const ctx = setup(NOW);
  const result = vm.runInContext(`
    isValidRequest({ parameter: { referer: 'https://lapanganku.web.id/booking' } })
  `, ctx);
  assert.equal(result, true);
});

test('isValidRequest: parameter kosong', () => {
  const ctx = setup(NOW);
  const result = vm.runInContext(`
    isValidRequest({ parameter: {} })
  `, ctx);
  assert.equal(result, false);
});

// ============================================================
// handleMonthlyReportNow
// ============================================================

test('handleMonthlyReportNow: sukses kirim laporan', () => {
  const ctx = setup(NOW);
  vm.runInContext(`
    var _emailSent = false;
    MailApp.sendEmail = () => { _emailSent = true; };
    readConfig = () => ({ owner_emails: ['owner@lapanganku.id'] });
  `, ctx);
  const result = vm.runInContext(`
    handleMonthlyReportNow({ ym: '2026-09' }, { email: 'owner@lapanganku.id' })
  `, ctx);
  assert.equal(result.sent, true);
  assert.equal(result.ym, '2026-09');
});

test('handleMonthlyReportNow: tolak format bulan invalid', () => {
  const ctx = setup(NOW);
  vm.runInContext(`
    readConfig = () => ({ owner_emails: ['owner@lapanganku.id'] });
  `, ctx);
  const result = vm.runInContext(`
    handleMonthlyReportNow({ ym: 'invalid' }, { email: 'owner@lapanganku.id' })
  `, ctx);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'VALIDATION_ERROR');
});

test('handleMonthlyReportNow: non-owner ditolak', () => {
  const ctx = setup(NOW);
  const result = vm.runInContext(`
    handleMonthlyReportNow({ ym: '2026-09' }, { email: 'user@x.com' })
  `, ctx);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'FORBIDDEN');
});

// ============================================================
// Batch A regression tests (2026-10-10)
// ============================================================

test('neutralizeFormula: netralkan awalan formula', () => {
  const ctx = setup(NOW);
  const r = vm.runInContext(`
    [neutralizeFormula('=HYPERLINK("http://evil","klik")'),
     neutralizeFormula('+6281234'),
     neutralizeFormula('@mention'),
     neutralizeFormula('-5'),
     neutralizeFormula('Budi Santoso'),
     neutralizeFormula('')].join('|')
  `, ctx);
  assert.equal(r, "'=HYPERLINK(\"http://evil\",\"klik\")|'+6281234|'@mention|'-5|Budi Santoso|");
});

test('validateBookingRequest: throw ValidationError (bukan Error biasa)', () => {
  const ctx = setup(NOW);
  const r = vm.runInContext(`
    try {
      validateBookingRequest(
        { venue_id: 'LK99', tanggal: '2026-10-05', jam_mulai: '14', durasi: 2, payment_option: 'full' },
        readConfig(),
        [{ id: 'LK1', nama: 'Lapangan 1', harga_per_jam: 45000, status: 'aktif' }]
      );
      'NO_THROW';
    } catch (e) { (e.isValidationError === true) + '|' + e.message; }
  `, ctx);
  assert.match(r, /^true\|/);
  assert.match(r, /tidak ditemukan/i);
});

test('handleRescheduleBooking: tolak format tanggal sampah', () => {
  const ctx = setup(NOW);
  const result = vm.runInContext(`
    handleRescheduleBooking({ booking_id: 'LK-001', new_date: 'xx', new_hour: '14' }, { email: 'a@x.com' })
  `, ctx);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'VALIDATION_ERROR');
});

test('handleRescheduleBooking: tolak format jam sampah', () => {
  const ctx = setup(NOW);
  const result = vm.runInContext(`
    handleRescheduleBooking({ booking_id: 'LK-001', new_date: '2026-10-06', new_hour: 'xx' }, { email: 'a@x.com' })
  `, ctx);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'VALIDATION_ERROR');
});

test('checkAnonRateLimit: izinkan di bawah batas, tolak di atas', () => {
  const ctx = setup(NOW);
  vm.runInContext(`
    var __mem = {};
    CacheService.getScriptCache = () => ({
      get: (k) => (__mem[k] !== undefined ? __mem[k] : null),
      put: (k, v) => { __mem[k] = String(v); }
    });
  `, ctx);
  const r = vm.runInContext(`
    var ok1 = checkAnonRateLimit();
    for (var i = 0; i < 120; i++) checkAnonRateLimit();
    var ok2 = checkAnonRateLimit();
    ok1 + '|' + ok2
  `, ctx);
  assert.equal(r, 'true|false');
});

// ============================================================
// Midtrans regression tests (2026-10-10)
// ============================================================
test('midtransEnabled: false tanpa key, true dengan key', () => {
  const ctx = setup(NOW);
  const r = vm.runInContext(`
    [midtransEnabled({midtrans_server_key:'',midtrans_client_key:''}),
     midtransEnabled({midtrans_server_key:'SB-Mid-server-x',midtrans_client_key:'SB-Mid-client-y'})].join('|')
  `, ctx);
  assert.equal(r, 'false|true');
});

test('midtransSignature: SHA512 sesuai spesifikasi Midtrans', () => {
  const ctx = setup(NOW);
  ctx.Buffer = Buffer; // VM tidak punya Buffer bawaan
  // inject computeDigest ala Apps Script; expected dihitung pakai node:crypto di luar VM
  const { createHash } = require('node:crypto');
  ctx.__sha512 = (s) => createHash('sha512').update(s, 'utf8').digest('hex');
  vm.runInContext(`
    Utilities.computeDigest = function (algo, str, charset) {
      return Array.from(Buffer.from(__sha512(str), 'hex'));
    };
    Utilities.DigestAlgorithm = { SHA_512: 'SHA_512' };
    Utilities.Charset = { UTF_8: 'UTF_8' };
  `, ctx);
  const sig = vm.runInContext(`midtransSignature('ORDER-1', '200', '10000', 'MyServerKey')`, ctx);
  assert.equal(sig, ctx.__sha512('ORDER-120010000MyServerKey'));
});

test('handleCreateSnapToken: tolak saat key belum dikonfigurasi', () => {
  const ctx = setup(NOW);
  const result = vm.runInContext(`
    handleCreateSnapToken({ booking_id: 'LK-001' }, { email: 'a@x.com', name: 'A' })
  `, ctx);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'PAYMENT_UNAVAILABLE');
});

test('handleMidtransWebhook: tolak signature palsu', () => {
  const ctx = setup(NOW);
  vm.runInContext(`readConfig = () => ({ owner_emails: ['owner@lapanganku.id'],
    midtrans_server_key: 'SB-Mid-server-test', midtrans_client_key: 'SB-Mid-client-test', midtrans_sandbox: 1 });`, ctx);
  const result = vm.runInContext(`
    handleMidtransWebhook({ order_id: 'LK-001-MABC', status_code: '200',
      gross_amount: '45000', transaction_status: 'settlement', signature_key: 'palsu' })
  `, ctx);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'FORBIDDEN');
});

test('handleMidtransWebhook: abaikan notifikasi tanpa signature', () => {
  const ctx = setup(NOW);
  const result = vm.runInContext(`
    handleMidtransWebhook({ order_id: 'LK-001-MABC', transaction_status: 'settlement' })
  `, ctx);
  assert.equal(result.ignored, true);
});

test('handleSaveMidtransSettings: tolak format key ngawur', () => {
  const ctx = setup(NOW);
  vm.runInContext(`readConfig = () => ({ owner_emails: ['owner@lapanganku.id'] });`, ctx);
  const result = vm.runInContext(`
    handleSaveMidtransSettings({ sandbox: 1, client_key: 'ngawur', server_key: '' }, { email: 'owner@lapanganku.id' })
  `, ctx);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'VALIDATION_ERROR');
});

test('handleSaveMidtransSettings: non-owner ditolak', () => {
  const ctx = setup(NOW);
  vm.runInContext(`readConfig = () => ({ owner_emails: ['owner@lapanganku.id'] });`, ctx);
  const result = vm.runInContext(`
    handleSaveMidtransSettings({ sandbox: 1, client_key: 'SB-Mid-client-x', server_key: 'SB-Mid-server-y' }, { email: 'user@x.com' })
  `, ctx);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'FORBIDDEN');
});

test('findBookingByOrderId: cocokkan order_id lama dari histori', () => {
  const ctx = setup(NOW);
  // mock sheet dengan 1 booking berisi 2 order_id histori
  vm.runInContext(`
    var __vals = [
      ['booking_id','payment_status','status','payment_option','midtrans_order_id'],
      ['LK-001','unpaid','active','full','LK-001-MABC,LK-001-MDEF']
    ];
    ss = function () { return { getSheetByName: function () { return {
      getDataRange: function () { return { getValues: function () { return __vals; } }; }
    }; } }; };
  `, ctx);
  const r = vm.runInContext(`
    [findBookingByOrderId('LK-001-MABC') ? 'ketemu' : 'hilang',
     findBookingByOrderId('LK-001-MDEF') ? 'ketemu' : 'hilang',
     findBookingByOrderId('LK-001-MXXX') ? 'ketemu' : 'hilang'].join('|')
  `, ctx);
  assert.equal(r, 'ketemu|ketemu|hilang');
});
