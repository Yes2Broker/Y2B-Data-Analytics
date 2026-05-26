/* ================================================================
   YES2BROKER — app.js  v7
   Fixes: normalisation, date parsing, 15-bucket scroll charts,
   KPI drill-down popups, custom company conversion, UI confirms
   ================================================================ */

// ── SUPABASE CONFIG ───────────────────────────────────────────
const SUPA_URL = 'https://nrbgwhltmvrnwfxhkdqu.supabase.co';
const SUPA_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5yYmd3aGx0bXZybndmeGhrZHF1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg1MDA5OTksImV4cCI6MjA5NDA3Njk5OX0.0bPowEtGvmFpoKoLm2UblsuzsSpq1VjPu-mhGxNrv1c';
const HEADERS  = { 'apikey': SUPA_KEY, 'Authorization': `Bearer ${SUPA_KEY}`, 'Accept': 'application/json' };

// ── CONSTANTS ─────────────────────────────────────────────────
const STATUS_ORDER = ['Inactive','New','Call Not Received','Active','Site Visit Schedule','Site Visit Done','Cold','Warm','Hot'];
const STATUS_COLORS = {
  'Inactive':'#ef4444','New':'#2563eb','Call Not Received':'#f59e0b',
  'Active':'#8b5cf6','Site Visit Schedule':'#06b6d4','Site Visit Done':'#10b981',
  'Cold':'#64748b','Warm':'#f97316','Hot':'#dc2626',
};
const PALETTE   = ['#2563eb','#059669','#d97706','#dc2626','#7c3aed','#0891b2','#db2777','#65a30d','#ea580c','#0284c7','#4f46e5','#0d9488','#b45309','#9333ea','#16a34a'];
const FY_MONTHS = ['Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec','Jan','Feb','Mar'];
const FONT      = 'Plus Jakarta Sans';
const Y2B_ID    = 'y2b';
const VISIBLE_BUCKETS = 15; // always show 15 at a time, scroll for rest

// ── GLOBAL STATE ──────────────────────────────────────────────
let masterCache    = [];
let visitsCache    = [];
let convertedCache = [];
let companies      = [];
let activeCompany  = Y2B_ID;
let chartInstances = {};
let granularity    = 'monthly';
let compSelected   = new Set();
let allOwners=[], allSources=[], allStatuses=[], allProjects=[];
let fOwner='', fSource='', fStatus='', fFrom='', fTo='';
let _searchTimer   = null;
const pgState      = {};
const sectionRendered = {};

function getPg(id)    { if(!pgState[id]) pgState[id]={page:1,size:10}; return pgState[id]; }
function resetPg(id)  { getPg(id).page=1; }
function invalidate() { Object.keys(sectionRendered).forEach(k=>delete sectionRendered[k]); }

// ── TEXT NORMALISATION ────────────────────────────────────────
// Normalise any text value — trim, proper case for known fields
function normaliseValue(val) {
  if(!val) return '';
  return val.trim()
    // collapse multiple spaces
    .replace(/\s+/g,' ');
}

// Title-case a string
function titleCase(s) {
  return s.replace(/\w\S*/g, w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
}

// Canonical map: all variants → canonical form
// Covers Status, Source, and any other enum-like field
const CANONICAL = {
  // Status variants
  'inactive':'Inactive','Inactive':'Inactive',
  'new':'New','New':'New',
  'call not received':'Call Not Received','Call Not Received':'Call Not Received',
  'cnr':'Call Not Received','CNR':'Call Not Received',
  'active':'Active','Active':'Active',
  'site visit schedule':'Site Visit Schedule','Site Visit Schedule':'Site Visit Schedule',
  'site visit scheduled':'Site Visit Schedule',
  'site visit done':'Site Visit Done','Site Visit Done':'Site Visit Done',
  'cold':'Cold','Cold':'Cold',
  'warm':'Warm','Warm':'Warm',
  'hot':'Hot','Hot':'Hot',
  'converted':'Converted','Converted':'Converted',
  // Source variants
  '99acres':'99 Acres','99 acres':'99 Acres','99 Acres':'99 Acres',
  'magicbricks':'Magicbricks','MagicBricks':'Magicbricks','magic bricks':'Magicbricks',
  'housing':'Housing','Housing.com':'Housing',
  'walk in':'Walk In','Walk in':'Walk In','walkin':'Walk In','Walk In':'Walk In',
  'facebook':'Facebook/Digital Marketing','facebook/digital marketing':'Facebook/Digital Marketing',
  'Facebook/Digital Marketing':'Facebook/Digital Marketing',
  'paid data':'Paid Data','Paid Data':'Paid Data','paid':'Paid Data',
  'channel partner':'Channel Partner','Channel Partner':'Channel Partner',
  'just dial':'Just Dial','Just Dial':'Just Dial','justdial':'Just Dial',
  'sulekha':'Sulekha','Sulekha':'Sulekha',
  'india property':'India Property','India Property':'India Property',
};

function canon(val) {
  if(!val) return '';
  const t = normaliseValue(val);
  // exact match first
  if(CANONICAL[t]) return CANONICAL[t];
  // lowercase match
  const l = t.toLowerCase();
  if(CANONICAL[l]) return CANONICAL[l];
  // title case match
  const tc = titleCase(t);
  if(CANONICAL[tc]) return CANONICAL[tc];
  // return title-cased original as fallback
  return titleCase(t);
}

// Apply canon() to specific fields on every row
function normaliseRow(r) {
  const out = {...r};
  if(out['Status Name']) out['Status Name'] = canon(out['Status Name']);
  if(out['Source Name']) out['Source Name'] = canon(out['Source Name']);
  if(out['Owner Name'])  out['Owner Name']  = normaliseValue(out['Owner Name']);
  if(out['Project Name']) out['Project Name'] = normaliseValue(out['Project Name']);
  if(out['Property Location']) out['Property Location'] = normaliseValue(out['Property Location']);
  return out;
}

// ── SUPABASE HELPERS ──────────────────────────────────────────
async function sbFetch(table, params='') {
  const url = `${SUPA_URL}/rest/v1/${table}?${params}`;
  const controller = new AbortController();
  const timeout = setTimeout(()=>controller.abort(), 20000);
  try {
    const res = await fetch(url, { headers: HEADERS, signal: controller.signal });
    clearTimeout(timeout);
    if(!res.ok) { let b='';try{b=await res.text();}catch(_){} throw new Error(`HTTP ${res.status} on ${table}: ${b||res.statusText}`); }
    return res.json();
  } catch(err) {
    clearTimeout(timeout);
    if(err.name==='AbortError') throw new Error(`Timeout fetching ${table}`);
    throw err;
  }
}
async function sbPost(table, body) {
  const res = await fetch(`${SUPA_URL}/rest/v1/${table}`, {
    method:'POST', headers:{...HEADERS,'Content-Type':'application/json','Prefer':'return=representation'},
    body: JSON.stringify(body)
  });
  if(!res.ok){let b='';try{b=await res.text();}catch(_){} throw new Error(`[${res.status}] ${b}`);}
  return res.json();
}
async function sbDelete(table, filter) {
  const res = await fetch(`${SUPA_URL}/rest/v1/${table}?${filter}`, { method:'DELETE', headers: HEADERS });
  if(!res.ok){let b='';try{b=await res.text();}catch(_){} throw new Error(`[${res.status}] ${b}`);}
  return true;
}
async function sbFetchAll(table, select='*', filter='') {
  const PAGE=1000; let all=[], offset=0;
  while(true) {
    const parts=[`select=${select}`,`limit=${PAGE}`,`offset=${offset}`];
    if(filter) parts.push(filter);
    const batch = await sbFetch(table, parts.join('&'));
    if(!Array.isArray(batch)) throw new Error(`Bad response from ${table}: ${JSON.stringify(batch).slice(0,200)}`);
    all = all.concat(batch);
    if(batch.length < PAGE) break;
    offset += PAGE;
  }
  return all;
}

// ── BOOT ──────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', ()=>{ Chart.register(ChartDataLabels); setupNav(); loadAll(); });

// ── NAVIGATION ────────────────────────────────────────────────
function setupNav() {
  document.querySelectorAll('.nav-item').forEach(el=>{
    el.addEventListener('click', e=>{ e.preventDefault(); switchSection(el.dataset.section); if(window.innerWidth<=900) document.getElementById('sidebar').classList.remove('open'); });
  });
}
const TITLES = {overview:'Overview',platform:'Platform & Source',owner:'Owner-wise Leads',status:'Lead Status',calls:'Call Analytics',visits:'Site Visits',budget:'Budget & Property',converted:'Converted Leads',comparison:'Employee Comparison','leads-table':'All Leads'};
function switchSection(sec) {
  document.querySelectorAll('.nav-item').forEach(n=>n.classList.toggle('active',n.dataset.section===sec));
  document.querySelectorAll('.section').forEach(s=>s.classList.remove('active'));
  document.getElementById(`section-${sec}`)?.classList.add('active');
  document.getElementById('pageTitle').textContent=TITLES[sec]||sec;
  window.scrollTo({top:0,behavior:'smooth'});
  if(!sectionRendered[sec]) renderSection(sec);
}
function toggleSidebar(){document.getElementById('sidebar').classList.toggle('open');}
function setGranularity(g,btn){granularity=g;document.querySelectorAll('.tg').forEach(b=>b.classList.toggle('active',b===btn));invalidate();const sec=document.querySelector('.section.active')?.id?.replace('section-','');if(sec)renderSection(sec);}

// ── COMPANY SWITCHER ──────────────────────────────────────────
function buildCompanySwitcher() {
  const wrap=document.getElementById('companySwitcher'); if(!wrap) return;
  const list=[{id:Y2B_ID,name:'yes2broker (Y2B)'},...companies];
  wrap.innerHTML=list.map(c=>`<div class="cs-item${c.id===activeCompany?' active':''}" onclick="switchCompany('${c.id}')"><span class="cs-dot"></span>${escHtml(c.name)}</div>`).join('');
}
function switchCompany(id) {
  activeCompany=id; invalidate();
  fOwner=fSource=fStatus=fFrom=fTo='';
  ['filterFrom','filterTo','filterOwner','filterSource','filterStatus'].forEach(i=>{const el=document.getElementById(i);if(el)el.value='';});
  buildCompanySwitcher(); updateCompanyBadge(); populateDropdowns();
  const sec=document.querySelector('.section.active')?.id?.replace('section-','');
  renderSection(sec||'overview');
}
function updateCompanyBadge(){const b=document.getElementById('activeCompanyBadge');if(b)b.textContent=activeCompany===Y2B_ID?'yes2broker':companies.find(c=>c.id==activeCompany)?.name||'';}

// ── DATA ACCESS ───────────────────────────────────────────────
function getCompanyLeads() {
  if(activeCompany===Y2B_ID) {
    const allClaimed=new Set(companies.flatMap(c=>c.projects));
    return masterCache.filter(r=>!allClaimed.has(r['Project Name']));
  }
  const co=companies.find(c=>String(c.id)===String(activeCompany));
  if(!co) return [];
  const ps=new Set(co.projects);
  return masterCache.filter(r=>ps.has(r['Project Name']));
}
function getCompanyConverted() {
  if(activeCompany===Y2B_ID) return convertedCache;
  // Custom company: filter convertion by project match
  const co=companies.find(c=>String(c.id)===String(activeCompany));
  if(!co) return [];
  const ps=new Set(co.projects);
  // convertion table doesn't have Project Name — match by Owner or use all
  // Fall back to matching by Source or show all for the company's leads' owners
  const owners=new Set(getCompanyLeads().map(r=>r['Owner Name']).filter(Boolean));
  return convertedCache.filter(r=>owners.has(r['Owner Name']));
}
function getFiltered() {
  return getCompanyLeads().filter(r=>{
    if(fOwner  && r['Owner Name']  !==fOwner)  return false;
    if(fSource && r['Source Name'] !==fSource) return false;
    if(fStatus && r['Status Name'] !==fStatus) return false;
    if(fFrom||fTo){const d=parseDate(r['Created Date']);if(!d)return false;if(fFrom&&d<new Date(fFrom))return false;if(fTo&&d>new Date(fTo+'T23:59:59'))return false;}
    return true;
  });
}
function applyFilters(){fOwner=document.getElementById('filterOwner')?.value||'';fSource=document.getElementById('filterSource')?.value||'';fStatus=document.getElementById('filterStatus')?.value||'';fFrom=document.getElementById('filterFrom')?.value||'';fTo=document.getElementById('filterTo')?.value||'';invalidate();const sec=document.querySelector('.section.active')?.id?.replace('section-','');if(sec)renderSection(sec);}
function clearFilters(){['filterFrom','filterTo','filterOwner','filterSource','filterStatus'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});fOwner=fSource=fStatus=fFrom=fTo='';invalidate();const sec=document.querySelector('.section.active')?.id?.replace('section-','');if(sec)renderSection(sec);}
function populateDropdowns(){
  const d=getCompanyLeads();
  const uniq=key=>[...new Set(d.map(r=>r[key]).filter(Boolean))].sort();
  fillSel('filterOwner', uniq('Owner Name'),'All Owners');
  fillSel('filterSource',uniq('Source Name'),'All Sources');
  fillSel('filterStatus',uniq('Status Name'),'All Statuses');
}

