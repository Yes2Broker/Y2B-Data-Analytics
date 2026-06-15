/* ================================================================
   YES2BROKER — api/login.js
   Verifies APP_PASSWORD and issues a signed HttpOnly session cookie.
   ================================================================ */

const { makeSessionCookie, timingSafeStrEqual } = require('./_auth');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { password } = req.body || {};
  const expected = process.env.APP_PASSWORD;
  const secret   = process.env.SESSION_SECRET;

  if (!expected || !secret) {
    return res.status(500).json({ error: 'Server auth not configured (APP_PASSWORD / SESSION_SECRET missing).' });
  }
  if (!password || !timingSafeStrEqual(password, expected)) {
    return res.status(401).json({ ok: false });
  }

  res.setHeader('Set-Cookie', makeSessionCookie(secret));
  return res.status(200).json({ ok: true });
};
