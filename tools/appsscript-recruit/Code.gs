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
 * Setup: run setup() once from the editor → deploy → paste the /exec URL
 * into data/recruit_config.json. setup() fills the three properties below
 * itself; there is nothing to type into Script properties by hand.
 *
 * Deploy: Deploy → New deployment → Web app
 *   Execute as: Me       Who has access: Anyone
 *   "Anyone" is required. The browser calls this URL from github.io; a
 *   domain-restricted deployment answers that call with a Google sign-in page
 *   the browser cannot follow, and every request fails. The username and
 *   password are the gate, not the deployment setting.
 */

var SITE = 'https://jinnaphas.github.io/PccJobDesign';
var SH_REQ = 'Requisitions', SH_CAND = 'Candidates', SH_HIST = 'History', SH_USER = 'Users',
    SH_ATT = 'Attachments';

var REQ_COLS  = ['req_id','ref','role_code','role_title','role_title_th','company','level',
                 'dept','hiring_manager','recruiter','headcount','opened_at','target_start',
                 'status','note','files','created_by','created_at','updated_at'];
var CAND_COLS = ['cand_id','req_id','name','source','stage','stage_since','applied_at',
                 'interview_at','interviewer','offer_salary','reject_reason','note','files',
                 'created_by','created_at','updated_at'];
var HIST_COLS = ['at','entity','entity_id','from_stage','to_stage','by','note'];
/* The attachment audit deliberately holds no personal data: an opaque id, an
   extension, a size and a hash. The repository it is pushed to is public, so a
   candidate's name or a filename must never reach it. The hash is what ties a
   row to the file that stays in Drive. */
var ATT_COLS = ['at','action','entity','entity_id','req_ref','ext','bytes','sha256','by','pushed'];
// Passwords are stored salted+peppered and iterated: the sheet never holds a usable secret.
var USER_COLS = ['username','pass_hash','salt','name','email','role','active','created_at','last_seen'];

/* stage keys are shared with the page; keep both in step */
var CAND_STAGES = ['submitted','interview','confirmed','onboard','rejected','declined'];
var REQ_STATUS  = ['pending_ec','open','filled','hold','cancelled'];

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
function shaBytes_(bytes) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, bytes)
    .map(function (x) { return ('0' + (x & 0xff).toString(16)).slice(-2); }).join('');
}
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
/* ---------------------------------------------------------------------------
   Change one password from the editor.

   The Run button calls a function with no arguments, so setPassword('a','b')
   cannot be run directly. Fill the two lines below in, pick changePassword in
   the Run dropdown, run it once, then blank them out again and save.
   --------------------------------------------------------------------------- */
function changePassword() {
  var USERNAME     = '';          // e.g. 'recruit.a'
  var NEW_PASSWORD = '';          // at least 8 characters

  if (!USERNAME || !NEW_PASSWORD)
    throw new Error('\u0e43\u0e2a\u0e48 USERNAME \u0e41\u0e25\u0e30 NEW_PASSWORD \u0e43\u0e19\u0e1f\u0e31\u0e07\u0e01\u0e4c\u0e0a\u0e31\u0e19 changePassword \u0e01\u0e48\u0e2d\u0e19');
  setPassword(USERNAME, NEW_PASSWORD);
  Logger.log('\u0e40\u0e1b\u0e25\u0e35\u0e48\u0e22\u0e19\u0e23\u0e2b\u0e31\u0e2a\u0e1c\u0e48\u0e32\u0e19\u0e02\u0e2d\u0e07 ' + USERNAME +
             ' \u0e41\u0e25\u0e49\u0e27 \u2014 \u0e2d\u0e22\u0e48\u0e32\u0e25\u0e37\u0e21\u0e25\u0e1a\u0e04\u0e48\u0e32\u0e2a\u0e2d\u0e07\u0e1a\u0e23\u0e23\u0e17\u0e31\u0e14\u0e14\u0e49\u0e32\u0e19\u0e1a\u0e19\u0e2d\u0e2d\u0e01 \u0e41\u0e25\u0e49\u0e27 save');
  return 'ok';
}

