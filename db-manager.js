/* ================================================================
   YES2BROKER — db-manager.js  v3
   Updated schemas: master_data, convertion, site_visit
   ================================================================ */

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
    required: ['FirstName','Mobile No.','Property For','Status Name','Source Name','Owner Name','Created Date'],
    sampleRow: {
      'FirstName': 'Rahul', 'LastName': 'Sharma', 'Country ISD Code': '91',
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
      'FirstName','LastName','Country ISD Code','Mobile No.','Email Id',
      'Project Name','Property For','Property','Property Type',
      'Property Location','Status Name','Converted Date','Source Name',
      'Owner Name','Created Date','Next Reminder Date',
      'Latest Site Visit Done Date','Total Visited Projects Name',
      'Site Visit Done Count','IsSiteVisitDone','Make Call Count'
    ],
    required: [
      'FirstName','Mobile No.','Project Name','Property For','Property',
      'Property Type','Property Location','Status Name','Converted Date',
      'Source Name','Owner Name','Created Date'
    ],
    sampleRow: {
      'FirstName': 'Priya', 'LastName': 'Patel', 'Country ISD Code': '91',
      'Mobile No.': '9876543211', 'Email Id': 'priya@example.com',
      'Project Name': 'Shikhar Kiaan', 'Property For': 'Buy', 'Property': 'Flat',
      'Property Type': '3BHK', 'Property Location': 'Ahmedabad',
      'Status Name': 'Converted', 'Converted Date': '15/04/2026',
      'Source Name': 'Housing', 'Owner Name': 'Sachin',
      'Created Date': '01/04/2026', 'Next Reminder Date': '',
      'Latest Site Visit Done Date': '10/04/2026',
      'Total Visited Projects Name': 'Shikhar Kiaan',
      'Site Visit Done Count': '2', 'IsSiteVisitDone': 'Yes', 'Make Call Count': '3'
    }
  },

  site_visit: {
    label: 'Site Visits',
    icon: 'map-pin',
    color: 'amber',
    columns: ['Date','Visit Done By','CustomerName','Mobile No.','Location','Visited Project'],
    required: ['Date','Visit Done By','CustomerName','Mobile No.','Location','Visited Project'],
    sampleRow: {
      'Date': '10/05/2026', 'Visit Done By': 'Pavan',
      'CustomerName': 'Mukesh Mehta', 'Mobile No.': '9773188068',
      'Location': 'Ahmedabad', 'Visited Project': 'Amrut Orchid'
    }
  }
};

// ── SESSION STATE ─────────────────────────────────────────────
let dbUnlocked     = false;
let dbCurrentTable = null;
let dbParsedRows   = [];
let _dbPassword    = '';
function dbGetPassword() { return _dbPassword; }

