"use strict";

let ROSTER = [];   // تُحمَّل من Firestore (meta/roster) ولا تُحفظ في المستودع
const START = new Date(2026, 8, 20);
const WEEKS = 15;
const DAYS = ['الأحد','الاثنين','الثلاثاء','الأربعاء','الخميس'];
const SLOT = {1:'المحاضرة الأولى',2:'المحاضرة الثانية 10:30',3:'المحاضرة الثالثة 12:30'};
const C = [
  ['sql-t','اساسيات قواعد البيانات SQL','نظري','ا.م.د. بيمان حسين',0,1,2],
  ['sql-p','اساسيات قواعد البيانات SQL','عملي','ا.م.د. بيمان حسين',1,1,2],
  ['php-t','تصميم المواقع الالكترونية متقدمة PHP','نظري','ا.م.د. عمار وسام',0,3,1],
  ['php-p','تصميم المواقع الالكترونية متقدمة PHP','عملي','ا.م.د. عمار وسام',2,2,1],
  ['np-t','برمجة الشبكات','نظري','م.د. عدنان عذاب',3,1,2],
  ['np-p','برمجة الشبكات','عملي','م.د. عدنان عذاب',4,1,2],
  ['sw-t','شبكات الحاسوب متقدمة Switching & Routing','نظري','م.م. ياسر حسن',4,2,1],
  ['sw-p','شبكات الحاسوب متقدمة Switching & Routing','عملي','م.م. ياسر حسن',3,2,1],
  ['sec-t','امن وتشفير المعلومات','نظري','م.د. ضياء صالح',2,1,3],
  ['eng-t','اللغة الإنجليزية لدراسات تكنولوجيا الكمبيوتر','نظري','م.د. علي خالد',2,3,2],
  ['bth-t','جرائم نظام البعث في العراق','نظري','م.م. حوراء كريم',1,2,1],
  ['ar-t','اللغة العربية','نظري','م. علي محسن',0,2,3],
].map(([id,name,type,teacher,day,sa,sb])=>({id,name,type,teacher,day,slot:{A:sa,B:sb}}));
const SHORT = {'sql-t':'SQL ن','sql-p':'SQL ع','php-t':'PHP ن','php-p':'PHP ع','np-t':'برمجة الشبكات ن','np-p':'برمجة الشبكات ع','sw-t':'الشبكات المتقدمة ن','sw-p':'الشبكات المتقدمة ع','sec-t':'أمن المعلومات','eng-t':'الإنجليزية','bth-t':'جرائم البعث','ar-t':'العربية'};

const TEACHERS = [...new Set(C.map(c => c.teacher))];
const HEAD_TEACHER = 'ا.م.د. عمار وسام';  // رئيس القسم: يطّلع على جميع المواد
const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const pad = n => String(n).padStart(2,'0');
const lecDate = (c,w) => { const d = new Date(START); d.setDate(d.getDate() + 7*(w-1) + c.day); return d; };
const fmt = d => `${pad(d.getDate())}/${pad(d.getMonth()+1)}`;
const today = new Date(); today.setHours(0,0,0,0);
const curWeek = Math.min(WEEKS, Math.max(1, Math.floor((today - START)/864e5/7) + 1));
const students = sec => ROSTER.filter(s => s[2] === sec);
const docId = (cid,sec,w) => `${cid}_${sec}_w${w}`;
const LBL = {P:'ح',A:'غ',E:'ج'};

let state = {
  cid: 'sql-t', sec: 'A', week: curWeek, tab: 'roll', confirmClear: false,
};
try { const s = JSON.parse(localStorage.getItem('att-ui')||'null'); if (s && C.some(c=>c.id===s.cid)) Object.assign(state, {cid:s.cid, sec:s.sec==='B'?'B':'A', tab:s.tab||'roll'}); } catch(e){}
// default week: the latest lecture of this subject that has happened
function defaultWeek(c){ let w = curWeek; if (lecDate(c,w) > today && w > 1) w--; return w; }
state.week = defaultWeek(C.find(c=>c.id===state.cid));
const saveUI = () => { try { localStorage.setItem('att-ui', JSON.stringify({cid:state.cid,sec:state.sec,tab:state.tab})); } catch(e){} };

// data: docId -> {m:{seq:'P'|'A'|'E'}}
const data = {};
const dirty = new Map(); // docId -> timer
const chains = {};
let db = null, canWrite = true, mode = 'connecting';
let ME = {teacher:null, all:false};           // all = يرى جميع المواد
const visible = () => ME.all ? C : C.filter(c => c.teacher === ME.teacher);
const editable = c => canWrite && (ME.owner || c.teacher === ME.teacher);

function setSync(kind, text){ const el = $('#sync'); el.className = 'chip sync ' + kind; $('#synctext').textContent = text; }
function marksOf(id){ return (data[id] && data[id].m) || {}; }

function setMark(seq, val){
  const id = docId(state.cid, state.sec, state.week);
  const d = data[id] || (data[id] = {m:{}});
  const m = {...d.m};
  if (val) m[seq] = val; else delete m[seq];
  data[id] = {...d, m};
  queueSave(id);
  render();
}
function setAll(val){
  const id = docId(state.cid, state.sec, state.week);
  const m = {};
  if (val) students(state.sec).forEach(s => m[s[0]] = val);
  data[id] = {...(data[id]||{}), m};
  queueSave(id);
  render();
}
function queueSave(id){
  if (!db) { persistLocal(); return; }
  clearTimeout(dirty.get(id));
  setSync('saving','جارٍ الحفظ…');
  dirty.set(id, setTimeout(() => {
    const body = { m: {...marksOf(id)}, c: id.split('_')[0], s: id.split('_')[1], w: +id.split('_w')[1], at: new Date().toISOString(), by: ME.email || '' };
    chains[id] = (chains[id] || Promise.resolve()).then(() => db.doc('att/' + id).set(body)).then(() => {
      dirty.delete(id);
      if (!dirty.size) setSync('live','محفوظ ومتزامن');
    }).catch(err => {
      dirty.delete(id);
      if (err && (err.code === 'invalid_argument' || err.code === 'permission-denied')) { canWrite = false; setSync('off','لا تملك صلاحية التعديل'); render(); }
      else setSync('off','تعذّر الحفظ، أعد المحاولة');
    });
  }, 600));
}
function persistLocal(){ try { localStorage.setItem('att-data', JSON.stringify(data)); } catch(e){} }