// ── LOAD ALL ──────────────────────────────────────────────────
async function loadAll() {
  showLoading();
  document.getElementById('refreshBtn')?.classList.add('refreshing');
  try {
    updateLoadText('Connecting to Supabase…');
    // Test connection
    const test = await sbFetch('master_data','select=id&limit=1');
    if(!Array.isArray(test)) throw new Error('Unexpected response — check your API key and table name');

    updateLoadText('Loading leads…');
    const raw = await sbFetchAll('master_data','*','');
    masterCache = raw.map(normaliseRow);
    updateLoadText(`${masterCache.length.toLocaleString()} leads loaded — loading visits…`);

    visitsCache    = await sbFetchAll('site_visit','*','').catch(e=>{console.warn('site_visit:',e);return[];});
    convertedCache = (await sbFetchAll('convertion','*','').catch(e=>{console.warn('convertion:',e);return[];})).map(normaliseRow);
    companies      = await loadCompanies();

    allProjects=[...new Set(masterCache.map(r=>r['Project Name']).filter(Boolean))].sort();
    allOwners  =[...new Set(masterCache.map(r=>r['Owner Name']).filter(Boolean))].sort();
    allSources =[...new Set(masterCache.map(r=>r['Source Name']).filter(Boolean))].sort();
    allStatuses=[...new Set(masterCache.map(r=>r['Status Name']).filter(Boolean))].sort();

    buildCompanySwitcher(); updateCompanyBadge(); populateDropdowns(); buildCompCheckboxes();
    showDashboard();
    renderSection('overview');
    document.getElementById('lastUpdated').textContent='Updated '+new Date().toLocaleTimeString()+' · '+masterCache.length.toLocaleString()+' leads';
  } catch(err) {
    showError(`Connection failed:\n\n${err.message}\n\nCheck:\n1. Table 'master_data' exists in Supabase\n2. RLS policy "Allow public read" is active\n3. API key is correct`);
    console.error(err);
  } finally {
    document.getElementById('refreshBtn')?.classList.remove('refreshing');
  }
}
async function loadData(){masterCache=[];visitsCache=[];convertedCache=[];companies=[];invalidate();await loadAll();}
function updateLoadText(m){const el=document.querySelector('.load-text');if(el)el.textContent=m;}

// ── COMPANY CRUD ──────────────────────────────────────────────
async function loadCompanies() {
  try {
    const [cos,projs]=await Promise.all([sbFetch('companies','select=*&order=created_at'),sbFetch('company_projects','select=*')]);
    return cos.map(c=>({...c,projects:projs.filter(p=>p.company_id===c.id).map(p=>p.project_name)}));
  } catch(_){return [];}
}
function openCompanyModal(editId=null) {
  const existing=editId?companies.find(c=>String(c.id)===String(editId)):null;
  document.getElementById('modalTitle').textContent=existing?`Edit — ${existing.name}`:'Create Company';
  document.getElementById('companyNameInput').value=existing?.name||'';
  document.getElementById('modalEditId').value=editId||'';
  document.getElementById('projectSearch').value='';
  renderProjectPicker(existing?.projects||[]);
  document.getElementById('companyModal').classList.add('open');
  lucide.createIcons();
}
function closeCompanyModal(){document.getElementById('companyModal').classList.remove('open');}

function renderProjectPicker(selected=[]) {
  const search=(document.getElementById('projectSearch')?.value||'').toLowerCase().trim();
  const container=document.getElementById('projectPicker'); if(!container) return;
  const checked=new Set([...selected,...[...document.querySelectorAll('#projectPicker input:checked')].map(i=>i.value)]);
  // Checked items first, then unchecked, both filtered by search
  const checkedProjs=allProjects.filter(p=>checked.has(p)&&(!search||p.toLowerCase().includes(search)));
  const uncheckedProjs=allProjects.filter(p=>!checked.has(p)&&(!search||p.toLowerCase().includes(search)));
  const renderItem=(p,isChecked)=>`<label class="proj-check${isChecked?' checked':''}" data-project="${escHtml(p)}"><input type="checkbox" value="${escHtml(p)}"${isChecked?' checked':''} onchange="this.closest('.proj-check').classList.toggle('checked',this.checked)"/><span class="proj-name">${escHtml(p)}</span></label>`;
  const html=[
    checkedProjs.length?`<div class="proj-section-label">Selected (${checkedProjs.length})</div>`:'',
    ...checkedProjs.map(p=>renderItem(p,true)),
    uncheckedProjs.length&&checkedProjs.length?`<div class="proj-section-divider"></div>`:'',
    uncheckedProjs.length?`<div class="proj-section-label">Available</div>`:'',
    ...uncheckedProjs.map(p=>renderItem(p,false)),
  ].join('');
  container.innerHTML=html||'<p style="padding:12px;color:#94a3b8;font-size:13px">No projects found</p>';
}

function getSelectedProjects(){return[...document.querySelectorAll('#projectPicker input:checked')].map(i=>i.value);}
function getSelectedProjectValues(){return getSelectedProjects();}

