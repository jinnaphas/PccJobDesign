/**
 * PCC Recruitment Tracker — Google Apps Script backend
 *
 * The recruitment team records requisitions and candidates from a browser
 * using their own Google account. No token to hand out: Google login is the
 * credential, and the signed-in address is recorded on every change.
 *
 * Storage
 *   Google Sheet  — Requisitions / Candidates / History (created on first run)
 *   Drive folder  — attachments (any file type, including .docx and .xlsx)
 *
 * Script Properties (Project Settings → Script properties):
 *   SHEET_ID        (required)  the spreadsheet used as the database
 *   DRIVE_FOLDER_ID (required)  folder that holds uploaded documents
 *   ALLOWED_DOMAIN  (recommended) e.g. precise.co.th
 *   ACCESS_CODE     (optional)  only for "Anyone" deployments
 *
 * Deploy: Deploy → New deployment → Web app
 *   Execute as: Me       Who has access: Anyone within <your Workspace domain>
 */

var SITE = 'https://jinnaphas.github.io/PccJobDesign';
var SH_REQ = 'Requisitions', SH_CAND = 'Candidates', SH_HIST = 'History';

var REQ_COLS  = ['req_id','ref','role_code','role_title','role_title_th','company','level',
                 'dept','hiring_manager','recruiter','headcount','opened_at','target_start',
                 'status','note','files','created_by','created_at','updated_at'];
var CAND_COLS = ['cand_id','req_id','name','source','stage','stage_since','applied_at',
                 'interview_at','interviewer','offer_salary','reject_reason','note','files',
                 'created_by','created_at','updated_at'];
var HIST_COLS = ['at','entity','entity_id','from_stage','to_stage','by','note'];

/* stage keys are shared with the page; keep both in step */
var CAND_STAGES = ['submitted','interview','confirmed','onboard','rejected','declined'];
var REQ_STATUS  = ['open','filled','hold','cancelled'];

function prop(k, dflt) {
  var v = PropertiesService.getScriptProperties().getProperty(k);
  return (v === null || v === '') ? dflt : v;
}

function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('PCC Recruitment Tracker')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/* ---------- access ---------- */
function requireAccess_(accessCode) {
  var email = '';
  try { email = Session.getActiveUser().getEmail() || ''; } catch (e) { email = ''; }
  var domain = prop('ALLOWED_DOMAIN', '');
  if (domain) {
    var suffix = '@' + domain.toLowerCase();
    if (!email) throw new Error('ไม่สามารถยืนยันตัวตนได้ — กรุณาเปิดด้วยบัญชี @' + domain);
    if (email.toLowerCase().slice(-suffix.length) !== suffix) {
      throw new Error('บัญชี ' + email + ' ไม่มีสิทธิ์ใช้งาน (ต้องเป็น @' + domain + ')');
    }
  }
  var code = prop('ACCESS_CODE', '');
  if (code && String(accessCode || '') !== code) throw new Error('รหัสเข้าใช้งานไม่ถูกต้อง');
  return email || 'unknown';
}
function needsAccessCode() { return !!prop('ACCESS_CODE', ''); }