/* ---------- rendering ---------- */
function renderSubjects(){
  const groups = [];
  visible().forEach(c => { let g = groups.find(g=>g.t===c.teacher); if(!g) groups.push(g={t:c.teacher,items:[]}); g.items.push(c); });
  $('#subjects').innerHTML = groups.map(g => `<div class="tgroup"><div class="tname">${esc(g.t)}</div>${
    g.items.map(c => `<button class="sbtn" data-cid="${c.id}" aria-current="${c.id===state.cid}"><span>${esc(c.name.replace(/ (SQL|PHP|Switching & Routing)$/,''))}</span><span class="day">${DAYS[c.day]}</span><span class="tag">${c.type}</span></button>`).join('')
  }</div>`).join('');
}
function weekStats(c, sec, w){
  const m = marksOf(docId(c.id,sec,w)); const list = students(sec);
  let p=0,a=0,e=0; list.forEach(s => { const v=m[s[0]]; if(v==='P')p++; else if(v==='A')a++; else if(v==='E')e++; });
  return {p,a,e,u:list.length-p-a-e,n:list.length,taken:p+a+e>0};
}
function renderWeeks(c){
  let h = '<div class="weeks" role="group" aria-label="الأسابيع">';
  for (let w=1; w<=WEEKS; w++){
    const d = lecDate(c,w), st = weekStats(c,state.sec,w);
    const pct = st.taken ? Math.round(100*(st.p+st.e)/st.n) : 0;
    const cls = ['wk', w===curWeek?'now':'', d>today?'future':''].join(' ');
    h += `<button class="${cls}" data-week="${w}" aria-pressed="${w===state.week}" title="${DAYS[c.day]} ${fmt(d)}/2026${st.taken?` — حضور ${pct}%`:''}"><div class="n">أسبوع ${w}</div><div class="d num">${fmt(d)}</div><div class="bar"><i style="width:${pct}%"></i></div></button>`;
  }
  return h + '</div>';
}
function renderRoll(c){
  const id = docId(c.id,state.sec,state.week), m = marksOf(id), st = weekStats(c,state.sec,state.week);
  const d = lecDate(c,state.week);
  const canEd = editable(c); const dis = canEd ? '' : 'disabled';
  let h = renderWeeks(c);
  h += `<section class="panel"><div class="panelhead">
    <div class="lecinfo">الأسبوع <b class="num">${state.week}</b> · <b>${DAYS[c.day]} ${fmt(d)}/2026</b> · ${SLOT[c.slot[state.sec]]}${d>today?' · <span style="color:var(--exc)">محاضرة قادمة</span>':''}</div>
    <div class="counts"><span class="cnt p num">حاضر ${st.p}</span><span class="cnt a num">غائب ${st.a}</span><span class="cnt e num">مجاز ${st.e}</span><span class="cnt u num">لم يُسجَّل ${st.u}</span></div>
    <div class="controls">${canEd ? `<button class="btn primary" data-all="P">الكل حاضر</button>${
      state.confirmClear ? `<span class="confirm">مسح تسجيل هذا الأسبوع؟ <button class="btn" data-clear="yes">مسح</button><button class="btn ghost" data-clear="no">إلغاء</button></span>` : `<button class="btn ghost" data-clear="ask">مسح</button>`}` : '<span class="who">اطّلاع فقط</span>'}</div>
  </div><ol class="roll">`;
  students(state.sec).forEach((s,i) => {
    const v = m[s[0]] || '';
    h += `<li><span class="i num">${i+1}</span><span class="nm">${esc(s[1])}</span><span class="marks" role="group" aria-label="${esc(s[1])}">
      <button class="mk p" data-seq="${s[0]}" data-v="P" aria-pressed="${v==='P'}" ${dis}>حاضر</button>
      <button class="mk a" data-seq="${s[0]}" data-v="A" aria-pressed="${v==='A'}" ${dis}>غائب</button>
      <button class="mk e" data-seq="${s[0]}" data-v="E" aria-pressed="${v==='E'}" ${dis}>مجاز</button></span></li>`;
  });
  return h + '</ol></section>';
}
function studentTotals(c, sec){
  const out = {};
  students(sec).forEach(s => out[s[0]] = {A:0,E:0,P:0});
  let held = 0;
  for (let w=1; w<=WEEKS; w++){
    const m = marksOf(docId(c.id,sec,w)); if (Object.keys(m).length) held++;
    for (const k in m) if (out[k]) out[k][m[k]]++;
  }
  return {out, held};
}
function renderGrid(c){
  const {out, held} = studentTotals(c, state.sec);
  let h = `<section class="panel"><div class="panelhead"><div class="lecinfo">شعبة <b>${state.sec}</b> · محاضرات مسجّلة <b class="num">${held}</b> من ${WEEKS} · يوم ${DAYS[c.day]}</div>
    <div class="who">نسبة الغياب = الغيابات ÷ 15 أسبوعاً</div></div><div class="gridwrap"><table class="grid"><thead><tr><th>ت</th><th class="name">اسم الطالب</th>`;
  for (let w=1; w<=WEEKS; w++) h += `<th class="num">${w}<br>${fmt(lecDate(c,w))}</th>`;
  h += '<th>غ</th><th>ج</th><th>نسبة الغياب</th></tr></thead><tbody>';
  students(state.sec).forEach((s,i) => {
    h += `<tr><td class="num">${i+1}</td><td class="name">${esc(s[1])}</td>`;
    for (let w=1; w<=WEEKS; w++){ const v = marksOf(docId(c.id,state.sec,w))[s[0]]; h += `<td class="c">${v?`<span class="${v}">${LBL[v]}</span>`:'<span class="U">·</span>'}</td>`; }
    const t = out[s[0]], pct = Math.round(100*t.A/WEEKS);
    h += `<td class="num">${t.A||'-'}</td><td class="num">${t.E||'-'}</td><td><span class="pct num ${pct>=15?'hi':pct>=10?'mid':''}">${pct?pct+'%':'-'}</span><span class="meter"><i style="width:${Math.min(100,pct*4)}%"></i></span></td></tr>`;
  });
  h += '</tbody></table></div></section>';
  h += `<div class="controls" style="margin-top:12px"><button class="btn" id="csv">تنزيل سجل هذه المادة (CSV)</button></div>`;
  return h;
}
function renderSummary(){
  let h = '<div class="sumgrid">';
  visible().forEach(c => {
    const secs = ['A','B'].map(sec => {
      let held=0, pres=0, tot=0;
      for (let w=1; w<=WEEKS; w++){ const st = weekStats(c,sec,w); if (st.taken){ held++; pres+=st.p+st.e; tot+=st.n; } }
      return {sec, held, rate: tot? Math.round(100*pres/tot) : null};
    });
    h += `<div class="scard"><h3>${esc(c.name)} <span class="t">(${c.type})</span></h3><div class="t">${esc(c.teacher)} · ${DAYS[c.day]}</div>${
      secs.map(s => `<div class="srow"><span>شعبة ${s.sec}</span><span class="num">${s.held}/${WEEKS} محاضرة</span><span class="num"><b>${s.rate===null?'—':s.rate+'%'}</b> حضور</span></div>`).join('')}</div>`;
  });
  h += '</div>';
  // students with most absences across all subjects
  const abs = {};
  ROSTER.forEach(s => abs[s[0]] = 0);
  for (const id in data){ const m = data[id].m||{}; for (const k in m) if (m[k]==='A' && k in abs) abs[k]++; }
  const top = ROSTER.map(s => ({s, a:abs[s[0]]})).filter(x=>x.a>0).sort((x,y)=>y.a-x.a).slice(0,10);
  h += `<section class="panel"><div class="panelhead"><div class="lecinfo"><b>أكثر الطلبة غياباً</b> في جميع المواد</div></div>${
    top.length ? `<ol class="roll">${top.map((x,i)=>`<li><span class="i num">${i+1}</span><span class="nm">${esc(x.s[1])}<small>شعبة ${x.s[2]}</small></span><span class="cnt a num">${x.a} غياب</span></li>`).join('')}</ol>` : '<div class="empty">لا توجد غيابات مسجّلة بعد.</div>'}</section>`;
  return h;
}
function render(){
  if (!ME.teacher && !ME.all) return;
  if (!visible().some(c=>c.id===state.cid)) { state.cid = visible()[0].id; state.week = defaultWeek(visible()[0]); }
  $('#tabSum').hidden = !ME.all; if (!ME.all && state.tab==='sum') state.tab='roll';
  const c = C.find(c=>c.id===state.cid);
  renderSubjects();
  $('#subjTitle').textContent = `${c.name} (${c.type})`;
  $('#subjWho').textContent = `${c.teacher} · يوم ${DAYS[c.day]} · شعبة A: ${SLOT[c.slot.A]} · شعبة B: ${SLOT[c.slot.B]}`;
  $('#secA').setAttribute('aria-pressed', state.sec==='A'); $('#secB').setAttribute('aria-pressed', state.sec==='B');
  ['Roll','Grid','Sum','Adm','Rep'].forEach(t => $('#tab'+t).setAttribute('aria-selected', state.tab===t.toLowerCase()));
  $('#tabAdm').hidden = !ME.owner; if (!ME.owner && state.tab==='adm') state.tab='roll';
  const rb = $('#reqBadge'); rb.textContent = REQS.length ? `(${REQS.length})` : '';
  if (state.tab==='adm') { renderAdmin(); return; }
  $('#view').innerHTML = state.tab==='roll' ? renderRoll(c) : state.tab==='grid' ? renderGrid(c) : state.tab==='rep' ? renderReport() : renderSummary();
}
$('#curweek').innerHTML = `الأسبوع الحالي <b class="num">${curWeek}</b>`;

