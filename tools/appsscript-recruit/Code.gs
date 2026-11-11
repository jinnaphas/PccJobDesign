/**
 * PCC Recruitment Tracker — Google Apps Script backend
 *
 * This is the API only. The recruitment team works in the portal page
 * apps/recruit.html, signing in with a username and password that this script
 * verifies. The signed-in person is recorded on every change.
 *
 * Storage
 *   Google Sheet  — Requisitions / Candidates / History / Users (created on first run)
 *   Drive folder  — attachments (any file type, including .docx and .xlsx)
 *
 * Script Properties (Project Settings → Script properties):
 *   SHEET_ID        (required)  the spreadsheet used as the database
 *   DRIVE_FOLDER_ID (required)  folder that holds uploaded documents
 *   TOKEN_SALT      (required)  long random string, the password pepper.
 *                               Set it BEFORE creating any user: changing it
 *                               later invalidates every stored password.
 *
 * Setup order: set the three properties → run setupCheck() → run createUser()
 * once per person → deploy → paste the /exec URL into data/recruit_config.json.
 *
 * Deploy: Deploy → New deployment → Web app
 *   Execute as: Me       Who has access: Anyone
 *   "Anyone" is required. The browser calls this URL from github.io; a
 *   domain-restricted deployment answers that call with a Google sign-in page
 *   the browser cannot follow, and every request fails. The username and
 *   password are the gate, not the deployment setting.
 */

var SITE = 'https://jinnaphas.github.io/PccJobDesign';
var SH_REQ = 'Requisitions', SH_CAND = 'Candidates', SH_HIST = 'History', SH_USER = 'Users';

var REQ_COLS  = ['req_id','ref','role_code','role_title','role_title_th','company','level',
                 'dept','hiring_manager','recruiter','headcount','opened_at','target_start',
                 'status','note','files','created_by','created_at','updated_at'];
var CAND_COLS = ['cand_id','req_id','name','source','stage','stage_since','applied_at',
                 'interview_at','interviewer','offer_salary','reject_reason','note','files',
                 'created_by','created_at','updated_at'];
var HIST_COLS = ['at','entity','entity_id','from_stage','to_stage','by','note'];
// Passwords are stored salted+peppered and iterated: the sheet never holds a usable secret.
var USER_COLS = ['username','pass_hash','salt','name','email','role','active','created_at','last_seen'];

/* stage keys are shared with the page; keep both in step */
var CAND_STAGES = ['submitted','interview','confirmed','onboard','rejected','declined'];
var REQ_STATUS  = ['open','filled','hold','cancelled'];

function prop(k, dflt) {
  var v = PropertiesService.getScriptProperties().getProperty(k);
  return (v === null || v === '') ? dflt : v;
}

/** Opening the web app URL confirms the deployment; the UI lives on the portal. */
function doGet() {
  var n = {};
  try { n = { users: rows_(SH_USER, USER_COLS).length, reqs: rows_(SH_REQ, REQ_COLS).length }; }
  catch (e) { n = { error: String(e && e.message || e) }; }
  return HtmlService.createHtmlOutput(
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<div style="font:14px/1.6 system-ui;padding:28px;max-width:560px">' +
    '<h2 style="margin:0 0 6px">PCC Recruitment API</h2>' +
    '<p style="color:#555">ปลายทางนี้เป็น API — หน้าใช้งานอยู่ที่พอร์ทัล ' +
    '<a href="' + SITE + '/apps/recruit.html">Recruitment Control List</a></p>' +
    '<pre style="background:#f4f6f8;padding:12px;border-radius:8px">' +
    JSON.stringify(n, null, 2) + '</pre></div>')
    .setTitle('PCC Recruitment API');
}

/* ---------- access: username + password, then a server-issued session ---------- */
var SESSION_HOURS = 6;

