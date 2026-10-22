/* LAPANGANKU chunk booking: dimuat on-demand saat rute #/booking (lazy, bukan render-blocking).
   Split hasil audit Lighthouse rev 3x; fungsi tetap global (script klasik). */
/* ---------- booking view ---------- */
// WHY: renderLoginGate pindah ke app.js (core) rev 3z - dipakai juga chunk monitoring.
function renderBooking(el) {
  if (state.user) {
    loadMyBookings().then(() => renderBookingInner(el));
  } else {
    state.myBookings = [];
    renderBookingInner(el);
  }
}
async function loadMyBookings() {
  if (!state.user) return;
  try {
    if (state.data.demo) state.myBookings = DEMO_BOOKINGS.filter(b => b.email === state.user.email).concat(demoStore.mine());
    else state.myBookings = await withProgress(api('getMyBookings', {}));
    if (state.data.demo) state.waitlist = demoWaitlistStore.mine();
    else state.waitlist = await withProgress(api('waitlistMine', {}));
    // WHY: daftar booking yang sudah diulas - untuk menyembunyikan tombol "Beri ulasan" yang sudah dipakai.
    if (state.data.demo) state.reviewed = DEMO_REVIEWED;
    else { const rv = await withProgress(api('myReviewable', {})); state.reviewed = rv.reviewed || []; }
    // WHY (audit P2-2): bersihkan penanda error setelah pemuatan BERHASIL. Dulu loadError hanya
    // direset oleh tombol "Coba lagi", sehingga setelah satu kegagalan jaringan user bisa terus
    // melihat "Gagal memuat booking" padahal data sudah berhasil dimuat (mis. setelah cancel).
    state.loadError = null;
  } catch (e) {
    // WHY: jangan set myBookings = [] saat GAGAL memuat. Bedanya penting:
    // [] berarti "kamu memang belum pernah booking" (empty state), sedangkan gagal
    // berarti "kami tidak tahu" - menampilkan "Belum ada booking mendatang" saat
    // jaringan putus itu BOHONG dan bisa membuat user mengira booking-nya hilang.
    console.warn(e);
    state.loadError = 'booking';
    toast('Gagal memuat booking kamu: ' + e.message, 'err');
  }
}

/* ---------- form ulasan (adopsi pola AYO) ---------- */
// WHY: ulasan hanya untuk booking yang sudah selesai. Rating wajib; komentar opsional supaya
// orang tidak malas mengisi. Server memvalidasi ulang kepemilikan booking.
// WHY dipisah (audit Rule 12.1): openReviewModal dulu 62 baris. Builder form + pengikat
// bintang (rating picker) + handler kirim.
function reviewFormHtml(bk, court) {
  return '<p class="t-sm muted" style="margin-bottom:12px">' +
      (court ? esc(court.nama) : '') + (bk ? ' - ' + fmtDate(bk.tanggal) : '') +
    '</p>' +
    '<div class="fld"><span class="fld-label">Seberapa puas kamu?</span>' +
      '<div class="rating-pick" role="radiogroup" aria-label="Pilih rating 1 sampai 5">' +
        [1, 2, 3, 4, 5].map(n => '<button type="button" class="rating-btn" role="radio" aria-checked="false" data-star="' + n + '" aria-label="' + n + ' bintang">' + ICONS.star + '</button>').join('') +
      '</div>' +
      '<span class="rating-hint t-xs faint" id="rv-hint">Ketuk bintang untuk menilai</span>' +
    '</div>' +
    '<label class="fld">Komentar (opsional)<textarea id="rv-text" rows="3" maxlength="500" placeholder="Bagaimana pengalamanmu di lapangan ini?" style="resize:vertical"></textarea></label>' +
    '<div style="display:flex;gap:8px;margin-top:8px"><button class="btn btn-primary" id="rv-send" style="flex:1">Kirim Ulasan</button>' +
    '<button class="btn btn-ghost" id="rv-cancel">Batal</button></div>';
}
function bindRatingPicker(panel, onPick) {
  const hint = $('#rv-hint', panel);
  const HINTS = ['', 'Kurang', 'Cukup', 'Bagus', 'Puas', 'Sangat puas'];
  $$('.rating-btn', panel).forEach(btn => btn.addEventListener('click', () => {
    const picked = Number(btn.dataset.star);
    $$('.rating-btn', panel).forEach(b => {
      b.classList.toggle('on', Number(b.dataset.star) <= picked);
      b.setAttribute('aria-checked', String(Number(b.dataset.star) === picked));
    });
    hint.textContent = HINTS[picked];
    hint.classList.remove('faint');
    onPick(picked);
  }));
}
// WHY demo menyimpan ulasan di memori agar tampilan langsung terasa berubah (paritas UX).
function saveReviewDemo(bk, picked, komentar) {
  const nm = state.user.name.split(' ');
  state.data.reviews = [{ nama: nm[0] + ' ' + (nm[1] || '').charAt(0) + '.', venue_id: bk.venue_id, rating: picked, komentar: komentar, tanggal: todayStr() }].concat(state.data.reviews || []);
  const cur = state.data.ratings[bk.venue_id] || { avg: 0, count: 0 };
  const tot = cur.avg * cur.count + picked;
  state.data.ratings[bk.venue_id] = { avg: Math.round(tot / (cur.count + 1) * 10) / 10, count: cur.count + 1 };
}
function openReviewModal(bookingId) {
  const bk = state.myBookings.find(x => x.booking_id === bookingId);
  const court = bk ? state.data.courts.find(c => c.id === bk.venue_id) : null;
  let picked = 0;
  const m = Modal.open({
    title: 'Beri Ulasan',
    body: reviewFormHtml(bk, court),
    onMount: (panel) => {
      bindRatingPicker(panel, (n) => { picked = n; });
      $('#rv-cancel', panel).addEventListener('click', () => m.close());
      $('#rv-send', panel).addEventListener('click', async () => {
        if (!picked) { toast('Pilih rating bintang terlebih dahulu.', 'err'); return; }
        const btn = $('#rv-send', panel);
        btn.classList.add('loading'); btn.disabled = true;
        try {
          const komentar = $('#rv-text', panel).value.trim();
          if (state.data.demo) {
            saveReviewDemo(bk, picked, komentar);
            state.reviewed.push(bk.booking_id);
          } else {
            await api('submitReview', { booking_id: bk.booking_id, rating: picked, komentar: komentar });
            state.reviewed.push(bk.booking_id);
            publicCache = { ts: 0, data: null }; // WHY: paksa muat ulang rating saat landing dibuka lagi
          }
          m.close();
          trackEvent('review_submitted', { venue: bk.venue_id, rating: picked, hasComment: !!komentar, demo: !!state.data.demo });
          toast('Terima kasih! Ulasanmu sudah tersimpan.', 'ok');
          route();
        } catch (e) {
          toast(e.message || 'Gagal mengirim ulasan', 'err');
          btn.classList.remove('loading'); btn.disabled = false;
        }
      });
    }
  });
}

function renderBookingInner(el) {
  const b = state.booking;
  b.date = b.date || todayStr();
  // WHY bookingMaxDate() (core, WIB-correct): ymd(addDays(new Date(), N)) membaca TZ device dan bisa
  // geser 1 hari di zona waktu ekstrem - sedangkan batas H-14 harus dari kalender WIB.
  const maxDate = bookingMaxDate();
  if (b.date > maxDate) b.date = todayStr();
  el.innerHTML = '<div style="padding:var(--sp-4) 0">' +
    '<p class="kicker" style="margin-bottom:10px">Sesi penyewa</p>' +
    '<h1>Booking</h1>' +
    '<p class="muted" style="margin:6px 0 20px">Siapa cepat, dia dapat. Slot terkunci begitu pembayaran selesai.</p>' +
    '<div class="bk-progress" role="progressbar" aria-valuenow="' + (b.court ? 3 : b.hour != null ? 2 : 1) + '" aria-valuemin="1" aria-valuemax="3" aria-label="Progress booking">' +
      '<span class="bk-step' + (b.hour == null ? ' active' : '') + '" data-step="1">Pilih jam</span>' +
      '<span class="bk-step' + (b.hour != null && !b.court ? ' active' : '') + '" data-step="2">Pilih lapangan</span>' +
      '<span class="bk-step' + (b.court ? ' active' : '') + '" data-step="3">Bayar</span>' +
    '</div>' +
    '<div class="tabs" role="tablist" aria-label="Menu booking" aria-orientation="horizontal">' +
      '<button role="tab" id="tab-baru" aria-selected="' + (b.tab === 'baru') + '" aria-controls="bk-main">Booking Baru</button>' +
      '<button role="tab" id="tab-saya" aria-selected="' + (b.tab === 'saya') + '" aria-controls="bk-main">Booking Saya <span class="tag tag-brand" style="margin-left:4px">' + state.myBookings.filter(x => x.status === 'active').length + '</span></button>' +
    '</div>' +
    '<div id="bk-main" role="tabpanel" aria-label="Konten booking"></div>' +
  '</div>';
  $('#tab-baru', el).addEventListener('click', () => { b.tab = 'baru'; renderBookingInner(el); });
  $('#tab-saya', el).addEventListener('click', () => { b.tab = 'saya'; renderBookingInner(el); });
  const main = $('#bk-main', el);
  // WHY (Batch C): tab "Booking Saya" adalah data pribadi - tetap butuh login.
  if (b.tab === 'baru') renderBookingNew(main);
  else if (state.user) renderMyBookings(main);
  else renderLoginGate(main, 'booking');
}

/* ============ FASE 3: LONG TERM (Booking) ============ */
// Item 68: Progress indicator

// Item 69: Form validation real-time

// Item 70: Success state dengan confetti

// Item 71: Autocomplete

// Item 72: Keyboard shortcut hints

// Item 73: Mobile bottom nav

// Item 74: Pull-to-refresh

// Item 75: Infinite scroll

// Item 76: Search + fuzzy matching
function fuzzySearch(query, text) {
  if (!query) return true;
  query = query.toLowerCase();
  text = text.toLowerCase();
  let qi = 0;
  for (let i = 0; i < text.length && qi < query.length; i++) {
    if (text[i] === query[qi]) qi++;
  }
  return qi === query.length;
}

// Item 77: Sort options

// Item 78: Filter options

// Item 79: JSON export
function exportToJSON(data, filename) {
  var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = filename || 'export.json';
  a.click();
  URL.revokeObjectURL(url);
}

// Item 80: Webhook support (client-side)
function triggerClientWebhook(event, data) {
  logStructured('info', 'webhook', { event: event, data: data });
}