/* Fresh random passwords for both accounts, printed once. Takes no arguments,
   so it runs straight from the Run dropdown and no password is ever typed into
   the source. Use it when the original log is gone. */
function resetBothPasswords() {
  var out = [];
  ['recruit.a', 'recruit.b'].forEach(function (u) {
    var pw = newPassword_();
    setPassword(u, pw);
    out.push(u + '    ' + pw);
  });
  Logger.log(JSON.stringify({ PASSWORDS_SHOWN_ONCE: out }, null, 2));
  return out;
}

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

/* ---------- one-off import of the existing recruitment sheet ---------- */

/**
 * Loads requisitions from a CSV placed in the attachments folder and named
 * recruit_import.csv. Its header must be the Requisitions columns.
 *
 * Takes no arguments, so it runs straight from the Run dropdown. It upserts on
 * req_id, so running it twice does not duplicate anything: a row already
 * present is updated, not added again, and only genuinely new rows get a
 * History entry. Delete the CSV afterwards -- it holds employee names, and the
 * attachments folder is the right place for that, not the repository.
 */
function importFromDrive() {
  var fid = prop('DRIVE_FOLDER_ID', '');
  if (!fid) throw new Error('ยังไม่ได้ตั้ง DRIVE_FOLDER_ID');
  var it = DriveApp.getFolderById(fid).getFilesByName('recruit_import.csv');
  if (!it.hasNext()) throw new Error('ไม่พบไฟล์ recruit_import.csv ในโฟลเดอร์แนบเอกสาร');
  var text = it.next().getBlob().getDataAsString('UTF-8').replace(/^\uFEFF/, '');
  var table = Utilities.parseCsv(text);
  if (table.length < 2) throw new Error('ไฟล์ว่าง');

  var head = table[0].map(function (h) { return String(h).trim(); });
  var miss = REQ_COLS.filter(function (c) { return head.indexOf(c) < 0; });
  if (miss.length) throw new Error('หัวคอลัมน์ขาด: ' + miss.join(', '));

  var have = {};
  rows_(SH_REQ, REQ_COLS).forEach(function (r) { have[r.req_id] = true; });

  var added = 0, updated = 0, skipped = 0;
  var lock = LockService.getScriptLock(); lock.waitLock(60000);
  try {
    for (var i = 1; i < table.length; i++) {
      var o = {};
      head.forEach(function (h, j) { o[h] = table[i][j]; });
      if (!o.req_id) { skipped++; continue; }
      var isNew = !have[o.req_id];
      upsert_(SH_REQ, REQ_COLS, o, 'req_id');
      if (isNew) {
        history_('req', o.req_id, '', o.status, 'นำเข้าจาก Excel',
                 'นำเข้าข้อมูลเดิม' + (o.opened_at ? ' (EC ' + o.opened_at + ')' : ''));
        have[o.req_id] = true; added++;
      } else updated++;
    }
  } finally { lock.releaseLock(); }

  var out = { added: added, updated: updated, skipped_without_req_id: skipped,
              total_in_sheet: rows_(SH_REQ, REQ_COLS).length,
              next: 'ลบไฟล์ recruit_import.csv ออกจากโฟลเดอร์เมื่อเสร็จ' };
  Logger.log(JSON.stringify(out, null, 2));
  return out;
}

/* ---------- attachment audit, mirrored to the repository ---------- */

/** Always written, whether or not a push is configured. */
function auditRow_(action, entity, entityId, reqRef, fileName, bytes, sha, by) {
  var ext = (String(fileName || '').match(/\.[A-Za-z0-9]{1,8}$/) || [''])[0].toLowerCase();
  sheet_(SH_ATT, ATT_COLS).appendRow([now_(), action, entity, entityId, reqRef || '',
    ext, bytes == null ? '' : bytes, sha || '', by || '', '']);
}