/* ---------- events ---------- */
document.addEventListener('change', e => { if (e.target.id==='repMin'){ REP.min = +e.target.value; render(); } });
document.addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.cid && visible().some(c=>c.id===b.dataset.cid)){ state.cid = b.dataset.cid; state.week = defaultWeek(C.find(c=>c.id===state.cid)); state.confirmClear=false; saveUI(); render(); if (innerWidth<860) $('main').scrollIntoView({behavior:'smooth'}); return; }
  if (b.id==='secA'||b.id==='secB'){ state.sec = b.id==='secA'?'A':'B'; state.confirmClear=false; saveUI(); render(); return; }
  if (b.id==='tabRoll'||b.id==='tabGrid'||b.id==='tabSum'||b.id==='tabAdm'||b.id==='tabRep'){ state.tab = b.id.slice(3).toLowerCase(); saveUI(); render(); return; }
  if (b.dataset.week){ state.week = +b.dataset.week; state.confirmClear=false; render(); return; }
  if (b.dataset.seq && editable(C.find(c=>c.id===state.cid))){ const cur = marksOf(docId(state.cid,state.sec,state.week))[b.dataset.seq]; setMark(b.dataset.seq, cur===b.dataset.v ? null : b.dataset.v); return; }
  if (b.dataset.all && editable(C.find(c=>c.id===state.cid))){
    const m = marksOf(docId(state.cid,state.sec,state.week));
    const id = docId(state.cid,state.sec,state.week), nm = {};
    students(state.sec).forEach(s => nm[s[0]] = m[s[0]] || 'P');   // keep existing غ/ج, fill the rest as حاضر
    data[id] = {...(data[id]||{}), m:nm}; queueSave(id); render(); return;
  }
  if (b.dataset.clear && editable(C.find(c=>c.id===state.cid))){ if (b.dataset.clear==='ask') state.confirmClear=true; else { if (b.dataset.clear==='yes') setAll(null); state.confirmClear=false; } render(); return; }
  if (b.id==='csv') exportCSV();
  if (b.dataset.rsec){ REP.sec = b.dataset.rsec; render(); return; }
  if (b.dataset.rbase){ REP.base = b.dataset.rbase; render(); return; }
  if (b.dataset.stu){ REP.stu = REP.stu===b.dataset.stu ? null : b.dataset.stu; render(); if (REP.stu) setTimeout(()=>$('#stuCard')?.scrollIntoView({behavior:'smooth',block:'nearest'}),0); return; }
  if (b.id==='repDoc') exportWord(false, b);
  if (b.id==='stuDoc') exportWord(true, b);
});

