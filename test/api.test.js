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
