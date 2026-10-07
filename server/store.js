'use strict';
const fs = require('node:fs');
const path = require('node:path');
const config = require('./config');

const dbFile = path.join(config.dataDir, 'db.json');
const uploadDir = path.join(config.dataDir, 'uploads');
fs.mkdirSync(uploadDir, { recursive: true });

const empty = () => ({ userId: null, passkeys: [], map: null, houses: [] });
let db = empty();
if (fs.existsSync(dbFile)) {
  db = { ...empty(), ...JSON.parse(fs.readFileSync(dbFile, 'utf8')) };
}

function save() {
  const tmp = `${dbFile}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, dbFile);
}

module.exports = { db: () => db, save, uploadDir };