/* ---------- sheet helpers ---------- */
function book_() {
  var id = prop('SHEET_ID', '');
  if (!id) throw new Error('ยังไม่ได้ตั้งค่า SHEET_ID ใน Script Properties');
  return SpreadsheetApp.openById(id);
}
function sheet_(name, cols) {
  var ss = book_(), sh = ss.getSheetByName(name);
  if (!sh) { sh = ss.insertSheet(name); }
  if (sh.getLastRow() === 0) {
    sh.appendRow(cols);
    sh.getRange(1, 1, 1, cols.length).setFontWeight('bold').setBackground('#1d3a5c').setFontColor('#ffffff');
    sh.setFrozenRows(1);
  }
  return sh;
}
/** Every row as an object keyed by the header row. */
function rows_(name, cols) {
  var sh = sheet_(name, cols);
  if (sh.getLastRow() < 2) return [];
  var head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  return sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).getValues().map(function (r) {
    var o = {};
    head.forEach(function (h, i) { if (h) o[h] = r[i]; });
    return o;
  }).filter(function (o) { return o[cols[0]]; });
}
function rowIndex_(sh, idCol, id) {
  var head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  var c = head.indexOf(idCol);
  if (c < 0 || sh.getLastRow() < 2) return -1;
  var vals = sh.getRange(2, c + 1, sh.getLastRow() - 1, 1).getValues();
  for (var i = 0; i < vals.length; i++) if (String(vals[i][0]) === String(id)) return i + 2;
  return -1;
}
function upsert_(name, cols, obj, idCol) {
  var sh = sheet_(name, cols);
  var head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  var row = head.map(function (h) { return obj[h] === undefined ? '' : obj[h]; });
  var at = rowIndex_(sh, idCol, obj[idCol]);
  if (at > 0) sh.getRange(at, 1, 1, row.length).setValues([row]);
  else sh.appendRow(row);
  return obj[idCol];
}
function remove_(name, cols, idCol, id) {
  var sh = sheet_(name, cols), at = rowIndex_(sh, idCol, id);
  if (at > 0) sh.deleteRow(at);
}
function now_()   { return Utilities.formatDate(new Date(), 'Asia/Bangkok', "yyyy-MM-dd'T'HH:mm:ss"); }
function today_() { return Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyy-MM-dd'); }
function uid_(p)  { return p + Utilities.getUuid().replace(/-/g, '').slice(0, 10); }
/** Sheets hands dates back as Date objects; the page wants plain yyyy-MM-dd. */
function d_(v) {
  if (!v) return '';
  if (Object.prototype.toString.call(v) === '[object Date]') {
    return Utilities.formatDate(v, 'Asia/Bangkok', 'yyyy-MM-dd');
  }
  return String(v);
}

/* ---------- read ---------- */
function getAll(payload) {
  requireAccess_(payload && payload.accessCode);
  var reqs = rows_(SH_REQ, REQ_COLS).map(function (r) {
    r.opened_at = d_(r.opened_at); r.target_start = d_(r.target_start);
    r.files = parseFiles_(r.files); r.headcount = Number(r.headcount) || 1;
    return r;
  });
  var cands = rows_(SH_CAND, CAND_COLS).map(function (c) {
    c.stage_since = d_(c.stage_since); c.applied_at = d_(c.applied_at);
    c.interview_at = d_(c.interview_at);
    c.files = parseFiles_(c.files);
    c.offer_salary = c.offer_salary === '' ? '' : Number(c.offer_salary) || '';
    return c;
  });
  var hist = rows_(SH_HIST, HIST_COLS).map(function (h) { h.at = d_(h.at) || String(h.at); return h; });
  return { reqs: reqs, cands: cands, hist: hist, me: requireAccess_(payload && payload.accessCode) };
}
function parseFiles_(v) {
  if (!v) return [];
  try { var a = JSON.parse(v); return Array.isArray(a) ? a : []; } catch (e) { return []; }
}

/* the role library, read from the live site and cached */
function getRoleIndex() {
  var cache = CacheService.getScriptCache(), hit = cache.get('roleIdx');
  if (hit) return JSON.parse(hit);
  var res = UrlFetchApp.fetch(SITE + '/data/job_roles.json', { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) throw new Error('โหลดข้อมูลตำแหน่งไม่สำเร็จ');
  var all = JSON.parse(res.getContentText()).roles || [];
  var ref = JSON.parse(UrlFetchApp.fetch(SITE + '/data/reference.json').getContentText());
  var co = {}; ref.companies.forEach(function (c) { co[c.code] = c.name_en; });
  var out = {
    companies: ref.companies.map(function (c) { return { c: c.code, n: c.name_en }; }),
    roles: all.filter(function (r) { return r.status === 'active'; }).map(function (r) {
      return { c: r.code, t: r.title_en || r.code, th: r.title_th || '',
               co: r.company, coN: co[r.company] || r.company, l: r.level };
    })
  };
  try { cache.put('roleIdx', JSON.stringify(out), 21600); } catch (e) {}
  return out;
}

/* ---------- write ---------- */
function saveReq(payload) {
  var me = requireAccess_(payload && payload.accessCode);
  var r = payload.req || {};
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    var isNew = !r.req_id;
    if (isNew) {
      r.req_id = uid_('req_');
      r.ref = nextRef_();
      r.status = r.status || 'open';
      r.created_by = me; r.created_at = now_();
      r.files = JSON.stringify(r.files || []);
      history_('req', r.req_id, '', 'open', me, 'เปิดตำแหน่ง');
    } else {
      var cur = rows_(SH_REQ, REQ_COLS).filter(function (x) { return x.req_id === r.req_id; })[0] || {};
      if (cur.status && r.status && cur.status !== r.status) {
        history_('req', r.req_id, cur.status, r.status, me, payload.note || '');
      }
      r.ref = r.ref || cur.ref; r.created_by = cur.created_by; r.created_at = cur.created_at;
      r.files = JSON.stringify(r.files || parseFiles_(cur.files));
    }
    r.updated_at = now_();
    upsert_(SH_REQ, REQ_COLS, r, 'req_id');
    return r.req_id;
  } finally { lock.releaseLock(); }
}
function nextRef_() {
  var y = new Date().getFullYear();
  var n = rows_(SH_REQ, REQ_COLS).filter(function (r) {
    return String(r.ref).indexOf('REQ-' + y) === 0; }).length + 1;
  return 'REQ-' + y + '-' + ('00' + n).slice(-3);
}

function saveCand(payload) {
  var me = requireAccess_(payload && payload.accessCode);
  var c = payload.cand || {};
  if (!c.req_id) throw new Error('ไม่พบตำแหน่งที่ผูกกับผู้สมัคร');
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    var cur = c.cand_id
      ? (rows_(SH_CAND, CAND_COLS).filter(function (x) { return x.cand_id === c.cand_id; })[0] || {})
      : {};
    if (!c.cand_id) {
      c.cand_id = uid_('cand_');
      c.stage = c.stage || 'submitted';
      c.stage_since = c.stage_since || today_();
      c.applied_at = c.applied_at || today_();
      c.created_by = me; c.created_at = now_();
      history_('cand', c.cand_id, '', c.stage, me, 'เพิ่มผู้สมัคร');
    } else {
      if (cur.stage && c.stage && cur.stage !== c.stage) {
        c.stage_since = today_();
        history_('cand', c.cand_id, cur.stage, c.stage, me, payload.note || '');
      } else {
        c.stage_since = c.stage_since || cur.stage_since;
      }
      c.created_by = cur.created_by; c.created_at = cur.created_at;
    }
    c.files = JSON.stringify(c.files || parseFiles_(cur.files));
    c.updated_at = now_();
    upsert_(SH_CAND, CAND_COLS, c, 'cand_id');
    autoCloseReq_(c.req_id, me);
    return c.cand_id;
  } finally { lock.releaseLock(); }
}

