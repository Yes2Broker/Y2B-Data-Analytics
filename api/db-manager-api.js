/* ================================================================
   YES2BROKER — /api/db-manager.js
   Vercel Serverless Function
   Handles: verify-password, truncate, insert (bulk CSV data)
   Auth: DB_ADMIN_PASSWORD env variable
   Supabase: SUPABASE_URL + SUPABASE_SERVICE_KEY env variables
   ================================================================ */

const ALLOWED_TABLES = ['master_data', 'convertion', 'site_visit'];

// Column definitions per table — used for server-side validation
const TABLE_COLUMNS = {
  master_data: [
    'FirstName','LastName','Country ISD Code','Mobile No.','Email Id',
    'Project Name','Property For','Property','Property Type','AreaUnit',
    'CarpetArea','Min Budget','Max Budget','Property Location','Status Name',
    'Source Name','Channel Partner Name','Channel Company Name','Owner Name',
    'Created Date','Next Reminder Date','Latest Site Visit Done Date',
    'Total Visited Projects Name','Site Visit Done Count','IsSiteVisitDone',
    'Latest 1st Call Details','Latest 1st Call Date','Latest 2nd Call Details',
    'Latest 2nd Call Date','Latest 3rd Call Details','Latest 3rd Call Date',
    'Make Call Count'
  ],
  convertion: [
    'Created Date','CustomerName','Mobile No.','Status Name','Converted Date',
    'Converted Month','Source Name','Owner Name','Latest Site Visit Done Date',
    'Latest Site Visit Done Month','Total Visited Projects Name',
    'Site Visit Done Count','IsSiteVisitDone','Latest 1st Call Details',
    'Latest 1st Call Date','Latest 2nd Call Details','Latest 2nd Call Date',
    'Latest 3rd Call Details','Latest 3rd Call Date','Make Call Count'
  ],
  site_visit: [
    'Date','Visit Done By','CustomerName','Mobile No.','Location','Visited Project'
  ]
};

// Required columns per table (must be non-empty)
const REQUIRED_COLUMNS = {
  master_data: ['Mobile No.', 'Owner Name', 'Status Name', 'Created Date'],
  convertion:  ['CustomerName', 'Mobile No.', 'Owner Name', 'Converted Date'],
  site_visit:  ['Date', 'Visit Done By', 'CustomerName', 'Mobile No.']
};

// Batch size for Supabase inserts (avoid hitting request size limits)
const BATCH_SIZE = 500;

export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { action, password, table, rows } = req.body || {};

  // ── Password verification ─────────────────────────────────────
  if (action === 'verify-password') {
    const correct = password === process.env.DB_ADMIN_PASSWORD;
    return res.status(200).json({ ok: correct });
  }

  // ── All other actions require valid password ──────────────────
  if (!password || password !== process.env.DB_ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Unauthorised' });
  }

  // ── Validate table name (whitelist only) ──────────────────────
  if (!table || !ALLOWED_TABLES.includes(table)) {
    return res.status(400).json({ error: `Table "${table}" is not allowed.` });
  }

  const SUPA_URL = process.env.SUPABASE_URL;
  const SUPA_KEY = process.env.SUPABASE_SERVICE_KEY; // service_role key — never expose to browser

  if (!SUPA_URL || !SUPA_KEY) {
    return res.status(500).json({ error: 'Supabase env variables not configured.' });
  }

  const headers = {
    'apikey': SUPA_KEY,
    'Authorization': `Bearer ${SUPA_KEY}`,
    'Content-Type': 'application/json',
    'Prefer': 'return=minimal'
  };

  // ── GET ROW COUNT ─────────────────────────────────────────────
  if (action === 'count') {
    const r = await fetch(`${SUPA_URL}/rest/v1/${table}?select=id`, {
      headers: { ...headers, 'Prefer': 'count=exact', 'Range': '0-0' }
    });
    const count = parseInt(r.headers.get('content-range')?.split('/')[1] ?? '0', 10);
    return res.status(200).json({ ok: true, count });
  }

  // ── TRUNCATE ──────────────────────────────────────────────────
  if (action === 'truncate') {
    const r = await fetch(`${SUPA_URL}/rest/v1/${table}?id=gte.0`, {
      method: 'DELETE',
      headers
    });
    if (!r.ok) {
      const body = await r.text();
      return res.status(500).json({ error: `Truncate failed: ${body}` });
    }
    return res.status(200).json({ ok: true, message: `Table "${table}" cleared.` });
  }

  // ── INSERT (bulk) ─────────────────────────────────────────────
  if (action === 'insert') {
    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({ error: 'No rows provided.' });
    }

    const allowedCols  = TABLE_COLUMNS[table];
    const requiredCols = REQUIRED_COLUMNS[table];

    // Validate columns in first row
    const incomingCols = Object.keys(rows[0]);
    const unknownCols  = incomingCols.filter(c => !allowedCols.includes(c));
    if (unknownCols.length > 0) {
      return res.status(400).json({
        error: `Unknown columns for table "${table}": ${unknownCols.join(', ')}. Check your CSV headers.`
      });
    }

    // Validate required fields row-by-row
    const errors = [];
    rows.forEach((row, i) => {
      requiredCols.forEach(col => {
        if (!row[col] || String(row[col]).trim() === '') {
          errors.push(`Row ${i + 2}: "${col}" is required but empty.`);
        }
      });
    });
    if (errors.length > 0) {
      return res.status(400).json({
        error: `Validation failed (${errors.length} issue${errors.length > 1 ? 's' : ''})`,
        details: errors.slice(0, 20) // cap at 20 to avoid huge payloads
      });
    }

    // Strip any unknown keys from each row (safety)
    const cleanRows = rows.map(row => {
      const clean = {};
      allowedCols.forEach(col => { if (col in row) clean[col] = row[col] || null; });
      return clean;
    });

    // Insert in batches
    let inserted = 0;
    for (let i = 0; i < cleanRows.length; i += BATCH_SIZE) {
      const batch = cleanRows.slice(i, i + BATCH_SIZE);
      const r = await fetch(`${SUPA_URL}/rest/v1/${table}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(batch)
      });
      if (!r.ok) {
        const body = await r.text();
        return res.status(500).json({
          error: `Insert failed at batch ${Math.floor(i / BATCH_SIZE) + 1}: ${body}`
        });
      }
      inserted += batch.length;
    }

    return res.status(200).json({ ok: true, inserted });
  }

  return res.status(400).json({ error: `Unknown action: ${action}` });
}
