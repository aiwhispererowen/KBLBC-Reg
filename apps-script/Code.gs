/**
 * Kew Beach LBC - tournament registration backend (Google Apps Script).
 *
 * Lives in the Google Sheet that holds the tournaments and registrations
 * (Extensions > Apps Script). Core.gs holds the shared rules (copied from
 * docs/assets/core.js by build.sh); this file only talks to Sheets, Mail and the web.
 *
 * Tabs: Tournaments (organizers edit), Registrations (the script writes), Clubs (the shared
 * Home Club list), Config.
 */

var SHEET_T = 'Tournaments';
var SHEET_R = 'Registrations';
var SHEET_C = 'Config';
var SHEET_CLUBS = 'Clubs'; // one shared list of clubs for every tournament's Home Club dropdown

// Organizer-editable columns, then formula columns the script never reads.
var T_HEADERS = ['id', 'name', 'type', 'date', 'start_time', 'format', 'fee', 'sponsor', 'cap',
  'deadline', 'status_override', 'p2', 'p3', 'home_club', 'choice_label', 'choice_options',
  'choice_mode', 'notes'];
var T_FORMULA_HEADERS = ['confirmed', 'waitlist', 'spots_left', 'registration_link'];
// Registrations: status is column D and tournament_id column C (used by the formulas above).
var R_HEADERS = ['timestamp', 'reg_id', 'tournament_id', 'status', 'captain_name', 'phone', 'email',
  'p2', 'p3', 'home_club', 'choice', 'cancel_token', 'cancelled_at'];

var CONFIG_DEFAULTS = [
  ['organizer_emails', 'owen@owenstokes.com', 'Comma-separated. Get a notice for every registration/cancellation.'],
  ['contact_email', 'owen@owenstokes.com', 'Shown to players in emails ("questions? contact...").'],
  ['club_name', 'Kew Beach Lawn Bowling Club', ''],
  ['site_base_url', 'https://YOUR-USER.github.io/kewbeach-reg/', 'Where the registration page lives. Must end with /']
];

/* ---------------------------------------------------------------- web app */

function doGet(e) {
  try {
    var p = (e && e.parameter) || {};
    var action = p.action || 'tournaments';
    var now = nowMinute_();

    if (action === 'tournaments') {
      var regs = readRegs_();
      var clubs = readClubs_();
      var today = now.slice(0, 10);
      var list = readTournaments_()
        .filter(function (t) { return !t.date || t.date >= today; })
        .sort(function (a, b) { return a.date < b.date ? -1 : (a.date > b.date ? 1 : 0); })
        .map(function (t) { return KBCore.publicView(t, regs, now, clubs); });
      return json_({ ok: true, tournaments: list });
    }

    if (action === 'tournament') {
      var t = findTournament_(p.id);
      if (!t) { return json_({ ok: false, error: 'Tournament not found.' }); }
      return json_({ ok: true, tournament: KBCore.publicView(t, readRegs_(), now, readClubs_()) });
    }

    if (action === 'reg') { // lookup for the cancel page: only the holder of the private token sees it
      var found = findRegByToken_(p.token);
      if (!found) { return json_({ ok: false, error: 'Registration not found.' }); }
      var tt = findTournament_(found.reg.tournament_id);
      return json_({
        ok: true,
        registration: {
          status: found.reg.status, captain_name: found.reg.captain_name,
          p2: found.reg.p2, p3: found.reg.p3
        },
        tournament: tt ? KBCore.publicView(tt, readRegs_(), now, readClubs_()) : null
      });
    }

    return json_({ ok: false, error: 'Unknown request.' });
  } catch (err) {
    console.error(err && err.stack || err);
    return json_({ ok: false, error: 'Something went wrong. Please try again.' });
  }
}

