/* LAPANGANKU chunk landing: dimuat on-demand saat mode live (di demo, SSR shell dipakai tanpa file ini).
   Split hasil audit Lighthouse rev 3x; fungsi tetap global (script klasik). */
/* ---------- court diagram (technical drawing, bukan stock) ---------- */
/* ---------- landing ---------- */
// WHY array pasangan [ikon, label]: ikon berupa SVG inline dari ICONS (Lucide, ISC),
// jadi strip fasilitas tidak menambah request gambar - satu bundle, satu gaya stroke.
const LANDING_FACS = [
  ['facCar', 'Parkir mobil & motor'],
  ['facLock', 'Locker & kamar mandi'],
  ['facBag', 'Rental raket + shuttle'],
  ['facUtensils', 'Kantin'],
  ['facArmchair', 'Ruang tunggu'],
  ['facBulb', 'Penerangan standar'],
  ['facMoonStar', 'Musala'],
  ['facWifi', 'Wi-Fi gratis']
];
// WHY: FAQ harga dinamis dari tarif aktual (real data only, Rule 1.8) - jadi fungsi, bukan konstanta
// WHY: peakCfg di-cache agar tidak dihitung berulang setiap render
var _peakCfgCache = null;
function cachedPeakCfg() {
  if (!_peakCfgCache) _peakCfgCache = peakCfg();
  return _peakCfgCache;
}
function landingFaqs(minPrice) {
  var p = cachedPeakCfg();
  var o = offCfg();
  var offNote = (o.hours.length && o.mult < 1)
    ? ' Jam sepi (' + o.hours.map(function (h) { return fmtHour(h); }).join(', ') + ' WIB hari kerja) cuma ' + fmtRp(Math.round(minPrice * o.mult)) + ' per jam.'
    : '';
  return [
    ['Bisa batal kalau tiba-tiba ada urusan?', 'Bisa. Cancel gratis sampai 2 jam sebelum jam main, slot langsung dibuka untuk orang lain.'],
    ['Harga sudah termasuk apa saja?', (p.hours.length && p.mult > 1
      ? 'Harga dasar ' + fmtRp(minPrice) + ' per jam per lapangan; jam sibuk ' + fmtRp(Math.round(minPrice * p.mult)) + ' per jam.' + offNote + ' Rental raket dan shuttle dihitung terpisah di tempat.'
      : 'Harga flat ' + fmtRp(minPrice) + ' per jam per lapangan, termasuk akhir pekan.' + offNote + ' Rental raket dan shuttle dihitung terpisah di tempat.')],
    ['Kapan jam paling murah?', (o.hours.length && o.mult < 1
      ? 'Jam sepi: ' + o.hours.map(function (h) { return fmtHour(h); }).join(', ') + ' WIB hari kerja, diskon ' + Math.round((1 - o.mult) * 100) + '%. Cocok buat latihan pagi sebelum kerja atau main malam setelah jam ramai.'
      : 'Harga sama di semua jam.')],
    ['Bawa apa saja ke venue?', 'Cukup baju olahraga. Kalau lupa raket atau shuttle, tinggal sewa di kantin kami.'],
    ['Berapa lama minimal dan maksimal sewa?', 'Minimal 1 jam, maksimal 3 jam dalam satu booking. Mau main lebih lama? Booking lagi di jam berikutnya.'],
    ['Kalau datang langsung tanpa booking?', 'Boleh, tapi slot bisa saja penuh. Amankan slot lewat web ini sebelum penuh.']
  ];
}
function landingStripCell(l, v) { return '<div class="cell"><div class="cl">' + l + '</div><div class="cv">' + v + '</div></div>'; }
function landingHeroHtml(cfg, courts, minPrice) {
  return '<section class="hero">' +
    '<div class="hero-grid">' +
      '<div class="hero-copy">' +
        '<p class="kicker">LapanganKu</p>' +
        '<h1 class="display">Pilih jam.<br>Bayar. Main.</h1>' +
        '<p class="lede-hero">Empat lapangan standar pertandingan, buka setiap hari pukul 06.00 sampai 22.00. Booking online tanpa telepon, slot terkunci begitu bayar.</p>' +
        '<div class="hero-cta">' +
          '<a class="btn btn-primary" href="#/booking">Booking Sekarang</a>' + /* WHY: 1 CTA primer sesuai RULES 3 */
          '<button class="link-arrow" data-scroll="#harga">Lihat lapangan &amp; harga ' + ICONS.chev + '</button>' +
        '</div>' +
      '</div>' +
      '<figure class="hero-media">' +
        /* WHY: foto venue self-hosted hasil generate AI (source PNG di images/source/).
           <picture> + source WebP: hemat ~61-65% vs JPEG, browser tanpa WebP otomatis fallback JPEG.
           width/height anti-CLS; eager karena hero = LCP; srcset 640w untuk mobile. */
        '<picture>' +
          /* WHY Lighthouse CLS/LCP: webp srcset di <img> (bukan hanya di <source>) - trace LH menunjukkan browser memilih
           file .webp TANPA kandidat srcset inline lalu swap ke .webp 1280w saat source match = shift besar.
           width/height atribut dibuang: aspect-ratio di <picture> sudah mencadangkan ruang sejak frame pertama,
           dua mekanisme bersamaan memicu 'media element lacking explicit size' + reflow saat srcset swap. */
        '<source type="image/webp" srcset="images/webp/court-hero-sm.webp 640w, images/webp/court-hero-md.webp 720w, images/webp/court-hero.webp 1280w" sizes="(max-width:900px) 92vw, 560px">' +
          '<img src="images/court-hero-md.jpg" srcset="images/court-hero-sm.jpg 640w, images/court-hero-md.jpg 720w, images/court-hero.jpg 1280w" sizes="(max-width:900px) 92vw, 560px" alt="Lapangan indoor dengan net dan garis lapangan" fetchpriority="high" loading="eager" decoding="async">' +
        '</picture>' +

      '</figure>' +
    '</div>' +
    '<div class="strip" aria-label="Ringkasan venue">' +
      landingStripCell('Jam operasional', '06.00 - 22.00 WIB') +
      landingStripCell('Lapangan aktif', courts.length + ' unit') +
      landingStripCell('Harga dasar', fmtRp(minPrice) + ' /jam') +
      landingStripCell('Batas booking', 'Maks H-14 / lead 2 jam') +
    '</div>' +
  '</section>';
}
// WHY: galeri foto venue (P2): 3 foto self-hosted hasil generate AI (lazy, dimensi eksplisit anti-CLS).
// <picture> + source WebP (~56-64% lebih kecil dari JPEG); fallback JPEG utk browser tanpa WebP.
// Source PNG resolusi penuh di images/source/ untuk regenerate ukuran lain.
function galleryHtml() {
  return '<div class="gallery" data-stagger aria-label="Galeri venue">' +
    '<figure><picture><source type="image/webp" srcset="images/webp/venue-g1-sm.webp 640w, images/webp/venue-g1-md.webp 720w, images/webp/venue-g1.webp 960w" sizes="(max-width:768px) 92vw, 45vw"><img src="images/venue-g1.jpg" srcset="images/venue-g1-sm.jpg 640w, images/venue-g1-md.jpg 720w, images/venue-g1.jpg 960w" sizes="(max-width:768px) 92vw, 45vw" width="960" height="640" loading="lazy" decoding="async" alt="Shuttlecock tersangkut di net lapangan"></picture></figure>' +
    '<figure><picture><source type="image/webp" srcset="images/webp/venue-g2-sm.webp 426w, images/webp/venue-g2.webp" sizes="(max-width:768px) 46vw, 21vw"><img src="images/venue-g2.jpg" srcset="images/venue-g2-sm.jpg 426w, images/venue-g2.jpg" sizes="(max-width:768px) 46vw, 21vw" width="426" height="640" loading="lazy" decoding="async" alt="Raket dan shuttlecock di lapangan"></picture></figure>' +
    '<figure><picture><source type="image/webp" srcset="images/webp/venue-g3-sm.webp 480w, images/webp/venue-g3.webp" sizes="(max-width:768px) 46vw, 21vw"><img src="images/venue-g3.jpg" srcset="images/venue-g3-sm.jpg 480w, images/venue-g3.jpg" sizes="(max-width:768px) 46vw, 21vw" width="480" height="640" loading="lazy" decoding="async" alt="Siluet dua pemain sedang rally di lapangan"></picture></figure>' +
  '</div>';
}
// WHY: aturan venue + kebijakan refund/reschedule (adopsi pola AYO). AYO menaruh ini di halaman
// detail venue - menjawab keraguan tepat sebelum orang bayar. LapanganKu sebelumnya hanya
// menyebut "cancel 2 jam" di satu FAQ, padahal ini yang paling sering jadi sumber komplain.
// WHY dipecah 4 kartu (bukan 2 kartu panjang): teks kebijakan menumpuk di satu kartu
// membuat tinggi kartu jauh beda (kanan jauh lebih padat dari kiri) dan sulit dipindai.
// Dipecah per topik - aturan / pembatalan / reschedule / pembayaran - tiap kartu jadi
// ringkas, seimbang, dan pembaca langsung menemukan topik yang dicari.
function landingRulesHtml() {
  const cfg = state.data.config;
  const cutoff = cfg.cancel_cutoff_hours || 2;
  return '<section class="section sec" aria-labelledby="h2-aturan">' +
    '<div class="sec-rule reveal"><span class="mlabel"><b>04</b>&nbsp;&nbsp;Aturan &amp; kebijakan</span></div>' +
    '<h2 id="h2-aturan" class="reveal">Aturan venue &amp; kebijakan.</h2>' +
    '<p class="lede reveal">Supaya main nyaman buat semua orang, ini aturan yang kami terapkan. Klik untuk buka.</p>' +
    '<div class="rules-acc" data-stagger>' +
      '<div class="rules-acc-item">' +
        '<button class="rules-acc-head" aria-expanded="false" onclick="this.setAttribute(\'aria-expanded\', this.getAttribute(\'aria-expanded\') !== \'true\'); this.parentElement.classList.toggle(\'open\')">' +
          '<span class="rules-icon" aria-hidden="true">' + ICONS.ruleShield + '</span><span>Aturan venue</span><span class="rules-chev" aria-hidden="true">▾</span>' +
        '</button>' +
        '<div class="rules-acc-body"><ul class="rules-list">' +
          '<li>Wajib pakai sepatu olahraga dengan sol karet - sol hitam kasar bisa meninggalkan bekas di matras.</li>' +
          '<li>Bawa raket dan shuttle sendiri, atau sewa di kantin venue.</li>' +
          '<li>Dilarang makan dan minum selain air di area lapangan.</li>' +
          '<li>Datang 10 menit sebelum jadwal untuk check-in di resepsionis.</li>' +
          '<li>Jaga kebersihan - buang sampah pada tempatnya.</li>' +
        '</ul></div>' +
      '</div>' +
      '<div class="rules-acc-item">' +
        '<button class="rules-acc-head" aria-expanded="false" onclick="this.setAttribute(\'aria-expanded\', this.getAttribute(\'aria-expanded\') !== \'true\'); this.parentElement.classList.toggle(\'open\')">' +
          '<span class="rules-icon" aria-hidden="true">' + ICONS.ruleCancel + '</span><span>Pembatalan</span><span class="rules-chev" aria-hidden="true">▾</span>' +
        '</button>' +
        '<div class="rules-acc-body"><ul class="rules-list">' +
          '<li><b>Batal gratis</b>: sampai ' + cutoff + ' jam sebelum jam main - slot langsung dibuka untuk orang lain.</li>' +
          '<li>Lewat batas ' + cutoff + ' jam, booking tidak bisa dibatalkan dan pembayaran tidak dikembalikan.</li>' +
          '<li>Booking yang tidak dihadiri (no-show) dianggap selesai - tidak ada refund.</li>' +
        '</ul></div>' +
      '</div>' +
      '<div class="rules-acc-item">' +
        '<button class="rules-acc-head" aria-expanded="false" onclick="this.setAttribute(\'aria-expanded\', this.getAttribute(\'aria-expanded\') !== \'true\'); this.parentElement.classList.toggle(\'open\')">' +
          '<span class="rules-icon" aria-hidden="true">' + ICONS.ruleResched + '</span><span>Reschedule</span><span class="rules-chev" aria-hidden="true">▾</span>' +
        '</button>' +
        '<div class="rules-acc-body"><ul class="rules-list">' +
          '<li><b>Gratis 1 kali</b>: maksimal ' + cutoff + ' jam sebelum jadwal, selama slot tujuan tersedia.</li>' +
        '</ul></div>' +
      '</div>' +
      '<div class="rules-acc-item">' +
        '<button class="rules-acc-head" aria-expanded="false" onclick="this.setAttribute(\'aria-expanded\', this.getAttribute(\'aria-expanded\') !== \'true\'); this.parentElement.classList.toggle(\'open\')">' +
          '<span class="rules-icon" aria-hidden="true">' + ICONS.rulePay + '</span><span>Pembayaran</span><span class="rules-chev" aria-hidden="true">▾</span>' +
        '</button>' +
        '<div class="rules-acc-body"><ul class="rules-list">' +
          '<li><b>DP 50%</b>: sisanya dibayar tunai di venue saat check-in.</li>' +
        '</ul></div>' +
      '</div>' +
    '</div>' +
  '</section>';
}
// WHY: ulasan penyewa (adopsi pola AYO). Nama sudah disamarkan di sisi server; kalau belum ada
// ulasan, tampil ajakan jadi yang pertama - jangan mengarang rating (Rule 1.8).
function landingReviewsHtml() {
  const list = (state.data && state.data.reviews) || [];
  if (!list.length) return '';
  const courts = state.data.courts || [];
  return '<section class="section sec" aria-labelledby="h2-ulasan">' +
    '<div class="sec-rule reveal"><span class="mlabel"><b>06</b>&nbsp;&nbsp;Ulasan</span></div>' +
    '<h2 id="h2-ulasan" class="reveal">Kata mereka.</h2>' +
    '<p class="lede reveal">Ulasan hanya bisa ditulis penyewa yang booking-nya sudah selesai.</p>' +
    '<div class="review-grid" data-stagger>' +
      list.map(r => {
        const c = courts.filter(x => x.id === r.venue_id)[0];
        return '<figure class="review-card reveal">' +
          '<span class="review-quote" aria-hidden="true">' + ICONS.quote + '</span>' +
          starHtml(Number(r.rating)) +
          '<blockquote>' + esc(r.komentar) + '</blockquote>' +
          '<figcaption><b>' + esc(r.nama) + '</b> ' +
            '<span class="muted">' + (c ? esc(c.nama) : esc(r.venue_id)) + (r.tanggal ? ' · ' + fmtDate(r.tanggal) : '') + '</span>' +
          '</figcaption>' +
        '</figure>';
      }).join('') +
    '</div>' +
  '</section>';
}
// WHY: harga coret saat ada jam sepi (pola AYO "~~Rp80.000~~ Mulai Rp70.000"). Menampilkan
// harga termurah + harga normal dicoret menegaskan penghematan - pendorong volume jam kosong.
function courtPriceHtml(c) {
  const cfg = state.data.config;
  const o = offCfg();
  if (!o.hours.length || o.mult >= 1) return fmtRp(c.harga_per_jam) + ' <small>/jam</small>';
  const cheapest = Math.round(c.harga_per_jam * o.mult);
  return '<span class="price-from">Mulai dari</span> ' +
         fmtRp(cheapest) + ' <small>/jam</small>';
}
function courtPriceAria(c) {
  const o = offCfg();
  if (!o.hours.length || o.mult >= 1) return fmtRp(c.harga_per_jam) + ' per jam';
  return 'mulai dari ' + fmtRp(Math.round(c.harga_per_jam * o.mult)) + ' per jam';
}
// WHY dipecah per section (audit Rule 12.1): landingSectionsHtml dulu 67 baris berisi 6 section
// inline. Satu fungsi = satu section membuat perubahan copy/layout tidak menyentuh section lain.
function secHargaHtml(courts, minPrice) {
  const p = peakCfg();
  return '<section class="section sec" id="harga" aria-labelledby="h2-harga">' +
    '<div class="sec-rule reveal"><span class="mlabel"><b>01</b>&nbsp;&nbsp;Lapangan &amp; harga</span></div>' +
    '<h2 id="h2-harga" class="reveal">Empat lapangan, tarif jelas.</h2>' +
    '<p class="lede reveal">Semua lapangan standar pertandingan: matras bagus, penerangan merata, jaring prima. ' + (p.hours.length && p.mult > 1
      ? 'Harga dasar ' + fmtRp(minPrice) + '/jam; jam sibuk (' + p.hours.map(h => fmtHour(h)).join(', ') + ' WIB hari kerja) ' + fmtRp(Math.round(minPrice * p.mult)) + '/jam.'
      : 'Harga sama untuk semua jam, termasuk akhir pekan.') + '</p>' +
    '<div class="court-grid-v2" data-stagger>' +
      courts.map((c, i) => {
        const o = offCfg();
        const cheapest = (o.hours.length && o.mult < 1) ? Math.round(c.harga_per_jam * o.mult) : c.harga_per_jam;
        return '<a class="court-card-v2 reveal" style="--i:' + i + '" href="#/booking" aria-label="' + esc(c.nama) + ', ' + courtPriceAria(c) + ', booking">' +
          '<div class="ccv-info">' +
            '<h3>' + esc(c.nama) + '</h3>' +
          '</div>' +
          '<div class="ccv-price">' +
            '<div class="ccv-from">Mulai dari</div>' +
            '<div class="ccv-amount">' + fmtRp(cheapest) + '<span class="ccv-per">/jam</span></div>' +
          '</div>' +
        '</a>'; }).join('') +
    '</div>' +
    galleryHtml() +
  '</section>';
}
function secFasilitasHtml() {
  return '<section class="section sec" aria-labelledby="h2-fas">' +
    '<div class="sec-rule reveal"><span class="mlabel"><b>02</b>&nbsp;&nbsp;Fasilitas</span></div>' +
    '<h2 id="h2-fas" class="reveal">Fokus main, sisanya ada.</h2>' +
    '<p class="lede reveal">Semua yang kamu butuhkan sebelum dan sesudah main sudah tersedia di venue.</p>' +
    '<div class="fac-grid" data-stagger>' + LANDING_FACS.map((f, i) => '<div class="fac-card reveal" style="--i:' + i + '"><span class="fac-ic">' + (ICONS[f[0]] || '') + '</span><span class="fac-t">' + esc(f[1]) + '</span></div>').join('') + '</div>' +
  '</section>';
}
function secCaraHtml() {
  return '<section class="section sec" aria-labelledby="h2-cara">' +
    '<div class="sec-rule reveal"><span class="mlabel"><b>03</b>&nbsp;&nbsp;Cara booking</span></div>' +
    '<h2 id="h2-cara" class="reveal">Tiga langkah, tanpa telepon.</h2>' +
    '<p class="lede reveal">Ikuti alur di bawah, dari buka aplikasi sampai main.</p>' +
    '<div class="fc-h reveal" data-stagger>' +
      '<div class="fc-node fc-start" style="--i:0"><span>Mulai</span></div>' +
      '<div class="fc-h-arrow" aria-hidden="true"></div>' +
      '<div class="fc-node" style="--i:1"><span>Pilih jadwal</span><small>Tanggal, jam, durasi 1-3 jam</small></div>' +
      '<div class="fc-h-arrow" aria-hidden="true"></div>' +
      '<div class="fc-node" style="--i:2"><span>Kunci lapangan</span><small>Pilih yang kosong</small></div>' +
      '<div class="fc-h-arrow" aria-hidden="true"></div>' +
      '<div class="fc-diamond-h" style="--i:3"><span>Bayar penuh?</span></div>' +
      '<div class="fc-h-arrow" aria-hidden="true"></div>' +
      '<div class="fc-node fc-end" style="--i:4"><span>Kode booking → Main!</span><small>Bayar penuh atau DP 50%</small></div>' +
    '</div>' +
  '</section>';
}
function secDenahHtml() {
  return '<section class="section sec" aria-labelledby="h2-denah">' +
    '<div class="sec-rule reveal"><span class="mlabel"><b>05</b>&nbsp;&nbsp;Denah</span></div>' +
    '<h2 id="h2-denah" class="reveal">Denah lapangan &amp; gedung.</h2>' +
    '<p class="lede reveal">Denah lapangan bulu tangkis standar dan tata letak gedung LapanganKu.</p>' +
    '<div class="denah-grid reveal">' +
      '<div class="denah-card"><span class="denah-badge">15 x 7,2 m</span><div class="denah-img-wrap"><img src="images/court-diagram.svg" alt="Denah lapangan bulu tangkis standar BWF dengan area bebas" loading="lazy"></div><p class="denah-label">Denah Lapangan</p><p class="denah-desc">Area bermain 13,4 x 6,1 meter dengan area bebas 15 x 7,2 meter. Net, garis servis pendek dan panjang, garis samping tunggal, serta garis tengah sesuai standar BWF.</p></div>' +
      '<div class="denah-card"><span class="denah-badge">30,8 x 24,7 m</span><div class="denah-img-wrap"><img src="images/building-layout.svg" alt="Denah gedung LapanganKu" loading="lazy"></div><p class="denah-label">Denah Gedung</p><p class="denah-desc">Empat lapangan indoor 2 x 2 dengan koridor utama, locker, kamar mandi, kantin, ruang tunggu, musala, dan resepsi. Parkir tepat di depan pintu masuk.</p></div>' +
    '</div>' +
  '</section>';
}
function secFaqHtml(faqs) {
  return '<section class="section sec faq" aria-labelledby="h2-faq">' +
    // WHY nomor 07: section lain sudah memakai 01-06 (harga, fasilitas, cara, aturan, denah, ulasan).
    // Sebelumnya tertulis "04" padahal Denah juga 04 - nomor duplikat.
    '<div class="sec-rule reveal"><span class="mlabel"><b>07</b>&nbsp;&nbsp;Pertanyaan umum</span></div>' +
    '<h2 id="h2-faq" class="reveal">Masih ragu?</h2>' +
    '<div style="margin-top:32px">' +
      faqs.map(f => '<details class="reveal"><summary>' + f[0] + ICONS.plus + '</summary><p class="faq-body">' + f[1] + '</p></details>').join('') +
    '</div>' +
  '</section>';
}
function landingSectionsHtml(courts, minPrice) {
  return secHargaHtml(courts, minPrice) + secFasilitasHtml() + secCaraHtml() +
    landingRulesHtml() + secDenahHtml() + landingReviewsHtml() + secFaqHtml(landingFaqs(minPrice));
}

function renderLanding(el) {
  const cfg = state.data.config, courts = state.data.courts;
  const minPrice = Math.min.apply(null, courts.map(c => c.harga_per_jam).concat([cfg.harga_default]));
  el.innerHTML = landingHeroHtml(cfg, courts, minPrice) + landingSectionsHtml(courts, minPrice);
  bindLandingBehaviours(el);
}
