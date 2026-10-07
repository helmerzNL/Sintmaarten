'use strict';
const crypto = require('node:crypto');
const path = require('node:path');
const express = require('express');
const {
  generateRegistrationOptions, verifyRegistrationResponse,
  generateAuthenticationOptions, verifyAuthenticationResponse,
} = require('@simplewebauthn/server');

const config = require('./config');
const store = require('./store');
const auth = require('./auth');

const app = express();
app.set('trust proxy', true);
app.disable('x-powered-by');
app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'X-Frame-Options': 'DENY',
    'Content-Security-Policy':
      "default-src 'self'; img-src 'self' data: blob: https://tile.openstreetmap.org; connect-src 'self' https://nominatim.openstreetmap.org; object-src 'self' blob:; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'",
  });
  next();
});
app.use(express.json({ limit: '2mb' }));
app.use(auth.sameOrigin);

// ---------- challenges (in-memory, kort geldig) ----------
const challenges = new Map();
function putChallenge(data) {
  const id = crypto.randomBytes(16).toString('base64url');
  challenges.set(id, { ...data, exp: Date.now() + 5 * 60 * 1000 });
  return id;
}
function takeChallenge(id) {
  const c = challenges.get(id);
  challenges.delete(id);
  for (const [k, v] of challenges) if (v.exp < Date.now()) challenges.delete(k);
  return c && c.exp > Date.now() ? c : null;
}

const asyncRoute = (fn) => (req, res) =>
  Promise.resolve(fn(req, res)).catch((err) => {
    console.error(err);
    res.status(400).json({ error: err.message || 'Er ging iets mis' });
  });

function userId() {
  const db = store.db();
  if (!db.userId) { db.userId = crypto.randomBytes(32).toString('base64url'); store.save(); }
  return Buffer.from(db.userId, 'base64url');
}

// ---------- publiek ----------
app.get('/api/map', (req, res) => {
  const { view, houses } = store.db();
  res.set('Cache-Control', 'no-cache');
  res.json({ title: config.siteTitle, view, houses });
});

// ---------- auth ----------
app.get('/api/auth/status', (req, res) => {
  res.json({ configured: store.db().passkeys.length > 0, loggedIn: auth.isLoggedIn(req) });
});

app.post('/api/auth/register/options', asyncRoute(async (req, res) => {
  const db = store.db();
  const loggedIn = auth.isLoggedIn(req);
  if (!loggedIn) {
    if (db.passkeys.length > 0) return res.status(401).json({ error: 'Niet ingelogd' });
    if (auth.limiter.blocked(req.ip)) return res.status(429).json({ error: 'Te veel pogingen, probeer later opnieuw' });
    if (!auth.safeEqual(req.body.setupToken || '', config.setupToken)) {
      auth.limiter.fail(req.ip);
      return res.status(403).json({ error: 'Onjuiste installatiecode' });
    }
  }
  const name = String(req.body.name || 'Passkey').slice(0, 60);
  const options = await generateRegistrationOptions({
    rpName: config.siteTitle,
    rpID: config.rpID,
    userName: 'beheerder',
    userDisplayName: 'Beheerder',
    userID: userId(),
    attestationType: 'none',
    excludeCredentials: db.passkeys.map((p) => ({ id: p.id, transports: p.transports })),
    authenticatorSelection: { residentKey: 'preferred', userVerification: 'preferred' },
  });
  const challengeId = putChallenge({ challenge: options.challenge, kind: 'register', name, firstSetup: !loggedIn });
  res.json({ challengeId, options });
}));

app.post('/api/auth/register/verify', asyncRoute(async (req, res) => {
  const c = takeChallenge(req.body.challengeId);
  if (!c || c.kind !== 'register') return res.status(400).json({ error: 'Sessie verlopen, begin opnieuw' });
  const db = store.db();
  // Een eerste setup mag alleen lukken zolang er nog geen passkey is.
  if (c.firstSetup && db.passkeys.length > 0) return res.status(403).json({ error: 'Er is al een passkey ingesteld' });
  if (!c.firstSetup && !auth.isLoggedIn(req)) return res.status(401).json({ error: 'Niet ingelogd' });

  const v = await verifyRegistrationResponse({
    response: req.body.response,
    expectedChallenge: c.challenge,
    expectedOrigin: config.origin,
    expectedRPID: config.rpID,
  });
  if (!v.verified) return res.status(400).json({ error: 'Passkey kon niet worden geverifieerd' });
  const { credential } = v.registrationInfo;
  db.passkeys.push({
    id: credential.id,
    publicKey: Buffer.from(credential.publicKey).toString('base64url'),
    counter: credential.counter,
    transports: credential.transports || [],
    name: c.name,
    createdAt: new Date().toISOString(),
  });
  store.save();
  auth.limiter.reset(req.ip);
  if (c.firstSetup) auth.startSession(res);
  res.json({ ok: true });
}));

app.post('/api/auth/login/options', asyncRoute(async (req, res) => {
  const db = store.db();
  if (!db.passkeys.length) return res.status(409).json({ error: 'Nog geen passkey ingesteld' });
  if (auth.limiter.blocked(req.ip)) return res.status(429).json({ error: 'Te veel pogingen, probeer later opnieuw' });
  const options = await generateAuthenticationOptions({
    rpID: config.rpID,
    userVerification: 'preferred',
    allowCredentials: db.passkeys.map((p) => ({ id: p.id, transports: p.transports })),
  });
  res.json({ challengeId: putChallenge({ challenge: options.challenge, kind: 'login' }), options });
}));

