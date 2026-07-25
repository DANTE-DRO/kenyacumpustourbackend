/* ==========================================================================
   KCT Awards - Admin Panel JS
   Single-page admin dashboard with animations and toast notifications.
========================================================================== */

const API = ''; // same origin

// ---------- Toast ----------
const toastEl = document.getElementById('toast');
function toast(msg, type='info'){
  toastEl.textContent = msg;
  toastEl.className = 'toast show ' + type;
  clearTimeout(window.__t);
  window.__t = setTimeout(()=>toastEl.classList.remove('show'), 3500);
}

async function api(path, opts={}){
  const res = await fetch(API + path, {
    ...opts,
    credentials: 'include',
    headers: { 'Content-Type':'application/json', ...(opts.headers||{}) }
  });
  const data = await res.json().catch(()=>({}));
  if(!res.ok) throw new Error(data.error || ('HTTP '+res.status));
  return data;
}

// ---------- Auth ----------
const loginScreen = document.getElementById('loginScreen');
const app         = document.getElementById('app');

async function checkAuth(){
  try {
    const me = await api('/api/admin/me');
    document.getElementById('adminUser').textContent = me.user;
    loginScreen.classList.add('hidden');
    app.classList.remove('hidden');
    loadDashboard();
    return true;
  } catch { return false; }
}

document.getElementById('loginForm').addEventListener('submit', async e => {
  e.preventDefault();
  const username = document.getElementById('username').value.trim();
  const password = document.getElementById('password').value;
  const errEl = document.getElementById('loginError');
  errEl.textContent = '';
  try {
    await api('/api/admin/login', { method:'POST', body: JSON.stringify({ username, password }) });
    await checkAuth();
  } catch(err) {
    errEl.textContent = err.message || 'Login failed';
  }
});

document.getElementById('logoutBtn').addEventListener('click', async () => {
  await api('/api/admin/logout', { method:'POST' });
  location.reload();
});

// ---------- Navigation ----------
const pageTitles = {
  dashboard:    ['Dashboard',    'Overview of your awards platform'],
  nominees:     ['Nominees',     'Manage all registered nominees'],
  votes:        ['Votes',        'All vote transactions - past & present'],
  voters:       ['Voters',       'Aggregated voter information'],
  transactions: ['Transactions', 'Raw KCB callback log'],
  wallet:       ['Wallet',       'Financial balance and manual adjustments'],
  settings:     ['Settings',     'Platform configuration']
};
document.querySelectorAll('.menu-item').forEach(item => {
  item.addEventListener('click', () => switchPage(item.dataset.page));
});
function switchPage(p){
  document.querySelectorAll('.menu-item').forEach(i => i.classList.toggle('active', i.dataset.page===p));
  document.querySelectorAll('.page').forEach(pg => pg.classList.toggle('active', pg.id==='page-'+p));
  document.getElementById('pageTitle').textContent = pageTitles[p][0];
  document.getElementById('pageCrumb').textContent = pageTitles[p][1];
  const loaders = { dashboard:loadDashboard, nominees:loadNominees, votes:loadVotes, voters:loadVoters, transactions:loadTransactions, wallet:loadWallet, settings:loadSettings };
  loaders[p] && loaders[p]();
}

// ---------- Dashboard ----------
async function loadDashboard(){
  try {
    const s = await api('/api/admin/stats');
    document.getElementById('s-nominees').textContent = s.totalNominees;
    document.getElementById('s-votes').textContent    = s.totalVotesCast;
    document.getElementById('s-wallet').textContent   = 'KES ' + (s.walletBalance||0).toLocaleString();
    document.getElementById('s-days').textContent     = s.daysLeft;
    document.getElementById('s-success').textContent  = s.successfulTx;
    document.getElementById('s-pending').textContent  = s.pendingTx;
    document.getElementById('s-failed').textContent   = s.failedTx;
    document.getElementById('s-categories').textContent = s.totalCategories;
    document.getElementById('tglRegistration').checked = s.registrationOpen;
    document.getElementById('tglVoting').checked       = s.votingActive;

    // Top nominees
    const noms = await api('/api/admin/nominees');
    const top = noms.slice().sort((a,b)=>(b.votes||0)-(a.votes||0)).slice(0,5);
    const list = document.getElementById('topNominees');
    if(!top.length) { list.innerHTML = '<p class="muted">No nominees yet</p>'; }
    else list.innerHTML = top.map((n,i)=>`
      <div class="top-item">
        <div class="top-rank">${i+1}</div>
        <div class="top-info"><div class="top-name">${escapeHtml(n.name)}</div>
          <div class="top-cat">${humanCat(n.category)}${n.university?' · '+escapeHtml(n.university):''}</div>
        </div>
        <div class="top-votes">${n.votes||0}</div>
      </div>`).join('');
  } catch(e){ toast(e.message,'error'); }
}
document.getElementById('tglRegistration').addEventListener('change', async e => {
  try { await api('/api/admin/settings',{ method:'PUT', body: JSON.stringify({ registrationOpen: e.target.checked }) });
    toast('Registration '+(e.target.checked?'opened':'closed'),'success'); } catch(x){toast(x.message,'error')}
});
document.getElementById('tglVoting').addEventListener('change', async e => {
  try { await api('/api/admin/settings',{ method:'PUT', body: JSON.stringify({ votingActive: e.target.checked }) });
    toast('Voting '+(e.target.checked?'activated':'paused'),'success'); } catch(x){toast(x.message,'error')}
});

