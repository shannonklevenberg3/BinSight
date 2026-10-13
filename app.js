// BinSight — storage bin inventory. Source file; built into app.bundle.js with `npm run build`.
import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, onAuthStateChanged, signOut } from 'firebase/auth';
import {
  initializeFirestore, getFirestore, persistentLocalCache, persistentMultipleTabManager,
  collection, doc, setDoc, getDocs, onSnapshot, addDoc, deleteDoc, serverTimestamp, writeBatch,
} from 'firebase/firestore';
import qrcode from 'qrcode-generator';

/* ------------------------------------------------------------------ config */
const firebaseConfig = {
  apiKey: 'AIzaSyAXhIxEgc0RAy3rpNWOghbeluY2mcGPmRs',
  authDomain: 'creek-hollow-packing.firebaseapp.com',
  projectId: 'creek-hollow-packing',
  storageBucket: 'creek-hollow-packing.firebasestorage.app',
  messagingSenderId: '8249740428',
  appId: '1:8249740428:web:0e35aeaf7b09b16326ffa9',
};
// QR codes point here. Do not change after labels are printed.
const BASE_URL = 'https://shannonklevenberg3.github.io/BinSight/';
const DEFAULT_TOTAL = 150;
const DEFAULT_ROOMS = ['Kitchen', 'Living Room', 'Dining Room', 'Primary Bedroom', 'Bedroom', 'Bathroom',
  'Office', 'Garage', 'Holiday', 'Outdoor / Patio', 'Kids', 'Misc'];
const DEFAULT_LOCS = ['Storage Unit', 'Garage', 'Shed', 'Not yet moved'];