/**
 * Appends every unpushed row to data/recruit_audit/attachments.jsonl in the
 * repository and marks it pushed. Needs two script properties:
 *   GITHUB_REPO   e.g. owner/name
 *   GITHUB_TOKEN  a fine-grained token with Contents: Read and write on that
 *                 repository only
 * Without them the rows simply stay in the sheet. A failure here never fails
 * the upload that produced the row: the next call picks the row up again.
 */
function pushPendingAudit_() {
  var repo = prop('GITHUB_REPO', ''), tok = prop('GITHUB_TOKEN', '');
  if (!repo || !tok) return { pushed: 0, note: 'GITHUB_REPO / GITHUB_TOKEN not set' };

  var sh = sheet_(SH_ATT, ATT_COLS), rows = rows_(SH_ATT, ATT_COLS);
  var pend = [], at = ATT_COLS.indexOf('pushed') + 1;
  rows.forEach(function (r, i) { if (!String(r.pushed)) pend.push({ r: r, line: i + 2 }); });
  if (!pend.length) return { pushed: 0 };

  var path = 'data/recruit_audit/attachments.jsonl';
  var url = 'https://api.github.com/repos/' + repo + '/contents/' + path;
  var head = { Authorization: 'Bearer ' + tok, Accept: 'application/vnd.github+json' };
  var add = pend.map(function (p) {
    return JSON.stringify({ at: p.r.at, action: p.r.action, entity: p.r.entity,
      entity_id: p.r.entity_id, req_ref: p.r.req_ref, ext: p.r.ext,
      bytes: Number(p.r.bytes) || 0, sha256: p.r.sha256, by: p.r.by });
  }).join('\n') + '\n';

  for (var attempt = 0; attempt < 2; attempt++) {
    var get = UrlFetchApp.fetch(url, { headers: head, muteHttpExceptions: true });
    var code = get.getResponseCode(), sha = null, body = '';
    if (code === 200) {
      var j = JSON.parse(get.getContentText());
      sha = j.sha;
      body = Utilities.newBlob(Utilities.base64Decode(j.content)).getDataAsString();
      if (body && body.slice(-1) !== '\n') body += '\n';
    } else if (code !== 404) {
      throw new Error('GitHub อ่านไฟล์ไม่สำเร็จ (' + code + ')');
    }
    var put = { message: 'Record ' + pend.length + ' recruitment attachment event(s)',
                content: Utilities.base64Encode(body + add, Utilities.Charset.UTF_8) };
    if (sha) put.sha = sha;
    var res = UrlFetchApp.fetch(url, { method: 'put', headers: head,
      contentType: 'application/json', payload: JSON.stringify(put), muteHttpExceptions: true });
    var rc = res.getResponseCode();
    if (rc === 200 || rc === 201) {
      var stamp = now_();
      pend.forEach(function (p) { sh.getRange(p.line, at).setValue(stamp); });
      return { pushed: pend.length };
    }
    if (rc !== 409) throw new Error('GitHub เขียนไฟล์ไม่สำเร็จ (' + rc + '): ' +
      String(res.getContentText()).slice(0, 200));
    /* 409 means someone else wrote first; re-read and try once more. */
  }
  throw new Error('GitHub: ไฟล์ถูกแก้ระหว่างเขียน ลองอีกครั้ง');
}

