/**
 * LAPANGANKU - Apps Script Web App
 * =================================
 * Endpoint: getData, createBooking, cancelBooking, getMyBookings, setupSheets.
 *
 * Deploy ringkas (detail di SETUP.md):
 * 1. Buat Spreadsheet baru -> Extensions -> Apps Script -> paste file ini
 * 2. Run setupSheets sekali (ijinkan permission)
 * 3. Deploy -> New deployment -> Web app
 *    - Execute as: Me
 *    - Who has access: Anyone
 * 4. Copy Web app URL -> isi CONFIG.APPS_SCRIPT_URL di index.html
 * 5. Isi CONFIG di config.js (APPS_SCRIPT_URL + GOOGLE_CLIENT_ID) - bukan di index.html lagi
 *    CATATAN KEAMANAN: JANGAN share spreadsheet ke publik (lihat SETUP.md langkah 8).
 */

var TZ = 'Asia/Jakarta';
/* Domain produksi - SATU sumber. Ikut ganti saat domain final berbeda. */
var APP_URL = 'https://lapanganku.web.id/';

/* ============ CSRF PROTECTION ============ */
// WHY: verifikasi origin untuk cegah CSRF. CATATAN JUJUR: parameter `origin` dikirim client,
// jadi penyerang non-browser bisa memalsukannya - ini HANYA lapisan tambahan (best effort).
// Pertahanan sesungguhnya = verifikasi ID token Google di verifyCredential() (signature + aud + iss + exp).
function isValidRequest(e) {
  var origin = e.parameter && e.parameter.origin;
  var referer = e.parameter && e.parameter.referer;
  // WHY (P1-3): tiap venue punya domain sendiri — allowlist digabung dari hardcoded
  // + sheet Config (kunci allowed_origins, koma-separated), di-cache 6 jam.
  var allowedOrigins = getAllowedOrigins();
  if (origin && allowedOrigins.indexOf(origin) !== -1) return true;
  if (referer && allowedOrigins.some(function(o) { return referer.indexOf(o) === 0; })) return true;
  return false;
}

// WHY (P1-3): baca allowed_origins dari Config tanpa sheet read tiap request (cache 6 jam).
// Fail-open ke hardcoded bila CacheService/sheet bermasalah — keamanan sesungguhnya
// tetap di verifikasi ID token Google.
function getAllowedOrigins() {
  var base = ['https://lapanganku.web.id', 'http://localhost:8000', 'http://127.0.0.1:8000'];
  var extra = [];
  try {
    var cache = CacheService.getScriptCache();
    var hit = cache.get('lk_allowed_origins');
    if (hit) return base.concat(JSON.parse(hit));
    extra = String(readConfig().allowed_origins || '').split(/[;,\s]+/)
      .map(function (s) { return s.trim().replace(/\/+$/, ''); }).filter(Boolean);
    cache.put('lk_allowed_origins', JSON.stringify(extra), 21600);
  } catch (e) { /* fail-open ke base */ }
  return base.concat(extra);
}

// WHY (P1-3): URL aplikasi di email mengikuti domain venue (kunci app_url di Config),
// fallback ke APP_URL hardcoded bila kosong.
function appUrl() {
  try {
    var u = String(readConfig().app_url || '').trim().replace(/\/+$/, '');
    if (u) return u + '/';
  } catch (e) { /* fallback */ }
  return APP_URL;
}


/* ============ DISPATCHER ============ */
// WHY tabel (audit Rule 12.1): doPost dulu memuat rantai if-else 17 cabang (71 baris) sehingga
// sulit dilihat action apa saja yang ada. Tabel memisahkan "action apa" dari "bagaimana
// request divalidasi" - menambah endpoint kini satu baris.
var ACTIONS = {
  health: function (b, u) { return { status: 'ok', timestamp: new Date().toISOString() }; },
  getData: function (b, u) { return handleGetData(b, u); },
  createBooking: function (b, u) { return handleCreateBooking(b, u); },
  cancelBooking: function (b, u) { return handleCancelBooking(b, u); },
  rescheduleBooking: function (b, u) { return handleRescheduleBooking(b, u); },
  getMyBookings: function (b, u) { return handleMyBookings(u); },
  logError: function (b, u) { return handleLogError(b, u); },
  waitlistJoin: function (b, u) { return handleWaitlistJoin(b, u); },
  waitlistCancel: function (b, u) { return handleWaitlistCancel(b, u); },
  waitlistMine: function (b, u) { return handleWaitlistMine(u); },
  submitReview: function (b, u) { return handleSubmitReview(b, u); },
  myReviewable: function (b, u) { return handleMyReviewable(u); },
  ownerUpdateBooking: function (b, u) { return handleOwnerUpdateBooking(b, u); },
  ownerCreateBooking: function (b, u) { return handleOwnerCreateBooking(b, u); },
  monthlyReportNow: function (b, u) { return handleMonthlyReportNow(b, u); },
  submitFeedback: function (b, u) { return handleSubmitFeedback(b, u); },
  createSnapToken: function (b, u) { return handleCreateSnapToken(b, u); },
  getMidtransSettings: function (b, u) { return handleGetMidtransSettings(b, u); },
  saveMidtransSettings: function (b, u) { return handleSaveMidtransSettings(b, u); },
  // WHY loyalty server-authoritative (2026-10-11): poin, redeem, dan saldo dihitung server
  // via sheet LoyaltyLedger (append-only). Client tidak lagi menjadi sumber kebenaran.
  loyaltyBalance: function (b, u) { return handleLoyaltyBalance(u); },
  loyaltyEarn: function (b, u) { return handleLoyaltyEarn(b, u); },
  loyaltyRedeem: function (b, u) { return handleLoyaltyRedeem(b, u); },
  loyaltyRewards: function (b, u) { return handleLoyaltyRewards(); },
  // WHY (2026-10-11): owner butuh lihat poin semua customer di CRM - dari server, bukan localStorage browser owner.
  loyaltyAllBalances: function (b, u) { return handleLoyaltyAllBalances(u); },
  // WHY split-bill server-authoritative (2026-10-11): transisi paid/closed diotorisasi server.
  splitBillCreate: function (b, u) { return handleSplitBillCreate(b, u); },
  splitBillGet: function (b, u) { return handleSplitBillGet(b, u); },
  splitBillMarkPaid: function (b, u) { return handleSplitBillMarkPaid(b, u); },
  splitBillClose: function (b, u) { return handleSplitBillClose(b, u); },
  // WHY skill rating server-authoritative (2026-10-11): Elo dihitung server (K=32, initial 1200).
  skillRecordMatch: function (b, u) { return handleSkillRecordMatch(b, u); },
  skillGetRating: function (b, u) { return handleSkillGetRating(b, u); },
  // WHY recurring atomic (2026-10-11): 1 transaksi untuk N booking. Semua atau tidak sama sekali.
  createRecurringBooking: function (b, u) { return handleCreateRecurringBooking(b, u); }
};
// WHY unwrap: beberapa handler membalas err(...) untuk kegagalan (CUTOFF_PASSED, FORBIDDEN, dst).
// Tanpa unwrap, respons itu dibungkus ok(...) lagi sehingga client menerima ok:true untuk
// kegagalan dan menampilkan toast sukses palsu (bug kontrak dispatcher, rev 3t).
function dispatchAction(action, body, user) {
  var fn = ACTIONS[action];
  if (!fn) return err('VALIDATION_ERROR', 'Aksi tidak dikenal: ' + action);
  return unwrap(fn(body, user));
}

/* ============ HTTP ENTRY ============ */
function doPost(e) {
  var res;
  try {
    var ct = (e.postData && e.postData.type || '').toLowerCase();
    if (ct && ct.indexOf('application/json') === -1 && ct.indexOf('text/plain') === -1) {
      return ContentService.createTextOutput(JSON.stringify(err('VALIDATION_ERROR', 'Content-Type tidak didukung.'))).setMimeType(ContentService.MimeType.JSON);
    }
    var body = JSON.parse(e.postData.contents || '{}');
    var action = body.action;
    // WHY (Midtrans): notifikasi webhook Midtrans datang TANPA field action dan TANPA
    // credential user. Terdeteksi dari signature_key + transaction_status; verifikasi
    // signature di handleMidtransWebhook adalah auth-nya (bukan jalur user).
    if (!action && body.signature_key && body.transaction_status) {
      var wh = handleMidtransWebhook(body);
      return ContentService.createTextOutput(JSON.stringify(wh)).setMimeType(ContentService.MimeType.JSON);
    }
    // API versioning: /v1/ prefix for future compatibility
    var path = e.pathInfo || '';
    if (path.indexOf('/v1/') === 0) {
      action = action; // Same actions, versioned path
    }
    // WHY VULN-001: getPublicData harus bisa diakses SEBELUM login (data venue untuk landing page).
    // Endpoint ini hanya mengembalikan whitelist field non-sensitif (lapangan + tarif + jam buka),
    // tidak pernah PII. Semua aksi lain tetap wajib token Google valid.
    if (action === 'getPublicData') {
      if (!checkAnonRateLimit()) {
        res = err('RATE_LIMIT', 'Terlalu banyak permintaan. Tunggu beberapa detik lalu coba lagi.');
      } else {
        res = isValidRequest(e) ? unwrap(handleGetPublicData()) : err('FORBIDDEN', 'Request tidak valid. Origin tidak diizinkan.');
      }
    } else if (action === 'getPublicSlots') {
      // WHY (C3 fix): slot per-tanggal boleh diakses anonim (keputusan produk: browse bebas,
      // booking wajib login). Hanya kirim map slot (jam terisi per lapangan), tanpa PII/bookings.
      if (!checkAnonRateLimit()) {
        res = err('RATE_LIMIT', 'Terlalu banyak permintaan. Tunggu beberapa detik lalu coba lagi.');
      } else if (!isValidRequest(e)) {
        res = err('FORBIDDEN', 'Request tidak valid. Origin tidak diizinkan.');
      } else {
        res = unwrap(handleGetPublicSlots(body));
      }
    } else {
      var user = decodeCredential(body.credential);
      if (!user) {
        res = err('AUTH_REQUIRED', 'Sesi tidak valid. Silakan masuk ulang.');
      } else if (!isValidRequest(e)) {
        res = err('FORBIDDEN', 'Request tidak valid. Origin tidak diizinkan.');
      } else if (!checkRateLimit(user.email)) {
        res = err('RATE_LIMIT', 'Terlalu banyak permintaan. Tunggu beberapa detik lalu coba lagi.');
        res.rateLimit = { limit: 30, window: 60 };
      } else {
        res = dispatchAction(action, body, user);
      }
    }
  } catch (ex) {
    console.error('doPost error', ex);
    logErrorSafe('server:doPost', ex, typeof user !== 'undefined' && user ? user.email : '(anon)');
    // WHY (Batch A): pesan validasi ramah-user diteruskan apa adanya; pesan exception internal
    // tetap disamarkan sesuai VULN-006.
    if (ex && ex.isValidationError) {
      res = err('VALIDATION_ERROR', String(ex.message).slice(0, 300));
    } else {
      res = err('SERVER_ERROR', 'Terjadi kesalahan di server. Coba lagi sebentar lagi.');
    }
  }
  return ContentService.createTextOutput(JSON.stringify(res)).setMimeType(ContentService.MimeType.JSON);
}

function ok(data, rateLimit) {
  var res = { ok: true, data: data };
  if (rateLimit) res.rateLimit = rateLimit;
  return res;
}
function err(code, message) { return { ok: false, error: { code: code, message: message } }; }
// WHY (Batch A): validasi input melempar Error dengan pesan ramah-user, tapi catch doPost
// memetakan SEMUA throw jadi SERVER_ERROR generik. ValidationError dibedakan agar pesan
// asli ("Format tanggal tidak valid...") sampai ke user sebagai VALIDATION_ERROR.
function ValidationError(message) {
  var e = new Error(message);
  e.isValidationError = true;
  return e;
}
// WHY (Batch A, formula injection): string user (nama profil Google, komentar) ditulis mentah
// ke Sheet; bila diawali =+-@ dieksekusi sebagai formula saat owner buka spreadsheet.
// Pola sama dengan csvCell() di frontend.
function neutralizeFormula(v) {
  var s = String(v == null ? '' : v);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}
// WHY: rate limit per akun (maks 30 request per 60 detik) via CacheService - cegah abuse endpoint.
// Fail-OPEN jika CacheService error: rate limiter tidak boleh mematikan seluruh aplikasi booking
// (dulu error cache = setiap request ditolak). Abuse tetap dibatasi lock + validasi token.
// WHY window eksplisit (audit P2-6): CacheService punya TTL MINIMUM 600 detik - meminta 60 detik
// diabaikan/dibulatkan, sehingga limit "30 per 60 detik" yang dijanjikan tidak pernah berlaku.
// Solusi tanpa mengubah kontrak: simpan awal window (epoch detik) dengan TTL 600, lalu reset
// penghitung sendiri saat window sudah lewat 60 detik. Hasil: benar-benar 30 permintaan/60 detik.
function checkRateLimit(email) {
  try {
    var cache = CacheService.getScriptCache();
    var k = 'rl:' + email, kw = k + ':w';
    var nowSec = Math.floor(Date.now() / 1000);
    var winStart = Number(cache.get(kw) || 0);
    var n = 0;
    if (winStart && (nowSec - winStart) < 60) {
      n = Number(cache.get(k) || 0);      // masih di window yang sama
    } else {
      cache.put(kw, String(nowSec), 600); // window baru
    }
    if (n >= 30) return false;
    cache.put(k, String(n + 1), 600);
    return true;
  } catch (ex) {
    logErrorSafe('rate-limit', ex, email);
    return true;
  }
}
// WHY (Batch A): getPublicData adalah satu-satunya endpoint pra-auth; tiap hit membaca 3 sheet.
// Tanpa rate limit, satu penyerang bisa menguras kuota Apps Script harian (DoS ketersediaan).
// IP klien tidak tersedia andal di Apps Script, jadi dipakai bucket global anonim 120/menit
// (fail-open bila CacheService error, pola sama seperti checkRateLimit).
function checkAnonRateLimit() {
  try {
    var cache = CacheService.getScriptCache();
    var k = 'rl:anon:pub', kw = k + ':w';
    var nowSec = Math.floor(Date.now() / 1000);
    var winStart = Number(cache.get(kw) || 0);
    var n = 0;
    if (winStart && (nowSec - winStart) < 60) {
      n = Number(cache.get(k) || 0);
    } else {
      cache.put(kw, String(nowSec), 600);
    }
    if (n >= 120) return false;
    cache.put(k, String(n + 1), 600);
    return true;
  } catch (ex) {
    return true;
  }
}
// WHY: beberapa handler membalas gagal dengan err(...) (mis. CUTOFF_PASSED, FORBIDDEN, "Antrean tidak ditemukan").
// Tanpa unwrap, respons itu dibungkus ok(...) lagi sehingga client menerima ok:true untuk kegagalan
// dan menampilkan toast sukses palsu. unwrap meneruskan err apa adanya (bug kontrak dispatcher).
function unwrap(res) { return (res && res.ok === false && res.error) ? res : ok(res); }

