'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const {
  generateRegistrationOptions, verifyRegistrationResponse,
  generateAuthenticationOptions, verifyAuthenticationResponse,
} = require('@simplewebauthn/server');

const config = require('./config');
const store = require('./store');
const auth = require('./auth');
const { hashPassword, verifyPassword } = require('./password');
const backups = require('./backups');
const appVersion = require('./version');

const app = express();
app.set('trust proxy', true);
app.disable('x-powered-by');
app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'X-Frame-Options': 'DENY',
    'Content-Security-Policy':
      "default-src 'self'; img-src 'self' data: blob: https://tile.openstreetmap.org; connect-src 'self' https://nominatim.openstreetmap.org https://tile.openstreetmap.org; worker-src 'self'; manifest-src 'self'; object-src 'self' blob:; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'",
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
    res.status(err.status || 400).json({ error: err.message || 'Er ging iets mis' });
  });

function userId() {
  const db = store.db();
  if (!db.userId) { db.userId = crypto.randomBytes(32).toString('base64url'); store.save(); }
  return Buffer.from(db.userId, 'base64url');
}

// ---------- publiek ----------
app.get('/api/map', (req, res) => {
  const { view, houses, settings } = store.db();
  res.set('Cache-Control', 'no-cache');
  res.json({
    title: config.siteTitle, view, houses,
    intro: settings?.intro || '', logo: settings?.logo || null,
    appName: settings?.appName || '', appShortName: settings?.appShortName || '',
  });
});

app.use('/uploads', express.static(store.uploadDir, { immutable: true, maxAge: '365d', index: false }));

// PWA-manifest met de naam van de site
app.get('/manifest.webmanifest', (req, res) => {
  const st = store.db().settings || {};
  const name = st.appName || config.siteTitle;
  const shortName = st.appShortName || (name.length > 12 ? name.slice(0, 12) : name);
  res.type('application/manifest+json').json({
    name,
    short_name: shortName,
    description: `Kaart van ${name}`,
    lang: 'nl',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#f4f6f4',
    theme_color: '#1f6f4a',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  });
});

// ---------- auth ----------
app.get('/api/auth/status', (req, res) => {
  const db = store.db();
  const method = auth.sessionMethod(req);
  res.json({ configured: db.passkeys.length > 0, loggedIn: !!method, method, passwordEnabled: !!db.password });
});