/** Editor-runnable: push whatever is pending and report. */
function pushAuditNow() {
  var out = pushPendingAudit_();
  Logger.log(JSON.stringify(out, null, 2));
  return out;
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
  var sha = shaBytes_(bytes);
  var rec = { id: file.getId(), name: payload.name, size: bytes.length, sha: sha,
              url: 'https://drive.google.com/file/d/' + file.getId() + '/view',
              at: today_(), by: me };
  var reqRef = '';

  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    if (payload.cand_id) {
      var c = rows_(SH_CAND, CAND_COLS).filter(function (x) { return x.cand_id === payload.cand_id; })[0];
      if (!c) throw new Error('ไม่พบผู้สมัคร');
      var cf = parseFiles_(c.files); cf.push(rec);
      c.files = JSON.stringify(cf); c.updated_at = now_();
      upsert_(SH_CAND, CAND_COLS, c, 'cand_id');
      var cr = rows_(SH_REQ, REQ_COLS).filter(function (x) { return x.req_id === c.req_id; })[0];
      reqRef = (cr && cr.ref) || '';
    } else {
      var r = rows_(SH_REQ, REQ_COLS).filter(function (x) { return x.req_id === payload.req_id; })[0];
      if (!r) throw new Error('ไม่พบตำแหน่ง');
      var rf = parseFiles_(r.files); rf.push(rec);
      r.files = JSON.stringify(rf); r.updated_at = now_();
      upsert_(SH_REQ, REQ_COLS, r, 'req_id');
      reqRef = r.ref || '';
    }
  } finally { lock.releaseLock(); }

  /* The file is already stored, so neither the audit append nor the push may
     fail the upload. An unpushed row is retried by the next call. */
  try {
    auditRow_('attach', payload.cand_id ? 'cand' : 'req',
              payload.cand_id || payload.req_id, reqRef, payload.name, bytes.length, sha, me);
    try { pushPendingAudit_(); } catch (e) { Logger.log('audit push deferred: ' + e); }
  } catch (e) { Logger.log('audit row failed: ' + e); }
  return rec;
}

function removeFile_(payload) {
  var gone = null, reqRef = '';
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    var keep = function (f) { return f.id !== payload.file_id; };
    var taken = function (list) {
      gone = list.filter(function (f) { return f.id === payload.file_id; })[0] || gone; };
    if (payload.cand_id) {
      var c = rows_(SH_CAND, CAND_COLS).filter(function (x) { return x.cand_id === payload.cand_id; })[0];
      if (c) { var cl = parseFiles_(c.files); taken(cl);
               c.files = JSON.stringify(cl.filter(keep)); c.updated_at = now_();
               upsert_(SH_CAND, CAND_COLS, c, 'cand_id');
               var cr = rows_(SH_REQ, REQ_COLS).filter(function (x) { return x.req_id === c.req_id; })[0];
               reqRef = (cr && cr.ref) || ''; }
    } else {
      var r = rows_(SH_REQ, REQ_COLS).filter(function (x) { return x.req_id === payload.req_id; })[0];
      if (r) { var rl = parseFiles_(r.files); taken(rl);
               r.files = JSON.stringify(rl.filter(keep)); r.updated_at = now_();
               upsert_(SH_REQ, REQ_COLS, r, 'req_id'); reqRef = r.ref || ''; }
    }
  } finally { lock.releaseLock(); }
  try { DriveApp.getFileById(payload.file_id).setTrashed(true); } catch (e) {}

  /* Removing is an audit event too, and it reuses the hash recorded when the
     file arrived, so the pair of rows describes the same file. */
  try {
    auditRow_('remove', payload.cand_id ? 'cand' : 'req',
              payload.cand_id || payload.req_id, reqRef,
              gone && gone.name, gone && gone.size, gone && gone.sha,
              (payload.__me && payload.__me.name) || '');
    try { pushPendingAudit_(); } catch (e) { Logger.log('audit push deferred: ' + e); }
  } catch (e) { Logger.log('audit row failed: ' + e); }
  return true;
}

/**
 * Run this once from the editor and the setup is done. It creates the
 * spreadsheet and the attachments folder, generates the password pepper,
 * builds the tabs, and creates the two recruiter accounts with random
 * passwords — which it prints once, in the execution log.
 *
 * Safe to run again: it never overwrites a property, re-creates a user, or
 * resets a password. A second run just reports the current state.
 *
 * Pass ids to adopt a spreadsheet and folder that already exist:
 *   setup('<spreadsheet id>', '<folder id>')
 */