function pepper_() { return prop('TOKEN_SALT', 'pcc-recruit'); }
function sha_(str) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, str, Utilities.Charset.UTF_8)
    .map(function (x) { return ('0' + (x & 0xff).toString(16)).slice(-2); }).join('');
}
/** Iterated so a leaked sheet cannot be brute-forced cheaply. */
function hashPw_(pw, salt) {
  var h = sha_(pepper_() + '|' + salt + '|' + String(pw));
  for (var i = 0; i < 1200; i++) h = sha_(h);
  return h;
}
function constEq_(a, b) {
  a = String(a); b = String(b);
  if (a.length !== b.length) return false;
  var d = 0;
  for (var i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

/** Exchange username + password for a session id. */
function login_(username, password) {
  throttle_();
  var u = rows_(SH_USER, USER_COLS).filter(function (x) {
    return String(x.username).toLowerCase() === String(username || '').toLowerCase(); })[0];
  if (!u || String(u.active).toUpperCase() === 'FALSE' ||
      !constEq_(u.pass_hash, hashPw_(password, u.salt))) {
    bumpFail_();
    throw new Error('ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง');
  }
  var sh = sheet_(SH_USER, USER_COLS), at = rowIndex_(sh, 'username', u.username);
  if (at > 0) sh.getRange(at, USER_COLS.indexOf('last_seen') + 1).setValue(now_());

  var sid = Utilities.getUuid() + Utilities.getUuid().slice(0, 8);
  var who = { name: u.name, email: u.email, role: u.role || 'recruiter', username: u.username };
  CacheService.getScriptCache().put('s_' + sha_(sid), JSON.stringify(who), SESSION_HOURS * 3600);
  return { session: sid, user: who, expires_hours: SESSION_HOURS };
}

/** Every data call resolves its caller from the session id. */
function requireAuth_(session) {
  if (!session) throw new Error('UNAUTHENTICATED');
  var raw = CacheService.getScriptCache().get('s_' + sha_(session));
  if (!raw) throw new Error('UNAUTHENTICATED');
  return JSON.parse(raw);
}
function logout_(session) {
  if (session) CacheService.getScriptCache().remove('s_' + sha_(session));
  return true;
}

function throttle_() {
  if (Number(CacheService.getScriptCache().get('authfail') || 0) >= 15) {
    throw new Error('พยายามเข้าสู่ระบบผิดหลายครั้ง — กรุณารอสักครู่');
  }
}
function bumpFail_() {
  var c = CacheService.getScriptCache();
  c.put('authfail', String(Number(c.get('authfail') || 0) + 1), 600);
}

/* ---- user administration: run from the Apps Script editor ---- */

/** createUser('recruit.a','รหัสผ่าน','ชื่อน้อง A','a@precise.co.th') */
function createUser(username, password, name, email, role) {
  if (!username || !password) throw new Error('ต้องระบุ username และ password');
  if (String(password).length < 8) throw new Error('รหัสผ่านต้องยาวอย่างน้อย 8 ตัวอักษร');
  sheet_(SH_USER, USER_COLS);
  var salt = Utilities.getUuid();
  upsert_(SH_USER, USER_COLS, {
    username: String(username).toLowerCase(), pass_hash: hashPw_(password, salt), salt: salt,
    name: name || username, email: email || '', role: role || 'recruiter',
    active: 'TRUE', created_at: now_(), last_seen: ''
  }, 'username');
  Logger.log('สร้าง/อัปเดตผู้ใช้ ' + username + ' แล้ว — แจ้งรหัสผ่านให้เจ้าตัวแบบส่วนตัว');
  return 'ok';
}
/** setPassword('recruit.a','รหัสผ่านใหม่') */
function setPassword(username, password) { 
  var u = rows_(SH_USER, USER_COLS).filter(function (x) {
    return String(x.username).toLowerCase() === String(username).toLowerCase(); })[0];
  if (!u) throw new Error('ไม่พบผู้ใช้ ' + username);
  return createUser(u.username, password, u.name, u.email, u.role);
}
/** revokeUser('recruit.a') — blocks sign-in, keeps the audit trail. */
function revokeUser(username) {
  var sh = sheet_(SH_USER, USER_COLS), at = rowIndex_(sh, 'username', String(username).toLowerCase());
  if (at < 0) { Logger.log('ไม่พบผู้ใช้ ' + username); return 0; }
  sh.getRange(at, USER_COLS.indexOf('active') + 1).setValue('FALSE');
  Logger.log('ปิดการใช้งาน ' + username + ' แล้ว');
  return 1;
}
function listUsers() {
  var out = rows_(SH_USER, USER_COLS).map(function (u) {
    return { username: u.username, name: u.name, email: u.email, role: u.role,
             active: u.active, last_seen: d_(u.last_seen) || u.last_seen }; });
  Logger.log(JSON.stringify(out, null, 2));
  return out;
}

/* ---------- JSON API for the portal page ----------
 * The browser posts text/plain so the request stays "simple" and needs no
 * CORS preflight, which an Apps Script web app cannot answer.
 */
function doPost(e) {
  var out = { ok: false };
  try {
    var body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    var action = body.action, p = body.payload || {};
    if (action === 'login')  { out = { ok: true, data: login_(p.username, p.password) }; }
    else if (action === 'logout') { out = { ok: true, data: logout_(body.session) }; }
    else {
      var me = requireAuth_(body.session);          // throws UNAUTHENTICATED
      p.__me = me;
      if (action === 'getAll')      out = { ok: true, data: apiGetAll_(me) };
      else if (action === 'roles')  out = { ok: true, data: roleIndex_() };
      else if (action === 'saveReq')    out = { ok: true, data: saveReq_(me, p.req, p.note) };
      else if (action === 'saveCand')   out = { ok: true, data: saveCand_(me, p.cand, p.note) };
      else if (action === 'deleteReq')  out = { ok: true, data: deleteReq_(me, p.req_id) };
      else if (action === 'deleteCand') out = { ok: true, data: deleteCand_(me, p.cand_id) };
      else if (action === 'upload')     out = { ok: true, data: uploadFile_(me, p) };
      else if (action === 'removeFile') out = { ok: true, data: removeFile_(p) };
      else throw new Error('ไม่รู้จักคำสั่ง: ' + action);
    }
  } catch (err) {
    out = { ok: false, error: String(err && err.message || err) };
  }
  return ContentService.createTextOutput(JSON.stringify(out))
    .setMimeType(ContentService.MimeType.JSON);
}

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
function apiGetAll_(me) {
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
  return { reqs: reqs, cands: cands, hist: hist, me: me.name, email: me.email, role: me.role };
}
function parseFiles_(v) {
  if (!v) return [];
  try { var a = JSON.parse(v); return Array.isArray(a) ? a : []; } catch (e) { return []; }
}

/* the role library, read from the live site and cached */
function roleIndex_() {
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
function saveReq_(meObj, req, note) {
  var me = meObj.name;
  var r = req || {};
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
        history_('req', r.req_id, cur.status, r.status, me, note || '');
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

function saveCand_(meObj, cand, note) {
  var me = meObj.name;
  var c = cand || {};
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
        history_('cand', c.cand_id, cur.stage, c.stage, me, note || '');
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

function deleteReq_(meObj, id) {
  var me = meObj.name;
  rows_(SH_CAND, CAND_COLS).filter(function (c) { return c.req_id === id; })
    .forEach(function (c) { remove_(SH_CAND, CAND_COLS, 'cand_id', c.cand_id); });
  remove_(SH_REQ, REQ_COLS, 'req_id', id);
  history_('req', id, '', 'deleted', me, 'ลบตำแหน่งและผู้สมัครที่ผูกอยู่');
  return true;
}
function deleteCand_(meObj, cand_id) {
  var me = meObj.name;
  remove_(SH_CAND, CAND_COLS, 'cand_id', cand_id);
  history_('cand', cand_id, '', 'deleted', me, '');
  return true;
}

/* ---------- attachments (Drive — any file type) ---------- */
function uploadFile_(meObj, payload) {
  var me = meObj.name;
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

function removeFile_(payload) {
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
  return true;
}

/** One-time check from the editor: creates the sheets and reports the setup. */
function setupCheck() {
  var out = { auth: 'username + password', sheet_id_set: !!prop('SHEET_ID', ''),
              folder_id_set: !!prop('DRIVE_FOLDER_ID', ''), salt_set: !!prop('TOKEN_SALT', '') };
  if (out.sheet_id_set) {
    sheet_(SH_REQ, REQ_COLS); sheet_(SH_CAND, CAND_COLS);
    sheet_(SH_HIST, HIST_COLS); sheet_(SH_USER, USER_COLS);
    out.sheets = 'created/verified';
    out.users = rows_(SH_USER, USER_COLS).length;
  } else {
    out.error = 'SHEET_ID ยังว่าง — ใส่ id ของ Google Sheet (เอาเฉพาะ id จาก URL ไม่ใช่ URL ทั้งอัน) ที่ Project Settings → Script properties';
  }
  if (!out.folder_id_set) out.warning_folder = 'DRIVE_FOLDER_ID ยังว่าง — การแนบเอกสารจะใช้ไม่ได้';
  if (!out.salt_set) out.warning_salt = 'TOKEN_SALT ยังว่าง — ตั้งก่อนสร้างผู้ใช้ มิฉะนั้นรหัสผ่านที่สร้างไว้จะใช้ไม่ได้';
  if (out.users === 0)
    out.next = "รัน createUser('recruit.a','รหัสผ่านอย่างน้อย8ตัว','ชื่อผู้ใช้','email@precise.co.th') หนื่งครั้งต่อคน";
  Logger.log(JSON.stringify(out, null, 2));
  return out;
}