// ---------- Nominees ----------
let __nominees = [];
async function loadNominees(){
  try {
    __nominees = await api('/api/admin/nominees');
    renderNominees(__nominees);
  } catch(e){ toast(e.message,'error'); }
}
document.getElementById('nomineeSearch').addEventListener('input', e => {
  const q = e.target.value.toLowerCase();
  renderNominees(__nominees.filter(n =>
    (n.name||'').toLowerCase().includes(q) ||
    (n.category||'').toLowerCase().includes(q) ||
    (n.university||'').toLowerCase().includes(q)
  ));
});
function renderNominees(list){
  const tbody = document.getElementById('nomineesTable');
  if(!list.length) { tbody.innerHTML = '<tr><td colspan="6" class="muted" style="text-align:center;padding:24px">No nominees</td></tr>'; return; }
  tbody.innerHTML = list.map(n => `
    <tr>
      <td><b>${escapeHtml(n.name)}</b><br><small class="muted">${escapeHtml(n.email||'')}</small></td>
      <td>${humanCat(n.category)}</td>
      <td>${escapeHtml(n.university||'-')}</td>
      <td>${escapeHtml(n.phone||'-')}</td>
      <td><b style="color:var(--gold)">${n.votes||0}</b></td>
      <td>
        <button class="action-btn" onclick="addVotes('${n.id}','${escapeJs(n.name)}')"><i class="fas fa-plus"></i> Votes</button>
        <button class="action-btn danger" onclick="delNominee('${n.id}','${escapeJs(n.name)}')"><i class="fas fa-trash"></i></button>
      </td>
    </tr>`).join('');
}
async function delNominee(id, name){
  if(!confirm('Delete "'+name+'"?')) return;
  try { await api('/api/admin/nominees/'+id, { method:'DELETE' }); toast('Deleted','success'); loadNominees(); } catch(e){toast(e.message,'error')}
}
async function addVotes(id, name){
  const n = prompt('Add how many votes to "'+name+'"? (negative to subtract)', '10');
  if(!n) return;
  try { await api('/api/admin/nominees/'+id+'/add-votes',{ method:'POST', body: JSON.stringify({ votes: parseInt(n,10) }) });
    toast('Votes updated','success'); loadNominees(); } catch(e){toast(e.message,'error')}
}

// ---------- Votes ----------
async function loadVotes(){
  try {
    const votes = await api('/api/admin/votes');
    const tbody = document.getElementById('votesTable');
    if(!votes.length){ tbody.innerHTML = '<tr><td colspan="6" class="muted" style="text-align:center;padding:24px">No votes yet</td></tr>'; return; }
    tbody.innerHTML = votes.map(v => `
      <tr>
        <td>${new Date(v.createdAt).toLocaleString()}</td>
        <td>${escapeHtml(v.nomineeName||'-')}</td>
        <td>KES ${v.amount}</td>
        <td>${escapeHtml(v.phone||'-')}</td>
        <td><span class="badge ${v.status.toLowerCase()}">${v.status}</span></td>
        <td><small>${escapeHtml(v.transactionId||v.checkoutRequestID||'-')}</small></td>
      </tr>`).join('');
  } catch(e){ toast(e.message,'error'); }
}

