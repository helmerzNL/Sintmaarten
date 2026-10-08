'use strict';
// Bewoners wijzigen via de geïnstalleerde app de status van hun eigen huis; de beheerder keurt dat goed.
// Per apparaat (cookie) hoort er maximaal één huis bij. Wijzigingen zijn pas zichtbaar na goedkeuring.
const crypto = require('node:crypto');
const express = require('express');
const config = require('./config');
const store = require('./store');
const auth = require('./auth');
const backups = require('./backups');
const push = require('./push');
const { STATUSES, statusLabels } = require('./houses');

const COOKIE = 'sm_resident';
const MAX_RESIDENTS = 3000;
const MAX_PENDING = 500;
const statusName = (k) => statusLabels(store.db().settings)[k].toLowerCase();

const db = () => store.db();
const sha = (t) => crypto.createHash('sha256').update(t).digest('hex');
const houseOf = (id) => db().houses.find((h) => h.id === id);
const titleOf = (h) => [h.street, h.number].filter(Boolean).join(' ') || 'Huis';
// Instellingen zoals de beheerder ze bewaarde (de twee schakelaars onder "Wijzigen van bewoners").
const storedEnabled = () => db().settings?.residentsEnabled !== false;
const storedAppOnly = () => db().settings?.residentsAppOnly === true;
// Planning: staat die aan, dan beslist alleen de datum/tijd. Tot dan kan elke bewoner wijzigen (browser én app),
// daarna staat wijzigen uit. De twee schakelaars worden in die tijd genegeerd (en in het beheer uitgeschakeld).
const untilMs = () => {
  const s = db().settings;
  if (s?.residentsOff !== true) return null;
  const t = Date.parse(s.residentsUntil || '');
  return Number.isFinite(t) ? t : null;
};
const scheduled = () => untilMs() !== null;
// Na de einddatum kan de beheerder nog toestaan dat bewoners hun eigen huis wisselen tussen groen en rood.
const swapAfter = () => db().settings?.residentsSwapAfter === true;
// 'open' = alles mag, 'swap' = alleen eigen huis groen <-> rood, 'closed' = niets
const mode = () => {
  if (scheduled()) return Date.now() < untilMs() ? 'open' : (swapAfter() ? 'swap' : 'closed');
  return storedEnabled() ? 'open' : 'closed';
};
const enabled = () => mode() === 'open';
const appOnly = () => (scheduled() ? false : storedAppOnly());
const DEFAULT_INFO = 'Woon je in de wijk? Dan kun je in deze app zelf de status van jouw huis aanpassen. Tik op "Huis wijzigen", kies jouw huis en geef aan of het wel of niet is bezocht. Een wijziging wordt pas zichtbaar nadat de beheerder die heeft goedgekeurd.';
const info = () => {
  const t = db().settings?.residentInfo;
  return typeof t === 'string' ? t : DEFAULT_INFO;
};

// Verwijdert aanmeldingen en wijzigingen van huizen die niet meer bestaan.
function prune() {
  const d = db();
  const ids = new Set(d.houses.map((h) => h.id));
  d.residents = d.residents.filter((r) => ids.has(r.houseId));
  const rids = new Set(d.residents.map((r) => r.rid));
  d.proposals = d.proposals.filter((p) => rids.has(p.residentId) && ids.has(p.houseId));
}

// Na een wijziging door de beheerder: beheer wint altijd. Een voorstel dat nu overbodig is verdwijnt,
// de rest krijgt de actuele status als uitgangspunt.
function reconcile() {
  prune();
  const d = db();
  for (const prop of [...d.proposals]) {
    const house = houseOf(prop.houseId);
    if (prop.to === house.status) {
      const rec = d.residents.find((r) => r.rid === prop.residentId);
      if (rec) rec.notice = { decision: 'approved', status: prop.to, at: new Date().toISOString() };
      d.proposals = d.proposals.filter((p) => p !== prop);
    } else {
      prop.from = house.status;
    }
  }
}

