// Ledger Frontend (Option A) — static site that calls Apps Script JSON API
const apiBase = 'https://script.google.com/macros/s/AKfycby6cg6hsyam7eIuSV4P2Vonc3QPTJ-3cHMEyqh8qOxzXa9Jis1mZYWJFFnAUIuGON7lsA/exec';
const apiToken = 'kdfj39fh_12AF!98'; // set same token in Apps Script Properties
const headers = {'Authorization': 'Bearer ' + apiToken};

// State
let currentTicket = null;
let lastFive = null;
let accountsMeta = null;

const el = (id) => document.getElementById(id);

function formatMoney(n){
  if (n === null || n === undefined || isNaN(n)) return '--';
  const sign = n < 0 ? '-' : '';
  const v = Math.abs(n).toLocaleString(undefined,{maximumFractionDigits:0});
  return sign + '$' + v;
}
function pctChip(node, cur, prev){
  if (prev === 0 || prev === null || prev === undefined){ node.textContent='--'; node.className='delta-chip'; return; }
  const d = (cur - prev) / Math.abs(prev);
  const pct = (d*100).toFixed(1) + '%';
  node.textContent = (d>=0?'▲ ':'▼ ') + pct;
  node.className = 'delta-chip ' + (d>=0?'up':'down');
}

// Long press helper
function onLongPress(target, callback, ms=700){
  let timer;
  target.addEventListener('touchstart', () => { timer = setTimeout(callback, ms); }, {passive:true});
  target.addEventListener('touchend', () => clearTimeout(timer), {passive:true});
  target.addEventListener('mousedown', () => { timer = setTimeout(callback, ms); });
  target.addEventListener('mouseup', () => clearTimeout(timer));
}

// Charts
let pieChart, barChart;
function renderCharts(latest, series){
  const pieCtx = document.getElementById('pieChart');
  const barCtx = document.getElementById('barChart');

  const pieData = latest.lines.map(l=>{
    const acct = accountsMeta[l.accountId] || {label:l.accountId};
    // assets use Amount as-is, debts use ABS
    const v = (l.type==='CreditCard' || l.type==='Loan') ? Math.abs(l.amount) : l.amount;
    return {label: acct.label, value: Math.max(0, v)};
  }).filter(x=>x.value>0);

  if (pieChart) pieChart.destroy();
  pieChart = new Chart(pieCtx, {
    type:'pie',
    data:{
      labels: pieData.map(d=>d.label),
      datasets:[{ data: pieData.map(d=>d.value) }]
    },
    options:{ responsive:true, plugins:{legend:{position:'bottom'}}}
  });

  if (barChart) barChart.destroy();
  barChart = new Chart(barCtx, {
    type:'bar',
    data:{
      labels: series.dates,
      datasets:[
        {label:'Debt', data: series.debt, stack:'stack0'},
        {label:'Cash', data: series.cash, stack:'stack0'},
        {label:'Avail', data: series.avail, stack:'stack0'}
      ]
    },
    options:{
      responsive:true,
      scales:{x:{stacked:false}, y:{beginAtZero:true}},
      plugins:{legend:{position:'bottom'}}
    }
  });
}

function zeroCenteredBar(span, delta){
  const inner = span.querySelector('.bar-inner');
  const maxAbs = 1; // normalized relative bar; UI only
  const widthPct = Math.min(100, Math.abs(delta)*100);
  inner.style.width = widthPct + '%';
  inner.style.transform = delta>=0 ? 'translateX(50%)' : 'translateX(50%) scaleX(-1)';
  inner.style.background = delta>=0 ? 'var(--green)' : 'var(--red)';
}

