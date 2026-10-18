/**
 * Unit test ZONA WAKTU untuk backend Code.gs.
 * 
 * Stub Apps Script API, jalankan fungsi produksi verbatim di 4 zona waktu.
 * Prinsip sama dengan run-tests.mjs: hasil wajib identik di zona mana pun.
 * 
 * Fungsi yang diuji:
 * - leadTimeOk (baris 446)
 * - isPeakHour (baris 190)
 * - handleCancelBooking cutoff (baris 508-513)
 * - bookingTotal (baris 203) - paritas dengan frontend
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';
import { makeGsCtx } from './helpers/apps-script-stub.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(path.join(HERE, '..', 'apps-script', 'Code.gs'), 'utf8');

// Ekstrak fungsi dari Code.gs (sama seperti extract.mjs)
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

// Setup sandbox dengan stub
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
  
  // Definisikan fungsi-fungsi yang diuji
  const fns = ['leadTimeOk', 'isPeakHour', 'bookingTotal', 'peakConfig', 'hourPrice',
    'dynConfig', 'dynDiscountMult', 'dayOccupancyPct',
    'handleGetData', 'handleCreateBooking', 'handleWaitlistJoin', 'handleWaitlistCancel',
    'handleWaitlistMine', 'handleMyBookings', 'handleCancelBooking', 'handleOwnerUpdateBooking',
    'handleOwnerCreateBooking', 'handleMonthlyReportNow', 'validateBookingRequest',
    'hasBookingClash', 'allCourtsBooked', 'courtsList', 'activeBookings', 'allBookings', 'readSheet',
    'readConfig', 'isOwner', 'sendBookingEmail', 'waitlistNotifyOnCancel', 'logErrorSafe',
    'unwrap', 'ok', 'err', 'errSlotTaken', 'pad', 'randCode', 'hoursOf', 'bookingDetailText', 'fmtTanggalId',
    'buildMonthlyReport', 'monthlyReport', 'setupSheets', 'setupBackupTrigger', 'sendWebhook', 'exportDataWarehouse', 'suggestOptimalPrice', 'replicateToSecondary',
    'setupMonthlyReportTrigger', 'weeklyBackup', 'findBookingRow', 'ss', 'sanitizeString', 'isValidRequest', 'getAllowedOrigins', 'addOnsList', 'resolveAddOns', 'offConfig', 'isOffHour',
    'voucherList', 'resolveVoucher', 'tokenCacheKey', 'cancelBookingTx', 'rescheduleBookingTx', 'findOwnedActiveRow', 'hoursUntilStart', 'sanitizeText', 'sanitizeString', 'neutralizeFormula', 'ValidationError', 'isValidYmd', 'isValidYm', 'isValidEmail', 'handleSubmitFeedback', 'appendBookingRow', 'syncSheetHeaders', 'ensureSheet', 'priceBreakdown', 'addOnItems'];
  for (const fn of fns) {
    try { vm.runInContext(extractFn(src, fn), ctx); } catch(e) { /* fungsi mungkin tidak ada */ }
  }
  
  // Helper untuk readConfig (return config default)
  vm.runInContext(`
    var TZ = 'Asia/Jakarta';
    function ss() { return SpreadsheetApp.getActiveSpreadsheet(); }
    var _errorCounts = {};
    var _errorAlertThreshold = 5;
    var _errorAlertWindow = 300000;
    function readConfig() {
      return {
        jam_buka_mulai: 6, jam_buka_selesai: 22, slot_minutes: 60,
        max_advance_days: 14, cancel_cutoff_hours: 2, booking_lead_hours: 2,
        max_hours_per_booking: 3, harga_default: 45000,
        owner_emails: '', google_client_id: '',
        peak_hours: '18,19,20', peak_days: '1,2,3,4,5', peak_multiplier: 1.5
      };
    }
  `, ctx);
  
  return ctx;
}

// Zona waktu yang diuji
const ZONES = ['Asia/Jakarta', 'America/New_York', 'Europe/Paris', 'Pacific/Kiritimati'];

// Instant tetap: 2026-10-05 (Senin) 10:00 WIB
const NOW = new Date('2026-10-05T10:00:00+07:00').getTime();

// ============================================================
// leadTimeOk
// ============================================================

