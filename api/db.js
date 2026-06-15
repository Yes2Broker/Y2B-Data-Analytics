/* ================================================================
   YES2BROKER — api/db.js
   Authenticated Supabase proxy. The browser never sees a Supabase key;
   every request must carry a valid session cookie. Tables and methods
   are whitelisted so an authenticated client can't reach anything else.
   ================================================================ */

const { isAuthed } = require('./_auth');

// resource -> allowed HTTP methods
const ALLOWED = {
  master_data:      ['GET'],
  site_visit:       ['GET'],
  convertion:       ['GET'],
  companies:        ['GET', 'POST', 'PATCH', 'DELETE'],
  company_projects: ['GET', 'POST', 'DELETE'],
};

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // ── Gate: must be logged in ───────────────────────────────
  if (!isAuthed(req)) return res.status(401).json({ error: 'Unauthorised' });

  const { resource, method = 'GET', query = '', body = null } = req.body || {};

  if (!resource || !ALLOWED[resource]) {
    return res.status(400).json({ error: `Resource "${resource}" is not allowed.` });
  }
  const m = String(method).toUpperCase();
  if (!ALLOWED[resource].includes(m)) {
    return res.status(405).json({ error: `Method ${m} not allowed on ${resource}.` });
  }

  const SUPA_URL = process.env.SUPABASE_URL;
  const SUPA_KEY = process.env.SUPABASE_SERVICE_KEY; // server-only, never shipped to the client
  if (!SUPA_URL || !SUPA_KEY) {
    return res.status(500).json({ error: 'Supabase env variables not configured.' });
  }

  const headers = {
    apikey: SUPA_KEY,
    Authorization: `Bearer ${SUPA_KEY}`,
    'Content-Type': 'application/json',
  };
  if (m === 'POST')                    headers.Prefer = 'return=representation';
  if (m === 'PATCH' || m === 'DELETE') headers.Prefer = 'return=minimal';

  const url = `${SUPA_URL}/rest/v1/${resource}${query ? '?' + query : ''}`;

  try {
    const r = await fetch(url, {
      method: m,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await r.text();
    const cr = r.headers.get('content-range');
    if (cr) res.setHeader('content-range', cr);
    res.status(r.status);
    res.setHeader('Content-Type', 'application/json');
    return res.send(text || '[]');
  } catch (e) {
    return res.status(502).json({ error: 'Upstream error: ' + e.message });
  }
};