async function exportCSV(){
  const c = C.find(c=>c.id===state.cid);
  const rows = [['ت','اسم الطالب','الشعبة', ...Array.from({length:WEEKS},(_,i)=>`أسبوع ${i+1} (${fmt(lecDate(c,i+1))})`),'غيابات','إجازات','نسبة الغياب']];
  ['A','B'].forEach(sec => { const {out} = studentTotals(c,sec); students(sec).forEach((s,i) => {
    rows.push([i+1, s[1], sec, ...Array.from({length:WEEKS},(_,w)=>LBL[marksOf(docId(c.id,sec,w+1))[s[0]]]||''), out[s[0]].A, out[s[0]].E, Math.round(100*out[s[0]].A/WEEKS)+'%']);
  }); });
  const csv = '﻿' + rows.map(r => r.map(v => `"${String(v).replace(/"/g,'""')}"`).join(',')).join('\r\n');
  const btn = $('#csv');
  try {
    saveFile(`حضور ${c.name} ${c.type} 2026-2027.csv`, new Blob([csv], {type:'text/csv'}));
  } catch(e) { btn.textContent = 'لم يتم التنزيل'; }
}


/* ---------- reports ---------- */
const REP = { sec:'all', min:0, base:'15', stu:null };
function heldWeeks(c, sec){ let n=0; for (let w=1; w<=WEEKS; w++) if (Object.keys(marksOf(docId(c.id,sec,w))).length) n++; return n; }
function stuStat(c, s){
  const sec = s[2]; let A=0, E=0; const dates=[];
  for (let w=1; w<=WEEKS; w++){ const v = marksOf(docId(c.id,sec,w))[s[0]]; if (v==='A'){ A++; dates.push(fmt(lecDate(c,w))); } else if (v==='E') E++; }
  const held = heldWeeks(c, sec);
  const den = REP.base==='15' ? WEEKS : held;
  return {A, E, held, dates, pct: den ? Math.round(1000*A/den)/10 : null};
}
function repRows(){
  const subs = visible();
  const list = ROSTER.filter(s => REP.sec==='all' || s[2]===REP.sec);
  return list.map(s => {
    const per = subs.map(c => stuStat(c, s));
    const totA = per.reduce((a,x)=>a+x.A,0);
    const maxPct = Math.max(0, ...per.map(x=>x.pct||0));
    return {s, per, totA, maxPct};
  }).filter(r => r.maxPct >= REP.min);
}
const lvl = p => p===null ? 'na' : p===0 ? 'z' : p>=15 ? 'l2' : p>=10 ? 'l1' : '';
function renderReport(){
  const subs = visible(), rows = repRows();
  const seg = (attr, cur, opts) => `<div class="seg" role="group">${opts.map(([v,l])=>`<button data-${attr}="${v}" aria-pressed="${cur===v}">${l}</button>`).join('')}</div>`;
  let h = `<div class="filters">
    <label>الشعبة ${seg('rsec', REP.sec, [['all','الكل'],['A','A'],['B','B']])}</label>
    <label>أساس النسبة ${seg('rbase', REP.base, [['15','من 15 أسبوعاً'],['held','من المحاضرات المسجّلة']])}</label>
    <label for="repMin">إظهار <select id="repMin">${[[0,'جميع الطلبة'],[0.1,'من لديه غياب'],[10,'نسبة 10% فأكثر'],[15,'نسبة 15% فأكثر']].map(([v,l])=>`<option value="${v}" ${REP.min==v?'selected':''}>${l}</option>`).join('')}</select></label>
    <button class="btn primary" id="repDoc">تنزيل التقرير (Word)</button>
  </div>`;
  h += `<section class="panel"><div class="panelhead"><div class="lecinfo"><b>تقرير نسب الغياب</b> · ${rows.length} طالباً · ${subs.length} مادة · اضغط اسم الطالب لعرض تقريره</div>
    <div class="legend"><span><i style="background:var(--exc-soft)"></i>10% فأكثر</span><span><i style="background:var(--bad-soft)"></i>15% فأكثر</span></div></div>`;
  if (!rows.length) h += '<div class="empty">لا يوجد طلبة ضمن هذا الشرط.</div>';
  else {
    h += `<div class="gridwrap"><table class="grid rep"><thead><tr><th>ت</th><th class="name">اسم الطالب</th><th>الشعبة</th>${subs.map(c=>`<th class="sub" title="${esc(c.name)} (${c.type})">${esc(SHORT[c.id])}</th>`).join('')}<th>مجموع الغيابات</th></tr></thead><tbody>`;
    rows.forEach((r,i) => {
      h += `<tr class="${REP.stu==String(r.s[0])?'sel':''}"><td class="num">${i+1}</td><td class="name"><button class="linkbtn" data-stu="${r.s[0]}">${esc(r.s[1])}</button></td><td>${r.s[2]}</td>${
        r.per.map(x=>`<td class="v num ${lvl(x.pct)}">${x.pct===null?'—':x.pct===0?'0':x.pct+'%'}</td>`).join('')}<td class="num"><b>${r.totA||'-'}</b></td></tr>`;
    });
    h += '</tbody></table></div>';
  }
  h += '</section>';
  if (REP.stu){
    const s = ROSTER.find(x => String(x[0])===REP.stu);
    if (s){
      const per = subs.map(c => ({c, ...stuStat(c, s)}));
      h += `<section class="panel stucard" id="stuCard"><div class="panelhead"><div class="lecinfo"><b></b> · شعبة ${s[2]} · مجموع الغيابات <b class="num">${per.reduce((a,x)=>a+x.A,0)}</b> · الإجازات <b class="num">${per.reduce((a,x)=>a+x.E,0)}</b></div><span class="controls"><button class="btn primary" id="stuDoc">تقرير الطالب (Word)</button><button class="btn ghost" data-stu="${s[0]}">إغلاق</button></span></div>
      <div class="gridwrap"><table><thead><tr><th>المادة</th><th>التدريسي</th><th>المحاضرات المسجّلة</th><th>غياب</th><th>مجاز</th><th>نسبة الغياب</th><th>تواريخ الغياب</th></tr></thead><tbody>${
        per.map(x=>`<tr><td>${esc(x.c.name)} (${x.c.type})</td><td>${esc(x.c.teacher)}</td><td class="num">${x.held}</td><td class="num">${x.A}</td><td class="num">${x.E}</td><td class="num"><span class="pct ${x.pct>=15?'hi':x.pct>=10?'mid':''}">${x.pct===null?'—':x.pct+'%'}</span></td><td class="dates num">${x.dates.join('، ')||'-'}</td></tr>`).join('')}</tbody></table></div></section>`;
      setTimeout(()=>{ const b = $('#stuCard .lecinfo b'); if (b) b.textContent = s[1]; },0);
    }
  }
  h += `<div class="note">${REP.base==='15' ? 'النسبة = عدد الغيابات ÷ 15 أسبوعاً (مجموع أسابيع الفصل).' : 'النسبة = عدد الغيابات ÷ عدد المحاضرات التي سُجّل فيها الحضور حتى الآن.'} الغياب بإجازة (ج) لا يدخل في النسبة.</div>`;
  return h;
}
/* Builds the Word absence report. `D` is the docx library namespace; `M` is plain data:
   { title, subtitle, filters:[str], generated, subjects:[{short,full}], rows:[{i,name,sec,cells:[pct|null],tot}],
     student: null | {name, sec, totA, totE, rows:[{subject,teacher,held,A,E,pct,dates}]}, basisNote, head } */