// ── INIT ──────────────────────────────────────────────────────
function initDatabaseSection() {
  const sec = document.getElementById('section-database');
  if (!sec || sec.dataset.init) return;
  sec.dataset.init = '1';

  sec.innerHTML = `
    <!-- IN-APP CONFIRM MODAL -->
    <div class="db-confirm-overlay" id="dbConfirmOverlay">
      <div class="db-confirm-card">
        <div class="db-confirm-icon">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
            <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
          </svg>
        </div>
        <div class="db-confirm-title" id="dbConfirmTitle">Delete All Data?</div>
        <div class="db-confirm-msg" id="dbConfirmMsg"></div>
        <div class="db-confirm-actions">
          <button class="db-confirm-cancel" onclick="dbConfirmReject()">Cancel</button>
          <button class="db-confirm-ok" id="dbConfirmOkBtn" onclick="dbConfirmAccept()">Yes, Delete</button>
        </div>
      </div>
    </div>

    <!-- PASSWORD GATE -->
    <div id="dbGate" class="db-gate">
      <div class="db-gate-card">
        <div class="db-gate-icon">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
            <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
          </svg>
        </div>
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

    <!-- MAIN PANEL -->
    <div id="dbPanel" style="display:none">
      <div class="sec-head" style="justify-content:space-between;flex-wrap:wrap;gap:10px">
        <div style="display:flex;align-items:center;gap:10px">
          <h2 class="sec-title">Database Manager</h2>
          <span class="rec-badge" style="background:#fef3c7;color:#92400e">Admin Only</span>
        </div>
        <button class="db-lock-btn" onclick="dbLock()">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="11" width="18" height="11" rx="2"/>
            <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
          </svg>
          Lock Session
        </button>
      </div>

      <!-- TABLE CARDS -->
      <div class="db-table-cards" id="dbTableCards"></div>

      <!-- WORKSPACE -->
      <div class="db-workspace" id="dbWorkspace" style="display:none">

        <!-- Workspace header -->
        <div class="db-ws-header">
          <div style="display:flex;align-items:center;gap:12px">
            <div class="db-ws-icon" id="dbWsIcon"></div>
            <div>
              <div class="db-ws-title" id="dbWsTitle"></div>
              <div class="db-ws-sub"  id="dbWsSub"></div>
            </div>
          </div>
          <button class="db-ws-close" onclick="dbCloseWorkspace()">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        <!-- Required fields info bar -->
        <div class="db-required-bar" id="dbRequiredBar"></div>

        <div class="db-steps">

          <!-- CLEAR TABLE -->
          <div class="db-action-card danger">
            <div class="db-ac-head">
              <div class="db-ac-icon red">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <polyline points="3 6 5 6 21 6"/>
                  <path d="M19 6l-1 14H6L5 6"/>
                  <path d="M10 11v6"/><path d="M14 11v6"/>
                  <path d="M9 6V4h6v2"/>
                </svg>
              </div>
              <div>
                <div class="db-ac-title">Clear Table</div>
                <div class="db-ac-sub">Permanently deletes all rows from this table</div>
              </div>
            </div>
            <div class="db-danger-notice">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
              </svg>
              This action cannot be undone
            </div>
            <button class="db-btn-danger" id="dbTruncateBtn" onclick="dbTruncate()">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="3 6 5 6 21 6"/>
                <path d="M19 6l-1 14H6L5 6"/>
              </svg>
              Delete All Data
            </button>
          </div>

          <!-- UPLOAD -->
          <div class="db-action-card">
            <div class="db-ac-head">
              <div class="db-ac-icon blue">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                  <polyline points="17 8 12 3 7 8"/>
                  <line x1="12" y1="3" x2="12" y2="15"/>
                </svg>
              </div>
              <div>
                <div class="db-ac-title">Upload File</div>
                <div class="db-ac-sub">Insert new data from a CSV or Excel (.xlsx / .xls) file</div>
              </div>
            </div>

            <button class="db-btn-sample" onclick="dbDownloadSample()">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="7 10 12 15 17 10"/>
                <line x1="12" y1="15" x2="12" y2="3"/>
              </svg>
              Download Sample CSV
            </button>

            <!-- Drop zone -->
            <div class="db-drop-zone" id="dbDropZone"
              onclick="document.getElementById('dbFileInput').click()"
              ondragover="dbDragOver(event)"
              ondragleave="dbDragLeave()"
              ondrop="dbDrop(event)">
              <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="color:var(--s300)">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="17 8 12 3 7 8"/>
                <line x1="12" y1="3" x2="12" y2="15"/>
              </svg>
              <span id="dbDropLabel" style="font-size:13px;font-weight:600;color:var(--s600)">Click to browse or drag &amp; drop</span>
              <div class="db-drop-formats">
                <span class="db-fmt-badge csv">CSV</span>
                <span class="db-fmt-badge xlsx">XLSX</span>
                <span class="db-fmt-badge xls">XLS</span>
              </div>
              <input type="file" id="dbFileInput" accept=".csv,.xlsx,.xls" style="display:none" onchange="dbFileSelected(this)"/>
            </div>

            <!-- Preview -->
            <div id="dbPreview" style="display:none">
              <div class="db-preview-head">
                <div id="dbPreviewInfo" class="db-preview-info"></div>
                <button class="db-btn-ghost" onclick="dbClearFile()">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                  </svg>
                  Remove file
                </button>
              </div>
              <div id="dbValidationErrors"></div>
              <div class="db-preview-table-wrap" id="dbPreviewTable"></div>
              <button class="db-btn-insert" id="dbInsertBtn" onclick="dbInsert()" style="margin-top:12px">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                  <polyline points="20 6 9 17 4 12"/>
                </svg>
                Insert <span id="dbInsertCount"></span> Rows into Database
              </button>
            </div>
          </div>
        </div>

        <!-- Progress bar -->
        <div class="db-progress-wrap" id="dbProgressWrap" style="display:none">
          <div class="db-progress-label" id="dbProgressLabel">Inserting…</div>
          <div class="db-progress-bar">
            <div class="db-progress-fill" id="dbProgressFill"></div>
          </div>
        </div>

      </div><!-- /workspace -->
    </div><!-- /panel -->
  `;

  renderDbTableCards();
}