/* ============ VALIDASI INPUT ============ */
// WHY (audit P2-11): sanitizeString lama hanya membuang < dan >. Nilai lain (kutip, backtick)
// lolos ke Sheet, dan dari Sheet ke HTML lewat esc(). Aman SELAMA esc() dipakai di setiap titik
// render - artinya pertahanan hanya satu lapis: satu render baru yang lupa esc() = XSS langsung.
// Fungsi ini menutup jalur injeksi HTML/atribut di sumbernya (defense in depth).
function sanitizeText(v, maxLen) {
  return String(v == null ? '' : v).replace(/[<>"'`]/g, '').slice(0, maxLen || 200);
}
// WHY: dipakai untuk kolom yang harus berformat ketat - kalau tidak cocok, tolak (bukan dipotong).
function isValidYmd(s) { return /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')); }
function isValidYm(s) { return /^\d{4}-\d{2}$/.test(String(s || '')); }
function isValidEmail(s) { return !s || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s)); }

/* ============ ERROR LOG (P2 monitoring produksi) ============ */
// WHY terpisah dari user feedback (audit P2-7): dulu form masukan mengirim ke logError dengan
// nama+email diselipkan ke field `stack` - data pribadi masuk kolom stack trace, dan dua kanal
// berbeda (error teknis vs masukan pengguna) bercampur sehingga keduanya sulit dianalisis.
// Sekarang sheet sendiri, kolom eksplisit. Rate limit tetap 20/jam/akun.
function handleSubmitFeedback(body, user) {
  // WHY .trim() (ditemukan test): sanitizeText tidak memangkas spasi, sehingga pesan berisi
  // spasi saja ('   ') lolos cek kosong dan tersimpan sebagai masukan hampa.
  var pesan = sanitizeText(body.pesan, 500).trim();
  if (!pesan) return err('VALIDATION_ERROR', 'Pesan tidak boleh kosong.');
  var nama = sanitizeText(body.nama, 80);
  var email = sanitizeText(body.email, 120);
  if (!isValidEmail(email)) return err('VALIDATION_ERROR', 'Format email tidak valid.');
  var kategori = sanitizeText(body.kategori, 30) || 'lainnya';
  var cache = CacheService.getScriptCache();
  var k = 'fb:' + user.email;
  var n = Number(cache.get(k) || 0);
  if (n >= 20) return err('RATE_LIMIT', 'Terlalu banyak masukan hari ini. Coba lagi besok.');
  cache.put(k, String(n + 1), 3600);
  ss().getSheetByName('Feedback').appendRow([new Date(), user.email, nama, email, kategori, pesan]);
  logStructured('info', 'feedback_submitted', { kategori: kategori });
  return { submitted: true };
}
function logErrorSafe(source, ex, email) {
  try {
    ss().getSheetByName('ErrorLog').appendRow([
      new Date(), String(source).slice(0, 80), String(email || '').slice(0, 120),
      String(ex && ex.message || ex).slice(0, 300), String(ex && ex.stack || '').slice(0, 500)
    ]);
  } catch (inner) { console.error('logError gagal', inner); }
}
// WHY: structured logging - level + timestamp + context untuk debugging produksi.
// console.log di sini SENGAJA (bukan sisa debug): Apps Script tidak punya file log,
// console.* adalah satu-satunya kanal ke Stackdriver Logging. Lihat juga logErrorSafe()
// yang menulis ke sheet ErrorLog untuk hal yang perlu dibaca owner.
function logStructured(level, message, context) {
  var entry = {
    ts: new Date().toISOString(),
    level: level || 'info',
    message: String(message).slice(0, 500),
    context: context || {},
    requestId: context && context.requestId ? context.requestId : Math.random().toString(36).slice(2, 10)
  };
  console.log(JSON.stringify(entry));
}

// Cost monitoring: track API usage
var _apiCosts = {};
function trackApiCost(action, duration) {
  if (!_apiCosts[action]) _apiCosts[action] = { count: 0, totalDuration: 0 };
  _apiCosts[action].count++;
  _apiCosts[action].totalDuration += duration;
  // Log if average exceeds threshold
  var avg = _apiCosts[action].totalDuration / _apiCosts[action].count;
  if (avg > 1000 && _apiCosts[action].count % 10 === 0) {
    logStructured('warn', 'High API latency: ' + action, { avg: Math.round(avg), count: _apiCosts[action].count });
  }
}
function handleLogError(body, user) {
  // WHY: rate limit per akun (maks 20/jam via CacheService) - client sudah debounce 5/sesi,
  // ini lapisan server agar endpoint tidak dipakai membanjiri sheet ErrorLog.
  var cache = CacheService.getScriptCache();
  var k = 'elog:' + user.email;
  var n = Number(cache.get(k) || 0);
  if (n >= 20) return { logged: false };
  cache.put(k, String(n + 1), 3600);
  logErrorSafe('client:' + String(body.context || 'unknown').slice(0, 80), { message: body.message, stack: body.stack }, user.email);
  return { logged: true };
}

/* ============ AUTH ============ */
// WHY: verifikasi ID token Google via endpoint tokeninfo resmi (https://oauth2.googleapis.com/tokeninfo),
// pola backend verification yang didokumentasikan Google untuk lingkungan tanpa client library kripto.
// Endpoint memverifikasi tanda tangan; sisi kita wajib memeriksa iss/aud/exp/email_verified sesuai
// checklist https://developers.google.com/identity/gsi/web/guides/verify-google-id-token.
// CacheService 55 menit: tokeninfo memvalidasi sampai exp, jadi tak perlu hit Google per request.
var TOKENINFO_URL = 'https://oauth2.googleapis.com/tokeninfo?id_token=';
var TOKEN_CACHE_SEC = 3300; // 55 menit, di bawah masa berlaku minimum 1 jam

// WHY hash jadi key (audit P0-1): token ID Google panjangnya ~800-1.100 karakter, sedangkan
// CacheService MENOLAK key > 250 karakter dengan exception (bukan memotong diam-diam). Dulu
// key-nya 'tk:' + credential utuh (~804 char) sehingga verifyCredential SELALU melempar di
// cache.get() -> tertangkap catch doPost -> client menerima SERVER_ERROR -> SELURUH mode live
// tidak bisa dipakai (booking, cancel, monitoring). SHA-256 -> 64 hex char = 67 char total,
// tetap unik per token dan tidak bisa dibalik (token tidak pernah tersimpan sebagai key).
function tokenCacheKey(credential) {
  var raw = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, credential);
  return 'tk:' + raw.map(function (b) { return ((b & 0xFF) + 0x100).toString(16).slice(1); }).join('');
}
function verifyCredential(credential) {
  if (!credential || credential === 'demo-token') return null;
  var cache = CacheService.getScriptCache();
  var ck = tokenCacheKey(credential);
  var cached = cache.get(ck);
  if (cached) {
    try { return JSON.parse(cached); } catch (ex) { /* lanjut verifikasi ulang */ }
  }
  var user = verifyCredentialRemote(credential);
  if (user) {
    cache.put(ck, JSON.stringify(user), TOKEN_CACHE_SEC);
    // WHY VERIFY-003: audit trail autentikasi (referensi logging.md). JANGAN pernah log credential/token.
    logStructured('info', 'auth_success', { email: user.email });
  } else {
    // WHY: email diambil dari payload mentah bila ada - berguna untuk mendeteksi pola serangan.
    // Credential tidak pernah dicatat (bisa dipakai ulang sampai exp).
    logStructured('warn', 'auth_failure', { reason: 'invalid_or_unverified_token' });
  }
  return user;
}

function verifyCredentialRemote(credential) {
  try {
    // Pra-cekhel murah: struktur JWT + exp belum lewat (hindari panggilan keluar untuk token jelas busuk)
    var parts = credential.split('.');
    if (parts.length !== 3) return null;
    var payload = JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(parts[1])).getDataAsString());
    if (!payload.exp || payload.exp * 1000 < Date.now()) return null;

    // Verifikasi tanda tangan + metadata via Google tokeninfo (tidak boleh panggilan habis)
    var resp = JSON.parse(UrlFetchApp.fetch(TOKENINFO_URL + encodeURIComponent(credential), { muteHttpExceptions: true }).getContentText());
    if (resp.error || resp.error_description) return null;

    var cfg = readConfig();
    if (!cfg.google_client_id || String(resp.aud) !== String(cfg.google_client_id)) return null; // token untuk app lain
    var issOk = resp.iss === 'accounts.google.com' || resp.iss === 'https://accounts.google.com';
    if (!issOk) return null;
    // WHY: tokeninfo umumnya mengirim string 'true', tapi terima juga boolean agar tahan perubahan format
    var verified = resp.email_verified === true || String(resp.email_verified) === 'true';
    if (!resp.email || !verified) return null;

    return { email: String(resp.email).toLowerCase(), name: resp.name || resp.email, picture: resp.picture || '' };
  } catch (ex) {
    console.warn('verifyCredential failed', ex);
    return null;
  }
}

function decodeCredential(credential) {
  // WHY: nama lama dipertahankan sebagai wrapper agar pemanggil lama tidak rusak; kini dengan verifikasi penuh.
  return verifyCredential(credential);
}

/* ============ LOYALTY (server-authoritative) ============ */
// WHY (2026-10-11): poin, redeem, dan saldo dihitung server via sheet LoyaltyLedger
// (append-only). Client tidak lagi menjadi sumber kebenaran — mencegah manipulasi poin
// via devtools. Saldo = SUM(amount) per email.

function parseLoyaltyRewards_(raw) {
  // format: ID:Nama:poin,ID:Nama:poin — sama dengan client loyaltyRewardsParse
  return String(raw || '').split(',').map(function (p) {
    var parts = p.trim().split(':');
    if (parts.length < 3) return null;
    var pts = parseInt(parts[2], 10) || 0;
    if (!parts[0].trim() || !parts[1].trim() || pts <= 0) return null;
    return { id: parts[0].trim().toUpperCase(), name: parts[1].trim(), points: pts };
  }).filter(function (r) { return !!r; });
}

function handleLoyaltyRewards() {
  var cfg = readConfig();
  return ok({ rewards: parseLoyaltyRewards_(cfg.loyalty_rewards || '') });
}

// WHY (2026-10-11): owner-only. Agregat saldo semua customer untuk CRM.
function handleLoyaltyAllBalances(user) {
  if (!isOwner(user)) return err('FORBIDDEN', 'Hanya owner.');
  var rows = readSheet('LoyaltyLedger');
  var map = {};
  for (var i = 0; i < rows.length; i++) {
    var email = String(rows[i].email).toLowerCase();
    if (!email) continue;
    map[email] = (map[email] || 0) + (parseInt(rows[i].amount, 10) || 0);
  }
  return ok({ balances: map });
}

/* ============ SPLIT-BILL (server-authoritative) ============ */
// WHY (2026-10-11): server mengotorisasi transisi paid/closed. Client tidak bisa menandai
// lunas untuk booking orang lain. Amounts dihitung server dari total_harga di sheet Booking.

function splitBillShares_(total, count) {
  // identik dengan client splitBillShares: bagi rata, sisa ke peserta pertama
  total = parseInt(total, 10) || 0;
  count = parseInt(count, 10) || 0;
  if (total <= 0 || count < 2 || count > 8) return [];
  var base = Math.floor(total / count);
  var rem = total - base * count;
  var out = [];
  for (var i = 0; i < count; i++) out.push(base + (i === 0 ? rem : 0));
  return out;
}

function findSplitBillRow_(booking_id) {
  var rows = readSheet('SplitBill');
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i].booking_id) === String(booking_id)) return rows[i];
  }
  return null;
}

function handleSplitBillCreate(body, user) {
  var booking_id = String(body.booking_id || '').trim();
  var count = parseInt(body.count, 10) || 0;
  if (!booking_id) return err('VALIDATION_ERROR', 'booking_id wajib.');
  if (count < 2 || count > 8) return err('VALIDATION_ERROR', 'Jumlah peserta 2-8.');
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return err('RATE_LIMITED', 'Sedang ramai, coba lagi.');
  try {
    if (findSplitBillRow_(booking_id)) return err('VALIDATION_ERROR', 'Patungan sudah ada untuk booking ini.');
    // validasi: booking milik user
    var bookings = readSheet('Booking');
    var bk = null;
    for (var i = 0; i < bookings.length; i++) {
      if (String(bookings[i].booking_id) === booking_id &&
          String(bookings[i].email).toLowerCase() === String(user.email).toLowerCase()) { bk = bookings[i]; break; }
    }
    if (!bk) return err('NOT_FOUND', 'Booking tidak ditemukan.');
    var total = parseInt(bk.total_harga, 10) || 0;
    var amounts = splitBillShares_(total, count);
    if (!amounts.length) return err('VALIDATION_ERROR', 'Total tidak valid.');
    var shares = amounts.map(function (amt, idx) {
      return { code: booking_id + '-P' + (idx + 1), nama: 'Peserta ' + (idx + 1), amount: amt, paid: false };
    });
    var now = new Date();
    ss().getSheetByName('SplitBill').appendRow([
      'SB-' + booking_id, booking_id, user.email, total, count, false,
      JSON.stringify(shares), now, now
    ]);
    return ok({ booking_id: booking_id, total: total, count: count, closed: false, shares: shares });
  } finally { lock.releaseLock(); }
}

function handleSplitBillGet(body, user) {
  var booking_id = String(body.booking_id || '').trim();
  if (!booking_id) return err('VALIDATION_ERROR', 'booking_id wajib.');
  var rec = findSplitBillRow_(booking_id);
  if (!rec) return ok({ exists: false });
  // WHY: hanya owner booking atau owner venue yang bisa lihat detail patungan.
  var bookings = readSheet('Booking');
  var allowed = isOwner(user);
  if (!allowed) {
    for (var i = 0; i < bookings.length; i++) {
      if (String(bookings[i].booking_id) === booking_id &&
          String(bookings[i].email).toLowerCase() === String(user.email).toLowerCase()) { allowed = true; break; }
    }
  }
  if (!allowed) return err('FORBIDDEN', 'Bukan booking kamu.');
  var shares = [];
  try { shares = JSON.parse(rec.shares || '[]'); } catch (e) {}
  return ok({
    exists: true, booking_id: rec.booking_id, total: parseInt(rec.total, 10) || 0,
    count: parseInt(rec.count, 10) || 0, closed: String(rec.closed).toLowerCase() === 'true',
    shares: shares
  });
}

function handleSplitBillMarkPaid(body, user) {
  var booking_id = String(body.booking_id || '').trim();
  var code = String(body.code || '').trim();
  if (!booking_id || !code) return err('VALIDATION_ERROR', 'booking_id dan code wajib.');
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return err('RATE_LIMITED', 'Sedang ramai, coba lagi.');
  try {
    var rec = findSplitBillRow_(booking_id);
    if (!rec) return err('NOT_FOUND', 'Patungan tidak ditemukan.');
    if (String(rec.closed).toLowerCase() === 'true') return err('VALIDATION_ERROR', 'Patungan sudah ditutup.');
    // WHY: hanya owner booking atau owner venue yang bisa menandai lunas.
    var bookings = readSheet('Booking');
    var allowed = isOwner(user);
    if (!allowed) {
      for (var i = 0; i < bookings.length; i++) {
        if (String(bookings[i].booking_id) === booking_id &&
            String(bookings[i].email).toLowerCase() === String(user.email).toLowerCase()) { allowed = true; break; }
      }
    }
    if (!allowed) return err('FORBIDDEN', 'Hanya pembuat patungan atau owner venue.');
    var shares = [];
    try { shares = JSON.parse(rec.shares || '[]'); } catch (e) {}
    var found = false;
    for (var j = 0; j < shares.length; j++) {
      if (shares[j].code === code) { shares[j].paid = true; found = true; break; }
    }
    if (!found) return err('NOT_FOUND', 'Kode peserta tidak ditemukan.');
    // update sheet: cari baris fisik dan tulis ulang shares + updated_at
    var sh = ss().getSheetByName('SplitBill');
    var values = sh.getDataRange().getValues();
    var head = values[0].map(function (h) { return String(h).trim(); });
    var colShares = head.indexOf('shares');
    var colUpdated = head.indexOf('updated_at');
    for (var r = 1; r < values.length; r++) {
      if (String(values[r][head.indexOf('booking_id')]) === booking_id) {
        sh.getRange(r + 1, colShares + 1).setValue(JSON.stringify(shares));
        sh.getRange(r + 1, colUpdated + 1).setValue(new Date());
        break;
      }
    }
    return ok({ booking_id: booking_id, shares: shares });
  } finally { lock.releaseLock(); }
}

function handleSplitBillClose(body, user) {
  var booking_id = String(body.booking_id || '').trim();
  if (!booking_id) return err('VALIDATION_ERROR', 'booking_id wajib.');
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return err('RATE_LIMITED', 'Sedang ramai, coba lagi.');
  try {
    var rec = findSplitBillRow_(booking_id);
    if (!rec) return err('NOT_FOUND', 'Patungan tidak ditemukan.');
    // WHY: hanya owner booking atau owner venue yang bisa menutup (organizer menanggung sisa).
    var bookings = readSheet('Booking');
    var allowed = isOwner(user);
    if (!allowed) {
      for (var i = 0; i < bookings.length; i++) {
        if (String(bookings[i].booking_id) === booking_id &&
            String(bookings[i].email).toLowerCase() === String(user.email).toLowerCase()) { allowed = true; break; }
      }
    }
    if (!allowed) return err('FORBIDDEN', 'Hanya pembuat patungan atau owner venue.');
    var shares = [];
    try { shares = JSON.parse(rec.shares || '[]'); } catch (e) {}
    shares.forEach(function (s) { s.paid = true; });
    var sh = ss().getSheetByName('SplitBill');
    var values = sh.getDataRange().getValues();
    var head = values[0].map(function (h) { return String(h).trim(); });
    for (var r = 1; r < values.length; r++) {
      if (String(values[r][head.indexOf('booking_id')]) === booking_id) {
        sh.getRange(r + 1, head.indexOf('closed') + 1).setValue(true);
        sh.getRange(r + 1, head.indexOf('shares') + 1).setValue(JSON.stringify(shares));
        sh.getRange(r + 1, head.indexOf('updated_at') + 1).setValue(new Date());
        break;
      }
    }
    return ok({ booking_id: booking_id, closed: true, shares: shares });
  } finally { lock.releaseLock(); }
}