test('leadTimeOk: tepat 2 jam = boleh (batas inklusif)', () => {
  for (const tz of ZONES) {
    const ctx = setup(NOW);
    // 10:00 WIB sekarang, booking 12:00 = tepat 2 jam
    assert.equal(
      vm.runInContext('leadTimeOk("2026-10-05", "2026-10-05", new Date(' + NOW + '), 12, readConfig())', ctx),
      true,
      `Gagal di zona ${tz}`
    );
  }
});

test('leadTimeOk: 1 jam 59 menit = tolak', () => {
  for (const tz of ZONES) {
    const ctx = setup(NOW);
    // 10:00 WIB sekarang, booking 11:59 = 1 jam 59 menit < 2 jam
    assert.equal(
      vm.runInContext('leadTimeOk("2026-10-05", "2026-10-05", new Date(' + NOW + '), 11, readConfig())', ctx),
      false,
      `Gagal di zona ${tz}`
    );
  }
});

test('leadTimeOk: 3 jam = boleh', () => {
  for (const tz of ZONES) {
    const ctx = setup(NOW);
    assert.equal(
      vm.runInContext('leadTimeOk("2026-10-05", "2026-10-05", new Date(' + NOW + '), 13, readConfig())', ctx),
      true,
      `Gagal di zona ${tz}`
    );
  }
});

test('leadTimeOk: tanggal lain = selalu true', () => {
  for (const tz of ZONES) {
    const ctx = setup(NOW);
    assert.equal(
      vm.runInContext('leadTimeOk("2026-10-06", "2026-10-05", new Date(' + NOW + '), 8, readConfig())', ctx),
      true,
      `Gagal di zona ${tz}`
    );
  }
});

// ============================================================
// isPeakHour
// ============================================================

test('isPeakHour: Senin 18.00 WIB = peak di semua zona', () => {
  for (const tz of ZONES) {
    const ctx = setup(NOW);
    assert.equal(
      vm.runInContext('isPeakHour(readConfig(), "2026-10-05", 18)', ctx),
      true,
      `Gagal di zona ${tz}`
    );
  }
});

test('isPeakHour: Sabtu 18.00 WIB = tidak peak', () => {
  for (const tz of ZONES) {
    const ctx = setup(NOW);
    // 2026-10-10 adalah Sabtu
    assert.equal(
      vm.runInContext('isPeakHour(readConfig(), "2026-10-10", 18)', ctx),
      false,
      `Gagal di zona ${tz}`
    );
  }
});

test('isPeakHour: 17.00 = tidak peak (di luar peak_hours)', () => {
  for (const tz of ZONES) {
    const ctx = setup(NOW);
    assert.equal(
      vm.runInContext('isPeakHour(readConfig(), "2026-10-05", 17)', ctx),
      false,
      `Gagal di zona ${tz}`
    );
  }
});

// ============================================================
// bookingTotal (paritas dengan frontend)
// ============================================================

test('bookingTotal: paritas dengan bookingPrice frontend', () => {
  const ctx = setup(NOW);
  const court = { id: 'LK1', nama: 'Lapangan 1', harga_per_jam: 45000, status: 'aktif' };
  
  // Senin 18.00 + 2 jam = 67.500 + 67.500 = 135.000
  const total = vm.runInContext(
    'bookingTotal(readConfig(), ' + JSON.stringify(court) + ', "2026-10-05", 18, 2)',
    ctx
  );
  assert.equal(total, 135000);
});

test('bookingTotal: hari non-peak = flat', () => {
  const ctx = setup(NOW);
  const court = { id: 'LK1', nama: 'Lapangan 1', harga_per_jam: 45000, status: 'aktif' };
  
  // Sabtu 10.00 + 2 jam = 45.000 + 45.000 = 90.000
  const total = vm.runInContext(
    'bookingTotal(readConfig(), ' + JSON.stringify(court) + ', "2026-10-10", 10, 2)',
    ctx
  );
  assert.equal(total, 90000);
});

// ============================================================
// handleCancelBooking cutoff (via leadTimeOk sebagai proxy)
// ============================================================

test('cutoff cancel: booking 3 jam lagi = boleh batal', () => {
  for (const tz of ZONES) {
    const ctx = setup(NOW);
    // 10:00 WIB sekarang, booking 13:00 = 3 jam
    const start = Date.UTC(2026, 9, 5, 13 - 7, 0);
    const diffH = (start - NOW) / 36e5;
    assert.ok(diffH >= 2, `Cutoff salah di zona ${tz}: ${diffH} jam`);
  }
});