function renderBookingNew(main) {
  const b = state.booking;
  main.innerHTML = '<div class="skel" style="height:200px" aria-label="Memuat slot"></div>';
  // WHY (C3 fix): pengunjung anonim pakai endpoint publik - getData butuh auth.
  loadSlotsAnon(b.date).then(() => {
    if (!main.isConnected) return; // WHY: guard untuk re-render saat async masih berjalan (Rule 1.13)
    bookingPrepare();
    renderBookingShell(main);
    bindBookingEvents(main);
    observeReveals(main); // WHY: stagger chips/slots dirender async - baru terlihat setelah loadSlots resolve
  }).catch(e => {
    // WHY: tanpa catch, user melihat skeleton selamanya jika jaringan putus.
    console.warn(e);
    main.innerHTML = errorStateHtml(ICONS.alert, 'Gagal memuat slot',
      'Koneksi bermasalah. Slot mungkin tidak akurat - coba muat ulang.', 'Coba lagi', 'btn-retry-slots');
    const rb = $('#btn-retry-slots', main);
    if (rb) rb.addEventListener('click', () => renderBookingNew(main));
  });
}
/* Helpers booking - pecah dari satu fungsi 114 baris jadi unit atomic (Rule 1.4, 12.1) */
function bookingCourts() { return state.data.courts.filter(c => c.status === 'aktif'); }
// bookingMaxDate pindah ke core (rev 3z) - dipakai juga chunk monitoring (walk-in form max)
function bookingPrepare() {
  const b = state.booking, courts = bookingCourts();
  if (b.date < todayStr()) { b.date = todayStr(); b.hour = null; b.court = null; } // WHY: draft basi dari tanggal lampau (jam device mundur / cache lama) tidak boleh dipakai
  if (b.date > bookingMaxDate()) { b.date = todayStr(); b.hour = null; b.court = null; }
  // WHY: validasi jam ini paritas server (leadTimeOk + jam operasional): user lintas zona waktu tidak membawa slot lewat dari draft
  if (b.hour != null) {
    // WHY: court belum dipilih tidak boleh divalidasi terhadap courts[0] saja - kalau LK1 penuh tapi LK2 bebas,
    // jam itu tetap valid (konsisten dengan slot class free = any court). Reset hanya jika tak ada lapangan bebas.
    if (b.court) {
      if (!courts.some(c => c.id === b.court)) { b.court = null; } // WHY: court fantasi dari draft basi (id dihapus/rename) - kembali ke pemilihan any-court, jam valid tetap dipertahankan
      else if (!courtFree(b.court, b.date, b.hour, b.duration)) { b.hour = null; b.court = null; }
    } else if (!courts.some(c => courtFree(c.id, b.date, b.hour, b.duration))) {
      b.hour = null;
    }
  }
  if (b.hour != null && (slotPast(b.date, b.hour) || slotBlockedByLead(b.date, b.hour))) { b.hour = null; b.court = null; } // WHY: draft jam hari ini bisa lolos cek court (slot bebas besok) - cek jam lewat/lead time wajib diulang saat prepare
  bookingSaveDraft();
}
// WHY (Jakob #11): pilihan setengah jalan tersimpan - user pindah halaman/refresh lalu kembali, pilihannya masih ada.
function bookingSaveDraft() {
  const b = state.booking;
  store.set('lk-draft-v1', { date: b.date, hour: b.hour, duration: b.duration, court: b.court, pay: b.pay });
}
function bookingSelectedCourt() {
  const b = state.booking;
  if (b.hour == null) return null;
  return bookingCourts().find(c => c.id === b.court) || null;
}
function bookingSummaryHtml() {
  const b = state.booking, court = bookingSelectedCourt();
  if (!court) {
    // WHY: 3 kondisi berbeda jangan dicampur - jam belum dipilih, jam dipilih tapi court belum, atau memang tak ada lapangan bebas
    const msg = b.hour == null ? 'Pilih jam dulu, lalu pilih lapangan.'
      : bookingCourts().some(c => courtFree(c.id, b.date, b.hour, b.duration)) ? 'Pilih lapangan dari daftar di atas untuk melihat total.'
      : 'Tidak ada lapangan bebas untuk kombinasi ini. Coba kurangi durasi atau ganti jam.';
    return '<p class="t-sm muted" style="text-align:center;padding:8px 0">' + msg + '</p>';
  }
  const tarifLabel = bookingTarifLabel(court, b.date, b.hour, b.duration);
  // WHY satu rumus (audit P2-13): ringkasan, modal bayar, dan jalur demo memakai priceBreakdown()
  // yang sama - dulu ada 3 tempat menghitung harga sendiri, dan sudah terbukti divergen (P0-3).
  const p = priceBreakdown(court, b.date, b.hour, b.duration, addOnItems());
  const ao = p.aoTotal, grandTotal = p.grandTotal;
  return '<div class="summary-rows">' +
      '<div class="row"><span class="rl">Tanggal</span><b>' + fmtDate(b.date) + '</b></div>' +
      '<div class="row"><span class="rl">Jam</span><b class="mono">' + fmtHour(b.hour) + ' - ' + fmtHour(b.hour + b.duration) + ' WIB</b></div>' +
      '<div class="row"><span class="rl">Lapangan</span><b>' + esc(court.nama) + '</b></div>' +
      '<div class="row"><span class="rl">Durasi</span><b class="mono">' + b.duration + ' jam</b></div>' +
      '<div class="row"><span class="rl">Tarif</span><b class="mono">' + tarifLabel + '</b></div>' +
      // WHY: baris add-on hanya muncul kalau ada - jangan tampilkan "Rp 0" yang jadi noise
      (ao ? '<div class="row"><span class="rl">Produk tambahan</span><b class="mono">' + fmtRp(ao) + '</b></div>' : '') +
      splitBillSummaryRows(b, grandTotal) +
    '</div><div class="summary-total"><span class="rl" style="font-size:12px;letter-spacing:.01em;color:var(--text3)">Total</span><b>' + fmtRp(grandTotal) + '</b></div>' +
    '<label class="consent"><input type="checkbox" id="consent" ' + (store.get('lk-consent-v1', false) ? 'checked' : '') + '> <span>Saya setuju data saya diproses sesuai <button type="button" class="link-plain" data-open-privacy>Kebijakan Privasi</button>.</span></label>' +
    '<button class="btn btn-primary" id="btn-pay" style="width:100%" ' + (store.get('lk-consent-v1', false) ? '' : 'disabled') + '>Bayar Sekarang</button>';
}
function bookingDatebarHtml(days, sel) {
  return '<div class="datebar">' +
    '<button class="icon-btn dnav" id="d-prev" aria-label="Geser tanggal ke kiri">' + ICONS.left + '</button>' +
    '<div class="date-scroll" id="date-scroll" data-stagger>' +
      days.map((d, i) => '<button class="date-chip" data-date="' + d + '" style="--i:' + i + '" aria-pressed="' + (d === sel) + '"><span class="dc-day">' + DAY_ID[new Date(d + 'T00:00').getDay()] + '</span><span class="dc-date">' + Number(d.slice(8)) + '</span></button>').join('') +
    '</div>' +
    '<button class="icon-btn dnav" id="d-next" aria-label="Geser tanggal ke kanan">' + ICONS.right + '</button>' +
  '</div>';
}
function bookingSlotsHtml() {
  const cfg = state.data.config;
  return '<div class="slot-grid" id="slot-grid" role="group" aria-label="Slot jam tersedia" aria-labelledby="slot-grid-label" data-stagger>' +
      hoursRange(cfg).map((h, i) => slotBtn(state.booking, h, i)).join('') +
    '</div>' +
    '<p class="sr-only" id="slot-count" aria-live="polite"></p>' +
    '<div class="slot-legend">' +
      '<span class="l-free"><i></i>Tersedia</span><span class="l-mine"><i></i>Booking kamu</span><span class="l-booked"><i></i>Terisi</span><span class="l-blocked"><i></i>Tidak bisa</span>' + (peakCfg().hours.length && peakCfg().mult > 1 ? '<span class="l-peak"><i></i>Jam sibuk (harga berbeda)</span>' : '') + (offCfg().hours.length && offCfg().mult < 1 ? '<span class="l-off"><i></i>Jam sepi (harga lebih murah)</span>' : '') +
    '</div>';
}
function bookingDurationHtml() {
  const b = state.booking, courts = bookingCourts();
  return '<div class="radio-row" role="radiogroup" aria-label="Durasi booking">' +
    [1, 2, 3].slice(0, Math.max(1, state.data.config.max_hours_per_booking || 3)).map(d => { // WHY: config-driven (Rule real data) - ubah max_hours_per_booking di sheet, UI ikut
      let ok = b.hour != null;
      if (ok) ok = courts.some(c => courtFree(c.id, b.date, b.hour, d));
      return '<span class="radio-pill"><input type="radio" name="dur" id="dur' + d + '" value="' + d + '" ' + (b.duration === d ? 'checked' : '') + (ok ? '' : ' disabled') + '><label for="dur' + d + '">' + d + ' jam</label></span>';
    }).join('') +
  '</div>';
}
function bookingCourtsHtml() {
  const b = state.booking;
  const avail = b.hour != null ? bookingCourts().filter(c => courtFree(c.id, b.date, b.hour, b.duration)) : [];
  if (!avail.length) return '<p class="t-sm faint">Slot yang kamu pilih akan menentukan lapangan yang tersedia.</p>';
  return '<div class="court-picks" id="court-picks">' +
    avail.map(c => {
      const hrPrice = hourPriceAt(c, b.date, b.hour);
      const tag = isPeak(b.date, b.hour) ? ' <small>(sibuk)</small>' : (isOffPeak(b.date, b.hour) ? ' <small>(sepi)</small>' : '');
      return '<button class="court-pick" data-court="' + c.id + '" aria-pressed="' + (b.court === c.id) + '" aria-label="' + esc(c.nama) + ', ' + fmtRp(hrPrice) + ' per jam' + (isPeak(b.date, b.hour) ? ', jam sibuk' : (isOffPeak(b.date, b.hour) ? ', jam sepi' : '')) + '">' +
      '<span class="cp-name">' + esc(c.nama) + '</span>' +
      '<span class="cp-price">' + fmtRp(hrPrice) + '<small>/jam</small>' + tag + '</span>' +
      '<span class="cp-state">' + (b.court === c.id ? 'Dipilih' : 'Pilih') + '</span>' +
      '</button>'; }).join('') + '</div>';
}
function renderBookingShell(main) {
  const b = state.booking, cfg = state.data.config;
  const days = [];
  for (let i = 0; i <= cfg.max_advance_days; i++) days.push(ymd(addDays(new Date(), i)));
  const availCount = b.hour != null ? bookingCourts().filter(c => courtFree(c.id, b.date, b.hour, b.duration)).length : 0;
  main.innerHTML =
    '<div class="bk-grid">' +
      '<div>' +
        '<div class="panel">' +
          '<div class="block">' +
            '<div class="block-title"><h3>Tanggal</h3><span class="hint">sampai ' + fmtDate(bookingMaxDate()) + '</span></div>' +
            bookingDatebarHtml(days, b.date) +
          '</div>' +
          '<div class="block">' +
            '<div class="block-title"><h3>Jam mulai</h3><span class="hint">' + fmtHour(cfg.jam_buka_mulai) + ' - ' + fmtHour(cfg.jam_buka_selesai) + ' WIB</span></div>' +
            bookingSlotsHtml() +
          '</div>' +
          '<div class="block">' +
            '<div class="block-title"><h3>Durasi</h3><span class="hint">max ' + cfg.max_hours_per_booking + ' jam</span></div>' +
            bookingDurationHtml() +
          '</div>' +
          '<div class="block">' +
            '<div class="block-title"><h3>Pengulangan</h3><span class="hint">jadwal rutin mingguan</span></div>' +
            bookingRecurHtml() +
          '</div>' +
          '<div class="block">' +
            '<div class="block-title"><h3>Lapangan</h3><span class="hint">' + (b.hour != null ? availCount + ' tersedia' : 'pilih jam dulu') + '</span></div>' +
            bookingCourtsHtml() +
          '</div>' +
          addOnsHtml() +
        '</div>' +
      '</div>' +
      '<aside class="panel sticky-summary" aria-label="Ringkasan booking">' +
        '<h3>Ringkasan</h3>' + bookingSummaryHtml() +
      '</aside>' +
    '</div>' + bookingBarHtml();
}
function bindBookingEvents(main) {
  const b = state.booking, cfg = state.data.config;
  const freeCount = hoursRange(cfg).filter(h => !slotPast(b.date, h) && !slotBlockedByLead(b.date, h) && bookingCourts().some(c => courtFree(c.id, b.date, h, 1))).length;
  $('#slot-count', main).textContent = freeCount + ' jam masih tersedia di minimal satu lapangan.';
  // WHY (critique P1): sticky bar mobile - scroll ke ringkasan saat "Lanjut Bayar" diketuk
  const bbPay = $('#bb-pay', main);
  if (bbPay) bbPay.addEventListener('click', () => {
    const sum = $('.sticky-summary', main);
    if (sum) { sum.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  });
  // Event delegation for slot grid (performance: one listener instead of per-slot)
  bindSlotGridDelegation(main);
  bindDateChipDelegation(main);
  const sc = $('#date-scroll', main);
  const chipSel = $('.date-chip[aria-pressed="true"]', sc);
  if (chipSel) sc.scrollLeft = Math.max(0, chipSel.offsetLeft - sc.clientWidth / 2);
  $('#d-prev', main).addEventListener('click', () => sc.scrollBy({ left: -240, behavior: 'smooth' }));
  $('#d-next', main).addEventListener('click', () => sc.scrollBy({ left: 240, behavior: 'smooth' }));
  // WHY: listener langsung .slot.free/.slot.booked DIHAPUS - bindSlotGridDelegation di atas sudah
  // menangani keduanya via event delegation. Dulu keduanya aktif: satu klik slot = renderBookingNew
  // 2x (free) atau openWaitlistModal 2x (booked).
  bindRovingGrid($('#slot-grid', main));
  bindRovingGrid($('#date-scroll', main), '.date-chip');
  bindRovingGrid($('.court-picks', main), '.court-pick'); // WHY .court-picks (audit P2-1): selector lama '#court-picks' menargetkan id yang tidak ada sehingga navigasi panah tidak pernah aktif
  bindAddOns(main);
  $$('input[name="dur"]', main).forEach(r => r.addEventListener('change', () => { b.duration = Number(r.value); b.court = null; bookingSaveDraft(); renderBookingNew(main); }));
  // Event delegation for court-picks
  const courtPicks = $('.court-picks', main);
  if (courtPicks && !courtPicks.dataset.delegated) {
    courtPicks.dataset.delegated = '1';
    courtPicks.addEventListener('click', (e) => {
      const cp = e.target.closest('.court-pick');
      if (!cp) return;
      b.court = cp.dataset.court; bookingSaveDraft(); renderBookingNew(main);
    });
  }
  const consent = $('#consent', main);
  if (consent) consent.addEventListener('change', () => { store.set('lk-consent-v1', consent.checked); $('#btn-pay', main).disabled = !consent.checked; });
  const payBtn = $('#btn-pay', main);
  if (payBtn) payBtn.addEventListener('click', openPaymentModal);
  // WHY (FITUR 1): patungan hidup di state.booking.splitCount (null = mati) - tiap perubahan re-render ringkasan.
  const splitToggle = $('#split-toggle', main);
  if (splitToggle) splitToggle.addEventListener('change', () => { b.splitCount = splitToggle.checked ? 4 : null; renderBookingNew(main); });
  const splitMinus = $('#split-minus', main);
  if (splitMinus) splitMinus.addEventListener('click', () => { b.splitCount = Math.max(2, (b.splitCount || 4) - 1); renderBookingNew(main); });
  const splitPlus = $('#split-plus', main);
  if (splitPlus) splitPlus.addEventListener('click', () => { b.splitCount = Math.min(8, (b.splitCount || 4) + 1); renderBookingNew(main); });
  // WHY (FITUR 2): pengulangan mingguan hidup di state.booking.recurWeeks (null = sekali saja) - tiap perubahan re-render.
  const recurToggle = $('#recur-toggle', main);
  if (recurToggle) recurToggle.addEventListener('change', () => { b.recurWeeks = recurToggle.checked ? 4 : null; renderBookingNew(main); });
  const recurMinus = $('#recur-minus', main);
  if (recurMinus) recurMinus.addEventListener('click', () => { b.recurWeeks = Math.max(2, (b.recurWeeks || 4) - 1); renderBookingNew(main); });
  const recurPlus = $('#recur-plus', main);
  if (recurPlus) recurPlus.addEventListener('click', () => { b.recurWeeks = Math.min(8, (b.recurWeeks || 4) + 1); renderBookingNew(main); });
  bindLegalButtons();
}
function slotBtn(b, h, i) {
  const courts = state.data.courts.filter(c => c.status === 'aktif');
  const anyFree = !slotPast(b.date, h) && !slotBlockedByLead(b.date, h) && courts.some(c => courtFree(c.id, b.date, h, 1)); // WHY: lead time 2 jam wajib tampil blocked di UI, bukan hanya divalidasi server
  const mine = courts.some(c => isMine(b.date, c.id, h));
  const allBooked = !slotPast(b.date, h) && !slotBlockedByLead(b.date, h) && courts.every(c => isBooked(b.date, c.id, h)); // WHY: hanya penuh masa depan yang bisa diantre
  const cls = mine ? 'mine' : (slotPast(b.date, h) || slotBlockedByLead(b.date, h)) ? 'blocked' : allBooked ? 'booked' : anyFree ? 'free' : 'blocked';
  // WHY: slot booked TIDAK disabled - kliknya membuka modal waitlist (rev 3l); blocked/mine tetap disabled
  const dis = cls === 'blocked' || cls === 'mine';
  const selCls = (b.hour === h && !dis) ? ' selected' : ''; // WHY: jam terpilih harus ter-marking jelas, bukan cuma dari munculnya daftar lapangan
  const wl = state.waitlist.some(w => w.tanggal === b.date && parseInt(w.jam_mulai, 10) === h);
  const label = mine ? fmtHour(h) + ', booking kamu' : allBooked ? fmtHour(h) + ', terisi di semua lapangan' + (wl ? ', klik untuk antre' : '') : anyFree ? fmtHour(h) + ', tersedia' : fmtHour(h) + ', tidak bisa dibooking';
  const wlMark = (cls === 'booked' && wl) ? '<span class="wl-mark" title="Kamu antre di jam ini" aria-hidden="true">' + ICONS.bell + '</span>' : '';
  // WHY: penanda peak (jam sibuk) - penyewa paham kenapa harga beda sebelum memilih
  const peakMark = (isPeak(b.date, h) && cls !== 'blocked') ? '<span class="peak-mark" title="Jam sibuk - harga berbeda" aria-hidden="true">SIBUK</span>' : '';
  // WHY: penanda jam sepi (adopsi riset kompetitor) - kebalikan peak. Hanya tampil di slot free
  // supaya penyewa tahu ada diskon; jam terisi tidak perlu ditandai.
  const offMark = (cls === 'free' && isOffPeak(b.date, h)) ? '<span class="off-mark" title="Jam sepi - harga lebih murah" aria-hidden="true">SEPI</span>' : '';
  const peakLabel = isPeak(b.date, h) && cls !== 'blocked' ? ', jam sibuk' : '';
  const offLabel = cls === 'free' && isOffPeak(b.date, h) ? ', harga jam sepi' : '';
  const fullLabel = cls === 'free' ? fmtHour(h) + ', tersedia' + peakLabel + offLabel : label;
  return '<button class="slot ' + cls + selCls + '" data-hour="' + h + '" style="--i:' + (i || 0) + '" ' + (dis ? 'disabled tabindex="-1"' : '') + ' aria-pressed="' + (selCls ? 'true' : 'false') + '" aria-label="' + (cls === 'free' ? fullLabel : label) + '">' + pad2(h) + peakMark + offMark + wlMark + '</button>';
}
function bindRovingGrid(grid, selector) {
  if (!grid) return;
  const cells = $$(selector || '.slot:not([disabled])', grid);
  if (!cells.length) return;
  cells[0].tabIndex = 0;
  grid.addEventListener('keydown', (e) => {
    const idx = cells.indexOf(document.activeElement);
    if (idx < 0) return;
    let next = null;
    if (e.key === 'ArrowRight') next = idx + 1;
    if (e.key === 'ArrowLeft') next = idx - 1;
    if (e.key === 'Home') next = 0;
    if (e.key === 'End') next = cells.length - 1;
    if (next != null) { e.preventDefault(); cells[Math.max(0, Math.min(cells.length - 1, next))].focus(); }
  });
}

/* ---------- produk tambahan (adopsi pola AYO) ---------- */
// WHY: rental raket/shuttle sebagai item tambahan di checkout. Sebelumnya cuma disebut di FAQ.
// Total di sini hanya PREVIEW - server menghitung ulang dari sheet AddOn dan mengabaikan
// harga kiriman client, jadi memanipulasi harga dari browser tidak mungkin.
function addOnQty(id) { return (state.booking.addons || {})[id] || 0; }
// WHY dipisah (audit P2-13): priceBreakdown() butuh item add-on (bukan hanya totalnya) supaya
// satu rumus harga dipakai ringkasan, modal bayar, dan jalur demo.
function addOnItems() {
  const list = (state.data && state.data.addOns) || [];
  return list.filter(a => addOnQty(a.id) > 0)
    .map(a => ({ id: a.id, nama: a.nama, harga: a.harga, qty: addOnQty(a.id), subtotal: a.harga * addOnQty(a.id) }));
}
function addOnSubtotal() { return addOnItems().reduce((s, x) => s + x.subtotal, 0); }
function addOnsHtml() {
  const list = (state.data && state.data.addOns) || [];
  if (!list.length) return '';
  return '<div class="block">' +
    '<div class="block-title"><h3>Produk tambahan</h3><span class="hint">opsional</span></div>' +
    '<div class="addon-list">' +
      list.map(a => {
        const q = addOnQty(a.id);
        return '<div class="addon-row' + (q ? ' on' : '') + '" data-addon="' + esc(a.id) + '">' +
          '<span class="ao-info"><b>' + esc(a.nama) + '</b>' +
            '<span class="ao-price num-tab">' + fmtRp(a.harga) + '<small>/' + esc(a.satuan) + '</small></span></span>' +
          '<span class="ao-qty">' +
            '<button type="button" class="ao-btn" data-ao-minus="' + esc(a.id) + '" aria-label="Kurangi ' + esc(a.nama) + '"' + (q ? '' : ' disabled') + '>&minus;</button>' +
            '<span class="ao-num num-tab" aria-live="polite">' + q + '</span>' +
            '<button type="button" class="ao-btn" data-ao-plus="' + esc(a.id) + '" aria-label="Tambah ' + esc(a.nama) + '"' + (q >= (a.max_qty || 5) ? ' disabled' : '') + '>+</button>' +
          '</span>' +
        '</div>';
      }).join('') +
    '</div>' +
    (addOnSubtotal() ? '<p class="t-sm muted" style="margin-top:10px">Tambahan: <b class="num-tab">' + fmtRp(addOnSubtotal()) + '</b></p>' : '') +
  '</div>';
}
function bindAddOns(main) {
  const addonList = $('.addon-list', main);
  if (addonList && !addonList.dataset.delegated) {
    addonList.dataset.delegated = '1';
    addonList.addEventListener('click', (e) => {
      const btn = e.target.closest('.ao-btn');
      if (!btn) return;
      const id = btn.dataset.aoPlus || btn.dataset.aoMinus;
      const a = state.data.addOns.filter(x => x.id === id)[0];
      if (!a) return;
      const cur = addOnQty(id);
      if (btn.dataset.aoPlus && cur < (a.max_qty || 5)) {
        state.booking.addons = Object.assign({}, state.booking.addons, { [id]: cur + 1 });
        renderBookingNew(main);
      } else if (btn.dataset.aoMinus && cur > 0) {
        const next = Object.assign({}, state.booking.addons);
        if (cur - 1 === 0) delete next[id]; else next[id] = cur - 1;
        state.booking.addons = next;
        renderBookingNew(main);
      }
    });
  }
}
/* ---------- waitlist (antre slot penuh) ---------- */
function waitlistModalBody(hour, existing) {
  const b = state.booking;
  let body = '<p class="t-sm muted">Slot ' + fmtDate(b.date) + ' jam ' + fmtHour(hour) + ' sedang penuh di semua lapangan. ' +
    'Daftar antre, dan kami email kamu begitu ada pembatalan yang membuka slot ini.</p>';
  body += existing ? waitlistExistingHtml(existing) : waitlistFormHtml();
  return body;
}
function waitlistExistingHtml(existing) {
  return '<div class="waitlist-ok">' + ICONS.check + ' Kamu sudah antre di jam ini (durasi ' + existing.durasi + ' jam). Kami email saat slot dibuka.</div>' +
    '<button class="btn btn-ghost" id="btn-wl-cancel" style="width:100%; margin-top:12px">Batalkan antrean</button>';
}
function waitlistFormHtml() {
  const durasiMax = state.data.config ? (state.data.config.max_hours_per_booking || 3) : 3;
  return '<div class="waitlist-form">' +
    '<p class="mlabel" style="margin-bottom:8px">Durasi yang kamu mau</p>' +
    '<div class="radio-pill" role="radiogroup" aria-label="Durasi antrean">' +
      Array.from({ length: durasiMax }, (_, i) => i + 1).map(d => '<label><input type="radio" name="wl-dur" value="' + d + '" ' + (d === 1 ? 'checked' : '') + '><span>' + d + ' jam</span></label>').join('') +
    '</div>' +
    '<button class="btn btn-primary" id="btn-wl-join" style="width:100%; margin-top:16px">' + ICONS.bell + ' Daftar antre</button>' +
    '<p class="t-xs faint" style="margin-top:10px">Posisi antrean tidak mengunci slot - yang lebih dulu dapat notifikasi, lebih dulu bisa booking.</p>' +
  '</div>';
}
async function waitlistJoinAction(hour, joinBtn, modal) {
  const b = state.booking;
  // WHY (Batch C): waitlist butuh identitas (notifikasi email) - wajib login di live.
  if (!state.data.demo && !state.user) { openLoginRequiredModal(); return; }
  const scope = joinBtn.closest('.modal-panel');
  const dur = Number(($('input[name="wl-dur"]:checked', scope) || {}).value || 1);
  joinBtn.disabled = true;
  try {
    if (state.data.demo) {
      const all = demoWaitlistStore.all();
      const u = effectiveUser() || DEMO_GUEST;
      all.push({ email: u.email, nama: u.name, tanggal: b.date, jam_mulai: fmtHour(hour), durasi: dur, created_at: new Date().toISOString(), status: 'active' });
      demoWaitlistStore.save(all);
      state.waitlist = demoWaitlistStore.mine();
      toast('Terdaftar antre. Kami email saat slot dibuka (simulasi).', 'ok');
    } else {
      const r = await api('waitlistJoin', { tanggal: b.date, jam_mulai: hour, durasi: dur });
      state.waitlist = await api('waitlistMine', {});
      toast('Terdaftar antre ke-' + (r.position || '?') + '. Kami email saat slot dibuka.', 'ok');
    }
    modal.close();
    renderBookingNew($('#bk-main'));
  } catch (e) {
    joinBtn.disabled = false;
    toast(e.message || 'Gagal mendaftar antrean', 'err');
    reportError('waitlistJoin', e);
  }
}
async function waitlistCancelAction(hour, modal) {
  const b = state.booking;
  try {
    if (state.data.demo) {
      const all = demoWaitlistStore.all().map(w => (w.email === state.user.email && w.tanggal === b.date && parseInt(w.jam_mulai, 10) === hour) ? Object.assign(w, { status: 'cancelled' }) : w);
      demoWaitlistStore.save(all);
      state.waitlist = demoWaitlistStore.mine();
    } else {
      await api('waitlistCancel', { tanggal: b.date, jam_mulai: hour });
      state.waitlist = await api('waitlistMine', {});
    }
    toast('Antrean dibatalkan.', 'ok');
    modal.close();
    renderBookingNew($('#bk-main'));
  } catch (e) { toast(e.message || 'Gagal membatalkan antrean', 'err'); }
}
function openWaitlistModal(hour) {
  const existing = state.waitlist.find(w => w.tanggal === state.booking.date && parseInt(w.jam_mulai, 10) === hour);
  const m = Modal.open({
    title: 'Antre slot ' + fmtHour(hour),
    body: waitlistModalBody(hour, existing)
  });
  const joinBtn = $('#btn-wl-join', m.panel);
  if (joinBtn) joinBtn.addEventListener('click', () => waitlistJoinAction(hour, joinBtn, m));
  const cancelBtn = $('#btn-wl-cancel', m.panel);
  if (cancelBtn) cancelBtn.addEventListener('click', () => waitlistCancelAction(hour, m));
}

/* payment modal */
function paymentErrMsg(err) { // pecah dari openPaymentModal (Rule 12.1) - peta kode error ke pesan penyewa
  return err.code === 'SLOT_TAKEN' ? 'Slot ini baru saja diambil orang lain.'
    : err.code === 'NETWORK' ? err.message
    : 'Booking gagal: ' + err.message;
}
// WHY dipisah (audit Rule 12.1): openPaymentModal dulu 55 baris.
function paymentModalHtml(grandTotal, opt, perWeek, recurWeeks) {
  // WHY (2026-10-11): voucher dihapus - parameter voucher/discount dihilangkan.
  const demo = state.data.demo;
  const midtransReady = !demo && (state.data.config.midtrans_client_key || '');
  // WHY (M5 fix): tampilkan rincian per-minggu bila seri recurring.
  const recurLine = (recurWeeks > 1 && perWeek)
    ? '<div class="row"><span class="rl">Per minggu</span><b>' + fmtRp(perWeek) + ' × ' + recurWeeks + '</b></div>'
    : '';
  return (demo
    ? '<div class="sim-note">' + ICONS.info + ' Mode simulasi - tidak ada uang sungguhan yang berpindah</div>' +
      '<div class="qris-box" aria-label="QRIS simulasi"><svg id="qris" width="180" height="180" viewBox="0 0 29 29" role="img" aria-label="QRIS simulasi"></svg></div>' +
      '<p class="t-xs faint modal-center" style="margin-bottom:8px;">Scan pakai aplikasi pembayaran apa pun (simulasi)</p>'
    : '<div class="sim-note">' + ICONS.info + ' Pembayaran aman via Midtrans - QRIS, VA bank, GoPay, kartu</div>') +
    recurLine +
    '<div class="pay-opts" role="radiogroup" aria-label="Opsi pembayaran" aria-labelledby="pay-opts-label">' +
      '<div class="pay-opt" data-opt="full" role="radio" aria-checked="' + (opt === 'full') + '" tabindex="0"><span><span class="po-name">Bayar Penuh</span><br><span class="po-sub">Langsung terkonfirmasi</span></span><span class="po-amt">' + fmtRp(grandTotal) + '</span></div>' +
      '<div class="pay-opt" data-opt="dp" role="radio" aria-checked="' + (opt === 'dp') + '" tabindex="0"><span><span class="po-name">DP 50%</span><br><span class="po-sub">Sisa bayar di venue</span></span><span class="po-amt">' + fmtRp(Math.round(grandTotal / 2)) + '</span></div>' +
    '</div>' +
    '<button class="btn btn-primary" id="btn-confirm-pay" style="width:100%">' +
      (demo ? '<span class="spin" aria-hidden="true"></span>Bayar (Simulasi)' : 'Bayar via Midtrans') + '</button>' +
    (!demo && !midtransReady ? '<p class="t-xs faint modal-center" style="margin-top:8px;">Pembayaran online belum dikonfigurasi venue.</p>' : '');
}
// WHY menerima getter/setter opt: pilihan pembayaran hidup di closure, bukan di DOM.
function bindPaymentOptions(panel, getOpt, setOpt) {
  const paint = () => $$('.pay-opt', panel).forEach(p => p.setAttribute('aria-checked', String(p.dataset.opt === getOpt())));
  $$('.pay-opt', panel).forEach(p => {
    p.addEventListener('click', () => { setOpt(p.dataset.opt); paint(); });
    p.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpt(p.dataset.opt); paint(); } });
  });
}
async function confirmPayment(panel, m, court, getOpt) {
  const btn = $('#btn-confirm-pay', panel);
  if (btn.classList.contains('loading')) return; // WHY: anti double-submit (double-click/Enter cepat)
  btn.classList.add('loading');
  m.lock(true); // WHY: modal tidak boleh ditutup saat proses berjalan - side effect sudah terjadi
  await sleep(700); // simulasi proses pembayaran
  const b = state.booking;
  try {
    if (state.data.demo) {
      await sleep(700); // simulasi proses pembayaran
      const result = await doCreateBooking(getOpt());
      btn.classList.remove('loading');
      m.lock(false);
      // WHY (FITUR 2): validasi seri gagal -> toast sudah tampil di demoCreateRecurring; modal tetap terbuka untuk retry.
      if (!result) return;
      showSuccessInModal(m, Array.isArray(result) ? result[0] : result, court);
      b.hour = null; b.court = null;
      bookingSaveDraft();
      return;
    }
    // LIVE (Midtrans): booking dibuat dulu berstatus 'unpaid', lalu Snap token diminta.
    // Webhook Midtrans adalah sumber kebenaran status bayar (bukan callback JS ini).
    const result = await doCreateBooking(getOpt(), true);
    // WHY (FITUR 2): validasi seri gagal -> toast sudah tampil; modal tetap terbuka untuk retry.
    if (!result) { btn.classList.remove('loading'); m.lock(false); return; }
    if (Array.isArray(result)) {
      // WHY (FITUR 2): seri live dibuat 'unpaid' - Snap berjalan per-booking, jadi
      // pembayaran seri dilakukan tiap jadwal dari Booking Saya.
      btn.classList.remove('loading');
      m.lock(false);
      m.close();
      b.hour = null; b.court = null;
      bookingSaveDraft();
      await loadMyBookings();
      if (!result.failed.length) toast('Seri mingguan dibuat: ' + result.length + ' booking. Bayar tiap jadwal dari Booking Saya.', 'ok');
      route();
      return;
    }
    const booking = result;
    let snapOutcome;
    try {
      snapOutcome = await payWithSnap(booking, court);
    } catch (e) {
      btn.classList.remove('loading');
      m.lock(false);
      const msg = e.message === 'PAYMENT_UNAVAILABLE'
        ? 'Pembayaran online belum dikonfigurasi venue. Hubungi venue untuk info pembayaran.'
        : (e.message || 'Gagal membuka pembayaran.');
      const slot = $('.modal-body', m.panel);
      if (slot && !$('.inline-err', slot)) slot.insertAdjacentHTML('afterbegin', '<div class="inline-err" role="alert">' + ICONS.alert + '<span>' + esc(msg) + '</span></div>');
      toast(msg, 'err');
      return;
    }
    btn.classList.remove('loading');
    m.lock(false);
    m.close();
    b.hour = null; b.court = null;
    bookingSaveDraft();
    await loadMyBookings();
    if (snapOutcome.kind === 'success') {
      showSnapSuccessModal(booking, court);
    } else if (snapOutcome.kind === 'pending') {
      showSnapPendingModal(booking, court);
    } else if (snapOutcome.kind === 'error') {
      toast('Pembayaran gagal. Booking tersimpan - kamu bisa coba bayar lagi dari Booking Saya.', 'err');
    } else {
      toast('Pembayaran belum selesai. Lanjutkan dari Booking Saya dalam 30 menit.', 'info');
    }
    route();
  } catch (err) {
    btn.classList.remove('loading');
    m.lock(false);
    const msg = paymentErrMsg(err);
    // WHY (Jakob #10/#11): error tampil DI DALAM modal dekat konteks + pilihan user tidak hilang - modal tetap terbuka untuk retry
    const slot = $('.modal-body', m.panel);
    if (slot && !$('.inline-err', slot)) slot.insertAdjacentHTML('afterbegin', '<div class="inline-err" role="alert">' + ICONS.alert + '<span>' + esc(msg) + ' Pilihan kamu masih tersimpan - pilih jam/lapangan lain lalu bayar lagi.</span></div>');
    toast(msg, 'err');
  }
}
function openPaymentModal() {
  const b = state.booking;
  const court = state.data.courts.find(c => c.id === b.court);
  if (!court || b.hour == null) { toast('Pilih jam dan lapangan terlebih dahulu.', 'info'); return; }
  // WHY (Batch C): browsing boleh anonim, tapi booking wajib login Google (kecuali demo).
  if (!state.data.demo && !state.user) { openLoginRequiredModal(); return; }
  const p = priceBreakdown(court, b.date, b.hour, b.duration, addOnItems());
  const grandTotal = p.grandTotal;
  // WHY (M5 fix): untuk seri recurring, tampilkan total seluruh seri (N × per minggu),
  // bukan hanya 1 minggu - user harus tahu komitmen total sebelum bayar.
  const recurWeeks = Number(b.recurWeeks) || 0;
  const seriesTotal = recurWeeks > 1 ? grandTotal * recurWeeks : grandTotal;
  let opt = b.pay || 'full';
  const m = Modal.open({
    title: 'Pembayaran',
    body: (recurWeeks > 1
      ? '<div class="sim-note">' + ICONS.info + ' Seri mingguan: ' + recurWeeks + ' booking (' + fmtRp(grandTotal) + '/minggu) - total ' + fmtRp(seriesTotal) + '</div>'
      : '') + paymentModalHtml(seriesTotal, opt, grandTotal, recurWeeks),
    onMount: (panel) => {
      const qris = $('#qris', panel);
      if (qris) drawQris(qris); // hanya ada di mode demo
      bindPaymentOptions(panel, () => opt, (v) => { opt = v; });
      $('#btn-confirm-pay', panel).addEventListener('click', () => confirmPayment(panel, m, court, () => opt));
    }
  });
}
function drawQris(svg) {
  // deterministic pseudo-random QR look, fixed seed
  let s = 42;
  const rnd = () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
  const ink = 'var(--text)', paper = 'var(--bg)'; // WHY: token tema, bukan hex (Rule 1.3) - kontras teks/bg identik dengan QR asli
  const N = 29, cell = 1, finder = (x, y) =>
    '<rect x="' + x + '" y="' + y + '" width="7" height="7" fill="' + ink + '"/>' +
    '<rect x="' + (x + 1) + '" y="' + (y + 1) + '" width="5" height="5" fill="' + paper + '"/>' +
    '<rect x="' + (x + 2) + '" y="' + (y + 2) + '" width="3" height="3" fill="' + ink + '"/>';
  let r = '<rect width="' + N + '" height="' + N + '" fill="' + paper + '"/>';
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const inFinder = (x < 8 && y < 8) || (x > N - 9 && y < 8) || (x < 8 && y > N - 9);
    if (inFinder) continue;
    if (rnd() > .52) r += '<rect x="' + x + '" y="' + y + '" width="' + cell + '" height="' + cell + '" fill="' + ink + '"/>';
  }
  r += finder(0, 0) + finder(N - 7, 0) + finder(0, N - 7);
  r += '<circle cx="14.5" cy="14.5" r="2.6" fill="' + ink + '"/>';
  svg.innerHTML = r;
}
// WHY dipisah (audit Rule 12.1): doCreateBooking dulu 51 baris; cek konflik demo berdiri sendiri.
function demoCreateGuard(b, court) {
  const all = DEMO_BOOKINGS.concat(demoStore.all()).filter(x => x.status === 'active' && x.tanggal === b.date && x.venue_id === b.court);
  for (let i = 0; i < b.duration; i++) {
    if (all.some(x => hoursOf(x).includes(b.hour + i))) { const e = new Error('Slot sudah terisi'); e.code = 'SLOT_TAKEN'; throw e; }
  }
  if (slotPast(b.date, b.hour) || slotBlockedByLead(b.date, b.hour)) { const e = new Error('Slot ini sudah lewat batas booking (minimal 2 jam sebelum jam main)'); e.code = 'SLOT_TAKEN'; throw e; }
  // WHY: paritas server (jam operasional) - dulu demo bisa booking lewat tengah malam
  if (b.hour + b.duration > state.data.config.jam_buka_selesai) { const e = new Error('Durasi melebihi jam tutup ' + fmtHour(state.data.config.jam_buka_selesai)); e.code = 'INVALID_RANGE'; throw e; }
}
// WHY: demo menghitung add-on dari katalog lokal - paritas dengan server (resolveAddOns)
function demoAddonItems(addonPayload) {
  return addonPayload.map(it => {
    const a = (state.data.addOns || []).filter(x => x.id === it.id)[0];
    return a ? { id: a.id, nama: a.nama, harga: a.harga, qty: it.qty, subtotal: a.harga * it.qty } : null;
  }).filter(Boolean);
}
// WHY satu jalur harga demo & live (audit P2-13): dulu harga dihitung di DUA tempat - client
// (demoCreateBooking) dan server (handleCreateBooking) - yang harus dijaga selaras manual, dan
// sudah terbukti divergen pada voucher (P0-3). Kini keduanya memanggil priceBreakdown() yang
// sama; server tetap sumber kebenaran, demo hanya memakai fungsi yang sama agar tidak bisa beda.
function priceBreakdown(court, date, hour, duration, addonItems) {
  // WHY (2026-10-11): sistem voucher DIHAPUS total atas keputusan Mas. Tidak ada diskon voucher.
  const hargaCourt = bookingPrice(court, date, hour, duration);
  const aoTotal = (addonItems || []).reduce((s, x) => s + x.subtotal, 0);
  const subtotal = hargaCourt + aoTotal;
  return { hargaCourt, aoTotal, subtotal, voucher: null, discount: 0, grandTotal: subtotal };
}
async function demoCreateBooking(b, court, opt, addonPayload, recur) {
  demoCreateGuard(b, court);
  const aoItems = demoAddonItems(addonPayload);
  const p = priceBreakdown(court, b.date, b.hour, b.duration, aoItems);
  const u = effectiveUser() || DEMO_GUEST;
  const bk = {
    booking_id: 'LK-' + b.date.replace(/-/g, '') + '-' + randCode(),
    created_at: new Date().toISOString(), email: u.email, nama: u.name,
    venue_id: b.court, tanggal: b.date, jam_mulai: fmtHour(b.hour), durasi: b.duration,
    total_harga: p.grandTotal, // WHY: paritas server - peak pricing + add-on dari satu rumus
    harga_lapangan: p.hargaCourt, addons: aoItems, addon_total: p.aoTotal,
    payment_option: opt,
    payment_status: opt === 'full' ? 'paid' : 'dp', status: 'active'
  };
  // WHY (FITUR 2): stempel seri SEBELUM save - demoStore menyimpan objek yang sama,
  // jadi recurring_id ikut tersimpan di localStorage.
  if (recur) { bk.recurring_id = recur.id; bk.recurring_index = recur.index; bk.recurring_total = recur.total; }
  const mine = demoStore.all(); mine.push(bk); demoStore.save(mine);
  state.myBookings.push(bk);
  // WHY (FITUR 1): patungan menggantikan simulasi bayar - tagihan ditagih per peserta lewat
  // "Tandai lunas", jadi status awal 'unpaid' (bukan 'paid'/'dp') agar konsisten dengan panel patungan.
  // WHY (FITUR 2): patungan per-minggu tidak didukung - booking dalam seri mingguan tidak membuat record patungan.
  if (!recur && b.splitCount) {
    // WHY (revisi 2026-10-11): async via splitBillLive - server hitung amounts dari total_harga di sheet.
    splitBillLive.create(bk.booking_id, b.splitCount).then(rec => {
      if (rec) {
        bk.payment_status = 'unpaid';
        if (state.data.demo) {
          const cur = mine.filter(x => x.booking_id === bk.booking_id)[0];
          if (cur) { cur.payment_status = 'unpaid'; demoStore.save(mine); }
        }
      }
    }).catch(e => toast(e.message || 'Gagal membuat patungan.', 'err'));
    b.splitCount = null; // WHY: patungan tidak diwariskan ke booking berikutnya
  }
  await loadSlots(b.date);
  trackEvent('booking_created', { venue: bk.venue_id, durasi: bk.durasi, total: bk.total_harga, addons: (bk.addons || []).length, demo: true });
  // WHY (FITUR 2): toast sukses per-seri (di demoCreateRecurring), bukan per-booking - N toast = noise.
  if (!recur) toast('Booking berhasil dibuat!', 'ok');
  return bk;
}
async function doCreateBooking(opt, silent) {
  const b = state.booking;
  const court = state.data.courts.find(c => c.id === b.court);
  // WHY: kirim add-on sebagai {id, qty} SAJA - harga tidak pernah dikirim client.
  // Server menghitung ulang dari sheet AddOn, jadi harga tidak bisa dimanipulasi dari browser.
  const addonPayload = Object.keys(b.addons || {}).map(id => ({ id: id, qty: b.addons[id] }));
  // WHY (FITUR 2): seri mingguan punya jalur sendiri - validasi atomic + N booking per seri.
  if (b.recurWeeks) {
    if (state.data.demo) return demoCreateRecurring(b, court, opt, addonPayload);
    return liveCreateRecurring(b, court, opt, addonPayload);
  }
  if (state.data.demo) return demoCreateBooking(b, court, opt, addonPayload);
  const bk = await api('createBooking', {
    venue_id: b.court, tanggal: b.date, jam_mulai: fmtHour(b.hour),
    durasi: b.duration, payment_option: opt, addons: addonPayload
  });
  state.myBookings.push(bk);
  // WHY (FITUR 1): record patungan client-side untuk booking live juga - server tidak tahu soal patungan.
  // payment_status live tetap otoritas server/webhook (tidak di-override seperti di demo).
  if (b.splitCount) {
    // WHY (revisi 2026-10-11): async via splitBillLive.
    splitBillLive.create(bk.booking_id, b.splitCount).catch(e => toast(e.message || 'Gagal membuat patungan.', 'err'));
    b.splitCount = null;
  }
  await loadSlots(b.date);
  // WHY: titik konversi utama - tanpa ini tidak ada cara mengukur funnel booking.
  trackEvent('booking_created', { venue: bk.venue_id, durasi: bk.durasi, total: bk.total_harga, addons: (bk.addons || []).length });
  // WHY (Midtrans): silent=true saat alur Snap - toast sukses hanya setelah bayar terkonfirmasi,
  // bukan saat booking (unpaid) dibuat.
  if (!silent) toast('Booking berhasil dibuat!', 'ok');
  return bk;
}
function showSuccessInModal(m, bk, court) {
  $('.modal-head h2', m.panel).textContent = 'Booking Terkonfirmasi';
  $('.modal-body', m.panel).innerHTML =
    '<div class="modal-center">' +
      '<div class="success-box">' + ICONS.check + '</div>' +
      '<span class="tag tag-ok" style="margin:0 auto">Terkonfirmasi</span>' +
      '<p class="t-sm muted" style="margin-top:12px">Tunjukkan kode ini saat check-in di venue</p>' +
      '<div class="ticket"><span class="booking-code" id="bk-code">' + esc(bk.booking_id) + '</span>' +
      '<button class="icon-btn" id="btn-copy" aria-label="Salin kode booking" style="width:44px;height:44px">' + ICONS.copy + '</button></div>' +
      '<div class="summary-rows" style="text-align:left;margin-top:8px">' +
        '<div class="row"><span class="rl">Tanggal</span><b>' + fmtDate(bk.tanggal) + '</b></div>' +
        '<div class="row"><span class="rl">Jam</span><b class="mono">' + bk.jam_mulai + ' - ' + fmtHour(parseInt(bk.jam_mulai, 10) + Number(bk.durasi)) + '</b></div>' +
        '<div class="row"><span class="rl">Lapangan</span><b>' + esc(court ? court.nama : bk.venue_id) + '</b></div>' +
        // WHY: rincian add-on ditampilkan agar penyewa tahu apa yang dibayar (dan apa yang diambil di venue)
        ((bk.addons && bk.addons.length) ? bk.addons.map(a => '<div class="row"><span class="rl">' + esc(a.nama) + ' x' + a.qty + '</span><b class="mono">' + fmtRp(a.subtotal) + '</b></div>').join('') : '') +
        '<div class="row"><span class="rl">Status bayar</span><b>' + (bk.payment_status === 'paid' ? 'Lunas' : bk.payment_status === 'dp' ? 'DP 50%, sisa di venue' : 'Belum bayar') + '</b></div>' +
      '</div>' +
      '<div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap;margin-top:8px">' +
        '<button class="btn btn-ghost" id="btn-ics">' + ICONS.download + ' Unduh Kalender (.ics)</button>' +
        '<button class="btn btn-ghost" id="btn-gcal">' + ICONS.calendar + ' Google Calendar</button>' +
        '<button class="btn btn-ghost" id="btn-wa">' + ICONS.wa + ' Bagikan via WhatsApp</button>' +
        '<button class="btn btn-primary" id="btn-gosaya">Lihat Booking Saya</button>' +
      '</div>' +
    '</div>';
  $('#btn-copy', m.panel).addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(bk.booking_id); toast('Kode booking disalin.', 'ok'); }
    catch (e) { toast('Gagal menyalin. Catat kode secara manual.', 'err'); }
  });
  $('#btn-wa', m.panel).addEventListener('click', () => shareBookingWa(bk, court));
  $('#btn-ics', m.panel).addEventListener('click', () => downloadIcs(bk, court));
  $('#btn-gcal', m.panel).addEventListener('click', () => addToGoogleCalendar(bk, court));
  $('#btn-gosaya', m.panel).addEventListener('click', () => { m.close(); state.booking.tab = 'saya'; renderBookingInner($('#view .view')); });
  // WHY (critique P3): NPS jangan interrupt momen selebrasi - tampil setelah modal sukses ditutup, bukan 2 detik setelah dibuka
  const origClose = m.close.bind(m); let npsShown = false;
  m.close = () => { origClose(); if (!npsShown) { npsShown = true; setTimeout(showNpsSurvey, 800); } };
}
/* ---------- bagikan via WhatsApp (P2-lite) ---------- */
// WHY wa.me bukan gateway: gratis, tanpa API key - cukup buka WhatsApp dengan teks terisi (PDP-safe: user yang kirim sendiri).
function shareBookingWa(bk, court) {
  const jamAkhir = fmtHour(parseInt(bk.jam_mulai, 10) + Number(bk.durasi));
  const txt = 'Booking bulu tangkis konfirmasi! Kode: ' + bk.booking_id + '\n' + fmtDate(bk.tanggal) + ', ' + bk.jam_mulai + ' - ' + jamAkhir + ' WIB\n' + (court ? court.nama : bk.venue_id) + ' - LapanganKu';
  // WHY safeUrl: teks berisi booking_id + nama lapangan (data dari server). Kalau ada karakter
  // yang membuat URL bukan https (mis. "javascript:"), jangan pernah buka. wa.me selalu https.
  window.open(safeUrl('https://wa.me/?text=' + encodeURIComponent(txt)), '_blank', 'noopener');
}
function downloadIcs(bk, court) {
  const [y, mo, d] = bk.tanggal.split('-').map(Number);
  const sh = parseInt(bk.jam_mulai, 10);
  const dt = (hh) => '' + y + pad2(mo) + pad2(d) + 'T' + pad2(hh) + '0000';
  const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//LapanganKu//Booking//ID',
    'BEGIN:VEVENT', 'UID:' + bk.booking_id + '@lapanganku',
    'DTSTAMP:' + new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, ''),
    'DTSTART;TZID=Asia/Jakarta:' + dt(sh), 'DTEND;TZID=Asia/Jakarta:' + dt(sh + Number(bk.durasi)),
    'SUMMARY:Bulu Tangkis di ' + (court ? court.nama : bk.venue_id) + ' LapanganKu',
    'LOCATION:LapanganKu, Jl. Olahraga Raya No. 8 Jakarta Selatan',
    'DESCRIPTION:Kode booking ' + bk.booking_id + ' (SIMULASI pembayaran)',
    'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([ics], { type: 'text/calendar' }));
  a.download = bk.booking_id + '.ics';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  toast('File kalender diunduh.', 'ok');
}