/* ============ SKILL RATING (server-authoritative) ============ */
// WHY (2026-10-11): Elo dihitung server (K=32, initial 1200). Client tidak bisa memanipulasi rating.

function eloUpdate_(ra, rb, scoreA) {
  // identik dengan client: expected score + K-factor 32
  var ea = 1 / (1 + Math.pow(10, (rb - ra) / 400));
  var eb = 1 / (1 + Math.pow(10, (ra - rb) / 400));
  return [Math.round(ra + 32 * (scoreA - ea)), Math.round(rb + 32 * ((1 - scoreA) - eb))];
}

function getSkillRating_(email) {
  var rows = readSheet('SkillRating');
  email = String(email).toLowerCase();
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i].email).toLowerCase() === email) return rows[i];
  }
  return null;
}

function handleSkillGetRating(body, user) {
  var email = String(body.email || user.email).toLowerCase();
  // WHY: user hanya bisa lihat rating sendiri, owner bisa lihat semua.
  if (email !== String(user.email).toLowerCase() && !isOwner(user)) {
    return err('FORBIDDEN', 'Hanya bisa lihat rating sendiri.');
  }
  var rec = getSkillRating_(email);
  if (!rec) return ok({ exists: false, rating: 1200, wins: 0, losses: 0 });
  return ok({
    exists: true, rating: parseInt(rec.rating, 10) || 1200,
    wins: parseInt(rec.wins, 10) || 0, losses: parseInt(rec.losses, 10) || 0
  });
}

function handleSkillRecordMatch(body, user) {
  var booking_id = String(body.booking_id || '').trim();
  var opp_email = String(body.opp_email || '').trim().toLowerCase();
  var opp_name = String(body.opp_name || '').trim();
  var sets = body.sets; // array [[21,15],[19,21]]
  var winner = String(body.winner || '').toUpperCase(); // 'A' (pelapor) atau 'B' (lawan)
  if (!booking_id) return err('VALIDATION_ERROR', 'booking_id wajib.');
  if (!opp_email && !opp_name) return err('VALIDATION_ERROR', 'Lawan wajib diisi.');
  if (winner !== 'A' && winner !== 'B') return err('VALIDATION_ERROR', 'winner harus A atau B.');
  if (!Array.isArray(sets) || !sets.length) return err('VALIDATION_ERROR', 'sets wajib diisi.');
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return err('RATE_LIMITED', 'Sedang ramai, coba lagi.');
  try {
    // idempotency: booking_id UNIQUE di SkillMatch
    var matches = readSheet('SkillMatch');
    for (var i = 0; i < matches.length; i++) {
      if (String(matches[i].booking_id) === booking_id) {
        return ok({ recorded: false, reason: 'already_recorded' });
      }
    }
    // validasi: booking milik user + tanggal sudah lewat
    var bookings = readSheet('Booking');
    var bk = null;
    for (var j = 0; j < bookings.length; j++) {
      if (String(bookings[j].booking_id) === booking_id &&
          String(bookings[j].email).toLowerCase() === String(user.email).toLowerCase()) { bk = bookings[j]; break; }
    }
    if (!bk) return err('NOT_FOUND', 'Booking tidak ditemukan.');
    var today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
    if (String(bk.tanggal) > today) return err('VALIDATION_ERROR', 'Match hanya untuk booking yang sudah selesai.');
    // hitung Elo
    var playerEmail = String(user.email).toLowerCase();
    var pRec = getSkillRating_(playerEmail);
    var oRec = opp_email ? getSkillRating_(opp_email) : null;
    var ra = pRec ? (parseInt(pRec.rating, 10) || 1200) : 1200;
    var rb = oRec ? (parseInt(oRec.rating, 10) || 1200) : 1200;
    var scoreA = winner === 'A' ? 1 : 0;
    var updated = eloUpdate_(ra, rb, scoreA);
    var now = new Date();
    var sh = ss().getSheetByName('SkillMatch');
    var match_id = 'SK-' + today.replace(/-/g, '') + '-' + Math.random().toString(36).slice(2, 7).toUpperCase();
    sh.appendRow([
      match_id, booking_id, String(bk.tanggal), playerEmail, user.name,
      opp_email, opp_name, JSON.stringify(sets), winner, ra, updated[0], now
    ]);
    // update/create SkillRating untuk kedua pemain
    var srSh = ss().getSheetByName('SkillRating');
    updateSkillRating_(srSh, playerEmail, user.name, updated[0], winner === 'A' ? 1 : 0, winner === 'B' ? 1 : 0, now);
    if (opp_email) {
      updateSkillRating_(srSh, opp_email, opp_name || opp_email, updated[1], winner === 'B' ? 1 : 0, winner === 'A' ? 1 : 0, now);
    }
    return ok({
      recorded: true, match_id: match_id,
      player: { email: playerEmail, before: ra, after: updated[0] },
      opponent: { email: opp_email, before: rb, after: updated[1] }
    });
  } finally { lock.releaseLock(); }
}

function updateSkillRating_(sh, email, nama, rating, winDelta, lossDelta, now) {
  var values = sh.getDataRange().getValues();
  var head = values[0].map(function (h) { return String(h).trim(); });
  var colEmail = head.indexOf('email');
  for (var r = 1; r < values.length; r++) {
    if (String(values[r][colEmail]).toLowerCase() === String(email).toLowerCase()) {
      var curWins = parseInt(values[r][head.indexOf('wins')], 10) || 0;
      var curLosses = parseInt(values[r][head.indexOf('losses')], 10) || 0;
      sh.getRange(r + 1, head.indexOf('rating') + 1).setValue(rating);
      sh.getRange(r + 1, head.indexOf('wins') + 1).setValue(curWins + winDelta);
      sh.getRange(r + 1, head.indexOf('losses') + 1).setValue(curLosses + lossDelta);
      sh.getRange(r + 1, head.indexOf('updated_at') + 1).setValue(now);
      if (nama) sh.getRange(r + 1, head.indexOf('nama') + 1).setValue(nama);
      return;
    }
  }
  // belum ada: buat baru
  sh.appendRow([email, nama || email, rating, winDelta, lossDelta, now]);
}

/* ============ RECURRING BOOKING ATOMIC ============ */
// WHY (2026-10-11): 1 transaksi LockService untuk N booking mingguan. Prinsip: semua atau
// tidak sama sekali. Cek clash untuk SEMUA tanggal dulu, baru tulis. Tidak ada seri parsial.

function handleCreateRecurringBooking(body, user) {
  var cfg = readConfig();
  var dates = body.dates;
  if (!Array.isArray(dates) || dates.length < 2 || dates.length > 8) {
    return err('VALIDATION_ERROR', 'Jumlah minggu 2-8.');
  }
  // validasi request sekali (court, jam, durasi sama untuk semua minggu)
  // WHY: validateBookingRequest butuh body.tanggal - pakai minggu pertama untuk validasi court/jam/durasi.
  body.tanggal = String(dates[0]);
  var req = validateBookingRequest(body, cfg, courtsList());
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) return err('RATE_LIMITED', 'Sedang ramai, coba lagi.');
  try {
    // FASE 1: cek clash SEMUA tanggal. Jika ada 1 clash -> abort, tidak ada booking dibuat.
    var clashes = [];
    for (var i = 0; i < dates.length; i++) {
      var d = String(dates[i]);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return err('VALIDATION_ERROR', 'Format tanggal salah: ' + d);
      if (hasBookingClash(req.court.id, d, req.jamMulai, req.durasi)) clashes.push(d);
      if (!leadTimeOk(d, req.today, req.now, req.jamMulai, cfg)) clashes.push(d);
    }
    if (clashes.length) {
      return err('SLOT_TAKEN', 'Slot bentrok pada ' + clashes.join(', ') + '. Seri dibatalkan - tidak ada booking yang dibuat.');
    }
    // FASE 2: semua clear -> buat N booking atomik.
    var rcId = 'RC-' + dates[0].replace(/-/g, '') + '-' + randCode();
    var made = [];
    var addons = resolveAddOns(body.addons, 10);
    for (var j = 0; j < dates.length; j++) {
      var tanggal = String(dates[j]);
      var occ = dayOccupancyPct(cfg, tanggal);
      var total = bookingTotal(cfg, req.court, tanggal, req.jamMulai, req.durasi, occ, req.today);
      var subtotal = total + addons.total;
      var grandTotal = subtotal; // WHY (2026-10-11): voucher dihapus
      var bookingId = 'LK-' + tanggal.replace(/-/g, '') + '-' + randCode();
      var bk = {
        booking_id: bookingId, email: user.email, nama: user.name, venue_id: req.court.id,
        tanggal: tanggal, jam_mulai: pad(req.jamMulai) + ':00', durasi: req.durasi,
        total_harga: grandTotal, harga_lapangan: total, addons: addons.items, addon_total: addons.total,
        voucher: '', voucher_discount: 0,
        payment_option: req.opt, payment_status: 'unpaid', status: 'active',
        recurring_id: rcId, recurring_index: j + 1, recurring_total: dates.length
      };
      appendBookingRow(bk);
      made.push(bk);
    }
    // email + webhook di luar loop tapi tetap di dalam try (setelah lock dilepas di finally)
    return ok({ recurring_id: rcId, bookings: made, count: made.length });
  } finally {
    lock.releaseLock();
  }
}

function loyaltyBalance_(email) {
  var rows = readSheet('LoyaltyLedger');
  var bal = 0;
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i].email).toLowerCase() === String(email).toLowerCase()) {
      bal += parseInt(rows[i].amount, 10) || 0;
    }
  }
  return bal;
}

function handleLoyaltyBalance(user) {
  var rows = readSheet('LoyaltyLedger').filter(function (r) {
    return String(r.email).toLowerCase() === String(user.email).toLowerCase();
  });
  var balance = rows.reduce(function (s, r) { return s + (parseInt(r.amount, 10) || 0); }, 0);
  var history = rows.map(function (r) {
    return { date: r.date, type: r.type, amount: r.amount, ref_id: r.ref_id, reward_name: r.reward_name };
  }).sort(function (a, b) { return String(b.date).localeCompare(String(a.date)); }).slice(0, 50);
  return ok({ balance: balance, history: history });
}

function handleLoyaltyEarn(body, user) {
  var booking_id = String(body.booking_id || '').trim();
  if (!booking_id) return err('VALIDATION_ERROR', 'booking_id wajib.');
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return err('RATE_LIMITED', 'Sedang ramai, coba lagi.');
  try {
    var rows = readSheet('LoyaltyLedger');
    var email = String(user.email).toLowerCase();
    // idempotency: sudah dikreditkan untuk booking ini?
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      if (String(r.email).toLowerCase() === email && r.type === 'earn' && String(r.ref_id) === booking_id) {
        return ok({ credited: false, reason: 'already_credited' });
      }
    }
    // validasi: booking milik user + sudah lewat tanggalnya + tidak dibatalkan
    var bookings = readSheet('Booking');
    var bk = null;
    for (var j = 0; j < bookings.length; j++) {
      if (String(bookings[j].booking_id) === booking_id &&
          String(bookings[j].email).toLowerCase() === email) { bk = bookings[j]; break; }
    }
    if (!bk) return err('NOT_FOUND', 'Booking tidak ditemukan.');
    if (String(bk.status) === 'cancelled') return err('VALIDATION_ERROR', 'Booking dibatalkan, tidak dapat poin.');
    var today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
    if (String(bk.tanggal) > today) return err('VALIDATION_ERROR', 'Poin hanya untuk booking yang sudah selesai.');
    var points = Math.floor((parseInt(bk.total_harga, 10) || 0) / 10000); // 1 poin per Rp10rb
    if (points <= 0) return ok({ credited: false, reason: 'no_points' });
    var now = new Date();
    ss().getSheetByName('LoyaltyLedger').appendRow([
      'LG-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7).toUpperCase(),
      user.email, String(bk.tanggal), 'earn', points, booking_id, '', '', now
    ]);
    return ok({ credited: true, points: points, balance: loyaltyBalance_(email) });
  } finally { lock.releaseLock(); }
}

function handleLoyaltyRedeem(body, user) {
  var reward_id = String(body.reward_id || '').trim().toUpperCase();
  if (!reward_id) return err('VALIDATION_ERROR', 'reward_id wajib.');
  var rewards = parseLoyaltyRewards_(readConfig().loyalty_rewards || '');
  var reward = null;
  for (var i = 0; i < rewards.length; i++) if (rewards[i].id === reward_id) { reward = rewards[i]; break; }
  if (!reward) return err('NOT_FOUND', 'Reward tidak ditemukan.');
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return err('RATE_LIMITED', 'Sedang ramai, coba lagi.');
  try {
    var email = String(user.email).toLowerCase();
    var balance = loyaltyBalance_(email);
    if (balance < reward.points) return err('INSUFFICIENT_POINTS', 'Poin tidak cukup. Butuh ' + reward.points + ', kamu punya ' + balance + '.');
    var code = 'RWD-' + reward_id + '-' + Math.random().toString(36).slice(2, 6).toUpperCase();
    var now = new Date();
    var today = Utilities.formatDate(now, Session.getScriptTimeZone(), 'yyyy-MM-dd');
    ss().getSheetByName('LoyaltyLedger').appendRow([
      'LG-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7).toUpperCase(),
      user.email, today, 'redeem', -reward.points, code, reward_id, reward.name, now
    ]);
    return ok({ code: code, reward: reward, new_balance: balance - reward.points });
  } finally { lock.releaseLock(); }
}

/* ============ SHEET HELPERS ============ */
function ss() { return SpreadsheetApp.getActiveSpreadsheet(); }

function readSheet(name) {
  var sh = ss().getSheetByName(name);
  if (!sh) return [];
  var values = sh.getDataRange().getValues();
  if (values.length < 2) return [];
  var head = values[0].map(function (h) { return String(h).trim(); });
  return values.slice(1).filter(function (r) { return String(r[0]).trim() !== ''; }).map(function (r) {
    var o = {};
    head.forEach(function (h, i) { o[h] = r[i]; });
    return o;
  });
}

function readConfig() {
  // WHY: cache config untuk reduce sheet reads
  if (typeof getCachedConfig === 'function') return getCachedConfig();
  var cfg = {
    jam_buka_mulai: 6, jam_buka_selesai: 22, slot_minutes: 60,
    max_advance_days: 14, cancel_cutoff_hours: 2, booking_lead_hours: 2,
    max_hours_per_booking: 3, harga_default: 45000,
    owner_emails: '',
    google_client_id: '',
    // WHY (2026-10-11): sistem voucher DIHAPUS total. Key vouchers tidak lagi dipakai.
    // WHY (FITUR 4, spek 2026-10-10): harga dinamis off-by-default di live - sheet Config lama
    // tidak punya baris ini; tanpa default, client jatuh ke DEMO_CONFIG (phantom discount).
    dyn_enabled: '0',
    dyn_threshold: 30,
    dyn_days_before: 1,
    dyn_extra_pct: 10,
    // WHY (Midtrans): default key kosong = payment online nonaktif. Server key TIDAK PERNAH
    // dikirim ke client (hanya dipakai server-side untuk Snap API + verifikasi webhook).
    midtrans_server_key: '',
    midtrans_client_key: '',
    midtrans_sandbox: 1,
    // WHY (P1-3): tiap venue punya domain sendiri — allowlist origin + URL aplikasi
    // dibaca dari Config agar tak perlu edit kode per venue.
    allowed_origins: '',
    app_url: ''
  };
  var rows = readSheet('Config');
  rows.forEach(function (r) {
    var k = String(r.key || r.Key || '').trim();
    if (!k) return;
    var v = r.value != null ? r.value : r.Value;
    cfg[k] = k === 'owner_emails' ? String(v) : (isNaN(Number(v)) ? String(v) : Number(v));
  });
  cfg.owner_emails = String(cfg.owner_emails).split(/[;,\s]+/).map(function (s) { return s.trim().toLowerCase(); }).filter(Boolean);
  return cfg;
}

