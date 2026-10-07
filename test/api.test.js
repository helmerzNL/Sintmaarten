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

test('kaartweergave instellen, valideren en wissen', async () => {
  const h = { 'Content-Type': 'application/json', cookie };
  const ok = await j('/api/admin/view', { method: 'PUT', headers: h, body: JSON.stringify({ center: [52.02, 5.16], zoom: 17.5, minZoom: 14, maxZoom: 19 }) });
  assert.equal(ok.status, 200);
  assert.deepEqual((await (await j('/api/map')).json()).view, { center: [52.02, 5.16], zoom: 17.5, minZoom: 14, maxZoom: 19, showNumbers: false });
  for (const bad of [{ zoom: 25 }, { minZoom: 18, maxZoom: 15 }, { zoom: 10, minZoom: 14 }, { center: [200, 5] }]) {
    const r = await j('/api/admin/view', { method: 'PUT', headers: h, body: JSON.stringify({ center: [52.02, 5.16], zoom: 17, ...bad }) });
    assert.equal(r.status, 400, JSON.stringify(bad));
  }
  assert.equal((await j('/api/admin/view', { method: 'DELETE', headers: { cookie } })).status, 200);
  assert.equal((await (await j('/api/map')).json()).view, null);
});

const backups = require('../server/backups');
const H = [{ id: 'a1', label: '1', status: 'green', note: '', points: [[52, 5], [52.001, 5], [52.001, 5.001]] }];

test('na elke opslagpoging komt er een backup (layout + teksten)', async () => {
  const before = backups.list().length;
  const putHouses = (houses) => j('/api/admin/houses', { method: 'PUT', headers: jsonH(cookie), body: JSON.stringify({ houses }) });
  assert.equal((await putHouses(H)).status, 200);
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(backups.list().length, before + 1);
  const latest = backups.read(backups.list()[0].id);
  assert.equal(latest.houses.length, 1);
  assert.equal(latest.reason, 'Layout opgeslagen');
  assert.ok('intro' in latest.texts && 'appName' in latest.texts);

  // identieke staat -> geen dubbele backup; mislukte poging verandert niets
  assert.equal((await putHouses(H)).status, 200);
  assert.equal((await putHouses([{ points: [[1, 1]] }])).status, 400);
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(backups.list().length, before + 1);

  // tekstwijziging -> nieuwe backup
  await j('/api/admin/settings', { method: 'PUT', headers: jsonH(cookie), body: JSON.stringify({ intro: 'Nieuwe uitleg' }) });
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(backups.list().length, before + 2);
});

test('backups: lijst, terugzetten en verwijderen vereist passkey-bevestiging', async () => {
  assert.equal((await j('/api/admin/backups')).status, 401);
  const list = await (await j('/api/admin/backups', { headers: { cookie } })).json();
  const oldest = list[list.length - 1];
  // terugzetten: layout van die backup terug, en eerst een backup van de huidige staat
  await j('/api/admin/houses', { method: 'PUT', headers: jsonH(cookie), body: JSON.stringify({ houses: [] }) });
  const target = list.find((b) => b.houses === 1 && b.reason === 'Layout opgeslagen');
  const r = await j(`/api/admin/backups/${target.id}/restore`, { method: 'POST', headers: jsonH(cookie), body: '{}' });
  assert.equal(r.status, 200);
  assert.equal((await (await j('/api/map')).json()).houses.length, 1);
  assert.equal((await j('/api/admin/backups/onzin/restore', { method: 'POST', headers: jsonH(cookie), body: '{}' })).status, 404);

  // verwijderen zonder geldige passkey-bevestiging mislukt en laat alles intact
  const n = backups.list().length;
  const del = await j('/api/admin/backups/delete', { method: 'POST', headers: jsonH(cookie), body: JSON.stringify({ ids: [oldest.id] }) });
  assert.equal(del.status, 400);
  const badIds = await j('/api/admin/backups/delete', { method: 'POST', headers: jsonH(cookie), body: JSON.stringify({ ids: ['../../etc/passwd'] }) });
  assert.equal(badIds.status, 400);
  assert.equal(backups.list().length, n);
  assert.equal((await j('/api/admin/backups/delete', { method: 'POST', headers: jsonH(), body: '{}' })).status, 401);
  assert.ok(backups.read(oldest.id));
});