function setup(sheetId, folderId) {
  var sp = PropertiesService.getScriptProperties(), out = {}, made = [];

  if (sp.getProperty('TOKEN_SALT')) out.pepper = 'already set (left alone)';
  else {
    sp.setProperty('TOKEN_SALT', Utilities.getUuid() + Utilities.getUuid());
    out.pepper = 'generated';
  }

  var sid = sp.getProperty('SHEET_ID') || sheetId, fresh = false;
  if (!sid) { sid = SpreadsheetApp.create('PCC Recruitment Data').getId(); out.spreadsheet = 'created'; fresh = true; }
  else out.spreadsheet = sp.getProperty('SHEET_ID') ? 'already set' : 'adopted';
  sp.setProperty('SHEET_ID', sid);
  out.spreadsheet_url = 'https://docs.google.com/spreadsheets/d/' + sid + '/edit';

  var fid = sp.getProperty('DRIVE_FOLDER_ID') || folderId;
  if (!fid) { fid = DriveApp.createFolder('PCC Recruitment \u2014 Attachments').getId(); out.folder = 'created'; }
  else out.folder = sp.getProperty('DRIVE_FOLDER_ID') ? 'already set' : 'adopted';
  sp.setProperty('DRIVE_FOLDER_ID', fid);
  out.folder_url = 'https://drive.google.com/drive/folders/' + fid;

  sheet_(SH_REQ, REQ_COLS); sheet_(SH_CAND, CAND_COLS);
  sheet_(SH_HIST, HIST_COLS); sheet_(SH_USER, USER_COLS); sheet_(SH_ATT, ATT_COLS);
  out.tabs = [SH_REQ, SH_CAND, SH_HIST, SH_USER, SH_ATT].join(', ');
  out.audit_push = (prop('GITHUB_REPO', '') && prop('GITHUB_TOKEN', ''))
    ? 'configured' : 'off (rows stay in the Attachments tab)';

  /* A new spreadsheet comes with an empty Sheet1. Drop it, but only when this
     run created the spreadsheet and the tab is genuinely empty, so an adopted
     workbook never loses a sheet that holds something. */
  if (fresh) {
    var ss = SpreadsheetApp.openById(sid), s1 = ss.getSheetByName('Sheet1');
    if (s1 && s1.getLastRow() === 0 && s1.getLastColumn() === 0 && ss.getSheets().length > 1) {
      ss.deleteSheet(s1);
      out.removed_default_tab = 'Sheet1';
    }
  }

  var have = rows_(SH_USER, USER_COLS).map(function (u) { return String(u.username).toLowerCase(); });
  [['recruit.a', '\u0e19\u0e49\u0e2d\u0e07 A'], ['recruit.b', '\u0e19\u0e49\u0e2d\u0e07 B']].forEach(function (pair) {
    if (have.indexOf(pair[0]) >= 0) return;
    var pw = newPassword_();
    createUser(pair[0], pw, pair[1], '');
    made.push(pair[0] + '    ' + pw);
  });
  out.users = rows_(SH_USER, USER_COLS).length;
  if (made.length) out.PASSWORDS_SHOWN_ONCE = made;
  else out.passwords = 'users already existed, so no password is shown \u2014 ' +
                       "change one with setPassword('recruit.a','\u0e23\u0e2b\u0e31\u0e2a\u0e43\u0e2b\u0e21\u0e48')";

  out.NEXT = 'Deploy \u2192 Manage deployments \u2192 Edit \u2192 Version: New version \u2192 Deploy';
  Logger.log(JSON.stringify(out, null, 2));
  return out;
}

/** The name earlier instructions used. */
function setupCheck() { return setup(); }

/** Random password without characters that are easy to confuse by eye. */
function newPassword_() {
  var a = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789', s = '';
  var hex = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
  for (var i = 0; i < 14; i++) s += a.charAt(parseInt(hex.substr(i * 2, 2), 16) % a.length);
  return s;
}