function isOwner(user) {
  return readConfig().owner_emails.indexOf(user.email) !== -1;
}

/* ============ PEAK PRICING (P2) ============ */
// WHY harga dihitung per-jam dari config: peak_hours (jam sibuk), peak_days (0=Minggu..6=Sabtu),
// peak_multiplier. Server = sumber kebenaran; client menghitung angka yang sama hanya untuk preview.
function peakConfig(cfg) {
  var hours = String(cfg.peak_hours || '').split(/[,\s]+/).filter(Boolean).map(Number);
  var days = String(cfg.peak_days || '').split(/[,\s]+/).filter(Boolean).map(Number);
  return { hours: hours, days: days, mult: Number(cfg.peak_multiplier) || 1 };
}
function isPeakHour(cfg, tanggal, jam) {
  var p = peakConfig(cfg);
  if (!p.hours.length || p.mult <= 1 || p.hours.indexOf(jam) === -1) return false;
  if (!p.days.length) return true;
  // WHY: DOW via Date.UTC + getUTCDay - sifat tanggal kalender WIB, deterministik di zona runtime mana pun
  // (getDay() biasa terbaca dari TZ runtime; Apps Script selalu Asia/Jakarta tapi rumus ini tetap benar jika dieksekusi di tempat lain)
  var parts = tanggal.split('-');
  var dow = new Date(Date.UTC(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]))).getUTCDay();
  return p.days.indexOf(dow) !== -1;
}
/* ============ OFF-PEAK (harga jam sepi) ============ */
// WHY: adopsi temuan riset kompetitor - Bukujanji menyebut "jam sepi yang tak terbaca" sebagai
// keluhan utama pengelola lapangan, dan AYO memakai harga coret untuk mendorong volume.
// Ini mekanisme yang SAMA dengan peak pricing, hanya dibalik: jam tertentu dapat diskon.
// Prioritas: kalau sebuah jam masuk peak DAN off-peak sekaligus, PEAK yang menang - jangan
// pernah menurunkan harga jam sibuk (logika bisnis: jam sibuk memang mahal).
function offConfig(cfg) {
  var hours = String(cfg.off_hours || '').split(/[,\s]+/).filter(Boolean).map(Number);
  var days = String(cfg.off_days || '').split(/[,\s]+/).filter(Boolean).map(Number);
  var mult = Number(cfg.off_multiplier) || 1;
  // WHY guard: multiplier >= 1 tidak masuk akal untuk "diskon" - perlakukan sebagai nonaktif.
  if (mult >= 1 || mult <= 0) mult = 1;
  return { hours: hours, days: days, mult: mult };
}
function isOffHour(cfg, tanggal, jam) {
  var p = offConfig(cfg);
  if (!p.hours.length || p.mult >= 1 || p.hours.indexOf(jam) === -1) return false;
  if (!p.days.length) return true;
  var parts = tanggal.split('-');
  var dow = new Date(Date.UTC(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]))).getUTCDay();
  return p.days.indexOf(dow) !== -1;
}
// WHY: harga satu jam - peak dulu, baru off-peak. Urutan ini penting (lihat catatan di atas).
function hourPrice(cfg, court, tanggal, jam, occupancyPct, todayStr_) {
  if (isPeakHour(cfg, tanggal, jam)) return Math.round(court.harga_per_jam * peakConfig(cfg).mult);
  if (isOffHour(cfg, tanggal, jam)) {
    var d = dynConfig(cfg);
    return Math.round(court.harga_per_jam * offConfig(cfg).mult *
      dynDiscountMult(true, d.enabled, d.daysBefore, tanggal, todayStr_, occupancyPct, d.threshold, d.extraPct));
  }
  return court.harga_per_jam;
}
function bookingTotal(cfg, court, tanggal, jamMulai, durasi, occupancyPct, todayStr_) {
  var total = 0;
  for (var i = 0; i < durasi; i++) total += hourPrice(cfg, court, tanggal, jamMulai + i, occupancyPct, todayStr_);
  return total;
}
/* ============ DYNAMIC OFF-PEAK PRICING (FITUR 4, spek 2026-10-10) ============ */
// WHY: diskon otomatis jam sepi berbasis okupansi - nilai jual ke owner (riset kompetitor).
// Berlaku HANYA untuk jam off-peak yang tanggalnya dalam jendela H- dan okupansi tanggal itu
// di bawah ambang. hourPrice menerima okupansi sebagai parameter opsional dari handler
// (dihitung dari sheet SEKALI per booking, bukan per jam) - default tanpa diskon (backward compatible).
function dynConfig(cfg) {
  return {
    enabled: cfg.dyn_enabled === true || cfg.dyn_enabled === 1 || String(cfg.dyn_enabled) === '1',
    threshold: Number(cfg.dyn_threshold) || 30,
    daysBefore: (cfg.dyn_days_before === undefined || cfg.dyn_days_before === null || cfg.dyn_days_before === '') ? 1 : Number(cfg.dyn_days_before),
    extraPct: (cfg.dyn_extra_pct === undefined || cfg.dyn_extra_pct === null || cfg.dyn_extra_pct === '') ? 10 : Number(cfg.dyn_extra_pct)
  };
}
// WHY: rumus tanggal deterministik via Date.UTC (pola sama seperti isOffHour) - benar di zona
// runtime mana pun. occupancyPct null/NaN = fail-safe tanpa diskon.
function dynDiscountMult(isOffPeakHour, dynEnabled, daysBefore, bookingDateStr, todayStr, occupancyPct, thresholdPct, extraPct) {
  var on = dynEnabled === true || dynEnabled === 1 || String(dynEnabled) === '1';
  if (!on || !isOffPeakHour) return 1;
  if (occupancyPct == null || !isFinite(occupancyPct)) return 1; // fail-safe: data okupansi belum ada
  if (Number(occupancyPct) >= Number(thresholdPct)) return 1;
  var bd = String(bookingDateStr).split('-');
  var td = String(todayStr).split('-');
  var diff = (Date.UTC(Number(bd[0]), Number(bd[1]) - 1, Number(bd[2])) - Date.UTC(Number(td[0]), Number(td[1]) - 1, Number(td[2]))) / 86400000;
  if (!isFinite(diff)) return 1; // fail-safe: format tanggal rusak
  var win = Number(daysBefore);
  if (!(win >= 0)) win = 1; // default jendela H-1
  if (diff < 0 || diff > win) return 1;
  var extra = Math.min(100, Math.max(0, Number(extraPct) || 0));
  return 1 - extra / 100;
}
// WHY: okupansi harian dari booking AKTIF di sheet - dedupe via key venue:jam agar
// double-count mustahil. Kapasitas = lapangan aktif x jam operasional.
function dayOccupancyPct(cfg, tanggal) {
  var courts = courtsList().filter(function (c) { return c.status === 'aktif'; });
  var cap = courts.length * (Number(cfg.jam_buka_selesai) - Number(cfg.jam_buka_mulai));
  if (!(cap > 0)) return null;
  var seen = {};
  activeBookings().forEach(function (b) {
    if (b.tanggal !== tanggal) return;
    hoursOf(b).forEach(function (h) { seen[b.venue_id + ':' + h] = 1; });
  });
  return Object.keys(seen).length / cap * 100;
}

// WHY voucher dihitung SERVER (audit P0-3): dulu voucher hanya ada di client - client menampilkan
// harga diskon sementara server menagih harga penuh (mode demo menyembunyikannya). Sekarang server
// memegang daftar voucher dan menjadi satu-satunya yang berhak menghitung potongan.
function courtsList() {
  // WHY: cache courts untuk reduce sheet reads
  if (typeof getCachedCourts === 'function') return getCachedCourts();
  return readSheet('Lapangan').filter(function (r) {
    return r.id && String(r.status || 'aktif').toLowerCase() === 'aktif';
  }).map(function (r) {
    return {
      id: String(r.id),
      nama: String(r.nama),
      olahraga: String(r.olahraga || 'Bulu Tangkis'),
      harga_per_jam: Number(r.harga_per_jam) || 45000,
      status: String(r.status || 'aktif')
    };
  });
}

// WHY dipisah (audit P0-2): dulu SATU fungsi mengembalikan SEMUA baris (termasuk yang
// dibatalkan) padahal komentarnya menjanjikan "status active saja". Akibatnya hasBookingClash()
// ikut menghitung booking yang sudah dibatalkan -> slot tidak pernah terbuka lagi, sementara
// peta slot yang dikirim ke UI (handleGetData) MENYARING status -> user melihat slot "kosong"
// lalu ditolak SLOT_TAKEN. Kini: perhitungan slot pakai activeBookings(), tampilan owner/riwayat
// pakai allBookings().
function allBookings() {
  return readSheet('Booking').map(function (r) {
    return {
      booking_id: String(r.booking_id),
      created_at: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at || ''),
      email: String(r.email || '').toLowerCase(),
      nama: String(r.nama || ''),
      venue_id: String(r.venue_id),
      tanggal: String(r.tanggal),
      jam_mulai: String(r.jam_mulai),
      durasi: Number(r.durasi) || 1,
      total_harga: Number(r.total_harga) || 0,
      payment_option: String(r.payment_option || 'full'),
      payment_status: String(r.payment_status || 'unpaid'),
      status: String(r.status || 'active')
    };
  });
}
// WHY: hanya booking AKTIF yang menempati slot. Satu filter di sini membuat semua pemanggil
// (hasBookingClash, allCourtsBooked, slot map) ikut benar tanpa perlu masing-masing mengingat.
function activeBookings() {
  // WHY: cache activeBookings untuk reduce sheet reads
  if (typeof getCachedActiveBookings === 'function') return getCachedActiveBookings();
  return allBookings().filter(function (b) { return b.status === 'active'; });
}

function hoursOf(b) {
  var h = parseInt(b.jam_mulai, 10);
  var out = [];
  for (var i = 0; i < b.durasi; i++) out.push(h + i);
  return out;
}

/* ============ EMAIL (P1 notifikasi) ============ */
// WHY: MailApp bawaan Apps Script, tanpa service eksternal. Kuota konsumen cukup untuk skala venue.
// Selalu try-catch: email yang gagal TIDAK BOLEH menggagalkan booking yang sudah tersimpan.
function bookingDetailText(b, courtName) {
  return b.booking_id + '\n' +
    'Lapangan: ' + courtName + '\n' +
    'Jadwal: ' + fmtTanggalId(b.tanggal) + ', ' + b.jam_mulai + ' (' + b.durasi + ' jam)\n' +
    'Total: Rp ' + Number(b.total_harga).toLocaleString('id-ID') + ' (' + (b.payment_option === 'dp' ? 'DP 50%, lunas di tempat' : 'bayar penuh') + ')';
}
function fmtTanggalId(iso) {
  var BULAN = ['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des'];
  var p = String(iso).split('-');
  return parseInt(p[2], 10) + ' ' + BULAN[parseInt(p[1], 10) - 1] + ' ' + p[0];
}
function sendBookingEmail(kind, b, user, courtName) {
  try {
    if (!user || !user.email) return; // WHY: walk-in tanpa email - jangan coba kirim (menghindari error log berisik)
    var cfg = readConfig();
    var detail = bookingDetailText(b, courtName);
    var urlApp = appUrl();
    var subj, bodyPenyewa;
    if (kind === 'created') {
      subj = 'Booking terkonfirmasi: ' + b.booking_id;
      bodyPenyewa = 'Halo ' + user.name + ',\n\nBooking kamu sudah terkonfirmasi. Tunjukkan kode berikut di resepsionis:\n\n' +
        detail + '\n\nLihat booking kamu: ' + urlApp + '#/booking\n\nSampai jumpa di lapangan!\n- LapanganKu';
    } else if (kind === 'rescheduled') {
      subj = 'Booking direschedule: ' + b.booking_id;
      bodyPenyewa = 'Halo ' + user.name + ',\n\nJadwal booking kamu sudah diubah:\n\n' +
        detail + '\n\nLihat booking kamu: ' + urlApp + '#/booking\n\n- LapanganKu';
    } else {
      subj = 'Booking dibatalkan: ' + b.booking_id;
      bodyPenyewa = 'Halo ' + user.name + ',\n\nBooking berikut sudah dibatalkan dan slotnya dibuka untuk orang lain:\n\n' + detail + '\n\n- LapanganKu';
    }
    MailApp.sendEmail(user.email, subj, bodyPenyewa, { name: 'LapanganKu' });
    // pemberitahuan owner (kolom owner_emails di Config)
    if (cfg.owner_emails && cfg.owner_emails.length) {
      var bodyOwner = (kind === 'created' ? 'Booking BARU oleh ' : 'Booking DIBATALKAN oleh ') + user.name + ' (' + user.email + '):\n\n' + detail;
      MailApp.sendEmail(cfg.owner_emails.join(','), subj + ' - ' + user.name, bodyOwner, { name: 'LapanganKu' });
    }
  } catch (ex) {
    logErrorSafe('email:' + kind, ex, user ? user.email : '');
  }
}

/* ============ WAITLIST (antre slot penuh) ============ */
// WHY: user bisa antre slot yang penuh; saat ada pembatalan, semua yang antre di slot itu di-email
// (posisi antre tidak dikunci - yang lebih dulu di-notify, lebih dulu kesempatan; sederhana & adil untuk skala venue).
// Duplikasi dicegah per email+tanggal+jam (durasi mempengaruhi notifikasi: yang antre 2 jam tak di-notify slot 1 jam).
function waitlistNotifyOnCancel(tanggal, venueId, jamMulai, durasi, user, courtName) {
  try {
    var rows = readSheet('Waitlist');
    var now = new Date();
    var today = Utilities.formatDate(now, TZ, 'yyyy-MM-dd');
    var hit = rows.filter(function (r) {
      return String(r.tanggal) === tanggal && parseInt(r.jam_mulai, 10) === parseInt(jamMulai, 10) &&
        String(r.status) === 'active' && r.durasi >= durasi &&
        String(r.email).toLowerCase() !== user.email;
      })
      .sort(function (a, b) { return a.created_at < b.created_at ? -1 : 1; });
    if (!hit.length) return;
    var jamAkhir = parseInt(jamMulai, 10) + durasi;
    var courtList = courtsList();
    var allFree = true;
    for (var h = parseInt(jamMulai, 10); h < jamAkhir; h++) {
      var stillTaken = courtList.some(function (c) {
        if (c.id === venueId) return false; // slot yang baru dibatalkan
        return hasBookingClash(c.id, tanggal, h, 1);
      });
      if (stillTaken) { allFree = false; break; }
    }
    var jamList = [];
    for (var j = parseInt(jamMulai, 10); j < jamAkhir; j++) jamList.push(pad(j) + '.00');
    var when = fmtTanggalId(tanggal) + ' pukul ' + jamList.join(' & ');
    hit.forEach(function (r, idx) {
      var posisi = idx + 1;
      var msg = 'Halo ' + r.nama + ',\n\nSlot yang kamu antre baru saja dibuka:\n\n' +
        'Lapangan: ' + courtName + '\nJadwal: ' + when + ' WIB\n\n' +
        (allFree ? 'Slot sudah penuh terbuka di semua lapangan. ' : 'Slot ini terbuka di ' + courtName + '. ') +
        'Antrean bersifat first come first served - segera booking sebelum diambil orang lain.\n\n' +
        'Posisi antrean kamu saat ini: ' + posisi + ' dari ' + hit.length + '\n' +
        'Booking sekarang: ' + appUrl() + '#/booking\n\n- LapanganKu';
      try { MailApp.sendEmail(r.email, 'Slot yang kamu antre baru saja dibuka', msg, { name: 'LapanganKu' }); } catch (ex) { logErrorSafe('waitlist-mail', ex, r.email); }
    });
  } catch (ex) { logErrorSafe('waitlist-notify', ex, user ? user.email : ''); }
}
function handleWaitlistJoin(body, user) {
  var cfg = readConfig();
  var tanggal = String(body.tanggal || '');
  var jamMulai = parseInt(body.jam_mulai, 10);
  var durasi = parseInt(body.durasi, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(tanggal)) throw new ValidationError('Tanggal tidak valid');
  if (isNaN(jamMulai) || isNaN(durasi) || durasi < 1 || durasi > cfg.max_hours_per_booking) throw new ValidationError('Durasi tidak valid');
  var now = new Date();
  var today = Utilities.formatDate(now, TZ, 'yyyy-MM-dd');
  if (tanggal < today) throw new ValidationError('Tidak bisa antre tanggal lampau');
  // WHY: lead time check untuk SEMUA tanggal (bukan hanya tanggal != today).
  // Slot hari ini yang sudah lewat batas waktu tidak bisa diantre.
  if (!leadTimeOk(tanggal, today, now, jamMulai, cfg)) throw new ValidationError('Slot ini sudah lewat batas booking');
  // WHY: slot dianggap penuh hanya jika SEMUA lapangan aktif bentrok di range jam ini;
  // hasBookingClash per-lapangan, jadi gunakan versi any-court (parity dengan slot class free di client).
  if (!allCourtsBooked(tanggal, jamMulai, durasi)) throw new ValidationError('Slot ini tidak penuh - langsung booking saja ya');
  var rows = readSheet('Waitlist');
  var dup = rows.some(function (r) {
    return String(r.email).toLowerCase() === user.email && String(r.tanggal) === tanggal &&
      parseInt(r.jam_mulai, 10) === jamMulai && String(r.status) === 'active';
  });
  if (dup) throw new ValidationError('Kamu sudah antre di slot ini');
  ss().getSheetByName('Waitlist').appendRow([user.email, user.name, tanggal, pad(jamMulai) + ':00', durasi, new Date(), 'active']);
  var posisi = rows.filter(function (r) {
    return String(r.tanggal) === tanggal && parseInt(r.jam_mulai, 10) === jamMulai && String(r.status) === 'active';
  }).length + 1;
  return { joined: true, position: posisi };
}
function handleWaitlistCancel(body, user) {
  var tanggal = String(body.tanggal || ''), jam = parseInt(body.jam_mulai, 10);
  var sh = ss().getSheetByName('Waitlist');
  var values = sh.getDataRange().getValues();
  var head = values[0].map(function (h) { return String(h).trim(); });
  var iE = head.indexOf('email'), iT = head.indexOf('tanggal'), iJ = head.indexOf('jam_mulai'), iS = head.indexOf('status');
  for (var i = 1; i < values.length; i++) {
    if (String(values[i][iE]).toLowerCase() !== user.email) continue;
    if (String(values[i][iT]) !== tanggal || parseInt(values[i][iJ], 10) !== jam) continue;
    if (String(values[i][iS]) !== 'active') continue;
    sh.getRange(i + 1, iS + 1).setValue('cancelled');
    return { cancelled: true };
  }
  return err('VALIDATION_ERROR', 'Antrean tidak ditemukan.');
}
function handleWaitlistMine(user) {
  return readSheet('Waitlist')
    .filter(function (r) { return String(r.email).toLowerCase() === user.email && String(r.status) === 'active'; })
    .map(function (r) { return { tanggal: String(r.tanggal), jam_mulai: String(r.jam_mulai), durasi: Number(r.durasi) || 1 }; });
}

