'use strict';
const crypto = require('node:crypto');

const PARAMS = { N: 32768, r: 8, p: 1, maxmem: 128 * 1024 * 1024 };
const KEYLEN = 64;

const scrypt = (password, salt, params = PARAMS) =>
  new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, KEYLEN, params, (err, key) => (err ? reject(err) : resolve(key)));
  });

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt);
  return { salt: salt.toString('base64'), hash: key.toString('base64'), N: PARAMS.N, r: PARAMS.r, p: PARAMS.p };
}

async function verifyPassword(password, stored) {
  const salt = Buffer.from(stored.salt, 'base64');
  const expected = Buffer.from(stored.hash, 'base64');
  const key = await scrypt(password, salt, { ...PARAMS, N: stored.N, r: stored.r, p: stored.p });
  return key.length === expected.length && crypto.timingSafeEqual(key, expected);
}

module.exports = { hashPassword, verifyPassword };