/* ----------------------------------------------------------------- helpers */
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = (n) => String(n).padStart(3, '0');
function normId(s) {
  const m = String(s || '').trim().match(/^(?:bin)?[-\s#]*0*(\d{1,4})$/i);
  return m && +m[1] >= 1 ? 'BIN-' + pad(+m[1]) : null;
}
const num = (id) => +id.slice(4);
const uniq = (a) => [...new Set(a.filter(Boolean))];
const isFilled = (b) => !!((b.contents || '').trim() || b.photoCount > 0);
const hasData = (b) => isFilled(b) || b.room || b.location;
let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}
function download(name, text, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name; document.body.appendChild(a); a.click(); a.remove();
}
async function shrink(file, max, q) {
  const img = await new Promise((res, rej) => {
    const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = URL.createObjectURL(file);
  });
  const r = Math.min(1, max / Math.max(img.width, img.height));
  const c = document.createElement('canvas');
  c.width = Math.round(img.width * r); c.height = Math.round(img.height * r);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  URL.revokeObjectURL(img.src);
  return c.toDataURL('image/jpeg', q);
}
function qrSvg(text) {
  const qr = qrcode(0, 'M'); qr.addData(text); qr.make();
  const n = qr.getModuleCount(), m = 2; let d = '';
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (qr.isDark(y, x)) d += `M${x + m} ${y + m}h1v1h-1z`;
  const s = n + m * 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${s} ${s}" shape-rendering="crispEdges"><rect width="${s}" height="${s}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}
const binUrl = (id) => `${BASE_URL}#/${id}`;

/* ------------------------------------------------------------------ stores */
function firebaseStore() {
  const app = initializeApp(firebaseConfig);
  const auth = getAuth(app);
  let db;
  try {
    db = initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });
  } catch (e) { db = getFirestore(app); }
  return {
    demo: false,
    onUser: (cb) => onAuthStateChanged(auth, cb),
    async signIn() {
      const p = new GoogleAuthProvider();
      try { await signInWithPopup(auth, p); } catch (e) {
        if (['auth/popup-blocked', 'auth/operation-not-supported-in-this-environment'].includes(e.code)) await signInWithRedirect(auth, p);
        else throw e;
      }
    },
    signOut: () => signOut(auth),
    subBins: (cb, err) => onSnapshot(collection(db, 'bins'), (s) => cb(s.docs.map((d) => ({ id: d.id, ...d.data() }))), err),
    subOptions: (cb, err) => onSnapshot(doc(db, 'config', 'options'), (s) => cb(s.exists() ? s.data() : {}), err),
    saveBin: (id, f) => setDoc(doc(db, 'bins', id), { ...f, updatedAt: serverTimestamp() }, { merge: true }),
    saveOptions: (o) => setDoc(doc(db, 'config', 'options'), o, { merge: true }),
    subPhotos: (id, cb) => onSnapshot(collection(db, 'bins', id, 'photos'), (s) => cb(s.docs.map((d) => ({ id: d.id, ...d.data() })))),
    addPhoto: (id, p) => addDoc(collection(db, 'bins', id, 'photos'), p),
    delPhoto: (id, pid) => deleteDoc(doc(db, 'bins', id, 'photos', pid)),
    async bulk(ids, f) {
      for (let i = 0; i < ids.length; i += 400) {
        const b = writeBatch(db);
        ids.slice(i, i + 400).forEach((id) => b.set(doc(db, 'bins', id), { ...f, updatedAt: serverTimestamp() }, { merge: true }));
        await b.commit();
      }
    },
    async photosOf(id) { return (await getDocs(collection(db, 'bins', id, 'photos'))).docs.map((d) => ({ id: d.id, ...d.data() })); },
  };
}
function demoStore() {
  const bins = new Map(), photos = new Map(); let opts = {};
  const binL = new Set(), optL = new Set(), photoL = new Map();
  const fireBins = () => binL.forEach((f) => f([...bins].map(([id, v]) => ({ id, ...v }))));
  const firePh = (id) => (photoL.get(id) || new Set()).forEach((f) => f([...(photos.get(id) || [])]));
  const seed = (id, v) => bins.set(id, v);
  seed('BIN-001', { room: 'Holiday', location: 'Storage Unit', contents: 'Christmas lights (4 strands), tree skirt, 3 stockings', photoCount: 0, packed: '2026-10-13' });
  seed('BIN-002', { room: 'Kitchen', location: 'Storage Unit', contents: 'Mixer, baking sheets, cookie cutters', photoCount: 0 });
  seed('BIN-003', { room: 'Garage', location: 'Garage', contents: '', photoCount: 0 });
  return {
    demo: true,
    onUser: (cb) => setTimeout(() => cb({ displayName: 'Demo', email: 'demo' }), 0),
    signIn: async () => {}, signOut: async () => {},
    subBins: (cb) => { binL.add(cb); setTimeout(fireBins, 0); return () => binL.delete(cb); },
    subOptions: (cb) => { optL.add(cb); setTimeout(() => cb(opts), 0); return () => optL.delete(cb); },
    saveBin: async (id, f) => { bins.set(id, { ...(bins.get(id) || {}), ...f }); fireBins(); },
    saveOptions: async (o) => { opts = { ...opts, ...o }; optL.forEach((f) => f(opts)); },
    subPhotos: (id, cb) => { if (!photoL.has(id)) photoL.set(id, new Set()); photoL.get(id).add(cb); setTimeout(() => firePh(id), 0); return () => photoL.get(id).delete(cb); },
    addPhoto: async (id, p) => { if (!photos.has(id)) photos.set(id, []); photos.get(id).push({ id: 'p' + Math.random(), ...p }); firePh(id); },
    delPhoto: async (id, pid) => { photos.set(id, (photos.get(id) || []).filter((p) => p.id !== pid)); firePh(id); },
    bulk: async (ids, f) => { ids.forEach((id) => bins.set(id, { ...(bins.get(id) || {}), ...f })); fireBins(); },
    photosOf: async (id) => photos.get(id) || [],
  };
}
const store = location.search.includes('demo') ? demoStore() : firebaseStore();

