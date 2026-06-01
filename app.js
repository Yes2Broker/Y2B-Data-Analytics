/* ================================================================
   YES2BROKER — app.js  v8
   Multi-select filters | URL state | Card drill-down | Lifecycle
   Revisit metric | Closure/Visit rates | Paid Data card | Totals
   ================================================================ */

// ── CONFIG ────────────────────────────────────────────────────
const SUPA_URL = 'https://nrbgwhltmvrnwfxhkdqu.supabase.co';
const SUPA_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5yYmd3aGx0bXZybndmeGhrZHF1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg1MDA5OTksImV4cCI6MjA5NDA3Njk5OX0.0bPowEtGvmFpoKoLm2UblsuzsSpq1VjPu-mhGxNrv1c';
const HEADERS  = { 'apikey': SUPA_KEY, 'Authorization': `Bearer ${SUPA_KEY}`, 'Accept': 'application/json' };

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

// ── STATE ─────────────────────────────────────────────────────
let masterCache    = [];
let visitsCache    = [];
let convertedCache = [];
let companies      = [];
let activeCompany  = Y2B_ID;
let chartInstances = {};
let granularity    = 'monthly';
let compSelected   = new Set();
let allOwners=[], allSources=[], allStatuses=[], allProjects=[];

// Multi-select filter state
let fOwners  = new Set(); // empty = all
let fSources = new Set();
let fStatuses= new Set();
let fFrom='', fTo='';

// Table drill filter (set when KPI card clicked)
let drillFilter = null; // { field, value } or null
let activeDrillSection = null;

let _searchTimer = null;
const pgState = {};
const sectionRendered = {};

function getPg(id)   { if(!pgState[id]) pgState[id]={page:1,size:10}; return pgState[id]; }
function resetPg(id) { getPg(id).page=1; }
function invalidate(){ Object.keys(sectionRendered).forEach(k=>delete sectionRendered[k]); }

// ── NORMALISATION ─────────────────────────────────────────────
function normaliseValue(v){ return v?v.trim().replace(/\s+/g,' '):''; }
function titleCase(s){ return s.replace(/\w\S*/g,w=>w.charAt(0).toUpperCase()+w.slice(1).toLowerCase()); }
const CANONICAL = {
  'inactive':'Inactive','new':'New','call not received':'Call Not Received','cnr':'Call Not Received',
  'active':'Active','site visit schedule':'Site Visit Schedule','site visit scheduled':'Site Visit Schedule',
  'site visit done':'Site Visit Done','cold':'Cold','warm':'Warm','hot':'Hot','converted':'Converted',
  '99acres':'99 Acres','99 acres':'99 Acres','magicbricks':'Magicbricks','magic bricks':'Magicbricks',
  'housing':'Housing','housing.com':'Housing','walk in':'Walk In','walkin':'Walk In',
  'facebook':'Facebook/Digital Marketing','facebook/digital marketing':'Facebook/Digital Marketing',
  'paid data':'Paid Data','paid':'Paid Data','channel partner':'Channel Partner',
  'just dial':'Just Dial','justdial':'Just Dial','sulekha':'Sulekha',
  'india property':'India Property','99 acres':'99 Acres',
};
function canon(v){
  if(!v) return '';
  const t=normaliseValue(v);
  const l=t.toLowerCase();
  return CANONICAL[t]||CANONICAL[l]||titleCase(t);
}
function callCount(r){
  const c=parseInt(r['Make Call Count']);
  return isNaN(c)||c===0?1:c; // null/0 defaults to 1 for display
}
function normaliseRow(r){
  const o={...r};
  if(o['Status Name']) o['Status Name']=canon(o['Status Name']);
  if(o['Source Name']) o['Source Name']=canon(o['Source Name']);
  if(o['Owner Name'])  o['Owner Name'] =normaliseValue(o['Owner Name']);
  if(o['Project Name'])o['Project Name']=normaliseValue(o['Project Name']);
  return o;
}

// ── SUPABASE ──────────────────────────────────────────────────
async function sbFetch(table,params=''){
  const ctrl=new AbortController();
  const t=setTimeout(()=>ctrl.abort(),20000);
  try{
    const res=await fetch(`${SUPA_URL}/rest/v1/${table}?${params}`,{headers:HEADERS,signal:ctrl.signal});
    clearTimeout(t);
    if(!res.ok){let b='';try{b=await res.text();}catch(_){}throw new Error(`HTTP ${res.status}: ${b||res.statusText}`);}
    return res.json();
  }catch(e){clearTimeout(t);if(e.name==='AbortError')throw new Error(`Timeout on ${table}`);throw e;}
}
async function sbPost(table,body){
  const res=await fetch(`${SUPA_URL}/rest/v1/${table}`,{method:'POST',headers:{...HEADERS,'Content-Type':'application/json','Prefer':'return=representation'},body:JSON.stringify(body)});
  if(!res.ok){let b='';try{b=await res.text();}catch(_){}throw new Error(`[${res.status}] ${b}`);}
  return res.json();
}
async function sbDelete(table,filter){
  const res=await fetch(`${SUPA_URL}/rest/v1/${table}?${filter}`,{method:'DELETE',headers:HEADERS});
  if(!res.ok){let b='';try{b=await res.text();}catch(_){}throw new Error(`[${res.status}] ${b}`);}
  return true;
}
async function sbFetchAll(table,select='*',filter=''){
  const PAGE=1000;let all=[],offset=0;
  while(true){
    const parts=[`select=${select}`,`limit=${PAGE}`,`offset=${offset}`];
    if(filter)parts.push(filter);
    const batch=await sbFetch(table,parts.join('&'));
    if(!Array.isArray(batch))throw new Error(`Bad response from ${table}`);
    all=all.concat(batch);
    if(batch.length<PAGE)break;
    offset+=PAGE;
  }
  return all;
}

// ── BOOT ──────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded',()=>{
  Chart.register(ChartDataLabels);
  setupNav();
  loadFromURL();
  loadAll();
});

// ── NAV ───────────────────────────────────────────────────────
function setupNav(){
  document.querySelectorAll('.nav-item').forEach(el=>{
    el.addEventListener('click',e=>{
      e.preventDefault();
      switchSection(el.dataset.section);
      if(window.innerWidth<=900)closeSidebar();
    });
  });
}
const TITLES={overview:'Overview',platform:'Platform & Source',owner:'Owner-wise Leads',
  status:'Lead Status',calls:'Call Analytics',visits:'Site Visits',budget:'Budget & Property',
  converted:'Converted Leads',comparison:'Employee Comparison',lifecycle:'Lead Lifecycle',
  'leads-table':'All Leads'};

function switchSection(sec){
  document.querySelectorAll('.nav-item').forEach(n=>n.classList.toggle('active',n.dataset.section===sec));
  document.querySelectorAll('.section').forEach(s=>s.classList.remove('active'));
  const el=document.getElementById(`section-${sec}`);
  if(el)el.classList.add('active');
  document.getElementById('pageTitle').textContent=TITLES[sec]||sec;
  window.scrollTo({top:0,behavior:'smooth'});
  pushURL(sec);
  if(!sectionRendered[sec])renderSection(sec);
}
function toggleSidebar(){document.getElementById('sidebar').classList.toggle('open');document.getElementById('sidebarOverlay').classList.toggle('show');}
function closeSidebar(){document.getElementById('sidebar').classList.remove('open');document.getElementById('sidebarOverlay').classList.remove('show');}
function setGranularity(g,btn){granularity=g;document.querySelectorAll('.tg').forEach(b=>b.classList.toggle('active',b===btn));invalidate();const sec=document.querySelector('.section.active')?.id?.replace('section-','');if(sec)renderSection(sec);}

// ── URL STATE ─────────────────────────────────────────────────
function pushURL(sec){
  const p=new URLSearchParams(window.location.search);
  p.set('s',sec);
  if(fFrom)p.set('from',fFrom);else p.delete('from');
  if(fTo)p.set('to',fTo);else p.delete('to');
  if(fOwners.size)p.set('owners',[...fOwners].join(','));else p.delete('owners');
  if(fSources.size)p.set('sources',[...fSources].join(','));else p.delete('sources');
  if(fStatuses.size)p.set('statuses',[...fStatuses].join(','));else p.delete('statuses');
  history.replaceState(null,'',`?${p.toString()}`);
}
function loadFromURL(){
  const p=new URLSearchParams(window.location.search);
  if(p.get('from'))fFrom=p.get('from');
  if(p.get('to'))fTo=p.get('to');
  if(p.get('owners'))p.get('owners').split(',').forEach(v=>fOwners.add(v));
  if(p.get('sources'))p.get('sources').split(',').forEach(v=>fSources.add(v));
  if(p.get('statuses'))p.get('statuses').split(',').forEach(v=>fStatuses.add(v));
}

// ── MULTI-SELECT FILTER DROPDOWNS ────────────────────────────
function buildFilterDropdowns(){
  buildMultiSelect('filterOwnerWrap',  allOwners,   fOwners,   'Owners',   ()=>applyFilters());
  buildMultiSelect('filterSourceWrap', allSources,  fSources,  'Sources',  ()=>applyFilters());
  buildMultiSelect('filterStatusWrap', allStatuses, fStatuses, 'Statuses', ()=>applyFilters());
  // Date inputs
  document.getElementById('filterFrom').value=fFrom;
  document.getElementById('filterTo').value=fTo;
}

function buildMultiSelect(wrapperId, options, selectedSet, label, onChange){
  const wrap=document.getElementById(wrapperId); if(!wrap) return;
  const activeCount=selectedSet.size;
  const btnLabel=activeCount>0?`${label} (${activeCount})`:label;
  wrap.innerHTML=`
    <div class="ms-wrap">
      <button class="ms-btn${activeCount>0?' ms-active':''}" onclick="toggleMsDropdown('${wrapperId}')">
        ${escHtml(btnLabel)} <i data-lucide="chevron-down" style="width:11px;height:11px;margin-left:4px"></i>
      </button>
      <div class="ms-dropdown" id="ms_${wrapperId}">
        <div class="ms-search-wrap">
          <input type="text" placeholder="Search…" oninput="filterMsOptions('${wrapperId}',this.value)" class="ms-search"/>
        </div>
        <div class="ms-options" id="mso_${wrapperId}">
          ${renderMsOptions(options, selectedSet, wrapperId, onChange)}
        </div>
        <div class="ms-footer">
          <button class="ms-clear" onclick="clearMsFilter('${wrapperId}','${label}')">Clear</button>
          <button class="ms-apply" onclick="closeMsDropdown('${wrapperId}');(${onChange})()">Apply</button>
        </div>
      </div>
    </div>`;
  lucide.createIcons();
}