// ---------- Voters ----------
async function loadVoters(){
  try {
    const voters = await api('/api/admin/voters');
    const tbody = document.getElementById('votersTable');
    if(!voters.length){ tbody.innerHTML = '<tr><td colspan="4" class="muted" style="text-align:center;padding:24px">No voters yet</td></tr>'; return; }
    tbody.innerHTML = voters.map(v => `
      <tr>
        <td><b>${escapeHtml(v.phone)}</b></td>
        <td>${v.totalVotes||0}</td>
        <td>KES ${v.totalAmount||0}</td>
        <td>${v.lastVoteAt ? new Date(v.lastVoteAt).toLocaleString() : '-'}</td>
      </tr>`).join('');
  } catch(e){ toast(e.message,'error'); }
}

// ---------- Transactions ----------
async function loadTransactions(){
  try {
    const txs = await api('/api/admin/transactions');
    const list = document.getElementById('txList');
    if(!txs.length){ list.innerHTML = '<p class="muted">No callback transactions logged yet</p>'; return; }
    list.innerHTML = txs.map(t => `
      <div class="tx-item">
        <div class="tx-time">${new Date(t.receivedAt).toLocaleString()}</div>
        <pre>${escapeHtml(JSON.stringify(t.body, null, 2))}</pre>
      </div>`).join('');
  } catch(e){ toast(e.message,'error'); }
}

// ---------- Wallet ----------
async function loadWallet(){
  try {
    const s = await api('/api/admin/stats');
    document.getElementById('walletBig').textContent = 'KES ' + (s.walletBalance||0).toLocaleString();
    document.getElementById('walletSuccess').textContent = s.successfulTx || 0;
    document.getElementById('walletSetTo').value = s.walletBalance || 0;
  } catch(e){ toast(e.message,'error'); }
}
document.getElementById('btnSetWallet').addEventListener('click', async () => {
  const v = parseFloat(document.getElementById('walletSetTo').value);
  if(isNaN(v)) return toast('Enter a number','error');
  try { await api('/api/admin/settings',{ method:'PUT', body: JSON.stringify({ walletBalance: v }) });
    toast('Wallet updated','success'); loadWallet(); } catch(e){toast(e.message,'error')}
});

// ---------- Settings ----------
async function loadSettings(){
  try {
    const s = await api('/api/admin/settings');
    document.getElementById('setDays').value  = s.registrationDaysTotal;
    document.getElementById('setStart').value = (s.registrationStartDate||'').substring(0,10);
    document.getElementById('setRegOpen').checked      = s.registrationOpen;
    document.getElementById('setVotingActive').checked = s.votingActive;
  } catch(e){ toast(e.message,'error'); }
}
document.getElementById('btnSaveDays').addEventListener('click', async () => {
  const days  = parseInt(document.getElementById('setDays').value,10);
  const start = document.getElementById('setStart').value;
  try { await api('/api/admin/settings',{ method:'PUT', body: JSON.stringify({
    registrationDaysTotal: days, registrationStartDate: start ? new Date(start).toISOString() : new Date().toISOString() }) });
    toast('Registration period saved','success'); loadSettings(); } catch(e){toast(e.message,'error')}
});
document.getElementById('btnResetDays').addEventListener('click', async () => {
  if(!confirm('Reset registration to today + 30 days?')) return;
  try { await api('/api/admin/settings/reset-days',{ method:'POST', body: JSON.stringify({ days: 30 }) });
    toast('Reset done','success'); loadSettings(); } catch(e){toast(e.message,'error')}
});
document.getElementById('btnSaveState').addEventListener('click', async () => {
  const registrationOpen = document.getElementById('setRegOpen').checked;
  const votingActive     = document.getElementById('setVotingActive').checked;
  try { await api('/api/admin/settings',{ method:'PUT', body: JSON.stringify({ registrationOpen, votingActive }) });
    toast('State saved','success'); } catch(e){toast(e.message,'error')}
});

// ---------- Helpers ----------
function escapeHtml(s){ return String(s??'').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function escapeJs(s){ return String(s??'').replace(/'/g,"\\'"); }
function humanCat(id){
  const map = {
    best_university:'Best University', best_influencer:'Best Influencer', best_photographer:'Best Photographer',
    best_student_leader:'Best Student Leader', best_mr_university:'Best Mr. University', best_mrs_university:'Best Mrs./Miss University',
    best_dance_crew:'Best Dance Crew', best_mca_karingani:'Best MCA - Karingani', best_cyber_branding:'Best Cyber & Branding'
  }; return map[id] || id;
}

// ---------- Init ----------
checkAuth();
