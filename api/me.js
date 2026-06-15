/* ================================================================
   YES2BROKER — api/me.js  — reports whether the caller has a valid session.
   ================================================================ */

const { isAuthed } = require('./_auth');

module.exports = async function handler(req, res) {
  return res.status(200).json({ ok: isAuthed(req) });
};