function renderMsOptions(options, selectedSet, wrapperId, onChange, filter=''){
  const filtered=options.filter(o=>!filter||o.toLowerCase().includes(filter.toLowerCase()));
  const allSelected=selectedSet.size===0||options.every(o=>selectedSet.has(o));
  let html=`<label class="ms-opt${allSelected?' ms-checked':''}" onclick="toggleMsAll('${wrapperId}')">
    <span class="ms-chk">${allSelected?'✓':''}</span><span>Select All</span>
  </label>`;
  filtered.forEach(o=>{
    const checked=selectedSet.size===0||selectedSet.has(o);
    html+=`<label class="ms-opt${checked?' ms-checked':''}" onclick="toggleMsOption('${wrapperId}','${escHtml(o)}')">
      <span class="ms-chk">${checked?'✓':''}</span><span>${escHtml(o)}</span>
    </label>`;
  });
  return html;
}

function toggleMsDropdown(wrapperId){
  const d=document.getElementById(`ms_${wrapperId}`);
  document.querySelectorAll('.ms-dropdown.open').forEach(el=>{if(el.id!==`ms_${wrapperId}`)el.classList.remove('open');});
  d.classList.toggle('open');
}
function closeMsDropdown(wrapperId){ document.getElementById(`ms_${wrapperId}`)?.classList.remove('open'); }
document.addEventListener('click',e=>{if(!e.target.closest('.ms-wrap'))document.querySelectorAll('.ms-dropdown.open').forEach(el=>el.classList.remove('open'));});

function getMsState(wrapperId){
  if(wrapperId.includes('Owner'))  return{set:fOwners,  all:allOwners};
  if(wrapperId.includes('Source')) return{set:fSources, all:allSources};
  if(wrapperId.includes('Status')) return{set:fStatuses,all:allStatuses};
  return{set:new Set(),all:[]};
}
function getLabelForWrapper(wrapperId){ return wrapperId.includes('Owner')?'Owners':wrapperId.includes('Source')?'Sources':'Statuses'; }
function getOnChangeForWrapper(wrapperId){ return '()=>applyFilters()'; }

function toggleMsAll(wrapperId){
  const{set,all}=getMsState(wrapperId);
  if(set.size===0||set.size===all.length)set.clear();
  else{set.clear();}
  refreshMsDropdown(wrapperId);
}
function toggleMsOption(wrapperId,val){
  const{set,all}=getMsState(wrapperId);
  if(set.size===0){all.forEach(o=>set.add(o));} // was "all selected" → now explicit
  if(set.has(val))set.delete(val);else set.add(val);
  if(set.size===all.length)set.clear(); // back to all = empty set
  refreshMsDropdown(wrapperId);
}
function refreshMsDropdown(wrapperId){
  const{set,all}=getMsState(wrapperId);
  const search=document.querySelector(`#ms_${wrapperId} .ms-search`)?.value||'';
  const optContainer=document.getElementById(`mso_${wrapperId}`);
  if(optContainer)optContainer.innerHTML=renderMsOptions(all,set,wrapperId,'',search);
  // Update button label
  const btn=document.querySelector(`#${wrapperId} .ms-btn`);
  const lbl=getLabelForWrapper(wrapperId);
  if(btn){btn.textContent=set.size>0?`${lbl} (${set.size})`:lbl;btn.classList.toggle('ms-active',set.size>0);}
}
function filterMsOptions(wrapperId,search){
  const{set,all}=getMsState(wrapperId);
  const optContainer=document.getElementById(`mso_${wrapperId}`);
  if(optContainer)optContainer.innerHTML=renderMsOptions(all,set,wrapperId,'',search);
}
function clearMsFilter(wrapperId){
  const{set}=getMsState(wrapperId);set.clear();
  refreshMsDropdown(wrapperId);
}

function applyFilters(){
  fFrom=document.getElementById('filterFrom')?.value||'';
  fTo  =document.getElementById('filterTo')?.value||'';
  drillFilter=null; activeDrillSection=null;
  invalidate();
  const sec=document.querySelector('.section.active')?.id?.replace('section-','');
  pushURL(sec||'overview');
  if(sec)renderSection(sec);
}
function clearFilters(){
  fOwners.clear();fSources.clear();fStatuses.clear();
  fFrom='';fTo='';
  drillFilter=null;activeDrillSection=null;
  document.getElementById('filterFrom').value='';
  document.getElementById('filterTo').value='';
  buildFilterDropdowns();
  invalidate();
  const sec=document.querySelector('.section.active')?.id?.replace('section-','');
  pushURL(sec||'overview');
  if(sec)renderSection(sec);
}

// ── DATA ACCESS ───────────────────────────────────────────────
function getCompanyLeads(){
  if(activeCompany===Y2B_ID){
    const claimed=new Set(companies.flatMap(c=>c.projects));
    return masterCache.filter(r=>!claimed.has(r['Project Name']));
  }
  const co=companies.find(c=>String(c.id)===String(activeCompany));
  if(!co)return[];
  const ps=new Set(co.projects);
  return masterCache.filter(r=>ps.has(r['Project Name']));
}
function getCompanyConverted(){
  if(activeCompany===Y2B_ID)return convertedCache;
  const owners=new Set(getCompanyLeads().map(r=>r['Owner Name']).filter(Boolean));
  return convertedCache.filter(r=>owners.has(r['Owner Name']));
}
function getFiltered(){
  return getCompanyLeads().filter(r=>{
    if(fOwners.size  && !fOwners.has(r['Owner Name']))  return false;
    if(fSources.size && !fSources.has(r['Source Name']))return false;
    if(fStatuses.size&& !fStatuses.has(r['Status Name']))return false;
    if(fFrom||fTo){const d=parseDate(r['Created Date']);if(!d)return false;if(fFrom&&d<new Date(fFrom))return false;if(fTo&&d>new Date(fTo+'T23:59:59'))return false;}
    return true;
  });
}

// ── LOAD ──────────────────────────────────────────────────────
async function loadAll(){
  showLoading();
  document.getElementById('refreshBtn')?.classList.add('refreshing');
  try{
    updateLoadText('Connecting…');
    const test=await sbFetch('master_data','select=id&limit=1');
    if(!Array.isArray(test))throw new Error('Unexpected response — check API key');
    updateLoadText('Loading leads…');
    masterCache=(await sbFetchAll('master_data','*','')).map(normaliseRow);
    updateLoadText(`${masterCache.length.toLocaleString()} leads — loading visits…`);
    visitsCache   =await sbFetchAll('site_visit','*','').catch(e=>{console.warn(e);return[];});
    convertedCache=(await sbFetchAll('convertion','*','').catch(e=>{console.warn(e);return[];})).map(normaliseRow);
    companies     =await loadCompanies();
    allProjects =[...new Set(masterCache.map(r=>r['Project Name']).filter(Boolean))].sort();
    allOwners   =[...new Set(masterCache.map(r=>r['Owner Name']).filter(Boolean))].sort();
    allSources  =[...new Set(masterCache.map(r=>r['Source Name']).filter(Boolean))].sort();
    allStatuses =[...new Set(masterCache.map(r=>r['Status Name']).filter(Boolean))].sort();
    buildCompanySwitcher();updateCompanyBadge();buildFilterDropdowns();buildCompCheckboxes();
    showDashboard();
    const urlSec=new URLSearchParams(window.location.search).get('s')||'overview';
    switchSection(urlSec);
    document.getElementById('lastUpdated').textContent='Updated '+new Date().toLocaleTimeString()+' · '+masterCache.length.toLocaleString()+' leads';
  }catch(err){showError(err.message);console.error(err);}
  finally{document.getElementById('refreshBtn')?.classList.remove('refreshing');}
}
async function loadData(){masterCache=[];visitsCache=[];convertedCache=[];companies=[];invalidate();await loadAll();}
function updateLoadText(m){const el=document.querySelector('.load-text');if(el)el.textContent=m;}

// ── COMPANY CRUD ──────────────────────────────────────────────
async function loadCompanies(){
  try{
    const[cos,projs]=await Promise.all([sbFetch('companies','select=*&order=created_at'),sbFetch('company_projects','select=*')]);
    return cos.map(c=>({...c,projects:projs.filter(p=>p.company_id===c.id).map(p=>p.project_name)}));
  }catch(_){return[];}
}
function buildCompanySwitcher(){
  const wrap=document.getElementById('companySwitcher');if(!wrap)return;
  const list=[{id:Y2B_ID,name:'yes2broker (Y2B)'},...companies];
  wrap.innerHTML=list.map(c=>`<div class="cs-item${c.id===activeCompany?' active':''}" onclick="switchCompany('${c.id}')"><span class="cs-dot"></span>${escHtml(c.name)}</div>`).join('');
}
function switchCompany(id){
  activeCompany=id;drillFilter=null;activeDrillSection=null;
  fOwners.clear();fSources.clear();fStatuses.clear();fFrom='';fTo='';
  invalidate();buildCompanySwitcher();updateCompanyBadge();buildFilterDropdowns();
  const sec=document.querySelector('.section.active')?.id?.replace('section-','');
  renderSection(sec||'overview');
}
function updateCompanyBadge(){const b=document.getElementById('activeCompanyBadge');if(b)b.textContent=activeCompany===Y2B_ID?'yes2broker':companies.find(c=>c.id==activeCompany)?.name||'';}
function openCompanyModal(editId=null){
  const ex=editId?companies.find(c=>String(c.id)===String(editId)):null;
  document.getElementById('modalTitle').textContent=ex?`Edit — ${ex.name}`:'Create Company';
  document.getElementById('companyNameInput').value=ex?.name||'';
  document.getElementById('modalEditId').value=editId||'';
  document.getElementById('projectSearch').value='';
  renderProjectPicker(ex?.projects||[]);
  document.getElementById('companyModal').classList.add('open');lucide.createIcons();
}
function closeCompanyModal(){document.getElementById('companyModal').classList.remove('open');}
function renderProjectPicker(selected=[]){
  const search=(document.getElementById('projectSearch')?.value||'').toLowerCase().trim();
  const wrap=document.getElementById('projectPicker');if(!wrap)return;
  const checked=new Set([...selected,...[...document.querySelectorAll('#projectPicker input:checked')].map(i=>i.value)]);
  const ck=allProjects.filter(p=>checked.has(p)&&(!search||p.toLowerCase().includes(search)));
  const un=allProjects.filter(p=>!checked.has(p)&&(!search||p.toLowerCase().includes(search)));
  const item=(p,c)=>`<label class="proj-check${c?' checked':''}" data-project="${escHtml(p)}"><input type="checkbox" value="${escHtml(p)}"${c?' checked':''} onchange="this.closest('.proj-check').classList.toggle('checked',this.checked)"/><span class="proj-name">${escHtml(p)}</span></label>`;
  wrap.innerHTML=[ck.length?`<div class="proj-section-label">Selected (${ck.length})</div>`:'', ...ck.map(p=>item(p,true)), ck.length&&un.length?`<div class="proj-section-divider"></div>`:'', un.length?`<div class="proj-section-label">Available</div>`:'', ...un.map(p=>item(p,false))].join('')||'<p style="padding:12px;color:#94a3b8;font-size:13px">No projects</p>';
}
function getSelectedProjects(){return[...document.querySelectorAll('#projectPicker input:checked')].map(i=>i.value);}
function getSelectedProjectValues(){return getSelectedProjects();}
async function saveCompany(){
  const name=document.getElementById('companyNameInput').value.trim();
  const editId=document.getElementById('modalEditId').value;
  const sel=getSelectedProjects();
  if(!name){showToast('Enter a company name','error');return;}
  const btn=document.getElementById('saveCompanyBtn');btn.disabled=true;btn.textContent='Saving…';
  try{
    let cid=editId;
    if(!editId){const[c]=await sbPost('companies',{name});cid=c.id;}
    else await fetch(`${SUPA_URL}/rest/v1/companies?id=eq.${editId}`,{method:'PATCH',headers:{...HEADERS,'Content-Type':'application/json','Prefer':'return=minimal'},body:JSON.stringify({name})});
    await sbDelete('company_projects',`company_id=eq.${cid}`);
    if(sel.length)await sbPost('company_projects',sel.map(p=>({company_id:cid,project_name:p})));
    companies=await loadCompanies();buildCompanySwitcher();updateCompanyBadge();invalidate();buildFilterDropdowns();
    const sec=document.querySelector('.section.active')?.id?.replace('section-','');if(sec)renderSection(sec);
    closeCompanyModal();showToast(`"${name}" saved`,'success');
  }catch(err){showToast('Error: '+err.message,'error');}
  finally{btn.disabled=false;btn.textContent='Save Company';}
}
async function deleteCompany(id){
  const co=companies.find(c=>String(c.id)===String(id));
  showConfirm(`Delete "${co?.name||'this company'}"?`,'Leads return to yes2broker.',async()=>{
    try{
      await sbDelete('companies',`id=eq.${id}`);
      if(String(activeCompany)===String(id))activeCompany=Y2B_ID;
      companies=await loadCompanies();buildCompanySwitcher();updateCompanyBadge();invalidate();buildFilterDropdowns();
      const sec=document.querySelector('.section.active')?.id?.replace('section-','');if(sec)renderSection(sec);
      showToast('Company deleted','success');
    }catch(err){showToast('Error: '+err.message,'error');}
  });
}