/* ============ ADD-ON (produk tambahan saat booking) ============ */
// WHY: adopsi pola AYO "Produk Tambahan" - rental raket/shuttle sebagai item tambahan di checkout.
// PRINSIP HARGA: server menghitung total dari HARGA DI SHEET, bukan dari angka yang dikirim client.
// Client hanya mengirim {id, qty}; kalau client mengirim harga, itu diabaikan sepenuhnya.
function addOnsList() {
  return readSheet('AddOn').filter(function (r) {
    return r.id && String(r.status || 'aktif').toLowerCase() === 'aktif';
  }).map(function (r) {
    return {
      id: String(r.id),
      nama: String(r.nama || ''),
      harga: Number(r.harga) || 0,
      satuan: String(r.satuan || 'unit'),
      max_qty: Number(r.max_qty) || 5
    };
  });
}
// WHY: validasi & hitung add-on dari sisi server. Mengembalikan {items, total} - item yang
// tidak dikenal / nonaktif / qty tidak wajar DIBUANG diam-diam (bukan error) supaya booking
// tetap bisa lanjut walau ada item yang baru saja dinonaktifkan owner.
function resolveAddOns(raw, maxPerItem) {
  var catalog = addOnsList();
  var byId = {};
  catalog.forEach(function (a) { byId[a.id] = a; });
  var out = [], total = 0;
  var list = Array.isArray(raw) ? raw.slice(0, 10) : [];
  list.forEach(function (it) {
    if (!it || !it.id) return;
    var a = byId[String(it.id)];
    if (!a) return;
    var qty = parseInt(it.qty, 10);
    if (isNaN(qty) || qty < 1) return;
    var cap = Math.min(a.max_qty || 5, maxPerItem || 10);
    if (qty > cap) qty = cap;
    out.push({ id: a.id, nama: a.nama, harga: a.harga, qty: qty, subtotal: a.harga * qty });
    total += a.harga * qty;
  });
  return { items: out, total: total };
}

/* ============ REVIEW & RATING (adopsi pola AYO) ============ */
// WHY: AYO menampilkan "★ 4.80 · Kota Tomohon" di tiap kartu venue - sinyal kepercayaan terkuat
// sebelum orang memutuskan booking. LapanganKu sebelumnya tidak punya sama sekali.
// Aturan: ulasan hanya bisa ditulis penyewa yang BENAR-BENAR pernah main di lapangan itu
// (cegah ulasan palsu), dan email penyewa TIDAK PERNAH dikirim ke publik - hanya nama tersamar.

function readReviews() {
  return readSheet('Review').map(function (r) {
    return {
      review_id: String(r.review_id || ''),
      created_at: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at || ''),
      email: String(r.email || '').toLowerCase(),
      nama: String(r.nama || ''),
      venue_id: String(r.venue_id || ''),
      booking_id: String(r.booking_id || ''),
      rating: Number(r.rating) || 0,
      komentar: String(r.komentar || ''),
      status: String(r.status || 'active')
    };
  }).filter(function (r) { return r.status === 'active' && r.rating >= 1 && r.rating <= 5; });
}