app.post('/api/auth/register/options', asyncRoute(async (req, res) => {
  const db = store.db();
  const loggedIn = auth.isLoggedIn(req);
  if (loggedIn && auth.sessionMethod(req) !== 'pk') return res.status(403).json({ error: 'Log in met een passkey om dit te wijzigen' });
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
  if (!c.firstSetup && auth.sessionMethod(req) !== 'pk') return res.status(401).json({ error: 'Niet ingelogd met een passkey' });

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

// Controleert een passkey-antwoord op een eerder uitgegeven uitdaging ("login" of "confirm").
async function verifyAssertion(req, kind) {
  const c = takeChallenge(req.body.challengeId);
  if (!c || c.kind !== kind) throw Object.assign(new Error('Sessie verlopen, begin opnieuw'), { status: 400 });
  const db = store.db();
  const pk = db.passkeys.find((p) => p.id === req.body.response?.id);
  if (!pk) throw Object.assign(new Error('Onbekende passkey'), { status: 400 });
  const v = await verifyAuthenticationResponse({
    response: req.body.response,
    expectedChallenge: c.challenge,
    expectedOrigin: config.origin,
    expectedRPID: config.rpID,
    requireUserVerification: true,
    credential: { id: pk.id, publicKey: Buffer.from(pk.publicKey, 'base64url'), counter: pk.counter, transports: pk.transports },
  });
  if (!v.verified) throw Object.assign(new Error('Passkey kon niet worden geverifieerd'), { status: 400 });
  pk.counter = v.authenticationInfo.newCounter;
  pk.lastUsed = new Date().toISOString();
  store.save();
}

app.post('/api/auth/login/verify', asyncRoute(async (req, res) => {
  if (auth.limiter.blocked(req.ip)) return res.status(429).json({ error: 'Te veel pogingen, probeer later opnieuw' });
  try {
    await verifyAssertion(req, 'login');
  } catch (err) {
    auth.limiter.fail(req.ip);
    throw err;
  }
  auth.limiter.reset(req.ip);
  auth.startSession(res, 'pk');
  res.json({ ok: true });
}));

// Inloggen met wachtwoord (alleen als dat in het beheer is ingesteld).
const PW_GLOBAL = '*password';
app.post('/api/auth/password-login', asyncRoute(async (req, res) => {
  const db = store.db();
  if (auth.limiter.blocked(req.ip) || auth.limiter.blocked(PW_GLOBAL, 30)) {
    return res.status(429).json({ error: 'Te veel pogingen, probeer later opnieuw' });
  }
  const password = typeof req.body.password === 'string' ? req.body.password.slice(0, 200) : '';
  // Ook zonder ingesteld wachtwoord rekenen we, zodat de responstijd niets verklapt.
  const stored = db.password || await hashPassword('x');
  const ok = await verifyPassword(password, stored);
  if (!db.password || !ok) {
    auth.limiter.fail(req.ip);
    auth.limiter.fail(PW_GLOBAL);
    return res.status(401).json({ error: 'Onjuist wachtwoord' });
  }
  auth.limiter.reset(req.ip);
  auth.startSession(res, 'pw');
  res.json({ ok: true });
}));

app.post('/api/auth/logout', (req, res) => { auth.endSession(res); res.json({ ok: true }); });

// ---------- beheer ----------
const admin = express.Router();
admin.use(auth.requireAdmin);

const pwError = (res, err) => res.status(err.status || 400).json({ error: err.message });

// Wachtwoord instellen of verwijderen moet met een passkey worden bevestigd.
admin.post('/password/options', auth.requirePasskeySession, asyncRoute(async (req, res) => {
  const db = store.db();
  const options = await generateAuthenticationOptions({
    rpID: config.rpID,
    userVerification: 'required',
    allowCredentials: db.passkeys.map((p) => ({ id: p.id, transports: p.transports })),
  });
  res.json({ challengeId: putChallenge({ challenge: options.challenge, kind: 'confirm' }), options });
}));

admin.put('/password', auth.requirePasskeySession, asyncRoute(async (req, res) => {
  const password = req.body.password;
  if (typeof password !== 'string' || password.length < 10 || password.length > 200) {
    return res.status(400).json({ error: 'Het wachtwoord moet 10 tot 200 tekens lang zijn' });
  }
  try { await verifyAssertion(req, 'confirm'); } catch (err) { return pwError(res, err); }
  store.db().password = await hashPassword(password);
  store.save();
  res.json({ ok: true });
}));

admin.post('/password/remove', auth.requirePasskeySession, asyncRoute(async (req, res) => {
  try { await verifyAssertion(req, 'confirm'); } catch (err) { return pwError(res, err); }
  store.db().password = null;
  store.save();
  res.json({ ok: true });
}));

// Algemene bevestiging met een passkey (voor o.a. het verwijderen van backups).
admin.post('/confirm/options', asyncRoute(async (req, res) => {
  const options = await generateAuthenticationOptions({
    rpID: config.rpID,
    userVerification: 'required',
    allowCredentials: store.db().passkeys.map((p) => ({ id: p.id, transports: p.transports })),
  });
  res.json({ challengeId: putChallenge({ challenge: options.challenge, kind: 'confirm' }), options });
}));

admin.get('/info', (req, res) => {
  const { version, build, buildFull, label } = appVersion;
  res.json({ version, build, buildFull, label });
});

admin.get('/backups', (req, res) => res.json(backups.list()));

admin.get('/backups/:id', (req, res) => {
  const b = backups.read(req.params.id);
  if (!b) return res.status(404).json({ error: 'Backup niet gevonden' });
  res.set('Content-Disposition', `attachment; filename="backup-${b.id}.json"`);
  res.json(b);
});

admin.post('/backups/:id/restore', (req, res) => {
  if (!backups.restore(req.params.id)) return res.status(404).json({ error: 'Backup niet gevonden' });
  res.json({ ok: true });
});

// Verwijderen vereist bevestiging met een passkey.
admin.post('/backups/delete', asyncRoute(async (req, res) => {
  const idsToDelete = req.body.ids;
  if (!Array.isArray(idsToDelete) || !idsToDelete.length || idsToDelete.length > 500 || !idsToDelete.every((i) => typeof i === 'string' && backups.ID.test(i))) {
    return res.status(400).json({ error: 'Geen geldige backups geselecteerd' });
  }
  try { await verifyAssertion(req, 'confirm'); } catch (err) { return pwError(res, err); }
  res.json({ deleted: backups.remove(idsToDelete) });
}));

admin.get('/passkeys', (req, res) => {
  res.json(store.db().passkeys.map(({ id, name, createdAt, lastUsed }) => ({ id, name, createdAt, lastUsed })));
});

admin.delete('/passkeys/:id', auth.requirePasskeySession, (req, res) => {
  const db = store.db();
  if (db.passkeys.length <= 1) return res.status(400).json({ error: 'Je kunt de laatste passkey niet verwijderen' });
  db.passkeys = db.passkeys.filter((p) => p.id !== req.params.id);
  store.save();
  res.json({ ok: true });
});

const IMAGE_TYPES = [
  { ext: 'png', test: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { ext: 'jpg', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { ext: 'webp', test: (b) => b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP' },
];

const removeLogoFile = (logo) => {
  if (logo?.file) fs.rm(path.join(store.uploadDir, path.basename(logo.file)), () => {});
};

admin.post('/logo',
  express.raw({ type: 'application/octet-stream', limit: '5mb' }),
  (req, res) => {
    const buf = req.body;
    const type = Buffer.isBuffer(buf) && IMAGE_TYPES.find((t) => t.test(buf));
    if (!type) return res.status(400).json({ error: 'Alleen PNG, JPEG of WebP is toegestaan (max 5 MB)' });
    const db = store.db();
    const old = db.settings.logo;
    const file = `logo-${Date.now()}.${type.ext}`;
    fs.writeFileSync(path.join(store.uploadDir, file), buf);
    db.settings.logo = { file, url: `/uploads/${file}` };
    store.save();
    removeLogoFile(old);
    res.json({ logo: db.settings.logo });
  });

admin.delete('/logo', (req, res) => {
  const db = store.db();
  removeLogoFile(db.settings.logo);
  db.settings.logo = null;
  store.save();
  res.json({ ok: true });
});

admin.put('/settings', backups.afterSave('Teksten/instellingen opgeslagen'), (req, res) => {
  const body = req.body || {};
  const db = store.db();
  if ('intro' in body) {
    const intro = String(body.intro ?? '').replace(/\r\n?/g, '\n').trim();
    if (intro.length > 5000) return res.status(400).json({ error: 'De uitleg mag maximaal 5000 tekens zijn' });
    db.settings.intro = intro;
  }
  if ('appName' in body) {
    const name = String(body.appName ?? '').trim();
    if (name.length > 45) return res.status(400).json({ error: 'De naam van de app mag maximaal 45 tekens zijn' });
    db.settings.appName = name;
  }
  if ('appShortName' in body) {
    const short = String(body.appShortName ?? '').trim();
    if (short.length > 12) return res.status(400).json({ error: 'De korte naam mag maximaal 12 tekens zijn (past onder het icoon)' });
    db.settings.appShortName = short;
  }
  store.save();
  res.json({ intro: db.settings.intro, appName: db.settings.appName, appShortName: db.settings.appShortName });
});

admin.put('/view', backups.afterSave('Kaartweergave opgeslagen'), (req, res) => {
  const { center, zoom } = req.body || {};
  const minZoom = req.body?.minZoom ?? 1;
  const maxZoom = req.body?.maxZoom ?? 19;
  const okZoom = (z) => Number.isFinite(z) && z >= 1 && z <= 19;
  if (!validLatLng(center) || !okZoom(zoom) || !okZoom(minZoom) || !okZoom(maxZoom)) {
    return res.status(400).json({ error: 'Ongeldige kaartweergave (zoom moet tussen 1 en 19 liggen)' });
  }
  if (minZoom > maxZoom) return res.status(400).json({ error: 'Minimale zoom mag niet groter zijn dan de maximale zoom' });
  if (zoom < minZoom || zoom > maxZoom) return res.status(400).json({ error: 'De startzoom moet tussen de minimale en maximale zoom liggen' });
  const db = store.db();
  db.view = {
    center: center.map((n) => Math.round(n * 1e6) / 1e6),
    zoom: Math.round(zoom * 100) / 100,
    minZoom: Math.round(minZoom * 100) / 100,
    maxZoom: Math.round(maxZoom * 100) / 100,
  };
  store.save();
  res.json({ view: db.view });
});

// Weergave wissen: de site toont dan automatisch alle huizen.
admin.delete('/view', backups.afterSave('Kaartweergave gewist'), (req, res) => {
  store.db().view = null;
  store.save();
  res.json({ view: null });
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

admin.put('/houses', backups.afterSave('Layout opgeslagen'), (req, res) => {
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
// De service worker krijgt de buildversie in zijn cachenaam, zodat een nieuwe build de oude caches opruimt.
app.get('/sw.js', (req, res) => {
  const tag = `${appVersion.version}-${appVersion.build}`.replace(/[^\w.-]/g, '');
  const src = fs.readFileSync(path.join(pub, 'sw.js'), 'utf8').replace(/const VERSION = '[^']*';/, `const VERSION = '${tag}';`);
  res.set({ 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'no-cache' }).send(src);
});
app.use(express.static(pub, {
  extensions: ['html'],
  setHeaders: (res, file) => { if (file.endsWith('sw.js')) res.set('Cache-Control', 'no-cache'); },
}));
app.get('/beheer', (req, res) => res.sendFile(path.join(pub, 'admin', 'index.html')));

module.exports = app;

if (require.main === module) {
  app.listen(config.port, () => {
    console.log(`Sint Maarten draait op poort ${config.port} (${config.origin}, rpID ${config.rpID})`);
    console.log(`Versie ${appVersion.label}`);
    if (config.setupTokenGenerated && !store.db().passkeys.length) {
      console.log(`\nINSTALLATIE: er is geen SETUP_TOKEN ingesteld. Tijdelijke code voor de eerste passkey:\n  ${config.setupToken}\n`);
    }
    if (config.sessionSecretGenerated) {
      console.warn('Let op: SESSION_SECRET niet ingesteld; sessies vervallen bij elke herstart.');
    }
  });
}