// ── DATE / BUCKET ─────────────────────────────────────────────
function parseDate(s){
  if(!s||typeof s!=='string')return null;
  const t=s.trim();
  const m1=t.match(/^(\d{1,2})-(\d{1,2})-(\d{4})/);if(m1)return new Date(+m1[3],+m1[2]-1,+m1[1]);
  const m2=t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);if(m2)return new Date(+m2[3],+m2[1]-1,+m2[2]);
  const m3=t.match(/^(\d{4})-(\d{2})-(\d{2})/);if(m3)return new Date(+m3[1],+m3[2]-1,+m3[3]);
  const d=new Date(t);return isNaN(d)?null:d;
}
function bucketKey(d){
  if(!d)return null;
  if(granularity==='monthly')return`${d.toLocaleString('en-US',{month:'short'})} '${String(d.getFullYear()).slice(2)}`;
  if(granularity==='weekly'){const j=new Date(d.getFullYear(),0,1);const w=Math.ceil(((d-j)/86400000+j.getDay()+1)/7);return`W${String(w).padStart(2,'0')} '${String(d.getFullYear()).slice(2)}`;}
  return`${String(d.getDate()).padStart(2,'0')} ${d.toLocaleString('en-US',{month:'short'})} '${String(d.getFullYear()).slice(2)}`;
}
function bucketDate(k){
  if(!k)return new Date(0);
  try{
    const m1=k.match(/^([A-Z][a-z]{2})\s+'(\d{2})$/);if(m1)return new Date(2000+parseInt(m1[2]),new Date(`${m1[1]} 1`).getMonth(),1);
    const m2=k.match(/^(\d{2})\s+([A-Z][a-z]{2})\s+'(\d{2})$/);if(m2)return new Date(2000+parseInt(m2[3]),new Date(`${m2[2]} 1`).getMonth(),parseInt(m2[1]));
    const m3=k.match(/^W(\d{2})\s+'(\d{2})$/);if(m3)return new Date(2000+parseInt(m3[2]),0,1+(parseInt(m3[1])-1)*7);
  }catch(_){}
  return new Date(0);
}
function sortBuckets(keys){return[...keys].sort((a,b)=>bucketDate(a)-bucketDate(b));}
function buildTimeSeries(rows,dateCol='Created Date',groupCol=null){
  const map={};
  const minD=new Date('2020-01-01'),maxD=new Date(new Date().getFullYear()+2,11,31);
  rows.forEach(r=>{
    const d=parseDate(r[dateCol]);
    if(!d||d<minD||d>maxD)return;
    const k=bucketKey(d);if(!k)return;
    if(groupCol){const g=r[groupCol]||'Unknown';if(!map[k])map[k]={};map[k][g]=(map[k][g]||0)+1;}
    else map[k]=(map[k]||0)+1;
  });
  return map;
}

// ── CHART FACTORIES ───────────────────────────────────────────
function mkChart(id,type,labels,data,opts={}){
  if(chartInstances[id])chartInstances[id].destroy();
  const ctx=document.getElementById(id);if(!ctx)return;
  const isMulti=Array.isArray(data)&&data.length&&typeof data[0]==='object'&&'data' in data[0];
  chartInstances[id]=new Chart(ctx,{
    type,
    data:{labels,datasets:isMulti?data:[{data,
      backgroundColor:opts.single?(type==='line'?'rgba(37,99,235,.08)':PALETTE[0]):PALETTE.slice(0,Math.max(labels.length,1)),
      borderColor:opts.single?(type==='line'?'#2563eb':undefined):undefined,
      borderWidth:type==='line'?2:(type==='bar'?0:1.5),
      fill:type==='line',tension:.4,pointRadius:type==='line'?3:0,pointHoverRadius:5,
      label:opts.label||'',
      ...opts.ds
    }]},
    options:{responsive:true,maintainAspectRatio:true,animation:{duration:350},
      plugins:{
        legend:{display:isMulti,position:'bottom',labels:{font:{family:FONT,size:11},padding:10,usePointStyle:true}},
        datalabels:opts.dl||{display:false},
        tooltip:{bodyFont:{family:FONT,size:12},titleFont:{family:FONT,size:12,weight:'600'}},
      },
      scales:(type==='bar'||type==='line')?{
        x:{stacked:!!opts.stacked,grid:{display:false},ticks:{font:{family:FONT,size:10},maxRotation:45}},
        y:{stacked:!!opts.stacked,beginAtZero:true,grid:{color:'#f1f5f9'},ticks:{font:{family:FONT,size:10}}}
      }:{},
      ...opts.extra}
  });
}

function mkScrollChart(wrapperId,type,allLabels,datasets,opts={}){
  const wrap=document.getElementById(wrapperId);if(!wrap)return;
  const id='sc_'+wrapperId;
  if(chartInstances[id]){chartInstances[id].destroy();delete chartInstances[id];}
  wrap.innerHTML='';
  wrap.style.cssText='overflow-x:auto;overflow-y:hidden;width:100%;padding-bottom:6px;-webkit-overflow-scrolling:touch;';
  const CHART_H=280;
  const PER=type==='bar'?56:44;
  const wW=wrap.offsetWidth||700;
  const totalW=Math.max(allLabels.length*PER,wW);
  const inner=document.createElement('div');
  inner.style.cssText=`width:${totalW}px;min-width:${totalW}px;height:${CHART_H}px;`;
  wrap.appendChild(inner);
  const canvas=document.createElement('canvas');
  canvas.width=totalW;canvas.height=CHART_H;
  canvas.style.cssText=`display:block;width:${totalW}px;height:${CHART_H}px;`;
  inner.appendChild(canvas);
  const isMulti=Array.isArray(datasets)&&datasets.length&&typeof datasets[0]==='object'&&'data' in datasets[0];
  const showLegend=isMulti&&datasets.length>1;

  // For stacked % view (source trend fix)
  let chartDatasets=isMulti?datasets:[{data:datasets,label:opts.label||'Value',
    backgroundColor:type==='line'?'rgba(37,99,235,.08)':PALETTE.slice(0,allLabels.length),
    borderColor:type==='line'?'#2563eb':undefined,
    borderWidth:type==='line'?2:0,fill:type==='line',tension:.4,
    pointRadius:type==='line'?3:0,pointHoverRadius:5,pointBackgroundColor:'#2563eb',
    ...opts.ds
  }];

  chartInstances[id]=new Chart(canvas,{
    type,data:{labels:allLabels,datasets:chartDatasets},
    options:{
      responsive:false,maintainAspectRatio:false,animation:{duration:300},
      plugins:{
        legend:{display:showLegend,position:'bottom',labels:{font:{family:FONT,size:11},padding:8,usePointStyle:true,boxWidth:8}},
        datalabels:{display:false},
        tooltip:{bodyFont:{family:FONT,size:12},titleFont:{family:FONT,size:12,weight:'600'},
          callbacks:opts.pct?{label:ctx=>`${ctx.dataset.label}: ${ctx.raw} (${Math.round(ctx.raw/(allLabels.map((_,i)=>chartDatasets.reduce((s,d)=>s+(d.data[i]||0),0))[ctx.dataIndex]||1)*100)}%)`}:undefined
        },
      },
      scales:{
        x:{stacked:!!opts.stacked,grid:{display:false},ticks:{font:{family:FONT,size:10},maxRotation:45,autoSkip:false}},
        y:{stacked:!!opts.stacked,beginAtZero:true,grid:{color:'#f1f5f9'},ticks:{font:{family:FONT,size:10},
          callback:opts.pct?(v)=>v+'%':undefined
        }}
      }
    }
  });
  requestAnimationFrame(()=>{wrap.scrollLeft=totalW;});
}

// ── UI HELPERS ────────────────────────────────────────────────
function escHtml(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
function setBadge(id,n){const el=document.getElementById(id);if(el)el.textContent=`${Number(n).toLocaleString()} records`;}
function pct(a,b){return b?Math.round(a/b*100)+'%':'0%';}
function badge(s){
  const l=(s||'').toLowerCase();
  if(l==='site visit done')    return`<span class="badge b-green">${escHtml(s)}</span>`;
  if(l==='site visit schedule')return`<span class="badge b-amber">${escHtml(s)}</span>`;
  if(l==='inactive')  return`<span class="badge b-red">${escHtml(s)}</span>`;
  if(l==='converted') return`<span class="badge b-green">${escHtml(s)}</span>`;
  if(l==='hot')       return`<span class="badge b-red">${escHtml(s)}</span>`;
  if(l==='warm')      return`<span class="badge b-amber">${escHtml(s)}</span>`;
  if(l==='cold')      return`<span class="badge b-grey">${escHtml(s)}</span>`;
  return`<span class="badge b-blue">${escHtml(s||'—')}</span>`;
}
function kpiCard(icon,val,label,cls='',drillFn=null){
  const click=drillFn?` onclick="${drillFn}" title="Click to drill down"`:'';
  return`<div class="kpi-card ${cls}"${click}><div class="kpi-icon-wrap"><i data-lucide="${icon}"></i></div><div class="kpi-val">${val}</div><div class="kpi-lbl">${label}${drillFn?'<span class="kpi-drill-hint">↗</span>':''}</div></div>`;
}
function fillTable(id,headers,rows,totals=null){
  const el=document.getElementById(id);if(!el)return;
  el.innerHTML='';
  const thead=el.createTHead(),hr=thead.insertRow();
  headers.forEach(h=>{const th=document.createElement('th');th.innerHTML=h;hr.appendChild(th);});
  const tb=el.createTBody();
  if(!rows.length){const tr=tb.insertRow(),td=tr.insertCell();td.colSpan=headers.length;td.style.cssText='padding:20px;text-align:center;color:#94a3b8;font-size:13px';td.textContent='No records';return;}
  rows.forEach(row=>{const tr=tb.insertRow();row.forEach(c=>{const td=tr.insertCell();td.innerHTML=c!=null?String(c):'—';});});
  if(totals){const tfoot=el.createTFoot(),tr=tfoot.insertRow();tr.style.cssText='background:#f1f5f9;font-weight:700;';totals.forEach(c=>{const td=tr.insertCell();td.style.cssText='padding:9px 13px;font-size:12.5px;color:#0a1628;';td.innerHTML=c!=null?String(c):'';});}
}
function renderPagination(cid,pgId,total){
  const pg=getPg(pgId),pages=Math.ceil(total/pg.size)||1;
  const wrap=document.getElementById(cid);if(!wrap)return;
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
function scrollToTable(id){setTimeout(()=>{const el=document.getElementById(id);if(el)el.scrollIntoView({behavior:'smooth',block:'start'});},80);}

// Lead row helpers
const LEAD_H=['Name','Mobile','Project','Status','Source','Owner','Calls','Created'];
function leadRow(r){return[`${r['FirstName']||''} ${r['LastName']||''}`.trim()||'—',`<span class="mono">${escHtml(r['Mobile No.']||'—')}</span>`,escHtml(r['Project Name']||'—'),badge(r['Status Name']),escHtml(r['Source Name']||'—'),escHtml(r['Owner Name']||'—'),`<span class="mono">${callCount(r)}</span>`,escHtml((r['Created Date']||'').split(' ')[0]||'—')];}

// ── DRILL-DOWN MODAL ──────────────────────────────────────────
function showDrill(title,rows,headers){
  let m=document.getElementById('drilldownModal');
  if(!m){m=document.createElement('div');m.id='drilldownModal';m.className='modal-overlay';
    m.innerHTML=`<div class="modal" style="max-width:940px;max-height:88vh"><div class="modal-header"><h3 id="drillTitle"></h3><button class="modal-close" onclick="document.getElementById('drilldownModal').classList.remove('open')"><i data-lucide="x"></i></button></div><div class="modal-body" style="padding:0;overflow-y:auto"><div class="tbl-scroll"><table id="drillTable"></table></div></div><div class="modal-footer"><span id="drillCount" style="font-size:12px;color:#94a3b8;margin-right:auto"></span><button class="btn-secondary" onclick="document.getElementById('drilldownModal').classList.remove('open')">Close</button></div></div>`;
    document.body.appendChild(m);}
  document.getElementById('drillTitle').textContent=title;
  document.getElementById('drillCount').textContent=`${rows.length.toLocaleString()} records`;
  fillTable('drillTable',headers,rows);m.classList.add('open');lucide.createIcons();
}

// ── CUSTOM DIALOGS ────────────────────────────────────────────
function showToast(msg,type='success'){
  let t=document.getElementById('toastEl');
  if(!t){t=document.createElement('div');t.id='toastEl';document.body.appendChild(t);}
  t.className=`toast toast-${type}`;
  t.innerHTML=`<i data-lucide="${type==='success'?'check-circle':'alert-circle'}" style="width:15px;height:15px;flex-shrink:0"></i><span>${escHtml(msg)}</span>`;
  t.classList.add('show');lucide.createIcons();
  clearTimeout(t._t);t._t=setTimeout(()=>t.classList.remove('show'),3500);
}
function showConfirm(title,msg,onOk){
  let m=document.getElementById('confirmModal');
  if(!m){m=document.createElement('div');m.id='confirmModal';m.className='modal-overlay';
    m.innerHTML=`<div class="modal" style="max-width:400px"><div class="modal-header"><h3 id="confirmTitle"></h3></div><div class="modal-body"><p id="confirmMsg" style="font-size:14px;color:#475569"></p></div><div class="modal-footer"><button class="btn-secondary" onclick="document.getElementById('confirmModal').classList.remove('open')">Cancel</button><button class="btn-danger" id="confirmOk">Delete</button></div></div>`;
    document.body.appendChild(m);}
  document.getElementById('confirmTitle').textContent=title;
  document.getElementById('confirmMsg').textContent=msg;
  document.getElementById('confirmOk').onclick=()=>{m.classList.remove('open');onOk();};
  m.classList.add('open');
}

// ── SECTION ROUTER ────────────────────────────────────────────
const RENDERERS={overview:renderOverview,platform:renderPlatform,owner:renderOwner,
  status:renderStatus,calls:renderCalls,visits:renderVisits,budget:renderBudget,
  converted:renderConverted,comparison:renderComparison,lifecycle:renderLifecycle,
  'leads-table':renderLeadsTable};
function renderSection(sec){if(!masterCache.length)return;sectionRendered[sec]=true;try{if(RENDERERS[sec])RENDERERS[sec]();lucide.createIcons();}catch(e){console.error('Render error',sec,e);}}
async function loadSection(sec){renderSection(sec);}

// ── PAID DATA CARD HELPER ─────────────────────────────────────
function paidDataCard(d){
  const paid=d.filter(r=>r['Source Name']==='Paid Data');
  return kpiCard('database',paid.length.toLocaleString(),'Paid Data Leads','cyan',`drillBySource('Paid Data')`);
}
function drillBySource(src){
  const d=getFiltered().filter(r=>r['Source Name']===src);
  showDrill(`${src} Leads (${d.length})`,d.map(leadRow),LEAD_H);
}

// ── METRICS ───────────────────────────────────────────────────
function getMetrics(d){
  const totalLeads  =d.length;
  const totalCalls  =d.reduce((s,r)=>s+callCount(r),0);
  const visited     =d.filter(r=>r['IsSiteVisitDone']==='Yes');
  const visitsDone  =visited.length;
  const revisits    =d.filter(r=>(parseInt(r['Site Visit Done Count'])||0)>1).length;
  const converted   =getCompanyConverted().filter(r=>{
    if(fOwners.size&&!fOwners.has(r['Owner Name']))return false;
    return true;
  }).length;
  const inactive    =d.filter(r=>r['Status Name']==='Inactive').length;
  const warm        =d.filter(r=>r['Status Name']==='Warm').length;
  const hot         =d.filter(r=>r['Status Name']==='Hot').length;
  const active      =d.filter(r=>!['Inactive','Converted'].includes(r['Status Name']));
  const visitRate   =totalCalls>0?Math.round(visitsDone/totalCalls*100):0;
  const closureRate =visitsDone>0?Math.round(converted/visitsDone*100):0;
  const revisitRate =visitsDone>0?Math.round(revisits/visitsDone*100):0;
  return{totalLeads,totalCalls,visitsDone,revisits,converted,inactive,warm,hot,active:active.length,visitRate,closureRate,revisitRate};
}

// ── OVERVIEW ──────────────────────────────────────────────────
function renderOverview(){
  const d=getFiltered();
  setBadge('overviewCount',d.length);
  const m=getMetrics(d);
  document.getElementById('kpiGrid').innerHTML=[
    kpiCard('target',m.totalLeads.toLocaleString(),'Total Leads','','drillOv("all")'),
    kpiCard('phone',m.totalCalls.toLocaleString(),'Total Calls','green','drillOv("calls")'),
    kpiCard('map-pin',m.visitsDone.toLocaleString(),'Site Visits','amber','drillOv("visited")'),
    kpiCard('users',new Set(d.map(r=>r['Owner Name']).filter(Boolean)).size,'Active Owners','purple','drillOv("owners")'),
    kpiCard('x-circle',m.inactive.toLocaleString(),'Inactive','red','drillOv("inactive")'),
    paidDataCard(d),
    kpiCard('percent',m.visitRate+'%','Visit Rate','cyan'),
    kpiCard('check-circle',m.closureRate+'%','Closure Rate','green'),
  ].join('');

  // Owner-wise bar chart (replaces Lead Trend)
  const ownerMap={};
  d.forEach(r=>{const o=r['Owner Name']||'Unknown';ownerMap[o]=(ownerMap[o]||0)+1;});
  const oLbl=Object.keys(ownerMap).sort((a,b)=>ownerMap[b]-ownerMap[a]);
  mkScrollChart('timelineChartWrap','bar',oLbl,oLbl.map(l=>ownerMap[l]),{
    single:false,label:'Leads',
    ds:{backgroundColor:oLbl.map((_,i)=>PALETTE[i%PALETTE.length]),borderWidth:0}
  });

  const srcMap={};d.forEach(r=>{const s=r['Source Name']||'Unknown';srcMap[s]=(srcMap[s]||0)+1;});
  mkChart('overviewSourceChart','doughnut',Object.keys(srcMap),Object.values(srcMap),{
    dl:{display:true,formatter:v=>v,color:'#fff',font:{weight:'700',size:11}}
  });

  const pg=getPg('overviewTable');
  const slice=d.slice((pg.page-1)*pg.size,pg.page*pg.size);
  const tots=['Total: '+d.length,'','','','','',d.reduce((s,r)=>s+callCount(r),0),''];
  fillTable('overviewTable',LEAD_H,slice.map(leadRow),tots);
  renderPagination('overviewPg','overviewTable',d.length);
}
function drillOv(type){
  const d=getFiltered();let rows=[],title='';
  switch(type){
    case 'all':     rows=d;title='All Leads';break;
    case 'calls':   rows=d.filter(r=>callCount(r)>0);title='Leads with Calls';break;
    case 'visited': rows=d.filter(r=>r['IsSiteVisitDone']==='Yes');title='Site Visit Done';break;
    case 'inactive':rows=d.filter(r=>r['Status Name']==='Inactive');title='Inactive Leads';break;
    case 'owners':  rows=d;title='Leads by Owner';break;
  }
  showDrill(title+` (${rows.length})`,rows.map(leadRow),LEAD_H);
  document.getElementById('drilldownModal')?.scrollIntoView&&scrollToTable('drilldownModal');
}

// ── PLATFORM ──────────────────────────────────────────────────
function renderPlatform(){
  const d=getFiltered();setBadge('platformCount',d.length);
  const srcMap={};d.forEach(r=>{const s=r['Source Name']||'Unknown';srcMap[s]=(srcMap[s]||0)+1;});
  const lbl=Object.keys(srcMap).sort((a,b)=>srcMap[b]-srcMap[a]),val=lbl.map(l=>srcMap[l]);
  mkChart('sourceBarChart','bar',lbl,val,{dl:{display:true,anchor:'end',align:'end',color:'#334155',font:{weight:'700',size:11}}});
  mkChart('sourcePieChart','pie',lbl,val,{dl:{display:true,formatter:v=>v,color:'#fff',font:{weight:'700',size:11}}});

  // Source trend — percentage stacked bars (fixes tiny-source visibility)
  const tMap=buildTimeSeries(d,'Created Date','Source Name'),tKeys=sortBuckets(Object.keys(tMap));
  // Convert to % per bucket
  const tDS=lbl.map((s,i)=>({
    label:s,
    data:tKeys.map(k=>{
      const total=Object.values(tMap[k]||{}).reduce((a,b)=>a+b,0);
      return total?Math.round(((tMap[k]&&tMap[k][s])||0)/total*100):0;
    }),
    backgroundColor:PALETTE[i%PALETTE.length],borderWidth:0,
  }));
  mkScrollChart('sourceTrendWrap','bar',tKeys,tDS,{stacked:true,pct:true});

  const pg=getPg('sourceTable');
  const totVal=val.reduce((a,b)=>a+b,0);
  const rows=lbl.slice((pg.page-1)*pg.size,pg.page*pg.size).map(l=>[escHtml(l),srcMap[l].toLocaleString(),Math.round(srcMap[l]/d.length*100)+'%']);
  fillTable('sourceTable',['Source','Total Leads','Share %'],rows,['Total',totVal.toLocaleString(),'100%']);
  renderPagination('sourcePg','sourceTable',lbl.length);
}

// ── OWNER ─────────────────────────────────────────────────────
function renderOwner(){
  const d=getFiltered();setBadge('ownerCount',d.length);
  const allConv=getCompanyConverted();
  const allVisits=visitsCache;

  const om={};
  d.forEach(r=>{
    const o=r['Owner Name']||'Unknown';
    if(!om[o])om[o]={leads:0,calls:0,visits:0,revisits:0,inactive:0,scheduled:0,converted:0};
    om[o].leads++;
    om[o].calls+=callCount(r);
    if(r['IsSiteVisitDone']==='Yes')om[o].visits++;
    if((parseInt(r['Site Visit Done Count'])||0)>1)om[o].revisits++;
    if(r['Status Name']==='Inactive')om[o].inactive++;
    if(r['Status Name']==='Site Visit Schedule')om[o].scheduled++;
  });
  // Converted per owner
  allConv.forEach(r=>{const o=r['Owner Name']||'Unknown';if(om[o])om[o].converted++;});

  const lbl=Object.keys(om).sort((a,b)=>om[b].leads-om[a].leads);

  // Compute rates
  lbl.forEach(o=>{
    om[o].visitRate =om[o].calls>0?Math.round(om[o].visits/om[o].calls*100):0;
    om[o].closureRate=om[o].visits>0?Math.round(om[o].converted/om[o].visits*100):0;
    om[o].revisitRate=om[o].visits>0?Math.round(om[o].revisits/om[o].visits*100):0;
  });

  mkChart('ownerBarChart','bar',lbl,lbl.map(l=>om[l].leads),{dl:{display:true,anchor:'end',align:'end',color:'#334155',font:{weight:'700',size:12}}});
  mkChart('ownerPieChart','doughnut',lbl,lbl.map(l=>om[l].leads),{dl:{display:true,formatter:v=>v,color:'#fff',font:{weight:'700',size:12}}});

  const tMap=buildTimeSeries(d,'Created Date','Owner Name'),tKeys=sortBuckets(Object.keys(tMap));
  const oDS=lbl.map((o,i)=>({label:o,data:tKeys.map(k=>(tMap[k]&&tMap[k][o])||0),borderColor:PALETTE[i%PALETTE.length],backgroundColor:'transparent',borderWidth:2,tension:.4,pointRadius:3,fill:false}));
  mkScrollChart('ownerTrendWrap','line',tKeys,oDS,{});

  const pg=getPg('ownerTable');
  const slice=lbl.slice((pg.page-1)*pg.size,pg.page*pg.size);
  const rows=slice.map(l=>[
    escHtml(l),om[l].leads,om[l].calls,om[l].visits,
    `<span class="badge b-blue">${om[l].revisits}</span>`,
    om[l].inactive,om[l].scheduled,om[l].converted,
    `<span class="badge ${om[l].visitRate>=30?'b-green':om[l].visitRate>=15?'b-amber':'b-red'}">${om[l].visitRate}%</span>`,
    `<span class="badge ${om[l].closureRate>=20?'b-green':om[l].closureRate>=10?'b-amber':'b-red'}">${om[l].closureRate}%</span>`,
    `<span class="badge b-blue">${om[l].revisitRate}%</span>`,
    Math.round(om[l].leads/d.length*100)+'%'
  ]);
  const totals=['Total',d.length,d.reduce((s,r)=>s+callCount(r),0),
    d.filter(r=>r['IsSiteVisitDone']==='Yes').length,
    d.filter(r=>(parseInt(r['Site Visit Done Count'])||0)>1).length,
    d.filter(r=>r['Status Name']==='Inactive').length,'','',
    getMetrics(d).visitRate+'%',getMetrics(d).closureRate+'%','','100%'];
  fillTable('ownerTable',['Owner','Leads','Calls','Visits','Revisits','Inactive','Scheduled','Converted','Visit Rate','Closure Rate','Revisit Rate','Share'],rows,totals);
  renderPagination('ownerPg','ownerTable',lbl.length);
}

// ── STATUS ────────────────────────────────────────────────────
function renderStatus(){
  const d=getFiltered();setBadge('statusCount',d.length);
  const sm={};d.forEach(r=>{const s=r['Status Name']||'Unknown';sm[s]=(sm[s]||0)+1;});
  const ordered=[...STATUS_ORDER,...Object.keys(sm).filter(s=>!STATUS_ORDER.includes(s))];
  const lbl=ordered.filter(s=>sm[s]),val=lbl.map(l=>sm[l]);
  const colors=lbl.map(l=>STATUS_COLORS[l]||PALETTE[lbl.indexOf(l)%PALETTE.length]);

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
  const rows=lbl.slice((pg.page-1)*pg.size,pg.page*pg.size).map(l=>[badge(l),`<span class="mono">${sm[l].toLocaleString()}</span>`,Math.round(sm[l]/d.length*100)+'%']);
  fillTable('statusTable',['Status','Count','Share %'],rows,['Total',d.length.toLocaleString(),'100%']);
  renderPagination('statusPg','statusTable',lbl.length);
}

// ── CALLS ─────────────────────────────────────────────────────
function renderCalls(){
  const d=getFiltered();setBadge('callsCount',d.length);
  const m=getMetrics(d);
  const maxC=Math.max(...d.map(r=>callCount(r)),0);
  const touched=d.filter(r=>callCount(r)>0).length;
  const avg=touched?(m.totalCalls/touched).toFixed(1):0;

  document.getElementById('callKpiGrid').innerHTML=[
    kpiCard('phone-call',m.totalCalls.toLocaleString(),'Total Calls','','drillCalls("total")'),
    kpiCard('user-check',touched.toLocaleString(),'Contacted','green','drillCalls("touched")'),
    kpiCard('user-x',(d.length-touched).toLocaleString(),'Not Contacted','red','drillCalls("untouched")'),
    kpiCard('bar-chart-2',avg,'Avg Calls/Lead','amber','drillCalls("avg")'),
    kpiCard('trending-up',maxC,'Max Calls on 1 Lead','purple','drillCalls("max")'),
    paidDataCard(d),
    kpiCard('percent',m.visitRate+'%','Visit Rate (Calls→Visit)','cyan'),
  ].join('');

  const dist={};d.forEach(r=>{const c=callCount(r);dist[c]=(dist[c]||0)+1;});
  const dKeys=Object.keys(dist).sort((a,b)=>+a-+b);
  mkScrollChart('callCountWrap','bar',dKeys.map(k=>`${k} call${k!='1'?'s':''}`),dKeys.map(k=>dist[k]),{single:true,label:'Leads'});

  const outcomes={};
  d.forEach(r=>{const det=(r['Latest 1st Call Details']||'').toLowerCase().trim();
    if(!det){outcomes['No Call']=(outcomes['No Call']||0)+1;return;}
    if(det.includes('not interested'))outcomes['Not Interested']=(outcomes['Not Interested']||0)+1;
    else if(det.includes('cnr')||det.includes('not received'))outcomes['Not Received']=(outcomes['Not Received']||0)+1;
    else if(det.includes('out of service')||det.includes('switched off'))outcomes['Unreachable']=(outcomes['Unreachable']||0)+1;
    else if(det.includes('visit')||det.includes('schedule'))outcomes['Visit Planned']=(outcomes['Visit Planned']||0)+1;
    else outcomes['Connected']=(outcomes['Connected']||0)+1;
  });
  mkChart('callOutcomeChart','doughnut',Object.keys(outcomes),Object.values(outcomes),{dl:{display:true,formatter:v=>v,color:'#fff',font:{weight:'700',size:12}}});

  const tsMap=buildTimeSeries(d,'Created Date'),tsKeys=sortBuckets(Object.keys(tsMap));
  mkScrollChart('callTrendWrap','line',tsKeys,tsKeys.map(k=>tsMap[k]),{single:true,label:'Leads',ds:{backgroundColor:'rgba(37,99,235,.08)',borderColor:'#2563eb',pointBackgroundColor:'#2563eb',pointRadius:3}});

  const pg=getPg('callTable');
  const rows=d.slice((pg.page-1)*pg.size,pg.page*pg.size).map(r=>[
    `${r['FirstName']||''} ${r['LastName']||''}`.trim()||'—',
    `<span class="mono">${escHtml(r['Mobile No.']||'—')}</span>`,
    escHtml(r['Owner Name']||'—'),`<span class="mono">${callCount(r)}</span>`,
    `<div class="note-cell">${escHtml(r['Latest 1st Call Details']||'—')}</div>`,
    `<span class="mono" style="font-size:11px">${escHtml((r['Latest 1st Call Date']||'').split(' ')[0]||'—')}</span>`,
    `<div class="note-cell">${escHtml(r['Latest 2nd Call Details']||'—')}</div>`,
    `<span class="mono" style="font-size:11px">${escHtml((r['Latest 2nd Call Date']||'').split(' ')[0]||'—')}</span>`,
    `<div class="note-cell">${escHtml(r['Latest 3rd Call Details']||'—')}</div>`,
    `<span class="mono" style="font-size:11px">${escHtml((r['Latest 3rd Call Date']||'').split(' ')[0]||'—')}</span>`,
  ]);
  const tCalls=d.reduce((s,r)=>s+callCount(r),0);
  fillTable('callTable',['Name','Mobile','Owner','# Calls','Call 1','Date 1','Call 2','Date 2','Call 3','Date 3'],rows,
    ['Total: '+d.length,'','',tCalls,'','','','','','']);
  renderPagination('callPg','callTable',d.length);
}
function drillCalls(type){
  const d=getFiltered();const maxC=Math.max(...d.map(r=>callCount(r)),0);let rows=[],title='';
  switch(type){
    case 'total':    rows=d.filter(r=>callCount(r)>0);title='All Called Leads';break;
    case 'touched':  rows=d.filter(r=>callCount(r)>0);title='Contacted Leads';break;
    case 'untouched':rows=d.filter(r=>!(callCount(r)>0));title='Not Contacted';break;
    case 'avg':      rows=d.filter(r=>callCount(r)>0);title='Called Leads (Avg)';break;
    case 'max':      rows=d.filter(r=>callCount(r)===maxC);title=`Leads with Max ${maxC} Calls`;break;
  }
  showDrill(title+` (${rows.length})`,rows.map(leadRow),LEAD_H);
}

// ── VISITS ────────────────────────────────────────────────────
function renderVisits(){
  const isY2B=activeCompany===Y2B_ID;
  const vr=isY2B?visitsCache:getFiltered().filter(r=>r['IsSiteVisitDone']==='Yes');
  setBadge('visitsCount',vr.length);

  // Revisit count from masterdata
  const revisitLeads=getFiltered().filter(r=>(parseInt(r['Site Visit Done Count'])||0)>1);

  if(!vr.length){const el=document.getElementById('visitKpiGrid');if(el)el.innerHTML='<p style="padding:20px;color:#94a3b8">No visit data.</p>';return;}

  if(isY2B){
    const uniqueClients=new Set(vr.map(r=>r['Mobile No.']).filter(Boolean)).size;
    const uniqueStaff=new Set(vr.map(r=>r['Visit Done By']).filter(Boolean)).size;
    const withProject=vr.filter(r=>r['Visited Project']).length;
    const uniqueLocs=new Set(vr.map(r=>r['Location']).filter(Boolean)).size;

    document.getElementById('visitKpiGrid').innerHTML=[
      kpiCard('map-pin',vr.length.toLocaleString(),'Total Visits','green','drillVisits("all")'),
      kpiCard('users',uniqueClients,'Unique Clients','','drillVisits("clients")'),
      kpiCard('user-check',uniqueStaff,'Staff Members','purple','drillVisits("staff")'),
      kpiCard('repeat',revisitLeads.length.toLocaleString(),'Revisits (2+ visits)','amber','drillVisits("revisit")'),
      kpiCard('check-circle',withProject,'Project Known','','drillVisits("withProject")'),
      kpiCard('compass',uniqueLocs,'Locations','cyan','drillVisits("locations")'),
    ].join('');

    const nameMap={};vr.forEach(r=>{const n=r['Visit Done By']||'Unknown';nameMap[n]=(nameMap[n]||0)+1;});
    mkChart('visitStatusChart','doughnut',Object.keys(nameMap),Object.values(nameMap),{dl:{display:true,formatter:v=>v,color:'#fff',font:{weight:'700',size:13}}});
    const tMap=buildTimeSeries(vr,'Date'),tKeys=sortBuckets(Object.keys(tMap));
    mkScrollChart('visitProjectWrap','bar',tKeys,tKeys.map(k=>tMap[k]),{single:true,label:'Visits'});
    const locMap={};vr.forEach(r=>{const l=r['Location']||'Unknown';locMap[l]=(locMap[l]||0)+1;});
    const locLbl=Object.keys(locMap).sort((a,b)=>locMap[b]-locMap[a]).slice(0,20);
    mkScrollChart('visitLocationWrap','bar',locLbl,locLbl.map(l=>locMap[l]),{single:false,label:'Visits'});

    // Revisit by staff
    const revisitByStaff={};
    revisitLeads.forEach(r=>{const o=r['Owner Name']||'Unknown';revisitByStaff[o]=(revisitByStaff[o]||0)+1;});
    const rLbl=Object.keys(revisitByStaff).sort((a,b)=>revisitByStaff[b]-revisitByStaff[a]);
    mkChart('revisitChart','bar',rLbl,rLbl.map(l=>revisitByStaff[l]),{dl:{display:true,anchor:'end',align:'end',color:'#334155',font:{weight:'700',size:11}},single:true});

    const pg=getPg('visitTable');
    const rows=vr.slice((pg.page-1)*pg.size,pg.page*pg.size).map(r=>[
      escHtml(r['Date']||'—'),escHtml(r['Visit Done By']||'—'),escHtml(r['CustomerName']||'—'),
      `<span class="mono">${escHtml(r['Mobile No.']||'—')}</span>`,
      escHtml(r['Location']||'—'),r['Visited Project']?escHtml(r['Visited Project']):'<span style="color:#cbd5e1;font-style:italic">TBD</span>'
    ]);
    fillTable('visitTable',['Date','Staff','Customer','Mobile','Location','Project'],rows,
      ['Total: '+vr.length,'','','','','']);
    renderPagination('visitPg','visitTable',vr.length);
  } else {
    document.getElementById('visitKpiGrid').innerHTML=[
      kpiCard('map-pin',vr.length.toLocaleString(),'Site Visits Done','green'),
      kpiCard('repeat',revisitLeads.length.toLocaleString(),'Revisits','amber'),
    ].join('');
    const pg=getPg('visitTable');
    fillTable('visitTable',['Name','Mobile','Project','Owner','Visit Date','Count'],
      vr.slice((pg.page-1)*pg.size,pg.page*pg.size).map(r=>[
        `${r['FirstName']||''} ${r['LastName']||''}`.trim()||'—',
        `<span class="mono">${escHtml(r['Mobile No.']||'—')}</span>`,
        escHtml(r['Project Name']||'—'),escHtml(r['Owner Name']||'—'),
        escHtml(r['Latest Site Visit Done Date']||'—'),r['Site Visit Done Count']||0
      ]),['Total',vr.length,'','','','']);
    renderPagination('visitPg','visitTable',vr.length);
  }
}
function drillVisits(type){
  if(activeCompany!==Y2B_ID)return;
  const vr=visitsCache;const rl=getFiltered().filter(r=>(parseInt(r['Site Visit Done Count'])||0)>1);
  let rows=[],title='',headers=['Date','Staff','Customer','Mobile','Location','Project'];
  const fmt=r=>[escHtml(r['Date']||'—'),escHtml(r['Visit Done By']||'—'),escHtml(r['CustomerName']||'—'),`<span class="mono">${escHtml(r['Mobile No.']||'—')}</span>`,escHtml(r['Location']||'—'),r['Visited Project']?escHtml(r['Visited Project']):'—'];
  switch(type){
    case 'all':        rows=vr.map(fmt);title='All Site Visits';break;
    case 'clients':    rows=vr.map(fmt);title='All Visits';break;
    case 'staff':      rows=vr.map(fmt);title='Visits by Staff';break;
    case 'revisit':    rows=rl.map(leadRow);headers=LEAD_H;title=`Revisit Leads (${rl.length})`;break;
    case 'withProject':rows=vr.filter(r=>r['Visited Project']).map(fmt);title='Visits with Project';break;
    case 'locations':  rows=vr.map(fmt);title='All Visits by Location';break;
  }
  showDrill(title,rows,headers);
}

// ── BUDGET ────────────────────────────────────────────────────
function renderBudget(){
  const d=getFiltered();setBadge('budgetCount',d.length);
  const propMap={},bhkMap={},projMap={};
  d.forEach(r=>{
    const p=r['Property']||'Unknown';propMap[p]=(propMap[p]||0)+1;
    const b=r['Property Type']||'Unknown';bhkMap[b]=(bhkMap[b]||0)+1;
    const j=r['Project Name']||'Unknown';projMap[j]=(projMap[j]||0)+1;
  });
  mkChart('propTypeChart','doughnut',Object.keys(propMap),Object.values(propMap),{dl:{display:true,formatter:v=>v,color:'#fff',font:{weight:'700',size:13}}});
  mkChart('bhkChart','pie',Object.keys(bhkMap),Object.values(bhkMap),{dl:{display:true,formatter:v=>v,color:'#fff',font:{weight:'700',size:12}}});
  const pLbl=Object.keys(projMap).sort((a,b)=>projMap[b]-projMap[a]);
  mkScrollChart('projectChartWrap','bar',pLbl,pLbl.map(l=>projMap[l]),{single:false,label:'Leads'});
  const pg=getPg('budgetTable');
  const rows=d.slice((pg.page-1)*pg.size,pg.page*pg.size).map(r=>[
    `${r['FirstName']||''} ${r['LastName']||''}`.trim()||'—',
    `<span class="mono">${escHtml(r['Mobile No.']||'—')}</span>`,
    escHtml(r['Project Name']||'—'),escHtml(r['Property Type']||'—'),
    escHtml(r['Property']||'—'),escHtml(r['Property Location']||'—'),badge(r['Status Name'])
  ]);
  fillTable('budgetTable',['Name','Mobile','Project','BHK','Type','Location','Status'],rows,
    ['Total: '+d.length,'','','','','','']);
  renderPagination('budgetPg','budgetTable',d.length);
}

// ── CONVERTED ─────────────────────────────────────────────────
function renderConverted(){
  const rows=getCompanyConverted();
  setBadge('convertedCount',rows.length);
  if(!rows.length){const el=document.getElementById('convertedKpiGrid');if(el)el.innerHTML='<p style="padding:20px;color:#94a3b8">No conversions yet.</p>';return;}
  const isY2B=activeCompany===Y2B_ID;
  const totalVisits=rows.reduce((s,r)=>s+(parseInt(r['Site Visit Done Count'])||0),0);
  const totalCalls=rows.reduce((s,r)=>s+(parseInt(r['Make Call Count'])||1),0);
  const uniqueOwners=new Set(rows.map(r=>r['Owner Name']).filter(Boolean)).size;
  const uniqueSrc=new Set(rows.map(r=>r['Source Name']).filter(Boolean)).size;
  const paid=rows.filter(r=>r['Source Name']==='Paid Data').length;
  const m=getMetrics(getFiltered());

  document.getElementById('convertedKpiGrid').innerHTML=[
    kpiCard('check-circle',rows.length.toLocaleString(),'Total Converted','green','drillConv("all")'),
    kpiCard('users',uniqueOwners,'Unique Owners','','drillConv("owners")'),
    kpiCard('radio',uniqueSrc,'Lead Sources','cyan','drillConv("sources")'),
    kpiCard('map-pin',totalVisits.toLocaleString(),'Total Visits','amber','drillConv("visits")'),
    kpiCard('phone',totalCalls.toLocaleString(),'Total Calls','purple','drillConv("calls")'),
    kpiCard('percent',m.closureRate+'%','Closure Rate (Visit→Close)','green'),
    kpiCard('database',paid.toLocaleString(),'Paid Data Converted','cyan','drillConv("paid")'),
  ].join('');

  const ownerMap={},srcMap={};
  rows.forEach(r=>{const o=r['Owner Name']||'Unknown';ownerMap[o]=(ownerMap[o]||0)+1;const s=r['Source Name']||'Unknown';srcMap[s]=(srcMap[s]||0)+1;});
  const oLbl=Object.keys(ownerMap).sort((a,b)=>ownerMap[b]-ownerMap[a]);
  mkChart('convOwnerChart','bar',oLbl,oLbl.map(l=>ownerMap[l]),{dl:{display:true,anchor:'end',align:'end',color:'#334155',font:{weight:'700',size:12}}});
  mkChart('convOwnerPie','doughnut',oLbl,oLbl.map(l=>ownerMap[l]),{dl:{display:true,formatter:v=>v,color:'#fff',font:{weight:'700',size:12}}});
  mkChart('convSourceBar','bar',Object.keys(srcMap),Object.values(srcMap),{dl:{display:true,anchor:'end',align:'end',color:'#334155',font:{weight:'700',size:12}}});

  const monthCol=isY2B?'Converted Month':'Status Name';
  const monthMap={};rows.forEach(r=>{const mx=r[monthCol]||'Unknown';monthMap[mx]=(monthMap[mx]||0)+1;});
  const mKeys=Object.keys(monthMap).sort((a,b)=>{const ai=FY_MONTHS.findIndex(m=>a.includes(m)),bi=FY_MONTHS.findIndex(m=>b.includes(m));return ai!==bi?ai-bi:a.localeCompare(b);});
  mkScrollChart('convTrendWrap','line',mKeys,mKeys.map(k=>monthMap[k]),{single:true,label:'Conversions',ds:{backgroundColor:'rgba(5,150,105,.08)',borderColor:'#059669',pointBackgroundColor:'#059669',pointRadius:3}});

  const pg=getPg('convTable');
  const getName=r=>isY2B?r['CustomerName']||'—':`${r['FirstName']||''} ${r['LastName']||''}`.trim()||'—';
  const rows2=rows.slice((pg.page-1)*pg.size,pg.page*pg.size).map(r=>[
    escHtml(getName(r)),`<span class="mono">${escHtml(r['Mobile No.']||'—')}</span>`,
    isY2B?escHtml(r['Project Name']||r['Total Visited Projects Name']||'—'):escHtml(r['Project Name']||'—'),
    escHtml(r['Owner Name']||'—'),escHtml(r['Source Name']||'—'),
    escHtml((isY2B?r['Converted Date']:r['Created Date'])||'—'),
    r['Site Visit Done Count']||0,parseInt(r['Make Call Count'])||1
  ]);
  fillTable('convTable',['Customer','Mobile','Project','Owner','Source','Date','Visits','Calls'],rows2,
    ['Total: '+rows.length,'','','','','',totalVisits,totalCalls]);
  renderPagination('convPg','convTable',rows.length);
}
function drillConv(type){
  const rows=getCompanyConverted();let filtered=[],title='';
  const isY2B=activeCompany===Y2B_ID;
  const getName=r=>isY2B?r['CustomerName']||'—':`${r['FirstName']||''} ${r['LastName']||''}`.trim()||'—';
  const fmt=r=>[escHtml(getName(r)),`<span class="mono">${escHtml(r['Mobile No.']||'—')}</span>`,escHtml(r['Owner Name']||'—'),escHtml(r['Source Name']||'—'),escHtml((isY2B?r['Converted Date']:r['Created Date'])||'—'),r['Site Visit Done Count']||0,parseInt(r['Make Call Count'])||1];
  const hdrs=['Customer','Mobile','Owner','Source','Date','Visits','Calls'];
  switch(type){
    case 'all':     filtered=rows;title='All Conversions';break;
    case 'owners':  filtered=rows;title='By Owner';break;
    case 'sources': filtered=rows;title='By Source';break;
    case 'visits':  filtered=rows.filter(r=>parseInt(r['Site Visit Done Count'])>0);title='With Visits';break;
    case 'calls':   filtered=rows.filter(r=>parseInt(r['Make Call Count'])>0);title='With Calls';break;
    case 'paid':    filtered=rows.filter(r=>r['Source Name']==='Paid Data');title='Paid Data Converted';break;
  }
  showDrill(title+` (${filtered.length})`,filtered.map(fmt),hdrs);
}

// ── COMPARISON ────────────────────────────────────────────────
function buildCompCheckboxes(){
  compSelected=new Set(allOwners);
  const wrap=document.getElementById('compCheckboxes');if(!wrap)return;
  wrap.innerHTML=allOwners.map(o=>`<label class="comp-check-item checked" data-owner="${escHtml(o)}" onclick="toggleComp(this)"><span class="check-dot"></span>${escHtml(o)}</label>`).join('');
}
function toggleComp(el){const o=el.dataset.owner;if(compSelected.has(o)){compSelected.delete(o);el.classList.remove('checked');}else{compSelected.add(o);el.classList.add('checked');}renderSection('comparison');}

function renderComparison(){
  const metric=document.getElementById('compMetric')?.value||'leads';
  const d=getFiltered(),owners=[...compSelected];if(!owners.length)return;
  const allConv=getCompanyConverted();
  const fn={
    leads:  s=>s.length,
    calls:  s=>s.reduce((t,r)=>t+callCount(r),0),
    visits: s=>s.filter(r=>r['IsSiteVisitDone']==='Yes').length,
    revisit:s=>s.filter(r=>(parseInt(r['Site Visit Done Count'])||0)>1).length,
    converted:s=>{const os=new Set(s.map(r=>r['Owner Name']));return allConv.filter(r=>os.has(r['Owner Name'])).length;},
    inactive:s=>s.filter(r=>r['Status Name']==='Inactive').length,
    visitRate:s=>{const c=s.reduce((t,r)=>t+callCount(r),0);const v=s.filter(r=>r['IsSiteVisitDone']==='Yes').length;return c?Math.round(v/c*100):0;},
    closureRate:s=>{const v=s.filter(r=>r['IsSiteVisitDone']==='Yes').length;const os=new Set(s.map(r=>r['Owner Name']));const cv=allConv.filter(r=>os.has(r['Owner Name'])).length;return v?Math.round(cv/v*100):0;},
  }[metric]||(s=>s.length);

  const vals=owners.map(o=>fn(d.filter(r=>r['Owner Name']===o))),maxVal=Math.max(...vals,0);
  document.getElementById('compScorecard').innerHTML=owners.map((o,i)=>`<div class="comp-score-card" style="border-left-color:${PALETTE[i%PALETTE.length]}"><div class="cs-name">${escHtml(o)}</div><div class="cs-val">${vals[i]}${['visitRate','closureRate'].includes(metric)?'%':''}</div><div class="cs-sub">${metric}</div></div>`).join('');

  mkChart('compBarChart','bar',owners,owners.map((_,i)=>vals[i]),{
    ds:{backgroundColor:owners.map((_,i)=>PALETTE[i%PALETTE.length]),borderWidth:0},
    dl:{display:true,anchor:'end',align:'end',color:'#334155',font:{weight:'700',size:12,family:FONT}},
    single:false,extra:{plugins:{legend:{display:false}}}
  });
  mkChart('compPieChart','doughnut',owners,vals,{dl:{display:true,formatter:v=>v,color:'#fff',font:{weight:'700',size:12}}});

  const tMap=buildTimeSeries(d.filter(r=>owners.includes(r['Owner Name'])),'Created Date','Owner Name'),tKeys=sortBuckets(Object.keys(tMap));
  const tDS=owners.map((o,i)=>({label:o,data:tKeys.map(k=>(tMap[k]&&tMap[k][o])||0),borderColor:PALETTE[i%PALETTE.length],backgroundColor:'transparent',borderWidth:2,tension:.4,pointRadius:3,fill:false}));
  mkScrollChart('compTrendWrap','line',tKeys,tDS,{});

  // Conversion comparison extra chart
  const convByOwner={};allConv.forEach(r=>{const o=r['Owner Name']||'Unknown';convByOwner[o]=(convByOwner[o]||0)+1;});
  mkChart('compConvChart','bar',owners,owners.map(o=>convByOwner[o]||0),{
    ds:{backgroundColor:owners.map((_,i)=>PALETTE[i%PALETTE.length]),borderWidth:0},
    dl:{display:true,anchor:'end',align:'end',color:'#334155',font:{weight:'700',size:12}},
    single:false,extra:{plugins:{legend:{display:false}}}
  });

  fillTable('compTable',['Employee','Leads','Calls','Visits','Revisits','Converted','Visit Rate %','Closure Rate %','vs Top'],
    owners.map((o,i)=>{
      const sub=d.filter(r=>r['Owner Name']===o);
      const os=new Set([o]);
      const cv=allConv.filter(r=>r['Owner Name']===o).length;
      const vis=sub.filter(r=>r['IsSiteVisitDone']==='Yes').length;
      const calls=sub.reduce((t,r)=>t+callCount(r),0);
      const vr=calls?Math.round(vis/calls*100):0;
      const cr=vis?Math.round(cv/vis*100):0;
      return[escHtml(o),sub.length,calls,vis,sub.filter(r=>(parseInt(r['Site Visit Done Count'])||0)>1).length,cv,vr+'%',cr+'%',
        vals[i]===maxVal&&maxVal>0?'<span class="badge b-green">Top</span>':`<span class="badge b-grey">${maxVal?Math.round(vals[i]/maxVal*100):0}%</span>`];
    })
  );
}

// ── LIFECYCLE ─────────────────────────────────────────────────
function renderLifecycle(){
  const d=getFiltered();
  const allConv=getCompanyConverted();
  const total      =d.length;
  const active     =d.filter(r=>!['Inactive'].includes(r['Status Name'])).length;
  const totalCalls =d.reduce((s,r)=>s+callCount(r),0);
  const visited    =d.filter(r=>r['IsSiteVisitDone']==='Yes').length;
  const revisited  =d.filter(r=>(parseInt(r['Site Visit Done Count'])||0)>1).length;
  const warm       =d.filter(r=>r['Status Name']==='Warm').length;
  const hot        =d.filter(r=>r['Status Name']==='Hot').length;
  const converted  =allConv.length;
  const visitRate  =totalCalls>0?Math.round(visited/totalCalls*100):0;
  const revisitRate=visited>0?Math.round(revisited/visited*100):0;
  const closureRate=visited>0?Math.round(converted/visited*100):0;

  const stages=[
    {id:'lc-received',icon:'inbox',label:'Leads Received',val:total,color:'#2563eb',desc:'Total leads in the system',pct:100,drillFn:'drillLC("all")'},
    {id:'lc-active',icon:'zap',label:'Active Leads',val:active,color:'#8b5cf6',desc:'Not marked inactive',pct:total?Math.round(active/total*100):0,drillFn:'drillLC("active")'},
    {id:'lc-called',icon:'phone',label:'Calls Made',val:totalCalls,color:'#0891b2',desc:'Total call attempts',pct:null,drillFn:'drillLC("called")'},
    {id:'lc-visited',icon:'map-pin',label:'Site Visits',val:visited,color:'#059669',desc:`Visit rate: ${visitRate}% of calls`,pct:visitRate,drillFn:'drillLC("visited")'},
    {id:'lc-revisit',icon:'refresh-cw',label:'Re-Visits',val:revisited,color:'#f59e0b',desc:`Revisit rate: ${revisitRate}% of visits`,pct:revisitRate,drillFn:'drillLC("revisit")'},
    {id:'lc-warm',icon:'thermometer',label:'Warm Cases',val:warm,color:'#f97316',desc:'Showing genuine interest',pct:total?Math.round(warm/total*100):0,drillFn:'drillLC("warm")'},
    {id:'lc-hot',icon:'flame',label:'Hot Cases',val:hot,color:'#dc2626',desc:'Ready to close',pct:total?Math.round(hot/total*100):0,drillFn:'drillLC("hot")'},
    {id:'lc-closed',icon:'check-circle',label:'Closures',val:converted,color:'#10b981',desc:`Closure rate: ${closureRate}% of visits`,pct:closureRate,drillFn:'drillLC("closed")'},
  ];

  const lcWrap=document.getElementById('lifecycleStages');
  if(!lcWrap)return;
  lcWrap.innerHTML=stages.map((s,i)=>`
    <div class="lc-stage" onclick="${s.drillFn}" style="--stage-color:${s.color};animation-delay:${i*0.08}s">
      <div class="lc-connector${i===0?' lc-connector-first':''}"></div>
      <div class="lc-node">
        <div class="lc-icon-wrap" style="background:${s.color}15;border-color:${s.color}40">
          <i data-lucide="${s.icon}" style="color:${s.color};width:22px;height:22px"></i>
        </div>
        <div class="lc-body">
          <div class="lc-val" style="color:${s.color}">${s.val.toLocaleString()}</div>
          <div class="lc-label">${s.label}</div>
          <div class="lc-desc">${s.desc}</div>
          ${s.pct!==null?`<div class="lc-bar-wrap"><div class="lc-bar" style="width:${Math.min(s.pct,100)}%;background:${s.color}"></div></div><div class="lc-pct">${s.pct}%</div>`:''}
        </div>
        <div class="lc-drill-hint"><i data-lucide="mouse-pointer-click" style="width:12px;height:12px;opacity:.4"></i></div>
      </div>
      ${i<stages.length-1?`<div class="lc-arrow" style="border-top-color:${s.color}30"><i data-lucide="chevron-down" style="color:${s.color};opacity:.5;width:16px;height:16px"></i></div>`:''}
    </div>`).join('');

  // Mascot
  const mascot=document.getElementById('lcMascot');
  if(mascot)mascot.innerHTML=buildMascot(closureRate);

  // Summary chart
  const labels=stages.filter(s=>s.pct!==null).map(s=>s.label);
  const vals=stages.filter(s=>s.pct!==null).map(s=>s.pct);
  const colors=stages.filter(s=>s.pct!==null).map(s=>s.color);
  mkChart('lifecycleChart','bar',labels,vals,{
    single:false,
    ds:{backgroundColor:colors,borderWidth:0},
    dl:{display:true,anchor:'end',align:'end',color:'#334155',font:{weight:'700',size:11}},
    extra:{plugins:{legend:{display:false}},scales:{y:{max:100,ticks:{callback:v=>v+'%'}}}}
  });

  lucide.createIcons();
}
function drillLC(type){
  const d=getFiltered();const allConv=getCompanyConverted();let rows=[],title='';
  switch(type){
    case 'all':     rows=d;title='All Leads Received';break;
    case 'active':  rows=d.filter(r=>r['Status Name']!=='Inactive');title='Active Leads';break;
    case 'called':  rows=d.filter(r=>callCount(r)>0);title='Leads with Calls Made';break;
    case 'visited': rows=d.filter(r=>r['IsSiteVisitDone']==='Yes');title='Site Visit Done';break;
    case 'revisit': rows=d.filter(r=>(parseInt(r['Site Visit Done Count'])||0)>1);title='Revisit Leads';break;
    case 'warm':    rows=d.filter(r=>r['Status Name']==='Warm');title='Warm Cases';break;
    case 'hot':     rows=d.filter(r=>r['Status Name']==='Hot');title='Hot Cases';break;
    case 'closed':
      rows=allConv.map(r=>({...r,'FirstName':r['FirstName']||r['CustomerName']||''}));
      title='Closed/Converted Leads';break;
  }
  showDrill(title+` (${rows.length})`,rows.map(leadRow),LEAD_H);
}

function buildMascot(closureRate){
  const mood=closureRate>=20?'happy':closureRate>=10?'neutral':'thinking';
  const expressions={
    happy:`<circle cx="14" cy="14" r="2" fill="#10b981"/><circle cx="22" cy="14" r="2" fill="#10b981"/><path d="M10 20 Q18 26 26 20" stroke="#10b981" stroke-width="2" fill="none" stroke-linecap="round"/>`,
    neutral:`<circle cx="14" cy="14" r="2" fill="#f59e0b"/><circle cx="22" cy="14" r="2" fill="#f59e0b"/><line x1="11" y1="21" x2="25" y2="21" stroke="#f59e0b" stroke-width="2" stroke-linecap="round"/>`,
    thinking:`<circle cx="14" cy="14" r="2" fill="#3b82f6"/><circle cx="22" cy="14" r="2" fill="#3b82f6"/><path d="M26 20 Q18 16 10 20" stroke="#3b82f6" stroke-width="2" fill="none" stroke-linecap="round"/><circle cx="29" cy="10" r="1.5" fill="#3b82f6" opacity=".6"/><circle cx="32" cy="7" r="2.5" fill="#3b82f6" opacity=".4"/>`
  };
  const msgs={happy:'🏆 Outstanding! High closure rate!',neutral:'📈 Getting there! Keep pushing!',thinking:'💡 Focus on visit-to-close conversions'};
  return`
  <div class="lc-mascot-wrap">
    <svg class="lc-mascot-svg" viewBox="0 0 140 160" xmlns="http://www.w3.org/2000/svg">
      <!-- House body -->
      <rect x="30" y="75" width="80" height="70" rx="4" fill="#dbeafe" class="lc-house-body"/>
      <!-- Roof -->
      <polygon points="20,78 70,30 120,78" fill="#2563eb" class="lc-roof"/>
      <!-- Door -->
      <rect x="55" y="110" width="30" height="35" rx="3" fill="#1d4ed8"/>
      <circle cx="80" cy="128" r="2.5" fill="#93c5fd"/>
      <!-- Windows -->
      <rect x="35" y="88" width="22" height="18" rx="3" fill="#93c5fd" opacity=".7"/>
      <rect x="83" y="88" width="22" height="18" rx="3" fill="#93c5fd" opacity=".7"/>
      <!-- Face on house -->
      <g class="lc-face" transform="translate(52,95)">${expressions[mood]}</g>
      <!-- Chimney with smoke -->
      <rect x="88" y="45" width="12" height="22" rx="2" fill="#1e3a5f" class="lc-chimney"/>
      <circle cx="94" cy="38" r="4" fill="#94a3b8" opacity=".4" class="lc-smoke s1"/>
      <circle cx="98" cy="30" r="3" fill="#94a3b8" opacity=".3" class="lc-smoke s2"/>
      <circle cx="92" cy="23" r="2.5" fill="#94a3b8" opacity=".2" class="lc-smoke s3"/>
      <!-- Path/walkway -->
      <path d="M55 145 L85 145 L90 158 L50 158 Z" fill="#cbd5e1"/>
      <!-- Stars (for happy) -->
      ${mood==='happy'?`<text x="8" y="50" font-size="14" class="lc-star s1">⭐</text><text x="110" y="45" font-size="12" class="lc-star s2">✨</text>`:''}
    </svg>
    <div class="lc-mascot-msg">${msgs[mood]}</div>
    <div class="lc-closure-pill">Closure Rate: <strong>${closureRate}%</strong></div>
  </div>`;
}

// ── ALL LEADS ─────────────────────────────────────────────────
function renderLeadsTable(){
  const search=(document.getElementById('tableSearch')?.value||'').toLowerCase().trim();
  const d=getFiltered().filter(r=>{if(!search)return true;return(`${r['FirstName']}${r['LastName']}${r['Mobile No.']}${r['Email Id']}${r['Project Name']}${r['Status Name']}${r['Source Name']}${r['Owner Name']}`).toLowerCase().includes(search);});
  setBadge('allLeadsCount',d.length);
  const pg=getPg('allLeads');
  const rows=d.slice((pg.page-1)*pg.size,pg.page*pg.size).map(r=>[
    `${r['FirstName']||''} ${r['LastName']||''}`.trim()||'—',
    `<span class="mono">${escHtml(r['Mobile No.']||'—')}</span>`,
    r['Email Id']?`<span style="font-size:11px">${escHtml(r['Email Id'])}</span>`:'—',
    escHtml(r['Project Name']||'—'),escHtml(r['Property Type']||'—'),
    escHtml(r['Property Location']||'—'),badge(r['Status Name']),
    escHtml(r['Source Name']||'—'),escHtml(r['Owner Name']||'—'),
    `<span class="mono">${callCount(r)}</span>`,
    r['IsSiteVisitDone']==='Yes'?'<span class="badge b-green">Yes</span>':'<span class="badge b-grey">No</span>',
    `<span class="mono" style="font-size:11px">${escHtml((r['Created Date']||'').split(' ')[0]||'—')}</span>`,
  ]);
  fillTable('allLeadsTable',['Name','Mobile','Email','Project','BHK','Location','Status','Source','Owner','Calls','Visited','Created'],rows,
    ['Total: '+d.length,'','','','','','','','',d.reduce((s,r)=>s+callCount(r),0),'','']);
  renderPagination('pagination','allLeads',d.length);
}
function debouncedLeadsRender(){clearTimeout(_searchTimer);_searchTimer=setTimeout(()=>{resetPg('allLeads');renderLeadsTable();lucide.createIcons();},200);}

// ── UI STATES ─────────────────────────────────────────────────
function showLoading(){document.getElementById('loadingScreen').style.display='flex';document.getElementById('errorScreen').style.display='none';document.getElementById('dashboard').style.display='none';}
function showDashboard(){
  document.getElementById('loadingScreen').style.display='none';
  document.getElementById('errorScreen').style.display='none';
  const db=document.getElementById('dashboard');
  db.style.opacity='0';db.style.display='block';
  requestAnimationFrame(()=>{db.style.transition='opacity .3s ease';db.style.opacity='1';});
  lucide.createIcons();
}
function showError(msg){document.getElementById('loadingScreen').style.display='none';document.getElementById('errorScreen').style.display='flex';document.getElementById('dashboard').style.display='none';const el=document.getElementById('errorMsg');if(el){el.style.whiteSpace='pre-wrap';el.style.maxWidth='520px';el.textContent=msg;}lucide.createIcons();}
