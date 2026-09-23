/* nudes par & ordering — app logic
   Vanilla JS + Firebase (Auth with Google, Firestore). No build step.       */

import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.4.0/firebase-app.js';
import { getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, onAuthStateChanged, signOut }
  from 'https://www.gstatic.com/firebasejs/12.4.0/firebase-auth.js';
import { getFirestore, collection, doc, onSnapshot, setDoc, updateDoc, deleteDoc, getDoc, getDocs,
  query, where, orderBy, limit, serverTimestamp, deleteField, writeBatch, arrayUnion }
  from 'https://www.gstatic.com/firebasejs/12.4.0/firebase-firestore.js';
import { firebaseConfig, OWNER_EMAIL, TIMEZONE } from './firebase-config.js';
import { SEED_SETTINGS, SEED_SUPPLIERS, SEED_ITEMS } from './seed.js';

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

/* ── tiny helpers ──────────────────────────────────────────────────── */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = n => (n == null || isNaN(n)) ? '—' : '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const money4 = n => (n == null || isNaN(n) || !isFinite(n)) ? '—' : '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
const plural = (n, w, p = w + 's') => n === 1 ? w : p;
const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const METHODS = { email: 'email', whatsapp: 'whatsapp', sms: 'text', phone: 'phone', portal: 'portal' };
const TAGS = [['halal', 'halal'], ['gluten-free', 'gluten free'], ['dairy-free', 'dairy free'], ['vegan', 'vegan'], ['ou-kosher-pareve', 'OU kosher (pareve)'], ['ou-kosher-dairy', 'OU kosher (dairy)'], ['kosher-pareve', 'kosher (pareve)'], ['kosher-chalavi', 'kosher (chalavi)']];
const tagLabel = t => (TAGS.find(x => x[0] === t) || [t, t])[1];

function toast(t) { const el = $('#toast'); el.textContent = t; el.classList.add('on'); clearTimeout(el._t); el._t = setTimeout(() => el.classList.remove('on'), 2400); }
function ask(title, body, onOk, okLabel = 'yes') {
  $('#cf-title').textContent = title; $('#cf-body').textContent = body; $('#cf-ok').textContent = okLabel;
  $('#cf-ok').onclick = () => { $('#confirm-ov').classList.remove('on'); onOk(); };
  $('#confirm-ov').classList.add('on');
}

/* ── time in the store's timezone ──────────────────────────────────── */
function laNow(d = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: TIMEZONE, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short' })
    .formatToParts(d).filter(x => x.type !== 'literal').map(x => [x.type, x.value]));
  const key = `${p.year}-${p.month}-${p.day}`;
  return { key, y: +p.year, m: +p.month, d: +p.day, h: +p.hour % 24, min: +p.minute, weekday: DAYS.indexOf(p.weekday.toLowerCase()) };
}
const todayKey = () => laNow().key;
// a Date (UTC-anchored) for "today + n days" in the store's calendar, for formatting only
function dayPlus(n, base = laNow()) { return new Date(Date.UTC(base.y, base.m - 1, base.d + n)); }
const fmtDay = (dt, opts) => dt.toLocaleDateString('en-US', { timeZone: 'UTC', ...opts }).toLowerCase();
const keyToDate = k => { const [y, m, d] = k.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); };
function fmtTime(hhmm) { if (!hhmm) return ''; const [h, m] = hhmm.split(':').map(Number); const ap = h >= 12 ? 'pm' : 'am'; const hh = h % 12 || 12; return m ? `${hh}:${String(m).padStart(2, '0')} ${ap}` : `${hh} ${ap}`; }
function fmtStamp(ts) { const d = ts?.toDate ? ts.toDate() : ts instanceof Date ? ts : null; return d ? d.toLocaleTimeString('en-US', { timeZone: TIMEZONE, hour: 'numeric', minute: '2-digit' }).toLowerCase() : ''; }
function fmtDateTime(ts) { const d = ts?.toDate ? ts.toDate() : null; return d ? d.toLocaleString('en-US', { timeZone: TIMEZONE, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).toLowerCase() : '—'; }

/* Next delivery you can still order for: scans two weeks ahead. */
function nextDelivery(s, base = laNow()) {
  if (!s.deliveryDays?.length) return null;
  const off = s.cutoffOffset ?? 1;
  for (let n = 0; n < 14; n++) {
    if (!s.deliveryDays.includes((base.weekday + n) % 7)) continue;
    const cutOff = n - off;                        // days from today until the cut-off day
    if (cutOff < 0) continue;                      // cut-off already passed for this drop
    let passed = false;
    if (cutOff === 0 && s.cutoffTime) { const [h, m] = s.cutoffTime.split(':').map(Number); passed = base.h * 60 + base.min >= h * 60 + m; }
    if (passed) continue;
    return { n, cutOff, deliver: dayPlus(n, base), cutoffDay: dayPlus(cutOff, base) };
  }
  return null;
}
const relDay = n => n === 0 ? 'today' : n === 1 ? 'tomorrow' : null;

/* ── state ─────────────────────────────────────────────────────────── */
let me = null;            // { email, name, photo, role }
let items = [], suppliers = [], users = [], settings = { areas: [] };
let cur = null;           // the latest count doc: { id, date, status, entries, startedAt, startedBy, ... }
let count = { entries: {} };   // alias of cur (or empty) for the helpers below
let todayOrders = {};     // supplierId → order doc for the current count
let screen = 'today', areaFilter = 'all', showAll = false, editingId = null, editingSup = null;
let pendingRender = false;
const unsubs = [];
const ready = { items: false, suppliers: false, settings: false, count: false };

const isAdmin = () => me?.role === 'admin';
const countOpen = () => !!cur && cur.status === 'open';
const countLabel = c => c?.date ? fmtDay(keyToDate(c.date), { weekday: 'short', month: 'short', day: 'numeric' }) : '—';
const AREAS = () => settings.areas?.length ? settings.areas : ['general'];
const supById = id => suppliers.find(s => s.id === id) || { id, name: '—', method: 'email', to: '', deliveryDays: [] };
const entry = it => count.entries[it.id];
const onHand = it => { const e = entry(it); return e == null ? null : e.on; };
const need = it => onHand(it) == null ? 0 : Math.max(0, it.par - onHand(it));
const cases = it => Math.ceil(need(it) / Math.max(1, it.unitsPerCase || 1));
const status = it => { const o = onHand(it); return o == null ? 'pending' : o === 0 ? 'out' : o < it.par ? 'low' : 'ok'; };
const counted = () => items.filter(i => onHand(i) != null).length;
const unitPrice = it => (it.casePrice != null && it.unitsPerCase) ? it.casePrice / it.unitsPerCase : null;
const ozPrice = it => { const u = unitPrice(it); return (u != null && it.weightOz) ? u / it.weightOz : null; };
const lineCost = it => it.casePrice != null ? cases(it) * it.casePrice : null;
const orderedGroups = () => suppliers.map(s => ({ s, rows: items.filter(i => i.supplierId === s.id && need(i) > 0) })).filter(g => g.rows.length);
const TITLES = { today: 'today', count: 'count', orders: 'order report', items: 'items & par', suppliers: 'suppliers', history: 'count history', team: 'team', settings: 'settings' };
const ADMIN_SCREENS = ['items', 'suppliers', 'history', 'team', 'settings'];
function sortItems() {
  const ai = a => { const i = AREAS().indexOf(a); return i < 0 ? 99 : i; };
  items.sort((a, b) => ai(a.area) - ai(b.area) || (a.category || '').localeCompare(b.category || '') || a.name.localeCompare(b.name));
}

/* ── auth ──────────────────────────────────────────────────────────── */
const provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: 'select_account' });
$('#google-signin').onclick = async () => {
  $('#gate-err').hidden = true;
  try { await signInWithPopup(auth, provider); }
  catch (e) {
    if (e.code === 'auth/popup-blocked' || e.code === 'auth/operation-not-supported-in-this-environment') { try { await signInWithRedirect(auth, provider); } catch (e2) { showErr(e2); } }
    else if (e.code !== 'auth/popup-closed-by-user' && e.code !== 'auth/cancelled-popup-request') showErr(e);
  }
};
function showErr(e) { const el = $('#gate-err'); el.textContent = `couldn't sign in: ${e.code || e.message}`; el.hidden = false; console.error(e); }
$('#signout').onclick = () => signOut(auth);
$('#na-signout').onclick = () => signOut(auth);
$('#na-retry').onclick = () => auth.currentUser && resolveAccess(auth.currentUser);

onAuthStateChanged(auth, async user => {
  teardown();
  if (!user) { showGate('signin'); return; }
  await resolveAccess(user);
});

async function resolveAccess(user) {
  const email = (user.email || '').toLowerCase();
  const first = (user.displayName || email.split('@')[0]).split(' ')[0].toLowerCase();
  const ref = doc(db, 'users', email);
  let snap;
  try { snap = await getDoc(ref); }
  catch (e) { console.error(e); showErr(e); showGate('signin'); return; }
  const isOwner = email === OWNER_EMAIL.toLowerCase();
  if (!snap.exists() && !isOwner) {
    $('#na-name').textContent = (user.displayName || first).toLowerCase(); $('#na-email').textContent = email;
    $('#na-av').innerHTML = user.photoURL ? `<img src="${esc(user.photoURL)}" alt="">` : esc(first[0] || '?');
    showGate('noaccess'); return;
  }
  const role = isOwner ? 'admin' : (snap.data().role === 'admin' ? 'admin' : 'staff');
  me = { email, name: first, fullName: (user.displayName || first).toLowerCase(), photo: user.photoURL || '', role, isOwner };
  // keep our own row fresh (owner creates it on first sign-in)
  try {
    const profile = { name: me.fullName, photo: me.photo, lastSeen: serverTimestamp() };
    if (snap.exists()) await updateDoc(ref, profile);
    else await setDoc(ref, { email, role: 'admin', ...profile, addedBy: 'owner', addedAt: serverTimestamp() });
  } catch (e) { console.warn('profile update skipped', e); }
  enterApp();
}

