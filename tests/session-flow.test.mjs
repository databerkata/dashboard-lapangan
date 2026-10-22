/* Unit test ALUR SESI level state: setSession, logout, restoreSession + intended
   (return-to-intended, once-only, persist antar reload) di app.js, sandbox vm.
   Stub UI (updateAuthUI/renderNav/route/toast) dan location hash palsu. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readSrc, extractAll, makeCtx, define, get } from './helpers/extract.mjs';

const app = readSrc('lapanganku/app.js');

function setup(hash) {
  const { ctx, storage } = makeCtx();
  // Stub ketergantungan UI/navigasi produksi SEBELUM fungsi target diekstrak
  define(ctx, `
    var __nav = [];
    var __modalPanel = null;
    var location = { hash: ${JSON.stringify(hash || '')} };
    var window = { addEventListener() {} };
    function $(sel, el) {
      const target = el || __modalPanel;
      if (!target) return { addEventListener() {}, style: {}, setAttribute() {}, click() {} };
      return {
        addEventListener(ev, handler) {
          if (ev === 'click' && target._handlers) {
            target._handlers[sel] = handler;
          }
        },
        style: {}, setAttribute() {}, click() {}
      };
    }
    function $$(sel, el) { return []; }
    function updateAuthUI() { __nav.push('auth:' + location.hash); }
    function renderNav() { __nav.push('nav'); }
    function route() { __nav.push('route:' + location.hash); }
    function toast(msg) { __nav.push('toast:' + msg); }
    var CONFIG = { GOOGLE_CLIENT_ID: '' };
    var Modal = {
      open: (opts) => {
        __modalPanel = {
          querySelector: (sel) => ({
            addEventListener: (ev, handler) => {
              if (ev === 'click') {
                __modalPanel._handlers = __modalPanel._handlers || {};
                __modalPanel._handlers[sel] = handler;
              }
            }
          }),
          _handlers: {}
        };
        if (opts.onMount) opts.onMount(__modalPanel);
        return { panel: __modalPanel, close: () => {}, lock: () => {} };
      },
      close: () => {}
    };
  `);
  define(ctx, extractAll(app, ['fmtRp', 'pad2', 'ymd', 'todayStr', 'isToday', 'WIB_TIME_FMT', 'nowMin', 'store', 'state',
    'syncQueue', 'decodeJwt', 'jwtExp', 'sessionUsable', 'setSession', 'logout', 'restoreSession']));
  define(ctx, 'state.data = { config: {}, courts: [], demo: true };');
  return { ctx, storage, nav: () => get(ctx, '__nav') };
}

test('setSession: user + credential + exp tersimpan di state dan lk-session', () => {
  const { ctx, storage } = setup('#/booking');
  get(ctx, 'setSession')({ name: 'Budi', email: 'budi@gmail.com' }, 'demo-token');
  const state = get(ctx, 'state');
  assert.equal(state.user.email, 'budi@gmail.com');
  assert.equal(state.credential, 'demo-token');
  const sess = JSON.parse(storage.getItem('lk-session'));
  assert.equal(sess.user.email, 'budi@gmail.com');
  assert.equal(sess.credential, 'demo-token');
  assert.equal(sess.exp, 0); // demo tanpa JWT
});

test('setSession dengan JWT Google: claim exp (detik) tersimpan', () => {
  const { ctx, storage } = setup('');
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64');
  const jwt = b64({ alg: 'RS256' }) + '.' + b64({ email: 'a@gmail.com', exp: 2000000000 }) + '.';
  get(ctx, 'setSession')({ name: 'A', email: 'a@gmail.com' }, jwt);
  const sess = JSON.parse(storage.getItem('lk-session'));
  assert.equal(sess.exp, 2000000000);
});

test('intended: setSession mengarahkan kembali ke halaman tujuan dan MENGOSONGKAN state', () => {
  const { ctx } = setup('#/monitoring');
  get(ctx, 'state').intended = '#/monitoring';
  get(ctx, 'setSession')({ name: 'A', email: 'a@b.id' }, 'demo-token');
  const state = get(ctx, 'state');
  assert.equal(state.intended, null);
  assert.equal(get(ctx, 'location').hash, '#/monitoring'); // hash berpindah ke tujuan
});

test('intended sekali pakai: TIDAK ikut tersimpan di lk-session (tidak di-restore ulang)', () => {
  const { ctx, storage } = setup('#/monitoring');
  get(ctx, 'state').intended = '#/monitoring';
  get(ctx, 'setSession')({ name: 'A', email: 'a@b.id' }, 'demo-token');
  const sess = JSON.parse(storage.getItem('lk-session'));
  assert.equal(sess.intended, null); // yang persist = null
});

test('intended identik dengan hash saat ini: tidak dikonsumsi sebagai tujuan, tetap dibersihkan', () => {
  const { ctx } = setup('#/booking');
  get(ctx, 'state').intended = '#/booking';
  get(ctx, 'setSession')({ name: 'A', email: 'a@b.id' }, 'demo-token');
  const state = get(ctx, 'state');
  assert.equal(state.intended, null);
  assert.equal(get(ctx, 'location').hash, '#/booking');
});

test('tanpa intended: setSession tetap di rute sekarang (route() dipanggil)', () => {
  const { ctx, nav } = setup('#/booking');
  get(ctx, 'setSession')({ name: 'A', email: 'a@b.id' }, 'demo-token');
  assert.ok(nav().some(s => s === 'route:#/booking'));
});

test('logout: state bersih, lk-session terhapus, intended dibuang', () => {
  const { ctx, storage, nav } = setup('#/');
  get(ctx, 'setSession')({ name: 'A', email: 'a@b.id' }, 'demo-token');
  get(ctx, 'state').intended = '#/booking';
  get(ctx, 'logout')();
  // Simulate clicking "Ya, Keluar" button in modal
  const panel = get(ctx, '__modalPanel');
  panel._handlers['[data-yes]']();
  const state = get(ctx, 'state');
  assert.equal(state.user, null);
  assert.equal(state.credential, null);
  assert.equal(state.intended, null);
  assert.equal(state.myBookings.length, 0);
  assert.equal(storage.getItem('lk-session'), null);
  assert.ok(nav().some(s => s.startsWith('toast:Kamu sudah keluar')));
});

test('restoreSession: sesi demo sah -> user kembali, return true', () => {
  const { ctx, storage } = setup('');
  storage.setItem('lk-session', JSON.stringify({ user: { name: 'Demo', email: 'd@demo.id' }, credential: 'demo-token', exp: 0, intended: null }));
  assert.equal(get(ctx, 'restoreSession')(), true);
  const state = get(ctx, 'state');
  assert.equal(state.user.email, 'd@demo.id');
  assert.equal(state.credential, 'demo-token');
});

test('restoreSession: sesi Google belum kedaluwarsa -> sah (exp detik)', () => {
  const { ctx, storage } = setup('');
  storage.setItem('lk-session', JSON.stringify({ user: { name: 'A', email: 'a@gmail.com' }, credential: 'jwt', exp: 2000000000, intended: null }));
  assert.equal(get(ctx, 'restoreSession')(), true);
});

test('restoreSession: sesi kedaluwarsa -> TIDAK direstore, lk-session dihapus, intended tetap diingat', () => {
  const { ctx, storage } = setup('');
  storage.setItem('lk-session', JSON.stringify({ user: { name: 'Lama', email: 'l@gmail.com' }, credential: 'jwt', exp: 1000, intended: '#/monitoring' }));
  assert.equal(get(ctx, 'restoreSession')(), false);
  const state = get(ctx, 'state');
  assert.equal(state.user, null); // pura-pura masuk dicegah
  assert.equal(state.intended, '#/monitoring'); // tujuan awal diingat utk login ulang
  assert.equal(storage.getItem('lk-session'), null); // basi dibuang
});

test('restoreSession: tanpa sesi -> false, state tetap anonim', () => {
  const { ctx } = setup('');
  assert.equal(get(ctx, 'restoreSession')(), false);
  assert.equal(get(ctx, 'state').user, null);
});

test('siklus penuh: login -> logout -> restore -> login lagi dengan intended baru', () => {
  const { ctx, storage } = setup('#/booking');
  const S = (h) => { get(ctx, 'location').hash = h; };
  // 1. login dengan intended
  get(ctx, 'state').intended = '#/monitoring';
  get(ctx, 'setSession')({ name: 'A', email: 'a@b.id' }, 'demo-token');
  S('#/monitoring');
  // 2. logout (simulate clicking "Ya, Keluar" button)
  get(ctx, 'logout')();
  const panel = get(ctx, '__modalPanel');
  panel._handlers['[data-yes]']();
  assert.equal(get(ctx, 'state').user, null);
  // 3. restore tanpa sesi = anonim
  assert.equal(get(ctx, 'restoreSession')(), false);
  // 4. login ulang dengan intended berbeda
  S('#/booking');
  get(ctx, 'state').intended = '#/booking';
  get(ctx, 'setSession')({ name: 'B', email: 'b@b.id' }, 'demo-token');
  const sess = JSON.parse(storage.getItem('lk-session'));
  assert.equal(sess.user.email, 'b@b.id'); // sesi baru menimpa lama
  assert.equal(sess.intended, null);
});