function buildWordReport(D, M){
  const FONT = 'Arial';
  const INK = '10323D', MUTED = '5A6E75', BRAND = '0F5E6E', LINE = 'C9D5D7', HEAD_BG = '0F5E6E', ZEBRA = 'F3F7F7';
  const AMBER_BG = 'FBEFD2', AMBER = '8A5F00', RED_BG = 'F8DDD6', RED = 'A33520';
  const run = (t, o={}) => new D.TextRun({ text: String(t), rightToLeft: true, font: {ascii:FONT, hAnsi:FONT, cs:FONT},
    size: o.size||20, sizeComplexScript: o.size||20, bold: !!o.bold, boldComplexScript: !!o.bold, color: o.color||INK });
  const para = (t, o={}) => new D.Paragraph({ bidirectional: true, alignment: o.align||D.AlignmentType.CENTER,
    spacing: {before:o.before||0, after:o.after||0, line: o.line||240}, children: Array.isArray(t)? t : [run(t,o)],
    border: o.border });
  const border = { style: D.BorderStyle.SINGLE, size: 4, color: LINE };
  const borders = { top:border, bottom:border, left:border, right:border };
  const cell = (t, o={}) => new D.TableCell({
    children: [para(t, {size:o.size||17, bold:o.bold, color:o.color, align:o.align})],
    shading: o.fill ? { type: D.ShadingType.CLEAR, color:'auto', fill:o.fill } : undefined,
    verticalAlign: D.VerticalAlign.CENTER, borders,
    margins: { top:50, bottom:50, left:50, right:50 },
    width: o.w ? { size:o.w, type: D.WidthType.DXA } : undefined,
    textDirection: o.vertical ? D.TextDirection.BOTTOM_TO_TOP_LEFT_TO_RIGHT : undefined,
  });
  const pctStyle = p => p===null ? {t:'—', color:MUTED} : p>=15 ? {t:p+'%', fill:RED_BG, color:RED, bold:true} : p>=10 ? {t:p+'%', fill:AMBER_BG, color:AMBER, bold:true} : p===0 ? {t:'0', color:MUTED} : {t:p+'%'};

  // page: A4 landscape, usable width ≈ 16838 - 2*720 = 15398 twips
  const USABLE = 15398;
  const children = [];
  children.push(para('جامعة الفرات الأوسط التقنية', {size:24, bold:true, color:BRAND}));
  children.push(para('كلية البوليتكنك / بابل - قسم تقنيات شبكات وبرمجيات الحاسوب', {size:22, bold:true, color:BRAND, after:120}));
  children.push(para(M.title, {size:32, bold:true, after:60}));
  children.push(para(M.subtitle, {size:21, color:MUTED, after:60}));
  children.push(para(M.filters.join('    |    '), {size:18, color:MUTED, after:200,
    border:{ bottom:{ style:D.BorderStyle.SINGLE, size:12, color:BRAND, space:6 } }}));

  if (M.rows){
    const nSub = M.subjects.length;
    const wI = 420, wName = 3000, wSec = 520, wTot = 900;
    const wSub = Math.floor((USABLE - wI - wName - wSec - wTot) / Math.max(1,nSub));
    const hdr = new D.TableRow({ tableHeader: true, children: [
      cell('ت', {bold:true, color:'FFFFFF', fill:HEAD_BG, w:wI}),
      cell('اسم الطالب', {bold:true, color:'FFFFFF', fill:HEAD_BG, w:wName}),
      cell('الشعبة', {bold:true, color:'FFFFFF', fill:HEAD_BG, w:wSec}),
      ...M.subjects.map(s => cell(s.short, {bold:true, color:'FFFFFF', fill:HEAD_BG, w:wSub, size:15})),
      cell('مجموع الغيابات', {bold:true, color:'FFFFFF', fill:HEAD_BG, w:wTot, size:15}),
    ]});
    const body = M.rows.map((r, k) => new D.TableRow({ cantSplit: true, children: [
      cell(r.i, {w:wI, fill: k%2 ? ZEBRA : undefined, color:MUTED}),
      cell(r.name, {w:wName, align: D.AlignmentType.RIGHT, fill: k%2 ? ZEBRA : undefined, bold:true}),
      cell(r.sec, {w:wSec, fill: k%2 ? ZEBRA : undefined}),
      ...r.cells.map(p => { const s = pctStyle(p); return cell(s.t, {w:wSub, fill: s.fill || (k%2 ? ZEBRA : undefined), color:s.color, bold:s.bold}); }),
      cell(r.tot || '-', {w:wTot, bold:true, fill: k%2 ? ZEBRA : undefined}),
    ]}));
    children.push(new D.Table({ visuallyRightToLeft: true, width:{ size: USABLE, type: D.WidthType.DXA },
      columnWidths: [wI, wName, wSec, ...Array(nSub).fill(wSub), wTot], rows: [hdr, ...body] }));
    if (!M.rows.length) children.push(para('لا يوجد طلبة ضمن شرط التقرير.', {size:20, color:MUTED, before:200}));
    // legend
    children.push(para([
      run('دليل الألوان:  ', {size:17, bold:true, color:MUTED}),
      new D.TextRun({text:'  10% فأكثر  ', rightToLeft:true, font:{ascii:FONT,cs:FONT}, size:17, sizeComplexScript:17, color:AMBER, bold:true, boldComplexScript:true, shading:{type:D.ShadingType.CLEAR, color:'auto', fill:AMBER_BG}}),
      run('   '),
      new D.TextRun({text:'  15% فأكثر  ', rightToLeft:true, font:{ascii:FONT,cs:FONT}, size:17, sizeComplexScript:17, color:RED, bold:true, boldComplexScript:true, shading:{type:D.ShadingType.CLEAR, color:'auto', fill:RED_BG}}),
    ], {align: D.AlignmentType.RIGHT, before:160}));
    // key of subject abbreviations
    children.push(para('مفتاح المواد: ' + M.subjects.map(s => `${s.short} = ${s.full}`).join('؛  '), {size:16, color:MUTED, align:D.AlignmentType.RIGHT, before:80}));
  }

  if (M.student){
    const S = M.student;
    children.push(para([run('الطالب: ', {size:22, color:MUTED}), run(S.name, {size:24, bold:true}), run(`     الشعبة: ${S.sec}     مجموع الغيابات: ${S.totA}     الإجازات: ${S.totE}`, {size:21, color:MUTED})], {after:160}));
    const ws = [4300, 2500, 1500, 1000, 1000, 1400, USABLE-4300-2500-1500-1000-1000-1400];
    const h = ['المادة','التدريسي','المحاضرات المسجّلة','غياب','مجاز','نسبة الغياب','تواريخ الغياب'];
    const rows = [ new D.TableRow({ tableHeader:true, children: h.map((t,i)=>cell(t,{bold:true,color:'FFFFFF',fill:HEAD_BG,w:ws[i]})) }),
      ...S.rows.map((r,k) => { const s = pctStyle(r.pct); const z = k%2 ? ZEBRA : undefined; return new D.TableRow({ cantSplit:true, children: [
        cell(r.subject,{w:ws[0],align:D.AlignmentType.RIGHT,fill:z,bold:true}), cell(r.teacher,{w:ws[1],fill:z}), cell(r.held,{w:ws[2],fill:z}),
        cell(r.A,{w:ws[3],fill:z}), cell(r.E,{w:ws[4],fill:z}), cell(s.t,{w:ws[5],fill:s.fill||z,color:s.color,bold:s.bold}), cell(r.dates||'-',{w:ws[6],fill:z,size:16}) ]}); }) ];
    children.push(new D.Table({ visuallyRightToLeft:true, width:{size:USABLE,type:D.WidthType.DXA}, columnWidths: ws, rows }));
  }

  children.push(para(M.basisNote, {size:17, color:MUTED, align:D.AlignmentType.RIGHT, before:160}));

  // signatures
  const noB = { top:{style:D.BorderStyle.NONE,size:0,color:'FFFFFF'}, bottom:{style:D.BorderStyle.NONE,size:0,color:'FFFFFF'}, left:{style:D.BorderStyle.NONE,size:0,color:'FFFFFF'}, right:{style:D.BorderStyle.NONE,size:0,color:'FFFFFF'} };
  const sig = (a,b) => new D.TableCell({ borders:noB, width:{size:USABLE/2,type:D.WidthType.DXA}, children:[
    para(a,{size:21,bold:true,before:120}), para(b,{size:21,before:60}), para('التوقيع: ..............................',{size:19,color:MUTED,before:280}) ]});
  children.push(new D.Table({ visuallyRightToLeft:true, width:{size:USABLE,type:D.WidthType.DXA}, columnWidths:[USABLE/2,USABLE/2],
    borders: noB, rows:[ new D.TableRow({ cantSplit:true, children:[ sig('معدّ التقرير', '....................................'), sig('رئيس القسم', M.head) ] }) ] }));

  const footer = new D.Footer({ children: [ new D.Paragraph({ bidirectional:true, alignment:D.AlignmentType.CENTER, children: [
    run(`${M.title} - ${M.generated}    |    صفحة `, {size:16, color:MUTED}),
    new D.TextRun({ children:[D.PageNumber.CURRENT], size:16, color:MUTED, font:{ascii:FONT,cs:FONT} }),
    run(' من ', {size:16, color:MUTED}),
    new D.TextRun({ children:[D.PageNumber.TOTAL_PAGES], size:16, color:MUTED, font:{ascii:FONT,cs:FONT} }) ] }) ] });

  return new D.Document({
    creator: 'قسم تقنيات شبكات وبرمجيات الحاسوب', title: M.title,
    styles: { default: { document: { run: { font: FONT, rightToLeft: true } } } },
    sections: [{ properties: { page: { size: { orientation: D.PageOrientation.LANDSCAPE, width: 11906, height: 16838 },
      margin: { top: 720, bottom: 720, left: 720, right: 720 } }, bidi: true },
      footers: { default: footer }, children }],
  });
}

