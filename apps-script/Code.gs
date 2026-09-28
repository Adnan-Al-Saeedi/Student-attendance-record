/**
 * خادم سجل حضور المرحلة الثانية — Google Apps Script
 * قسم تقنيات شبكات وبرمجيات الحاسوب، كلية البوليتكنك / بابل
 *
 * يُلصق هذا الملف في محرر Apps Script المرتبط بجدول Google Sheets
 * (Extensions > Apps Script)، ثم تُشغَّل الدالة setup مرة واحدة،
 * ثم يُنشر كتطبيق ويب: Execute as: Me — Who has access: Anyone.
 */

// المواد وتدريسيوها. المعرّفات يجب أن تطابق ما في app.js.
const SUBJECTS = {
  'sql-t': 'ا.م.د. بيمان حسين', 'sql-p': 'ا.م.د. بيمان حسين',
  'php-t': 'ا.م.د. عمار وسام',  'php-p': 'ا.م.د. عمار وسام',
  'np-t':  'م.د. عدنان عذاب',   'np-p':  'م.د. عدنان عذاب',
  'sw-t':  'م.م. ياسر حسن',     'sw-p':  'م.م. ياسر حسن',
  'sec-t': 'م.د. ضياء صالح',
  'eng-t': 'م.د. علي خالد',
  'bth-t': 'م.م. حوراء كريم',
  'ar-t':  'م. علي محسن',
};
const HEAD_TEACHER = 'ا.م.د. عمار وسام';
const SHEETS = { teachers: 'التدريسيون', roster: 'الطلبة', att: 'الحضور', log: 'السجل' };
const ID_RE = /^([a-z]+-[tp])_([AB])_w([1-9]|1[0-5])$/;

/* ---------------- الإعداد لأول مرة ---------------- */
function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const mk = (name, header) => {
    let sh = ss.getSheetByName(name);
    if (!sh) sh = ss.insertSheet(name);
    if (sh.getLastRow() === 0) { sh.appendRow(header); sh.setFrozenRows(1); sh.getRange(1, 1, 1, header.length).setFontWeight('bold'); }
    sh.setRightToLeft(true);
    return sh;
  };
  mk(SHEETS.teachers, ['رمز الدخول', 'التدريسي', 'الصفة', 'تاريخ الإضافة']);
  mk(SHEETS.roster,   ['التسلسل', 'اسم الطالب', 'الشعبة']);
  mk(SHEETS.att,      ['المعرّف', 'المادة', 'الشعبة', 'الأسبوع', 'التسجيل', 'آخر تعديل', 'بواسطة']);
  mk(SHEETS.log,      ['الوقت', 'التدريسي', 'العملية', 'التفاصيل']);
  const props = PropertiesService.getScriptProperties();
  let admin = props.getProperty('ADMIN_CODE');
  if (!admin) { admin = newCode_(); props.setProperty('ADMIN_CODE', admin); }
  Logger.log('رمز دخول المدير: ' + admin);
  return admin;
}

/** لتغيير رمز المدير: شغّل هذه الدالة من المحرر واقرأ الرمز الجديد في السجل. */
function resetAdminCode() {
  const c = newCode_();
  PropertiesService.getScriptProperties().setProperty('ADMIN_CODE', c);
  Logger.log('رمز دخول المدير الجديد: ' + c);
}

/* ---------------- نقطة الاتصال ---------------- */
function doGet() { return json_({ ok: true, service: 'attendance' }); }

function doPost(e) {
  let req;
  try { req = JSON.parse(e.postData.contents); } catch (err) { return json_({ ok: false, error: 'bad_request' }); }
  try {
    const who = auth_(req.code);
    if (!who) { Utilities.sleep(800); return json_({ ok: false, error: 'bad_code' }); }
    switch (req.action) {
      case 'login':       return json_({ ok: true, me: publicMe_(who) });
      case 'load':        return json_({ ok: true, me: publicMe_(who), roster: roster_(), att: loadAtt_(who) });
      case 'save':        return json_(saveAtt_(who, req.id, req.m));
      case 'teachers':    need_(who.admin); return json_({ ok: true, teachers: listTeachers_() });
      case 'addTeacher':  need_(who.admin); return json_(addTeacher_(req.name));
      case 'delTeacher':  need_(who.admin); return json_(delTeacher_(req.code2));
      case 'importRoster':need_(who.admin); return json_(importRoster_(req.students));
      default:            return json_({ ok: false, error: 'unknown_action' });
    }
  } catch (err) {
    if (err && err.message === 'forbidden') return json_({ ok: false, error: 'forbidden' });
    return json_({ ok: false, error: 'server', detail: String(err && err.message || err) });
  }
}