function currentResident(req) {
  const token = auth.parseCookies(req.headers.cookie)[COOKIE];
  if (!token || token.length < 20) return null;
  const hash = sha(token);
  const rec = db().residents.find((r) => auth.safeEqual(r.tokenHash, hash));
  return rec && houseOf(rec.houseId) ? rec : null;
}

// ---- geofence: wijzigen alleen als het apparaat (volgens GPS/wifi-locatie) in de wijk is ----
const GEO_DEFAULT_RADIUS = 500, GEO_MIN = 50, GEO_MAX = 5000;
function geoCenter() {
  const d = db();
  const c = d.view?.center;
  if (Array.isArray(c) && c.length === 2 && c.every(Number.isFinite)) return [c[0], c[1]];
  const pts = d.houses.flatMap((h) => h.points || []);
  if (!pts.length) return null;
  return [pts.reduce((a, p) => a + p[0], 0) / pts.length, pts.reduce((a, p) => a + p[1], 0) / pts.length];
}
const geofence = () => {
  const s = db().settings || {};
  const radius = Math.min(GEO_MAX, Math.max(GEO_MIN, Number(s.residentsGeofenceRadius) || GEO_DEFAULT_RADIUS));
  const center = geoCenter();
  return { on: s.residentsGeofence === true && !!center, radius, center };
};
const distanceM = (a, b) => { // haversine
  const R = 6371000, rad = (x) => (x * Math.PI) / 180;
  const dLat = rad(b[0] - a[0]), dLng = rad(b[1] - a[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};
// De locatie komt van het apparaat zelf (kop X-Geo: lat,lng,nauwkeurigheid in m). De server kan die niet
// controleren: het is een gebruiksbeperking tegen "even vanaf de bank", geen harde beveiliging.
function geoCheck(req) {
  const g = geofence();
  if (!g.on) return null;
  const m = /^(-?\d{1,3}(?:\.\d+)?),(-?\d{1,3}(?:\.\d+)?),(\d{1,6}(?:\.\d+)?)$/.exec(String(req.get('X-Geo') || ''));
  if (!m) return { geofence: 'missing', error: 'Wijzigen kan alleen in de wijk. Sta toegang tot je locatie toe en probeer het opnieuw.' };
  const pos = [Number(m[1]), Number(m[2])], acc = Math.min(Number(m[3]), 500); // een vage fix telt maximaal 500 m mee
  if (Math.abs(pos[0]) > 90 || Math.abs(pos[1]) > 180) return { geofence: 'missing', error: 'Ongeldige locatie' };
  const dist = distanceM(pos, g.center);
  if (dist - acc > g.radius) return { geofence: 'outside', error: `Je lijkt niet in de wijk te zijn (ongeveer ${Math.round(dist / 10) * 10} m van het midden). Wijzigen kan alleen in de wijk.` };
  return null;
}

// Geblokkeerde apparaten (cookie/token) en IP-adressen mogen niet meer wijzigen of een huis kiezen.
function isBlocked(req) {
  const list = db().blocked || [];
  if (!list.length) return false;
  const hashes = new Set();
  const cookie = auth.parseCookies(req.headers.cookie)[COOKIE];
  if (cookie) hashes.add(sha(cookie));
  const t = req.body?.token;
  if (typeof t === 'string' && t) hashes.add(sha(t));
  return list.some((b) => (b.tokenHash && hashes.has(b.tokenHash)) || (b.ip && b.ip === req.ip));
}

const proposalOf = (rec) => db().proposals.find((p) => p.residentId === rec.rid);

function view(rec) {
  const house = houseOf(rec.houseId);
  const prop = proposalOf(rec);
  return {
    enabled: enabled(),
    mode: mode(),
    claim: { houseId: house.id, title: titleOf(house) },
    approved: house.status,
    effective: prop ? prop.to : house.status,
    pending: !!prop,
    notice: rec.notice || null,
  };
}

function setCookie(res, token) {
  const flags = ['Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${365 * 24 * 3600}`];
  if (config.secureCookie) flags.push('Secure');
  res.append('Set-Cookie', `${COOKIE}=${token}; ${flags.join('; ')}`);
}

// ---- pushmelding aan de beheerder (samengevoegd: hooguit één melding per paar seconden) ----
let timer = null;
function notifyAdmin() {
  if (timer) return;
  timer = setTimeout(async () => {
    timer = null;
    const pending = db().proposals;
    if (!pending.length) return;
    const first = pending[0];
    const h = houseOf(first.houseId);
    const body = pending.length === 1 && h
      ? `${titleOf(h)}: ${statusName(first.to)} aangevraagd`
      : `${pending.length} wijzigingen wachten op goedkeuring`;
    try { await push.send({ title: 'Wijziging ter goedkeuring', body, url: '/beheer#changes', tag: 'wijzigingen' }); }
    catch (err) { console.error('Melding mislukt:', err.message); }
  }, Number(process.env.PUSH_DELAY_MS ?? 5000));
}

// ---------- publiek: voor bewoners ----------
const resident = express.Router();

resident.use((req, res, next) => {
  const m = mode();
  if (m === 'closed') return res.status(403).json({ error: 'Wijzigen door bewoners staat uit', enabled: false });
  // na de einddatum: alleen bestaande koppelingen en alleen wisselen tussen groen en rood
  if (m === 'swap' && !(req.path === '/me' || ['/set', '/restore', '/ack'].includes(req.path))) {
    return res.status(403).json({ error: 'Wijzigen is gesloten; je kunt alleen nog je eigen huis wisselen tussen groen en rood', mode: m });
  }
  if (isBlocked(req)) {
    if (req.method === 'GET') return res.json({ enabled: true, claim: null, blocked: true });
    return res.status(403).json({ error: 'Dit apparaat is geblokkeerd door de beheerder', blocked: true });
  }
  if (req.method !== 'GET' && (req.path === '/claim' || req.path === '/set')) {
    const bad = geoCheck(req);
    if (bad) return res.status(403).json(bad);
  }
  if (req.method !== 'GET') {
    // Alleen in de geïnstalleerde app: de app meldt zich met X-App-Mode. Dit is een gebruiksbeperking
    // (de browser stuurt de kop niet); de server kan niet bewijzen dat een client echt een app is.
    if (appOnly() && req.get('X-App-Mode') !== 'standalone') {
      return res.status(403).json({ error: 'Wijzigen kan alleen in de geïnstalleerde app', appOnly: true });
    }
    const key = `resident:${req.ip}`;
    if (auth.limiter.blocked(key, 120)) return res.status(429).json({ error: 'Te veel verzoeken, probeer het later opnieuw' });
    auth.limiter.fail(key); // telt elk schrijfverzoek
  }
  next();
});

resident.get('/me', (req, res) => {
  const rec = currentResident(req);
  res.json(rec ? view(rec) : { enabled: enabled(), mode: mode(), claim: null });
});

// Dit apparaat koppelen aan één huis.
resident.post('/claim', (req, res) => {
  if (currentResident(req)) return res.status(409).json({ error: 'Dit apparaat is al aan een huis gekoppeld' });
  const house = houseOf(String(req.body?.houseId || ''));
  if (!house) return res.status(404).json({ error: 'Huis niet gevonden' });
  if (db().residents.length >= MAX_RESIDENTS) return res.status(503).json({ error: 'Op dit moment zijn er te veel aanmeldingen' });
  const token = crypto.randomBytes(32).toString('base64url');
  const rec = { rid: crypto.randomBytes(6).toString('hex'), tokenHash: sha(token), houseId: house.id, createdAt: new Date().toISOString(), lastActivity: new Date().toISOString(), ip: req.ip, notice: null };
  db().residents.push(rec);
  store.save();
  setCookie(res, token);
  res.json({ ...view(rec), deviceToken: token }); // de app bewaart dit ook lokaal, zodat de koppeling een gewiste cookie overleeft
});

// Koppeling herstellen met het lokaal bewaarde token (als de cookie van de app is verdwenen).
resident.post('/restore', (req, res) => {
  const token = typeof req.body?.token === 'string' ? req.body.token : '';
  if (token.length < 20 || token.length > 100) return res.status(400).json({ error: 'Ongeldig token' });
  const hash = sha(token);
  const rec = db().residents.find((r) => auth.safeEqual(r.tokenHash, hash));
  if (!rec || !houseOf(rec.houseId)) return res.status(404).json({ error: 'Koppeling niet gevonden' });
  setCookie(res, token);
  res.json(view(rec));
});

// Gewenste status voor het eigen huis voorstellen (de beheerder moet dit nog goedkeuren).
resident.post('/set', (req, res) => {
  const rec = currentResident(req);
  if (!rec) return res.status(401).json({ error: 'Kies eerst jouw huis' });
  const status = req.body?.status;
  if (!STATUSES.includes(status)) return res.status(400).json({ error: 'Ongeldige status' });
  const house = houseOf(rec.houseId);
  if (mode() === 'swap' && !(status !== 'none' && house.status !== 'none')) {
    return res.status(403).json({ error: 'Na de einddatum kun je alleen nog wisselen tussen groen en rood', mode: 'swap' });
  }
  const d = db();
  const prop = proposalOf(rec);
  let changed = false;
  if (status === house.status) {
    if (prop) { d.proposals = d.proposals.filter((p) => p !== prop); changed = true; }
  } else if (prop) {
    changed = prop.to !== status;
    prop.to = status; prop.from = house.status; prop.updatedAt = new Date().toISOString();
  } else {
    if (d.proposals.length >= MAX_PENDING) return res.status(503).json({ error: 'Er wachten te veel wijzigingen op goedkeuring' });
    d.proposals.push({ id: crypto.randomBytes(6).toString('hex'), residentId: rec.rid, houseId: house.id, from: house.status, to: status, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    changed = true;
  }
  rec.lastActivity = new Date().toISOString();
  rec.ip = req.ip;
  rec.notice = null;
  store.save();
  if (changed && status !== house.status) notifyAdmin();
  res.json(view(rec));
});

resident.post('/ack', (req, res) => {
  const rec = currentResident(req);
  if (!rec) return res.status(401).json({ error: 'Niet aangemeld' });
  rec.notice = null;
  store.save();
  res.json({ ok: true });
});

// ---------- beheer ----------
const admin = express.Router();

const list = () => {
  prune();
  const d = db();
  const rows = d.proposals.map((p) => {
    const h = houseOf(p.houseId);
    return { id: p.id, rid: p.residentId, houseId: p.houseId, title: titleOf(h), from: p.from, to: p.to, updatedAt: p.updatedAt };
  }).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const residents = d.residents.map((r) => ({ rid: r.rid, houseId: r.houseId, title: titleOf(houseOf(r.houseId)), createdAt: r.createdAt, lastActivity: r.lastActivity, ip: r.ip || null }));
  const blocked = (d.blocked || []).map((b) => ({ id: b.id, title: b.title, ip: b.ip || null, at: b.at }));
  return { enabled: storedEnabled(), appOnly: storedAppOnly(), geofence: { on: db().settings?.residentsGeofence === true, radius: geofence().radius, hasCenter: !!geoCenter() }, schedule: { swap: swapAfter(), on: db().settings?.residentsOff === true, until: db().settings?.residentsUntil || null, active: scheduled() }, pending: rows, residents, blocked };
};

admin.get('/changes', (req, res) => res.json(list()));
admin.get('/changes/count', (req, res) => { prune(); res.json({ pending: db().proposals.length }); });

function decide(prop, approve) {
  const d = db();
  const rec = d.residents.find((r) => r.rid === prop.residentId);
  const house = houseOf(prop.houseId);
  if (approve && house) house.status = prop.to;
  if (rec) rec.notice = { decision: approve ? 'approved' : 'rejected', status: prop.to, at: new Date().toISOString() };
  d.proposals = d.proposals.filter((p) => p !== prop);
  return house ? { houseId: house.id, status: house.status } : null;
}

admin.post('/changes/approve-all', backups.afterSave('Wijzigingen van bewoners goedgekeurd'), (req, res) => {
  prune();
  const changes = [];
  for (const prop of [...db().proposals]) { const c = decide(prop, true); if (c) changes.push(c); }
  store.save();
  res.json({ changes });
});

const decideRoute = (approve) => (req, res) => {
  const prop = db().proposals.find((p) => p.id === req.params.id);
  if (!prop) return res.status(404).json({ error: 'Wijziging niet gevonden (misschien al behandeld)' });
  const change = decide(prop, approve);
  store.save();
  res.json({ change });
};
admin.post('/changes/:id/approve', backups.afterSave('Wijziging van bewoner goedgekeurd'), decideRoute(true));
admin.post('/changes/:id/reject', backups.afterSave('Wijziging van bewoner afgewezen'), decideRoute(false));

admin.delete('/residents/:rid', (req, res) => {
  const d = db();
  const before = d.residents.length;
  d.residents = d.residents.filter((r) => r.rid !== req.params.rid);
  d.proposals = d.proposals.filter((p) => p.residentId !== req.params.rid);
  store.save();
  res.json({ removed: before - d.residents.length });
});

// Een apparaat blokkeren (en optioneel ook het IP-adres); de koppeling en openstaande wijzigingen verdwijnen.
admin.post('/residents/:rid/block', (req, res) => {
  const d = db();
  const rec = d.residents.find((r) => r.rid === req.params.rid);
  if (!rec) return res.status(404).json({ error: 'Apparaat niet gevonden' });
  const withIp = req.body?.withIp === true && !!rec.ip;
  d.blocked = d.blocked || [];
  d.blocked.push({ id: crypto.randomBytes(6).toString('hex'), tokenHash: rec.tokenHash, ip: withIp ? rec.ip : null, title: titleOf(houseOf(rec.houseId)), at: new Date().toISOString() });
  d.residents = d.residents.filter((r) => r !== rec);
  d.proposals = d.proposals.filter((p) => p.residentId !== rec.rid);
  store.save();
  res.json({ blocked: true, withIp });
});

admin.delete('/blocks/:id', (req, res) => {
  const d = db();
  const before = (d.blocked || []).length;
  d.blocked = (d.blocked || []).filter((b) => b.id !== req.params.id);
  store.save();
  res.json({ removed: before - d.blocked.length });
});

// ---- pushmeldingen: apparaten van de beheerder ----
admin.get('/push/key', (req, res) => res.json({ publicKey: push.publicKey() }));
admin.get('/push/devices', (req, res) => res.json(push.devices()));
admin.post('/push/subscribe', (req, res) => {
  try { res.json({ id: push.addDevice(req.body?.subscription, req.body?.label) }); }
  catch (err) { res.status(400).json({ error: err.message }); }
});
admin.delete('/push/devices/:id', (req, res) => res.json({ removed: push.removeDevice(req.params.id) }));
admin.post('/push/test', async (req, res) => {
  const r = await push.send({ title: 'Testmelding', body: 'Meldingen werken op dit apparaat.', url: '/beheer#changes', tag: 'test' });
  res.json(r);
});

module.exports = { resident, admin, prune, reconcile, enabled, mode, geofence, GEO_MIN, GEO_MAX, GEO_DEFAULT_RADIUS, appOnly, info, untilMs, DEFAULT_INFO };