// ── IN-APP CONFIRM ────────────────────────────────────────────
let _dbConfirmResolve = null;
function dbConfirm(title, msg, okLabel = 'Confirm') {
  return new Promise(resolve => {
    _dbConfirmResolve = resolve;
    document.getElementById('dbConfirmTitle').textContent = title;
    document.getElementById('dbConfirmMsg').textContent   = msg;
    document.getElementById('dbConfirmOkBtn').textContent = okLabel;
    document.getElementById('dbConfirmOverlay').classList.add('open');
  });
}
function dbConfirmAccept() {
  document.getElementById('dbConfirmOverlay').classList.remove('open');
  if (_dbConfirmResolve) { _dbConfirmResolve(true); _dbConfirmResolve = null; }
}
function dbConfirmReject() {
  document.getElementById('dbConfirmOverlay').classList.remove('open');
  if (_dbConfirmResolve) { _dbConfirmResolve(false); _dbConfirmResolve = null; }
}

// ── TABLE CARDS ───────────────────────────────────────────────
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
  Object.keys(DB_TABLES).forEach(key => dbFetchCount(key));
}

async function dbFetchCount(table) {
  const el = document.getElementById(`dbCount_${table}`);
  if (!el) return;
  try {
    const r = await fetch(DB_API, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'count', password: dbGetPassword(), table })
    });
    const d = await r.json();
    el.innerHTML = d.ok
      ? `<span class="db-count-val">${d.count.toLocaleString()}</span><span class="db-count-lbl">rows</span>`
      : `<span class="db-count-err">—</span>`;
  } catch { el.innerHTML = `<span class="db-count-err">—</span>`; }
}

// ── PASSWORD ──────────────────────────────────────────────────
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
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'verify-password', password: pw })
    });
    const d = await r.json();
    if (d.ok) {
      _dbPassword = pw; dbUnlocked = true;
      document.getElementById('dbGate').style.display  = 'none';
      document.getElementById('dbPanel').style.display = 'block';
    } else {
      err.textContent = 'Incorrect password. Try again.';
      input.value = ''; input.focus();
    }
  } catch {
    err.textContent = 'Could not reach server. Check your connection.';
  }
  btn.disabled = false;
  document.getElementById('dbGateBtnText').textContent = 'Unlock';
}

function dbLock() {
  dbUnlocked = false; _dbPassword = '';
  dbCloseWorkspace();
  document.getElementById('dbGate').style.display  = 'flex';
  document.getElementById('dbPanel').style.display = 'none';
  const inp = document.getElementById('dbPasswordInput');
  if (inp) inp.value = '';
}