async function saveCompany() {
  const name=document.getElementById('companyNameInput').value.trim();
  const editId=document.getElementById('modalEditId').value;
  const selectedProjects=getSelectedProjects();
  if(!name){showToast('Please enter a company name','error');return;}
  const btn=document.getElementById('saveCompanyBtn');
  btn.disabled=true;btn.textContent='Saving…';
  try {
    let companyId=editId;
    if(!editId){const[created]=await sbPost('companies',{name});companyId=created.id;}
    else{await fetch(`${SUPA_URL}/rest/v1/companies?id=eq.${editId}`,{method:'PATCH',headers:{...HEADERS,'Content-Type':'application/json','Prefer':'return=minimal'},body:JSON.stringify({name})});}
    await sbDelete('company_projects',`company_id=eq.${companyId}`);
    if(selectedProjects.length>0) await sbPost('company_projects',selectedProjects.map(p=>({company_id:companyId,project_name:p})));
    companies=await loadCompanies();
    buildCompanySwitcher();updateCompanyBadge();invalidate();populateDropdowns();
    const sec=document.querySelector('.section.active')?.id?.replace('section-','');
    if(sec)renderSection(sec);
    closeCompanyModal();
    showToast(`Company "${name}" saved successfully`,'success');
  } catch(err){showToast('Error saving company: '+err.message,'error');}
  finally{btn.disabled=false;btn.textContent='Save Company';}
}

async function deleteCompany(id) {
  const co=companies.find(c=>String(c.id)===String(id));
  showConfirm(`Delete "${co?.name||'this company'}"?`,'Its leads will return to yes2broker.',async()=>{
    try {
      await sbDelete('companies',`id=eq.${id}`);
      if(String(activeCompany)===String(id)) activeCompany=Y2B_ID;
      companies=await loadCompanies();
      buildCompanySwitcher();updateCompanyBadge();invalidate();populateDropdowns();
      const sec=document.querySelector('.section.active')?.id?.replace('section-','');
      if(sec)renderSection(sec);
      showToast('Company deleted','success');
    } catch(err){showToast('Error: '+err.message,'error');}
  });
}

// ── UI DIALOGS (custom, no browser alerts) ────────────────────
function showToast(msg, type='success') {
  let t=document.getElementById('toastEl');
  if(!t){t=document.createElement('div');t.id='toastEl';document.body.appendChild(t);}
  t.className=`toast toast-${type}`;
  t.innerHTML=`<i data-lucide="${type==='success'?'check-circle':'alert-circle'}" style="width:15px;height:15px;flex-shrink:0"></i><span>${escHtml(msg)}</span>`;
  t.classList.add('show');
  lucide.createIcons();
  clearTimeout(t._timer);
  t._timer=setTimeout(()=>t.classList.remove('show'),3500);
}

function showConfirm(title, msg, onConfirm) {
  let m=document.getElementById('confirmModal');
  if(!m){
    m=document.createElement('div');m.id='confirmModal';m.className='modal-overlay';
    m.innerHTML=`<div class="modal" style="max-width:400px"><div class="modal-header"><h3 id="confirmTitle"></h3></div><div class="modal-body"><p id="confirmMsg" style="font-size:14px;color:#475569"></p></div><div class="modal-footer"><button class="btn-secondary" onclick="document.getElementById('confirmModal').classList.remove('open')">Cancel</button><button class="btn-danger" id="confirmOkBtn">Delete</button></div></div>`;
    document.body.appendChild(m);
  }
  document.getElementById('confirmTitle').textContent=title;
  document.getElementById('confirmMsg').textContent=msg;
  document.getElementById('confirmOkBtn').onclick=()=>{m.classList.remove('open');onConfirm();};
  m.classList.add('open');
}

// KPI drill-down popup
function showKpiDrilldown(title, rows, headers) {
  let m=document.getElementById('drilldownModal');
  if(!m){
    m=document.createElement('div');m.id='drilldownModal';m.className='modal-overlay';
    m.innerHTML=`<div class="modal" style="max-width:900px;max-height:90vh"><div class="modal-header"><h3 id="drillTitle"></h3><button class="modal-close" onclick="document.getElementById('drilldownModal').classList.remove('open')"><i data-lucide="x"></i></button></div><div class="modal-body" style="padding:0"><div class="tbl-scroll"><table id="drillTable" style="width:100%"></table></div></div><div class="modal-footer"><span id="drillCount" style="font-size:12px;color:#94a3b8;margin-right:auto"></span><button class="btn-secondary" onclick="document.getElementById('drilldownModal').classList.remove('open')">Close</button></div></div>`;
    document.body.appendChild(m);
  }
  document.getElementById('drillTitle').textContent=title;
  document.getElementById('drillCount').textContent=`${rows.length.toLocaleString()} records`;
  fillTable('drillTable',headers,rows);
  m.classList.add('open');
  lucide.createIcons();
}

// Clickable KPI card — passes a filter function
function kpiCard(icon,val,label,cls='',drillFn=null) {
  const clickAttr=drillFn?`onclick="${drillFn}" style="cursor:pointer" title="Click to view details"`:'';
  return`<div class="kpi-card ${cls}"${clickAttr}><div class="kpi-icon-wrap"><i data-lucide="${icon}"></i></div><div class="kpi-val">${val}</div><div class="kpi-lbl">${label}${drillFn?'<span class="kpi-drill-hint"> ↗</span>':''}</div></div>`;
}

// ── SECTION RENDERERS ─────────────────────────────────────────
const RENDERERS={overview:renderOverview,platform:renderPlatform,owner:renderOwner,status:renderStatus,calls:renderCalls,visits:renderVisits,budget:renderBudget,converted:renderConverted,comparison:renderComparison,'leads-table':renderLeadsTable};
function renderSection(sec){if(!masterCache.length)return;sectionRendered[sec]=true;try{if(RENDERERS[sec])RENDERERS[sec]();lucide.createIcons();}catch(e){console.error('Render error',sec,e);}}
async function loadSection(sec){renderSection(sec);}

// ── DATE / BUCKET HELPERS ─────────────────────────────────────
function parseDate(str) {
  if(!str||typeof str!=='string') return null;
  const s=str.trim();

  // ── FORMAT 1: DD/MM/YYYY h:mm:ss AM/PM  (primary — CRM export format)
  // e.g. "24/05/2026 11:44:20 PM"
  const m0=s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})\s*(AM|PM)$/i);
  if(m0){
    let hr=+m0[4];
    const ampm=m0[7].toUpperCase();
    if(ampm==='AM'&&hr===12) hr=0;
    if(ampm==='PM'&&hr!==12) hr+=12;
    const d=new Date(+m0[3],+m0[2]-1,+m0[1],hr,+m0[5],+m0[6]);
    return isNaN(d)?null:d;
  }

  // ── FORMAT 2: DD/MM/YYYY HH:mm:ss  (24-hour without AM/PM)
  // e.g. "24/05/2026 23:44:20"
  const m0b=s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})$/);
  if(m0b){
    const d=new Date(+m0b[3],+m0b[2]-1,+m0b[1],+m0b[4],+m0b[5],+m0b[6]);
    return isNaN(d)?null:d;
  }

  // ── FORMAT 3: DD/MM/YYYY  (date only, slash)
  // e.g. "24/05/2026"  — must check DD<=31 to avoid treating as US M/D/YYYY
  const m1=s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if(m1){
    const day=+m1[1],mo=+m1[2];
    // If day > 12 it must be DD/MM, never MM/DD
    // If both <=12 we treat as DD/MM (Indian format)
    const d=new Date(+m1[3],mo-1,day);
    return isNaN(d)?null:d;
  }

  // ── FORMAT 4: DD-MM-YYYY  (date only, dash)
  // e.g. "24-05-2026"
  const m2=s.match(/^(\d{1,2})-(\d{1,2})-(\d{4})/);
  if(m2){
    const d=new Date(+m2[3],+m2[2]-1,+m2[1]);
    return isNaN(d)?null:d;
  }

  // ── FORMAT 5: YYYY-MM-DD  (ISO date, possibly with time)
  // e.g. "2026-05-24" or "2026-05-24T11:44:20"
  const m3=s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if(m3){
    const d=new Date(+m3[1],+m3[2]-1,+m3[3]);
    return isNaN(d)?null:d;
  }

  // ── FALLBACK: let browser try it
  const d=new Date(s);
  return isNaN(d)?null:d;
}

function bucketKey(d) {
  if(!d) return null;
  if(granularity==='monthly'){
    // Always use FY-aware key: "Apr '25" format
    return `${d.toLocaleString('en-US',{month:'short'})} '${String(d.getFullYear()).slice(2)}`;
  }
  if(granularity==='weekly'){
    const jan1=new Date(d.getFullYear(),0,1);
    const w=Math.ceil(((d-jan1)/86400000+jan1.getDay()+1)/7);
    return `W${String(w).padStart(2,'0')} '${String(d.getFullYear()).slice(2)}`;
  }
  // daily: "15 Apr '25"
  return `${String(d.getDate()).padStart(2,'0')} ${d.toLocaleString('en-US',{month:'short'})} '${String(d.getFullYear()).slice(2)}`;
}