function doPost(e) {
  try {
    var body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (body.action === 'register') { return json_(register_(body)); }
    if (body.action === 'cancel') { return json_(cancel_(body.token)); }
    return json_({ ok: false, error: 'Unknown request.' });
  } catch (err) {
    console.error(err && err.stack || err);
    return json_({ ok: false, error: 'Something went wrong. Please try again.' });
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/* ------------------------------------------------------------ registering */

function register_(payload) {
  if (payload.website) { return { ok: true, status: 'confirmed' }; } // honeypot: bots fill hidden fields

  var lock = LockService.getScriptLock();
  lock.waitLock(20000); // two captains submitting at once must not both take the last spot
  var rec, t, state, cfg = getConfig_();
  try {
    t = findTournament_(payload.tournament_id);
    if (!t) { return { ok: false, error: 'Tournament not found.' }; }

    var v = KBCore.validate(t, payload, readClubs_());
    if (!v.ok) { return { ok: false, errors: v.errors }; }

    var regs = readRegs_();
    var now = nowMinute_();
    var status = KBCore.decide(t, regs, now);
    if (!status) {
      return { ok: false, closed: true, error: 'Registration for this tournament is closed.' };
    }

    rec = KBCore.makeRecord(t, v.clean, status, {
      timestamp: Utilities.formatDate(new Date(), tz_(), 'yyyy-MM-dd HH:mm:ss'),
      regId: Utilities.getUuid().slice(0, 8),
      token: Utilities.getUuid().replace(/-/g, '')
    });
    appendReg_(rec);
    SpreadsheetApp.flush();
    state = KBCore.state(t, regs.concat([rec]), now);
  } finally {
    lock.releaseLock();
  }

  // Emails go out after the lock is released. A mail failure must not lose the registration.
  var ctx = emailContext_(cfg, rec.cancel_token);
  var mailOk = true;
  try {
    var c = KBCore.confirmationEmail(t, rec, ctx);
    send_(rec.email, c.subject, c.body, cfg);
    var o = KBCore.organizerNotice(t, rec, state, ctx);
    send_(cfg.organizer_emails, o.subject, o.body, cfg);
  } catch (err) {
    mailOk = false;
    console.error('Mail failed: ' + (err && err.message));
  }

  return { ok: true, status: rec.status, token: rec.cancel_token, emailSent: mailOk };
}

function cancel_(token) {
  var cfg = getConfig_();
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  var found, t, state, wasStatus;
  try {
    found = findRegByToken_(token);
    if (!found) { return { ok: false, error: 'Registration not found.' }; }
    if (found.reg.status === 'cancelled') { return { ok: true, alreadyCancelled: true }; }
    t = findTournament_(found.reg.tournament_id);
    wasStatus = found.reg.status;

    var sh = SpreadsheetApp.getActive().getSheetByName(SHEET_R);
    var col = R_HEADERS.indexOf('status') + 1;
    sh.getRange(found.row, col).setValue('cancelled');
    sh.getRange(found.row, R_HEADERS.indexOf('cancelled_at') + 1)
      .setValue(Utilities.formatDate(new Date(), tz_(), 'yyyy-MM-dd HH:mm:ss'));
    SpreadsheetApp.flush();
    if (t) { state = KBCore.state(t, readRegs_(), nowMinute_()); }
  } finally {
    lock.releaseLock();
  }

  if (t) {
    try {
      var ctx = emailContext_(cfg, '');
      var m = KBCore.cancellationEmails(t, found.reg, wasStatus, state, ctx);
      send_(found.reg.email, m.captain.subject, m.captain.body, cfg);
      send_(cfg.organizer_emails, m.organizer.subject, m.organizer.body, cfg);
    } catch (err) {
      console.error('Mail failed: ' + (err && err.message));
    }
  }
  return { ok: true };
}

function emailContext_(cfg, token) {
  return {
    clubName: cfg.club_name,
    contactEmail: cfg.contact_email,
    cancelUrl: token ? cfg.site_base_url + 'register.html?cancel=' + token : '',
    sheetUrl: SpreadsheetApp.getActive().getUrl()
  };
}

function send_(to, subject, body, cfg) {
  if (!to) { return; }
  MailApp.sendEmail({
    to: to, subject: subject, body: body,
    name: cfg.club_name, replyTo: cfg.contact_email || ''
  });
}

/* ----------------------------------------------------------- sheet access */

function tz_() { return SpreadsheetApp.getActive().getSpreadsheetTimeZone() || 'America/Toronto'; }

function nowMinute_() { return Utilities.formatDate(new Date(), tz_(), "yyyy-MM-dd'T'HH:mm"); }

function getConfig_() {
  var cfg = {};
  CONFIG_DEFAULTS.forEach(function (r) { cfg[r[0]] = r[1]; });
  var sh = SpreadsheetApp.getActive().getSheetByName(SHEET_C);
  if (sh && sh.getLastRow() > 1) {
    sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues().forEach(function (r) {
      if (r[0]) { cfg[String(r[0]).trim()] = String(r[1]).trim(); }
    });
  }
  if (cfg.site_base_url && cfg.site_base_url.slice(-1) !== '/') { cfg.site_base_url += '/'; }
  return cfg;
}

/** Reads a tab into objects keyed by the header row; Dates become the plain strings the core expects. */
function readTable_(name) {
  var sh = SpreadsheetApp.getActive().getSheetByName(name);
  if (!sh || sh.getLastRow() < 2) { return []; }
  var values = sh.getDataRange().getValues();
  var head = values[0].map(function (h) { return String(h).trim(); });
  var out = [];
  for (var i = 1; i < values.length; i++) {
    var o = { _row: i + 1 };
    for (var j = 0; j < head.length; j++) {
      var v = values[i][j];
      if (v instanceof Date) { v = dateCell_(head[j], v); }
      o[head[j]] = v;
    }
    out.push(o);
  }
  return out;
}

function dateCell_(header, d) {
  var z = tz_();
  if (header === 'date') { return Utilities.formatDate(d, z, 'yyyy-MM-dd'); }
  if (header === 'deadline') { return Utilities.formatDate(d, z, "yyyy-MM-dd'T'HH:mm"); }
  if (header === 'start_time') { return Utilities.formatDate(d, z, 'h:mm a'); }
  return Utilities.formatDate(d, z, 'yyyy-MM-dd HH:mm:ss');
}

function readTournaments_() {
  return readTable_(SHEET_T)
    .filter(function (r) { return String(r.id || '').trim() && String(r.name || '').trim(); })
    .map(KBCore.normalizeTournament);
}

/** The shared club list: column A of the Clubs tab (header in row 1). "Other" is added by the page. */
function readClubs_() {
  var sh = SpreadsheetApp.getActive().getSheetByName(SHEET_CLUBS);
  if (!sh) { return KBCore.DEFAULT_CLUBS.slice(); }
  if (sh.getLastRow() < 2) { return []; }
  var vals = sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues().map(function (r) { return r[0]; });
  return KBCore.cleanClubs(vals);
}

function findTournament_(id) {
  id = String(id || '').trim();
  if (!id) { return null; }
  var all = readTournaments_();
  for (var i = 0; i < all.length; i++) { if (all[i].id === id) { return all[i]; } }
  return null;
}

function readRegs_() {
  return readTable_(SHEET_R).map(function (r) {
    return {
      _row: r._row, timestamp: String(r.timestamp), reg_id: String(r.reg_id),
      tournament_id: String(r.tournament_id).trim(), status: String(r.status).trim().toLowerCase(),
      captain_name: String(r.captain_name), phone: String(r.phone), email: String(r.email),
      p2: String(r.p2), p3: String(r.p3), home_club: String(r.home_club), choice: String(r.choice),
      cancel_token: String(r.cancel_token)
    };
  });
}

function findRegByToken_(token) {
  token = String(token || '').trim();
  if (token.length < 20) { return null; }
  var regs = readRegs_();
  for (var i = 0; i < regs.length; i++) {
    if (regs[i].cancel_token === token) { return { reg: regs[i], row: regs[i]._row }; }
  }
  return null;
}

function appendReg_(rec) {
  var sh = SpreadsheetApp.getActive().getSheetByName(SHEET_R);
  var row = sh.getLastRow() + 1;
  var vals = [R_HEADERS.map(function (h) { return rec[h] === undefined ? '' : String(rec[h]); })];
  // Plain-text format first, so a name like "=HYPERLINK(...)" is stored as text, never as a formula.
  sh.getRange(row, 1, 1, R_HEADERS.length).setNumberFormat('@').setValues(vals);
}

/* ------------------------------------------------------------------ setup */

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Tournament tools')
    .addItem('1. Set up / repair tabs', 'setup')
    .addItem('2. Add the two sample tournaments', 'addSamples')
    .addItem('3. Send myself a test email', 'sendTestEmail')
    .addToUi();
}

function setup() {
  var ss = SpreadsheetApp.getActive();
  ss.setSpreadsheetTimeZone('America/Toronto');

  var t = ss.getSheetByName(SHEET_T) || ss.insertSheet(SHEET_T);
  var allT = T_HEADERS.concat(T_FORMULA_HEADERS);
  t.getRange(1, 1, 1, allT.length).setValues([allT]).setFontWeight('bold').setBackground('#e6efe9');
  t.setFrozenRows(1);
  t.getRange(1, T_HEADERS.length + 1, 1, T_FORMULA_HEADERS.length).setBackground('#dddddd');
  var rows = 200;
  col_(t, 'type').setDataValidation(list_(['open', 'in-club']));
  col_(t, 'status_override').setDataValidation(list_(['auto', 'open', 'closed']));
  ['p2', 'p3', 'home_club', 'choice_mode'].forEach(function (h) {
    col_(t, h).setDataValidation(list_(['hidden', 'optional', 'required']));
  });
  t.getRange(2, T_HEADERS.indexOf('date') + 1, rows, 1).setNumberFormat('yyyy-mm-dd');
  t.getRange(2, T_HEADERS.indexOf('deadline') + 1, rows, 1).setNumberFormat('yyyy-mm-dd hh:mm');
  t.getRange(2, T_HEADERS.indexOf('id') + 1, rows, 1).setNumberFormat('@');
  // Formula columns (grey): live counts and the link to paste into the calendar / tournament page.
  var f = T_HEADERS.length;
  var fRows = [];
  for (var r = 2; r <= rows + 1; r++) {
    fRows.push([
      '=IF($A' + r + '="","",COUNTIFS(Registrations!$C:$C,$A' + r + ',Registrations!$D:$D,"confirmed"))',
      '=IF($A' + r + '="","",COUNTIFS(Registrations!$C:$C,$A' + r + ',Registrations!$D:$D,"waitlist"))',
      '=IF($A' + r + '="","",IF($I' + r + '="","no limit",MAX(0,$I' + r + '-' + col2a_(f + 1) + r + ')))',
      '=IF($A' + r + '="","",INDEX(Config!$B:$B,MATCH("site_base_url",Config!$A:$A,0))&"register.html?t="&$A' + r + ')'
    ]);
  }
  t.getRange(2, f + 1, rows, 4).setFormulas(fRows).setBackground('#f3f3f3');
  t.setColumnWidth(1, 220);
  t.setColumnWidth(f + 4, 420);

  var reg = ss.getSheetByName(SHEET_R) || ss.insertSheet(SHEET_R);
  reg.getRange(1, 1, 1, R_HEADERS.length).setValues([R_HEADERS]).setFontWeight('bold').setBackground('#e6efe9');
  reg.setFrozenRows(1);
  reg.getRange(2, R_HEADERS.indexOf('status') + 1, 1000, 1)
    .setDataValidation(list_(['confirmed', 'waitlist', 'cancelled']));

  var cl = ss.getSheetByName(SHEET_CLUBS) || ss.insertSheet(SHEET_CLUBS);
  if (cl.getLastRow() < 1) {
    cl.getRange(1, 1, 1, 2).setValues([['club', 'notes']]).setFontWeight('bold').setBackground('#e6efe9');
    cl.getRange(2, 1, KBCore.DEFAULT_CLUBS.length, 1).setValues(KBCore.DEFAULT_CLUBS.map(function (n) { return [n]; }));
    cl.getRange(1, 2).setNote('One club per row in column A. The page adds "Other" (free text) by itself, so do not list it.');
    cl.setColumnWidth(1, 240);
    cl.setFrozenRows(1);
  }

  var c = ss.getSheetByName(SHEET_C) || ss.insertSheet(SHEET_C);
  if (c.getLastRow() < 2) {
    c.getRange(1, 1, 1, 3).setValues([['key', 'value', 'what it does']]).setFontWeight('bold');
    c.getRange(2, 1, CONFIG_DEFAULTS.length, 3).setValues(CONFIG_DEFAULTS);
    c.setColumnWidth(1, 160); c.setColumnWidth(2, 380); c.setColumnWidth(3, 480);
  }

  var blank = ss.getSheetByName('Sheet1');
  if (blank && ss.getSheets().length > 1 && blank.getLastRow() === 0) { ss.deleteSheet(blank); }
  SpreadsheetApp.getUi().alert('Tabs are ready (including the shared Clubs list). Next: Config > set site_base_url and organizer_emails, ' +
    'then use "Add the two sample tournaments" if you want demo data.');
}

function addSamples() {
  var sh = SpreadsheetApp.getActive().getSheetByName(SHEET_T);
  if (!sh) { SpreadsheetApp.getUi().alert('Run "Set up / repair tabs" first.'); return; }
  var existing = readTournaments_().map(function (t) { return t.id; });
  KBCore.SAMPLE_TOURNAMENTS.forEach(function (s) {
    if (existing.indexOf(s.id) >= 0) { return; }
    var row = 2;
    while (String(sh.getRange(row, 1).getValue()).trim()) { row++; }
    var vals = T_HEADERS.map(function (h) {
      if (h === 'date') { return new Date(s.date + 'T12:00:00'); }
      if (h === 'deadline') { return new Date(KBCore.normalizeDeadline(s.deadline) + ':00'); }
      return s[h] === undefined ? '' : s[h];
    });
    sh.getRange(row, 1, 1, T_HEADERS.length).setValues([vals]);
  });
}

function sendTestEmail() {
  var cfg = getConfig_();
  var me = Session.getActiveUser().getEmail() || cfg.organizer_emails;
  send_(me, 'Test email from the tournament registration sheet',
    'If you can read this, confirmation emails will work.\n\nOrganizer address(es): ' +
    cfg.organizer_emails, cfg);
  SpreadsheetApp.getUi().alert('Sent a test email to ' + me + '.');
}

function col_(sh, header) {
  return sh.getRange(2, T_HEADERS.indexOf(header) + 1, 200, 1);
}

function list_(items) {
  return SpreadsheetApp.newDataValidation().requireValueInList(items, true).setAllowInvalid(false).build();
}

function col2a_(n) { // 1 -> A
  var s = '';
  while (n > 0) { var m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
}