const { execFileSync } = require('node:child_process');

test('versie-info is alleen voor beheerders en toont versie en build', async () => {
  assert.equal((await j('/api/admin/info')).status, 401);
  const info = await (await j('/api/admin/info', { headers: { cookie } })).json();
  assert.ok(info.version && info.build && info.label.includes(info.build));
  assert.match(info.label, /^(v\d+\.\d+\.\d+|dev) \(.+\)$/);
});

test('service worker krijgt de buildversie in zijn cachenaam', async () => {
  const sw = await (await j('/sw.js')).text();
  assert.match(sw, /const VERSION = '[\w.-]+';/);
  assert.doesNotMatch(sw, /const VERSION = 'v1';/);
});

test('tools/next-version.sh telt per build 0.0.1 op, beginnend bij 0.1.0', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ver-'));
  fs.mkdirSync(path.join(dir, 'tools'));
  fs.copyFileSync(path.join(__dirname, '..', 'tools', 'next-version.sh'), path.join(dir, 'tools', 'next-version.sh'));
  fs.chmodSync(path.join(dir, 'tools', 'next-version.sh'), 0o755);
  fs.writeFileSync(path.join(dir, 'VERSION'), '0.1\n');
  const run = (...a) => execFileSync(a[0], a.slice(1), { cwd: dir, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } }).trim();
  run('git', 'init', '-q');
  run('git', 'commit', '-q', '--allow-empty', '-m', 'x');
  assert.equal(run('sh', 'tools/next-version.sh'), '0.1.0');
  run('git', 'tag', 'v0.1.0');
  assert.equal(run('sh', 'tools/next-version.sh'), '0.1.1');
  run('git', 'tag', 'v0.1.1'); run('git', 'tag', 'v0.1.9'); run('git', 'tag', 'v0.1.10'); run('git', 'tag', 'v0.2.5'); run('git', 'tag', 'v0.1.foo');
  assert.equal(run('sh', 'tools/next-version.sh'), '0.1.11'); // numeriek sorteren, andere minor/rommel negeren
});

test('huizen hebben straat en huisnummer; oude "label" wordt huisnummer', async () => {
  const pts = [[52, 5], [52.001, 5], [52.001, 5.001]];
  const put = (houses) => j('/api/admin/houses', { method: 'PUT', headers: jsonH(cookie), body: JSON.stringify({ houses }) });
  const r = await put([
    { id: 'n1', street: '  Loerikseweg ', number: '12a', status: 'green', points: pts },
    { id: 'n2', label: '7', status: 'red', points: pts }, // oud formaat
    { id: 'n3', street: 'X'.repeat(300), number: '9'.repeat(50), status: 'bogus', points: pts },
  ]);
  assert.equal(r.status, 200);
  const { houses } = await r.json();
  assert.deepEqual([houses[0].street, houses[0].number, 'label' in houses[0]], ['Loerikseweg', '12a', false]);
  assert.deepEqual([houses[1].street, houses[1].number], ['', '7']);
  assert.equal(houses[2].street.length, 100);
  assert.equal(houses[2].number.length, 20);
  assert.equal(houses[2].status, 'none');
  const map = await (await j('/api/map')).json();
  assert.equal(map.houses[0].number, '12a');
});

test('kaartweergave bewaart de standaardkeuze voor huisnummers', async () => {
  const put = (extra) => j('/api/admin/view', { method: 'PUT', headers: jsonH(cookie), body: JSON.stringify({ center: [52, 5], zoom: 17, ...extra }) });
  assert.equal((await put({ showNumbers: true })).status, 200);
  assert.equal((await (await j('/api/map')).json()).view.showNumbers, true);
  assert.equal((await put({})).status, 200);
  assert.equal((await (await j('/api/map')).json()).view.showNumbers, false);
});