// ── WORKSPACE ─────────────────────────────────────────────────
function dbOpenWorkspace(table) {
  dbCurrentTable = table;
  const t = DB_TABLES[table];

  document.getElementById('dbWorkspace').style.display = 'block';
  document.getElementById('dbWsTitle').textContent     = t.label;
  document.getElementById('dbWsSub').textContent       = `${t.columns.length} columns total`;

  // Required fields bar
  document.getElementById('dbRequiredBar').innerHTML = `
    <div class="db-req-label">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
      Required fields:
    </div>
    <div class="db-req-tags">
      ${t.required.map(r => `<span class="db-req-tag">${r}</span>`).join('')}
    </div>`;

  const iconEl = document.getElementById('dbWsIcon');
  iconEl.className = `db-ws-icon db-icon-${t.color}`;
  iconEl.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${lucidePathFor(t.icon)}</svg>`;

  dbClearFile();
  document.getElementById('dbWorkspace').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function dbCloseWorkspace() {
  const ws = document.getElementById('dbWorkspace');
  if (ws) ws.style.display = 'none';
  dbCurrentTable = null;
  dbClearFile();
}

// ── TRUNCATE ──────────────────────────────────────────────────
async function dbTruncate() {
  if (!dbCurrentTable) return;
  const t = DB_TABLES[dbCurrentTable];

  const ok = await dbConfirm(
    'Delete All Data?',
    `You are about to permanently delete every row from "${t.label}" (${dbCurrentTable}). This cannot be undone.`,
    'Yes, Delete Everything'
  );
  if (!ok) return;

  const btn = document.getElementById('dbTruncateBtn');
  btn.disabled = true;
  btn.innerHTML = `<span class="db-btn-spinner"></span> Deleting…`;

  try {
    const r = await fetch(DB_API, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'truncate', password: dbGetPassword(), table: dbCurrentTable })
    });
    const d = await r.json();
    if (d.ok) {
      dbShowToast(`✓ ${t.label} cleared successfully.`, 'success');
      dbFetchCount(dbCurrentTable);
    } else {
      dbShowInlineError(`Truncate failed: ${d.error}`);
    }
  } catch (e) {
    dbShowInlineError(`Network error: ${e.message}`);
  }

  btn.disabled = false;
  btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/></svg> Delete All Data`;
}

// ── FILE HANDLING ─────────────────────────────────────────────
function dbDragOver(e)  { e.preventDefault(); document.getElementById('dbDropZone').classList.add('drag-over'); }
function dbDragLeave()  { document.getElementById('dbDropZone').classList.remove('drag-over'); }
function dbDrop(e) {
  e.preventDefault();
  document.getElementById('dbDropZone').classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file) dbHandleFile(file);
}
function dbFileSelected(input) { if (input.files[0]) dbHandleFile(input.files[0]); }

function dbHandleFile(file) {
  const name = file.name.toLowerCase();
  if (name.endsWith('.csv')) {
    dbReadCSV(file);
  } else if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
    dbReadXLSX(file);
  } else {
    dbShowInlineError('Unsupported file type. Please upload a .csv, .xlsx, or .xls file.');
  }
}

function dbReadCSV(file) {
  const reader = new FileReader();
  reader.onload = e => {
    const lines = e.target.result.split(/\r?\n/).filter(l => l.trim());
    if (lines.length < 2) { dbShowInlineError('CSV has no data rows.'); return; }
    const headers = parseCSVLine(lines[0]).map(h => h.trim());
    const rows = [];
    for (let i = 1; i < lines.length; i++) {
      const vals = parseCSVLine(lines[i]);
      if (vals.every(v => !v.trim())) continue;
      const row = {};
      headers.forEach((h, j) => { row[h] = (vals[j] || '').trim(); });
      rows.push(row);
    }
    dbParsedRows = rows;
    dbShowPreview(headers, rows);
  };
  reader.readAsText(file);
}

function dbReadXLSX(file) {
  if (typeof XLSX === 'undefined') {
    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
    script.onload  = () => dbParseXLSX(file);
    script.onerror = () => dbShowInlineError('Could not load Excel parser. Check your internet connection.');
    document.head.appendChild(script);
  } else {
    dbParseXLSX(file);
  }
}

function dbParseXLSX(file) {
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const wb   = XLSX.read(e.target.result, { type: 'array' });
      const ws   = wb.Sheets[wb.SheetNames[0]];
      const data = XLSX.utils.sheet_to_json(ws, { defval: '' });
      if (!data.length) { dbShowInlineError('Excel file has no data rows.'); return; }
      const rows = data.map(row => {
        const clean = {};
        Object.entries(row).forEach(([k, v]) => { clean[k.trim()] = String(v).trim(); });
        return clean;
      });
      dbParsedRows = rows;
      dbShowPreview(Object.keys(rows[0]), rows);
    } catch (err) {
      dbShowInlineError(`Failed to parse Excel file: ${err.message}`);
    }
  };
  reader.readAsArrayBuffer(file);
}

function parseCSVLine(line) {
  const result = []; let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { inQ = !inQ; continue; }
    if (ch === ',' && !inQ) { result.push(cur); cur = ''; continue; }
    cur += ch;
  }
  result.push(cur);
  return result;
}

