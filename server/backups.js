'use strict';
// Backups van layout (huizen + kaartweergave) en teksten (uitleg, appnaam). Eén JSON-bestand per backup.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const config = require('./config');
const store = require('./store');
const { normalizeHouse } = require('./houses');

const dir = path.join(config.dataDir, 'backups');
fs.mkdirSync(dir, { recursive: true });
const MAX_BACKUPS = Number(process.env.MAX_BACKUPS) || 200;

const ID = /^\d{13}-[0-9a-f]{6}$/;
const file = (id) => path.join(dir, `${id}.json`);

// De inhoud die we veiligstellen.
function snapshotData() {
  const { houses, view, settings } = store.db();
  return {
    houses: JSON.parse(JSON.stringify(houses)),
    view: view ? { ...view } : null,
    texts: { siteTitle: settings?.siteTitle || '', intro: settings?.intro || '', appName: settings?.appName || '', appShortName: settings?.appShortName || '' },
  };
}

const digest = (data) => crypto.createHash('sha256').update(JSON.stringify(data)).digest('hex');

function ids() {
  return fs.readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)).filter((i) => ID.test(i)).sort();
}

function read(id) {
  if (!ID.test(id) || !fs.existsSync(file(id))) return null;
  return JSON.parse(fs.readFileSync(file(id), 'utf8'));
}

// Maakt een backup van de huidige staat. Slaat over als er niets veranderd is t.o.v. de nieuwste backup.
function create(reason, ok = true) {
  const data = snapshotData();
  const hash = digest(data);
  const all = ids();
  const last = all.length ? read(all[all.length - 1]) : null;
  if (last && last.hash === hash) return null;
  const id = `${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
  const tmp = `${file(id)}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ id, createdAt: new Date().toISOString(), reason, ok, hash, ...data }, null, 2));
  fs.renameSync(tmp, file(id));
  for (const old of all.slice(0, Math.max(0, all.length + 1 - MAX_BACKUPS))) fs.rmSync(file(old), { force: true });
  return id;
}

function list() {
  return ids().reverse().map((id) => {
    const b = read(id);
    return { id, createdAt: b.createdAt, reason: b.reason, ok: b.ok !== false, houses: b.houses.length, hasView: !!b.view, textLength: b.texts.intro.length };
  });
}

function remove(list) {
  let n = 0;
  for (const id of list) if (ID.test(id) && fs.existsSync(file(id))) { fs.rmSync(file(id)); n++; }
  return n;
}

// Zet een backup terug in de database (maakt eerst zelf een backup van de huidige staat).
function restore(id) {
  const b = read(id);
  if (!b) return false;
  create('Voor terugzetten');
  const db = store.db();
  db.houses = b.houses.map(normalizeHouse); // ook oude backups met "label" werken
  db.view = b.view;
  db.settings.intro = b.texts.intro;
  if ('siteTitle' in b.texts) db.settings.siteTitle = b.texts.siteTitle; // oudere backups kennen dit veld nog niet
  db.settings.appName = b.texts.appName;
  db.settings.appShortName = b.texts.appShortName;
  store.save();
  create('Teruggezet');
  return true;
}

// Express-middleware: maak na elke opslagpoging (ook een mislukte) een backup.
const afterSave = (reason) => (req, res, next) => {
  res.on('finish', () => {
    try { create(reason, res.statusCode < 400); } catch (err) { console.error('Backup mislukt:', err.message); }
  });
  next();
};

module.exports = { create, list, read, remove, restore, afterSave, ID };