function showGate(mode) {
  $('#loading').hidden = true; $('#shell').hidden = true;
  $('#gate').classList.add('on');
  $('#gate-signin').hidden = mode !== 'signin'; $('#gate-noaccess').hidden = mode !== 'noaccess';
  $('#gate-fine').textContent = `${SEED_SETTINGS.address} · ${SEED_SETTINGS.city}`;
}

function teardown() { unsubs.splice(0).forEach(u => u()); me = null; items = []; suppliers = []; users = []; todayOrders = {}; cur = null; count = { entries: {} }; Object.keys(ready).forEach(k => ready[k] = false); }

/* ── enter the app: role UI + live listeners ───────────────────────── */
const TABS = {
  staff: [['today', 'i-sun', 'today'], ['count', 'i-clip', 'count'], ['orders', 'i-truck', 'orders']],
  admin: [['today', 'i-sun', 'today'], ['count', 'i-clip', 'count'], ['orders', 'i-truck', 'orders'], ['more', 'i-list', 'more']],
};
function enterApp() {
  $('#gate').classList.remove('on');
  $$('.admin-only').forEach(el => el.hidden = !isAdmin());
  $('#rolepill').textContent = me.isOwner ? 'owner' : me.role;
  $('#who').textContent = me.fullName;
  $('#av').innerHTML = me.photo ? `<img src="${esc(me.photo)}" alt="" referrerpolicy="no-referrer">` : esc(me.name[0]);
  $('#tabbar').innerHTML = TABS[me.role].map(([id, ico, lbl]) => id === 'more'
    ? `<button id="tab-more" aria-label="more sections"><svg><use href="#${ico}"/></svg>${lbl}</button>`
    : `<button data-go="${id}"><svg><use href="#${ico}"/></svg>${lbl}<span class="badge" id="badge-${id}" hidden></span></button>`).join('');
  const more = $('#tab-more'); if (more) more.onclick = () => $('#sheet-ov').classList.add('on');
  if (!isAdmin() && ADMIN_SCREENS.includes(screen)) screen = 'today';

  const onErr = e => { console.error(e); toast('sync problem: ' + (e.code || e.message)); };
  unsubs.push(onSnapshot(collection(db, 'items'), s => { items = s.docs.map(d => ({ id: d.id, ...d.data() })); sortItems(); ready.items = true; scheduleRender(); }, onErr));
  unsubs.push(onSnapshot(query(collection(db, 'suppliers'), orderBy('name')), s => { suppliers = s.docs.map(d => ({ id: d.id, ...d.data() })); ready.suppliers = true; scheduleRender(); }, onErr));
  unsubs.push(onSnapshot(doc(db, 'settings', 'main'), s => { settings = s.exists() ? s.data() : { areas: [] }; if (!settings.areas) settings.areas = []; sortItems(); ready.settings = true; scheduleRender(); }, onErr));
  if (isAdmin()) unsubs.push(onSnapshot(collection(db, 'users'), s => { users = s.docs.map(d => ({ id: d.id, ...d.data() })); scheduleRender(); }, onErr));
  subscribeCurrent();
}
/* The current count is simply the most recently started one. If it is finalized,
   there is no open count and the count screen offers to start a new one. */
let orderSub = null, orderSubId = null;
function subscribeCurrent() {
  const onErr = e => { console.error(e); toast('sync problem: ' + (e.code || e.message)); };
  unsubs.push(onSnapshot(query(collection(db, 'counts'), orderBy('startedAt', 'desc'), limit(1)), snap => {
    const d = snap.docs[0];
    cur = d ? { entries: {}, ...d.data(), id: d.id } : null;
    count = cur || { entries: {} };
    ready.count = true;
    if ((cur?.id || null) !== orderSubId) {
      if (orderSub) orderSub(); orderSub = null; orderSubId = cur?.id || null; todayOrders = {};
      if (cur) orderSub = onSnapshot(query(collection(db, 'orders'), where('countId', '==', cur.id)), s => { todayOrders = {}; s.docs.forEach(x => todayOrders[x.data().supplierId] = { id: x.id, ...x.data() }); scheduleRender(); }, onErr);
    }
    scheduleRender();
  }, onErr));
  unsubs.push(() => { if (orderSub) orderSub(); orderSub = null; orderSubId = null; });
}
async function startCount(date) {
  const ref = doc(collection(db, 'counts'));
  await setDoc(ref, { date, status: 'open', entries: {}, startedAt: serverTimestamp(), startedBy: me.name, startedByEmail: me.email });
  toast(`count started for ${fmtDay(keyToDate(date), { weekday: 'short', month: 'short', day: 'numeric' })}`);
}