app.post('/api/auth/login/verify', asyncRoute(async (req, res) => {
  if (auth.limiter.blocked(req.ip)) return res.status(429).json({ error: 'Te veel pogingen, probeer later opnieuw' });
  const c = takeChallenge(req.body.challengeId);
  if (!c || c.kind !== 'login') return res.status(400).json({ error: 'Sessie verlopen, begin opnieuw' });
  const db = store.db();
  const pk = db.passkeys.find((p) => p.id === req.body.response?.id);
  if (!pk) { auth.limiter.fail(req.ip); return res.status(400).json({ error: 'Onbekende passkey' }); }
  let v;
  try {
    v = await verifyAuthenticationResponse({
      response: req.body.response,
      expectedChallenge: c.challenge,
      expectedOrigin: config.origin,
      expectedRPID: config.rpID,
      credential: {
        id: pk.id,
        publicKey: Buffer.from(pk.publicKey, 'base64url'),
        counter: pk.counter,
        transports: pk.transports,
      },
    });
  } catch (err) {
    auth.limiter.fail(req.ip);
    throw err;
  }
  if (!v.verified) { auth.limiter.fail(req.ip); return res.status(400).json({ error: 'Inloggen mislukt' }); }
  pk.counter = v.authenticationInfo.newCounter;
  pk.lastUsed = new Date().toISOString();
  store.save();
  auth.limiter.reset(req.ip);
  auth.startSession(res);
  res.json({ ok: true });
}));

app.post('/api/auth/logout', (req, res) => { auth.endSession(res); res.json({ ok: true }); });

// ---------- beheer ----------
const admin = express.Router();
admin.use(auth.requireAdmin);

admin.get('/passkeys', (req, res) => {
  res.json(store.db().passkeys.map(({ id, name, createdAt, lastUsed }) => ({ id, name, createdAt, lastUsed })));
});

admin.delete('/passkeys/:id', (req, res) => {
  const db = store.db();
  if (db.passkeys.length <= 1) return res.status(400).json({ error: 'Je kunt de laatste passkey niet verwijderen' });
  db.passkeys = db.passkeys.filter((p) => p.id !== req.params.id);
  store.save();
  res.json({ ok: true });
});

admin.put('/view', (req, res) => {
  const { center, zoom } = req.body || {};
  if (!validLatLng(center) || !(zoom >= 1 && zoom <= 20)) return res.status(400).json({ error: 'Ongeldige kaartweergave' });
  const db = store.db();
  db.view = { center: center.map((n) => Math.round(n * 1e6) / 1e6), zoom: Math.round(zoom * 100) / 100 };
  store.save();
  res.json({ view: db.view });
});

const validLatLng = (p) =>
  Array.isArray(p) && p.length === 2 && p.every(Number.isFinite) && Math.abs(p[0]) <= 85.06 && Math.abs(p[1]) <= 180;

const STATUSES = ['green', 'red', 'none'];
const clean = (s, n) => String(s ?? '').trim().slice(0, n);

function validateHouses(list) {
  if (!Array.isArray(list) || list.length > 2000) throw new Error('Ongeldige lijst met huizen');
  return list.map((h) => {
    if (!Array.isArray(h.points) || h.points.length < 3 || h.points.length > 200) throw new Error('Een huis heeft minimaal 3 punten nodig');
    const points = h.points.map((p) => {
      if (!validLatLng(p)) throw new Error('Ongeldig punt');
      return p.map((n) => Math.round(n * 1e7) / 1e7);
    });
    return {
      id: /^[\w-]{1,40}$/.test(h.id) ? h.id : crypto.randomBytes(6).toString('hex'),
      label: clean(h.label, 100),
      note: clean(h.note, 500),
      status: STATUSES.includes(h.status) ? h.status : 'none',
      points,
    };
  });
}

admin.put('/houses', (req, res) => {
  try {
    const db = store.db();
    db.houses = validateHouses(req.body.houses);
    store.save();
    res.json({ houses: db.houses });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.use('/api/admin', admin);
app.use('/api', (req, res) => res.status(404).json({ error: 'Niet gevonden' }));

// ---------- statische bestanden ----------
const pub = path.join(__dirname, '..', 'public');
const nm = (...p) => path.join(__dirname, '..', 'node_modules', ...p);
app.get('/vendor/webauthn.js', (req, res) => res.sendFile(nm('@simplewebauthn', 'browser', 'dist', 'bundle', 'index.umd.min.js')));
app.get('/vendor/jspdf.js', (req, res) => res.sendFile(nm('jspdf', 'dist', 'jspdf.umd.min.js')));
app.use('/vendor/leaflet', express.static(nm('leaflet', 'dist'), { index: false }));
app.use(express.static(pub, { extensions: ['html'] }));
app.get('/beheer', (req, res) => res.sendFile(path.join(pub, 'admin', 'index.html')));

module.exports = app;

if (require.main === module) {
  app.listen(config.port, () => {
    console.log(`Sint Maarten draait op poort ${config.port} (${config.origin}, rpID ${config.rpID})`);
    if (config.setupTokenGenerated && !store.db().passkeys.length) {
      console.log(`\nINSTALLATIE: er is geen SETUP_TOKEN ingesteld. Tijdelijke code voor de eerste passkey:\n  ${config.setupToken}\n`);
    }
    if (config.sessionSecretGenerated) {
      console.warn('Let op: SESSION_SECRET niet ingesteld; sessies vervallen bij elke herstart.');
    }
  });
}