// ── PREVIEW + VALIDATION ──────────────────────────────────────
function dbShowPreview(headers, rows) {
  if (!dbCurrentTable) return;
  const t = DB_TABLES[dbCurrentTable];
  const errors   = [];
  const warnings = [];

  // Column checks
  const unknownCols = headers.filter(h => h && !t.columns.includes(h));
  const missingReq  = t.required.filter(r => !headers.includes(r));
  const missingOpt  = t.columns.filter(c => !t.required.includes(c) && !headers.includes(c));

  if (unknownCols.length) errors.push(`Unknown columns (will be ignored by server): ${unknownCols.join(', ')}`);
  if (missingReq.length)  errors.push(`Missing required columns: ${missingReq.join(', ')}`);
  if (missingOpt.length)  warnings.push(`Optional columns not in file (will be blank): ${missingOpt.join(', ')}`);

  // Row-level required checks
  const rowErrors = [];
  rows.forEach((row, i) => {
    t.required.forEach(col => {
      if (headers.includes(col) && (!row[col] || String(row[col]).trim() === ''))
        rowErrors.push(`Row ${i + 2}: "${col}" is empty`);
    });
  });
  if (rowErrors.length) errors.push(...rowErrors.slice(0, 15));
  if (rowErrors.length > 15) errors.push(`… and ${rowErrors.length - 15} more row errors`);

  // Render errors + warnings
  const errWrap = document.getElementById('dbValidationErrors');
  let errHtml = '';

  if (errors.length) {
    errHtml += `
      <div class="db-error-box">
        <div class="db-error-title">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          ${errors.length} error${errors.length > 1 ? 's' : ''} found — fix before inserting
        </div>
        <ul>${errors.map(e => `<li>${e}</li>`).join('')}</ul>
      </div>`;
    document.getElementById('dbInsertBtn').disabled     = true;
    document.getElementById('dbInsertBtn').style.opacity = '.4';
  } else {
    document.getElementById('dbInsertBtn').disabled     = false;
    document.getElementById('dbInsertBtn').style.opacity = '1';
  }

  if (warnings.length) {
    errHtml += `
      <div class="db-warning-box">
        <div class="db-warning-title">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
          ${warnings.length} warning${warnings.length > 1 ? 's' : ''}
        </div>
        <ul>${warnings.map(w => `<li>${w}</li>`).join('')}</ul>
      </div>`;
  }

  errWrap.innerHTML = errHtml;

  // Render preview table
  const previewRows = rows.slice(0, 5);
  document.getElementById('dbPreviewTable').innerHTML = `
    <table>
      <thead>
        <tr>${headers.map(h => {
          const isReq  = t.required.includes(h);
          const isUnkn = !t.columns.includes(h);
          const cls    = isUnkn ? 'th-unknown' : (isReq ? 'th-required' : '');
          return `<th class="${cls}">${h}${isReq ? '<span class="th-req-dot">*</span>' : ''}${isUnkn ? '<span class="th-unk-badge">?</span>' : ''}</th>`;
        }).join('')}</tr>
      </thead>
      <tbody>
        ${previewRows.map(row =>
          `<tr>${headers.map(h => {
            const val     = row[h] !== undefined ? row[h] : '';
            const isEmpty = t.required.includes(h) && (!val || val.trim() === '');
            return `<td class="${isEmpty ? 'td-empty-req' : ''}">${val || '<span style="color:var(--s300);font-style:italic">—</span>'}</td>`;
          }).join('')}</tr>`
        ).join('')}
      </tbody>
    </table>`;

  // Success state
  if (!errors.length) {
    errWrap.innerHTML += `
      <div class="db-success-box">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
        File looks good — ${rows.length.toLocaleString()} rows ready to insert
      </div>`;
  }

  document.getElementById('dbPreviewInfo').innerHTML =
    `<strong>${rows.length.toLocaleString()} rows</strong> · ${headers.length} columns · previewing first 5 rows`;
  document.getElementById('dbInsertCount').textContent = rows.length.toLocaleString();
  document.getElementById('dbDropZone').style.display  = 'none';
  document.getElementById('dbPreview').style.display   = 'block';
}