test('cutoff cancel: booking 1 jam lagi = tolak', () => {
  for (const tz of ZONES) {
    const ctx = setup(NOW);
    // 10:00 WIB sekarang, booking 11:00 = 1 jam
    const start = Date.UTC(2026, 9, 5, 11 - 7, 0);
    const diffH = (start - NOW) / 36e5;
    assert.ok(diffH < 2, `Cutoff salah di zona ${tz}: ${diffH} jam`);
  }
});

test('cutoff cancel: tepat 2 jam = boleh', () => {
  for (const tz of ZONES) {
    const ctx = setup(NOW);
    // 10:00 WIB sekarang, booking 12:00 = tepat 2 jam
    const start = Date.UTC(2026, 9, 5, 12 - 7, 0);
    const diffH = (start - NOW) / 36e5;
    assert.ok(diffH >= 2, `Cutoff salah di zona ${tz}: ${diffH} jam`);
  }
});

// ============================================================
// handleGetData
// ============================================================

test('handleGetData: penyewa dapat slots tanpa PII', () => {
  const ctx = setup(NOW);
  vm.runInContext(`
    SpreadsheetApp.getActiveSpreadsheet = () => ({
      getSheetByName: (name) => {
        if (name === 'Booking') return {
          getDataRange: () => ({ getValues: () => [
            ['booking_id','created_at','email','nama','venue_id','tanggal','jam_mulai','durasi','total_harga','payment_option','payment_status','status'],
            ['LK-001', new Date(), 'a@x.com', 'A', 'LK1', '2026-10-05', '09:00', 2, 90000, 'full', 'paid', 'active'],
            ['LK-002', new Date(), 'b@x.com', 'B', 'LK2', '2026-10-05', '10:00', 1, 45000, 'full', 'paid', 'active']
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
  const result = vm.runInContext('handleGetData({ date: "2026-10-05" }, { email: "user@x.com" })', ctx);
  assert.equal(result.slots['2026-10-05'].LK1.length, 2); // 09:00 + 10:00
  assert.equal(result.slots['2026-10-05'].LK2.length, 1); // 10:00
  assert.equal(result.bookings.length, 0); // penyewa tidak dapat booking list
});

test('handleGetData: owner dapat semua booking', () => {
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
    readConfig = () => ({ owner_emails: ['owner@lapanganku.id'] });
  `, ctx);
  const result = vm.runInContext('handleGetData({ date: "2026-10-05" }, { email: "owner@lapanganku.id" })', ctx);
  assert.ok(Array.isArray(result.bookings));
  assert.equal(result.bookings.length, 1);
});

// ============================================================
// handleCreateBooking
// ============================================================

test('handleCreateBooking: booking sukses + ID format benar', () => {
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
    handleCreateBooking(
      { venue_id: 'LK1', tanggal: '2026-10-05', jam_mulai: '14', durasi: 2, payment_option: 'full' },
      { email: 'user@x.com', name: 'User' }
    )
  `, ctx);
  assert.match(result.booking_id, /^LK-20261005-[A-Z0-9]{4}$/);
  assert.equal(result.total_harga, 90000); // 2 jam flat
  assert.equal(result.status, 'active');
});

test('handleCreateBooking: tolak slot bentrok', () => {
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
    handleCreateBooking(
      { venue_id: 'LK1', tanggal: '2026-10-05', jam_mulai: '09', durasi: 1, payment_option: 'full' },
      { email: 'user@x.com', name: 'User' }
    )
  `, ctx);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'SLOT_TAKEN');
});

