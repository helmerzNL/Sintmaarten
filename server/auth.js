'use strict';
const crypto = require('node:crypto');
const config = require('./config');

const COOKIE = 'sm_session';

const sign = (payload) =>
  crypto.createHmac('sha256', config.sessionSecret).update(payload).digest('base64url');

function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function isLoggedIn(req) {
  const token = parseCookies(req.headers.cookie)[COOKIE];
  if (!token) return false;
  const [exp, sig] = token.split('.');
  if (!exp || !sig || !safeEqual(sig, sign(exp))) return false;
  return Number(exp) > Date.now();
}

function startSession(res) {
  const exp = String(Date.now() + config.sessionHours * 3600 * 1000);
  const flags = ['Path=/', 'HttpOnly', 'SameSite=Strict', `Max-Age=${config.sessionHours * 3600}`];
  if (config.secureCookie) flags.push('Secure');
  res.append('Set-Cookie', `${COOKIE}=${exp}.${sign(exp)}; ${flags.join('; ')}`);
}

function endSession(res) {
  res.append('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`);
}

function requireAdmin(req, res, next) {
  if (!isLoggedIn(req)) return res.status(401).json({ error: 'Niet ingelogd' });
  next();
}

// Mutaties moeten van onze eigen origin komen (extra CSRF-bescherming bovenop SameSite=Strict).
function sameOrigin(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const o = req.headers.origin;
  if (o && o !== config.origin) return res.status(403).json({ error: 'Ongeldige origin' });
  next();
}

// Eenvoudige in-memory limiter voor mislukte pogingen per IP.
const fails = new Map();
const WINDOW = 15 * 60 * 1000;
const MAX_FAILS = 10;
const limiter = {
  blocked(ip) {
    const f = (fails.get(ip) || []).filter((t) => Date.now() - t < WINDOW);
    fails.set(ip, f);
    return f.length >= MAX_FAILS;
  },
  fail(ip) { fails.set(ip, [...(fails.get(ip) || []), Date.now()]); },
  reset(ip) { fails.delete(ip); },
};

module.exports = { isLoggedIn, startSession, endSession, requireAdmin, sameOrigin, safeEqual, limiter };
