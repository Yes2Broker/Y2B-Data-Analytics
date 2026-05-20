/* ================================================================
   YES2BROKER — db-manager.js
   Drop this file next to app.js and add:
     <script src="db-manager.js"></script>
   at the bottom of index.html (after app.js)

   Also add to index.html sidebar nav (after All Leads nav-item):
     <span class="nav-label" style="margin-top:8px">Admin</span>
     <a class="nav-item" data-section="database">
       <i data-lucide="database" class="nav-icon"></i>Database
     </a>

   And add this section inside <div class="dashboard">:
     <section class="section" id="section-database"></section>
   ================================================================ */

// ── CONFIG ────────────────────────────────────────────────────
const DB_API = '/api/db-manager';

const DB_TABLES = {
  master_data: {
    label: 'Master Data (Leads)',
    icon: 'users',
    color: 'blue',
    columns: [
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
    required: ['Mobile No.', 'Owner Name', 'Status Name', 'Created Date'],
    sampleRow: {
      'FirstName': 'Rahul', 'LastName': 'Sharma', 'Country ISD Code': '+91',
      'Mobile No.': '9876543210', 'Email Id': 'rahul@example.com',
      'Project Name': 'Amrut Orchid', 'Property For': 'Buy', 'Property': 'Flat',
      'Property Type': '2BHK', 'AreaUnit': 'sq.ft', 'CarpetArea': '950',
      'Min Budget': '5000000', 'Max Budget': '7000000', 'Property Location': 'Ahmedabad',
      'Status Name': 'New', 'Source Name': 'Facebook/Digital Marketing',
      'Channel Partner Name': '', 'Channel Company Name': '', 'Owner Name': 'Richa',
      'Created Date': '01/05/2026', 'Next Reminder Date': '05/05/2026',
      'Latest Site Visit Done Date': '', 'Total Visited Projects Name': '',
      'Site Visit Done Count': '0', 'IsSiteVisitDone': 'No',
      'Latest 1st Call Details': '', 'Latest 1st Call Date': '',
      'Latest 2nd Call Details': '', 'Latest 2nd Call Date': '',
      'Latest 3rd Call Details': '', 'Latest 3rd Call Date': '', 'Make Call Count': '0'
    }
  },
  convertion: {
    label: 'Conversions',
    icon: 'check-circle-2',
    color: 'green',
    columns: [
      'Created Date','CustomerName','Mobile No.','Status Name','Converted Date',
      'Converted Month','Source Name','Owner Name','Latest Site Visit Done Date',
      'Latest Site Visit Done Month','Total Visited Projects Name',
      'Site Visit Done Count','IsSiteVisitDone','Latest 1st Call Details',
      'Latest 1st Call Date','Latest 2nd Call Details','Latest 2nd Call Date',
      'Latest 3rd Call Details','Latest 3rd Call Date','Make Call Count'
    ],
    required: ['CustomerName', 'Mobile No.', 'Owner Name', 'Converted Date'],
    sampleRow: {
      'Created Date': '01/04/2026', 'CustomerName': 'Priya Patel',
      'Mobile No.': '9876543211', 'Status Name': 'Converted',
      'Converted Date': '15/04/2026', 'Converted Month': 'April 2026',
      'Source Name': 'Housing', 'Owner Name': 'Sachin',
      'Latest Site Visit Done Date': '10/04/2026', 'Latest Site Visit Done Month': 'April 2026',
      'Total Visited Projects Name': 'Shikhar Kiaan', 'Site Visit Done Count': '2',
      'IsSiteVisitDone': 'Yes', 'Latest 1st Call Details': 'Interested',
      'Latest 1st Call Date': '02/04/2026', 'Latest 2nd Call Details': 'Site visit confirmed',
      'Latest 2nd Call Date': '08/04/2026', 'Latest 3rd Call Details': 'Deal closed',
      'Latest 3rd Call Date': '15/04/2026', 'Make Call Count': '3'
    }
  },
  site_visit: {
    label: 'Site Visits',
    icon: 'map-pin',
    color: 'amber',
    columns: ['Date','Visit Done By','CustomerName','Mobile No.','Location','Visited Project'],
    required: ['Date', 'Visit Done By', 'CustomerName', 'Mobile No.'],
    sampleRow: {
      'Date': '10/05/2026', 'Visit Done By': 'Pavan', 'CustomerName': 'Mukesh Mehta',
      'Mobile No.': '9773188068', 'Location': 'Ahmedabad', 'Visited Project': 'Amrut Orchid'
    }
  }
};

// ── SESSION STATE ─────────────────────────────────────────────
let dbUnlocked = false;
let dbCurrentTable = null;

// ── INIT: inject HTML when section first shown ────────────────
function initDatabaseSection() {
  const sec = document.getElementById('section-database');
  if (!sec || sec.dataset.init) return;
  sec.dataset.init = '1';

  sec.innerHTML = `
    <!-- PASSWORD GATE -->
    <div id="dbGate" class="db-gate">
      <div class="db-gate-card">
        <div class="db-gate-icon"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg></div>
        <h2 class="db-gate-title">Admin Access Required</h2>
        <p class="db-gate-sub">This section is password protected. Enter the admin password to continue.</p>
        <div class="db-gate-field">
          <input type="password" id="dbPasswordInput" placeholder="Enter admin password"
            onkeydown="if(event.key==='Enter') dbVerifyPassword()"/>
          <p class="db-gate-error" id="dbGateError"></p>
        </div>
        <button class="db-gate-btn" id="dbGateBtn" onclick="dbVerifyPassword()">
          <span id="dbGateBtnText">Unlock</span>
        </button>
      </div>
    </div>

    <!-- MAIN PANEL (hidden until unlocked) -->
    <div id="dbPanel" style="display:none">
      <div class="sec-head" style="justify-content:space-between">
        <div style="display:flex;align-items:center;gap:10px">
          <h2 class="sec-title">Database Manager</h2>
          <span class="rec-badge" style="background:#fef3c7;color:#92400e">Admin Only</span>
        </div>
        <button class="db-lock-btn" onclick="dbLock()">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
          Lock Session
        </button>
      </div>

      <!-- TABLE CARDS -->
      <div class="db-table-cards" id="dbTableCards"></div>

      <!-- ACTIVE TABLE WORKSPACE -->
      <div class="db-workspace" id="dbWorkspace" style="display:none">
        <div class="db-ws-header">
          <div style="display:flex;align-items:center;gap:10px">
            <div class="db-ws-icon" id="dbWsIcon"></div>
            <div>
              <div class="db-ws-title" id="dbWsTitle"></div>
              <div class="db-ws-sub" id="dbWsSub"></div>
            </div>
          </div>
          <button class="db-ws-close" onclick="dbCloseWorkspace()">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>

        <!-- STEP 1: Actions -->
        <div class="db-steps">

          <!-- Truncate card -->
          <div class="db-action-card danger">
            <div class="db-ac-head">
              <div class="db-ac-icon red">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>
              </div>
              <div>
                <div class="db-ac-title">Clear Table</div>
                <div class="db-ac-sub">Permanently deletes all rows from this table</div>
              </div>
            </div>
            <button class="db-btn-danger" id="dbTruncateBtn" onclick="dbTruncate()">
              Delete All Data
            </button>
          </div>

          <!-- Upload card -->
          <div class="db-action-card">
            <div class="db-ac-head">
              <div class="db-ac-icon blue">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
              </div>
              <div>
                <div class="db-ac-title">Upload CSV</div>
                <div class="db-ac-sub">Insert new data from a CSV file</div>
              </div>
            </div>

            <!-- Sample download -->
            <button class="db-btn-sample" onclick="dbDownloadSample()">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              Download Sample CSV
            </button>

            <!-- Drop zone -->
            <div class="db-drop-zone" id="dbDropZone"
              onclick="document.getElementById('dbCsvInput').click()"
              ondragover="dbDragOver(event)" ondragleave="dbDragLeave(event)" ondrop="dbDrop(event)">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="color:var(--s300)"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
              <span id="dbDropLabel">Click to browse or drag &amp; drop CSV</span>
              <span style="font-size:11px;color:var(--s400)">.csv files only</span>
              <input type="file" id="dbCsvInput" accept=".csv" style="display:none" onchange="dbFileSelected(this)"/>
            </div>

            <!-- Preview -->
            <div id="dbPreview" style="display:none">
              <div class="db-preview-head">
                <div id="dbPreviewInfo"></div>
                <button class="db-btn-ghost" onclick="dbClearFile()">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                  Remove
                </button>
              </div>
              <div id="dbValidationErrors" style="display:none"></div>
              <div class="tbl-scroll" id="dbPreviewTable" style="max-height:220px;border:1px solid var(--s200);border-radius:var(--rs)"></div>
              <button class="db-btn-insert" id="dbInsertBtn" onclick="dbInsert()" style="margin-top:12px">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                Insert <span id="dbInsertCount"></span> Rows into Database
              </button>
            </div>
          </div>
        </div>

        <!-- Progress bar -->
        <div class="db-progress-wrap" id="dbProgressWrap" style="display:none">
          <div class="db-progress-label" id="dbProgressLabel">Inserting…</div>
          <div class="db-progress-bar"><div class="db-progress-fill" id="dbProgressFill"></div></div>
        </div>

      </div><!-- /workspace -->
    </div><!-- /panel -->
  `;

  // Render table cards
  renderDbTableCards();
}

// ── RENDER TABLE CARDS ────────────────────────────────────────
async function renderDbTableCards() {
  const wrap = document.getElementById('dbTableCards');
  if (!wrap) return;

  wrap.innerHTML = Object.entries(DB_TABLES).map(([key, t]) => `
    <div class="db-table-card db-color-${t.color}" onclick="dbOpenWorkspace('${key}')">
      <div class="db-tc-icon">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${lucidePathFor(t.icon)}</svg>
      </div>
      <div class="db-tc-body">
        <div class="db-tc-label">${t.label}</div>
        <div class="db-tc-key"><code>${key}</code></div>
        <div class="db-tc-cols">${t.columns.length} columns · ${t.required.length} required</div>
      </div>
      <div class="db-tc-count" id="dbCount_${key}">
        <span class="db-count-spinner"></span>
      </div>
      <div class="db-tc-arrow">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
      </div>
    </div>
  `).join('');

  // Load row counts async
  Object.keys(DB_TABLES).forEach(key => dbFetchCount(key));
}

async function dbFetchCount(table) {
  const el = document.getElementById(`dbCount_${table}`);
  if (!el) return;
  try {
    const r = await fetch(DB_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'count', password: dbGetPassword(), table })
    });
    const d = await r.json();
    el.innerHTML = d.ok
      ? `<span class="db-count-val">${d.count.toLocaleString()}</span><span class="db-count-lbl">rows</span>`
      : `<span class="db-count-err">—</span>`;
  } catch {
    el.innerHTML = `<span class="db-count-err">—</span>`;
  }
}

