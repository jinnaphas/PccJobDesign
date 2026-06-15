/* PCC People Architecture — shared JS (i18n, nav, helpers, charts, export) */
(function(){
const PCC = window.PCC = {};
const LS='pcc_lang';
PCC.lang = ()=> localStorage.getItem(LS) || 'th';
PCC.setLang = l=>{localStorage.setItem(LS,l); location.reload();};

const T = {
 th:{hub:'หน้าหลัก',library:'คลังตำแหน่ง',career:'เส้นทางเติบโต',evaluate:'ประเมินคน',admin:'ข้อมูล/ระบบ',
   search:'ค้นหา code / ชื่อตำแหน่ง...',reset:'ล้างตัวกรอง',company:'บริษัท',level:'ระดับ',family:'สายงาน',
   results:'ผลลัพธ์',sort:'เรียง',allco:'ทุกบริษัท',roles:'ตำแหน่ง',
   je_ok:'JE ยืนยันแล้ว',je_rev:'JE รอทบทวน',viewCareer:'ดูเส้นทางเติบโต',doEval:'ประเมินกับตำแหน่งนี้',
   print:'พิมพ์ JD',exportcsv:'Export CSV',nodata:'ไม่มีข้อมูล',purpose:'วัตถุประสงค์',krs:'ความรับผิดชอบหลัก',
   specs:'คุณสมบัติ',jescore:'คะแนน JE',clearAll:'ล้างทั้งหมด',filters:'ตัวกรอง',close:'ปิด',
   sortJEdesc:'JE มาก→น้อย',sortJEasc:'JE น้อย→มาก',sortTitle:'ชื่อ A→Z',sortLevel:'ระดับ',
   needLive:'เปิดผ่าน GitHub Pages / web server เพื่อโหลดข้อมูล (file:// โหลด JSON ไม่ได้)'},
 en:{hub:'Hub',library:'Library',career:'Career',evaluate:'Evaluate',admin:'Admin',
   search:'Search code / title...',reset:'Reset filters',company:'Company',level:'Level',family:'Family',
   results:'results',sort:'Sort',allco:'All companies',roles:'roles',
   je_ok:'JE Verified',je_rev:'JE Under review',viewCareer:'View career path',doEval:'Evaluate this role',
   print:'Print JD',exportcsv:'Export CSV',nodata:'No data',purpose:'Purpose',krs:'Key Responsibilities',
   specs:'Specifications',jescore:'JE Score',clearAll:'Clear all',filters:'Filters',close:'Close',
   sortJEdesc:'JE high→low',sortJEasc:'JE low→high',sortTitle:'Title A→Z',sortLevel:'Level',
   needLive:'Open via GitHub Pages / a web server to load data (file:// cannot fetch JSON).'}
};
PCC.t = k => (T[PCC.lang()]||T.th)[k] || k;

PCC.LC = {F1:'#d97706',L1:'#3b82f6',L2:'#10b981',L3:'#f59e0b',L4:'#ef4444',L5:'#8b5cf6',L6:'#ec4899'};
PCC.LEVELS = ['F1','L1','L2','L3','L4','L5','L6'];

let _ref=null;
PCC.ref = async()=>{ if(_ref)return _ref; _ref=await (await fetch('../data/reference.json')).json(); return _ref; };
PCC.coColor = c => ((_ref&&_ref.companies.find(x=>x.code===c))||{}).color || '#888';
PCC.coName  = c => { const x=_ref&&_ref.companies.find(y=>y.code===c); return x?(PCC.lang()==='th'? x.name_th||x.name_en : x.name_en):c; };
PCC.famId   = r => { const f=_ref&&_ref.job_family_codes[r.family_code]; return f?f.consolidated:null; };
PCC.famName = id => { const f=_ref&&_ref.consolidated_families.find(x=>x.id===id); return f?f.icon+' '+f.name_en:id; };
PCC.title   = r => PCC.lang()==='th' ? (r.title_th||r.title_en||r.code) : (r.title_en||r.title_th||r.code);

PCC.jeTrust = r => r.je_breakdown ? {cls:'ok',label:PCC.t('je_ok'),icon:'✓'} : {cls:'rev',label:PCC.t('je_rev'),icon:'⏳'};
PCC.recClass = rec => /Proceed|Ready|On Target/.test(rec)?'good' : /Consider|Develop|Minor/.test(rec)?'mid':'bad';

PCC.qs = n => new URLSearchParams(location.search).get(n);
PCC.esc = s => (s==null?'':String(s)).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
PCC.hl = (s,q)=>{ s=PCC.esc(s); if(!q)return s; try{return s.replace(new RegExp('('+q.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+')','ig'),'<mark>$1</mark>');}catch(e){return s;} };
PCC.debounce=(fn,ms)=>{let t;return(...a)=>{clearTimeout(t);t=setTimeout(()=>fn(...a),ms);};};

PCC.exportCSV = (filename, rows)=>{
  const csv = rows.map(r=>r.map(c=>{c=c==null?'':String(c);return /[",\n]/.test(c)?'"'+c.replace(/"/g,'""')+'"':c;}).join(',')).join('\n');
  const blob=new Blob(['﻿'+csv],{type:'text/csv;charset=utf-8;'});
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=filename;a.click();
};

PCC.nav = (active)=>{
  const L=PCC.t, lang=PCC.lang();
  const links=[['index.html','hub'],['library.html','library'],['career.html','career'],['evaluate.html','evaluate'],['admin.html','admin']];
  const html=`<div class="nav">
    <button class="burger" aria-label="menu" onclick="document.querySelector('.nav .links').classList.toggle('open')">☰</button>
    <div class="brand"><span class="dot"></span> PCC People</div>
    <div class="links">${links.map(([h,k])=>`<a href="${h}" class="${k===active?'active':''}">${L(k)}</a>`).join('')}</div>
    <form class="gsearch" onsubmit="location.href='library.html?q='+encodeURIComponent(this.q.value);return false;">
      <span class="mag">🔎</span><input id="gsearch" name="q" placeholder="${L('search')}" autocomplete="off">
    </form>
    <button class="lang" onclick="PCC.setLang(PCC.lang()==='th'?'en':'th')">${lang==='th'?'EN':'TH'}</button>
  </div>`;
  const slot=document.getElementById('nav'); if(slot) slot.outerHTML=html; else document.body.insertAdjacentHTML('afterbegin',html);
  document.documentElement.lang=lang;
};

// global keys: '/' focus search, Esc closes modal
document.addEventListener('keydown',e=>{
  if(e.key==='/' && !/input|textarea|select/i.test(e.target.tagName)){const s=document.getElementById('gsearch');if(s){e.preventDefault();s.focus();}}
  if(e.key==='Escape'){document.querySelectorAll('.ov.show').forEach(o=>o.classList.remove('show'));}
});
PCC.needLiveMsg = ()=>`<div class="msg">⚠️ ${PCC.t('needLive')}</div>`;
})();