/** When onboarded candidates reach the headcount, close the requisition. */
function autoCloseReq_(reqId, me) {
  var req = rows_(SH_REQ, REQ_COLS).filter(function (r) { return r.req_id === reqId; })[0];
  if (!req || req.status !== 'open') return;
  var onboard = rows_(SH_CAND, CAND_COLS).filter(function (c) {
    return c.req_id === reqId && c.stage === 'onboard'; }).length;
  if (onboard >= (Number(req.headcount) || 1)) {
    req.status = 'filled'; req.updated_at = now_();
    req.files = JSON.stringify(parseFiles_(req.files));
    upsert_(SH_REQ, REQ_COLS, req, 'req_id');
    history_('req', reqId, 'open', 'filled', me, 'ครบจำนวนอัตราที่ต้องการ');
  }
}

function history_(entity, id, from, to, by, note) {
  var sh = sheet_(SH_HIST, HIST_COLS);
  sh.appendRow([today_(), entity, id, from, to, by, note || '']);
}

function deleteReq(payload) {
  var me = requireAccess_(payload && payload.accessCode);
  var id = payload.req_id;
  rows_(SH_CAND, CAND_COLS).filter(function (c) { return c.req_id === id; })
    .forEach(function (c) { remove_(SH_CAND, CAND_COLS, 'cand_id', c.cand_id); });
  remove_(SH_REQ, REQ_COLS, 'req_id', id);
  history_('req', id, '', 'deleted', me, 'ลบตำแหน่งและผู้สมัครที่ผูกอยู่');
}
function deleteCand(payload) {
  var me = requireAccess_(payload && payload.accessCode);
  remove_(SH_CAND, CAND_COLS, 'cand_id', payload.cand_id);
  history_('cand', payload.cand_id, '', 'deleted', me, '');
}