/* ── navigation ────────────────────────────────────────────────────── */
function go(s) {
  if (!me) return;
  if (ADMIN_SCREENS.includes(s) && !isAdmin()) s = 'today';
  screen = s;
  $$('.screen').forEach(el => el.classList.toggle('on', el.id === 's-' + s));
  $$('.nav [data-go], .tabbar [data-go]').forEach(b => { if (b.dataset.go === s) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
  $('#title').textContent = TITLES[s];
  if (s === 'history') loadHistory();
  render(); window.scrollTo({ top: 0 });
}
document.addEventListener('click', e => { const b = e.target.closest('[data-go]'); if (b) go(b.dataset.go); });
$('#sheet-ov').addEventListener('click', e => { if (e.target === e.currentTarget || e.target.closest('[data-go]')) $('#sheet-ov').classList.remove('on'); });

/* Re-render on data changes, but never yank an input the user is typing in. */
function scheduleRender() {
  const a = document.activeElement;
  if (a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA') && a.closest('.screen.on') && !a.closest('.search') && !a.closest('#count-body')) {
    if (!pendingRender) { pendingRender = true; a.addEventListener('blur', () => { pendingRender = false; render(); }, { once: true }); }
    return;
  }
  render();
}

/* ── render ────────────────────────────────────────────────────────── */
function render() {
  if (!me) return;
  if (ready.items && ready.suppliers && ready.settings && ready.count && $('#shell').hidden) { $('#shell').hidden = false; $('#loading').hidden = true; go(screen); return; }
  if ($('#shell').hidden) return;
  const now = laNow();
  $('#date').textContent = fmtDay(dayPlus(0, now), { weekday: 'long', month: 'long', day: 'numeric' });
  $('#foot-addr').textContent = settings.address || SEED_SETTINGS.address; $('#foot-sub').textContent = `${settings.city || SEED_SETTINGS.city} · one location`;
  const left = items.length - counted();
  $('#nav-count-left').textContent = countOpen() && items.length ? (left ? left + ' left' : 'done') : '';
  const supsToOrder = orderedGroups().filter(g => !todayOrders[g.s.id]).length;
  $('#nav-orders').textContent = supsToOrder || '';
  const bc = $('#badge-count'), bo = $('#badge-orders');
  if (bc) { bc.textContent = left; bc.hidden = !(left && countOpen()); } if (bo) { bo.textContent = supsToOrder; bo.hidden = !supsToOrder; }
  $('#sheet-items').textContent = items.length + ' items'; $('#sheet-sups').textContent = suppliers.length; $('#sheet-team').textContent = users.length ? users.length + ' people' : '';
  ({ today: renderToday, count: renderCount, orders: renderOrders, items: renderItems, suppliers: renderSuppliers, history: renderHistory, team: renderTeam, settings: renderSettings })[screen]();
}

function statusPill(it) {
  const s = status(it);
  if (s === 'pending') return '<span class="pill neutral">not counted</span>';
  if (s === 'ok') return '<span class="pill ok"><i class="dot"></i>at par</span>';
  if (s === 'low') return `<span class="pill low"><i class="dot"></i>${need(it)} short</span>`;
  return '<span class="pill out"><i class="dot"></i>out</span>';
}

/* ── today ─────────────────────────────────────────────────────────── */
function renderToday() {
  const now = laNow();
  $('#greet').textContent = `${now.h < 12 ? 'good morning' : now.h < 17 ? 'good afternoon' : 'good evening'}, ${me.name}.`;
  const c = counted(), n = items.length, open = countOpen();
  const below = items.filter(i => status(i) === 'low' || status(i) === 'out'), out = items.filter(i => status(i) === 'out');
  const groups = orderedGroups(), unsent = groups.filter(g => !todayOrders[g.s.id]);
  $('#today-banner').innerHTML = (!n && isAdmin()) ? `<div class="banner">no items yet. add them on the items screen, or load the starter list in settings.<button class="btn sm" data-go="settings">open settings</button></div>` : '';
  $('#count-cta').innerHTML = (!cur || !open ? 'start a count' : c === 0 ? 'start counting' : c < n ? 'continue count' : 'review count') + ' <svg><use href="#i-arrow"/></svg>';
  $('#greet-sub').textContent = !n ? 'nothing to count yet.'
    : !cur ? 'no count yet. start one whenever you\'re ready.'
    : !open ? `the last count (${countLabel(cur)}) was finalized${cur.finalizedBy ? ' by ' + cur.finalizedBy : ''}. start a new count when you need one.`
    : c < n ? `count of ${countLabel(cur)} is ${c === 0 ? 'not started' : 'in progress'} · ${n - c} ${plural(n - c, 'item')} still to count before the report is final.`
    : `count of ${countLabel(cur)} is complete. ${unsent.length ? `${unsent.length} supplier ${plural(unsent.length, 'order')} ready to send.` : groups.length ? 'all orders sent.' : 'nothing to order.'} finalize it on the order report.`;
  const lastAt = Object.values(count.entries).map(e => e.at?.toDate?.()).filter(Boolean).sort((a, b) => b - a)[0];
  const nd = suppliers.map(s => ({ s, d: nextDelivery(s, now) })).filter(x => x.d).sort((a, b) => a.d.n - b.d.n)[0];
  $('#stats').innerHTML = `
    <div class="card stat"><div class="eyebrow">${open ? 'current count' : 'last count'}</div><div class="v">${cur ? c : '—'}${cur ? `<small>/ ${n}</small>` : ''}</div><div class="d">${cur ? countLabel(cur) + (open ? (c < n ? ' · in progress' : ' · complete') : ' · finalized') + (lastAt ? ' · ' + fmtStamp(lastAt) : '') : 'no count yet'}</div></div>
    <div class="card stat"><div class="eyebrow">below par</div><div class="v" style="color:${below.length ? 'var(--low)' : 'inherit'}">${below.length}</div><div class="d">${out.length} out of stock</div></div>
    <div class="card stat"><div class="eyebrow">orders to send</div><div class="v">${unsent.length}</div><div class="d">${esc(unsent.map(g => g.s.name.split(' ')[0]).join(' · ')) || (groups.length ? 'all sent' : 'nothing to order')}</div></div>
    <div class="card stat"><div class="eyebrow">next delivery</div><div class="v" style="font-size:24px;padding-top:4px">${nd ? (relDay(nd.d.n) || fmtDay(nd.d.deliver, { weekday: 'long' })) : '—'}</div><div class="d">${nd ? esc(nd.s.name) + (nd.s.cutoffTime ? ` · order by ${fmtTime(nd.s.cutoffTime)} ${relDay(nd.d.cutOff) || fmtDay(nd.d.cutoffDay, { weekday: 'short' })}` : '') : 'no delivery days set'}</div></div>`;
  const top = below.sort((a, b) => (onHand(a) / (a.par || 1)) - (onHand(b) / (b.par || 1))).slice(0, 6);
  $('#bp-note').textContent = below.length > 6 ? `showing 6 of ${below.length}` : (cur ? `count of ${countLabel(cur)}` : '');
  $('#bp-list').innerHTML = top.length ? top.map(i => `<li><div class="name">${esc(i.name)}<small>${esc(supById(i.supplierId).name)} · par ${i.par}</small></div><span class="num muted" style="font-size:13px">${onHand(i)} / ${i.par}</span>${statusPill(i)}</li>`).join('')
    : `<li class="muted" style="padding:16px 18px">${c ? 'everything counted so far is at par.' : 'start a count to see what\'s short.'}</li>`;
  const sched = suppliers.map(s => ({ s, d: nextDelivery(s, now) })).sort((a, b) => (a.d ? a.d.n : 99) - (b.d ? b.d.n : 99));
  $('#sched').innerHTML = sched.length ? sched.map(({ s, d }) => {
    if (!d) return `<li><div class="day">${s.deliveryDays?.length ? 'later' : 'any'}<small>${s.deliveryDays?.length ? '' : 'on request'}</small></div><div>${esc(s.name)}<br><span class="muted" style="font-size:12.5px">${s.deliveryDays?.length ? 'next delivery beyond two weeks' : (s.method === 'phone' ? 'order by phone' : 'order any day')}</span></div><span class="pill neutral">${s.deliveryDays?.length ? 'later' : 'any day'}</span></li>`;
    const cutToday = d.cutOff === 0 && s.cutoffTime;
    const cutTxt = s.cutoffTime ? `order by ${fmtTime(s.cutoffTime)} ${relDay(d.cutOff) || fmtDay(d.cutoffDay, { weekday: 'short' })}` : 'no cut-off set';
    return `<li><div class="day">${fmtDay(d.deliver, { weekday: 'short' })}<small>${fmtDay(d.deliver, { month: 'short', day: 'numeric' })}</small></div><div>${esc(s.name)} delivers<br><span class="muted" style="font-size:12.5px">${cutTxt}</span></div><span class="pill ${cutToday ? 'low' : 'neutral'}">${cutToday ? 'cut-off today' : relDay(d.n) || fmtDay(d.deliver, { weekday: 'short' })}</span></li>`;
  }).join('') : '<li class="muted" style="padding:16px 18px">no suppliers yet.</li>';
}

/* ── count ─────────────────────────────────────────────────────────── */
/* The list is rebuilt only when the set of rows changes; a count change
   patches values in place so a phone keyboard never loses its input. */
let countSig = '';
function renderCountMeta() {
  const open = countOpen();
  if (!cur || !open) {
    $('#count-meta').innerHTML = `<div class="card startcard">
      <h2>${cur ? `count of ${countLabel(cur)} is finalized.` : 'no count yet.'}</h2>
      <p>${cur ? `finalized${cur.finalizedBy ? ' by ' + esc(cur.finalizedBy) : ''}${cur.finalizedAt ? ' at ' + fmtStamp(cur.finalizedAt) : ''}. ${isAdmin() ? 'see it in count history. ' : ''}` : ''}start a new count whenever you take stock. pick the date the count is for.</p>
      <div class="rowf"><input type="date" id="start-date" value="${todayKey()}" aria-label="count date"><button class="btn" id="start-count">start count <svg><use href="#i-arrow"/></svg></button></div>
      ${cur ? `<button class="link" data-go="orders">view its order report</button>` : ''}</div>`;
    $('#start-count').onclick = () => { const d = $('#start-date').value; if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) { toast('pick a date'); return; } startCount(d); };
    return;
  }
  $('#count-meta').innerHTML = `<div class="cmeta"><div class="when">count of ${countLabel(cur)}<small>started by ${esc(cur.startedBy || '—')}${cur.startedAt ? ' · ' + fmtDateTime(cur.startedAt) : ''}</small></div><div class="grow"></div>
    <label style="font-size:12.5px;color:var(--ink-3);display:flex;align-items:center;gap:8px">count date <input type="date" id="cur-date" value="${esc(cur.date || '')}" aria-label="count date"></label></div>`;
  $('#cur-date').onchange = async e => { const d = e.target.value; if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return; await updateDoc(doc(db, 'counts', cur.id), { date: d }); toast('count date updated'); };
}
function renderCount() {
  renderCountMeta();
  const open = countOpen();
  $('#count-hd').hidden = !open; $('#count-body').hidden = !open; $('.stick', $('#s-count')).hidden = !open;
  if (!open) { countSig = ''; return; }
  const c = counted(), n = items.length;
  $('#prog-lbl').textContent = `${c} of ${n} counted`; $('#prog-pct').textContent = (n ? Math.round(c / n * 100) : 0) + '%'; $('#prog-bar').style.width = (n ? c / n * 100 : 0) + '%';
  const areasUsed = AREAS().filter(a => items.some(i => i.area === a)).concat([...new Set(items.map(i => i.area).filter(a => !AREAS().includes(a)))]);
  if (areaFilter !== 'all' && !areasUsed.includes(areaFilter)) areaFilter = 'all';
  const areas = areaFilter === 'all' ? areasUsed : [areaFilter];
  const sig = JSON.stringify([cur.id, areaFilter, areasUsed, items.map(i => [i.id, i.name, i.area, i.par, i.unit, i.supplierId]), suppliers.map(s => [s.id, s.name])]);
  if (sig !== countSig) {
    countSig = sig;
    $('#area-chips').innerHTML = ['all', ...areasUsed].map(a => `<button class="chip" data-area="${esc(a)}" aria-pressed="${areaFilter === a}">${esc(a)}</button>`).join('');
    $$('#area-chips .chip').forEach(b => b.onclick = () => { areaFilter = b.dataset.area; renderCount(); });
    $('#count-body').innerHTML = n ? areas.map(a => {
      const rows = items.filter(i => i.area === a);
      return `<section class="area" data-area="${esc(a)}"><h3>${esc(a)}<span class="cnt"></span></h3><div class="card rows">${rows.map(i => `
        <div class="row" data-row="${i.id}">
          <div class="name">${esc(i.name)}<small>${esc(supById(i.supplierId).name)} · ${esc(i.unit)}<span class="hide-d"> · <b style="color:var(--ink-2);font-weight:600">par ${i.par}</b></span></small></div>
          <div class="par">par<b>${i.par}</b></div>
          <div class="step" data-id="${i.id}"><button type="button" data-d="-1" aria-label="minus one">−</button><input type="number" min="0" inputmode="numeric" placeholder="—" aria-label="on hand"><button type="button" data-d="1" aria-label="plus one">+</button></div>
          <div class="st"></div>
        </div>`).join('')}</div></section>`;
    }).join('') : `<div class="card empty">no items to count yet.${isAdmin() ? ' <br><button class="btn sm" data-go="items">add items</button>' : ' ask your manager to add items.'}</div>`;
    $$('#count-body .step').forEach(st => {
      const id = st.dataset.id, inp = $('input', st);
      const it = () => items.find(i => i.id === id);
      const set = v => setCount(it(), (v === '' || v == null || isNaN(v)) ? null : Math.max(0, Math.round(+v)));
      $$('button', st).forEach(b => b.onclick = () => { inp.blur(); set((onHand(it()) ?? 0) + +b.dataset.d); });
      inp.onchange = () => set(inp.value);
      inp.onfocus = () => inp.select();
      inp.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); const all = $$('#count-body .step input'); const nx = all[all.indexOf(inp) + 1]; if (nx) nx.focus(); else inp.blur(); } };
    });
  }
  // patch values, pills and per-area counts
  $$('#count-body .step').forEach(st => {
    const it = items.find(i => i.id === st.dataset.id); if (!it) return;
    const inp = $('input', st), o = onHand(it);
    if (document.activeElement !== inp) inp.value = o == null ? '' : o;
    st.classList.toggle('empty', o == null);
    $('.st', st.closest('.row')).innerHTML = statusPill(it);
  });
  $$('#count-body .area').forEach(sec => { const rows = items.filter(i => i.area === sec.dataset.area); $('.cnt', sec).textContent = `${rows.filter(i => onHand(i) != null).length}/${rows.length}`; });
  const left = n - c;
  $('#stick-note').innerHTML = !n ? '' : left ? `<b>${left}</b> ${plural(left, 'item')} not yet counted. uncounted items are left off the order report.` : `all ${n} items counted. nice.`;
  $('#reset-count').onclick = () => ask('clear this count?', 'every item goes back to “not counted”. sent orders are kept.', async () => {
    await updateDoc(doc(db, 'counts', cur.id), { entries: {}, clearedBy: me.name, clearedAt: serverTimestamp() }); toast('count cleared');
  }, 'clear it');
}
async function setCount(it, v) {
  if (!countOpen()) { toast('this count is finalized — start a new one'); return; }
  const ref = doc(db, 'counts', cur.id);
  // optimistic local update so the row re-renders instantly
  if (v == null) delete count.entries[it.id]; else count.entries[it.id] = { on: v, par: it.par, by: me.name, at: new Date() };
  render();
  try {
    await setDoc(ref, { entries: { [it.id]: v == null ? deleteField() : { on: v, par: it.par, by: me.name, at: serverTimestamp() } } }, { merge: true });
  } catch (e) { console.error(e); toast('couldn\'t save — check your connection'); }
}