test('naam van de site is instelbaar en komt in site, manifest en backups', async () => {
  const put = (body) => j('/api/admin/settings', { method: 'PUT', headers: jsonH(cookie), body: JSON.stringify(body) });
  assert.equal((await put({ siteTitle: '  Wijk Sint Maarten ' })).status, 200);
  const map = await (await j('/api/map')).json();
  assert.equal(map.title, 'Wijk Sint Maarten');
  assert.equal(map.siteTitle, 'Wijk Sint Maarten');
  assert.equal((await (await j('/manifest.webmanifest')).json()).name, 'Wijk Sint Maarten');
  assert.equal((await put({ siteTitle: 'x'.repeat(61) })).status, 400);
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(backups.read(backups.list()[0].id).texts.siteTitle, 'Wijk Sint Maarten');
  assert.equal((await put({ siteTitle: '' })).status, 200);
  assert.equal((await (await j('/api/map')).json()).title, 'Onze wijk'); // terug naar SITE_TITLE
});

// ---------- bewoners en pushmeldingen ----------
const push = require('../server/push');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const ptsR = [[52, 5], [52.001, 5], [52.001, 5.001]];
const res = (path, opts = {}) => j(`/api/resident${path}`, { ...opts, headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) } });
const post = (path, body, cookieHeader) => res(path, { method: 'POST', body: JSON.stringify(body || {}), headers: cookieHeader ? { cookie: cookieHeader } : {} });
const adminReq = (path, method = 'GET', body) => j(`/api/admin${path}`, { method, headers: jsonH(cookie), body: body ? JSON.stringify(body) : undefined });

