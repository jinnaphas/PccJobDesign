/**
 * PCC Resume Screening — Google Apps Script backend
 *
 * Serves the screening UI and calls the Anthropic Messages API with the API key
 * held server-side in Script Properties, so HR can use it from a browser with
 * only their Google login — no Claude account or seat required.
 *
 * Script Properties (Project Settings → Script properties):
 *   ANTHROPIC_API_KEY  (required)  key from console.anthropic.com
 *   ALLOWED_DOMAIN     (optional)  e.g. precise.co.th — rejects anyone else
 *   ACCESS_CODE        (optional)  shared code, for "Anyone" deployments
 *   MODEL              (optional)  default claude-opus-5
 *   EFFORT             (optional)  low | medium | high   (default low — keeps
 *                                  each call well inside UrlFetchApp's ~60s cap)
 *   LOG_SHEET_ID       (optional)  Spreadsheet id to append an audit row per run
 *
 * Deploy: Deploy → New deployment → Web app
 *   Execute as: Me       Who has access: Anyone within <your Workspace domain>
 */

var SITE = 'https://jinnaphas.github.io/PccJobDesign';
var API = 'https://api.anthropic.com/v1/messages';
var DEFAULT_MODEL = 'claude-opus-5';
var DEFAULT_EFFORT = 'low';

function prop(k, dflt) {
  var v = PropertiesService.getScriptProperties().getProperty(k);
  return (v === null || v === '') ? dflt : v;
}

function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('PCC Resume Screening')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/** Who is calling, and may they? Throws a readable error when not. */
function requireAccess_(accessCode) {
  var email = '';
  try { email = Session.getActiveUser().getEmail() || ''; } catch (e) { email = ''; }

  var domain = prop('ALLOWED_DOMAIN', '');
  if (domain) {
    if (!email) {
      throw new Error('ไม่สามารถยืนยันตัวตนได้ — กรุณาเปิดด้วยบัญชี @' + domain);
    }
    var suffix = '@' + domain.toLowerCase();
    if (email.toLowerCase().slice(-suffix.length) !== suffix) {
      throw new Error('บัญชี ' + email + ' ไม่มีสิทธิ์ใช้งาน (ต้องเป็น @' + domain + ')');
    }
  }
  var code = prop('ACCESS_CODE', '');
  if (code && String(accessCode || '') !== code) {
    throw new Error('รหัสเข้าใช้งานไม่ถูกต้อง');
  }
  return email || 'unknown';
}

function needsAccessCode() {
  return !!prop('ACCESS_CODE', '');
}

/** Slim role list for the picker (cached — the full file is ~500 KB). */
function getRoleIndex() {
  var cache = CacheService.getScriptCache();
  var hit = cache.get('roleIndex');
  if (hit) return JSON.parse(hit);

  var roles = fetchRoles_();
  var slim = roles.map(function (r) {
    return { c: r.code, t: r.title_en || r.code, th: r.title_th || '',
             l: r.level, f: r.family_code, co: r.company };
  });
  try { cache.put('roleIndex', JSON.stringify(slim), 21600); } catch (e) {} // >100KB just won't cache
  return slim;
}

/** Full detail for one role, shaped for the prompt. */
function getRole(code) {
  var roles = fetchRoles_();
  var r = null;
  for (var i = 0; i < roles.length; i++) { if (roles[i].code === code) { r = roles[i]; break; } }
  if (!r) throw new Error('ไม่พบตำแหน่ง ' + code);
  var s = r.specs || {}, ed = s.education || {}, ex = s.experience || {};
  return {
    code: r.code, title_en: r.title_en, title_th: r.title_th || '',
    level: r.level, company: r.company, family: r.family_code,
    purpose: (r.purpose_th || '').slice(0, 900),
    krs: (r.krs || []).map(function (k) {
      return { name: k.name_th || '', weight: k.weight_pct || 0, kpis: (k.kpis || []).slice(0, 4) };
    }),
    specs: {
      education: ((ed.level || '') + (ed.field ? ' — ' + ed.field : '')).trim(),
      min_years: ex.min_years || 0, exp_note: (ex.note || '').slice(0, 300),
      skills: (s.skills || []).slice(0, 10),
      digital: (s.digital || []).slice(0, 8),
      certs: (s.certs || []).slice(0, 6),
      english: (s.languages || {}).english || ''
    }
  };
}