// ── PASSWORD HANDLING ─────────────────────────────────────────
let _dbPassword = '';
function dbGetPassword() { return _dbPassword; }

async function dbVerifyPassword() {
  const input = document.getElementById('dbPasswordInput');
  const btn   = document.getElementById('dbGateBtn');
  const err   = document.getElementById('dbGateError');
  const pw    = input.value.trim();

  if (!pw) { err.textContent = 'Please enter a password.'; return; }

  btn.disabled = true;
  document.getElementById('dbGateBtnText').textContent = 'Verifying…';
  err.textContent = '';

  try {
    const r = await fetch(DB_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'verify-password', password: pw })
    });
    const d = await r.json();

    if (d.ok) {
      _dbPassword = pw;
      dbUnlocked  = true;
      document.getElementById('dbGate').style.display  = 'none';
      document.getElementById('dbPanel').style.display = 'block';
    } else {
      err.textContent = 'Incorrect password. Try again.';
      input.value = '';
      input.focus();
    }
  } catch {
    err.textContent = 'Could not reach server. Check your connection.';
  }

  btn.disabled = false;
  document.getElementById('dbGateBtnText').textContent = 'Unlock';
}

function dbLock() {
  dbUnlocked  = false;
  _dbPassword = '';
  dbCloseWorkspace();
  document.getElementById('dbGate').style.display  = 'flex';
  document.getElementById('dbPanel').style.display = 'none';
  const inp = document.getElementById('dbPasswordInput');
  if (inp) { inp.value = ''; }
}