test('bewoners: 1 huis per apparaat, wijziging pas zichtbaar na goedkeuring', async () => {
  process.env.PUSH_DELAY_MS = '10';
  const sent = [];
  push._setSender({ sendNotification: async (sub, payload) => { sent.push({ sub, payload: JSON.parse(payload) }); } });
  await adminReq('/settings', 'PUT', { residentsEnabled: true });
  await adminReq('/houses', 'PUT', { houses: [
    { id: 'h1', street: 'Dorpsstraat', number: '1', status: 'none', points: ptsR },
    { id: 'h2', street: 'Dorpsstraat', number: '2', status: 'red', points: ptsR },
  ] });
  await adminReq('/push/subscribe', 'POST', { label: 'Telefoon', subscription: { endpoint: 'https://push.example/abc', keys: { p256dh: 'p'.repeat(20), auth: 'a'.repeat(10) } } });

  // zonder koppeling kan niets
  assert.equal((await res('/me')).status, 200);
  assert.equal((await (await res('/me')).json()).claim, null);
  assert.equal((await post('/set', { status: 'green' })).status, 401);

  // koppelen: cookie is HttpOnly, 1 jaar, alleen voor één huis
  const claim = await post('/claim', { houseId: 'h1' });
  assert.equal(claim.status, 200);
  const setC = claim.headers.get('set-cookie');
  assert.match(setC, /sm_resident=[\w-]{40,}/);
  assert.match(setC, /HttpOnly/);
  assert.match(setC, /Max-Age=31536000/);
  const c1 = setC.split(';')[0];
  assert.equal((await post('/claim', { houseId: 'h2' }, c1)).status, 409);
  assert.equal((await post('/claim', { houseId: 'nope' })).status, 404);

  // wijzigen: nog niet zichtbaar voor anderen
  const s1 = await (await post('/set', { status: 'green' }, c1)).json();
  assert.deepEqual([s1.effective, s1.approved, s1.pending], ['green', 'none', true]);
  assert.equal((await (await j('/api/map')).json()).houses.find((h) => h.id === 'h1').status, 'none');
  assert.equal((await post('/set', { status: 'blauw' }, c1)).status, 400);
  const ch = await (await adminReq('/changes')).json();
  assert.equal(ch.pending.length, 1);
  assert.deepEqual([ch.pending[0].title, ch.pending[0].from, ch.pending[0].to], ['Dorpsstraat 1', 'none', 'green']);
  assert.equal((await (await adminReq('/changes/count')).json()).pending, 1);

  // pushmelding naar de beheerder (samengevoegd)
  await wait(80);
  assert.equal(sent.length, 1);
  assert.match(sent[0].payload.body, /Dorpsstraat 1: groen aangevraagd/);
  assert.equal(sent[0].payload.url, '/beheer#changes');

  // terug naar de goedgekeurde status haalt het voorstel weg
  assert.equal((await (await post('/set', { status: 'none' }, c1)).json()).pending, false);
  assert.equal((await (await adminReq('/changes/count')).json()).pending, 0);

  // opnieuw voorstellen en goedkeuren
  await post('/set', { status: 'red' }, c1);
  const pend = (await (await adminReq('/changes')).json()).pending[0];
  const ap = await (await adminReq(`/changes/${pend.id}/approve`, 'POST')).json();
  assert.deepEqual(ap.change, { houseId: 'h1', status: 'red' });
  assert.equal((await (await j('/api/map')).json()).houses.find((h) => h.id === 'h1').status, 'red');
  const me = await (await res('/me', { headers: { cookie: c1 } })).json();
  assert.deepEqual([me.approved, me.effective, me.pending, me.notice.decision], ['red', 'red', false, 'approved']);
  assert.equal((await post('/ack', {}, c1)).status, 200);
  assert.equal((await (await res('/me', { headers: { cookie: c1 } })).json()).notice, null);

  // afwijzen
  await post('/set', { status: 'green' }, c1);
  const p2 = (await (await adminReq('/changes')).json()).pending[0];
  await adminReq(`/changes/${p2.id}/reject`, 'POST');
  const me2 = await (await res('/me', { headers: { cookie: c1 } })).json();
  assert.deepEqual([me2.effective, me2.notice.decision], ['red', 'rejected']);
  assert.equal((await adminReq(`/changes/${p2.id}/approve`, 'POST')).status, 404);

  // een tweede apparaat heeft een eigen koppeling; alles goedkeuren
  const c2 = (await post('/claim', { houseId: 'h2' })).headers.get('set-cookie').split(';')[0];
  await post('/set', { status: 'green' }, c2);
  await post('/set', { status: 'green' }, c1);
  const all = await (await adminReq('/changes/approve-all', 'POST')).json();
  assert.equal(all.changes.length, 2);
  const houses = (await (await j('/api/map')).json()).houses;
  assert.deepEqual(houses.map((h) => h.status), ['green', 'green']);

  // koppelingen beheren en opruimen bij verwijderde huizen
  const rs = (await (await adminReq('/changes')).json()).residents;
  assert.equal(rs.length, 2);
  await adminReq(`/residents/${rs[1].rid}`, 'DELETE');
  assert.equal((await (await res('/me', { headers: { cookie: c2 } })).json()).claim, null);
  await adminReq('/houses', 'PUT', { houses: [{ id: 'h2', street: 'Dorpsstraat', number: '2', status: 'green', points: ptsR }] });
  assert.equal((await (await res('/me', { headers: { cookie: c1 } })).json()).claim, null);
});

test('bewoners: uitschakelen, beheerrechten en push-registratie', async () => {
  for (const [m, p] of [['GET', '/changes'], ['POST', '/changes/approve-all'], ['DELETE', '/residents/x'], ['GET', '/push/key'], ['POST', '/push/test']]) {
    assert.equal((await j(`/api/admin${p}`, { method: m, headers: jsonH() })).status, 401, p);
  }
  const key = await (await adminReq('/push/key')).json();
  assert.ok(key.publicKey.length > 60);
  assert.equal((await adminReq('/push/subscribe', 'POST', { subscription: { endpoint: 'http://onveilig', keys: {} } })).status, 400);
  // verlopen registraties (410) worden opgeruimd
  push._setSender({ sendNotification: async () => { throw Object.assign(new Error('gone'), { statusCode: 410 }); } });
  const r = await (await adminReq('/push/test', 'POST')).json();
  assert.equal(r.removed >= 1, true);
  assert.equal((await (await adminReq('/push/devices')).json()).length, 0);

  await adminReq('/settings', 'PUT', { residentsEnabled: false });
  assert.equal((await res('/me')).status, 403);
  assert.equal((await post('/claim', { houseId: 'h2' })).status, 403);
  assert.equal((await (await j('/api/map')).json()).residentsEnabled, false);
  await adminReq('/settings', 'PUT', { residentsEnabled: true });
});
