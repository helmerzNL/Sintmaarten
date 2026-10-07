'use strict';
const crypto = require('node:crypto');

const STATUSES = ['green', 'red', 'none'];
const clean = (s, n) => String(s ?? '').trim().slice(0, n);

// Eén huis in de vorm {id, street, number, note, status, points}.
// Oudere gegevens hadden één veld "label" (meestal het huisnummer): dat wordt het huisnummer.
function normalizeHouse(h) {
  const number = 'number' in h ? clean(h.number, 20) : clean(h.label, 20);
  return {
    id: typeof h.id === 'string' && /^[\w-]{1,40}$/.test(h.id) ? h.id : crypto.randomBytes(6).toString('hex'),
    street: clean(h.street, 100),
    number,
    note: clean(h.note, 500),
    status: STATUSES.includes(h.status) ? h.status : 'none',
    points: h.points,
  };
}

module.exports = { normalizeHouse, STATUSES };