// ── WORKSPACE ─────────────────────────────────────────────────
function dbOpenWorkspace(table) {
  dbCurrentTable = table;
  const t = DB_TABLES[table];

  document.getElementById('dbWorkspace').style.display = 'block';
  document.getElementById('dbWsTitle').textContent     = t.label;
  document.getElementById('dbWsSub').textContent       = `${t.columns.length} columns · Required: ${t.required.join(', ')}`;

  const iconEl = document.getElementById('dbWsIcon');
  iconEl.className = `db-ws-icon db-icon-${t.color}`;
  iconEl.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${lucidePathFor(t.icon)}</svg>`;

  dbClearFile();
  document.getElementById('dbWorkspace').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function dbCloseWorkspace() {
  if (document.getElementById('dbWorkspace'))
    document.getElementById('dbWorkspace').style.display = 'none';
  dbCurrentTable = null;
  dbClearFile();
}

// ── TRUNCATE ──────────────────────────────────────────────────
async function dbTruncate() {
  if (!dbCurrentTable) return;
  const t = DB_TABLES[dbCurrentTable];

  const confirmed = confirm(
    `⚠️ DELETE ALL DATA\n\nYou are about to permanently delete every row from:\n"${t.label}" (${dbCurrentTable})\n\nThis CANNOT be undone.\n\nType OK to confirm.`
  );
  if (!confirmed) return;

  const btn = document.getElementById('dbTruncateBtn');
  btn.disabled = true;
  btn.textContent = 'Deleting…';

  try {
    const r = await fetch(DB_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'truncate', password: dbGetPassword(), table: dbCurrentTable })
    });
    const d = await r.json();

    if (d.ok) {
      dbShowToast(`✓ ${t.label} cleared successfully.`, 'success');
      dbFetchCount(dbCurrentTable);
    } else {
      dbShowToast(`Error: ${d.error}`, 'error');
    }
  } catch (e) {
    dbShowToast(`Network error: ${e.message}`, 'error');
  }

  btn.disabled = false;
  btn.textContent = 'Delete All Data';
}

// ── CSV PARSING ───────────────────────────────────────────────
let dbParsedRows = [];

function dbDragOver(e)  { e.preventDefault(); document.getElementById('dbDropZone').classList.add('drag-over'); }
function dbDragLeave(e) { document.getElementById('dbDropZone').classList.remove('drag-over'); }
function dbDrop(e) {
  e.preventDefault();
  document.getElementById('dbDropZone').classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file) dbParseCSV(file);
}
function dbFileSelected(input) {
  if (input.files[0]) dbParseCSV(input.files[0]);
}

function dbParseCSV(file) {
  if (!file.name.endsWith('.csv')) {
    dbShowToast('Only .csv files are accepted.', 'error');
    return;
  }
  const reader = new FileReader();
  reader.onload = e => {
    const text   = e.target.result;
    const lines  = text.split(/\r?\n/).filter(l => l.trim());
    if (lines.length < 2) {
      dbShowToast('CSV has no data rows.', 'error');
      return;
    }

    const headers = parseCSVLine(lines[0]);
    const rows    = [];

    for (let i = 1; i < lines.length; i++) {
      const vals = parseCSVLine(lines[i]);
      if (vals.every(v => !v.trim())) continue; // skip empty rows
      const row = {};
      headers.forEach((h, j) => { row[h.trim()] = (vals[j] || '').trim(); });
      rows.push(row);
    }

    dbParsedRows = rows;
    dbShowPreview(headers, rows);
  };
  reader.readAsText(file);
}

function parseCSVLine(line) {
  // Handles quoted fields with commas inside
  const result = [];
  let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { inQ = !inQ; continue; }
    if (ch === ',' && !inQ) { result.push(cur); cur = ''; continue; }
    cur += ch;
  }
  result.push(cur);
  return result;
}

function dbShowPreview(headers, rows) {
  if (!dbCurrentTable) return;
  const t = DB_TABLES[dbCurrentTable];

  // Validate
  const errors = [];
  const allowedCols = t.columns;
  const unknownCols = headers.filter(h => h && !allowedCols.includes(h));
  const missingReq  = t.required.filter(r => !headers.includes(r));

  if (unknownCols.length) errors.push(`Unknown columns: ${unknownCols.join(', ')}`);
  if (missingReq.length)  errors.push(`Missing required columns: ${missingReq.join(', ')}`);

  // Row-level required checks
  const rowErrors = [];
  rows.forEach((row, i) => {
    t.required.forEach(col => {
      if (!row[col] || row[col].trim() === '')
        rowErrors.push(`Row ${i + 2}: "${col}" is empty`);
    });
  });
  if (rowErrors.length) errors.push(...rowErrors.slice(0, 10));
  if (rowErrors.length > 10) errors.push(`… and ${rowErrors.length - 10} more row errors.`);

  const errWrap = document.getElementById('dbValidationErrors');
  if (errors.length) {
    errWrap.style.display = 'block';
    errWrap.innerHTML = `
      <div class="db-error-box">
        <div class="db-error-title">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          ${errors.length} validation issue${errors.length > 1 ? 's' : ''} found — fix before inserting
        </div>
        <ul>${errors.map(e => `<li>${e}</li>`).join('')}</ul>
      </div>`;
    document.getElementById('dbInsertBtn').disabled = true;
    document.getElementById('dbInsertBtn').style.opacity = '.4';
  } else {
    errWrap.style.display = 'none';
    document.getElementById('dbInsertBtn').disabled = false;
    document.getElementById('dbInsertBtn').style.opacity = '1';
  }

  // Preview table (first 5 rows)
  const previewRows = rows.slice(0, 5);
  const tbl = `
    <table style="min-width:100%;font-size:11.5px">
      <thead><tr>${headers.map(h => `<th style="padding:7px 10px;background:var(--blue-900);color:#fff;white-space:nowrap;font-size:10.5px">${h}</th>`).join('')}</tr></thead>
      <tbody>${previewRows.map(row =>
        `<tr>${headers.map(h => `<td style="padding:6px 10px;border-bottom:1px solid var(--s100);white-space:nowrap;color:var(--s700)">${row[h] || ''}</td>`).join('')}</tr>`
      ).join('')}</tbody>
    </table>`;

  document.getElementById('dbPreviewTable').innerHTML = tbl;
  document.getElementById('dbPreviewInfo').innerHTML =
    `<strong>${rows.length.toLocaleString()} rows</strong> · ${headers.length} columns · showing first 5`;
  document.getElementById('dbInsertCount').textContent = rows.length.toLocaleString();
  document.getElementById('dbDropZone').style.display  = 'none';
  document.getElementById('dbPreview').style.display   = 'block';
}

function dbClearFile() {
  dbParsedRows = [];
  const dz = document.getElementById('dbDropZone');
  const pv = document.getElementById('dbPreview');
  const ci = document.getElementById('dbCsvInput');
  if (dz) dz.style.display = 'flex';
  if (pv) pv.style.display = 'none';
  if (ci) ci.value = '';
}

// ── INSERT ────────────────────────────────────────────────────
async function dbInsert() {
  if (!dbCurrentTable || !dbParsedRows.length) return;

  const btn = document.getElementById('dbInsertBtn');
  btn.disabled = true;

  const progressWrap = document.getElementById('dbProgressWrap');
  const progressFill = document.getElementById('dbProgressFill');
  const progressLabel = document.getElementById('dbProgressLabel');
  progressWrap.style.display = 'block';

  const BATCH = 500;
  const total = dbParsedRows.length;
  let inserted = 0;

  try {
    for (let i = 0; i < total; i += BATCH) {
      const batch = dbParsedRows.slice(i, i + BATCH);
      const pct   = Math.round((i / total) * 100);

      progressFill.style.width  = pct + '%';
      progressLabel.textContent = `Inserting… ${i.toLocaleString()} / ${total.toLocaleString()} rows`;

      const r = await fetch(DB_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'insert',
          password: dbGetPassword(),
          table: dbCurrentTable,
          rows: batch
        })
      });
      const d = await r.json();

      if (!d.ok) {
        const errMsg = d.details
          ? `${d.error}\n\n${d.details.join('\n')}`
          : d.error;
        dbShowToast(`Insert failed: ${d.error}`, 'error');

        // Show detailed errors in UI
        const errWrap = document.getElementById('dbValidationErrors');
        errWrap.style.display = 'block';
        errWrap.innerHTML = `
          <div class="db-error-box">
            <div class="db-error-title">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
              Server rejected the upload
            </div>
            <ul>${(d.details || [d.error]).map(e => `<li>${e}</li>`).join('')}</ul>
          </div>`;
        progressWrap.style.display = 'none';
        btn.disabled = false;
        return;
      }

      inserted += batch.length;
    }

    progressFill.style.width  = '100%';
    progressLabel.textContent = `Done! ${inserted.toLocaleString()} rows inserted.`;

    setTimeout(() => { progressWrap.style.display = 'none'; }, 2500);
    dbShowToast(`✓ ${inserted.toLocaleString()} rows inserted into ${DB_TABLES[dbCurrentTable].label}`, 'success');
    dbFetchCount(dbCurrentTable);
    dbClearFile();

  } catch (e) {
    dbShowToast(`Network error: ${e.message}`, 'error');
    progressWrap.style.display = 'none';
  }

  btn.disabled = false;
}

// ── SAMPLE CSV DOWNLOAD ───────────────────────────────────────
function dbDownloadSample() {
  if (!dbCurrentTable) return;
  const t = DB_TABLES[dbCurrentTable];

  const header = t.columns.join(',');
  const sample = t.columns.map(col => {
    const val = t.sampleRow[col] || '';
    return val.includes(',') ? `"${val}"` : val;
  }).join(',');

  const csv  = `${header}\n${sample}\n`;
  const blob = new Blob([csv], { type: 'text/csv' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `sample_${dbCurrentTable}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ── TOAST (reuses app.js toast if available) ──────────────────
function dbShowToast(msg, type = 'success') {
  if (typeof showToast === 'function') { showToast(msg, type); return; }
  // fallback
  const t = document.createElement('div');
  t.className = `toast toast-${type} show`;
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3500);
}

// ── LUCIDE PATH HELPERS ───────────────────────────────────────
function lucidePathFor(icon) {
  const paths = {
    'users':         '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
    'check-circle-2':'<path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z"/><path d="m9 12 2 2 4-4"/>',
    'map-pin':       '<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/>',
    'database':      '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14c0 1.657 4.03 3 9 3s9-1.343 9-3V5"/><path d="M3 12c0 1.657 4.03 3 9 3s9-1.343 9-3"/>',
  };
  return paths[icon] || paths['database'];
}

// ── HOOK INTO EXISTING NAV ────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  // Intercept nav clicks for 'database' section
  document.querySelectorAll('.nav-item[data-section="database"]').forEach(el => {
    el.addEventListener('click', () => {
      setTimeout(() => {
        initDatabaseSection();
        if (dbUnlocked) {
          document.getElementById('dbGate').style.display  = 'none';
          document.getElementById('dbPanel').style.display = 'block';
        }
      }, 50);
    });
  });
});