/* ── orders ────────────────────────────────────────────────────────── */
$('#show-all').onchange = e => { showAll = e.target.checked; renderOrders(); };
function orderText(s, rows) {
  const hi = s.contact && s.contact !== '—' ? `hi ${s.contact}, ` : 'hi, ';
  const store = settings.storeName || SEED_SETTINGS.storeName, addr = settings.address || SEED_SETTINGS.address;
  return `${hi}order for ${store} (${addr}) — ${fmtDay(dayPlus(0), { month: 'short', day: 'numeric' })}:\n`
    + rows.map(i => `• ${cases(i)} × ${(i.unitsPerCase || 1) > 1 ? `case of ${i.unitsPerCase} ` : ''}${i.name} (${i.unit})${i.code ? ` · #${i.code}` : ''}`).join('\n')
    + `\n\n${settings.signoff || SEED_SETTINGS.signoff}`;
}
function sendLabel(m) { return { email: 'send via email', whatsapp: 'send via whatsapp', sms: 'send via text', phone: 'copy & call', portal: 'copy & open portal' }[m] || 'send'; }
const managerEmails = () => (settings.managerEmails || []).filter(Boolean);
function renderOrders() {
  const open = countOpen();
  $('#orders-sub').textContent = cur ? `count of ${countLabel(cur)}${cur.startedBy ? ' · counted by ' + [...new Set([cur.startedBy, ...Object.values(count.entries).map(e => e.by)].filter(Boolean))].join(', ') : ''}. order = par − on hand, rounded up to whole cases.` : 'order = par − on hand, rounded up to whole cases. grouped by supplier.';
  $('#finalize').hidden = !open;
  $('#orders-meta').innerHTML = !cur ? `<div class="card startcard"><h2>no count yet.</h2><p>start a count first; the order report is built from it.</p><button class="btn" data-go="count">go to count</button></div>`
    : !open ? `<div class="fin"><svg width="16" height="16"><use href="#i-check"/></svg><span>finalized${cur.finalizedBy ? ' by ' + esc(cur.finalizedBy) : ''}${cur.finalizedAt ? ' at ' + fmtDateTime(cur.finalizedAt) : ''}${cur.managerEmails?.length ? ' · summary emailed to ' + esc(cur.managerEmails.join(', ')) : ' · no manager email set'}</span><button class="btn ghost sm" id="resend-summary"><svg><use href="#i-send"/></svg>email summary again</button></div>` : '';
  const rs = $('#resend-summary'); if (rs) rs.onclick = () => openSummaryMail(cur.summary);
  if (!cur) { $('#order-sum').innerHTML = ''; $('#orders-body').innerHTML = ''; return; }
  const groups = suppliers.map(s => ({ s, rows: items.filter(i => i.supplierId === s.id && (need(i) > 0 || (showAll && onHand(i) != null))) }));
  const toOrder = groups.filter(g => g.rows.some(i => need(i) > 0)), lines = items.filter(i => need(i) > 0);
  const totalCases = lines.reduce((a, i) => a + cases(i), 0);
  const priced = lines.filter(i => i.casePrice != null), totalCost = priced.reduce((a, i) => a + lineCost(i), 0);
  const pending = items.filter(i => onHand(i) == null).length;
  $('#order-sum').innerHTML = `
    <div class="card stat"><div class="eyebrow">suppliers to order from</div><div class="v">${toOrder.length}<small>/ ${suppliers.length}</small></div></div>
    <div class="card stat"><div class="eyebrow">line items</div><div class="v">${lines.length}</div></div>
    <div class="card stat"><div class="eyebrow">cases total</div><div class="v">${totalCases}</div></div>
    <div class="card stat"><div class="eyebrow">est. cost</div><div class="v" style="font-size:26px">${money(totalCost)}</div><div class="d">${priced.length < lines.length ? `${lines.length - priced.length} ${plural(lines.length - priced.length, 'item')} unpriced` : 'from case prices'}</div></div>
    <div class="card stat"><div class="eyebrow">not counted</div><div class="v" style="color:${pending ? 'var(--low)' : 'inherit'}">${pending}</div><div class="d">${pending ? 'finish the count so nothing is missed' : items.length ? 'count complete' : 'no items'}</div></div>`;
  $('#orders-body').innerHTML = suppliers.length ? groups.map(({ s, rows }) => {
    const any = rows.some(i => need(i) > 0), sent = todayOrders[s.id];
    const meta = `<div class="meta"><span>${METHODS[s.method] || s.method}${s.to ? ` · <b>${esc(s.to)}</b>` : ''}</span><span>delivers <b>${s.deliveryDays?.length ? s.deliveryDays.map(d => DAYS[d]).join(' · ') : 'on request'}</b></span>${s.cutoffTime ? `<span>cut-off <b>${fmtTime(s.cutoffTime)} ${['same day', 'day before', 'two days before'][s.cutoffOffset ?? 1]}</b></span>` : ''}</div>`;
    if (!any) return `<div class="card sup clear"><div class="hd"><div><h2>${esc(s.name)}</h2>${meta}</div><span class="pill ok"><i class="dot"></i>fully stocked</span></div><div class="none"><svg width="16" height="16"><use href="#i-check"/></svg>nothing to order from ${esc(s.name)}.</div></div>`;
    const need_ = rows.filter(i => need(i) > 0), sc = need_.reduce((a, i) => a + cases(i), 0), cost = need_.filter(i => i.casePrice != null).reduce((a, i) => a + lineCost(i), 0);
    return `<div class="card sup" data-sup="${s.id}">
      <div class="hd"><div><h2>${esc(s.name)}</h2>${meta}${sent ? `<div class="sent-by" style="margin-top:8px"><svg width="14" height="14"><use href="#i-check"/></svg>sent by ${esc(sent.sentBy)} at ${fmtDateTime(sent.sentAt)} · ${sent.totalCases} ${plural(sent.totalCases, 'case')}</div>` : ''}</div>
        <div class="acts"><button class="btn ghost sm" data-copy="${s.id}"><svg><use href="#i-copy"/></svg>copy order</button><button class="btn sm ${sent ? 'ghost' : ''}" data-send="${s.id}"><svg><use href="#i-send"/></svg>${sent ? 'send again' : sendLabel(s.method)}</button></div></div>
      <div class="scrollx"><table class="ot"><thead><tr><th>item</th><th class="r">on hand</th><th class="r hide-m">par</th><th class="r hide-m">short</th><th class="r">order</th><th class="r hide-m">cost</th></tr></thead><tbody>
        ${rows.map(i => need(i) > 0 ? `<tr><td><b style="font-weight:500">${esc(i.name)}</b><div class="muted" style="font-size:12px">${esc(i.unit)}${(i.unitsPerCase || 1) > 1 ? ' · case of ' + i.unitsPerCase : ''}${i.code ? ' · #' + esc(i.code) : ''}<span class="hide-d"> · par ${i.par}${i.casePrice != null ? ' · ' + money(lineCost(i)) : ''}</span></div></td><td class="r n" style="color:${onHand(i) === 0 ? 'var(--out)' : 'inherit'}">${onHand(i)}</td><td class="r n hide-m">${i.par}</td><td class="r n hide-m">${need(i)}</td><td class="r"><span class="oq">${cases(i)}<small>${(i.unitsPerCase || 1) > 1 ? plural(cases(i), 'case') + ' · ' + cases(i) * i.unitsPerCase + ' units' : plural(cases(i), 'unit')}</small></span></td><td class="r n hide-m cost">${money(lineCost(i))}</td></tr>`
      : `<tr><td class="dim">${esc(i.name)}</td><td class="r n dim">${onHand(i)}</td><td class="r n dim hide-m">${i.par}</td><td class="r dim hide-m">—</td><td class="r"><span class="pill ok"><i class="dot"></i>at par</span></td><td class="r dim hide-m">—</td></tr>`).join('')}
      </tbody><tfoot><tr><td colspan="4">${need_.length} line ${plural(need_.length, 'item')} · ${sc} ${plural(sc, 'case')}</td><td class="r n">${money(cost)}</td><td class="r hide-m"><span class="muted" style="font-size:12px">${need_.some(i => i.casePrice == null) ? 'some unpriced' : 'est.'}</span></td></tr></tfoot></table></div>
    </div>`;
  }).join('') : `<div class="card empty">no suppliers yet.${isAdmin() ? ' <br><button class="btn sm" data-go="suppliers">add a supplier</button>' : ''}</div>`;
  $$('[data-copy]').forEach(b => b.onclick = () => copyOrder(supById(b.dataset.copy)));
  $$('[data-send]').forEach(b => b.onclick = () => sendOrder(supById(b.dataset.send)));
}
async function copyText(t) { try { await navigator.clipboard.writeText(t); return true; } catch { return false; } }
async function copyOrder(s) {
  const rows = items.filter(i => i.supplierId === s.id && need(i) > 0);
  toast((await copyText(orderText(s, rows))) ? `order copied for ${s.name}` : 'copy blocked by the browser');
}
const digits = v => (v || '').replace(/[^\d+]/g, '').replace(/^\+/, '');
const isApple = () => /iphone|ipad|mac/i.test(navigator.userAgent);
function supplierLines(s) {
  return items.filter(i => i.supplierId === s.id && need(i) > 0).map(i => ({ itemId: i.id, name: i.name, code: i.code || '', unit: i.unit, unitsPerCase: i.unitsPerCase || 1, onHand: onHand(i), par: i.par, cases: cases(i), units: cases(i) * (i.unitsPerCase || 1), casePrice: i.casePrice ?? null, cost: lineCost(i) }));
}
async function sendOrder(s) {
  if (!cur) return;
  const rows = items.filter(i => i.supplierId === s.id && need(i) > 0);
  if (!rows.length) return;
  const text = orderText(s, rows), enc = encodeURIComponent(text);
  const store = settings.storeName || SEED_SETTINGS.storeName;
  const subj = encodeURIComponent(`${store} order — ${fmtDay(dayPlus(0), { month: 'short', day: 'numeric' })}`);
  let href = null, note = '';
  switch (s.method) {
    case 'email': href = `mailto:${encodeURIComponent(s.to || '')}?subject=${subj}&body=${enc}`; break;
    case 'whatsapp': href = `https://wa.me/${digits(s.to)}?text=${enc}`; break;
    case 'sms': href = `sms:${(s.to || '').replace(/\s/g, '')}${isApple() ? '&' : '?'}body=${enc}`; break;
    case 'phone': await copyText(text); href = s.to ? `tel:${(s.to || '').replace(/\s/g, '')}` : null; note = 'order copied · '; break;
    case 'portal': await copyText(text); href = s.to && /^(https?:\/\/|[\w.-]+\.[a-z]{2,})/i.test(s.to) ? (s.to.startsWith('http') ? s.to : 'https://' + s.to) : null; note = 'order copied · '; break;
  }
  if (href) { if (s.method === 'whatsapp' || s.method === 'portal') window.open(href, '_blank', 'noopener'); else location.href = href; }
  const lines = supplierLines(s);
  const order = { countId: cur.id, date: cur.date, supplierId: s.id, supplierName: s.name, method: s.method, to: s.to || '', lines, totalCases: lines.reduce((a, l) => a + l.cases, 0), totalCost: lines.reduce((a, l) => a + (l.cost || 0), 0), unpriced: lines.filter(l => l.cost == null).length, text, sentBy: me.name, sentByEmail: me.email, sentAt: serverTimestamp() };
  try { await setDoc(doc(db, 'orders', `${cur.id}_${s.id}`), order); toast(`${note}order to ${s.name} logged as sent`); }
  catch (e) { console.error(e); toast('couldn\'t log the order — check your connection'); }
}

/* Finalize: close the count, snapshot every supplier order, and email the
   order manager(s) one summary. The email opens in the user's mail app. */
function buildSummary() {
  const sups = orderedGroups().map(({ s }) => { const lines = supplierLines(s); return { supplierId: s.id, name: s.name, method: s.method, to: s.to || '', lines, totalCases: lines.reduce((a, l) => a + l.cases, 0), totalCost: lines.reduce((a, l) => a + (l.cost || 0), 0), unpriced: lines.filter(l => l.cost == null).length, sent: !!todayOrders[s.id] }; });
  const es = Object.values(count.entries);
  return { suppliers: sups, totalCases: sups.reduce((a, x) => a + x.totalCases, 0), totalCost: sups.reduce((a, x) => a + x.totalCost, 0), unpriced: sups.reduce((a, x) => a + x.unpriced, 0),
    counted: es.length, total: items.length, low: es.filter(e => e.on > 0 && e.on < (e.par ?? 0)).length, out: es.filter(e => e.on === 0).length,
    countedBy: [...new Set(es.map(e => e.by).filter(Boolean))], notCounted: items.filter(i => onHand(i) == null).map(i => i.name) };
}
function summaryText(sum, c = cur) {
  const store = settings.storeName || SEED_SETTINGS.storeName;
  const head = `order summary — ${store}\ncount of ${countLabel(c)}${sum.countedBy.length ? ' · counted by ' + sum.countedBy.join(', ') : ''}\n${sum.counted} of ${sum.total} items counted · ${sum.low} below par · ${sum.out} out of stock\n`;
  const body = sum.suppliers.length ? sum.suppliers.map(x => `\n${x.name.toUpperCase()}${x.to ? ` (${METHODS[x.method] || x.method} · ${x.to})` : ''} — ${x.totalCases} ${plural(x.totalCases, 'case')} · ${money(x.totalCost)}${x.unpriced ? ` + ${x.unpriced} unpriced` : ''}${x.sent ? ' · sent' : ' · not yet sent'}\n`
    + x.lines.map(l => `  • ${l.cases} × ${l.unitsPerCase > 1 ? `case of ${l.unitsPerCase} ` : ''}${l.name}${l.code ? ` #${l.code}` : ''} — on hand ${l.onHand}, par ${l.par}${l.cost != null ? ` — ${money(l.cost)}` : ''}`).join('\n')).join('\n') : '\nnothing to order — everything counted is at par.';
  const foot = `\n\nTOTAL: ${sum.totalCases} ${plural(sum.totalCases, 'case')} · ${money(sum.totalCost)}${sum.unpriced ? ` + ${sum.unpriced} unpriced ${plural(sum.unpriced, 'item')}` : ''}`
    + (sum.notCounted?.length ? `\n\nnot counted (${sum.notCounted.length}): ${sum.notCounted.join(', ')}` : '') + `\n\n${settings.signoff || SEED_SETTINGS.signoff}`;
  return head + body + foot;
}
function openSummaryMail(sum, c = cur) {
  const to = managerEmails(); if (!to.length || !sum) { toast('no manager email set — add one in settings'); return; }
  const store = settings.storeName || SEED_SETTINGS.storeName;
  location.href = `mailto:${encodeURIComponent(to.join(','))}?subject=${encodeURIComponent(`${store} order summary — ${countLabel(c)}`)}&body=${encodeURIComponent(summaryText(sum, c))}`;
}
$('#finalize').onclick = () => {
  if (!countOpen()) return;
  const to = managerEmails(), pending = items.filter(i => onHand(i) == null).length;
  ask('finalize this count?', `the count closes and can't be edited. ${to.length ? `one email with the full order summary opens for ${to.join(', ')}.` : 'no order manager email is set in settings, so no email will be sent.'}${pending ? ` ${pending} ${plural(pending, 'item')} ${pending === 1 ? 'is' : 'are'} still not counted and will be left off.` : ''}`, async () => {
    const summary = buildSummary();
    try {
      await updateDoc(doc(db, 'counts', cur.id), { status: 'finalized', finalizedAt: serverTimestamp(), finalizedBy: me.name, finalizedByEmail: me.email, managerEmails: to, summary });
      if (to.length) openSummaryMail(summary, { ...cur, summary });
      toast('count finalized');
    } catch (e) { console.error(e); toast('couldn\'t finalize: ' + (e.code || e.message)); }
  }, 'finalize');
};

/* ── items (admin) ─────────────────────────────────────────────────── */
$('#item-q').oninput = renderItems; $('#item-sup').onchange = renderItems;
function renderItems() {
  const q = $('#item-q').value.trim().toLowerCase(), sel = $('#item-sup');
  const want = '<option value="all">all suppliers</option>' + suppliers.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('');
  if (sel.innerHTML !== want) { const v = sel.value; sel.innerHTML = want; sel.value = [...sel.options].some(o => o.value === v) ? v : 'all'; }
  const sf = sel.value || 'all';
  const rows = items.filter(i => (!q || i.name.includes(q) || (i.code || '').includes(q) || (i.category || '').includes(q)) && (sf === 'all' || i.supplierId === sf));
  $('#item-n').textContent = `${rows.length} of ${items.length} items`;
  $('#items-body').innerHTML = rows.map(i => `<tr>
    <td class="name">${esc(i.name)}${i.code ? `<span class="muted" style="font-weight:400;font-size:12px"> · #${esc(i.code)}</span>` : ''}<small class="hide-d">${esc(supById(i.supplierId).name)} · ${esc(i.area)}${ozPrice(i) != null ? ' · ' + money4(ozPrice(i)) + '/oz' : ''}</small>${i.tags?.length ? `<div class="hide-m">${i.tags.map(t => `<span class="tag">${esc(tagLabel(t))}</span>`).join('')}</div>` : ''}</td>
    <td class="muted hide-m">${esc(i.area)}</td><td class="hide-m">${esc(supById(i.supplierId).name)}</td><td class="muted hide-m">${esc(i.unit)}${(i.unitsPerCase || 1) > 1 ? ' · case of ' + i.unitsPerCase : ''}${i.weightOz ? ` · ${i.weightOz} oz` : ''}</td>
    <td class="r n hide-m" style="font-weight:500">${money(i.casePrice)}</td><td class="r n hide-m" style="font-weight:500">${money(unitPrice(i))}</td><td class="r n hide-m" style="font-weight:500">${money4(ozPrice(i))}</td>
    <td class="r"><span class="parbox" data-id="${i.id}"><button type="button" data-d="-1" aria-label="lower par">−</button><input type="number" min="0" value="${i.par}" aria-label="par level"><button type="button" data-d="1" aria-label="raise par">+</button></span></td>
    <td class="r n hide-m" style="color:${status(i) === 'out' ? 'var(--out)' : status(i) === 'low' ? 'var(--low)' : 'inherit'}">${onHand(i) == null ? '<span class="muted" style="font-weight:400;font-size:13px">—</span>' : onHand(i)}</td>
    <td class="r" style="white-space:nowrap"><button class="link" data-edit="${i.id}">edit</button> &nbsp; <button class="link" data-del="${i.id}">remove</button></td></tr>`).join('')
    || `<tr><td colspan="10" class="muted" style="padding:24px 16px">${items.length ? 'no items match.' : 'no items yet. add one, or load the starter list in settings.'}</td></tr>`;
  $$('.parbox').forEach(pb => {
    const it = items.find(i => i.id === pb.dataset.id), inp = $('input', pb);
    const set = async v => { const par = Math.max(0, Math.round(+v) || 0); it.par = par; render(); await updateDoc(doc(db, 'items', it.id), { par, updatedAt: serverTimestamp() }); };
    $$('button', pb).forEach(b => b.onclick = () => set(it.par + +b.dataset.d)); inp.onchange = () => set(inp.value);
  });
  $$('[data-edit]').forEach(b => b.onclick = () => openItem(items.find(i => i.id === b.dataset.edit)));
  $$('[data-del]').forEach(b => b.onclick = () => { const it = items.find(i => i.id === b.dataset.del); ask(`remove ${it.name}?`, 'it disappears from the count and the order report. past counts keep their history.', async () => { await deleteDoc(doc(db, 'items', it.id)); toast(`removed ${it.name}`); }, 'remove'); });
}
let itemTags = [];
function openItem(it) {
  editingId = it ? it.id : null; itemTags = it ? [...(it.tags || [])] : [];
  $('#im-title').textContent = it ? 'edit item' : 'add item'; $('#im-save').textContent = it ? 'save changes' : 'save item';
  $('#f-area').innerHTML = AREAS().map(a => `<option>${esc(a)}</option>`).join('');
  $('#f-sup').innerHTML = suppliers.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('') || '<option value="">— add a supplier first —</option>';
  $('#f-name').value = it ? it.name : ''; $('#f-area').value = it ? it.area : AREAS()[0]; $('#f-sup').value = it ? it.supplierId : (suppliers[0]?.id || '');
  $('#f-code').value = it?.code || ''; $('#f-cat').value = it?.category || '';
  $('#f-unit').value = it ? it.unit : ''; $('#f-case').value = it ? (it.unitsPerCase || 1) : 1; $('#f-par').value = it ? it.par : '';
  $('#f-price').value = it?.casePrice ?? ''; $('#f-weight').value = it?.weightOz ?? '';
  renderTagPicker(); calcPrices();
  $('#item-ov').classList.add('on'); setTimeout(() => $('#f-name').focus(), 30);
}
function renderTagPicker() { $('#f-tags').innerHTML = TAGS.map(([k, l]) => `<button type="button" data-tag="${k}" aria-pressed="${itemTags.includes(k)}">${l}</button>`).join(''); $$('#f-tags button').forEach(b => b.onclick = () => { const k = b.dataset.tag; itemTags = itemTags.includes(k) ? itemTags.filter(x => x !== k) : [...itemTags, k]; renderTagPicker(); }); }
function calcPrices() {
  const price = parseFloat($('#f-price').value), per = Math.max(1, parseInt($('#f-case').value) || 1), w = parseFloat($('#f-weight').value);
  const u = isNaN(price) ? null : price / per, oz = (u != null && w > 0) ? u / w : null;
  $('#calc-unit').innerHTML = u == null ? '—' : `${money(u)}<small>/ ${esc($('#f-unit').value.trim() || 'unit')}</small>`;
  $('#calc-oz').innerHTML = oz == null ? `<span class="muted" style="font-size:13px;font-weight:500">${u == null ? 'enter a case price' : 'enter unit weight'}</span>` : `${money4(oz)}<small>/ oz</small>`;
}
['#f-price', '#f-case', '#f-weight', '#f-unit'].forEach(s => $(s).oninput = calcPrices);
$('#add-item').onclick = () => openItem(null);
$('#item-form').onsubmit = async e => {
  e.preventDefault();
  if (!$('#f-sup').value) { toast('add a supplier first'); return; }
  const price = parseFloat($('#f-price').value), w = parseFloat($('#f-weight').value);
  const d = { name: $('#f-name').value.trim().toLowerCase(), area: $('#f-area').value, supplierId: $('#f-sup').value, code: $('#f-code').value.trim(), category: $('#f-cat').value.trim().toLowerCase(),
    unit: $('#f-unit').value.trim().toLowerCase(), unitsPerCase: Math.max(1, parseInt($('#f-case').value) || 1), casePrice: isNaN(price) ? null : price, weightOz: (isNaN(w) || w <= 0) ? null : w,
    par: Math.max(0, parseInt($('#f-par').value) || 0), tags: itemTags, updatedAt: serverTimestamp(), updatedBy: me.email };
  $('#item-ov').classList.remove('on');
  try {
    if (editingId) { await updateDoc(doc(db, 'items', editingId), d); toast('item updated'); }
    else { await setDoc(doc(collection(db, 'items')), { ...d, createdAt: serverTimestamp() }); toast(`added ${d.name}`); }
  } catch (err) { console.error(err); toast('couldn\'t save: ' + (err.code || err.message)); }
};

/* ── suppliers (admin) ─────────────────────────────────────────────── */
function renderSuppliers() {
  $('#sup-grid').innerHTML = suppliers.length ? suppliers.map(s => {
    const its = items.filter(i => i.supplierId === s.id), short = its.filter(i => need(i) > 0).length, nd = nextDelivery(s);
    return `<div class="card sc"><div class="hd-row"><h2>${esc(s.name)}</h2>${short ? `<span class="pill low">${short} to order</span>` : '<span class="pill ok">stocked</span>'}</div>
      <dl><dt>contact</dt><dd>${esc(s.contact) || '—'}</dd><dt>order via</dt><dd>${METHODS[s.method] || esc(s.method)}</dd><dt>send to</dt><dd style="word-break:break-all">${esc(s.to) || '—'}</dd><dt>delivers</dt><dd>${s.deliveryDays?.length ? s.deliveryDays.map(d => DAYS[d]).join(' · ') : 'on request'}</dd><dt>cut-off</dt><dd>${s.cutoffTime ? `${fmtTime(s.cutoffTime)} ${['same day', 'day before', 'two days before'][s.cutoffOffset ?? 1]}` : '—'}</dd><dt>next</dt><dd>${nd ? (relDay(nd.n) || fmtDay(nd.deliver, { weekday: 'short', month: 'short', day: 'numeric' })) : '—'}</dd>${s.notes ? `<dt>notes</dt><dd>${esc(s.notes)}</dd>` : ''}</dl>
      <div class="items"><b>${its.length} ${plural(its.length, 'item')}</b>${its.length ? ' · ' + esc(its.slice(0, 4).map(i => i.name).join(', ')) + (its.length > 4 ? ', +' + (its.length - 4) + ' more' : '') : ''}</div>
      <div class="acts"><button class="btn ghost sm" data-go="orders">view order</button><button class="btn ghost sm" data-supedit="${s.id}">edit</button><button class="link" data-supdel="${s.id}" style="margin-left:auto">remove</button></div></div>`;
  }).join('') : '<div class="card empty" style="grid-column:1/-1">no suppliers yet. add the first one.</div>';
  $$('[data-supedit]').forEach(b => b.onclick = () => openSup(suppliers.find(s => s.id === b.dataset.supedit)));
  $$('[data-supdel]').forEach(b => b.onclick = () => { const s = supById(b.dataset.supdel); const n = items.filter(i => i.supplierId === s.id).length; if (n) { toast(`move or remove its ${n} ${plural(n, 'item')} first`); return; } ask(`remove ${s.name}?`, 'past orders keep their history.', async () => { await deleteDoc(doc(db, 'suppliers', s.id)); toast(`removed ${s.name}`); }, 'remove'); });
}
let supDays = [];
function renderDayPicker() { $('#g-days').innerHTML = DAYS.map((d, i) => `<button type="button" data-day="${i}" aria-pressed="${supDays.includes(i)}">${d}</button>`).join(''); $$('#g-days button').forEach(b => b.onclick = () => { const i = +b.dataset.day; supDays = supDays.includes(i) ? supDays.filter(x => x !== i) : [...supDays, i].sort(); renderDayPicker(); }); }
function toHint() { $('#g-to-hint').textContent = { email: 'email address', whatsapp: 'phone number with country code, e.g. +1 323 555 0188', sms: 'phone number', phone: 'phone number', portal: 'portal web address' }[$('#g-method').value]; }
$('#g-method').onchange = toHint;
function openSup(s) {
  editingSup = s ? s.id : null; supDays = s ? [...(s.deliveryDays || [])] : [];
  $('#sm-title').textContent = s ? 'edit supplier' : 'add supplier';
  $('#g-name').value = s?.name || ''; $('#g-contact').value = s?.contact || ''; $('#g-method').value = s?.method || 'email'; $('#g-to').value = s?.to || '';
  $('#g-cutoff').value = s?.cutoffTime || ''; $('#g-cutday').value = String(s?.cutoffOffset ?? 1); $('#g-notes').value = s?.notes || '';
  renderDayPicker(); toHint();
  $('#sup-ov').classList.add('on'); setTimeout(() => $('#g-name').focus(), 30);
}
$('#add-sup').onclick = () => openSup(null);
$('#sup-form').onsubmit = async e => {
  e.preventDefault();
  const d = { name: $('#g-name').value.trim().toLowerCase(), contact: $('#g-contact').value.trim().toLowerCase(), method: $('#g-method').value, to: $('#g-to').value.trim(),
    deliveryDays: supDays, cutoffTime: $('#g-cutoff').value || '', cutoffOffset: +$('#g-cutday').value, notes: $('#g-notes').value.trim(), updatedAt: serverTimestamp(), updatedBy: me.email };
  $('#sup-ov').classList.remove('on');
  try {
    if (editingSup) { await updateDoc(doc(db, 'suppliers', editingSup), d); toast('supplier updated'); }
    else { await setDoc(doc(collection(db, 'suppliers')), { ...d, createdAt: serverTimestamp() }); toast(`added ${d.name}`); }
  } catch (err) { console.error(err); toast('couldn\'t save: ' + (err.code || err.message)); }
};

/* ── history (admin) ───────────────────────────────────────────────── */
let hist = { counts: [], orders: [], loadedAt: 0, loading: false };
async function loadHistory(force = false) {
  if (hist.loading || (!force && Date.now() - hist.loadedAt < 60000)) return;
  hist.loading = true;
  try {
    const since = laNow(new Date(Date.now() - 60 * 864e5)).key;
    const [c, o] = await Promise.all([
      getDocs(query(collection(db, 'counts'), orderBy('startedAt', 'desc'), limit(60))),
      getDocs(query(collection(db, 'orders'), where('date', '>=', since))),
    ]);
    hist = { counts: c.docs.map(d => ({ id: d.id, entries: {}, ...d.data() })), orders: o.docs.map(d => ({ id: d.id, ...d.data() })), loadedAt: Date.now(), loading: false };
  } catch (e) { console.error(e); hist.loading = false; toast('couldn\'t load history: ' + (e.code || e.message)); }
  if (screen === 'history') render();
}
function daySummary(cnt, ords) {
  const es = Object.values(cnt?.entries || {});
  const by = [...new Set([cnt?.startedBy, ...es.map(e => e.by)].filter(Boolean))];
  return { n: es.length, by, low: es.filter(e => e.on > 0 && e.on < (e.par ?? 0)).length, out: es.filter(e => e.on === 0).length, ords, cost: ords.reduce((a, o) => a + (o.totalCost || 0), 0) };
}
function renderHistory() {
  // merge the live current count with the loaded history
  const byId = new Map(hist.counts.map(c => [c.id, c]));
  if (cur) byId.set(cur.id, cur);
  const ordersByCount = {};
  [...hist.orders.filter(o => o.countId !== cur?.id), ...Object.values(todayOrders)].forEach(o => (ordersByCount[o.countId] ||= []).push(o));
  const list = [...byId.values()].sort((a, b) => (b.startedAt?.toDate?.() || 0) - (a.startedAt?.toDate?.() || 0));
  $('#hist-body').innerHTML = list.length ? list.map(c => {
    const s = daySummary(c, ordersByCount[c.id] || []), open = c.status === 'open';
    return `<tr><td style="font-weight:500">${countLabel(c)}${c.id === cur?.id ? ' <span class="muted" style="font-weight:400;font-size:12px">· current</span>' : ''}</td><td>${esc(s.by.join(', ')) || '—'}</td><td class="hide-m">${open ? '<span class="pill low">open</span>' : `<span class="pill ok">finalized</span> <span class="muted" style="font-size:12px">${esc(c.finalizedBy || '')}</span>`}</td><td class="r num">${s.n}</td><td class="r num" style="color:${s.low ? 'var(--low)' : 'inherit'}">${s.low}</td><td class="r num" style="color:${s.out ? 'var(--out)' : 'inherit'}">${s.out}</td><td class="muted hide-m" style="font-size:13px">${esc(s.ords.map(o => o.supplierName).join(' · ')) || '—'}</td><td class="r num hide-m">${c.summary ? money(c.summary.totalCost) : s.ords.length ? money(s.cost) : '—'}</td><td class="r"><button class="link" data-rep="${c.id}">view</button></td></tr>`;
  }).join('') : `<tr><td colspan="9" class="muted" style="padding:24px 16px">${hist.loading ? 'loading…' : 'no counts yet.'}</td></tr>`;
  $$('[data-rep]').forEach(b => b.onclick = () => openReport(byId.get(b.dataset.rep), ordersByCount[b.dataset.rep] || []));
}
function openReport(cnt, ords) {
  const s = daySummary(cnt, ords);
  $('#rep-title').textContent = `count of ${countLabel(cnt)}`;
  $('#rep-sub').textContent = `${s.n} ${plural(s.n, 'item')} counted${s.by.length ? ' by ' + s.by.join(', ') : ''} · ${s.low} below par · ${s.out} out${cnt.status === 'finalized' ? ` · finalized${cnt.finalizedBy ? ' by ' + cnt.finalizedBy : ''}${cnt.finalizedAt ? ' ' + fmtDateTime(cnt.finalizedAt) : ''}` : ' · still open'}`;
  const es = Object.entries(cnt?.entries || {}).map(([id, e]) => ({ id, ...e, name: items.find(i => i.id === id)?.name || ords.flatMap(o => o.lines).find(l => l.itemId === id)?.name || 'removed item' }));
  const short = es.filter(e => e.on < (e.par ?? 0)).sort((a, b) => (a.on / (a.par || 1)) - (b.on / (b.par || 1)));
  const sum = cnt.summary;
  const block = (title, lines, tot) => `<div class="report-day"><h3>${title}</h3><ul>${lines.map(l => `<li><span>${l.cases} × ${l.unitsPerCase > 1 ? `case of ${l.unitsPerCase} ` : ''}${esc(l.name)}${l.code ? ` <span class="muted">#${esc(l.code)}</span>` : ''}</span><span class="num">${money(l.cost)}</span></li>`).join('')}<li style="font-weight:600"><span>${tot.totalCases} ${plural(tot.totalCases, 'case')}</span><span class="num">${money(tot.totalCost)}${tot.unpriced ? ` <span class="muted" style="font-weight:400">+ ${tot.unpriced} unpriced</span>` : ''}</span></li></ul></div>`;
  $('#rep-body').innerHTML =
    (sum ? `<p class="muted" style="font-size:13px;margin-top:6px">finalized order summary${cnt.managerEmails?.length ? ' · emailed to ' + esc(cnt.managerEmails.join(', ')) : ''}</p>` + (sum.suppliers.length ? sum.suppliers.map(x => { const o = ords.find(y => y.supplierId === x.supplierId); return block(`${esc(x.name)} <span class="muted" style="font-weight:400;font-size:12.5px">· ${o ? `sent by ${esc(o.sentBy)} ${fmtDateTime(o.sentAt)} via ${METHODS[o.method] || esc(o.method)}` : 'not sent'}</span>`, x.lines, x); }).join('') : '<p class="muted" style="font-size:13.5px;margin-top:8px">nothing needed ordering.</p>')
      : (ords.length ? ords.map(o => block(`${esc(o.supplierName)} <span class="muted" style="font-weight:400;font-size:12.5px">· sent by ${esc(o.sentBy)} ${fmtDateTime(o.sentAt)} via ${METHODS[o.method] || esc(o.method)}</span>`, o.lines, o)).join('') : '<p class="muted" style="font-size:13.5px;margin-top:8px">no orders were sent for this count.</p>'))
    + `<div class="report-day"><h3>below par at count time</h3>${short.length ? `<ul>${short.map(e => `<li><span>${esc(e.name)}</span><span class="num" style="color:${e.on === 0 ? 'var(--out)' : 'var(--low)'}">${e.on} / ${e.par ?? '?'}</span></li>`).join('')}</ul>` : '<p class="muted" style="font-size:13.5px">everything counted was at par.</p>'}</div>`
    + (sum && managerEmails().length ? `<div style="margin-top:14px"><button class="btn ghost sm" id="rep-mail"><svg><use href="#i-send"/></svg>email this summary to the manager</button></div>` : '');
  const rm = $('#rep-mail'); if (rm) rm.onclick = () => openSummaryMail(sum, cnt);
  $('#rep-ov').classList.add('on');
}

/* ── team (admin) ──────────────────────────────────────────────────── */
function renderTeam() {
  const rows = [...users].sort((a, b) => (a.id === OWNER_EMAIL) ? -1 : (b.id === OWNER_EMAIL) ? 1 : (a.role === b.role ? a.id.localeCompare(b.id) : a.role === 'admin' ? -1 : 1));
  if (!rows.some(u => u.id === OWNER_EMAIL.toLowerCase())) rows.unshift({ id: OWNER_EMAIL.toLowerCase(), email: OWNER_EMAIL.toLowerCase(), role: 'admin', name: 'owner (not signed in yet)' });
  $('#team-body').innerHTML = rows.map(u => {
    const owner = u.id === OWNER_EMAIL.toLowerCase(), self = u.id === me.email;
    return `<tr><td><div style="display:flex;align-items:center;gap:10px"><div class="av who" style="width:30px;height:30px;border-radius:50%;background:var(--taupe);color:var(--cream);display:grid;place-items:center;font-family:var(--display);font-weight:600;font-size:13px;overflow:hidden;flex:none">${u.photo ? `<img src="${esc(u.photo)}" alt="" referrerpolicy="no-referrer" style="width:100%;height:100%;object-fit:cover">` : esc((u.name || u.id)[0])}</div><div style="min-width:0"><div style="font-weight:500">${esc(u.name || '—')}${self ? ' <span class="muted" style="font-weight:400">(you)</span>' : ''}</div><div class="muted" style="font-size:12.5px;word-break:break-all">${esc(u.id)}</div></div></div></td>
      <td class="muted hide-m" style="font-size:13px">${u.lastSeen ? fmtDateTime(u.lastSeen) : 'never signed in'}</td>
      <td>${owner ? '<span class="rolepill">owner</span>' : `<select data-role="${esc(u.id)}" aria-label="role" ${self ? 'disabled' : ''}><option value="staff" ${u.role !== 'admin' ? 'selected' : ''}>staff</option><option value="admin" ${u.role === 'admin' ? 'selected' : ''}>admin</option></select>`}</td>
      <td class="r">${owner || self ? '' : `<button class="link" data-udel="${esc(u.id)}">remove</button>`}</td></tr>`;
  }).join('');
  $$('[data-role]').forEach(s => s.onchange = async () => { await updateDoc(doc(db, 'users', s.dataset.role), { role: s.value, updatedBy: me.email, updatedAt: serverTimestamp() }); toast(`${s.dataset.role} is now ${s.value}`); });
  $$('[data-udel]').forEach(b => b.onclick = () => ask(`remove ${b.dataset.udel}?`, 'they won\'t be able to sign in any more. their past counts stay in history.', async () => { await deleteDoc(doc(db, 'users', b.dataset.udel)); toast('removed'); }, 'remove'));
}
$('#team-add').onsubmit = async e => {
  e.preventDefault();
  const email = $('#team-email').value.trim().toLowerCase(), role = $('#team-role').value;
  if (!email.includes('@')) return;
  if (users.some(u => u.id === email)) { toast('already on the list'); return; }
  try { await setDoc(doc(db, 'users', email), { email, role, addedBy: me.email, addedAt: serverTimestamp() }); toast(`added ${email} as ${role}`); $('#team-email').value = ''; }
  catch (err) { console.error(err); toast('couldn\'t add: ' + (err.code || err.message)); }
};

/* ── settings (admin) ──────────────────────────────────────────────── */
function renderSettings() {
  if (document.activeElement?.closest('#store-form') == null) {
    $('#st-name').value = settings.storeName || ''; $('#st-addr').value = settings.address || ''; $('#st-city').value = settings.city || ''; $('#st-sign').value = (settings.signoff || '').replace(/\n/g, ' ');
    $('#st-managers').value = (settings.managerEmails || []).join('\n');
  }
  const areas = AREAS();
  $('#area-list').innerHTML = settings.areas?.length ? settings.areas.map((a, i) => { const n = items.filter(x => x.area === a).length; return `<li><div class="name">${esc(a)}<small>${n} ${plural(n, 'item')}</small></div>
      <button class="link" data-amove="${i}" data-dir="-1" ${i === 0 ? 'disabled style="opacity:.3"' : ''} aria-label="move up">↑</button><button class="link" data-amove="${i}" data-dir="1" ${i === areas.length - 1 ? 'disabled style="opacity:.3"' : ''} aria-label="move down">↓</button>
      <button class="link" data-aren="${i}">rename</button><button class="link" data-adel="${i}" ${n ? 'disabled style="opacity:.3"' : ''} title="${n ? 'move its items first' : ''}">remove</button></li>`; }).join('')
    : '<li class="muted" style="padding:16px 18px">no areas yet. add the first one below.</li>';
  $$('[data-amove]').forEach(b => b.onclick = async () => { const i = +b.dataset.amove, j = i + +b.dataset.dir, a = [...settings.areas]; [a[i], a[j]] = [a[j], a[i]]; await setDoc(doc(db, 'settings', 'main'), { areas: a }, { merge: true }); });
  $$('[data-adel]').forEach(b => b.onclick = async () => { const a = settings.areas.filter((_, k) => k !== +b.dataset.adel); await setDoc(doc(db, 'settings', 'main'), { areas: a }, { merge: true }); toast('area removed'); });
  $$('[data-aren]').forEach(b => b.onclick = () => renameArea(+b.dataset.aren));
  $('#seed-sect').hidden = !(items.length === 0 && suppliers.length === 0);
}
function renameArea(i) {
  const old = settings.areas[i], li = $$('#area-list li')[i];
  li.innerHTML = `<form class="inline-add" style="border:0;padding:0;width:100%"><input value="${esc(old)}" aria-label="area name" required><button class="btn sm" type="submit">save</button><button class="btn ghost sm" type="button" data-cancel>cancel</button></form>`;
  const f = $('form', li); $('input', f).focus(); $('[data-cancel]', f).onclick = () => render();
  f.onsubmit = async e => {
    e.preventDefault(); const nu = $('input', f).value.trim().toLowerCase(); if (!nu || nu === old) return render();
    if (settings.areas.includes(nu)) { toast('that area already exists'); return; }
    const b = writeBatch(db);
    b.set(doc(db, 'settings', 'main'), { areas: settings.areas.map((a, k) => k === i ? nu : a) }, { merge: true });
    items.filter(x => x.area === old).forEach(x => b.update(doc(db, 'items', x.id), { area: nu }));
    await b.commit(); toast(`renamed to ${nu}`);
  };
}
$('#area-add').onsubmit = async e => {
  e.preventDefault(); const a = $('#area-name').value.trim().toLowerCase(); if (!a) return;
  if (settings.areas?.includes(a)) { toast('that area already exists'); return; }
  await setDoc(doc(db, 'settings', 'main'), { areas: arrayUnion(a) }, { merge: true }); $('#area-name').value = ''; toast(`added ${a}`);
};
$('#store-form').onsubmit = async e => {
  e.preventDefault();
  const managerEmails = [...new Set($('#st-managers').value.split(/[\s,;]+/).map(x => x.trim().toLowerCase()).filter(x => x.includes('@')))];
  await setDoc(doc(db, 'settings', 'main'), { storeName: $('#st-name').value.trim().toLowerCase(), address: $('#st-addr').value.trim().toLowerCase(), city: $('#st-city').value.trim().toLowerCase(), signoff: $('#st-sign').value.trim(), managerEmails, updatedBy: me.email, updatedAt: serverTimestamp() }, { merge: true });
  toast(managerEmails.length ? `store saved · ${managerEmails.length} manager ${plural(managerEmails.length, 'email')}` : 'store saved · no manager email set');
};
$('#seed-btn').onclick = () => ask('load the starter list?', `${SEED_ITEMS.length} items and ${SEED_SUPPLIERS.length} suppliers from the preliminary sheet. par levels start at one case each — set the real ones afterwards.`, async () => {
  const b = writeBatch(db);
  b.set(doc(db, 'settings', 'main'), { ...SEED_SETTINGS, areas: settings.areas?.length ? settings.areas : SEED_SETTINGS.areas }, { merge: true });
  SEED_SUPPLIERS.forEach(({ id, ...s }) => b.set(doc(db, 'suppliers', id), { ...s, createdAt: serverTimestamp() }));
  SEED_ITEMS.forEach(it => b.set(doc(collection(db, 'items')), { ...it, createdAt: serverTimestamp(), createdBy: me.email }));
  await b.commit(); toast('starter data loaded'); go('items');
}, 'load it');

/* ── modals ────────────────────────────────────────────────────────── */
$$('[data-close]').forEach(b => b.onclick = () => b.closest('.ov').classList.remove('on'));
$$('.ov').forEach(o => o.addEventListener('click', e => { if (e.target === o) o.classList.remove('on'); }));
document.addEventListener('keydown', e => { if (e.key === 'Escape') { $$('.ov.on').forEach(o => o.classList.remove('on')); $('#sheet-ov').classList.remove('on'); } });