// WHY: samarkan nama untuk tampilan publik - "Budi Santoso" -> "Budi S." (UU PDP: jangan
// mengekspos identitas lengkap penyewa di halaman publik).
function maskName(nama) {
  var parts = String(nama || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return 'Penyewa';
  if (parts.length === 1) return parts[0];
  return parts[0] + ' ' + parts[1].charAt(0).toUpperCase() + '.';
}

// WHY: agregat per lapangan - dipakai kartu lapangan (bintang) + JSON-LD AggregateRating (SEO).
function reviewSummary() {
  var raw = {};
  readReviews().forEach(function (r) {
    var s = raw[r.venue_id] = raw[r.venue_id] || { sum: 0, count: 0 };
    s.sum += r.rating; s.count++;
  });
  var out = {};
  Object.keys(raw).forEach(function (k) {
    out[k] = { avg: Math.round(raw[k].sum / raw[k].count * 10) / 10, count: raw[k].count };
  });
  return out;
}

// WHY: ulasan terbaru untuk landing - nama disamarkan, email TIDAK ikut.
function recentReviews(limit) {
  return readReviews()
    .sort(function (a, b) { return a.created_at < b.created_at ? 1 : -1; })
    .slice(0, limit || 6)
    .map(function (r) {
      return {
        nama: maskName(r.nama), venue_id: r.venue_id, rating: r.rating,
        komentar: r.komentar.slice(0, 300), tanggal: String(r.created_at).slice(0, 10)
      };
    });
}

// WHY diperketat (audit P2-9): dulu hanya `tanggal < today`, sedangkan client isPastBooking()
// juga menghitung booking hari ini yang JAM-nya sudah selesai. Akibatnya tombol "Beri ulasan"
// muncul di UI untuk booking yang selesai 2 jam lalu, lalu server menolak FORBIDDEN.
// Kini paritas: tanggal lampau ATAU (hari ini DAN jam akhir sudah lewat).
function reviewableBookings(email) {
  var now = new Date();
  var today = Utilities.formatDate(now, TZ, 'yyyy-MM-dd');
  var nowMin = Number(Utilities.formatDate(now, TZ, 'H')) * 60 + Number(Utilities.formatDate(now, TZ, 'm'));
  return readSheet('Booking').filter(function (r) {
    if (String(r.email || '').toLowerCase() !== email) return false;
    if (String(r.status) !== 'active') return false;
    var tgl = String(r.tanggal);
    if (tgl < today) return true;
    if (tgl > today) return false;
    return (parseInt(r.jam_mulai, 10) + (Number(r.durasi) || 1)) * 60 <= nowMin;
  }).map(function (r) {
    return { booking_id: String(r.booking_id), venue_id: String(r.venue_id), tanggal: String(r.tanggal), nama: String(r.nama || '') };
  });
}

function handleSubmitReview(body, user) {
  var rating = parseInt(body.rating, 10);
  var komentar = sanitizeText(body.komentar, 500);
  var bookingId = sanitizeText(body.booking_id, 40);
  if (isNaN(rating) || rating < 1 || rating > 5) return err('VALIDATION_ERROR', 'Rating harus 1 sampai 5.');
  // WHY komentar TIDAK wajib: keputusan produk - rating saja sudah cukup, supaya orang tidak
  // malas mengisi. (Percobaan menjadikannya wajib di audit 360 dibatalkan: bertentangan dengan
  // keputusan itu dan menutup jalur ulasan cepat.)
  // WHY: ulasan WAJIB terikat booking nyata milik user - cegah spam & ulasan palsu.
  var mine = reviewableBookings(user.email).filter(function (b) { return b.booking_id === bookingId; })[0];
  if (!mine) return err('FORBIDDEN', 'Kamu hanya bisa mengulas booking milikmu yang sudah selesai.');
  if (readReviews().some(function (r) { return r.booking_id === bookingId; })) {
    return err('VALIDATION_ERROR', 'Booking ini sudah kamu ulas.');
  }
  // WHY: rate limit ringan per akun (maks 5 ulasan/hari) - endpoint publik, cegah banjir sheet.
  var cache = CacheService.getScriptCache();
  var rk = 'rev:' + user.email;
  var n = Number(cache.get(rk) || 0);
  if (n >= 5) return err('RATE_LIMIT', 'Terlalu banyak ulasan hari ini. Coba lagi besok.');
  cache.put(rk, String(n + 1), 21600); // WHY (Batch A): CacheService maks 21600 dtk (6 jam); 86400 melebihi batas.
  var id = 'RV-' + Date.now().toString(36).toUpperCase() + '-' + randCode();
  ss().getSheetByName('Review').appendRow([id, new Date(), user.email, neutralizeFormula(user.name), mine.venue_id, bookingId, rating, neutralizeFormula(komentar), 'active']);
  logStructured('info', 'review_submitted', { venue: mine.venue_id, rating: rating });
  return { review_id: id, venue_id: mine.venue_id, rating: rating, komentar: komentar };
}
// WHY: daftar booking yang bisa diulas + ulasan yang sudah ada - untuk form di "Booking Saya".
function handleMyReviewable(user) {
  var done = readReviews().filter(function (r) { return r.email === user.email; }).map(function (r) { return r.booking_id; });
  return {
    reviewable: reviewableBookings(user.email).filter(function (b) { return done.indexOf(b.booking_id) === -1; }),
    reviewed: done
  };
}

/* ============ getPublicData (pengganti GViz) ============ */
// WHY VULN-001: dulu client membaca sheet lewat GViz, yang mewajibkan spreadsheet di-share
// "Anyone with the link". Akibatnya endpoint /gviz/tq bisa membaca sheet Booking & Waitlist juga -
// seluruh PII pelanggan (nama, email, jadwal) bocor ke siapa pun yang tahu SHEET_ID (tertanam di HTML).
// Sekarang data venue dibaca server-side, dan HANYA whitelist field non-sensitif yang dikirim.
// owner_emails SENGAJA tidak dikirim (lihat handleGetData).
function handleGetPublicData() {
  var cfg = readConfig();
  // WHY: rating & ulasan ikut di sini karena landing page membutuhkannya SEBELUM login.
  // Yang dikirim hanya agregat + ulasan dengan nama tersamar - email penyewa tidak pernah keluar.
  return {
    courts: courtsList(),
    addOns: addOnsList(),
    reviews: recentReviews(6),
    ratings: reviewSummary(),
    config: {
      jam_buka_mulai: cfg.jam_buka_mulai,
      jam_buka_selesai: cfg.jam_buka_selesai,
      slot_minutes: cfg.slot_minutes,
      max_advance_days: cfg.max_advance_days,
      cancel_cutoff_hours: cfg.cancel_cutoff_hours,
      booking_lead_hours: cfg.booking_lead_hours,
      max_hours_per_booking: cfg.max_hours_per_booking,
      harga_default: cfg.harga_default,
      peak_hours: cfg.peak_hours,
      peak_days: cfg.peak_days,
      peak_multiplier: cfg.peak_multiplier,
      // WHY: off-peak ikut dikirim agar client bisa menampilkan harga diskon di slot & ringkasan
      off_hours: cfg.off_hours,
      off_days: cfg.off_days,
      off_multiplier: cfg.off_multiplier,
      // WHY (FITUR 4, spek 2026-10-10): harga dinamis - client perlu konsisten dengan server.
      // Default dari readConfig; `!= null` menjaga sheet lama tetap mendapat default (bukan undefined).
      dyn_enabled: cfg.dyn_enabled != null ? cfg.dyn_enabled : '0',
      dyn_threshold: cfg.dyn_threshold != null ? cfg.dyn_threshold : 30,
      dyn_days_before: cfg.dyn_days_before != null ? cfg.dyn_days_before : 1,
      dyn_extra_pct: cfg.dyn_extra_pct != null ? cfg.dyn_extra_pct : 10,
      // WHY (Midtrans): client key BOLEH ke publik (dipakai di Snap.js); server key TIDAK PERNAH.
      midtrans_client_key: cfg.midtrans_client_key || '',
      midtrans_sandbox: Number(cfg.midtrans_sandbox) !== 0 ? 1 : 0
    }
  };
}

/* ============ getData ============ */
// Penyewa: butuh slots untuk tanggal tertentu (tanpa PII).
// Owner: dapat semua booking (untuk monitoring + CRM).
// WHY (C3 fix): versi publik untuk akses anonim - hanya slot satu tanggal, tanpa PII.
function handleGetPublicSlots(body) {
  var d = String((body && body.date) || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return { slots: {} };
  var map = {};
  courtsList().forEach(function (c) { map[c.id] = []; });
  activeBookings().filter(function (b) { return b.tanggal === d; }).forEach(function (b) {
    if (!map[b.venue_id]) map[b.venue_id] = [];
    hoursOf(b).forEach(function (h) { map[b.venue_id].push(h); });
  });
  return { slots: map };
}
function handleGetData(body, user) {
  var cfg = readConfig();
  var owner = isOwner(user);
  // WHY VULN-001: owner_emails tidak lagi dikirim lewat jalur publik (GViz dihapus).
  // Owner yang sudah terverifikasi tetap butuh daftarnya untuk gating UI (nav Monitoring + shortcut M).
  var data = { ownerAccess: owner, slots: {}, bookings: [], ownerEmails: owner ? cfg.owner_emails : [] };
  var dates = [];
  if (body.date) dates.push(String(body.date));
  // WHY: hardening - range divalidasi (array tanggal, maks 31 entri, format ISO) sebelum dipakai membaca slot
  if (owner && Array.isArray(body.range)) dates = body.range.map(String).slice(0, 31).filter(function (d) { return /^\d{4}-\d{2}-\d{2}$/.test(d); });
  if (!dates.length && owner) {
    // WHY allBookings (bukan activeBookings) - audit P0-2: owner WAJIB menerima baris yang
    // dibatalkan, kalau tidak tabel Bookings kehilangan status "Dibatalkan" dan cancel rate
    // di dashboard selalu 0%. Slot per-tanggal di bawah tetap memakai status aktif.
    data.bookings = allBookings();
    return data;
  }
  var bookings = activeBookings();
  var courts = courtsList();
  dates.forEach(function (d) {
    var map = {};
    courts.forEach(function (c) { map[c.id] = []; });
    bookings.filter(function (b) { return b.tanggal === d; }).forEach(function (b) {
      if (!map[b.venue_id]) map[b.venue_id] = [];
      hoursOf(b).forEach(function (h) { map[b.venue_id].push(h); });
    });
    data.slots[d] = map;
  });
  if (owner) data.bookings = allBookings();
  return data;
}

/* ============ createBooking ============ */
// WHY: validasi dipisah dari transaksi lock agar fungsi tetap <=50 baris (Rule 12.1)
function validateBookingRequest(body, cfg, courts) {
  var court = courts.filter(function (c) { return c.id === sanitizeText(body.venue_id, 20); })[0];
  if (!court) throw new ValidationError('Lapangan tidak ditemukan atau tidak aktif. Pilih lapangan lain.');

  var tanggal = sanitizeText(body.tanggal, 10);
  var jamMulai = parseInt(body.jam_mulai, 10);
  var durasi = parseInt(body.durasi, 10);
  var opt = body.payment_option === 'dp' ? 'dp' : 'full';
  if (!isValidYmd(tanggal)) throw new ValidationError('Format tanggal tidak valid. Gunakan YYYY-MM-DD.');
  if (isNaN(jamMulai) || isNaN(durasi) || durasi < 1) throw new ValidationError('Jam atau durasi tidak valid. Periksa kembali pilihanmu.');

  var now = new Date();
  var today = Utilities.formatDate(now, TZ, 'yyyy-MM-dd');
  var maxDate = Utilities.formatDate(new Date(now.getTime() + cfg.max_advance_days * 864e5), TZ, 'yyyy-MM-dd');
  if (tanggal < today) throw new ValidationError('Tidak bisa booking tanggal lampau. Pilih tanggal hari ini atau setelahnya.');
  if (tanggal > maxDate) throw new ValidationError('Maksimal booking ' + cfg.max_advance_days + ' hari ke depan. Pilih tanggal lebih dekat.');
  if (durasi > cfg.max_hours_per_booking) throw new ValidationError('Maksimal ' + cfg.max_hours_per_booking + ' jam per booking. Kurangi durasi.');
  if (jamMulai < cfg.jam_buka_mulai || jamMulai + durasi > cfg.jam_buka_selesai) {
    throw new ValidationError('Jam di luar jam operasional ' + pad(cfg.jam_buka_mulai) + ':00 - ' + pad(cfg.jam_buka_selesai) + ':00 WIB. Pilih jam lain.');
  }
  return { court: court, tanggal: tanggal, jamMulai: jamMulai, durasi: durasi, opt: opt, now: now, today: today };
}
// WHY Number() eksplisit (audit P0-4): pemanggil reschedule dulu mengirim jam sebagai STRING
// ("14:00") sehingga jamMulai * 60 = NaN dan SEMUA perbandingan jadi false -> bentrok tak pernah
// terdeteksi -> double-booking bisa lolos. Koersi di sini menutup kelas bug itu untuk semua pemanggil.
// WHY parseInt (bukan Number): parseInt("14:00") = 14 sehingga bentuk "HH:00" yang dikirim client
// tetap benar; Number("14:00") = NaN yang hanya bisa dijawab dengan fail-closed (menolak semua).
// WHY excludeId (audit P0-4): reschedule harus mengabaikan booking yang sedang dipindah itu sendiri,
// kalau tidak, memindah 14:00 -> 15:00 (durasi 2 jam) selalu ditolak CLASH oleh dirinya sendiri.
function hasBookingClash(courtId, tanggal, jamMulai, durasi, excludeId) {
  var startMin = parseInt(String(jamMulai), 10) * 60, endMin = (parseInt(String(jamMulai), 10) + parseInt(String(durasi), 10)) * 60;
  if (isNaN(startMin) || isNaN(endMin)) return true; // WHY fail-closed: input benar-benar tak valid = anggap bentrok, jangan izinkan tulis
  return activeBookings().some(function (b) {
    if (b.venue_id !== courtId || b.tanggal !== tanggal) return false;
    if (excludeId && b.booking_id === excludeId) return false;
    var s = parseInt(b.jam_mulai, 10) * 60, e = (parseInt(b.jam_mulai, 10) + b.durasi) * 60;
    return startMin < e && s < endMin;
  });
}
// WHY: waitlist butuh cek "penuh di semua lapangan" - satu-satunya kasus any-court, dipisah agar hasBookingClash tetap murni per-lapangan.
function allCourtsBooked(tanggal, jamMulai, durasi) {
  var courts = courtsList();
  return courts.length > 0 && courts.every(function (c) { return hasBookingClash(c.id, tanggal, jamMulai, durasi); });
}
function leadTimeOk(tanggal, today, now, jamMulai, cfg) {
  // WHY: lead time minimal N jam sebelum slot (H-2 sesuai PRD)
  if (tanggal !== today) return true;
  // WHY: jam WIB eksplisit - getHours() membaca TZ runtime.
  // Paritas dengan TZ app (TZ var) dan klien (nowMin pakai Intl Asia/Jakarta).
  var nowMin = Number(Utilities.formatDate(now, TZ, 'H')) * 60
             + Number(Utilities.formatDate(now, TZ, 'm'));
  return (jamMulai * 60) - nowMin >= (cfg.booking_lead_hours || 0) * 60;
}
function handleCreateBooking(body, user) {
  var cfg = readConfig();
  var req = validateBookingRequest(body, cfg, courtsList());

  // WHY: LockService menjamin "siapa cepat dia dapat" - cek+tulis atomik.
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) throw new Error('Sedang ramai, coba lagi beberapa detik');
  try {
    if (hasBookingClash(req.court.id, req.tanggal, req.jamMulai, req.durasi)) return errSlotTaken();
    if (!leadTimeOk(req.tanggal, req.today, req.now, req.jamMulai, cfg)) {
      return err('SLOT_TAKEN', 'Slot ini sudah lewat batas booking (minimal ' + cfg.booking_lead_hours + ' jam sebelum jam main).');
    }

    var bookingId = 'LK-' + req.tanggal.replace(/-/g, '') + '-' + randCode();
    // WHY (FITUR 4): okupansi dihitung dari sheet SEKALI per booking (sebelum tulis) untuk diskon dinamis.
    var occ = dayOccupancyPct(cfg, req.tanggal);
    var total = bookingTotal(cfg, req.court, req.tanggal, req.jamMulai, req.durasi, occ, req.today); // WHY: harga peak dihitung server, bukan client
    // WHY: add-on dihitung server dari harga di sheet AddOn; client hanya kirim {id, qty}.
    // Harga yang dikirim client diabaikan total - cegah manipulasi harga.
    var addons = resolveAddOns(body.addons, 10);
    // WHY (2026-10-11): sistem voucher DIHAPUS total atas keputusan Mas.
    var subtotal = total + addons.total;
    var grandTotal = subtotal;
    // WHY (Midtrans): booking dibuat dengan status 'unpaid'; webhook Midtrans yang mengubah
    // jadi 'paid'/'dp' setelah pembayaran terverifikasi. Frontend sudah render 'Belum Bayar'
    // untuk status selain paid/dp.
    var statusBayar = 'unpaid';
    var bk = {
      booking_id: bookingId, email: user.email, nama: user.name, venue_id: req.court.id,
      tanggal: req.tanggal, jam_mulai: pad(req.jamMulai) + ':00', durasi: req.durasi,
      total_harga: grandTotal, harga_lapangan: total, addons: addons.items, addon_total: addons.total,
      voucher: '', voucher_discount: 0,
      payment_option: req.opt, payment_status: statusBayar, status: 'active'
    };
    appendBookingRow(bk);
    sendBookingEmail('created', bk, user, req.court.nama); // WHY: di luar lock, gagal email tak menggagalkan booking
    sendWebhook('booking.created', bk);
    return bk;
  } finally {
    lock.releaseLock();
  }
}
// WHY satu jalur tulis (audit P2-10): createBooking menulis 16 kolom, ownerCreateBooking 12 -
// dua bentuk baris di sheet yang sama. readSheet memetakan header->nilai sehingga kolom 13-16
// jadi undefined untuk walk-in, dan setiap konsumen baru harus menangani dua bentuk.
// Satu fungsi = satu bentuk. Kolom yang tidak relevan diisi nilai netral, bukan dibiarkan kosong.
function appendBookingRow(bk) {
  ss().getSheetByName('Booking').appendRow([
    bk.booking_id, new Date(), bk.email, neutralizeFormula(bk.nama), bk.venue_id, bk.tanggal,
    bk.jam_mulai, bk.durasi, bk.total_harga, bk.payment_option, bk.payment_status, bk.status,
    bk.addon_total || 0, JSON.stringify(bk.addons || []),
    bk.voucher || '', bk.voucher_discount || 0, bk.midtrans_order_id || '',
    bk.recurring_id || '', bk.recurring_index || '', bk.recurring_total || ''
  ]);
}
function errSlotTaken() { return err('SLOT_TAKEN', 'Slot baru saja diambil orang lain. Pilih jam atau lapangan lain ya.'); }
function pad(n) { return (n < 10 ? '0' : '') + n; }
function randCode() {
  var c = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789', r = '';
  for (var i = 0; i < 4; i++) r += c[Math.floor(Math.random() * c.length)];
  return r;
}

/* ============ cancelBooking ============ */
// WHY lock (audit P1-2): cancel adalah read-modify-write pada baris sheet. Tanpa LockService,
// dua permintaan bersamaan (double-tap, dua tab) bisa saling menimpa - pola yang sama sudah
// dipakai handleCreateBooking. Isi transaksi dipisah agar fungsi tetap <=50 baris (Rule 12.1).
// WHY helper bersama (audit Rule 12.1): cancel & reschedule sama-sama melakukan "cari baris
// milik user ini, pastikan aktif". Dulu pola ini diduplikasi di dua handler - satu tempat untuk
// memperbaiki otorisasi/cutoff. Mengembalikan {row, values, head, error} - pemanggil memeriksa
// .error lebih dulu. Paritas jam WIB: Date.UTC + offset -7 (deterministik di TZ runtime mana pun).
function findOwnedActiveRow(id, user, cfg) {
  var sh = ss().getSheetByName('Booking');
  var values = sh.getDataRange().getValues();
  var head = values[0].map(function (h) { return String(h).trim(); });
  var iId = head.indexOf('booking_id'), iEmail = head.indexOf('email'), iStatus = head.indexOf('status');
  for (var i = 1; i < values.length; i++) {
    if (String(values[i][iId]) !== id) continue;
    if (String(values[i][iEmail]).toLowerCase() !== user.email) {
      return { error: err('FORBIDDEN', 'Kamu hanya bisa mengubah booking milikmu sendiri.') };
    }
    if (String(values[i][iStatus]) !== 'active') {
      return { error: err('VALIDATION_ERROR', 'Booking ini sudah tidak aktif.') };
    }
    return { sh: sh, values: values, head: head, row: i, iId: iId, iEmail: iEmail, iStatus: iStatus,
      iTanggal: head.indexOf('tanggal'), iJam: head.indexOf('jam_mulai'), iVenue: head.indexOf('venue_id'), iDurasi: head.indexOf('durasi') };
  }
  return { error: err('VALIDATION_ERROR', 'Booking tidak ditemukan.') };
}
// WHY dipisah: cutoff cancel & reschedule memakai rumus identik (jam mulai WIB vs sekarang).
function hoursUntilStart(tanggal, jam) {
  var p = String(tanggal).split('-');
  var start = Date.UTC(Number(p[0]), Number(p[1]) - 1, Number(p[2]), Number(jam) - 7, 0);
  return (start - Date.now()) / 36e5;
}
function cancelBookingTx(id, user) {
  var cfg = readConfig();
  var f = findOwnedActiveRow(id, user, cfg);
  if (f.error) return f.error;
  var tgl = String(f.values[f.row][f.iTanggal]);
  var jam = parseInt(f.values[f.row][f.iJam], 10);
  if (hoursUntilStart(tgl, jam) < (cfg.cancel_cutoff_hours || 2)) {
    return err('CUTOFF_PASSED', 'Batas pembatalan (' + cfg.cancel_cutoff_hours + ' jam sebelum jadwal) sudah lewat.');
  }
  f.sh.getRange(f.row + 1, f.iStatus + 1).setValue('cancelled');
  var v = f.values[f.row], h = f.head;
  var batal = { booking_id: id, venue_id: String(v[h.indexOf('venue_id')]), tanggal: tgl,
    jam_mulai: pad(jam) + ':00', durasi: Number(v[h.indexOf('durasi')]) || 1,
    total_harga: Number(v[h.indexOf('total_harga')]) || 0, payment_option: String(v[h.indexOf('payment_option')]) };
  return { booking_id: id, status: 'cancelled', _batal: batal };
}
function handleCancelBooking(body, user) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) throw new Error('Sedang ramai, coba lagi beberapa detik');
  var res;
  try {
    res = cancelBookingTx(String(body.booking_id || ''), user);
  } finally { lock.releaseLock(); }
  // WHY di luar lock: email + notifikasi antrean bisa lambat (MailApp) - jangan tahan lock.
  // WHY (Batch A): guard lama 'res.ok' selalu falsy karena tx tidak pernah set ok:true
  // (err() set ok:false, sukses tidak set ok) -> email/notifikasi/webhook cancel MATI total.
  if (res && !res.error && res._batal) {
    var batal = res._batal;
    var court = courtsList().filter(function (c) { return c.id === batal.venue_id; })[0];
    delete res._batal;
    sendBookingEmail('cancelled', batal, user, court ? court.nama : batal.venue_id);
    waitlistNotifyOnCancel(batal.tanggal, batal.venue_id, parseInt(batal.jam_mulai, 10), batal.durasi, user, court ? court.nama : batal.venue_id);
    sendWebhook('booking.cancelled', batal);
  }
  return res;
}

/* ============ rescheduleBooking ============ */
// WHY lock (audit P1-2): reschedule juga read-modify-write; cek-clash + tulis harus atomik,
// kalau tidak dua reschedule bersamaan bisa mendarat di slot yang sama.
function rescheduleBookingTx(id, newDate, newHour, user) {
  var cfg = readConfig();
  var f = findOwnedActiveRow(id, user, cfg);
  if (f.error) return f.error;
  var oldTgl = String(f.values[f.row][f.iTanggal]);
  var oldJam = parseInt(f.values[f.row][f.iJam], 10);
  if (hoursUntilStart(oldTgl, oldJam) < (cfg.cancel_cutoff_hours || 2)) {
    return err('CUTOFF_PASSED', 'Batas reschedule (' + cfg.cancel_cutoff_hours + ' jam sebelum jadwal) sudah lewat.');
  }
  var venueId = String(f.values[f.row][f.iVenue]);
  var durasi = Number(f.values[f.row][f.iDurasi]) || 1;
  var newJam = parseInt(newHour, 10);
  var np = newDate.split('-');
  var newStart = Date.UTC(Number(np[0]), Number(np[1]) - 1, Number(np[2]), newJam - 7, 0);
  if (newStart < Date.now() + (cfg.booking_lead_hours || 2) * 36e5) {
    return err('VALIDATION_ERROR', 'Jam baru terlalu dekat. Minimal ' + (cfg.booking_lead_hours || 2) + ' jam dari sekarang.');
  }
  var maxAdvance = cfg.max_advance_days || 14;
  if (newStart > Date.now() + maxAdvance * 864e5) {
    return err('VALIDATION_ERROR', 'Tanggal terlalu jauh. Maksimal ' + maxAdvance + ' hari dari sekarang.');
  }
  // WHY (P1-2): validasi jam operasional — tanpa ini, reschedule via API langsung bisa
  // mendarat di jam 03:00 (tak ada clash di jam 3 pagi = lolos). Pola sama dengan
  // validateBookingRequest baris 1440.
  var jamMulai = Number(cfg.jam_buka_mulai) || 6, jamSelesai = Number(cfg.jam_buka_selesai) || 22;
  if (newJam < jamMulai || newJam + durasi > jamSelesai) {
    return err('VALIDATION_ERROR', 'Jam di luar jam operasional ' + pad(jamMulai) + ':00 - ' + pad(jamSelesai) + ':00 WIB. Pilih jam lain.');
  }
  // WHY newJam (angka) + excludeId (audit P0-4): newHour adalah STRING dari client ("14:00")
  // sehingga perbandingan jam jadi NaN = clash tak pernah terdeteksi; dan tanpa excludeId,
  // booking ini selalu bentrok dengan dirinya sendiri.
  if (hasBookingClash(venueId, newDate, newJam, durasi, id)) {
    return err('CLASH', 'Slot baru sudah dipesan. Pilih jam lain.');
  }
  f.sh.getRange(f.row + 1, f.iTanggal + 1).setValue(newDate);
  f.sh.getRange(f.row + 1, f.iJam + 1).setValue(pad(newJam) + ':00');
  var v = f.values[f.row], h = f.head;
  return { booking_id: id, venue_id: venueId, tanggal: newDate,
    jam_mulai: pad(newJam) + ':00', durasi: durasi, total_harga: Number(v[h.indexOf('total_harga')]) || 0,
    payment_option: String(v[h.indexOf('payment_option')]) };
}
function handleRescheduleBooking(body, user) {
  var id = String(body.booking_id || '');
  var newDate = String(body.new_date || '');
  var newHour = String(body.new_hour || '');
  if (!id || !newDate || !newHour) return err('VALIDATION_ERROR', 'Data tidak lengkap.');
  // WHY (Batch A): tanpa validasi format, newDate='xx' -> Date.UTC(NaN) -> semua perbandingan
  // NaN=false -> cek lead-time/max-advance lolos vakum dan tanggal sampah tertulis ke sheet.
  if (!isValidYmd(newDate)) return err('VALIDATION_ERROR', 'Format tanggal tidak valid. Gunakan YYYY-MM-DD.');
  if (isNaN(parseInt(newHour, 10))) return err('VALIDATION_ERROR', 'Format jam tidak valid.');
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) throw new Error('Sedang ramai, coba lagi beberapa detik');
  var res;
  try {
    res = rescheduleBookingTx(id, newDate, newHour, user);
  } finally { lock.releaseLock(); }
  if (res && !res.error) {
    var court = courtsList().filter(function (c) { return c.id === res.venue_id; })[0];
    sendBookingEmail('rescheduled', res, user, court ? court.nama : res.venue_id);
  }
  return res;
}