/* ---------- attachments (Drive — any file type) ---------- */
function uploadFile(payload) {
  var me = requireAccess_(payload && payload.accessCode);
  var fid = prop('DRIVE_FOLDER_ID', '');
  if (!fid) throw new Error('ยังไม่ได้ตั้งค่า DRIVE_FOLDER_ID ใน Script Properties');
  var bytes = Utilities.base64Decode(payload.data);
  if (bytes.length > 8 * 1024 * 1024) throw new Error('ไฟล์ใหญ่เกิน 8 MB');
  var blob = Utilities.newBlob(bytes, payload.mime || 'application/octet-stream', payload.name);
  var file = DriveApp.getFolderById(fid).createFile(blob);
  var rec = { id: file.getId(), name: payload.name, size: bytes.length,
              url: 'https://drive.google.com/file/d/' + file.getId() + '/view',
              at: today_(), by: me };

  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    if (payload.cand_id) {
      var c = rows_(SH_CAND, CAND_COLS).filter(function (x) { return x.cand_id === payload.cand_id; })[0];
      if (!c) throw new Error('ไม่พบผู้สมัคร');
      var cf = parseFiles_(c.files); cf.push(rec);
      c.files = JSON.stringify(cf); c.updated_at = now_();
      upsert_(SH_CAND, CAND_COLS, c, 'cand_id');
    } else {
      var r = rows_(SH_REQ, REQ_COLS).filter(function (x) { return x.req_id === payload.req_id; })[0];
      if (!r) throw new Error('ไม่พบตำแหน่ง');
      var rf = parseFiles_(r.files); rf.push(rec);
      r.files = JSON.stringify(rf); r.updated_at = now_();
      upsert_(SH_REQ, REQ_COLS, r, 'req_id');
    }
  } finally { lock.releaseLock(); }
  return rec;
}

function removeFile(payload) {
  requireAccess_(payload && payload.accessCode);
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    var keep = function (f) { return f.id !== payload.file_id; };
    if (payload.cand_id) {
      var c = rows_(SH_CAND, CAND_COLS).filter(function (x) { return x.cand_id === payload.cand_id; })[0];
      if (c) { c.files = JSON.stringify(parseFiles_(c.files).filter(keep)); c.updated_at = now_();
               upsert_(SH_CAND, CAND_COLS, c, 'cand_id'); }
    } else {
      var r = rows_(SH_REQ, REQ_COLS).filter(function (x) { return x.req_id === payload.req_id; })[0];
      if (r) { r.files = JSON.stringify(parseFiles_(r.files).filter(keep)); r.updated_at = now_();
               upsert_(SH_REQ, REQ_COLS, r, 'req_id'); }
    }
  } finally { lock.releaseLock(); }
  try { DriveApp.getFileById(payload.file_id).setTrashed(true); } catch (e) {}
}

/** One-time check from the editor: creates the sheets and reports the setup. */
function setupCheck() {
  var out = { sheet: !!prop('SHEET_ID',''), folder: !!prop('DRIVE_FOLDER_ID',''),
              domain: prop('ALLOWED_DOMAIN','(ไม่ได้ตั้ง)'), accessCode: needsAccessCode() };
  if (out.sheet) { sheet_(SH_REQ, REQ_COLS); sheet_(SH_CAND, CAND_COLS); sheet_(SH_HIST, HIST_COLS);
                   out.sheets = 'created/verified'; }
  Logger.log(JSON.stringify(out, null, 2));
  return out;
}