/* my bookings */
// WHY dipisah (audit Rule 12.1): renderMyBookings dulu 67 baris. Baris kartu booking + panel
// antrean + pengikat aksi jadi unit sendiri.
function myBookingRowHtml(b) {
  const court = state.data.courts.find(c => c.id === b.venue_id);
  const ok = canCancel(b);
  // WHY: tombol "Beri ulasan" hanya untuk booking yang SUDAH LEWAT dan belum diulas.
  // Server tetap memvalidasi ulang (reviewableBookings) - ini hanya gerbang UI.
  const canReview = isPastBooking(b) && state.reviewed.indexOf(b.booking_id) === -1;
  // WHY (FITUR 2): badge seri + aksi seri; booking recurring mengganti tombol "Batalkan"
  // tunggal dengan "Lewati minggu ini" (1 jadwal) + "Batalkan seri" (semua jadwal tersisa).
  const recurBadge = b.recurring_id ? '<span class="tag tag-brand">Mingguan ' + b.recurring_index + '/' + b.recurring_total + '</span>' : '';
  // WHY (FITUR 3): "Catat skor" hanya untuk booking selesai (active & tanggal lewat) yang belum dicatat -
  // satu booking = satu match tercatat, rating tidak bisa digelembungkan ulang.
  const canScore = b.status === 'active' && b.tanggal < todayStr() && !skillStore.recorded(b.booking_id);
  const cancelBtns = b.status === 'active'
    ? (b.recurring_id
      ? '<button class="btn btn-ghost btn-sm" data-recur-skip="' + esc(b.booking_id) + '" ' + (ok ? '' : 'disabled title="Batal maksimal 2 jam sebelum jadwal"') + '>' + ICONS.x + ' Lewati minggu ini</button>' +
        '<button class="btn btn-ghost btn-sm" data-recur-cancel="' + esc(b.recurring_id) + '">' + ICONS.trash + ' Batalkan seri</button>'
      : '<button class="btn btn-danger btn-sm" data-cancel="' + esc(b.booking_id) + '" ' + (ok ? '' : 'disabled title="Batal maksimal 2 jam sebelum jadwal"') + '>' + ICONS.trash + ' Batalkan</button>')
    : '';
  return '<div class="my-booking">' +
    '<div><div class="mb-when">' + fmtDate(b.tanggal) + ' - ' + b.jam_mulai + ' - ' + fmtHour(parseInt(b.jam_mulai, 10) + Number(b.durasi)) + '</div>' +
    '<div class="mb-meta">' + esc(court ? court.nama : b.venue_id) + ' - ' + esc(b.booking_id) + ' - ' + fmtRp(b.total_harga) + '</div></div>' +
    '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">' +
      payTag(b) + statusTag(b) + recurBadge +
      // WHY (Midtrans): booking 'unpaid' bisa dibayar ulang (user tutup popup dsb).
      // Hanya di mode live; demo pakai simulasi di modal awal.
      (!state.data.demo && b.status === 'active' && b.payment_status !== 'paid' && b.payment_status !== 'dp' ? '<button class="btn btn-primary btn-sm" data-paynow="' + esc(b.booking_id) + '">' + ICONS.card + ' Bayar</button>' : '') +
      (canReview ? '<button class="btn btn-primary btn-sm" data-review="' + esc(b.booking_id) + '">' + ICONS.star + ' Beri ulasan</button>' : '') +
      (canScore ? '<button class="btn btn-primary btn-sm" data-score="' + esc(b.booking_id) + '">' + ICONS.chart + ' Catat skor</button>' : '') +
      (b.status === 'active' ? '<button class="btn btn-ghost btn-sm" data-wa="' + esc(b.booking_id) + '">' + ICONS.wa + ' Bagikan</button>' : '') +
      '<button class="btn btn-ghost btn-sm" data-invoice="' + esc(b.booking_id) + '">' + ICONS.doc + ' Invoice</button>' +
      (b.status === 'active' ? '<button class="btn btn-ghost btn-sm" data-reschedule="' + esc(b.booking_id) + '" ' + (ok ? '' : 'disabled title="Reschedule maksimal 2 jam sebelum jadwal"') + '>' + ICONS.calendar + ' Reschedule</button>' : '') +
      cancelBtns +
    '</div></div>' + splitBillPanelHtml(b);
}
function bindMyBookings(main) {
  $$('[data-cancel]', main).forEach(btn => btn.addEventListener('click', () => askCancel(btn.dataset.cancel)));
  // WHY (FITUR 2): "Lewati minggu ini" = batalkan 1 jadwal (modal konfirmasi yang sama);
  // "Batalkan seri" = batalkan semua jadwal tersisa dalam satu seri.
  $$('[data-recur-skip]', main).forEach(btn => btn.addEventListener('click', () => askCancel(btn.dataset.recurSkip)));
  $$('[data-recur-cancel]', main).forEach(btn => btn.addEventListener('click', () => askCancelSeries(btn.dataset.recurCancel)));
  $$('[data-paynow]', main).forEach(btn => btn.addEventListener('click', () => payExistingBooking(btn.dataset.paynow)));
  $$('[data-reschedule]', main).forEach(btn => btn.addEventListener('click', () => openRescheduleModal(btn.dataset.reschedule)));
  $$('[data-invoice]', main).forEach(btn => btn.addEventListener('click', () => openInvoiceModal(btn.dataset.invoice)));
  $$('[data-review]', main).forEach(btn => btn.addEventListener('click', () => openReviewModal(btn.dataset.review)));
  $$('[data-score]', main).forEach(btn => btn.addEventListener('click', () => openScoreModal(btn.dataset.score))); // WHY (FITUR 3): catat skor match -> update rating Elo
  const redeemBtn = $('#loyalty-redeem', main);
  bindSplitBill(main); // WHY (FITUR 1): aksi "Tandai lunas" / "Tutup patungan" per booking
  $$('[data-wa]', main).forEach(btn => btn.addEventListener('click', () => {
    const bk = state.myBookings.find(x => x.booking_id === btn.dataset.wa);
    if (bk) shareBookingWa(bk, state.data.courts.find(c => c.id === bk.venue_id));
  }));
  $$('[data-wl-cancel]', main).forEach(btn => btn.addEventListener('click', async () => {
    try {
      if (state.data.demo) {
        const all = demoWaitlistStore.all().map(w => (w.email === state.user.email && w.tanggal === btn.dataset.tanggal && parseInt(w.jam_mulai, 10) === Number(btn.dataset.jam)) ? Object.assign(w, { status: 'cancelled' }) : w);
        demoWaitlistStore.save(all);
      } else {
        await api('waitlistCancel', { tanggal: btn.dataset.tanggal, jam_mulai: Number(btn.dataset.jam) });
      }
      await loadMyBookings();
      route();
      toast('Antrean dibatalkan.', 'ok');
    } catch (e) { toast(e.message || 'Gagal membatalkan antrean', 'err'); }
  }));
}
function renderMyBookings(main) {
  // WHY (revisi 2026-10-11): loyalty dual-path. Prefetch async dari server (live) atau
  // localStorage (demo), lalu render. Panel update otomatis saat data tiba.
  loyaltyLive.creditPending().then(() => loyaltyLive.fetch()).then(ld => {
    state.loyaltyData = ld;
    const panel = $('#loyalty-panel', main);
    if (panel) panel.outerHTML = loyaltyHeaderHtml();
  });
  // render awal dengan data lokal/cache agar tidak blank
  if (!state.loyaltyData) {
    const d = loyaltyStore.all();
    state.loyaltyData = { balance: d.points, history: d.history.slice(-5).reverse(), rewards: loyaltyRewards(), live: false };
  }
  const list = state.myBookings.slice().sort((a, b) => (b.tanggal + b.jam_mulai).localeCompare(a.tanggal + a.jam_mulai));
  const up = list.filter(b => b.status === 'active' && (b.tanggal > todayStr() || (isToday(b.tanggal) && parseInt(b.jam_mulai, 10) * 60 > nowMin())));
  const past = list.filter(b => !up.includes(b));
  const row = myBookingRowHtml;
  // WHY: kalau pemuatan GAGAL, tampilkan error state + tombol coba lagi - bukan empty state.
  // Menampilkan "Belum ada booking" saat gagal memuat membuat user mengira booking-nya hilang.
  if (state.loadError === 'booking') {
    main.innerHTML = errorStateHtml(ICONS.alert, 'Gagal memuat booking',
      'Koneksi ke server bermasalah. Booking kamu tetap aman - coba muat ulang.', 'Coba lagi', 'btn-retry-booking');
    const rb = $('#btn-retry-booking', main);
    if (rb) rb.addEventListener('click', async () => {
      state.loadError = null;
      await loadMyBookings();
      renderBookingInner($('#view .view'));
    });
    return;
  }
  main.innerHTML =
    skillHeaderHtml() + // WHY (FITUR 3): badge rating + riwayat match singkat di atas "Booking Saya"
    loyaltyHeaderHtml() + // WHY (FITUR 5, revisi 2026-10-11): poin + katalog reward + riwayat
    '<div class="panel"><h3>Mendatang</h3>' +
      (up.length ? up.map(row).join('') : emptyStateHtml(ICONS.calendar, 'Belum ada booking mendatang', 'Amankan slot. Pilih jam dan lapangan yang tersedia.', 'Booking Sekarang', 'btn-empty-booking')) +
    '</div>' +
    (state.waitlist.length ? waitlistPanelHtml() : emptyStateHtml(ICONS.bell, 'Belum ada antrean', 'Ketika slot yang kamu mau penuh, kamu bisa antre dan dapat email otomatis saat slot dibuka.', null, null)) +
    '<div class="panel" style="margin-top:16px"><h3>Riwayat</h3>' +
      (past.length ? past.map(row).join('') : emptyStateHtml(ICONS.clock, 'Riwayat masih kosong', 'Booking yang sudah lewat akan muncul di sini.', null, null)) +
    '</div>';
  const emptyBtn = $('#btn-empty-booking', main);
  if (emptyBtn) emptyBtn.addEventListener('click', () => { state.booking.tab = 'baru'; renderBookingInner($('#view .view')); });
  bindMyBookings(main);
  bindLoyaltyRewards(main); // WHY (revisi 2026-10-11): tombol tukar reward di header loyalty
}
function waitlistPanelHtml() {
  // WHY: pecahan renderMyBookings (Rule 12.1) - panel antrean slot
  return '<div class="panel" style="margin-top:16px"><h3>Antrean slot</h3>' +
    '<p class="t-sm muted" style="margin-bottom:12px">Kamu dapat email otomatis saat slot ini dibuka karena pembatalan.</p>' +
    state.waitlist.map(w =>
      '<div class="my-booking"><div><div class="mb-when">' + fmtDate(w.tanggal) + ' - ' + w.jam_mulai + ' (' + w.durasi + ' jam)</div>' +
      '<div class="mb-meta">' + ICONS.bell + ' Antre aktif - slot penuh saat ini</div></div>' +
      '<button class="btn btn-ghost btn-sm" data-wl-cancel data-tanggal="' + esc(w.tanggal) + '" data-jam="' + parseInt(w.jam_mulai, 10) + '">Batalkan antrean</button></div>'
    ).join('') +
  '</div>';
}
// payTag/statusTag pindah ke core (rev 3z) - dipakai juga chunk monitoring (tabel owner)
function askCancel(id) {
  const b = state.myBookings.find(x => x.booking_id === id);
  if (!b || !canCancel(b)) return;
  const court = state.data.courts.find(c => c.id === b.venue_id);
  const m = Modal.open({
    title: 'Batalkan Booking?',
    body: '<p class="t-sm muted">' + fmtDate(b.tanggal) + ' - ' + b.jam_mulai + ' di ' + esc(court ? court.nama : b.venue_id) + ' akan dibatalkan. Slot langsung terbuka untuk orang lain.</p>' +
      '<div style="display:flex;gap:8px;margin-top:16px"><button class="btn btn-ghost" data-no style="flex:1">Kembali</button>' +
      '<button class="btn btn-danger" data-yes style="flex:1"><span class="spin" aria-hidden="true"></span>Ya, Batalkan</button></div>',
    onMount: (panel) => {
      $('[data-no]', panel).addEventListener('click', () => m.close());
      $('[data-yes]', panel).addEventListener('click', async (e) => {
        const btn = e.currentTarget; btn.classList.add('loading');
        m.lock(true); // WHY: cegah tutup modal di tengah proses cancel
        try {
          await doCancelBooking(b);
          btn.classList.remove('loading');
          m.lock(false);
          m.close();
          toast('Booking dibatalkan. Slot sudah dibuka untuk orang lain.', 'info');
          renderBookingInner($('#view .view'));
        } catch (err) {
          btn.classList.remove('loading');
          m.lock(false);
          const cut = state.data.config.cancel_cutoff_hours || 2;
          toast(err.code === 'CUTOFF_PASSED' ? 'Batas cancel sudah lewat (' + cut + ' jam sebelum jadwal).' : 'Gagal membatalkan: ' + err.message, 'err');
        }
      });
    }
  });
}
// WHY dipisah (audit Rule 12.1): openRescheduleModal dulu 71 baris - pembuatan form, pemuatan
// slot, dan aksi simpan bercampur. Kini: builder form + loader slot + handler simpan.
function rescheduleFormHtml(b, court) {
  const maxD = ymd(addDays(new Date(), 14));
  return '<p class="t-sm muted">Pilih tanggal dan jam baru untuk booking <b>' + esc(b.booking_id) + '</b> di ' + esc(court ? court.nama : b.venue_id) + '.</p>' +
    '<div class="fld" style="margin-top:12px"><label class="fld-label" for="rs-date">Tanggal baru</label><input type="date" id="rs-date" value="' + b.tanggal + '" min="' + todayStr() + '" max="' + maxD + '" style="width:100%"></div>' +
    '<div class="fld" style="margin-top:8px"><label class="fld-label" for="rs-hour">Jam baru</label><select id="rs-hour" style="width:100%"></select></div>' +
    '<div id="rs-slots" style="margin-top:12px"></div>' +
    '<div style="display:flex;gap:8px;margin-top:16px"><button class="btn btn-ghost" data-no style="flex:1">Kembali</button>' +
    '<button class="btn btn-primary" data-yes style="flex:1" disabled><span class="spin" aria-hidden="true"></span>Reschedule</button></div>';
}
// WHY menerima konteks eksplisit: dulu closure - dipisah agar bisa dibaca sebagai unit.
async function fillRescheduleSlots(panel, b) {
  const dateInput = $('#rs-date', panel), hourSelect = $('#rs-hour', panel);
  const slotsDiv = $('#rs-slots', panel), yesBtn = $('[data-yes]', panel);
  const d = dateInput.value;
  if (!d) return;
  slotsDiv.innerHTML = '<p class="t-sm muted">Memuat slot...</p>';
  await loadSlots(d);
  // WHY (Batch A): guard generasi — user ganti tanggal 2x cepat -> respons basi jangan render
  // jam milik tanggal lama sementara dateInput sudah tanggal baru (pasangan tanggal+jam salah).
  if (dateInput.value !== d || !panel.isConnected) return;
  const hours = hoursRange(state.data.config).filter(h => bookingCourts().some(c => courtFree(c.id, d, h, b.durasi)));
  if (!hours.length) {
    slotsDiv.innerHTML = '<p class="t-sm muted">Tidak ada slot tersedia pada tanggal ini.</p>';
    hourSelect.innerHTML = ''; yesBtn.disabled = true; return;
  }
  hourSelect.innerHTML = hours.map(h => '<option value="' + h + '">' + fmtHour(h) + ' WIB</option>').join('');
  slotsDiv.innerHTML = '<p class="t-sm muted">' + hours.length + ' jam tersedia</p>';
  yesBtn.disabled = false;
}
async function rescheduleSubmit(panel, m, b) {
  const dateInput = $('#rs-date', panel), hourSelect = $('#rs-hour', panel);
  const btn = $('[data-yes]', panel);
  const newDate = dateInput.value, newHour = hourSelect.value;
  if (!newDate || !newHour) return;
  btn.classList.add('loading');
  m.lock(true);
  try {
    await api('rescheduleBooking', { booking_id: b.booking_id, new_date: newDate, new_hour: newHour });
    btn.classList.remove('loading');
    m.lock(false);
    m.close();
    toast('Booking direschedule ke ' + fmtDate(newDate) + ' jam ' + fmtHour(Number(newHour)) + '.', 'ok');
    renderBookingInner($('#view .view'));
  } catch (err) {
    btn.classList.remove('loading');
    m.lock(false);
    toast(err.message || 'Gagal reschedule', 'err');
  }
}
function openRescheduleModal(id) {
  const b = state.myBookings.find(x => x.booking_id === id);
  if (!b || !canCancel(b)) return;
  const court = state.data.courts.find(c => c.id === b.venue_id);
  const m = Modal.open({
    title: 'Reschedule Booking',
    body: rescheduleFormHtml(b, court),
    onMount: (panel) => {
      $('[data-no]', panel).addEventListener('click', () => m.close());
      $('#rs-hour', panel).addEventListener('change', () => { $('[data-yes]', panel).disabled = !$('#rs-hour', panel).value; });
      $('#rs-date', panel).addEventListener('change', () => fillRescheduleSlots(panel, b));
      $('[data-yes]', panel).addEventListener('click', () => rescheduleSubmit(panel, m, b));
      // WHY nama berbeda (audit P1-1): dulu fungsi lokal ini bernama loadSlots sehingga
      // memanggil DIRINYA SENDIRI -> rekursi tak terbatas -> RangeError, modal macet di
      // "Memuat slot..." dan tombol Reschedule tetap disabled.
      fillRescheduleSlots(panel, b);
    }
  });
}
function openInvoiceModal(id) {
  const b = state.myBookings.find(x => x.booking_id === id);
  if (!b) return;
  const court = state.data.courts.find(c => c.id === b.venue_id);
  const cfg = state.data.config;
  const m = Modal.open({
    title: 'Invoice ' + b.booking_id,
    body: '<div id="invoice-content" style="background:var(--bg);border:1px solid var(--border);border-radius:var(--r-md);padding:24px;font-size:14px">' +
      '<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:24px">' +
        '<div><div style="font-size:20px;font-weight:var(--fw-bold)">LapanganKu</div>' +
        '<div class="t-xs muted">Jl. Olahraga Raya No. 8, Jakarta Selatan</div></div>' +
        '<div style="text-align:right"><div style="font-size:12px;font-weight:var(--fw-semibold);color:var(--text3)">INVOICE</div>' +
        '<div class="t-xs muted">' + esc(b.booking_id) + '</div></div></div>' +
      '<div style="border-top:1px solid var(--border);border-bottom:1px solid var(--border);padding:12px 0;margin-bottom:16px">' +
        '<div style="display:flex;justify-content:space-between"><span class="muted">Tanggal</span><b>' + fmtDate(b.tanggal) + '</b></div>' +
        '<div style="display:flex;justify-content:space-between;margin-top:4px"><span class="muted">Jam</span><b class="mono">' + b.jam_mulai + ' - ' + fmtHour(parseInt(b.jam_mulai, 10) + Number(b.durasi)) + ' WIB</b></div>' +
        '<div style="display:flex;justify-content:space-between;margin-top:4px"><span class="muted">Lapangan</span><b>' + esc(court ? court.nama : b.venue_id) + '</b></div>' +
        '<div style="display:flex;justify-content:space-between;margin-top:4px"><span class="muted">Durasi</span><b>' + b.durasi + ' jam</b></div></div>' +
      '<div style="margin-bottom:16px">' +
        '<div style="display:flex;justify-content:space-between"><span class="muted">Harga per jam</span><span>' + fmtRp(b.total_harga / b.durasi) + '</span></div>' +
        '<div style="display:flex;justify-content:space-between;margin-top:8px;padding-top:8px;border-top:1px solid var(--border2)"><b>Total</b><b style="font-size:18px">' + fmtRp(b.total_harga) + '</b></div></div>' +
      '<div style="display:flex;justify-content:space-between;margin-bottom:16px">' +
        '<div><div class="t-xs muted">Status Pembayaran</div><b>' + (b.payment_status === 'paid' ? 'Lunas' : b.payment_status === 'dp' ? 'DP 50%' : 'Belum Bayar') + '</b></div>' +
        '<div style="text-align:right"><div class="t-xs muted">Metode</div><b>' + esc(b.payment_option || '-') + '</b></div></div>' +
      '<div style="border-top:1px solid var(--border);padding-top:12px;text-align:center" class="t-xs muted">Terima kasih sudah booking di LapanganKu. Sampai jumpa di lapangan!</div></div>' +
      '<div style="display:flex;gap:8px;margin-top:16px"><button class="btn btn-ghost" data-no style="flex:1">Tutup</button>' +
      '<button class="btn btn-primary" data-print style="flex:1"><span class="spin" aria-hidden="true"></span>Cetak / PDF</button></div>',
    onMount: (panel) => {
      $('[data-no]', panel).addEventListener('click', () => m.close());
      $('[data-print]', panel).addEventListener('click', () => {
        const content = $('#invoice-content', panel).innerHTML;
        const win = window.open('', '_blank', 'width=800,height=600');
        win.document.write('<html><head><title>Invoice ' + esc(b.booking_id) + '</title><style>body{font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text",sans-serif;padding:40px;color:#161B10;background:#fff} .t-xs{font-size:12px}.muted{color:#68735F}.mono{font-variant-numeric:tabular-nums}</style></head><body>' + content + '</body></html>');
        win.document.close();
        win.focus();
        win.print();
      });
    }
  });
}
async function doCancelBooking(b) {
  if (state.data.demo) {
    const all = demoStore.all();
    const i = all.findIndex(x => x.booking_id === b.booking_id);
    if (i >= 0) { all[i].status = 'cancelled'; demoStore.save(all); }
    else { const j = state.myBookings.findIndex(x => x.booking_id === b.booking_id); if (j >= 0) state.myBookings[j].status = 'cancelled'; }
    // WHY: DEMO_BOOKINGS adalah array statis — status pembatalan tidak tersimpan di sana.
    // Tanpa ini, loadSlots masih melihat slot terisi setelah pembatalan.
    const k = DEMO_BOOKINGS.findIndex(x => x.booking_id === b.booking_id);
    if (k >= 0) DEMO_BOOKINGS[k].status = 'cancelled';
    // WHY b.tanggal (bukan b.date): objek booking memakai field `tanggal`; b.date = undefined
    // sehingga slot tanggal booking tidak pernah di-refresh setelah cancel di mode demo.
    await loadSlots(b.tanggal);
    await loadMyBookings();
    return;
  }
  await api('cancelBooking', { booking_id: b.booking_id });
  await loadSlots(b.tanggal);
  await loadMyBookings();
}