/* ---------------- الهوية والصلاحيات ---------------- */
function auth_(code) {
  code = String(code || '').trim();
  if (code.length < 8) return null;
  const admin = PropertiesService.getScriptProperties().getProperty('ADMIN_CODE');
  if (admin && code === admin) return { admin: true, all: true, teacher: null, subjects: Object.keys(SUBJECTS) };
  const rows = sheet_(SHEETS.teachers).getDataRange().getValues().slice(1);
  const r = rows.find(x => String(x[0]) === code);
  if (!r) return null;
  const name = String(r[1]);
  const subjects = Object.keys(SUBJECTS).filter(k => SUBJECTS[k] === name);
  return { admin: false, all: name === HEAD_TEACHER, teacher: name, subjects: subjects };
}
function publicMe_(w) { return { admin: w.admin, all: w.all, teacher: w.teacher, subjects: w.subjects }; }
function need_(ok) { if (!ok) throw new Error('forbidden'); }

/* ---------------- الحضور ---------------- */
function loadAtt_(who) {
  const rows = sheet_(SHEETS.att).getDataRange().getValues().slice(1);
  return rows.filter(r => r[0] && (who.all || who.subjects.indexOf(String(r[1])) >= 0))
             .map(r => ({ id: String(r[0]), m: safeParse_(r[4]) }));
}
function saveAtt_(who, id, m) {
  const mt = ID_RE.exec(String(id || ''));
  if (!mt) return { ok: false, error: 'bad_id' };
  const subj = mt[1], sec = mt[2], week = +mt[3];
  if (!SUBJECTS[subj]) return { ok: false, error: 'bad_id' };
  if (!who.admin && who.subjects.indexOf(subj) < 0) return { ok: false, error: 'forbidden' };
  const clean = {};
  Object.keys(m || {}).forEach(k => { const v = m[k]; if (/^\d{1,4}$/.test(k) && (v === 'P' || v === 'A' || v === 'E')) clean[k] = v; });
  const lock = LockService.getScriptLock(); lock.waitLock(15000);
  try {
    const sh = sheet_(SHEETS.att);
    const ids = sh.getRange(1, 1, Math.max(1, sh.getLastRow()), 1).getValues().map(r => String(r[0]));
    const idx = ids.indexOf(id);
    const row = [id, subj, sec, week, JSON.stringify(clean), new Date(), who.teacher || 'المدير'];
    if (idx >= 1) sh.getRange(idx + 1, 1, 1, row.length).setValues([row]);
    else sh.appendRow(row);
  } finally { lock.releaseLock(); }
  return { ok: true };
}

/* ---------------- إدارة التدريسيين والطلبة (للمدير) ---------------- */
function listTeachers_() {
  return sheet_(SHEETS.teachers).getDataRange().getValues().slice(1).filter(r => r[0])
    .map(r => ({ code: String(r[0]), name: String(r[1]), role: String(r[2]) }));
}
function addTeacher_(name) {
  const names = Object.keys(SUBJECTS).map(k => SUBJECTS[k]);
  if (names.indexOf(name) < 0) return { ok: false, error: 'bad_name' };
  const code = newCode_();
  sheet_(SHEETS.teachers).appendRow([code, name, name === HEAD_TEACHER ? 'رئيس القسم' : 'تدريسي', new Date()]);
  log_('المدير', 'إضافة تدريسي', name);
  return { ok: true, code: code };
}
function delTeacher_(code) {
  const sh = sheet_(SHEETS.teachers);
  const vals = sh.getDataRange().getValues();
  for (let i = vals.length - 1; i >= 1; i--) if (String(vals[i][0]) === String(code)) { log_('المدير', 'حذف رمز', String(vals[i][1])); sh.deleteRow(i + 1); }
  return { ok: true };
}
function roster_() {
  return sheet_(SHEETS.roster).getDataRange().getValues().slice(1).filter(r => r[0] !== '' && r[1])
    .map(r => [Number(r[0]), String(r[1]), String(r[2]).trim().toUpperCase()]);
}
function importRoster_(list) {
  if (!Array.isArray(list) || !list.length || list.length > 500) return { ok: false, error: 'bad_roster' };
  const rows = list.map(s => [Number(s[0]), String(s[1]).slice(0, 120), String(s[2]).toUpperCase() === 'B' ? 'B' : 'A']);
  const sh = sheet_(SHEETS.roster);
  if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, 3).clearContent();
  sh.getRange(2, 1, rows.length, 3).setValues(rows);
  log_('المدير', 'استيراد قائمة الطلبة', rows.length + ' طالباً');
  return { ok: true, count: rows.length };
}

/* ---------------- أدوات ---------------- */
function sheet_(name) {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if (!sh) throw new Error('شغّل الدالة setup أولاً');
  return sh;
}
function newCode_() {
  const a = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, Utilities.getUuid() + Date.now());
  for (let i = 0; i < 12; i++) s += a[(bytes[i] + 256) % a.length];
  return s.slice(0, 4) + '-' + s.slice(4, 8) + '-' + s.slice(8, 12);
}
function safeParse_(s) { try { return JSON.parse(s) || {}; } catch (e) { return {}; } }
function log_(who, what, detail) { try { sheet_(SHEETS.log).appendRow([new Date(), who, what, detail]); } catch (e) {} }
function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
