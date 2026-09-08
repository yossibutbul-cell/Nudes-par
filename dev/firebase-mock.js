/* In-memory stand-in for the Firebase modules used by app.js. Dev only. */
const store = new Map();            // path → data
const ts = d => ({ toDate: () => d, seconds: Math.floor(d / 1000) });
const revive = v => Array.isArray(v) ? v.map(revive) : (v && typeof v === 'object') ? (v.__ts ? ts(new Date(v.__ts)) : Object.fromEntries(Object.entries(v).map(([k, x]) => [k, revive(x)]))) : v;
const save = () => { try { localStorage.setItem('mockstore', JSON.stringify([...store.entries()], (k, v) => (v && v.toDate) ? { __ts: v.toDate().toISOString() } : v)); } catch {} };
try { JSON.parse(localStorage.getItem('mockstore') || '[]').forEach(([k, v]) => store.set(k, revive(v))); } catch {}
const listeners = new Set();        // {kind:'doc'|'col', path, cb}
const clone = v => v instanceof Date ? new Date(v) : Array.isArray(v) ? v.map(clone) : (v && typeof v === 'object' && !v.__sentinel && !v.toDate) ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, clone(x)])) : v;
const SERVER_TS = { __sentinel: 'ts' }, DELETE = { __sentinel: 'del' };
function resolve(v) {
  if (v === SERVER_TS) return ts(new Date());
  if (v && v.__sentinel === 'arrayUnion') return v;
  if (Array.isArray(v)) return v.map(resolve);
  if (v && typeof v === 'object' && !v.toDate) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, resolve(x)]));
  return v;
}
function merge(target, src) {
  for (const [k, v] of Object.entries(src)) {
    if (v === DELETE) { delete target[k]; continue; }
    if (v && v.__sentinel === 'arrayUnion') { target[k] = [...new Set([...(target[k] || []), ...v.items])]; continue; }
    if (v && typeof v === 'object' && !Array.isArray(v) && !v.toDate && !v.__sentinel && target[k] && typeof target[k] === 'object' && !Array.isArray(target[k])) merge(target[k], v);
    else target[k] = resolve(v);
  }
}
function notify(path) {
  save();
  const col = path.split('/').slice(0, -1).join('/');
  for (const l of listeners) {
    if (l.kind === 'doc' && l.path === path) l.cb(docSnap(path));
    if (l.kind === 'col' && l.path === col) l.cb(colSnap(l.q));
  }
}
const docSnap = path => ({ id: path.split('/').pop(), exists: () => store.has(path), data: () => clone(store.get(path)) });
function colSnap(q) {
  let docs = [...store.keys()].filter(p => p.split('/').slice(0, -1).join('/') === q.path).map(docSnap);
  for (const w of q.where) docs = docs.filter(d => { const v = d.data()[w.f]; return w.op === '==' ? v === w.v : w.op === '>=' ? v >= w.v : true; });
  if (q.order) docs.sort((a, b) => { const x = a.data()[q.order.f], y = b.data()[q.order.f]; return (x > y ? 1 : x < y ? -1 : 0) * (q.order.dir === 'desc' ? -1 : 1); });
  if (q.lim) docs = docs.slice(0, q.lim);
  return { docs, size: docs.length, empty: !docs.length };
}
let autoId = 0;
export const initializeApp = () => ({});
export const getFirestore = () => ({});
export const collection = (_, ...segs) => ({ kind: 'col', path: segs.join('/'), where: [], order: null, lim: 0 });
export function doc(a, ...segs) { if (a && a.kind === 'col') return { kind: 'doc', path: a.path + '/' + 'a' + Date.now().toString(36) + (++autoId) }; return { kind: 'doc', path: segs.join('/') }; }
export const query = (c, ...cs) => { const q = { ...c, where: [...c.where] }; cs.forEach(x => { if (x.w) q.where.push(x.w); if (x.o) q.order = x.o; if (x.l) q.lim = x.l; }); return q; };
export const where = (f, op, v) => ({ w: { f, op, v } });
export const orderBy = (f, dir = 'asc') => ({ o: { f, dir } });
export const limit = n => ({ l: n });
export const serverTimestamp = () => SERVER_TS;
export const deleteField = () => DELETE;
export const arrayUnion = (...items) => ({ __sentinel: 'arrayUnion', items });
const delay = () => new Promise(r => setTimeout(r, 30));
export async function setDoc(ref, data, opts) { await delay(); const cur = opts?.merge && store.has(ref.path) ? store.get(ref.path) : {}; merge(cur, data); store.set(ref.path, cur); notify(ref.path); }
export async function updateDoc(ref, data) { await delay(); if (!store.has(ref.path)) throw Object.assign(new Error('not-found'), { code: 'not-found' }); const cur = store.get(ref.path); merge(cur, data); notify(ref.path); }
export async function deleteDoc(ref) { await delay(); store.delete(ref.path); notify(ref.path); }
export async function getDoc(ref) { await delay(); return docSnap(ref.path); }
export async function getDocs(q) { await delay(); return colSnap(q); }
export function onSnapshot(ref, cb, err) { const l = ref.kind === 'doc' ? { kind: 'doc', path: ref.path, cb } : { kind: 'col', path: ref.path, q: ref, cb }; listeners.add(l); setTimeout(() => l.cb(ref.kind === 'doc' ? docSnap(ref.path) : colSnap(ref)), 10); return () => listeners.delete(l); }
export function writeBatch() { const ops = []; return { set: (r, d, o) => ops.push(() => setDoc(r, d, o)), update: (r, d) => ops.push(() => updateDoc(r, d)), delete: r => ops.push(() => deleteDoc(r)), commit: async () => { for (const o of ops) await o(); } }; }

/* auth */
const params = new URLSearchParams(location.search);
let user = null; const authListeners = new Set();
export const getAuth = () => ({ get currentUser() { return user; } });
export class GoogleAuthProvider { setCustomParameters() {} }
export async function signInWithPopup() { user = { email: params.get('as') || 'admin@nudesyogurt.com', displayName: params.get('name') || 'Maya Cohen', photoURL: '' }; authListeners.forEach(f => f(user)); }
export const signInWithRedirect = signInWithPopup;
export async function signOut() { user = null; authListeners.forEach(f => f(null)); }
export function onAuthStateChanged(_, cb) { authListeners.add(cb); setTimeout(() => cb(user), 10); return () => authListeners.delete(cb); }

/* pre-seed a staff row so ?as=jonah@example.com works */
if (!store.has('users/jonah@example.com')) store.set('users/jonah@example.com', { email: 'jonah@example.com', role: 'staff', addedBy: 'admin@nudesyogurt.com' });
window.__store = store;
