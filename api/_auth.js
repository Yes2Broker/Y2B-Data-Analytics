/* ================================================================
   YES2BROKER — api/_auth.js
   Shared session-cookie auth (HMAC-signed, HttpOnly). Files prefixed
   with "_" are NOT exposed as routes by Vercel.
   ================================================================ */

const crypto = require('crypto');

const COOKIE  = 'y2b_session';
const MAX_AGE = 60 * 60 * 12; // 12 hours (seconds)

function b64url(buf) {
  return Buffer.from(buf).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlDecode(str) {
  return Buffer.from(str.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString();
}

// token = base64url(payload).base64url(HMAC-SHA256(payload))
function sign(payloadObj, secret) {
  const payload = b64url(JSON.stringify(payloadObj));
  const sig = b64url(crypto.createHmac('sha256', secret).update(payload).digest());
  return `${payload}.${sig}`;
}

function verify(token, secret) {
  if (!token || token.indexOf('.') === -1) return null;
  const [payload, sig] = token.split('.');
  const expected = b64url(crypto.createHmac('sha256', secret).update(payload).digest());
  const a = Buffer.from(sig), b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let data;
  try { data = JSON.parse(b64urlDecode(payload)); } catch { return null; }
  if (!data.exp || Date.now() > data.exp) return null;
  return data;
}

function parseCookies(req) {
  const out = {};
  (req.headers.cookie || '').split(';').forEach(p => {
    const i = p.indexOf('=');
    if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}

function makeSessionCookie(secret) {
  const token = sign({ exp: Date.now() + MAX_AGE * 1000 }, secret);
  return `${COOKIE}=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${MAX_AGE}`;
}

function clearCookie() {
  return `${COOKIE}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`;
}

function isAuthed(req) {
  const secret = process.env.SESSION_SECRET;
  if (!secret) return false;
  return !!verify(parseCookies(req)[COOKIE], secret);
}

// Constant-time string compare (avoids password timing leaks)
function timingSafeStrEqual(a, b) {
  const ab = Buffer.from(String(a)), bb = Buffer.from(String(b));
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

module.exports = {
  COOKIE, sign, verify, parseCookies,
  makeSessionCookie, clearCookie, isAuthed, timingSafeStrEqual,
};