let docxLib = null;
function loadDocx(){
  if (window.docx) return Promise.resolve(window.docx);
  if (docxLib) return docxLib;
  docxLib = new Promise((res, rej) => { const sc = document.createElement('script');
    sc.src = 'https://cdn.jsdelivr.net/npm/docx@8.5.0/build/index.umd.js';
    sc.onload = () => res(window.docx); sc.onerror = () => { docxLib = null; rej(new Error('load')); };
    document.head.appendChild(sc); });
  return docxLib;
}
const basisTxt = () => REP.base==='15' ? 'من 15 أسبوعاً' : 'من المحاضرات المسجّلة';
const minTxt = () => ({0:'جميع الطلبة',0.1:'من لديه غياب',10:'نسبة 10% فأكثر',15:'نسبة 15% فأكثر'})[REP.min];
async function exportWord(single, btn){
  const label = btn.textContent; btn.disabled = true; btn.textContent = 'جارٍ إعداد الملف…';
  try {
    const D = await loadDocx();
    const subs = visible(); const gen = `${pad(today.getDate())}/${pad(today.getMonth()+1)}/${today.getFullYear()}`;
    const M = { subtitle: 'المرحلة الثانية - الفصل الدراسي الأول - العام الدراسي 2026-2027', generated: gen,
      head: 'ا.م.د. عمار وسام عبد الزهرة',
      basisNote: (REP.base==='15' ? 'النسبة = عدد الغيابات ÷ 15 أسبوعاً (أسابيع الفصل).' : 'النسبة = عدد الغيابات ÷ عدد المحاضرات التي سُجّل فيها الحضور حتى تاريخ التقرير.') + ' الغياب بإجازة (ج) لا يدخل في النسبة. تاريخ إعداد التقرير: ' + gen,
      subjects: subs.map(c => ({short: SHORT[c.id], full: `${c.name} (${c.type})`})) };
    let fname;
    if (single){
      const st = ROSTER.find(x => String(x[0])===REP.stu); if (!st) throw new Error('none');
      const per = subs.map(c => ({c, ...stuStat(c, st)}));
      M.title = 'تقرير غياب طالب';
      M.filters = [`أساس النسبة: ${basisTxt()}`, ME.all ? 'جميع المواد' : `مواد ${ME.teacher}`];
      M.rows = null;
      M.student = { name: st[1], sec: st[2], totA: per.reduce((a,x)=>a+x.A,0), totE: per.reduce((a,x)=>a+x.E,0),
        rows: per.map(x => ({subject:`${x.c.name} (${x.c.type})`, teacher:x.c.teacher, held:x.held, A:x.A, E:x.E, pct:x.pct, dates:x.dates.join('، ')})) };
      fname = `تقرير غياب - ${st[1]}.docx`;
    } else {
      const rows = repRows();
      M.title = 'تقرير نسب غياب الطلبة';
      M.filters = [`الشعبة: ${REP.sec==='all'?'الكل':REP.sec}`, `أساس النسبة: ${basisTxt()}`, `المعروض: ${minTxt()}`, `عدد الطلبة: ${rows.length}`];
      if (!ME.all) M.filters.push(`مواد ${ME.teacher}`);
      M.rows = rows.map((r,i) => ({i:i+1, name:r.s[1], sec:r.s[2], cells:r.per.map(x=>x.pct), tot:r.totA}));
      M.student = null;
      fname = `تقرير نسب الغياب - المرحلة الثانية - ${gen.replace(/\//g,'-')}.docx`;
    }
    const blob = await D.Packer.toBlob(buildWordReport(D, M));
    saveFile(fname, blob);
    btn.textContent = label;
  } catch(e) { btn.textContent = 'تعذّر إنشاء الملف، حاول مجدداً'; }
  finally { btn.disabled = false; setTimeout(()=>{ if (btn.isConnected) btn.textContent = label; }, 4000); }
}