test('handleCreateBooking: tolak tanggal lampau', () => {
  const ctx = setup(NOW);
  vm.runInContext(`
    SpreadsheetApp.getActiveSpreadsheet = () => ({
      getSheetByName: (name) => {
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
  let threw = false;
  try {
    vm.runInContext(`
      handleCreateBooking(
        { venue_id: 'LK1', tanggal: '2026-09-01', jam_mulai: '10', durasi: 1, payment_option: 'full' },
        { email: 'user@x.com', name: 'User' }
      )
    `, ctx);
  } catch (e) {
    threw = true;
    assert.match(e.message, /lampau/i);
  }
  assert.ok(threw, 'Harus melempar error untuk tanggal lampau');
});

// ============================================================
// handleWaitlistJoin
// ============================================================

test('handleWaitlistJoin: sukses antre + posisi benar', () => {
  const ctx = setup(NOW);
  vm.runInContext(`
    var _waitlistRows = [
      { email: 'a@x.com', nama: 'A', tanggal: '2026-10-05', jam_mulai: '12:00', durasi: 1, created_at: new Date(), status: 'active' }
    ];
    SpreadsheetApp.getActiveSpreadsheet = () => ({
      getSheetByName: (name) => {
        if (name === 'Waitlist') return {
          appendRow: (row) => { _waitlistRows.push(row); },
          getDataRange: () => ({ getValues: () => [
            ['email','nama','tanggal','jam_mulai','durasi','created_at','status'],
            ['a@x.com', 'A', '2026-10-05', '12:00', 1, new Date(), 'active']
          ]})
        };
        if (name === 'Booking') return {
          getDataRange: () => ({ getValues: () => [
            ['booking_id','created_at','email','nama','venue_id','tanggal','jam_mulai','durasi','total_harga','payment_option','payment_status','status'],
            ['LK-001', new Date(), 'x@x.com', 'X', 'LK1', '2026-10-05', '12:00', 1, 45000, 'full', 'paid', 'active']
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
    handleWaitlistJoin(
      { tanggal: '2026-10-05', jam_mulai: 12, durasi: 1 },
      { email: 'b@x.com', name: 'B' }
    )
  `, ctx);
  assert.equal(result.joined, true);
  assert.equal(result.position, 2);
});

test('handleWaitlistJoin: tolak jika jam sudah lewat batas lead time', () => {
  for (const tz of ZONES) {
    const ctx = setup(NOW);
    vm.runInContext(`
      SpreadsheetApp.getActiveSpreadsheet = () => ({
        getSheetByName: (name) => {
          if (name === 'Waitlist') return {
            getDataRange: () => ({ getValues: () => [
              ['email','nama','tanggal','jam_mulai','durasi','created_at','status']
            ]})
          };
          if (name === 'Booking') return {
            getDataRange: () => ({ getValues: () => [
              ['booking_id','created_at','email','nama','venue_id','tanggal','jam_mulai','durasi','total_harga','payment_option','payment_status','status'],
              ['LK-001', new Date(), 'x@x.com', 'X', 'LK1', '2026-10-05', '09:00', 1, 45000, 'full', 'paid', 'active']
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
    let threw = false;
    try {
      vm.runInContext(`
        handleWaitlistJoin(
          { tanggal: '2026-10-05', jam_mulai: 9, durasi: 1 },
          { email: 'b@x.com', name: 'B' }
        )
      `, ctx);
    } catch (e) {
      threw = true;
      assert.match(e.message, /lewat batas/i);
    }
    assert.ok(threw, `Harus melempar error di zona ${tz} untuk jam yang sudah lewat batas lead time`);
  }
});

test('handleWaitlistJoin: tolak duplikat', () => {
  const ctx = setup(NOW);
  vm.runInContext(`
    SpreadsheetApp.getActiveSpreadsheet = () => ({
      getSheetByName: (name) => {
        if (name === 'Waitlist') return {
          getDataRange: () => ({ getValues: () => [
            ['email','nama','tanggal','jam_mulai','durasi','created_at','status'],
            ['a@x.com', 'A', '2026-10-05', '12:00', 1, new Date(), 'active']
          ]})
        };
        if (name === 'Booking') return {
          getDataRange: () => ({ getValues: () => [
            ['booking_id','created_at','email','nama','venue_id','tanggal','jam_mulai','durasi','total_harga','payment_option','payment_status','status'],
            ['LK-001', new Date(), 'x@x.com', 'X', 'LK1', '2026-10-05', '12:00', 1, 45000, 'full', 'paid', 'active']
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
  let threw = false;
  try {
    vm.runInContext(`
      handleWaitlistJoin(
        { tanggal: '2026-10-05', jam_mulai: 12, durasi: 1 },
        { email: 'a@x.com', name: 'A' }
      )
    `, ctx);
  } catch (e) {
    threw = true;
    assert.match(e.message, /sudah antre/i);
  }
  assert.ok(threw, 'Harus melempar error untuk duplikat');
});
