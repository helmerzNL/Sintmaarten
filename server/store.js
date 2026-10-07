'use strict';
const fs = require('node:fs');
const path = require('node:path');
const config = require('./config');

const dbFile = path.join(config.dataDir, 'db.json');
fs.mkdirSync(config.dataDir, { recursive: true });

const empty = () => ({ userId: null, passkeys: [], view: null, houses: [], version: 2 });
let db = empty();
if (fs.existsSync(dbFile)) {
  db = { ...empty(), ...JSON.parse(fs.readFileSync(dbFile, 'utf8')) };
  if (db.version !== 2) {
    // Oude versie met geüploade afbeelding: huizen waren relatief aan het plaatje en zijn niet bruikbaar op de kaart.
    db.houses = [];
    delete db.map;
    db.version = 2;
  }
}

function save() {
  const tmp = `${dbFile}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, dbFile);
}

module.exports = { db: () => db, save };