function addToGoogleCalendar(bk, court) {
  const [y, mo, d] = bk.tanggal.split('-');
  const sh = parseInt(bk.jam_mulai, 10);
  const eh = sh + Number(bk.durasi);
  const dt = (hh) => '' + y + pad2(mo) + pad2(d) + 'T' + pad2(hh) + '0000';
  const url = 'https://calendar.google.com/calendar/render?action=TEMPLATE' +
    '&text=' + encodeURIComponent('Bulu Tangkis di ' + (court ? court.nama : bk.venue_id)) +
    '&dates=' + dt(sh) + '/' + dt(eh) +
    '&details=' + encodeURIComponent('Kode booking: ' + bk.booking_id + '\nTotal: ' + fmtRp(bk.total_harga)) +
    '&location=' + encodeURIComponent('LapanganKu, Jl. Olahraga Raya No. 8 Jakarta Selatan');
  window.open(url, '_blank', 'noopener');
  toast('Membuka Google Calendar.', 'info');
}

function showNpsSurvey() {
  const lastNps = store.get('lk-last-nps', 0);
  const now = Date.now();
  // Show NPS every 30 days or after 3 bookings
  if (now - lastNps < 30 * 24 * 60 * 60 * 1000) return;
  const bookingCount = state.myBookings.length;
  if (bookingCount < 3) return;
  
  const m = Modal.open({
    title: 'Seberapa puas kamu?',
    body: '<p class="t-sm muted" style="margin-bottom:16px">Bantu kami memahami pengalamanmu di LapanganKu.</p>' +
      '<div class="rating-pick" role="radiogroup" aria-label="Rating 1 sampai 10" style="justify-content:center">' +
        [1,2,3,4,5,6,7,8,9,10].map(n => '<button type="button" class="rating-btn" data-nps="' + n + '" style="width:36px;height:36px;font-size:14px">' + n + '</button>').join('') +
      '</div>' +
      '<p class="t-xs faint" style="margin-top:8px;text-align:center">1 = Tidak puas, 10 = Sangat puas</p>',
    onMount: (panel) => {
      $$('.rating-btn', panel).forEach(btn => {
        btn.addEventListener('click', () => {
          const score = Number(btn.dataset.nps);
          store.set('lk-last-nps', now);
          store.set('lk-nps-score', score);
          m.close();
          toast('Terima kasih atas masukanmu!', 'ok');
          trackEvent('nps_submitted', { score });
        });
      });
    }
  });
}

function bindSlotGridDelegation(main) {
  const slotGrid = $('#slot-grid', main);
  if (slotGrid && !slotGrid.dataset.delegated) {
    slotGrid.dataset.delegated = '1';
    slotGrid.addEventListener('click', (e) => {
      const slot = e.target.closest('.slot');
      if (!slot || slot.disabled) return;
      const b = state.booking;
      if (slot.classList.contains('free')) {
        b.hour = Number(slot.dataset.hour); b.court = null; bookingSaveDraft(); renderBookingNew(main);
      } else if (slot.classList.contains('booked')) {
        openWaitlistModal(Number(slot.dataset.hour));
      }
    });
  }
}

function bindDateChipDelegation(main) {
  const dateScroll = $('#date-scroll', main);
  if (dateScroll && !dateScroll.dataset.delegated) {
    dateScroll.dataset.delegated = '1';
    dateScroll.addEventListener('click', (e) => {
      const ch = e.target.closest('.date-chip');
      if (!ch) return;
      const b = state.booking;
      b.date = ch.dataset.date; b.hour = null; b.court = null; bookingSaveDraft(); renderBookingNew(main);
    });
  }
}

