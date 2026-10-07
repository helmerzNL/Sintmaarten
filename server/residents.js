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
const enabled = () => db().settings?.residentsEnabled !== false;

// Verwijdert aanmeldingen en wijzigingen van huizen die niet meer bestaan.
function prune() {
  const d = db();
  const ids = new Set(d.houses.map((h) => h.id));
  d.residents = d.residents.filter((r) => ids.has(r.houseId));
  const rids = new Set(d.residents.map((r) => r.rid));
  d.proposals = d.proposals.filter((p) => rids.has(p.residentId) && ids.has(p.houseId));
}

function currentResident(req) {
  const token = auth.parseCookies(req.headers.cookie)[COOKIE];
  if (!token || token.length < 20) return null;
  const hash = sha(token);
  const rec = db().residents.find((r) => auth.safeEqual(r.tokenHash, hash));
  return rec && houseOf(rec.houseId) ? rec : null;
}

const proposalOf = (rec) => db().proposals.find((p) => p.residentId === rec.rid);

function view(rec) {
  const house = houseOf(rec.houseId);
  const prop = proposalOf(rec);
  return {
    enabled: enabled(),
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
  if (!enabled()) return res.status(403).json({ error: 'Wijzigen door bewoners staat uit', enabled: false });
  if (req.method !== 'GET') {
    const key = `resident:${req.ip}`;
    if (auth.limiter.blocked(key, 120)) return res.status(429).json({ error: 'Te veel verzoeken, probeer het later opnieuw' });
    auth.limiter.fail(key); // telt elk schrijfverzoek
  }
  next();
});

resident.get('/me', (req, res) => {
  const rec = currentResident(req);
  res.json(rec ? view(rec) : { enabled: true, claim: null });
});

// Dit apparaat koppelen aan één huis.
resident.post('/claim', (req, res) => {
  if (currentResident(req)) return res.status(409).json({ error: 'Dit apparaat is al aan een huis gekoppeld' });
  const house = houseOf(String(req.body?.houseId || ''));
  if (!house) return res.status(404).json({ error: 'Huis niet gevonden' });
  if (db().residents.length >= MAX_RESIDENTS) return res.status(503).json({ error: 'Op dit moment zijn er te veel aanmeldingen' });
  const token = crypto.randomBytes(32).toString('base64url');
  const rec = { rid: crypto.randomBytes(6).toString('hex'), tokenHash: sha(token), houseId: house.id, createdAt: new Date().toISOString(), lastActivity: new Date().toISOString(), notice: null };
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
    return { id: p.id, houseId: p.houseId, title: titleOf(h), from: p.from, to: p.to, updatedAt: p.updatedAt };
  }).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const residents = d.residents.map((r) => ({ rid: r.rid, houseId: r.houseId, title: titleOf(houseOf(r.houseId)), createdAt: r.createdAt, lastActivity: r.lastActivity }));
  return { enabled: enabled(), pending: rows, residents };
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

module.exports = { resident, admin, prune, enabled };