let REQS = [];

/* ---------- الاتصال بخادم Google Apps Script ---------- */
function saveFile(filename, blob){
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
let CODE = null, TEACH = [];
const lsGet = k => { try { return localStorage.getItem(k); } catch(e){ return null; } };
const lsSet = (k, v) => { try { v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch(e){} };

async function api(action, payload = {}){
  const res = await fetch(window.APP_CONFIG.scriptUrl, {
    method: 'POST', redirect: 'follow',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },   // يتجنب طلب preflight
    body: JSON.stringify({ action, code: CODE, ...payload }),
  });
  const out = await res.json();
  if (!out.ok){ const e = new Error(out.error || 'server'); e.code = out.error === 'forbidden' ? 'permission-denied' : out.error; throw e; }
  return out;
}
// واجهة صغيرة تستعملها دالة الحفظ في منطق التطبيق
db = { doc: path => ({ set: body => api('save', { id: path.split('/')[1], m: body.m }) }) };

function showGate(html){ $('#app').hidden = true; const g = $('#gate'); g.hidden = false; g.innerHTML = html; }
function gateLogin(msg){
  showGate(`<h2>الدخول برمز التدريسي</h2><p>التطبيق مخصص لتدريسيي مواد المرحلة الثانية. أدخل رمز الدخول الشخصي الذي سلّمه لك مدير التطبيق.</p>
    <form id="loginForm"><input id="codeIn" autocomplete="off" required placeholder="XXXX-XXXX-XXXX" dir="ltr" style="font:inherit;padding:8px 12px;border:1px solid var(--line);border-radius:7px;background:var(--card);color:var(--ink);letter-spacing:1px;text-align:center">
    <button class="btn primary" type="submit">دخول</button></form>
    <p><label class="who"><input type="checkbox" id="remember" checked> تذكّر الرمز على هذا الجهاز</label></p><p id="gateMsg" style="color:var(--bad)"></p>`);
  if (msg) $('#gateMsg').textContent = msg;
  $('#loginForm').addEventListener('submit', e => { e.preventDefault(); login($('#codeIn').value.trim().toUpperCase(), $('#remember').checked); });
}

async function login(code, remember){
  CODE = code;
  showGate('<h2>جارٍ التحقق…</h2>');
  try {
    const out = await api('load');
    if (remember) lsSet('att-code', code);
    const me = out.me;
    ME = { owner: me.admin, all: me.all, teacher: me.teacher, email: '' };
    applyLoad(out);
    enterApp();
    setSync('live', 'محفوظ ومتزامن');
    setInterval(refresh, 30000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
  } catch(err){
    CODE = null; lsSet('att-code', null);
    gateLogin(err.message === 'bad_code' ? 'الرمز غير صحيح.' : 'تعذّر الاتصال بالخادم. تحقق من الإنترنت وحاول مجدداً.');
  }
}
function applyLoad(out){
  ROSTER = out.roster || [];
  const fresh = {};
  (out.att || []).forEach(r => fresh[r.id] = { m: r.m });
  for (const id in fresh) if (!dirty.has(id)) data[id] = fresh[id];
  for (const id in data) if (!(id in fresh) && !dirty.has(id)) delete data[id];
}
let refreshing = false;
async function refresh(){
  if (refreshing || document.hidden || dirty.size) return;
  refreshing = true;
  try { applyLoad(await api('load')); if (!dirty.size) setSync('live', 'محفوظ ومتزامن'); render(); }
  catch(e){ setSync('off', 'تعذّر التحديث من الخادم'); }
  finally { refreshing = false; }
}

function enterApp(){
  $('#gate').hidden = true; $('#app').hidden = false;
  const uc = $('#userchip'); uc.hidden = false;
  uc.innerHTML = '<span></span><b></b><button class="btn ghost" id="signOut" type="button">خروج</button>';
  uc.children[0].textContent = ME.owner ? 'مدير التطبيق' : (ME.teacher === HEAD_TEACHER ? 'رئيس القسم' : 'التدريسي');
  uc.children[1].textContent = ' ' + (ME.teacher || '');
  $('#signOut').onclick = () => { lsSet('att-code', null); location.reload(); };
  if (!visible().some(c => c.id === state.cid)) state.cid = visible()[0].id;
  state.week = defaultWeek(C.find(c => c.id === state.cid));
  if (ME.owner) { $('#tabAdm').hidden = false; loadTeachers(); }
  render();
}

/* ---------- لوحة المدير: رموز التدريسيين وقائمة الطلبة ---------- */
async function loadTeachers(){ try { TEACH = (await api('teachers')).teachers; if (state.tab === 'adm') render(); } catch(e){} }
async function renderAdmin(){
  const rows = [...TEACH].sort((a,b) => TEACHERS.indexOf(a.name) - TEACHERS.indexOf(b.name));
  let h = `<section class="panel adm"><div class="panelhead"><div class="lecinfo"><b>رموز دخول التدريسيين</b> · سلّم كل تدريسي رمزه شخصياً، وعامله ككلمة سر</div></div>`;
  h += rows.length ? `<table><thead><tr><th>التدريسي</th><th>رمز الدخول</th><th></th></tr></thead><tbody>${rows.map((t,i) => `<tr><td>${esc(t.name)}${t.name===HEAD_TEACHER?' <span class="pill ok">رئيس القسم</span>':''}</td><td><code class="mail" data-i="${i}"></code> <button class="btn ghost" data-copy="${i}" type="button">نسخ</button></td><td><button class="btn ghost" data-del="${i}" type="button">إلغاء الرمز</button></td></tr>`).join('')}</tbody></table>` : '<div class="empty">لم يُنشأ أي رمز بعد.</div>';
  h += `<form id="addT" class="adm-form"><select id="tName" required><option value="">اختر التدريسي…</option>${TEACHERS.map(t => `<option>${esc(t)}</option>`).join('')}</select>
    <button class="btn primary" type="submit">إنشاء رمز دخول</button><span id="tMsg" class="who"></span></form></section>`;
  h += `<section class="panel adm"><div class="panelhead"><div class="lecinfo"><b>قائمة الطلبة</b> · ${ROSTER.length} طالباً محفوظون في جدول Google</div></div>
    <form id="rosterForm" class="adm-form"><label class="who" for="rosterFile">ملف Excel بأعمدة: التسلسل، اسم الطالب، الشعبة</label>
    <input id="rosterFile" type="file" accept=".xlsx,.xls" required><button class="btn primary" type="submit">استيراد القائمة</button><span id="rMsg" class="who"></span></form>
    <div class="note" style="margin:0 16px 16px">أسماء الطلبة تُحفظ في جدول Google الخاص بك فقط ولا تُرفع إلى GitHub. الاستيراد يستبدل القائمة السابقة، ويبقى الحضور المسجّل مرتبطاً بالتسلسل.</div></section>`;
  if (state.tab !== 'adm') return;
  $('#view').innerHTML = h;
  $('#view').querySelectorAll('code[data-i]').forEach(el => el.textContent = rows[+el.dataset.i].code);
  $('#view').querySelectorAll('[data-copy]').forEach(b => b.onclick = async () => {
    const t = rows[+b.dataset.copy]; try { await navigator.clipboard.writeText(t.code); b.textContent = 'نُسخ'; } catch(e){ b.textContent = 'انسخه يدوياً'; } });
  $('#view').querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
    b.disabled = true; try { await api('delTeacher', { code2: rows[+b.dataset.del].code }); await loadTeachers(); } catch(e){ b.disabled = false; } });
  $('#addT').addEventListener('submit', async e => {
    e.preventDefault(); const name = $('#tName').value; if (!name) return;
    try { const r = await api('addTeacher', { name }); $('#tMsg').textContent = `أُنشئ الرمز: ${r.code}`; await loadTeachers(); }
    catch(err){ $('#tMsg').textContent = 'تعذّر إنشاء الرمز.'; }
  });
  $('#rosterForm').addEventListener('submit', async e => {
    e.preventDefault(); const f = $('#rosterFile').files[0]; if (!f) return;
    try {
      const wb = XLSX.read(await f.arrayBuffer());
      const rowsX = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], {header:1});
      const list = rowsX.filter(r => Number.isFinite(+r[0]) && r[0] !== '' && r[1] && /^[AB]$/i.test(String(r[2]||'').trim()))
        .map(r => [+r[0], String(r[1]).replace(/\s+/g,' ').trim(), String(r[2]).trim().toUpperCase()]);
      if (!list.length) { $('#rMsg').textContent = 'لم أجد صفوفاً صالحة في الملف.'; return; }
      const r = await api('importRoster', { students: list });
      ROSTER = list; $('#rMsg').textContent = `استُورد ${r.count} طالباً.`;
    } catch(err){ $('#rMsg').textContent = 'تعذّر قراءة الملف أو حفظه.'; }
  });
}

/* ---------- التشغيل ---------- */
(function boot(){
  if (!window.APP_CONFIG || !window.APP_CONFIG.scriptUrl){
    showGate('<h2>الإعداد غير مكتمل</h2><p>ملف config.js غير موجود أو لا يحتوي رابط الخادم. راجع خطوات الإعداد في README.</p>'); return;
  }
  const saved = lsGet('att-code');
  if (saved) login(saved, true); else gateLogin();
})();