function fetchRoles_() {
  var res = UrlFetchApp.fetch(SITE + '/data/job_roles.json', { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) throw new Error('โหลดข้อมูลตำแหน่งไม่สำเร็จ (' + res.getResponseCode() + ')');
  var all = JSON.parse(res.getContentText()).roles || [];
  return all.filter(function (r) { return r.status === 'active'; });
}

/** The JSON shape the model must return — enforced by output_config.format. */
function schema_(krCount) {
  var str = { type: 'string' };
  var pct = { type: 'integer', minimum: 0, maximum: 100 };
  var list = { type: 'array', items: str, maxItems: 4 };
  return {
    type: 'object',
    properties: {
      name: str, current_title: str, current_company: str,
      education: {
        type: 'object',
        properties: { level: { type: 'string', enum: ['PhD', 'Master', 'Bachelor', 'Vocational', 'Other'] }, field: str },
        required: ['level', 'field'], additionalProperties: false
      },
      experience: {
        type: 'object',
        properties: { total_years: { type: 'number' }, relevant_years: { type: 'number' } },
        required: ['total_years', 'relevant_years'], additionalProperties: false
      },
      languages: {
        type: 'object',
        properties: { english: { type: 'string', enum: ['High', 'Medium', 'Low'] } },
        required: ['english'], additionalProperties: false
      },
      scores: {
        type: 'object',
        properties: { education: pct, experience: pct, skills: pct, english: pct, digital: pct, certifications: pct },
        required: ['education', 'experience', 'skills', 'english', 'digital', 'certifications'],
        additionalProperties: false
      },
      kr_alignment: { type: 'array', items: pct, minItems: krCount, maxItems: krCount },
      key_strengths: list, key_gaps: list, evidence: list, risk_flags: { type: 'array', items: str, maxItems: 3 }
    },
    required: ['name', 'current_title', 'current_company', 'education', 'experience',
               'languages', 'scores', 'kr_alignment', 'key_strengths', 'key_gaps', 'evidence', 'risk_flags'],
    additionalProperties: false
  };
}

function buildPrompt_(jd, resume) {
  var krLines = jd.krs.length
    ? jd.krs.map(function (k, i) {
        return '  ' + i + '. ' + k.name + ' (น้ำหนัก ' + k.weight + '%)' +
               (k.kpis.length ? ' | KPI: ' + k.kpis.join(', ') : '');
      }).join('\n')
    : '  (ไม่มี KR)';

  return 'คุณคือผู้เชี่ยวชาญด้านสรรหาบุคลากร ประเมินความเหมาะสมของผู้สมัครเทียบกับ Job Description\n\n' +
    '=== JOB DESCRIPTION ===\n' +
    'ตำแหน่ง: ' + jd.title_en + (jd.title_th ? ' (' + jd.title_th + ')' : '') + '\n' +
    'รหัส: ' + jd.code + ' | ระดับ: ' + jd.level + '\n\n' +
    'วัตถุประสงค์:\n' + (jd.purpose || '-') + '\n\n' +
    'ความรับผิดชอบหลัก (KR) — ใช้ลำดับนี้เป็น index ของ kr_alignment:\n' + krLines + '\n\n' +
    'คุณสมบัติที่ต้องการ:\n' +
    '- การศึกษา: ' + (jd.specs.education || '-') + '\n' +
    '- ประสบการณ์ขั้นต่ำ: ' + jd.specs.min_years + ' ปี ' + (jd.specs.exp_note || '') + '\n' +
    '- ทักษะหลัก: ' + (jd.specs.skills.join(' · ') || '-') + '\n' +
    '- ทักษะดิจิทัล: ' + (jd.specs.digital.join(' · ') || '-') + '\n' +
    '- ใบรับรอง: ' + (jd.specs.certs.join(' · ') || '-') + '\n' +
    '- ภาษาอังกฤษ: ' + (jd.specs.english || '-') + '\n\n' +
    '=== RESUME ===\n' + String(resume).slice(0, 12000) + '\n\n' +
    '=== วิธีประเมิน ===\n' +
    'ให้คะแนน 0-100 ต่อมิติ โดยอ้างอิงหลักฐานที่ปรากฏใน resume เท่านั้น:\n' +
    'education (วุฒิ/สาขาตรงกับ JD) · experience (จำนวนปีและความเกี่ยวข้อง) · skills (ทักษะหลักตรง JD) · ' +
    'english (เทียบกับที่ JD ต้องการ) · digital (เครื่องมือ/ดิจิทัล) · certifications (ใบรับรองตาม JD)\n' +
    'kr_alignment: ให้คะแนนความสอดคล้องกับ KR แต่ละข้อ เรียงตามลำดับข้างต้น\n\n' +
    'ข้อบังคับ:\n' +
    '1. ห้ามแต่งข้อมูลที่ไม่มีใน resume — ไม่พบข้อมูลมิติใด ให้คะแนนต่ำและระบุใน key_gaps\n' +
    '2. ห้ามนำ อายุ เพศ ศาสนา สถานภาพสมรส สัญชาติ หรือรูปถ่าย มาประกอบการให้คะแนน\n' +
    '3. evidence ต้องยกข้อความ/ข้อเท็จจริงที่อ้างอิงได้จาก resume จริง\n' +
    '4. ถ้าไม่พบชื่อ ให้ใช้ "(ไม่ระบุชื่อ)" · ถ้าไม่มีข้อสังเกต ให้ risk_flags เป็น []';
}

/** Analyse one resume. Called from the page via google.script.run. */
function analyze(payload) {
  var email = requireAccess_(payload && payload.accessCode);
  var key = prop('ANTHROPIC_API_KEY', '');
  if (!key) throw new Error('ยังไม่ได้ตั้งค่า ANTHROPIC_API_KEY ใน Script Properties');

  var jd = payload.role;
  if (!jd) throw new Error('ยังไม่ได้เลือกตำแหน่ง');
  var resume = payload.resume || '';
  if (resume.length < 40) throw new Error('เนื้อหา resume สั้นเกินไป');

  var body = {
    model: prop('MODEL', DEFAULT_MODEL),
    max_tokens: 16000,
    messages: [{ role: 'user', content: buildPrompt_(jd, resume) }],
    output_config: {
      effort: prop('EFFORT', DEFAULT_EFFORT),
      format: { type: 'json_schema', schema: schema_((jd.krs || []).length) }
    }
  };

  var res = UrlFetchApp.fetch(API, {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    payload: JSON.stringify(body),
    muteHttpExceptions: true
  });

  var code = res.getResponseCode();
  var text = res.getContentText();
  if (code !== 200) {
    var msg = text;
    try { msg = JSON.parse(text).error.message; } catch (e) {}
    throw new Error('Anthropic API ' + code + ': ' + msg);
  }

  var out = JSON.parse(text);
  if (out.stop_reason === 'refusal') throw new Error('คำขอถูกปฏิเสธโดยระบบความปลอดภัย');

  var block = null;
  for (var i = 0; i < out.content.length; i++) {
    if (out.content[i].type === 'text') { block = out.content[i].text; break; }
  }
  if (!block) throw new Error('ไม่พบเนื้อหาในคำตอบ');

  var data = JSON.parse(block); // output_config.format guarantees valid JSON
  data.analyzed_at = Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyy-MM-dd');
  data.usage = { input: out.usage.input_tokens, output: out.usage.output_tokens };

  logRun_(email, jd.code, data);
  return data;
}

/** Optional audit trail — one row per analysis. */
function logRun_(email, roleCode, data) {
  var id = prop('LOG_SHEET_ID', '');
  if (!id) return;
  try {
    var sh = SpreadsheetApp.openById(id).getSheets()[0];
    if (sh.getLastRow() === 0) {
      sh.appendRow(['timestamp', 'user', 'role_code', 'candidate', 'overall_hint',
                    'input_tokens', 'output_tokens']);
    }
    sh.appendRow([new Date(), email, roleCode, data.name || '',
                  JSON.stringify(data.scores || {}), data.usage.input, data.usage.output]);
  } catch (e) { /* logging must never break a screening */ }
}
