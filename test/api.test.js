const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'sm-'));
process.env.SETUP_TOKEN = 'test-setup-token-123';
process.env.SESSION_SECRET = 'test-session-secret-123';
const app = require('../server/index.js');

let server, base;
test.before(() => new Promise((r) => { server = app.listen(0, () => { base = `http://localhost:${server.address().port}`; r(); }); }));
test.after(() => server.close());

const j = (p, o) => fetch(base + p, o);

test('publieke kaart is leeg maar bereikbaar', async () => {
  const r = await j('/api/map');
  assert.equal(r.status, 200);
  assert.deepEqual((await r.json()).houses, []);
});

test('beheer-API vereist login', async () => {
  for (const [m, p] of [['PUT', '/api/admin/houses'], ['PUT', '/api/admin/view'], ['GET', '/api/admin/passkeys']]) {
    assert.equal((await j(p, { method: m, headers: { 'Content-Type': 'application/json' }, body: m === 'GET' ? undefined : '{}' })).status, 401, p);
  }
});

test('eerste passkey vereist juiste installatiecode', async () => {
  const bad = await j('/api/auth/register/options', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ setupToken: 'nope' }) });
  assert.equal(bad.status, 403);
  const ok = await j('/api/auth/register/options', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ setupToken: 'test-setup-token-123' }) });
  assert.equal(ok.status, 200);
  assert.ok((await ok.json()).options.challenge);
});

test('vreemde origin wordt geweigerd', async () => {
  const r = await j('/api/auth/logout', { method: 'POST', headers: { Origin: 'https://evil.example' } });
  assert.equal(r.status, 403);
});

const crypto = require('node:crypto');
const exp = String(Date.now() + 3600e3);
const cookie = `sm_session=${exp}.${crypto.createHmac('sha256', 'test-session-secret-123').update(exp).digest('base64url')}`;
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]);

test('uitleg opslaan en publiek tonen', async () => {
  const put = await j('/api/admin/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json', cookie }, body: JSON.stringify({ intro: 'Hallo\r\n\r\nwijk ' }) });
  assert.equal(put.status, 200);
  assert.equal((await (await j('/api/map')).json()).intro, 'Hallo\n\nwijk');
  const tooLong = await j('/api/admin/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json', cookie }, body: JSON.stringify({ intro: 'x'.repeat(5001) }) });
  assert.equal(tooLong.status, 400);
});

test('logo upload controleert inhoud en kan verwijderd worden', async () => {
  const bad = await j('/api/admin/logo', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', cookie }, body: Buffer.from('<svg onload=alert(1)>') });
  assert.equal(bad.status, 400);
  const ok = await j('/api/admin/logo', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', cookie }, body: PNG });
  assert.equal(ok.status, 200);
  const { logo } = await ok.json();
  assert.match(logo.url, /^\/uploads\/logo-\d+\.png$/);
  assert.equal((await j(logo.url)).status, 200);
  assert.equal((await (await j('/api/map')).json()).logo.url, logo.url);
  assert.equal((await j('/api/admin/logo', { method: 'DELETE', headers: { cookie } })).status, 200);
  assert.equal((await (await j('/api/map')).json()).logo, null);
});

test('manifest en service worker zijn beschikbaar', async () => {
  const m = await (await j('/manifest.webmanifest')).json();
  assert.equal(m.display, 'standalone');
  assert.ok(m.icons.some((i) => i.sizes === '512x512'));
  const sw = await j('/sw.js');
  assert.equal(sw.status, 200);
  assert.equal(sw.headers.get('cache-control'), 'no-cache');
});

const store = require('../server/store');
const { hashPassword } = require('../server/password');
const sessionCookie = (method) => {
  const e = String(Date.now() + 3600e3);
  return `sm_session=${e}.${method}.${crypto.createHmac('sha256', 'test-session-secret-123').update(`${e}.${method}`).digest('base64url')}`;
};
const jsonH = (c) => ({ 'Content-Type': 'application/json', ...(c ? { cookie: c } : {}) });

test('appnaam komt in het manifest en wordt gevalideerd', async () => {
  const put = (body) => j('/api/admin/settings', { method: 'PUT', headers: jsonH(cookie), body: JSON.stringify(body) });
  assert.equal((await put({ appName: 'Wijk Sint Maarten', appShortName: 'Sint Maarten' })).status, 200);
  const m = await (await j('/manifest.webmanifest')).json();
  assert.equal(m.name, 'Wijk Sint Maarten');
  assert.equal(m.short_name, 'Sint Maarten');
  assert.equal((await put({ appShortName: 'veel te lange korte naam' })).status, 400);
  assert.equal((await put({ appName: '' , appShortName: '' })).status, 200);
  assert.equal((await (await j('/manifest.webmanifest')).json()).name, 'Onze wijk');
});

test('wachtwoord: inloggen, beperkingen en bevestiging met passkey', async () => {
  // zonder ingesteld wachtwoord kan niemand inloggen
  assert.equal((await j('/api/auth/password-login', { method: 'POST', headers: jsonH(), body: JSON.stringify({ password: 'iets-geheims-123' }) })).status, 401);
  // instellen zonder passkey-bevestiging mislukt
  const noProof = await j('/api/admin/password', { method: 'PUT', headers: jsonH(cookie), body: JSON.stringify({ password: 'een-lang-wachtwoord' }) });
  assert.equal(noProof.status, 400);
  const short = await j('/api/admin/password', { method: 'PUT', headers: jsonH(cookie), body: JSON.stringify({ password: 'kort' }) });
  assert.equal(short.status, 400);
  assert.equal((await j('/api/admin/password', { method: 'PUT', headers: jsonH(), body: '{}' })).status, 401);

  store.db().password = await hashPassword('een-lang-wachtwoord');
  const bad = await j('/api/auth/password-login', { method: 'POST', headers: jsonH(), body: JSON.stringify({ password: 'fout-wachtwoord-1' }) });
  assert.equal(bad.status, 401);
  const ok = await j('/api/auth/password-login', { method: 'POST', headers: jsonH(), body: JSON.stringify({ password: 'een-lang-wachtwoord' }) });
  assert.equal(ok.status, 200);
  const set = ok.headers.get('set-cookie').split(';')[0];
  const st = await (await j('/api/auth/status', { headers: { cookie: set } })).json();
  assert.deepEqual([st.loggedIn, st.method, st.passwordEnabled], [true, 'pw', true]);

  // met een wachtwoord-sessie mag je kaartgegevens beheren, maar geen passkeys/wachtwoord
  assert.equal((await j('/api/admin/passkeys', { headers: { cookie: set } })).status, 200);
  assert.equal((await j('/api/admin/password/options', { method: 'POST', headers: jsonH(set), body: '{}' })).status, 403);
  assert.equal((await j('/api/admin/passkeys/x', { method: 'DELETE', headers: { cookie: set } })).status, 403);
  assert.equal((await j('/api/auth/register/options', { method: 'POST', headers: jsonH(set), body: '{}' })).status, 403);
  // met een passkey-sessie krijg je wel uitdaging voor bevestiging
  const opts = await j('/api/admin/password/options', { method: 'POST', headers: jsonH(sessionCookie('pk')), body: '{}' });
  assert.equal(opts.status, 200);
  assert.ok((await opts.json()).options.challenge);
  store.db().password = null;
});