function bucketDate(k) {
  if(!k) return new Date(0);
  try {
    // "Apr '25" monthly
    const m1=k.match(/^([A-Z][a-z]{2})\s+'(\d{2})$/);
    if(m1){const yr=2000+parseInt(m1[2]);const mo=new Date(`${m1[1]} 1 2000`).getMonth();return new Date(yr,mo,1);}
    // "15 Apr '25" daily
    const m2=k.match(/^(\d{2})\s+([A-Z][a-z]{2})\s+'(\d{2})$/);
    if(m2){const yr=2000+parseInt(m2[3]);const mo=new Date(`${m2[2]} 1 2000`).getMonth();return new Date(yr,mo,parseInt(m2[1]));}
    // "W05 '25" weekly
    const m3=k.match(/^W(\d{2})\s+'(\d{2})$/);
    if(m3){return new Date(2000+parseInt(m3[2]),0,1+(parseInt(m3[1])-1)*7);}
  } catch(_){}
  return new Date(0);
}

function sortBuckets(keys){return[...keys].sort((a,b)=>bucketDate(a)-bucketDate(b));}

function buildTimeSeries(rows, dateCol='Created Date', groupCol=null) {
  const map = {};
  const now  = new Date();
  const minD = new Date('2020-01-01');
  const maxD = new Date(now.getFullYear() + 2, 11, 31); // allow up to 2 years future

  rows.forEach(r => {
    const d = parseDate(r[dateCol]);
    // Skip invalid, too-old, or suspiciously far-future dates
    if (!d || d < minD || d > maxD) return;
    const k = bucketKey(d);
    if (!k) return;
    if (groupCol) {
      const g = r[groupCol] || 'Unknown';
      if (!map[k]) map[k] = {};
      map[k][g] = (map[k][g] || 0) + 1;
    } else {
      map[k] = (map[k] || 0) + 1;
    }
  });
  return map;
}

// ── SCROLLABLE CHART (15 visible buckets, scroll for rest) ────
function mkScrollChart(wrapperId, type, allLabels, datasets, opts={}) {
  const wrap = document.getElementById(wrapperId);
  if (!wrap) return;

  // Destroy previous chart
  const id = 'scroll_' + wrapperId;
  if (chartInstances[id]) { chartInstances[id].destroy(); delete chartInstances[id]; }

  // Clear and rebuild inner structure fresh every time
  wrap.innerHTML = '';
  wrap.style.cssText = 'overflow-x:auto;overflow-y:hidden;width:100%;padding-bottom:6px;position:relative;';

  const CHART_H    = 280;
  const PER_LABEL  = type === 'bar' ? 56 : 44;
  const wrapW      = wrap.offsetWidth || 700;
  const totalW     = Math.max(allLabels.length * PER_LABEL, wrapW);

  const inner = document.createElement('div');
  inner.style.cssText = `width:${totalW}px;min-width:${totalW}px;height:${CHART_H}px;`;
  wrap.appendChild(inner);

  const canvas = document.createElement('canvas');
  canvas.width  = totalW;
  canvas.height = CHART_H;
  canvas.style.cssText = `display:block;width:${totalW}px;height:${CHART_H}px;`;
  inner.appendChild(canvas);

  const isMulti = Array.isArray(datasets) && datasets.length && typeof datasets[0] === 'object' && 'data' in datasets[0];

  // Hide legend for single-series charts; show for multi
  const showLegend = isMulti && datasets.length > 1;

  chartInstances[id] = new Chart(canvas, {
    type,
    data: {
      labels: allLabels,
      datasets: isMulti ? datasets : [{
        data: datasets,
        label: opts.label || 'Value',
        backgroundColor: type === 'line'
          ? 'rgba(37,99,235,.08)'
          : PALETTE.slice(0, allLabels.length),
        borderColor: type === 'line' ? '#2563eb' : undefined,
        borderWidth: type === 'line' ? 2 : 0,
        fill: type === 'line',
        tension: .4,
        pointRadius: type === 'line' ? 3 : 0,
        pointHoverRadius: 6,
        pointBackgroundColor: '#2563eb',
        ...opts.ds
      }]
    },
    options: {
      responsive: false,
      maintainAspectRatio: false,
      animation: { duration: 300, easing: 'easeOutQuart' },
      plugins: {
        legend: {
          display: showLegend,
          position: 'bottom',
          labels: { font: { family: FONT, size: 11 }, padding: 10, usePointStyle: true, boxWidth: 8 }
        },
        datalabels: { display: false },
        tooltip: { bodyFont: { family: FONT, size: 12 }, titleFont: { family: FONT, size: 12, weight: '600' } },
      },
      scales: {
        x: {
          stacked: !!opts.stacked,
          grid: { display: false },
          ticks: { font: { family: FONT, size: 10 }, maxRotation: 45, autoSkip: false }
        },
        y: {
          stacked: !!opts.stacked,
          beginAtZero: true,
          grid: { color: '#f1f5f9' },
          ticks: { font: { family: FONT, size: 10 } }
        }
      }
    }
  });

  // Scroll to rightmost (latest data) after render
  requestAnimationFrame(() => { wrap.scrollLeft = totalW; });
}

// Static chart (pie/doughnut/bar without scroll)
function mkChart(id,type,labels,data,opts={}) {
  if(chartInstances[id])chartInstances[id].destroy();
  const ctx=document.getElementById(id); if(!ctx) return;
  chartInstances[id]=new Chart(ctx,{
    type,
    data:{labels,datasets:[{data,
      backgroundColor:opts.single?(type==='line'?'rgba(37,99,235,.08)':PALETTE[0]):PALETTE.slice(0,Math.max(labels.length,1)),
      borderColor:opts.single?(type==='line'?'#2563eb':PALETTE[0]):undefined,
      borderWidth:type==='line'?2:(type==='bar'?0:1.5),
      fill:type==='line',tension:.4,pointRadius:type==='line'?3:0,pointHoverRadius:5,
      ...opts.ds
    },...(opts.extras||[])]},
    options:{responsive:true,maintainAspectRatio:true,animation:{duration:350,easing:'easeOutQuart'},
      plugins:{
        legend:{position:opts.legendPos||'bottom',labels:{font:{family:FONT,size:11},padding:12,usePointStyle:true}},
        datalabels:opts.dl||{display:false},
        tooltip:{bodyFont:{family:FONT,size:12},titleFont:{family:FONT,size:12,weight:'600'}},
      },
      scales:(type==='bar'||type==='line')?{
        x:{grid:{display:false},ticks:{font:{family:FONT,size:10},maxRotation:45}},
        y:{beginAtZero:true,grid:{color:'#f1f5f9'},ticks:{font:{family:FONT,size:10}}}
      }:{},
      ...opts.extra}
  });
}

// ── UI HELPERS ────────────────────────────────────────────────
function escHtml(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
function fillSel(id,opts,def){const s=document.getElementById(id);if(!s)return;const v=s.value;s.innerHTML=`<option value="">${def}</option>`+opts.map(o=>`<option${o===v?' selected':''}>${escHtml(o)}</option>`).join('');}
function setBadge(id,n){const el=document.getElementById(id);if(el)el.textContent=`${Number(n).toLocaleString()} records`;}
function badge(s){
  const l=(s||'').toLowerCase();
  if(l==='site visit done') return`<span class="badge b-green">${escHtml(s)}</span>`;
  if(l==='site visit schedule') return`<span class="badge b-amber">${escHtml(s)}</span>`;
  if(l==='inactive')  return`<span class="badge b-red">${escHtml(s)}</span>`;
  if(l==='converted') return`<span class="badge b-green">${escHtml(s)}</span>`;
  if(l==='hot')       return`<span class="badge b-red">${escHtml(s)}</span>`;
  if(l==='warm')      return`<span class="badge b-amber">${escHtml(s)}</span>`;
  if(l==='cold')      return`<span class="badge b-grey">${escHtml(s)}</span>`;
  if(l==='active'||l==='new'||l==='call not received') return`<span class="badge b-blue">${escHtml(s)}</span>`;
  return`<span class="badge b-grey">${escHtml(s||'—')}</span>`;
}
function fillTable(id,headers,rows){
  const el=document.getElementById(id); if(!el) return;
  el.innerHTML='';
  const thead=el.createTHead(),hr=thead.insertRow();
  headers.forEach(h=>{const th=document.createElement('th');th.innerHTML=h;hr.appendChild(th);});
  const tb=el.createTBody();
  if(!rows.length){const tr=tb.insertRow(),td=tr.insertCell();td.colSpan=headers.length;td.style.cssText='padding:24px;text-align:center;color:#94a3b8;font-size:13px';td.textContent='No records';return;}
  rows.forEach(row=>{const tr=tb.insertRow();row.forEach(c=>{const td=tr.insertCell();td.innerHTML=c!=null?String(c):'—';});});
}
function renderPagination(containerId,pgId,total){
  const pg=getPg(pgId),pages=Math.ceil(total/pg.size)||1;
  const wrap=document.getElementById(containerId); if(!wrap) return;
  const sizes=[10,20,50,100,500];
  let h=`<div class="pg-wrap"><div class="pg-info">Showing ${Math.min((pg.page-1)*pg.size+1,total).toLocaleString()}–${Math.min(pg.page*pg.size,total).toLocaleString()} of ${total.toLocaleString()}</div>`;
  h+=`<div class="pg-size-wrap">Rows:${sizes.map(s=>`<button class="pg-size-btn${pg.size===s?' active':''}" onclick="setPgSize('${pgId}',${s})">${s}</button>`).join('')}</div>`;
  h+=`<div class="pg-btns"><button onclick="goPg('${pgId}',${pg.page-1})"${pg.page===1?' disabled':''}>&#8249;</button>`;
  getPageRange(pg.page,pages).forEach(p=>{h+=p==='...'?`<button disabled style="border:none;background:none;color:#94a3b8">…</button>`:`<button class="${p===pg.page?'active':''}" onclick="goPg('${pgId}',${p})">${p}</button>`;});
  h+=`<button onclick="goPg('${pgId}',${pg.page+1})"${pg.page===pages?' disabled':''}>&#8250;</button></div></div>`;
  wrap.innerHTML=h;
}
function getPageRange(c,t){if(t<=7)return Array.from({length:t},(_,i)=>i+1);if(c<=4)return[1,2,3,4,5,'...',t];if(c>=t-3)return[1,'...',t-4,t-3,t-2,t-1,t];return[1,'...',c-1,c,c+1,'...',t];}
function goPg(pgId,p){if(p<1)return;getPg(pgId).page=p;const sec=document.querySelector('.section.active')?.id?.replace('section-','');if(sec)renderSection(sec);lucide.createIcons();}
function setPgSize(pgId,s){getPg(pgId).size=s;getPg(pgId).page=1;const sec=document.querySelector('.section.active')?.id?.replace('section-','');if(sec)renderSection(sec);lucide.createIcons();}

// Lead row formatter (reused everywhere)
function leadRow(r){return[`${r['FirstName']||''} ${r['LastName']||''}`.trim()||'—',`<span class="mono">${escHtml(r['Mobile No.']||'—')}</span>`,escHtml(r['Project Name']||'—'),badge(r['Status Name']),escHtml(r['Source Name']||'—'),escHtml(r['Owner Name']||'—'),`<span class="mono">${r['Make Call Count']||0}</span>`,escHtml((r['Created Date']||'').split(' ')[0]||'—')];}
const LEAD_HEADERS=['Name','Mobile','Project','Status','Source','Owner','Calls','Created'];

// ── OVERVIEW ──────────────────────────────────────────────────
function renderOverview(){
  const d=getFiltered();
  setBadge('overviewCount',d.length);
  const siteVisited=d.filter(r=>r['IsSiteVisitDone']==='Yes').length;
  const totalCalls=d.reduce((s,r)=>s+(parseInt(r['Make Call Count'])||0),0);
  const inactive=d.filter(r=>r['Status Name']==='Inactive').length;
  const uniqueOwners=new Set(d.map(r=>r['Owner Name']).filter(Boolean)).size;
  const uniqueSrc=new Set(d.map(r=>r['Source Name']).filter(Boolean)).size;

  document.getElementById('kpiGrid').innerHTML=[
    kpiCard('target',d.length.toLocaleString(),'Total Leads','','drillLeads("all")'),
    kpiCard('phone',totalCalls.toLocaleString(),'Total Calls','green','drillLeads("calls")'),
    kpiCard('map-pin',siteVisited.toLocaleString(),'Site Visits','amber','drillLeads("visited")'),
    kpiCard('users',uniqueOwners,'Active Owners','purple','drillLeads("owners")'),
    kpiCard('radio',uniqueSrc,'Lead Sources','cyan','drillLeads("sources")'),
    kpiCard('x-circle',inactive.toLocaleString(),'Inactive','red','drillLeads("inactive")'),
  ].join('');

  // Timeline with scroll
  const tsMap=buildTimeSeries(d,'Created Date');
  const tsKeys=sortBuckets(Object.keys(tsMap));
  mkScrollChart('timelineChartWrap','line',tsKeys,tsKeys.map(k=>tsMap[k]),{single:true,label:'Leads',ds:{backgroundColor:'rgba(37,99,235,.08)',borderColor:'#2563eb',pointBackgroundColor:'#2563eb',pointRadius:3}});

  const srcMap={};d.forEach(r=>{const s=r['Source Name']||'Unknown';srcMap[s]=(srcMap[s]||0)+1;});
  mkChart('overviewSourceChart','doughnut',Object.keys(srcMap),Object.values(srcMap),{dl:{display:true,formatter:v=>v,color:'#fff',font:{weight:'700',size:11}}});

  const pg=getPg('overviewTable');
  fillTable('overviewTable',LEAD_HEADERS,d.slice((pg.page-1)*pg.size,pg.page*pg.size).map(leadRow));
  renderPagination('overviewPg','overviewTable',d.length);
}

// Overview KPI drilldown
function drillLeads(type){
  const d=getFiltered();
  let rows=[], title='';
  switch(type){
    case 'all':    rows=d; title='All Leads'; break;
    case 'calls':  rows=d.filter(r=>parseInt(r['Make Call Count'])>0); title='Leads with Calls Made'; break;
    case 'visited':rows=d.filter(r=>r['IsSiteVisitDone']==='Yes'); title='Leads with Site Visit Done'; break;
    case 'inactive':rows=d.filter(r=>r['Status Name']==='Inactive'); title='Inactive Leads'; break;
    case 'owners': rows=d; title='Leads by Owner'; break;
    case 'sources':rows=d; title='Leads by Source'; break;
    default: rows=d;
  }
  showKpiDrilldown(title+` (${rows.length.toLocaleString()})`,rows.map(leadRow),LEAD_HEADERS);
}

// ── PLATFORM ──────────────────────────────────────────────────
function renderPlatform(){
  const d=getFiltered();setBadge('platformCount',d.length);
  const srcMap={};d.forEach(r=>{const s=r['Source Name']||'Unknown';srcMap[s]=(srcMap[s]||0)+1;});
  const lbl=Object.keys(srcMap).sort((a,b)=>srcMap[b]-srcMap[a]),val=lbl.map(l=>srcMap[l]);
  mkChart('sourceBarChart','bar',lbl,val,{dl:{display:true,anchor:'end',align:'end',color:'#334155',font:{weight:'700',size:11}}});
  mkChart('sourcePieChart','pie',lbl,val,{dl:{display:true,formatter:v=>v,color:'#fff',font:{weight:'700',size:11}}});
  const tMap=buildTimeSeries(d,'Created Date','Source Name'),tKeys=sortBuckets(Object.keys(tMap));
  const sDS=lbl.map((s,i)=>({label:s,data:tKeys.map(k=>(tMap[k]&&tMap[k][s])||0),backgroundColor:PALETTE[i%PALETTE.length],borderWidth:0}));
  mkScrollChart('sourceTrendWrap','bar',tKeys,sDS,{stacked:true});
  const pg=getPg('sourceTable');
  fillTable('sourceTable',['Source','Total Leads','Share %'],
    lbl.slice((pg.page-1)*pg.size,pg.page*pg.size).map(l=>[escHtml(l),srcMap[l],Math.round(srcMap[l]/d.length*100)+'%']));
  renderPagination('sourcePg','sourceTable',lbl.length);
}

// ── OWNER ─────────────────────────────────────────────────────
function renderOwner(){
  const d=getFiltered();setBadge('ownerCount',d.length);
  const om={};
  d.forEach(r=>{const o=r['Owner Name']||'Unknown';if(!om[o])om[o]={leads:0,calls:0,visits:0,inactive:0,scheduled:0};om[o].leads++;om[o].calls+=parseInt(r['Make Call Count'])||0;if(r['IsSiteVisitDone']==='Yes')om[o].visits++;const st=r['Status Name']||'';if(st==='Inactive')om[o].inactive++;if(st==='Site Visit Schedule')om[o].scheduled++;});
  const lbl=Object.keys(om).sort((a,b)=>om[b].leads-om[a].leads);
  mkChart('ownerBarChart','bar',lbl,lbl.map(l=>om[l].leads),{dl:{display:true,anchor:'end',align:'end',color:'#334155',font:{weight:'700',size:12}}});
  mkChart('ownerPieChart','doughnut',lbl,lbl.map(l=>om[l].leads),{dl:{display:true,formatter:v=>v,color:'#fff',font:{weight:'700',size:12}}});
  const tMap=buildTimeSeries(d,'Created Date','Owner Name'),tKeys=sortBuckets(Object.keys(tMap));
  const oDS=lbl.map((o,i)=>({label:o,data:tKeys.map(k=>(tMap[k]&&tMap[k][o])||0),borderColor:PALETTE[i%PALETTE.length],backgroundColor:'transparent',borderWidth:2,tension:.4,pointRadius:3,fill:false}));
  mkScrollChart('ownerTrendWrap','line',tKeys,oDS,{});
  const pg=getPg('ownerTable');
  fillTable('ownerTable',['Owner','Leads','Calls','Visits','Inactive','Scheduled','Share %'],
    lbl.slice((pg.page-1)*pg.size,pg.page*pg.size).map(l=>[escHtml(l),om[l].leads,om[l].calls,om[l].visits,om[l].inactive,om[l].scheduled,Math.round(om[l].leads/d.length*100)+'%']));
  renderPagination('ownerPg','ownerTable',lbl.length);
}

// ── STATUS ────────────────────────────────────────────────────
function renderStatus(){
  const d=getFiltered();setBadge('statusCount',d.length);
  const sm={};d.forEach(r=>{const s=r['Status Name']||'Unknown';sm[s]=(sm[s]||0)+1;});
  const ordered=[...STATUS_ORDER,...Object.keys(sm).filter(s=>!STATUS_ORDER.includes(s))];
  const lbl=ordered.filter(s=>sm[s]),val=lbl.map(l=>sm[l]),colors=lbl.map(l=>STATUS_COLORS[l]||PALETTE[lbl.indexOf(l)%PALETTE.length]);
  mkChart('statusDoughnutChart','doughnut',lbl,val,{dl:{display:true,formatter:v=>v,color:'#fff',font:{weight:'700',size:11}}});
  if(chartInstances['statusDoughnutChart']){chartInstances['statusDoughnutChart'].data.datasets[0].backgroundColor=colors;chartInstances['statusDoughnutChart'].update();}
  const owners=[...new Set(d.map(r=>r['Owner Name']).filter(Boolean))].sort();
  const byOS={};d.forEach(r=>{const o=r['Owner Name']||'Unknown',s=r['Status Name']||'Unknown';if(!byOS[s])byOS[s]={};byOS[s][o]=(byOS[s][o]||0)+1;});
  const sOwnerDS=STATUS_ORDER.filter(s=>byOS[s]).map(s=>({label:s,data:owners.map(o=>(byOS[s]&&byOS[s][o])||0),backgroundColor:STATUS_COLORS[s]||'#94a3b8',borderWidth:0}));
  mkScrollChart('statusOwnerWrap','bar',owners,sOwnerDS,{stacked:true});
  const tMap=buildTimeSeries(d,'Created Date','Status Name'),tKeys=sortBuckets(Object.keys(tMap));
  const stDS=STATUS_ORDER.filter(s=>Object.values(tMap).some(t=>t[s])).map(s=>({label:s,data:tKeys.map(k=>(tMap[k]&&tMap[k][s])||0),backgroundColor:STATUS_COLORS[s]||'#94a3b8',borderWidth:0}));
  mkScrollChart('statusTrendWrap','bar',tKeys,stDS,{stacked:true});
  const pg=getPg('statusTable');
  fillTable('statusTable',['Status','Count','Share %'],
    lbl.slice((pg.page-1)*pg.size,pg.page*pg.size).map(l=>[badge(l),`<span class="mono">${sm[l]}</span>`,Math.round(sm[l]/d.length*100)+'%']));
  renderPagination('statusPg','statusTable',lbl.length);
}

// ── CALLS ─────────────────────────────────────────────────────
function renderCalls(){
  const d=getFiltered();setBadge('callsCount',d.length);
  const totalCalls=d.reduce((s,r)=>s+(parseInt(r['Make Call Count'])||0),0);
  const touched=d.filter(r=>parseInt(r['Make Call Count'])>0).length;
  const avg=touched?(totalCalls/touched).toFixed(1):0;
  const maxC=Math.max(...d.map(r=>parseInt(r['Make Call Count'])||0),0);
  const maxLeads=d.filter(r=>(parseInt(r['Make Call Count'])||0)===maxC);

  document.getElementById('callKpiGrid').innerHTML=[
    kpiCard('phone-call',totalCalls.toLocaleString(),'Total Calls','','drillCalls("total")'),
    kpiCard('user-check',touched.toLocaleString(),'Contacted','green','drillCalls("touched")'),
    kpiCard('user-x',(d.length-touched).toLocaleString(),'Not Contacted','red','drillCalls("untouched")'),
    kpiCard('bar-chart-2',avg,'Avg Calls / Lead','amber','drillCalls("avg")'),
    kpiCard('trending-up',maxC,'Max Calls on 1 Lead','purple','drillCalls("max")'),
  ].join('');

  const dist={};d.forEach(r=>{const c=parseInt(r['Make Call Count'])||0;dist[c]=(dist[c]||0)+1;});
  const dKeys=Object.keys(dist).sort((a,b)=>+a-+b);
  mkScrollChart('callCountWrap','bar',dKeys.map(k=>`${k} call${k!='1'?'s':''}`),dKeys.map(k=>dist[k]),{single:true,label:'Leads'});

  const outcomes={};
  d.forEach(r=>{const det=(r['Latest 1st Call Details']||'').toLowerCase().trim();if(!det){outcomes['No Call']=(outcomes['No Call']||0)+1;return;}if(det.includes('not interested'))outcomes['Not Interested']=(outcomes['Not Interested']||0)+1;else if(det.includes('cnr')||det.includes('not received'))outcomes['Not Received']=(outcomes['Not Received']||0)+1;else if(det.includes('out of service')||det.includes('switched off'))outcomes['Unreachable']=(outcomes['Unreachable']||0)+1;else if(det.includes('visit')||det.includes('schedule'))outcomes['Visit Planned']=(outcomes['Visit Planned']||0)+1;else outcomes['Connected']=(outcomes['Connected']||0)+1;});
  mkChart('callOutcomeChart','doughnut',Object.keys(outcomes),Object.values(outcomes),{dl:{display:true,formatter:v=>v,color:'#fff',font:{weight:'700',size:12}}});

  const tsMap=buildTimeSeries(d,'Created Date'),tsKeys=sortBuckets(Object.keys(tsMap));
  mkScrollChart('callTrendWrap','line',tsKeys,tsKeys.map(k=>tsMap[k]),{single:true,label:'Leads',ds:{backgroundColor:'rgba(37,99,235,.08)',borderColor:'#2563eb',pointBackgroundColor:'#2563eb',pointRadius:3}});

  const pg=getPg('callTable');
  fillTable('callTable',['Name','Mobile','Owner','# Calls','Call 1 Note','Date 1','Call 2 Note','Date 2','Call 3 Note','Date 3'],
    d.slice((pg.page-1)*pg.size,pg.page*pg.size).map(r=>[
      `${r['FirstName']||''} ${r['LastName']||''}`.trim()||'—',
      `<span class="mono">${escHtml(r['Mobile No.']||'—')}</span>`,
      escHtml(r['Owner Name']||'—'),`<span class="mono">${r['Make Call Count']||0}</span>`,
      `<div class="note-cell">${escHtml(r['Latest 1st Call Details']||'—')}</div>`,
      `<span class="mono" style="font-size:11px">${escHtml((r['Latest 1st Call Date']||'').split(' ')[0]||'—')}</span>`,
      `<div class="note-cell">${escHtml(r['Latest 2nd Call Details']||'—')}</div>`,
      `<span class="mono" style="font-size:11px">${escHtml((r['Latest 2nd Call Date']||'').split(' ')[0]||'—')}</span>`,
      `<div class="note-cell">${escHtml(r['Latest 3rd Call Details']||'—')}</div>`,
      `<span class="mono" style="font-size:11px">${escHtml((r['Latest 3rd Call Date']||'').split(' ')[0]||'—')}</span>`,
    ]));
  renderPagination('callPg','callTable',d.length);
}

function drillCalls(type){
  const d=getFiltered();let rows=[],title='';
  const maxC=Math.max(...d.map(r=>parseInt(r['Make Call Count'])||0),0);
  switch(type){
    case 'total':    rows=d.filter(r=>parseInt(r['Make Call Count'])>0); title='All Leads with Calls'; break;
    case 'touched':  rows=d.filter(r=>parseInt(r['Make Call Count'])>0); title='Contacted Leads'; break;
    case 'untouched':rows=d.filter(r=>!(parseInt(r['Make Call Count'])>0)); title='Not Contacted Leads'; break;
    case 'avg':      rows=d.filter(r=>parseInt(r['Make Call Count'])>0); title='All Contacted Leads (Avg Calls)'; break;
    case 'max':      rows=d.filter(r=>(parseInt(r['Make Call Count'])||0)===maxC); title=`Leads with Max ${maxC} Calls`; break;
  }
  showKpiDrilldown(title+` (${rows.length.toLocaleString()})`,rows.map(leadRow),LEAD_HEADERS);
}

// ── VISITS ────────────────────────────────────────────────────
function renderVisits(){
  const isY2B=activeCompany===Y2B_ID;
  const vr=isY2B?visitsCache:getFiltered().filter(r=>r['IsSiteVisitDone']==='Yes');
  setBadge('visitsCount',vr.length);
  if(!vr.length){const el=document.getElementById('visitKpiGrid');if(el)el.innerHTML='<p style="padding:20px;color:#94a3b8;font-size:13px">No visit data available.</p>';return;}
  if(isY2B){
    const uniqueClients=new Set(vr.map(r=>r['Mobile No.']).filter(Boolean)).size;
    const uniqueStaff=new Set(vr.map(r=>r['Visit Done By']).filter(Boolean)).size;
    const withProject=vr.filter(r=>r['Visited Project']).length;
    const uniqueLocs=new Set(vr.map(r=>r['Location']).filter(Boolean)).size;
    document.getElementById('visitKpiGrid').innerHTML=[
      kpiCard('map-pin',vr.length.toLocaleString(),'Total Visits','green','drillVisits("all")'),
      kpiCard('users',uniqueClients,'Unique Clients','','drillVisits("clients")'),
      kpiCard('user-check',uniqueStaff,'Staff Members','purple','drillVisits("staff")'),
      kpiCard('check-circle',withProject,'Project Known','','drillVisits("withProject")'),
      kpiCard('help-circle',vr.length-withProject,'Project TBD','red','drillVisits("noProject")'),
      kpiCard('compass',uniqueLocs,'Locations','amber','drillVisits("locations")'),
    ].join('');
    const nameMap={};vr.forEach(r=>{const n=r['Visit Done By']||'Unknown';nameMap[n]=(nameMap[n]||0)+1;});
    mkChart('visitStatusChart','doughnut',Object.keys(nameMap),Object.values(nameMap),{dl:{display:true,formatter:v=>v,color:'#fff',font:{weight:'700',size:13}}});
    const tMap=buildTimeSeries(vr,'Date'),tKeys=sortBuckets(Object.keys(tMap));
    mkScrollChart('visitProjectWrap','bar',tKeys,tKeys.map(k=>tMap[k]),{single:true,label:'Visits'});
    const locMap={};vr.forEach(r=>{const l=r['Location']||'Unknown';locMap[l]=(locMap[l]||0)+1;});
    const locLbl=Object.keys(locMap).sort((a,b)=>locMap[b]-locMap[a]).slice(0,20);
    mkScrollChart('visitLocationWrap','bar',locLbl,locLbl.map(l=>locMap[l]),{single:false,label:'Visits'});
    const pg=getPg('visitTable');
    fillTable('visitTable',['Date','Visit Done By','Customer','Mobile','Location','Project'],
      vr.slice((pg.page-1)*pg.size,pg.page*pg.size).map(r=>[escHtml(r['Date']||'—'),escHtml(r['Visit Done By']||'—'),escHtml(r['CustomerName']||'—'),`<span class="mono">${escHtml(r['Mobile No.']||'—')}</span>`,escHtml(r['Location']||'—'),r['Visited Project']?escHtml(r['Visited Project']):'<span style="color:#cbd5e1;font-style:italic">TBD</span>']));
    renderPagination('visitPg','visitTable',vr.length);
  } else {
    const uniqueOwners=new Set(vr.map(r=>r['Owner Name']).filter(Boolean)).size;
    document.getElementById('visitKpiGrid').innerHTML=[
      kpiCard('map-pin',vr.length.toLocaleString(),'Site Visits Done','green'),
      kpiCard('users',uniqueOwners,'Owners','purple'),
    ].join('');
    const pg=getPg('visitTable');
    fillTable('visitTable',['Name','Mobile','Project','Owner','Visit Date','Visit Count'],
      vr.slice((pg.page-1)*pg.size,pg.page*pg.size).map(r=>[`${r['FirstName']||''} ${r['LastName']||''}`.trim()||'—',`<span class="mono">${escHtml(r['Mobile No.']||'—')}</span>`,escHtml(r['Project Name']||'—'),escHtml(r['Owner Name']||'—'),escHtml(r['Latest Site Visit Done Date']||'—'),r['Site Visit Done Count']||0]));
    renderPagination('visitPg','visitTable',vr.length);
  }
}
function drillVisits(type){
  if(activeCompany!==Y2B_ID) return;
  const vr=visitsCache;let rows=[],title='';
  switch(type){
    case 'all':rows=vr;title='All Site Visits';break;
    case 'clients':rows=vr;title='All Visits (by Client)';break;
    case 'staff':rows=vr;title='All Visits (by Staff)';break;
    case 'withProject':rows=vr.filter(r=>r['Visited Project']);title='Visits with Project Identified';break;
    case 'noProject':rows=vr.filter(r=>!r['Visited Project']);title='Visits — Project TBD';break;
    case 'locations':rows=vr;title='All Visits by Location';break;
  }
  showKpiDrilldown(title,rows.map(r=>[escHtml(r['Date']||'—'),escHtml(r['Visit Done By']||'—'),escHtml(r['CustomerName']||'—'),`<span class="mono">${escHtml(r['Mobile No.']||'—')}</span>`,escHtml(r['Location']||'—'),r['Visited Project']?escHtml(r['Visited Project']):'—']),['Date','Staff','Customer','Mobile','Location','Project']);
}

// ── BUDGET ────────────────────────────────────────────────────
function renderBudget(){
  const d=getFiltered();setBadge('budgetCount',d.length);
  const propMap={},bhkMap={},projMap={};
  d.forEach(r=>{const p=r['Property']||'Unknown';propMap[p]=(propMap[p]||0)+1;const b=r['Property Type']||'Unknown';bhkMap[b]=(bhkMap[b]||0)+1;const j=r['Project Name']||'Unknown';projMap[j]=(projMap[j]||0)+1;});
  mkChart('propTypeChart','doughnut',Object.keys(propMap),Object.values(propMap),{dl:{display:true,formatter:v=>v,color:'#fff',font:{weight:'700',size:13}}});
  mkChart('bhkChart','pie',Object.keys(bhkMap),Object.values(bhkMap),{dl:{display:true,formatter:v=>v,color:'#fff',font:{weight:'700',size:12}}});
  const pLbl=Object.keys(projMap).sort((a,b)=>projMap[b]-projMap[a]);
  mkScrollChart('projectChartWrap','bar',pLbl,pLbl.map(l=>projMap[l]),{single:false,label:'Leads'});
  const pg=getPg('budgetTable');
  fillTable('budgetTable',['Name','Mobile','Project','BHK','Type','Location','Status'],
    d.slice((pg.page-1)*pg.size,pg.page*pg.size).map(r=>[`${r['FirstName']||''} ${r['LastName']||''}`.trim()||'—',`<span class="mono">${escHtml(r['Mobile No.']||'—')}</span>`,escHtml(r['Project Name']||'—'),escHtml(r['Property Type']||'—'),escHtml(r['Property']||'—'),escHtml(r['Property Location']||'—'),badge(r['Status Name'])]));
  renderPagination('budgetPg','budgetTable',d.length);
}

// ── CONVERTED ─────────────────────────────────────────────────
function renderConverted(){
  const rows=getCompanyConverted();
  setBadge('convertedCount',rows.length);
  if(!rows.length){const el=document.getElementById('convertedKpiGrid');if(el)el.innerHTML='<p style="padding:20px;color:#94a3b8;font-size:13px">No conversion data yet.</p>';return;}
  const isY2B=activeCompany===Y2B_ID;
  const totalVisits=rows.reduce((s,r)=>s+(parseInt(r['Site Visit Done Count'])||0),0);
  const totalCalls=rows.reduce((s,r)=>s+(parseInt(r['Make Call Count'])||0),0);
  const uniqueOwners=new Set(rows.map(r=>r['Owner Name']).filter(Boolean)).size;
  const uniqueSrc=new Set(rows.map(r=>r['Source Name']).filter(Boolean)).size;
  document.getElementById('convertedKpiGrid').innerHTML=[
    kpiCard('check-circle',rows.length.toLocaleString(),'Total Converted','green','drillConverted("all")'),
    kpiCard('users',uniqueOwners,'Unique Owners','','drillConverted("owners")'),
    kpiCard('radio',uniqueSrc,'Lead Sources','cyan','drillConverted("sources")'),
    kpiCard('map-pin',totalVisits.toLocaleString(),'Total Visits','amber','drillConverted("visits")'),
    kpiCard('phone',totalCalls.toLocaleString(),'Total Calls','purple','drillConverted("calls")'),
  ].join('');
  const ownerMap={},srcMap={};
  rows.forEach(r=>{const o=r['Owner Name']||'Unknown';ownerMap[o]=(ownerMap[o]||0)+1;const s=r['Source Name']||'Unknown';srcMap[s]=(srcMap[s]||0)+1;});
  const oLbl=Object.keys(ownerMap).sort((a,b)=>ownerMap[b]-ownerMap[a]);
  mkChart('convOwnerChart','bar',oLbl,oLbl.map(l=>ownerMap[l]),{dl:{display:true,anchor:'end',align:'end',color:'#334155',font:{weight:'700',size:12}}});
  mkChart('convOwnerPie','doughnut',oLbl,oLbl.map(l=>ownerMap[l]),{dl:{display:true,formatter:v=>v,color:'#fff',font:{weight:'700',size:12}}});
  mkChart('convSourceBar','bar',Object.keys(srcMap),Object.values(srcMap),{dl:{display:true,anchor:'end',align:'end',color:'#334155',font:{weight:'700',size:12}}});
  const monthCol=isY2B?'Converted Month':'Status Name';
  const monthMap={};rows.forEach(r=>{const m=r[monthCol]||'Unknown';monthMap[m]=(monthMap[m]||0)+1;});
  const mKeys=Object.keys(monthMap).sort((a,b)=>{const ai=FY_MONTHS.findIndex(m=>a.includes(m)),bi=FY_MONTHS.findIndex(m=>b.includes(m));return ai!==bi?ai-bi:a.localeCompare(b);});
  mkScrollChart('convTrendWrap','line',mKeys,mKeys.map(k=>monthMap[k]),{single:true,label:'Conversions',ds:{backgroundColor:'rgba(5,150,105,.08)',borderColor:'#059669',pointBackgroundColor:'#059669',pointRadius:3}});
  const pg=getPg('convTable');
  const nameCol=isY2B?'CustomerName':null;
  fillTable('convTable',['Customer','Mobile','Owner','Source','Converted Date','Month','Visits','Calls'],
    rows.slice((pg.page-1)*pg.size,pg.page*pg.size).map(r=>[
      escHtml(nameCol?r[nameCol]||'—':`${r['FirstName']||''} ${r['LastName']||''}`.trim()||'—'),
      `<span class="mono">${escHtml(r['Mobile No.']||'—')}</span>`,
      escHtml(r['Owner Name']||'—'),escHtml(r['Source Name']||'—'),
      escHtml((isY2B?r['Converted Date']:r['Created Date'])||'—'),
      escHtml((isY2B?r['Converted Month']:'—')||'—'),
      r['Site Visit Done Count']||0,r['Make Call Count']||0
    ]));
  renderPagination('convPg','convTable',rows.length);
}
function drillConverted(type){
  const rows=getCompanyConverted();let filtered=[],title='';
  switch(type){
    case 'all':     filtered=rows;title='All Conversions';break;
    case 'owners':  filtered=rows;title='Conversions by Owner';break;
    case 'sources': filtered=rows;title='Conversions by Source';break;
    case 'visits':  filtered=rows.filter(r=>parseInt(r['Site Visit Done Count'])>0);title='Converted with Site Visits';break;
    case 'calls':   filtered=rows.filter(r=>parseInt(r['Make Call Count'])>0);title='Converted with Calls';break;
  }
  const isY2B=activeCompany===Y2B_ID;
  showKpiDrilldown(title+` (${filtered.length})`,filtered.map(r=>[escHtml(isY2B?r['CustomerName']||'—':`${r['FirstName']||''} ${r['LastName']||''}`.trim()||'—'),`<span class="mono">${escHtml(r['Mobile No.']||'—')}</span>`,escHtml(r['Owner Name']||'—'),escHtml(r['Source Name']||'—'),escHtml((isY2B?r['Converted Date']:r['Created Date'])||'—'),r['Site Visit Done Count']||0,r['Make Call Count']||0]),['Customer','Mobile','Owner','Source','Date','Visits','Calls']);
}

// ── COMPARISON ────────────────────────────────────────────────
function buildCompCheckboxes(){compSelected=new Set(allOwners);const wrap=document.getElementById('compCheckboxes');if(!wrap)return;wrap.innerHTML=allOwners.map(o=>`<label class="comp-check-item checked" data-owner="${escHtml(o)}" onclick="toggleComp(this)"><span class="check-dot"></span>${escHtml(o)}</label>`).join('');}
function toggleComp(el){const o=el.dataset.owner;if(compSelected.has(o)){compSelected.delete(o);el.classList.remove('checked');}else{compSelected.add(o);el.classList.add('checked');}renderSection('comparison');}
function renderComparison(){
  const metric=document.getElementById('compMetric')?.value||'leads';
  const d=getFiltered(),owners=[...compSelected];if(!owners.length)return;
  const fn={leads:s=>s.length,calls:s=>s.reduce((t,r)=>t+(parseInt(r['Make Call Count'])||0),0),visits:s=>s.filter(r=>r['IsSiteVisitDone']==='Yes').length,inactive:s=>s.filter(r=>r['Status Name']==='Inactive').length,scheduled:s=>s.filter(r=>r['Status Name']==='Site Visit Schedule').length}[metric];
  const vals=owners.map(o=>fn(d.filter(r=>r['Owner Name']===o))),maxVal=Math.max(...vals,0);
  document.getElementById('compScorecard').innerHTML=owners.map((o,i)=>`<div class="comp-score-card" style="border-left-color:${PALETTE[i%PALETTE.length]}"><div class="cs-name">${escHtml(o)}</div><div class="cs-val">${vals[i]}</div><div class="cs-sub">${metric}</div></div>`).join('');
  if(chartInstances['compBarChart'])chartInstances['compBarChart'].destroy();
  const ctx1=document.getElementById('compBarChart');
  if(ctx1)chartInstances['compBarChart']=new Chart(ctx1,{type:'bar',data:{labels:owners,datasets:[{label:metric,data:vals,backgroundColor:owners.map((_,i)=>PALETTE[i%PALETTE.length]),borderWidth:0}]},options:{responsive:true,maintainAspectRatio:true,animation:{duration:300},plugins:{legend:{display:false},datalabels:{display:true,anchor:'end',align:'end',color:'#334155',font:{weight:'700',size:13,family:FONT}}},scales:{x:{grid:{display:false},ticks:{font:{family:FONT,size:11}}},y:{beginAtZero:true,grid:{color:'#f1f5f9'}}}}});
  mkChart('compPieChart','doughnut',owners,vals,{dl:{display:true,formatter:v=>v,color:'#fff',font:{weight:'700',size:12}}});
  const tMap=buildTimeSeries(d.filter(r=>owners.includes(r['Owner Name'])),'Created Date','Owner Name'),tKeys=sortBuckets(Object.keys(tMap));
  const tDS=owners.map((o,i)=>({label:o,data:tKeys.map(k=>(tMap[k]&&tMap[k][o])||0),borderColor:PALETTE[i%PALETTE.length],backgroundColor:'transparent',borderWidth:2,tension:.4,pointRadius:3,fill:false}));
  mkScrollChart('compTrendWrap','line',tKeys,tDS,{});
  fillTable('compTable',['Employee','Leads','Calls','Visits','Inactive','Scheduled','vs Top'],
    owners.map((o,i)=>{const sub=d.filter(r=>r['Owner Name']===o);return[escHtml(o),sub.length,sub.reduce((s,r)=>s+(parseInt(r['Make Call Count'])||0),0),sub.filter(r=>r['IsSiteVisitDone']==='Yes').length,sub.filter(r=>r['Status Name']==='Inactive').length,sub.filter(r=>r['Status Name']==='Site Visit Schedule').length,vals[i]===maxVal&&maxVal>0?'<span class="badge b-green">Top</span>':`<span class="badge b-grey">${maxVal?Math.round(vals[i]/maxVal*100):0}%</span>`];}));
}

// ── ALL LEADS ─────────────────────────────────────────────────
function renderLeadsTable(){
  const search=(document.getElementById('tableSearch')?.value||'').toLowerCase().trim();
  const d=getFiltered().filter(r=>{if(!search)return true;return(`${r['FirstName']}${r['LastName']}${r['Mobile No.']}${r['Email Id']}${r['Project Name']}${r['Status Name']}${r['Source Name']}${r['Owner Name']}`).toLowerCase().includes(search);});
  setBadge('allLeadsCount',d.length);
  const pg=getPg('allLeads');
  fillTable('allLeadsTable',['Name','Mobile','Email','Project','BHK','Location','Status','Source','Owner','Calls','Visited','Created'],
    d.slice((pg.page-1)*pg.size,pg.page*pg.size).map(r=>[
      `${r['FirstName']||''} ${r['LastName']||''}`.trim()||'—',
      `<span class="mono">${escHtml(r['Mobile No.']||'—')}</span>`,
      r['Email Id']?`<span style="font-size:11px">${escHtml(r['Email Id'])}</span>`:'—',
      escHtml(r['Project Name']||'—'),escHtml(r['Property Type']||'—'),
      escHtml(r['Property Location']||'—'),badge(r['Status Name']),
      escHtml(r['Source Name']||'—'),escHtml(r['Owner Name']||'—'),
      `<span class="mono">${r['Make Call Count']||0}</span>`,
      r['IsSiteVisitDone']==='Yes'?'<span class="badge b-green">Yes</span>':'<span class="badge b-grey">No</span>',
      `<span class="mono" style="font-size:11px">${escHtml((r['Created Date']||'').split(' ')[0]||'—')}</span>`,
    ]));
  renderPagination('pagination','allLeads',d.length);
}
function debouncedLeadsRender(){clearTimeout(_searchTimer);_searchTimer=setTimeout(()=>{resetPg('allLeads');renderLeadsTable();lucide.createIcons();},200);}

// ── UI STATES ─────────────────────────────────────────────────
function showLoading(){document.getElementById('loadingScreen').style.display='flex';document.getElementById('errorScreen').style.display='none';document.getElementById('dashboard').style.display='none';}
function showDashboard(){document.getElementById('loadingScreen').style.display='none';document.getElementById('errorScreen').style.display='none';const db=document.getElementById('dashboard');db.style.opacity='0';db.style.display='block';requestAnimationFrame(()=>{db.style.transition='opacity .3s ease';db.style.opacity='1';});lucide.createIcons();}
function showError(msg){document.getElementById('loadingScreen').style.display='none';document.getElementById('errorScreen').style.display='flex';document.getElementById('dashboard').style.display='none';const el=document.getElementById('errorMsg');if(el){el.style.whiteSpace='pre-wrap';el.style.maxWidth='520px';el.style.textAlign='left';el.textContent=msg;}lucide.createIcons();}