// Build ticket groups/rows
function renderTicket(t){
  currentTicket = t;
  el('ticketDate').textContent = t.ticket.date;

  // Headline numbers (numbers only)
  el('netWorth').textContent = formatMoney(t.totals.netWorth);
  el('assets').textContent   = formatMoney(t.totals.assets);
  el('debts').textContent    = formatMoney(t.totals.debts);
  pctChip(el('assetsDelta'), t.totals.assets, t.prevTotals.assets);
  pctChip(el('debtsDelta'),  t.totals.debts,  t.prevTotals.debts);

  const container = el('ticketView');
  container.innerHTML='';
  const byGroup = {Bank:[], CreditCard:[], Loan:[], Investment:[]};
  t.lines.forEach(l => byGroup[l.type]?.push(l));

  const groupTemplate = document.getElementById('groupTemplate');
  const rowTemplate = document.getElementById('rowTemplate');

  function addGroup(title, arr){
    if (!arr || !arr.length) return;
    const g = groupTemplate.content.firstElementChild.cloneNode(true);
    g.querySelector('.group-title').textContent = title;
    const rows = g.querySelector('.rows');
    arr.forEach(l=>{
      const acct = accountsMeta[l.accountId] || {label:l.accountId, limit:null, apr:null};
      const r = rowTemplate.content.firstElementChild.cloneNode(true);
      r.querySelector('.label').textContent = acct.label;
      r.querySelector('.value').textContent = formatMoney(l.amount);
      r.querySelector('.limit').textContent = acct.limit ? 'Limit ' + formatMoney(acct.limit) : '';
      r.querySelector('.apr').textContent = acct.apr ? (acct.apr*100).toFixed(1) + '% APR' : '';
      const avail = (l.type==='CreditCard') ? (acct.limit ? (acct.limit - Math.abs(l.amount)) : (l.availableCredit ?? null)) : null;
      r.querySelector('.avail').textContent = (avail!=null) ? ('Avail ' + formatMoney(avail)) : '';
      // per-card delta
      const d = (l.prevAmount==null) ? 0 : (l.amount - l.prevAmount);
      const chip = r.querySelector('.delta-chip');
      const text = d>=0 ? ('▲ ' + formatMoney(Math.abs(d)) + ' paid') : ('▼ ' + formatMoney(Math.abs(d)) + ' added');
      chip.textContent = text;
      chip.className = 'delta-chip small ' + (d>=0?'up':'down');
      zeroCenteredBar(r.querySelector('.delta-bar'), d);
      rows.appendChild(r);
    });
    container.appendChild(g);
  }

  addGroup('Bank', byGroup.Bank);
  addGroup('Credit Cards', byGroup.CreditCard);
  addGroup('Loans', byGroup.Loan);
  addGroup('Investments', byGroup.Investment);

  // Cards aggregate footer
  const footer = document.getElementById('cardsFooter');
  const cd = t.cardsDelta ?? 0;
  const cdText = cd>=0 ? `Credit Cards: +${formatMoney(Math.abs(cd))} paid`
                       : `Credit Cards: -${formatMoney(Math.abs(cd))} added`;
  footer.innerHTML = `<div class="summary"><strong>${cdText}</strong>
    <span class="delta-bar"><span class="bar-inner"></span></span></div>`;
  zeroCenteredBar(footer.querySelector('.delta-bar'), cd);
}

// Fetch helpers
async function getJSON(path){
  const r = await fetch(apiBase + path, {headers});
  if(!r.ok) throw new Error('HTTP '+r.status);
  return await r.json();
}

async function load(){
  // accounts meta
  const meta = await getJSON('?route=accounts');
  accountsMeta = meta.reduce((acc, a)=>{
    acc[a.accountId] = {label:a.label, type:a.type, limit:a.limit, apr:a.apr};
    return acc;
  },{});

  const latest = await getJSON('?route=ticketLatest');
  const series = await getJSON('?route=seriesLast5');
  lastFive = series;
  renderTicket(latest);
  renderCharts(latest, series);

  // pager
  el('prevBtn').onclick = async()=>{
    const t = await getJSON(`?route=ticketPrev&date=${encodeURIComponent(currentTicket.ticket.date)}`);
    if (t) renderTicket(t);
  };
  el('nextBtn').onclick = async()=>{
    const t = await getJSON(`?route=ticketNext&date=${encodeURIComponent(currentTicket.ticket.date)}`);
    if (t) renderTicket(t);
  };

  // edit
  const enterEdit = ()=>toggleEdit(true);
  onLongPress(document.body, enterEdit, 750);
  el('editBtn').onclick = enterEdit;
}

function toggleEdit(editing){
  const main = el('ticketView');
  if (editing && main.dataset.mode==='view'){
    // turn values into inputs
    main.querySelectorAll('.row').forEach(row=>{
      const valueEl = row.querySelector('.value');
      const cur = valueEl.textContent;
      const n = parseFloat(cur.replace(/[^\d.-]/g,'')) || 0;
      const input = document.createElement('input');
      input.type='number'; input.step='1'; input.className='number input';
      input.value = n;
      valueEl.replaceChildren(input);
    });
    // show save
    const save = document.createElement('button');
    save.textContent='Save';
    save.className='btn primary';
    save.id='saveBtn';
    document.querySelector('.controls').appendChild(save);
    save.onclick = async ()=>{
      const dlg = el('saveDialog');
      dlg.showModal();
      const listener = (ev)=>{
        if (ev.target.returnValue==='confirm'){ doSave(); }
        dlg.removeEventListener('close', listener);
      };
      dlg.addEventListener('close', listener);
    };
    main.dataset.mode='edit';
  } else if (!editing && main.dataset.mode==='edit'){
    // revert (reload latest)
    load();
    main.dataset.mode='view';
  }
}

async function doSave(){
  // build lines from current UI order
  const groups = document.querySelectorAll('.group');
  const lines = [];
  groups.forEach(g=>{
    g.querySelectorAll('.row').forEach(r=>{
      const name = r.querySelector('.label').textContent.trim();
      const meta = Object.values(accountsMeta).find(a=>a.label===name);
      if (!meta) return;
      const val = parseFloat(r.querySelector('.value input').value || '0');
      lines.push({accountId:Object.keys(accountsMeta).find(k=>accountsMeta[k]===meta), amount:val});
    });
  });
  const body = {date: new Date().toISOString().slice(0,10), lines};
  const r = await fetch(apiBase+'?route=ticketCreate',{
    method:'POST',
    headers:{...headers,'Content-Type':'application/json'},
    body: JSON.stringify(body)
  });
  if(!r.ok){ alert('Save failed'); return; }
  await load();
}

window.addEventListener('DOMContentLoaded', load);