/* ------------------------------------------------------------------- state */
const state = { bins: new Map(), opts: { rooms: DEFAULT_ROOMS, locations: DEFAULT_LOCS, total: DEFAULT_TOTAL }, ready: 0, q: '', mode: 'list', loc: '', cleanup: [] };
const view = $('#view');
const rooms = () => uniq([...(state.opts.rooms || DEFAULT_ROOMS), ...[...state.bins.values()].map((b) => b.room)]);
const locations = () => uniq([...(state.opts.locations || DEFAULT_LOCS), ...[...state.bins.values()].map((b) => b.location)]);
const total = () => +state.opts.total || DEFAULT_TOTAL;
function selectHTML(id, label, items, value) {
  const list = value && !items.includes(value) ? [...items, value] : items;
  return `<label class="field"><span>${label}</span><select id="${id}"><option value="">— choose —</option>${list.map((v) => `<option ${v === value ? 'selected' : ''}>${esc(v)}</option>`).join('')}<option value="__add__">+ Add new…</option></select></label>`;
}
async function addOption(kind, selEl, prev) {
  const name = (prompt(kind === 'rooms' ? 'New room / category name:' : 'New bin location name:') || '').trim();
  if (!name) { selEl.value = prev; return null; }
  const list = uniq([...(kind === 'rooms' ? rooms() : locations()), name]);
  state.opts[kind] = list; store.saveOptions({ [kind]: list });
  const o = document.createElement('option'); o.textContent = name;
  selEl.insertBefore(o, selEl.querySelector('[value="__add__"]')); selEl.value = name;
  return name;
}