/* ============ MIDTRANS (payment gateway) ============ */
// WHY: Server Key TIDAK PERNAH ke client. Semua hit ke Midtrans dari server-side (Apps Script).
// Webhook Midtrans memanggil doPost TANPA credential user - verifikasi signature_key adalah auth-nya.
function midtransBase(cfg) {
  return (Number(cfg.midtrans_sandbox) !== 0)
    ? 'https://app.sandbox.midtrans.com'
    : 'https://app.midtrans.com';
}
function midtransAuthHeader(cfg) {
  return 'Basic ' + Utilities.base64Encode(cfg.midtrans_server_key + ':');
}
function midtransSignature(orderId, statusCode, grossAmount, serverKey) {
  var raw = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_512,
    String(orderId) + String(statusCode) + String(grossAmount) + serverKey, Utilities.Charset.UTF_8);
  return raw.map(function (b) { return ((b & 0xFF) + 0x100).toString(16).slice(1); }).join('');
}
function midtransEnabled(cfg) {
  return !!(cfg.midtrans_server_key && cfg.midtrans_client_key);
}
function findBookingByOrderId(orderId) {
  var sh = ss().getSheetByName('Booking');
  var values = sh.getDataRange().getValues();
  var head = values[0].map(String);
  var iId = head.indexOf('booking_id'), iOrder = head.indexOf('midtrans_order_id');
  var iPay = head.indexOf('payment_status'), iStatus = head.indexOf('status');
  var iOpt = head.indexOf('payment_option');
  for (var i = 1; i < values.length; i++) {
    // WHY: midtrans_order_id bisa berisi histori koma-separated (lihat handleCreateSnapToken).
    var orders = String(values[i][iOrder] || '').split(',');
    if (orders.indexOf(String(orderId)) >= 0) {
      return { sh: sh, row: i, iPay: iPay, iStatus: iStatus,
        booking_id: String(values[i][iId]), payment_option: String(values[i][iOpt]) };
    }
  }
  return null;
}
function handleCreateSnapToken(body, user) {
  var cfg = readConfig();
  if (!midtransEnabled(cfg)) return err('PAYMENT_UNAVAILABLE', 'Pembayaran online belum dikonfigurasi. Hubungi venue.');
  var bookingId = String(body.booking_id || '');
  if (!bookingId) return err('VALIDATION_ERROR', 'booking_id wajib diisi.');
  var f = findOwnedActiveRow(bookingId, user, cfg);
  if (f.error) return f.error;
  var payIdx = f.head.indexOf('payment_status');
  var curPay = String(f.values[f.row][payIdx] || 'unpaid');
  if (curPay === 'paid' || curPay === 'dp') return err('VALIDATION_ERROR', 'Booking ini sudah dibayar.');
  var total = Number(f.values[f.row][f.head.indexOf('total_harga')]) || 0;
  var opt = String(f.values[f.row][f.head.indexOf('payment_option')] || 'full');
  var gross = opt === 'dp' ? Math.round(total / 2) : total;
  if (gross < 100) return err('VALIDATION_ERROR', 'Nominal terlalu kecil untuk pembayaran online.');
  // WHY order_id unik per percobaan: Midtrans menolak order_id duplikat untuk transaksi baru.
  // Format: LK-YYYYMMDD-XXXX-M<base36 timestamp> -> webhook memetakan balik via kolom midtrans_order_id.
  var orderId = bookingId + '-M' + Date.now().toString(36).toUpperCase();
  var payload = {
    transaction_details: { order_id: orderId, gross_amount: gross },
    customer_details: { first_name: String(user.name || 'Penyewa').slice(0, 50), email: user.email },
    item_details: [{ id: bookingId, name: ('Booking lapangan ' + bookingId).slice(0, 50), price: gross, quantity: 1 }],
    // WHY expiry 30 menit: booking unpaid memblokir slot (status active); tanpa batas,
    // slot mati sampai ada yang cancel manual. Expire -> webhook -> booking di-cancel -> slot bebas.
    expiry: { unit: 'minutes', duration: 30 }
  };
  var resp;
  try {
    resp = UrlFetchApp.fetch(midtransBase(cfg) + '/snap/v1/transactions', {
      method: 'post',
      headers: { 'Authorization': midtransAuthHeader(cfg), 'Content-Type': 'application/json', 'Accept': 'application/json' },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });
  } catch (e) {
    logErrorSafe('midtrans:snap', e, user.email);
    return err('SERVER_ERROR', 'Gagal menghubungi Midtrans. Coba lagi sebentar lagi.');
  }
  if (resp.getResponseCode() < 200 || resp.getResponseCode() >= 300) {
    logErrorSafe('midtrans:snap:' + resp.getResponseCode(), resp.getContentText(), user.email);
    return err('SERVER_ERROR', 'Midtrans menolak permintaan. Coba lagi sebentar lagi.');
  }
  var data;
  try { data = JSON.parse(resp.getContentText()); } catch (e) { return err('SERVER_ERROR', 'Respons Midtrans tidak valid.'); }
  if (!data.token) return err('SERVER_ERROR', 'Midtrans tidak mengembalikan token.');
  // WHY: order_id diakumulasi (koma-separated), bukan dioverwrite. User bisa membayar via
  // popup lama setelah meminta token baru - webhook harus tetap memetakan order_id lama.
  var iOrder = f.head.indexOf('midtrans_order_id');
  if (iOrder >= 0) {
    var prev = String(f.values[f.row][iOrder] || '');
    var list = prev ? prev.split(',') : [];
    if (list.indexOf(orderId) < 0) list.push(orderId);
    f.sh.getRange(f.row + 1, iOrder + 1).setValue(list.join(','));
  }
  return { token: data.token, redirect_url: data.redirect_url || '', order_id: orderId, gross_amount: gross };
}
function handleMidtransWebhook(n) {
  var cfg = readConfig();
  if (!midtransEnabled(cfg)) return { ignored: true };
  var orderId = String(n.order_id || ''), statusCode = String(n.status_code || '');
  var grossAmount = String(n.gross_amount || ''), sig = String(n.signature_key || '');
  if (!orderId || !sig) return { ignored: true };
  // WHY: signature adalah satu-satunya auth webhook (Midtrans tidak kirim credential user).
  var expect = midtransSignature(orderId, statusCode, grossAmount, cfg.midtrans_server_key);
  if (expect !== sig.toLowerCase()) {
    logErrorSafe('midtrans:webhook:badsig', 'order ' + orderId, '(midtrans)');
    return err('FORBIDDEN', 'Signature tidak valid.');
  }
  var found = findBookingByOrderId(orderId);
  if (!found) return { ignored: true, reason: 'order_id tidak dikenal' };
  var tstatus = String(n.transaction_status || '');
  var newPay = null, newStatus = null;
  if (tstatus === 'capture' || tstatus === 'settlement') {
    newPay = found.payment_option === 'dp' ? 'dp' : 'paid';
  } else if (tstatus === 'deny' || tstatus === 'cancel' || tstatus === 'expire') {
    newPay = 'failed';
    newStatus = 'cancelled'; // WHY: slot dibebaskan kembali untuk orang lain.
  }
  // 'pending' -> biarkan 'unpaid', user masih bisa bayar dalam 30 menit.
  if (newPay && found.iPay >= 0) found.sh.getRange(found.row + 1, found.iPay + 1).setValue(newPay);
  if (newStatus && found.iStatus >= 0) found.sh.getRange(found.row + 1, found.iStatus + 1).setValue(newStatus);
  logStructured('info', 'midtrans_webhook', { order: orderId, status: tstatus, pay: newPay });
  return { ok: true, booking_id: found.booking_id, payment_status: newPay };
}
/* ============ MIDTRANS SETTINGS (owner) ============ */
// WHY: tiap venue pakai akun Midtrans sendiri (dana tidak lewat kita). Owner input key
// dari dashboard Midtrans; server key disimpan di sheet Config (tidak pernah ke client).
function upsertConfig(key, value) {
  var sh = ss().getSheetByName('Config');
  var values = sh.getDataRange().getValues();
  for (var i = 1; i < values.length; i++) {
    if (String(values[i][0]).trim() === key) {
      sh.getRange(i + 1, 2).setValue(value);
      return;
    }
  }
  sh.appendRow([key, value]);
}
function handleGetMidtransSettings(body, user) {
  if (!isOwner(user)) return err('FORBIDDEN', 'Hanya owner venue.');
  var cfg = readConfig();
  return {
    sandbox: Number(cfg.midtrans_sandbox) !== 0 ? 1 : 0,
    // WHY: server key tidak pernah dikirim utuh - hanya status + 4 char terakhir untuk identifikasi.
    server_key_set: !!cfg.midtrans_server_key,
    server_key_hint: cfg.midtrans_server_key ? '****' + String(cfg.midtrans_server_key).slice(-4) : '',
    client_key: cfg.midtrans_client_key || ''
  };
}
function handleSaveMidtransSettings(body, user) {
  if (!isOwner(user)) return err('FORBIDDEN', 'Hanya owner venue.');
  var sandbox = body.sandbox === 0 || body.sandbox === '0' ? 0 : 1;
  var clientKey = sanitizeText(body.client_key, 100);
  var serverKey = sanitizeText(body.server_key, 100);
  // WHY: validasi format key Midtrans (SB- / Mid- prefix) untuk typo-catching dini.
  if (clientKey && !/^(SB-)?Mid-client-/.test(clientKey)) return err('VALIDATION_ERROR', 'Format Client Key tidak dikenal.');
  if (serverKey && !/^(SB-)?Mid-server-/.test(serverKey)) return err('VALIDATION_ERROR', 'Format Server Key tidak dikenal.');
  upsertConfig('midtrans_sandbox', sandbox);
  if (clientKey) upsertConfig('midtrans_client_key', clientKey);
  if (serverKey) upsertConfig('midtrans_server_key', serverKey);
  logStructured('info', 'midtrans_settings_saved', { sandbox: sandbox });
  return { ok: true, sandbox: sandbox };
}

/* ============ OWNER CRUD BOOKING (P2) ============ */
// WHY: owner mengelola dari web tanpa buka Sheet - ubah status bayar (kasir), batalkan atas nama penyewa
// (email tetap terkirim ke penyewa), atau catat booking walk-in. Semua endpoint wajib isOwner.
function findBookingRow(sh, id) {
  var values = sh.getDataRange().getValues();
  var head = values[0].map(function (h) { return String(h).trim(); });
  for (var i = 1; i < values.length; i++) {
    if (String(values[i][head.indexOf('booking_id')]) === id) return { row: i + 1, values: values[i], head: head };
  }
  return null;
}
function handleOwnerUpdateBooking(body, user) {
  if (!isOwner(user)) return err('FORBIDDEN', 'Hanya pemilik venue.');
  var payment = String(body.payment_status || '');
  var status = String(body.status || '');
  if (payment && ['paid', 'dp', 'unpaid'].indexOf(payment) === -1) return err('VALIDATION_ERROR', 'Status bayar tidak dikenal.');
  if (status && ['active', 'cancelled'].indexOf(status) === -1) return err('VALIDATION_ERROR', 'Status tidak dikenal.');
  if (!payment && !status) return err('VALIDATION_ERROR', 'Tidak ada perubahan.');
  var sh = ss().getSheetByName('Booking');
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) throw new Error('Sedang ramai, coba lagi beberapa detik');
  try {
    var found = findBookingRow(sh, String(body.booking_id || ''));
    if (!found) return err('VALIDATION_ERROR', 'Booking tidak ditemukan.');
    if (status === 'cancelled' && String(found.values[found.head.indexOf('status')]) !== 'active') {
      return err('VALIDATION_ERROR', 'Booking ini sudah tidak aktif.');
    }
    if (payment) sh.getRange(found.row, found.head.indexOf('payment_status') + 1).setValue(payment);
    if (status) sh.getRange(found.row, found.head.indexOf('status') + 1).setValue(status);
    if (status === 'cancelled') {
      var batal = {
        booking_id: String(body.booking_id), venue_id: String(found.values[found.head.indexOf('venue_id')]),
        tanggal: String(found.values[found.head.indexOf('tanggal')]),
        jam_mulai: String(found.values[found.head.indexOf('jam_mulai')]),
        durasi: Number(found.values[found.head.indexOf('durasi')]) || 1,
        total_harga: Number(found.values[found.head.indexOf('total_harga')]) || 0,
        payment_option: String(found.values[found.head.indexOf('payment_option')])
      };
      var court = courtsList().filter(function (c) { return c.id === batal.venue_id; })[0];
      var penyewa = { email: String(found.values[found.head.indexOf('email')]).toLowerCase(), name: String(found.values[found.head.indexOf('nama')]) };
      sendBookingEmail('cancelled', batal, penyewa, court ? court.nama : batal.venue_id); // WHY: email ke penyewa, bukan owner
      waitlistNotifyOnCancel(batal.tanggal, batal.venue_id, parseInt(batal.jam_mulai, 10), batal.durasi, penyewa, court ? court.nama : batal.venue_id);
    }
    return { booking_id: String(body.booking_id), payment_status: payment || undefined, status: status || undefined };
  } finally { lock.releaseLock(); }
}
function handleOwnerCreateBooking(body, user) {
  if (!isOwner(user)) return err('FORBIDDEN', 'Hanya pemilik venue.');
  var cfg = readConfig();
  var req = validateBookingRequest(body, cfg, courtsList());
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) throw new Error('Sedang ramai, coba lagi beberapa detik');
  try {
    if (hasBookingClash(req.court.id, req.tanggal, req.jamMulai, req.durasi)) return errSlotTaken();
    // WHY: walk-in tetap harus cek lead time — slot yang sudah lewat batas waktu tidak bisa dibooking.
    if (!leadTimeOk(req.tanggal, req.today, req.now, req.jamMulai, cfg)) {
      return err('SLOT_TAKEN', 'Slot ini sudah lewat batas booking (minimal ' + cfg.booking_lead_hours + ' jam sebelum jam main).');
    }
    var bookingId = 'LK-' + req.tanggal.replace(/-/g, '') + '-' + randCode();
    // WHY (FITUR 4): diskon dinamis berlaku juga untuk walk-in owner.
    var occ = dayOccupancyPct(cfg, req.tanggal);
    var total = bookingTotal(cfg, req.court, req.tanggal, req.jamMulai, req.durasi, occ, req.today);
    var opt = req.opt === 'dp' ? 'dp' : 'full';
    var pay = String(body.payment_status || 'paid');
    if (['paid', 'dp', 'unpaid'].indexOf(pay) === -1) pay = 'paid';
    var nama = sanitizeText(body.nama, 80) || 'Walk-in';
    var email = sanitizeText(body.email, 120).toLowerCase();
    if (!isValidEmail(email)) return err('VALIDATION_ERROR', 'Format email tidak valid.');
    var bk = {
      booking_id: bookingId, email: email, nama: nama, venue_id: req.court.id,
      tanggal: req.tanggal, jam_mulai: pad(req.jamMulai) + ':00', durasi: req.durasi,
      total_harga: total, addons: [], addon_total: 0, voucher: '', voucher_discount: 0,
      payment_option: opt, payment_status: pay, status: 'active'
    };
    appendBookingRow(bk);
    return bk;
  } finally { lock.releaseLock(); }
}