function dbClearFile() {
  dbParsedRows = [];
  const dz = document.getElementById('dbDropZone');
  const pv = document.getElementById('dbPreview');
  const fi = document.getElementById('dbFileInput');
  const ev = document.getElementById('dbValidationErrors');
  const pt = document.getElementById('dbPreviewTable');
  if (dz) dz.style.display = 'flex';
  if (pv) pv.style.display = 'none';
  if (fi) fi.value = '';
  if (ev) ev.innerHTML = '';
  if (pt) pt.innerHTML = '';
}

// ── INSERT ────────────────────────────────────────────────────
async function dbInsert() {
  if (!dbCurrentTable || !dbParsedRows.length) return;
  const btn = document.getElementById('dbInsertBtn');
  btn.disabled = true;

  const progressWrap  = document.getElementById('dbProgressWrap');
  const progressFill  = document.getElementById('dbProgressFill');
  const progressLabel = document.getElementById('dbProgressLabel');
  progressWrap.style.display = 'block';
  progressFill.style.width   = '0%';

  const BATCH = 500;
  const total = dbParsedRows.length;

  try {
    for (let i = 0; i < total; i += BATCH) {
      const batch = dbParsedRows.slice(i, i + BATCH);
      const pct   = Math.round((i / total) * 100);
      progressFill.style.width  = pct + '%';
      progressLabel.textContent = `Inserting… ${i.toLocaleString()} / ${total.toLocaleString()} rows`;

      const r = await fetch(DB_API, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'insert', password: dbGetPassword(), table: dbCurrentTable, rows: batch })
      });
      const d = await r.json();

      if (!d.ok) {
        progressWrap.style.display = 'none';
        document.getElementById('dbValidationErrors').innerHTML += `
          <div class="db-error-box" style="margin-top:10px">
            <div class="db-error-title">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
              Server rejected the upload — ${d.error}
            </div>
            <ul>${(d.details || []).map(e => `<li>${e}</li>`).join('')}</ul>
          </div>`;
        dbShowToast(`Insert failed: ${d.error}`, 'error');
        btn.disabled = false;
        return;
      }
    }

    progressFill.style.width  = '100%';
    progressLabel.textContent = `Done! ${total.toLocaleString()} rows inserted successfully.`;
    setTimeout(() => { progressWrap.style.display = 'none'; }, 3000);
    dbShowToast(`✓ ${total.toLocaleString()} rows inserted into ${DB_TABLES[dbCurrentTable].label}`, 'success');
    dbFetchCount(dbCurrentTable);
    dbClearFile();
  } catch (e) {
    dbShowInlineError(`Network error: ${e.message}`);
    progressWrap.style.display = 'none';
  }
  btn.disabled = false;
}

// ── SAMPLE CSV ────────────────────────────────────────────────
function dbDownloadSample() {
  if (!dbCurrentTable) return;
  const t = DB_TABLES[dbCurrentTable];
  const header = t.columns.join(',');
  const sample = t.columns.map(col => {
    const val = t.sampleRow[col] || '';
    return val.includes(',') ? `"${val}"` : val;
  }).join(',');
  const blob = new Blob([`${header}\n${sample}\n`], { type: 'text/csv' });
  const url  = URL.createObjectURL(blob);
  const a    = Object.assign(document.createElement('a'), { href: url, download: `sample_${dbCurrentTable}.csv` });
  a.click();
  URL.revokeObjectURL(url);
}

// ── HELPERS ───────────────────────────────────────────────────
function dbShowInlineError(msg) {
  const errWrap = document.getElementById('dbValidationErrors');
  if (!errWrap) { dbShowToast(msg, 'error'); return; }
  errWrap.innerHTML = `
    <div class="db-error-box">
      <div class="db-error-title">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
        ${msg}
      </div>
    </div>`;
}

function dbShowToast(msg, type = 'success') {
  if (typeof showToast === 'function') { showToast(msg, type); return; }
  const t = document.createElement('div');
  t.className = `toast toast-${type} show`;
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3500);
}

function lucidePathFor(icon) {
  const paths = {
    'users':          '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
    'check-circle-2': '<path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z"/><path d="m9 12 2 2 4-4"/>',
    'map-pin':        '<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/>',
    'database':       '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14c0 1.657 4.03 3 9 3s9-1.343 9-3V5"/><path d="M3 12c0 1.657 4.03 3 9 3s9-1.343 9-3"/>',
  };
  return paths[icon] || paths['database'];
}

// ── NAV HOOK ──────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
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