/* ------------------------------------------------------------------ router */
function route() {
  state.cleanup.forEach((f) => f()); state.cleanup = [];
  window.scrollTo(0, 0);
  if (!state.ready) { view.innerHTML = '<p class="muted center pad">Loading…</p>'; return; }
  const h = decodeURIComponent(location.hash.replace(/^#\/?/, '')).replace(/^bin\//i, '');
  if (h === 'labels') return labelsView();
  if (h === 'tools') return toolsView();
  const id = normId(h);
  if (id && /\d/.test(h)) return binView(id);
  return homeView();
}
window.addEventListener('hashchange', route);

/* -------------------------------------------------------------------- home */
function homeView() {
  view.innerHTML = `
    <div class="searchrow"><input id="q" type="search" placeholder="Search everything — “Christmas lights”" autocomplete="off" value="${esc(state.q)}"></div>
    <div class="gorow"><input id="go" inputmode="numeric" placeholder="Go to bin # (e.g. 14)"><button id="gobtn" class="btn">Go</button></div>
    <div id="progress"></div>
    <div class="seg"><button data-m="list">List</button><button data-m="grid">All bins</button></div>
    <div id="filterrow"></div>
    <div id="list"></div>
    <p class="footlinks"><a href="#/labels">Print labels</a> · <a href="#/tools">Tools &amp; backup</a></p>`;
  $('#q').oninput = (e) => { state.q = e.target.value; renderList(); };
  const go = () => { const id = normId($('#go').value); if (id) location.hash = '#/' + id; else toast('Type a bin number, like 14'); };
  $('#gobtn').onclick = go; $('#go').onkeydown = (e) => e.key === 'Enter' && go();
  view.querySelectorAll('.seg button').forEach((b) => (b.onclick = () => { state.mode = b.dataset.m; renderList(); }));
  renderList();
}
function renderList() {
  if (!$('#list')) return;
  const all = [...state.bins.entries()].map(([id, b]) => ({ ...b, id })).sort((a, b) => a.id.localeCompare(b.id));
  const filled = all.filter(isFilled).length, t = total();
  $('#progress').innerHTML = `<div class="bar"><i style="width:${Math.min(100, (filled / t) * 100)}%"></i></div><p class="muted small">${filled} of ${t} bins filled</p>`;
  view.querySelectorAll('.seg button').forEach((b) => b.classList.toggle('on', b.dataset.m === state.mode));
  const q = state.q.trim().toLowerCase();
  const fr = $('#filterrow');
  if (state.mode === 'list') {
    fr.innerHTML = `<select id="locf"><option value="">All locations</option>${locations().map((l) => `<option ${l === state.loc ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
    $('#locf').onchange = (e) => { state.loc = e.target.value; renderList(); };
  } else fr.innerHTML = '';
  if (state.mode === 'grid') {
    const map = new Map(all.map((b) => [b.id, b]));
    let h = '<div class="grid">';
    for (let n = 1; n <= Math.max(t, ...all.map((b) => num(b.id))); n++) {
      const id = 'BIN-' + pad(n), b = map.get(id), cls = !b ? 'empty' : isFilled(b) ? 'filled' : hasData(b) ? 'started' : 'empty';
      const hit = q && b && [id, b.room, b.location, b.contents].join(' ').toLowerCase().includes(q);
      h += `<a class="cell ${cls} ${hit ? 'hit' : ''}" href="#/${id}">${pad(n)}</a>`;
    }
    $('#list').innerHTML = h + '</div><p class="muted small">Green = has contents · Outlined = started · Grey = empty</p>';
    return;
  }
  const rows = all.filter(hasData).filter((b) => (!state.loc || b.location === state.loc) &&
    (!q || [b.id, b.room, b.location, b.contents].join(' ').toLowerCase().includes(q)));
  $('#list').innerHTML = rows.length ? rows.map((b) => `
    <a class="item" href="#/${b.id}">
      <div class="th">${b.thumb ? `<img src="${b.thumb}" alt="">` : `<span>${num(b.id)}</span>`}</div>
      <div class="meta"><b>${b.id}</b><span class="sub">${esc([b.room, b.location].filter(Boolean).join(' · '))}</span>
      <p>${esc((b.contents || '').replace(/\s+/g, ' ').slice(0, 140)) || '<i class="muted">No contents yet</i>'}</p></div></a>`).join('')
    : `<p class="muted center pad">${all.length ? 'Nothing matches that search.' : 'No bins yet. Scan a bin’s QR code, or type a bin number above.'}</p>`;
}

/* --------------------------------------------------------------------- bin */
function binView(id) {
  const b0 = state.bins.get(id) || {};
  const n = num(id);
  view.innerHTML = `
    <div class="topnav"><a href="#/" class="back">‹ All bins</a>
      <span><a class="navbtn" href="#/BIN-${pad(Math.max(1, n - 1))}">‹</a><a class="navbtn" href="#/BIN-${pad(n + 1)}">›</a></span></div>
    <h1 class="binid">${id}</h1>
    ${b0.packed ? `<p class="muted small">Packed ${esc(b0.packed)}</p>` : ''}
    ${selectHTML('room', 'Room / category', rooms(), b0.room)}
    ${selectHTML('loc', 'Bin location', locations(), b0.location)}
    <label class="field"><span>Contents <em class="muted">— tap, then use the 🎤 on your keyboard</em></span>
      <textarea id="contents" rows="7" placeholder="What's in this bin?">${esc(b0.contents || '')}</textarea></label>
    <div class="photoact"><button class="btn" id="cam">📷 Take photo</button><button class="btn ghost" id="lib">🖼 From library</button></div>
    <input type="file" id="fcam" accept="image/*" capture="environment" hidden>
    <input type="file" id="flib" accept="image/*" multiple hidden>
    <div id="thumbs" class="thumbs"></div>
    <p id="status" class="muted small center"></p>
    <p class="center"><button class="link" id="clear">Clear this bin</button></p>`;
  let photos = [], timer;
  const status = (t) => { $('#status').textContent = t; };
  const persist = () => {
    const f = { room: $('#room').value, location: $('#loc').value, contents: $('#contents').value };
    const cur = state.bins.get(id) || {};
    if (!cur.packed && (f.contents.trim() || photos.length)) f.packed = new Date().toISOString().slice(0, 10);
    store.saveBin(id, f);
    status(navigator.onLine ? 'Saved ✓' : 'Saved on this phone — will sync when you’re online');
  };
  const later = () => { status('Saving…'); clearTimeout(timer); timer = setTimeout(persist, 700); };
  $('#contents').oninput = later;
  $('#contents').onblur = () => { clearTimeout(timer); persist(); };
  for (const [sid, kind] of [['room', 'rooms'], ['loc', 'locations']]) {
    const el = $('#' + sid); let prev = el.value;
    el.onchange = async () => {
      if (el.value === '__add__') { const nm = await addOption(kind, el, prev); if (!nm) return; }
      prev = el.value; persist();
    };
  }
  const thumbs = () => {
    $('#thumbs').innerHTML = photos.map((p) => `<button class="tb" data-id="${p.id}"><img src="${p.thumb || p.data}" alt="Photo"></button>`).join('');
    $('#thumbs').querySelectorAll('.tb').forEach((el) => (el.onclick = () => lightbox(photos.find((p) => p.id === el.dataset.id))));
  };
  const lightbox = (p) => {
    if (!p) return;
    const d = document.createElement('div'); d.className = 'lightbox';
    d.innerHTML = `<img src="${p.data}" alt=""><div><button class="btn ghost" id="lbx">Close</button><button class="btn danger" id="lbd">Delete photo</button></div>`;
    document.body.appendChild(d);
    $('#lbx', d).onclick = () => d.remove();
    $('#lbd', d).onclick = () => { if (confirm('Delete this photo?')) { store.delPhoto(id, p.id); d.remove(); } };
  };
  const unsub = store.subPhotos(id, (list) => {
    photos = list.sort((a, c) => (a.ts || 0) - (c.ts || 0)); thumbs();
    const cur = state.bins.get(id) || {}, first = photos[0] && photos[0].thumb || '';
    if ((cur.photoCount || 0) !== photos.length || (cur.thumb || '') !== first) {
      const f = { photoCount: photos.length, thumb: first };
      if (!cur.packed && photos.length) f.packed = new Date().toISOString().slice(0, 10);
      store.saveBin(id, f);
    }
  });
  state.cleanup.push(unsub, () => { clearTimeout(timer); });
  const addFiles = async (files) => {
    for (const file of files) {
      try {
        status('Adding photo…');
        let data = await shrink(file, 1000, 0.65);
        if (data.length > 800000) data = await shrink(file, 800, 0.5);
        store.addPhoto(id, { data, thumb: await shrink(file, 160, 0.6), ts: Date.now() });
        status('Photo added ✓');
      } catch (e) { toast('Could not read that photo'); }
    }
  };
  $('#cam').onclick = () => $('#fcam').click(); $('#lib').onclick = () => $('#flib').click();
  $('#fcam').onchange = (e) => { addFiles([...e.target.files]); e.target.value = ''; };
  $('#flib').onchange = (e) => { addFiles([...e.target.files]); e.target.value = ''; };
  $('#clear').onclick = () => {
    if (!confirm(`Clear everything in ${id}? Contents and photos will be removed.`)) return;
    photos.forEach((p) => store.delPhoto(id, p.id));
    store.saveBin(id, { room: '', location: '', contents: '', photoCount: 0, thumb: '', packed: '' });
    $('#room').value = ''; $('#loc').value = ''; $('#contents').value = ''; status('Cleared');
  };
}

/* ------------------------------------------------------------------ labels */
const SHEET = { cols: 3, rows: 4, left: 0.625, top: 0.75, gapX: 0.625, gapY: 0.5 }; // Avery 22806, 2"x2", 12 per sheet
function labelHTML(n, useInfo) {
  const id = n ? 'BIN-' + pad(n) : null;
  if (!id) return '<div class="label skip"></div>';
  const b = (useInfo && state.bins.get(id)) || {};
  const row = (k, v) => `<div class="l-row"><b>${k}</b><span>${esc(v || '')}</span></div>`;
  const contents = (b.contents || '').trim()
    ? `<div class="l-text">${esc(b.contents.replace(/\s+/g, ' '))}</div>`
    : '<div class="l-row"></div><div class="l-row"></div><div class="l-row"></div>';
  return `<div class="label"><div class="l-top"><div class="l-qr">${qrSvg(binUrl(id))}</div>
    <div class="l-id"><small>BIN</small><strong>${pad(n)}</strong><em>BinSight</em></div></div>
    ${row('Location', b.location)}${row('Room', b.room)}${contents}</div>`;
}
function labelsView() {
  const saved = (() => { try { return JSON.parse(localStorage.getItem('bs-label') || '{}'); } catch (e) { return {}; } })();
  view.innerHTML = `
    <div class="topnav"><a href="#/" class="back">‹ Back</a></div><h1>Print labels</h1>
    <div class="card noprint">
      <div class="row2"><label class="field"><span>From bin</span><input id="lf" type="number" min="1" value="${saved.from || 1}"></label>
        <label class="field"><span>To bin</span><input id="lt" type="number" min="1" value="${saved.to || total()}"></label></div>
      <label class="field"><span>Skip labels already used on first sheet (0–11)</span><input id="ls" type="number" min="0" max="11" value="${saved.skip || 0}"></label>
      <label class="check"><input type="checkbox" id="li" ${saved.info === false ? '' : 'checked'}> Print saved location, room &amp; contents (otherwise blank to write on)</label>
      <div class="row2"><label class="field"><span>Nudge right (inches)</span><input id="nx" type="number" step="0.01" value="${saved.nx || 0}"></label>
        <label class="field"><span>Nudge down (inches)</span><input id="ny" type="number" step="0.01" value="${saved.ny || 0}"></label></div>
      <button class="btn" id="pr">🖨 Print</button>
      <p class="muted small">Avery 22806 (2″ × 2″, 12 per sheet). In the print dialog choose <b>Actual size / 100%</b> and turn off headers &amp; footers. Do a test on plain paper first and hold it up to a label sheet; use the nudge boxes if it’s a hair off.</p>
    </div><div id="sheets"></div>`;
  const draw = () => {
    const from = Math.max(1, +$('#lf').value || 1), to = Math.max(from, +$('#lt').value || from), skip = Math.min(11, Math.max(0, +$('#ls').value || 0));
    const use = $('#li').checked, nx = +$('#nx').value || 0, ny = +$('#ny').value || 0;
    try { localStorage.setItem('bs-label', JSON.stringify({ from, to, skip, info: use, nx, ny })); } catch (e) { /* ignore */ }
    const slots = Array(skip).fill(0); for (let n = from; n <= to; n++) slots.push(n);
    let h = '';
    for (let i = 0; i < slots.length; i += 12) h += `<div class="sheet" style="--nx:${nx}in;--ny:${ny}in">${slots.slice(i, i + 12).map((n) => labelHTML(n, use)).join('')}</div>`;
    $('#sheets').innerHTML = h;
    $('#sheets').dataset.count = slots.length - skip;
  };
  view.querySelectorAll('.card input').forEach((i) => (i.oninput = draw));
  $('#pr').onclick = () => window.print();
  draw();
}

/* ------------------------------------------------------------------- tools */
function toolsView() {
  view.innerHTML = `
    <div class="topnav"><a href="#/" class="back">‹ Back</a></div><h1>Tools &amp; backup</h1>
    <div class="card"><h2>Move bins</h2><p class="muted small">Set the location for a range of bins at once — handy on moving day.</p>
      <div class="row2"><label class="field"><span>From bin</span><input id="mf" type="number" min="1"></label><label class="field"><span>To bin</span><input id="mt" type="number" min="1"></label></div>
      ${selectHTML('mloc', 'New location', locations(), '')}<button class="btn" id="mgo">Apply</button></div>
    <div class="card"><h2>Backup</h2><p class="muted small">Do this every few months and save the files to OneDrive.</p>
      <button class="btn" id="csv">Export to Excel (.csv)</button>
      <button class="btn ghost" id="json">Full backup incl. photos (.json)</button><p id="bstat" class="muted small"></p></div>
    <div class="card"><h2>Settings</h2>
      <label class="field"><span>Total bins</span><input id="tot" type="number" min="1" value="${total()}"></label>
      <button class="btn ghost" id="totsave">Save</button></div>
    <div class="card"><h2>Account</h2><p class="muted small">${store.demo ? 'Demo mode — nothing is saved.' : 'Signed in.'}</p><button class="btn ghost" id="so">Sign out</button></div>`;
  const ml = $('#mloc'); let prev = '';
  ml.onchange = async () => { if (ml.value === '__add__') await addOption('locations', ml, prev); prev = ml.value; };
  $('#mgo').onclick = async () => {
    const a = +$('#mf').value, z = +$('#mt').value, loc = ml.value;
    if (!a || !z || z < a || !loc || loc === '__add__') return toast('Pick a from/to range and a location');
    if (z - a > 999) return toast('Range too large');
    if (!confirm(`Set BIN-${pad(a)} to BIN-${pad(z)} → ${loc}?`)) return;
    await store.bulk(Array.from({ length: z - a + 1 }, (_, i) => 'BIN-' + pad(a + i)), { location: loc });
    toast('Updated ✓');
  };
  const rowsAll = () => [...state.bins.entries()].sort((x, y) => x[0].localeCompare(y[0]));
  $('#csv').onclick = () => {
    const q = (v) => `"${String(v ?? '').replace(/"/g, '""').replace(/\r?\n/g, ' / ')}"`;
    const lines = [['Bin ID', 'Room', 'Bin Location', 'Contents', 'Packed', 'Photos'].map(q).join(',')];
    rowsAll().filter(([, b]) => hasData(b)).forEach(([id, b]) => lines.push([id, b.room, b.location, b.contents, b.packed, b.photoCount || 0].map(q).join(',')));
    download(`BinSight-${new Date().toISOString().slice(0, 10)}.csv`, '﻿' + lines.join('\r\n'), 'text/csv');
  };
  $('#json').onclick = async () => {
    const out = [], list = rowsAll().filter(([, b]) => hasData(b));
    for (let i = 0; i < list.length; i++) {
      const [id, b] = list[i]; $('#bstat').textContent = `Collecting ${i + 1} of ${list.length}…`;
      const { updatedAt, ...rest } = b;
      out.push({ id, ...rest, photos: (await store.photosOf(id)).map((p) => ({ data: p.data, ts: p.ts })) });
    }
    download(`BinSight-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify({ exported: new Date().toISOString(), bins: out }), 'application/json');
    $('#bstat').textContent = 'Done ✓';
  };
  $('#totsave').onclick = () => { const t = Math.max(1, +$('#tot').value || DEFAULT_TOTAL); state.opts.total = t; store.saveOptions({ total: t }); toast('Saved ✓'); };
  $('#so').onclick = () => store.signOut();
}

/* -------------------------------------------------------------------- boot */
function loginScreen(msg) {
  view.innerHTML = `<div class="login"><div class="logo">▣</div><h1>BinSight</h1><p class="muted">See what’s inside every bin.</p>
    <button class="btn" id="si">Sign in with Google</button><p class="muted small">${esc(msg || '')}</p></div>`;
  $('#si').onclick = async () => { try { await store.signIn(); } catch (e) { loginScreen(e.code === 'auth/unauthorized-domain' ? 'This web address isn’t authorized in Firebase yet (Authentication → Settings → Authorized domains).' : 'Sign-in failed: ' + (e.code || e.message)); } };
}
let unsubs = [];
store.onUser((user) => {
  unsubs.forEach((f) => f()); unsubs = []; state.ready = 0; state.bins = new Map();
  $('#banner').hidden = !store.demo;
  if (!user) return loginScreen();
  view.innerHTML = '<p class="muted center pad">Loading…</p>';
  let got = { b: 0, o: 0 };
  const done = () => { if (got.b && got.o && !state.ready) { state.ready = 1; route(); } };
  const fail = (e) => loginScreen(e && e.code === 'permission-denied' ? 'This Google account doesn’t have access to BinSight. Sign out and use the account you set up.' : 'Could not load data: ' + (e && (e.code || e.message)));
  unsubs.push(store.subBins((list) => {
    state.bins = new Map(list.map(({ id, ...rest }) => [id, rest])); got.b = 1;
    if (!state.ready) done(); else if ($('#list')) renderList();
  }, fail));
  unsubs.push(store.subOptions((o) => {
    state.opts = { rooms: o.rooms || DEFAULT_ROOMS, locations: o.locations || DEFAULT_LOCS, total: o.total || DEFAULT_TOTAL }; got.o = 1;
    if (!state.ready) done();
  }, fail));
});
if ('serviceWorker' in navigator && !store.demo) navigator.serviceWorker.register('sw.js').catch(() => {});
window.__binsight = { state, normId, labelHTML, qrSvg, route };