/* ============ LAPORAN BULANAN (P2) ============ */
// WHY: owner butuh rekap tanpa buka Sheet. Trigger bulanan (tanggal 1, 06.00) email ringkasan
// bulan sebelumnya: pendapatan (aktif), jumlah booking, okupansi, cancel rate, top court & top customer.
function setupMonthlyReportTrigger() {
  var existing = ScriptApp.getProjectTriggers().filter(function (t) { return t.getHandlerFunction() === 'monthlyReport'; });
  if (!existing.length) ScriptApp.newTrigger('monthlyReport').timeBased().onMonthDay(1).atHour(6).create();
}
function monthlyReport() {
  try {
    var cfg = readConfig();
    if (!cfg.owner_emails || !cfg.owner_emails.length) return;
    var now = new Date();
    var prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    var ym = Utilities.formatDate(prev, TZ, 'yyyy-MM');
    var label = Utilities.formatDate(prev, TZ, 'MMMM yyyy');
    var rep = buildMonthlyReport(ym);
    var lines = [
      'Laporan bulanan LapanganKu - ' + label, '',
      'Pendapatan (booking aktif): Rp ' + rep.revenue.toLocaleString('id-ID'),
      'Booking aktif: ' + rep.count + ' (dibatalkan: ' + rep.cancelled + ')',
      'Jam terjual: ' + rep.hours + ' dari ' + rep.capacity + ' slot jam (' + rep.util + '% okupansi)',
      'Lapangan terramai: ' + rep.topCourt, '', 'Pelanggan teratas:',
      rep.topCustomers.map(function (c, i) { return (i + 1) + '. ' + c.nama + ' (' + c.email + ') - ' + c.count + 'x, Rp ' + c.spend.toLocaleString('id-ID'); }).join('\n'), '',
      'Detail transaksi ada di spreadsheet LapanganKu.'
    ];
    MailApp.sendEmail(cfg.owner_emails.join(','), 'LapanganKu - Laporan ' + label, lines.join('\n'), { name: 'LapanganKu' });
  } catch (ex) {
    logErrorSafe('monthlyReport', ex, '');
  }
}
function handleMonthlyReportNow(body, user) {
  if (!isOwner(user)) return err('FORBIDDEN', 'Hanya pemilik venue.');
  var ym = String(body.ym || '');
  if (!/^\d{4}-\d{2}$/.test(ym)) return err('VALIDATION_ERROR', 'Format bulan tidak valid (yyyy-MM).');
  var cfg = readConfig();
  if (!cfg.owner_emails || !cfg.owner_emails.length) return err('VALIDATION_ERROR', 'Isi owner_emails di tab Config dulu.');
  var rep = buildMonthlyReport(ym);
  var label = Utilities.formatDate(new Date(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 1, 1), TZ, 'MMMM yyyy');
  var lines = [
    'Laporan LapanganKu - ' + label, '',
    'Pendapatan (booking aktif): Rp ' + rep.revenue.toLocaleString('id-ID'),
    'Booking aktif: ' + rep.count + ' (dibatalkan: ' + rep.cancelled + ')',
    'Jam terjual: ' + rep.hours + ' dari ' + rep.capacity + ' slot jam (' + rep.util + '% okupansi)',
    'Lapangan terramai: ' + rep.topCourt
  ];
  MailApp.sendEmail(cfg.owner_emails.join(','), 'LapanganKu - Laporan ' + label, lines.join('\n'), { name: 'LapanganKu' });
  return { sent: true, ym: ym };
}
function buildMonthlyReport(ym) {
  var cfg = readConfig(), courts = courtsList();
  var all = readSheet('Booking').filter(function (r) { return String(r.tanggal).indexOf(ym) === 0; });
  var act = all.filter(function (r) { return String(r.status) === 'active'; });
  var revenue = 0, hours = 0;
  var perCourt = {}, perCustomer = {};
  act.forEach(function (r) {
    var h = Number(r.durasi) || 1;
    revenue += Number(r.total_harga) || 0; hours += h;
    perCourt[r.venue_id] = (perCourt[r.venue_id] || 0) + h;
    var k = String(r.email || '').toLowerCase() || '(walk-in)';
    var c = perCustomer[k] = perCustomer[k] || { email: k, nama: String(r.nama || k), count: 0, spend: 0 };
    c.count++; c.spend += Number(r.total_harga) || 0;
  });
  var days = new Date(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0).getDate();
  var capacity = courts.length * (cfg.jam_buka_selesai - cfg.jam_buka_mulai) * days;
  var topCourtId = Object.keys(perCourt).sort(function (a, b) { return perCourt[b] - perCourt[a]; })[0];
  var topCourtObj = courts.filter(function (c) { return c.id === topCourtId; })[0];
  return {
    revenue: revenue, count: act.length, cancelled: all.length - act.length, hours: hours, capacity: capacity,
    util: capacity ? Math.round(hours / capacity * 100) : 0,
    topCourt: topCourtObj ? topCourtObj.nama : (topCourtId || '-'),
    topCustomers: Object.values(perCustomer).sort(function (a, b) { return b.spend - a.spend; }).slice(0, 5)
  };
}
function handleMyBookings(user) {
  var sh = ss().getSheetByName('Booking');
  var values = sh.getDataRange().getValues();
  if (values.length < 2) return [];
  var head = values[0].map(function (h) { return String(h).trim(); });
  var iEmail = head.indexOf('email');
  var iId = head.indexOf('booking_id'), iVenue = head.indexOf('venue_id'), iTgl = head.indexOf('tanggal');
  var iJam = head.indexOf('jam_mulai'), iDur = head.indexOf('durasi'), iTotal = head.indexOf('total_harga');
  var iOpt = head.indexOf('payment_option'), iPay = head.indexOf('payment_status'), iStatus = head.indexOf('status');
  var out = [];
  for (var i = 1; i < values.length; i++) {
    var r = values[i];
    if (String(r[iEmail] || '').toLowerCase() !== user.email) continue;
    out.push({
      booking_id: String(r[iId]), email: user.email,
      venue_id: String(r[iVenue]), tanggal: String(r[iTgl]), jam_mulai: String(r[iJam]),
      durasi: Number(r[iDur]) || 1, total_harga: Number(r[iTotal]) || 0,
      payment_option: String(r[iOpt] || 'full'), payment_status: String(r[iPay] || 'unpaid'),
      status: String(r[iStatus] || 'active')
    });
  }
  // Pagination: return all for now, but structure supports pagination
  return out;
}


/* ============ FASE 3: LONG TERM OPTIMIZATION ============ */


/* ============ SETUP (run sekali) ============ */
// WHY daftar tabel dipisah dari fungsi (audit Rule 12.1): setupSheets dulu 59 baris karena
// mendefinisikan semua header + seed row inline. Memisahkannya membuat struktur sheet terbaca
// sebagai DATA, dan setupSheets hanya berisi alur.
function sheetSpecs() {
  return [
    ['Lapangan', ['id', 'nama', 'olahraga', 'harga_per_jam', 'status'], [
      ['LK1', 'Lapangan 1', 'Bulu Tangkis', 45000, 'aktif'],
      ['LK2', 'Lapangan 2', 'Bulu Tangkis', 45000, 'aktif'],
      ['LK3', 'Lapangan 3', 'Bulu Tangkis', 45000, 'aktif'],
      ['LK4', 'Lapangan 4', 'Bulu Tangkis', 45000, 'aktif']
    ]],
    ['Booking', ['booking_id', 'created_at', 'email', 'nama', 'venue_id', 'tanggal', 'jam_mulai', 'durasi', 'total_harga', 'payment_option', 'payment_status', 'status', 'addon_total', 'addons', 'voucher', 'voucher_discount', 'midtrans_order_id', 'recurring_id', 'recurring_index', 'recurring_total'], []],
    ['Config', ['key', 'value'], [
      ['owner_emails', 'ganti-dengan-email-kamu@gmail.com'],
      ['google_client_id', ''],
      ['jam_buka_mulai', 6], ['jam_buka_selesai', 22], ['slot_minutes', 60],
      ['max_advance_days', 14], ['cancel_cutoff_hours', 2], ['booking_lead_hours', 2],
      ['max_hours_per_booking', 3], ['harga_default', 45000],
      ['peak_hours', '18,19,20'], ['peak_days', '1,2,3,4,5'], ['peak_multiplier', 1.5],
      // WHY: harga jam sepi (adopsi riset kompetitor). 0.8 = diskon 20% untuk jam yang biasanya kosong.
      ['off_hours', '6,7,8,21'], ['off_days', '1,2,3,4,5'], ['off_multiplier', 0.8],
      // WHY (2026-10-11): sistem voucher DIHAPUS total atas keputusan Mas.
      // WHY loyalty_rewards di Config (2026-10-11): katalog reward harus bisa diubah owner
      // tanpa edit kode. Format: ID:Nama:poin dipisah koma.
      ['loyalty_rewards', 'DRINK:Minuman segar:50,SNACK:Snack ringan:75,FREE1H:Gratis 1 jam lapangan:500'],
      // WHY (P1-3): domain per venue — isi saat onboarding venue baru agar origin check
      // dan link email mengikuti domain venue (koma-separated bila lebih dari satu).
      ['allowed_origins', 'https://lapanganku.web.id'],
      ['app_url', 'https://lapanganku.web.id/']
    ]],
    ['ErrorLog', ['waktu', 'source', 'email', 'message', 'stack'], []],
    // WHY sheet sendiri (audit P2-7): masukan pengguna dulu nyasar ke ErrorLog dengan PII di kolom stack.
    ['Feedback', ['waktu', 'email', 'nama', 'kontak', 'kategori', 'pesan'], []],
    ['Waitlist', ['email', 'nama', 'tanggal', 'jam_mulai', 'durasi', 'created_at', 'status'], []],
    // WHY: sheet Review untuk rating & ulasan lapangan (adopsi pola AYO). Terpisah dari Booking
    // supaya agregat rating bisa dibaca publik tanpa menyentuh PII di Booking.
    ['Review', ['review_id', 'created_at', 'email', 'nama', 'venue_id', 'booking_id', 'rating', 'komentar', 'status'], []],
    // WHY: AddOn = produk tambahan saat booking (rental raket, shuttle, air minum). Harga di sini
    // adalah SATU-SATUNYA sumber kebenaran - client tidak pernah mengirim harga.
    ['AddOn', ['id', 'nama', 'harga', 'satuan', 'max_qty', 'status'], [
      ['RAKET', 'Rental raket', 15000, 'unit', 4, 'aktif'],
      ['SHUTTLE', 'Shuttlecock (3 pcs)', 25000, 'set', 3, 'aktif'],
      ['AIR', 'Air mineral 600ml', 5000, 'botol', 6, 'aktif']
    ]],
    // WHY LoyaltyLedger append-only (2026-10-11): saldo = SUM(amount) per email, bukan kolom
    // saldo yang di-update. Append-only = audit trail natural + bebas race condition pada
    // concurrent writes. Kolom type: 'earn' | 'redeem'.
    ['LoyaltyLedger', ['ledger_id', 'email', 'date', 'type', 'amount', 'ref_id', 'reward_id', 'reward_name', 'created_at'], []],
    // WHY SplitBill (2026-10-11): patungan per booking. shares = JSON array.
    // Server adalah otoritas untuk transisi paid/closed - mencegah user menandai lunas sendiri.
    ['SplitBill', ['split_id', 'booking_id', 'email_owner', 'total', 'count', 'closed', 'shares', 'created_at', 'updated_at'], []],
    // WHY SkillRating + SkillMatch (2026-10-11): rating Elo dihitung server (K=32).
    // SkillMatch.booking_id UNIQUE = idempotency key, mencegah double-record.
    ['SkillRating', ['email', 'nama', 'rating', 'wins', 'losses', 'updated_at'], []],
    ['SkillMatch', ['match_id', 'booking_id', 'date', 'player_email', 'player_name', 'opp_email', 'opp_name', 'sets', 'winner', 'rating_before', 'rating_after', 'created_at'], []]
  ];
}
// WHY migrasi kolom (audit 360, lanjutan): ensureSheet dulu HANYA menulis header bila sheet
// kosong (getLastRow() === 0). Untuk spreadsheet yang sudah berisi data, menambah kolom baru
// (voucher, voucher_discount) membuat appendRow menulis 16 nilai ke sheet ber-header 14 ->
// nilai voucher mendarat di kolom TANPA header dan terbaca undefined saat dibaca ulang.
// Booking tetap jalan (diskon sudah masuk total_harga) tapi kode vouchernya hilang.
// Fungsi ini menambahkan HANYA header yang belum ada, di kanan - data lama tidak tersentuh.
function syncSheetHeaders(sh, headers) {
  var lastCol = Math.max(sh.getLastColumn(), 1);
  var existing = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) { return String(h).trim(); });
  var missing = headers.filter(function (h) { return existing.indexOf(h) === -1; });
  if (!missing.length) return 0;
  sh.getRange(1, lastCol + 1, 1, missing.length).setValues([missing]).setFontWeight('bold');
  return missing.length;
}
function ensureSheet(s, name, headers, rows) {
  var sh = s.getSheetByName(name);
  if (!sh) sh = s.insertSheet(name);
  if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
    if (rows && rows.length) sh.getRange(2, 1, rows.length, headers.length).setValues(rows);
    sh.setFrozenRows(1);
    return;
  }
  // sheet sudah ada isinya: hanya tambahkan kolom yang belum ada (idempoten, aman diulang)
  syncSheetHeaders(sh, headers);
}
function setupSheets() {
  var s = ss();
  sheetSpecs().forEach(function (spec) { ensureSheet(s, spec[0], spec[1], spec[2]); });
  // hapus sheet default jika masih kosong
  var def = s.getSheetByName('Sheet1');
  if (def && def.getLastRow() === 0) s.deleteSheet(def);
  setupBackupTrigger();
  setupMonthlyReportTrigger(); // WHY: laporan bulanan ikut aktif otomatis saat setup
  // WHY (2026-10-11): pakai ss() bukan getActive() - standalone script tidak punya active spreadsheet.
  try { ss().toast('Setup selesai! Isi owner_emails dan google_client_id di tab Config (lihat langkah SETUP.md).', 'LapanganKu', 10); } catch (e) {}
}

/* ============ BACKUP OTOMATIS (P2) ============ */
// WHY: seluruh data bisnis di satu spreadsheet; backup mingguan = salinan file baru di folder Drive,
// rotasi 12 minggu agar folder tidak menumpuk. Trigger di-install saat setupSheets.
function setupBackupTrigger() {
  var existing = ScriptApp.getProjectTriggers().filter(function (t) { return t.getHandlerFunction() === 'weeklyBackup'; });
  if (!existing.length) {
    ScriptApp.newTrigger('weeklyBackup').timeBased().onWeekDay(ScriptApp.WeekDay.SUNDAY).atHour(3).create();
  }
}
function weeklyBackup() {
  var name = 'LapanganKu-Backup-' + Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
  DriveApp.getFileById(ss().getId()).makeCopy(name);
  // rotasi: hapus backup tertua kalau sudah lebih dari 12
  var it = DriveApp.getFoldersByName('LapanganKu Backups');
  var folder = it.hasNext() ? it.next() : DriveApp.createFolder('LapanganKu Backups');
  var copies = folder.getFilesByName(name);
  while (copies.hasNext()) { var f = copies.next(); folder.addFile(f); DriveApp.getRootFolder().removeFile(f); }
  var files = [], en = folder.getFiles();
  while (en.hasNext()) files.push(en.next());
  files.sort(function (a, b) { return a.getDateCreated() < b.getDateCreated() ? -1 : 1; });
  while (files.length > 12) { files.shift().setTrashed(true); }
}

// WHY: Webhook untuk integrasi sistem eksternal (CRM, accounting, dll)
// Dipanggil setelah booking berhasil dibuat/dibatalkan/direschedule
function sendWebhook(event, data) {
  try {
    var cfg = readConfig();
    if (!cfg.webhook_url) return;
    var payload = {
      event: event,
      timestamp: new Date().toISOString(),
      data: data
    };
    UrlFetchApp.fetch(cfg.webhook_url, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });
  } catch (ex) {
    logErrorSafe('webhook:' + event, ex, '');
  }
}
