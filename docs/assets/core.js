/* Kew Beach LBC - tournament registration core logic.
 *
 * Pure functions only: no DOM, no Google services. The same file is used by
 *   - the web page (demo mode + client-side validation),
 *   - Apps Script (copied to apps-script/Core.gs by build.sh),
 *   - the Node tests (tests/core.test.js).
 * Edit ONLY docs/assets/core.js, then run ./build.sh.
 *
 * Time handling: every date/time is a plain local string (Toronto time):
 *   date      "YYYY-MM-DD"
 *   deadline  "YYYY-MM-DDTHH:mm"   (a date with no time, or 00:00, means 11:59 PM)
 *   now       "YYYY-MM-DDTHH:mm"
 * Strings of that shape compare correctly with < and >, so no time-zone maths.
 */
var KBCore = (function () {
  'use strict';

  var MODES = ['hidden', 'optional', 'required'];
  var DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
    'September', 'October', 'November', 'December'];
  var OTHER = 'Other';
  var DEFAULT_CLUBS = ['Kew Beach', 'Cosburn', 'Balmy Beach'];
  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  var PHONE_RE = /^[\d\s().+\-x]+$/i;

  /* ---------- small helpers ---------- */

  function str(v) { return v === null || v === undefined ? '' : String(v).trim(); }

  function oneLine(v, max) {
    return str(v).replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').slice(0, max);
  }

  function mode(v, dflt) {
    v = str(v).toLowerCase();
    return MODES.indexOf(v) >= 0 ? v : dflt;
  }

  function pad(n) { return (n < 10 ? '0' : '') + n; }

  /** "YYYY-MM-DDTHH:mm" for a JS Date, using the Date's own (local) clock. */
  function nowMinute(d) {
    d = d || new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
      'T' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  function parseYmd(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(str(s));
    if (!m) { return null; }
    return { y: +m[1], m: +m[2], d: +m[3] };
  }

  function fmtDate(ymd) {
    var p = parseYmd(ymd);
    if (!p) { return str(ymd); }
    var wd = new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay();
    return DAYS[wd] + ', ' + MONTHS[p.m - 1] + ' ' + p.d + ', ' + p.y;
  }

  function fmtTime(hhmm) {
    var m = /^(\d{1,2}):(\d{2})$/.exec(str(hhmm));
    if (!m) { return str(hhmm); }
    var h = +m[1];
    return ((h % 12) || 12) + ':' + m[2] + ' ' + (h < 12 ? 'AM' : 'PM');
  }

  function fmtDeadline(dl) {
    var m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})$/.exec(str(dl));
    return m ? fmtDate(m[1]) + ' at ' + fmtTime(m[2]) : '';
  }

  /** Accepts "YYYY-MM-DD" or "YYYY-MM-DD[T ]HH:mm"; returns canonical form or "". */
  function normalizeDeadline(v) {
    v = str(v);
    if (!v) { return ''; }
    if (/^\d{4}-\d{2}-\d{2}$/.test(v)) { return v + 'T23:59'; }
    var m = /^(\d{4}-\d{2}-\d{2})[T ](\d{1,2}):(\d{2})/.exec(v);
    if (!m) { return ''; }
    var hh = pad(+m[2]);
    if (hh === '00' && m[3] === '00') { return m[1] + 'T23:59'; }
    return m[1] + 'T' + hh + ':' + m[3];
  }

  /* ---------- tournaments ---------- */

  /** Turns a raw sheet row into a clean tournament object. */
  function normalizeTournament(raw) {
    var cap = parseInt(raw.cap, 10);
    var opts = str(raw.choice_options).split(',').map(str).filter(Boolean);
    var ov = str(raw.status_override).toLowerCase();
    return {
      id: str(raw.id),
      name: str(raw.name),
      type: str(raw.type).toLowerCase() === 'in-club' ? 'in-club' : 'open',
      date: parseYmd(raw.date) ? str(raw.date).slice(0, 10) : '',
      start_time: str(raw.start_time),
      format: str(raw.format),
      fee: str(raw.fee),
      sponsor: str(raw.sponsor),
      notes: str(raw.notes),
      cap: isNaN(cap) || cap <= 0 ? 0 : cap, // 0 = no limit
      deadline: normalizeDeadline(raw.deadline),
      override: (ov === 'open' || ov === 'closed') ? ov : 'auto',
      p2: mode(raw.p2, 'optional'),
      p3: mode(raw.p3, 'hidden'),
      home_club: mode(raw.home_club, 'hidden'),
      choice_label: str(raw.choice_label) || 'Your choice',
      choice_options: opts,
      choice_mode: opts.length ? mode(raw.choice_mode, 'hidden') : 'hidden'
    };
  }

  function counts(tournamentId, regs) {
    var c = 0, w = 0;
    regs.forEach(function (r) {
      if (r.tournament_id !== tournamentId) { return; }
      if (r.status === 'confirmed') { c++; } else if (r.status === 'waitlist') { w++; }
    });
    return { confirmed: c, waitlisted: w };
  }

  /**
   * open      - taking confirmed registrations
   * waitlist  - cap reached, new teams go on the waitlist
   * closed    - deadline passed or organizer closed it
   * Organizer override: "closed" always closes, "open" always reopens (even past the deadline).
   */
  function state(t, regs, now) {
    var n = counts(t.id, regs);
    var closed;
    if (t.override === 'closed') { closed = true; }
    else if (t.override === 'open') { closed = false; }
    else { closed = !!t.deadline && now > t.deadline; }
    var full = t.cap > 0 && n.confirmed >= t.cap;
    return {
      confirmed: n.confirmed,
      waitlisted: n.waitlisted,
      spotsLeft: t.cap > 0 ? Math.max(0, t.cap - n.confirmed) : null,
      closed: closed,
      full: full,
      status: closed ? 'closed' : (full ? 'waitlist' : 'open')
    };
  }

  /** Clean the organizer-maintained club list: trimmed, de-duplicated, never contains "Other". */
  function cleanClubs(list) {
    if (list === undefined || list === null) { return DEFAULT_CLUBS.slice(); }
    var seen = {}, out = [];
    list.forEach(function (c) {
      c = oneLine(c, 100);
      var k = c.toLowerCase();
      if (!c || k === OTHER.toLowerCase() || seen[k]) { return; }
      seen[k] = true; out.push(c);
    });
    return out;
  }

  /** What the public may see. Only captain names of confirmed teams - never phone/email/players. */
  function publicView(t, regs, now, clubs) {
    var s = state(t, regs, now);
    return {
      clubs: t.home_club === 'hidden' ? [] : cleanClubs(clubs),
      id: t.id, name: t.name, type: t.type, date: t.date, start_time: t.start_time,
      format: t.format, fee: t.fee, sponsor: t.sponsor, notes: t.notes, cap: t.cap,
      deadline: t.deadline, p2: t.p2, p3: t.p3, home_club: t.home_club,
      choice_label: t.choice_label, choice_options: t.choice_options, choice_mode: t.choice_mode,
      status: s.status, confirmed: s.confirmed, waitlisted: s.waitlisted, spotsLeft: s.spotsLeft,
      captains: regs.filter(function (r) { return r.tournament_id === t.id && r.status === 'confirmed'; })
        .map(function (r) { return r.captain_name; })
    };
  }

  /* ---------- registration ---------- */

  /** Same rules run in the browser (friendly errors) and on the server (the ones that count). */
  function validate(t, input, clubs) {
    var errors = {};
    clubs = cleanClubs(clubs);
    var c = {
      captain_name: oneLine(input.captain_name, 100),
      phone: oneLine(input.phone, 30),
      email: oneLine(input.email, 120),
      p2: '', p3: '', home_club: '', choice: ''
    };

    if (!c.captain_name) { errors.captain_name = 'Please enter the captain’s name.'; }

    if (!c.phone) { errors.phone = 'Please enter a phone number.'; }
    else if (!PHONE_RE.test(c.phone) || c.phone.replace(/\D/g, '').length < 10) {
      errors.phone = 'Please enter a phone number with area code, e.g. 416-555-0123.';
    }

    if (!c.email) { errors.email = 'Please enter an email address.'; }
    else if (!EMAIL_RE.test(c.email)) { errors.email = 'That email address doesn’t look right.'; }

    [['p2', 'second player’s name'], ['p3', 'third player’s name']].forEach(function (f) {
      var key = f[0];
      if (t[key] === 'hidden') { return; } // ignore anything sent for a hidden field
      c[key] = oneLine(input[key], 100);
      if (t[key] === 'required' && !c[key]) { errors[key] = 'Please enter the ' + f[1] + '.'; }
    });

    // Home club: pick from the shared club list, or "Other" plus a typed name.
    if (t.home_club !== 'hidden') {
      var picked = oneLine(input.home_club, 100);
      if (!picked) {
        if (t.home_club === 'required') { errors.home_club = 'Please choose your team’s home club.'; }
      } else if (picked.toLowerCase() === OTHER.toLowerCase()) {
        var typed = oneLine(input.home_club_other, 100);
        if (!typed) { errors.home_club_other = 'Please type the name of your club.'; }
        else { c.home_club = OTHER + ': ' + typed; }
      } else {
        var match = clubs.filter(function (n) { return n.toLowerCase() === picked.toLowerCase(); })[0];
        if (match) { c.home_club = match; }
        else { errors.home_club = 'Please choose a club from the list.'; }
      }
    }

    if (t.choice_mode !== 'hidden') {
      c.choice = oneLine(input.choice, 60);
      if (c.choice && t.choice_options.indexOf(c.choice) < 0) {
        errors.choice = 'Please pick one of the choices shown.';
      } else if (t.choice_mode === 'required' && !c.choice) {
        errors.choice = 'Please choose one.';
      }
    }

    return { ok: Object.keys(errors).length === 0, errors: errors, clean: c };
  }

  /** "confirmed", "waitlist", or null when registration is closed. */
  function decide(t, regs, now) {
    var s = state(t, regs, now);
    if (s.closed) { return null; }
    return s.full ? 'waitlist' : 'confirmed';
  }

  function makeRecord(t, clean, status, meta) {
    return {
      timestamp: meta.timestamp, reg_id: meta.regId, tournament_id: t.id, status: status,
      captain_name: clean.captain_name, phone: clean.phone, email: clean.email,
      p2: clean.p2, p3: clean.p3, home_club: clean.home_club, choice: clean.choice,
      cancel_token: meta.token, cancelled_at: ''
    };
  }

  /* ---------- emails (plain text) ---------- */

  function teamLines(t, r) {
    var L = ['Captain: ' + r.captain_name, 'Phone: ' + r.phone, 'Email: ' + r.email];
    if (r.p2) { L.push('Second player: ' + r.p2); }
    if (r.p3) { L.push('Third player: ' + r.p3); }
    if (r.home_club) { L.push('Home club: ' + r.home_club); }
    if (r.choice) { L.push(t.choice_label + ': ' + r.choice); }
    return L;
  }

  function eventLines(t) {
    var L = [t.name];
    if (t.date) { L.push(fmtDate(t.date) + (t.start_time ? ', ' + t.start_time : '')); }
    if (t.format) { L.push('Format: ' + t.format); }
    if (t.fee) { L.push('Entry fee: ' + t.fee + ' (cash, payable on the day)'); }
    return L;
  }

  /** ctx: {clubName, contactEmail, cancelUrl, sheetUrl} */
  function confirmationEmail(t, r, ctx) {
    var wait = r.status === 'waitlist';
    var body = [
      'Hello ' + r.captain_name + ',',
      '',
      wait
        ? 'The tournament is currently full, so your team has been placed on the WAITLIST. ' +
          'The organizers will contact you if a spot opens up.'
        : 'Your team is registered. Thank you!',
      ''
    ].concat(eventLines(t), [''], teamLines(t, r), ['']);
    if (ctx.cancelUrl) {
      body.push('Need to withdraw? Cancel your registration here:', ctx.cancelUrl, '');
    }
    body.push('Questions? Contact the tournament organizers' +
      (ctx.contactEmail ? ' at ' + ctx.contactEmail : '') + '.', '', '— ' + ctx.clubName);
    return {
      subject: (wait ? 'Waitlisted: ' : 'Registered: ') + t.name +
        (t.date ? ' – ' + fmtDate(t.date) : ''),
      body: body.join('\n')
    };
  }

  function organizerNotice(t, r, s, ctx) {
    var wait = r.status === 'waitlist';
    var body = ['New registration for ' + t.name + (t.date ? ' (' + fmtDate(t.date) + ')' : ''),
      'Status: ' + (wait ? 'WAITLIST' : 'Confirmed'), ''].concat(teamLines(t, r), [
      '',
      'Teams confirmed: ' + s.confirmed + (t.cap ? ' of ' + t.cap : '') +
        '   |   Waitlist: ' + s.waitlisted]);
    if (ctx.sheetUrl) { body.push('', 'Registrations sheet: ' + ctx.sheetUrl); }
    return {
      subject: '[' + ctx.clubName + '] ' + (wait ? 'Waitlist' : 'Registration') + ': ' +
        r.captain_name + ' – ' + t.name,
      body: body.join('\n')
    };
  }

  /** Returns {captain:{subject,body}, organizer:{subject,body}}. s = state after the cancel. */
  function cancellationEmails(t, r, wasStatus, s, ctx) {
    var captain = [
      'Hello ' + r.captain_name + ',', '',
      'Your registration for ' + t.name + (t.date ? ' on ' + fmtDate(t.date) : '') +
        ' has been cancelled.', '',
      'Changed your mind? You can register again any time while registration is open.', '',
      '— ' + ctx.clubName];
    var org = ['Registration CANCELLED for ' + t.name + (t.date ? ' (' + fmtDate(t.date) + ')' : ''),
      'Was: ' + wasStatus, ''].concat(teamLines(t, r), ['',
      'Teams confirmed: ' + s.confirmed + (t.cap ? ' of ' + t.cap : '') +
        '   |   Waitlist: ' + s.waitlisted]);
    if (wasStatus === 'confirmed' && s.waitlisted > 0 && (!t.cap || s.confirmed < t.cap)) {
      org.push('', 'A spot is now free and ' + s.waitlisted + ' team(s) are on the waitlist. ' +
        'To promote one, change its status from "waitlist" to "confirmed" in the sheet ' +
        '(earliest timestamp first).');
    }
    if (ctx.sheetUrl) { org.push('', 'Registrations sheet: ' + ctx.sheetUrl); }
    return {
      captain: { subject: 'Cancelled: ' + t.name, body: captain.join('\n') },
      organizer: {
        subject: '[' + ctx.clubName + '] Cancellation: ' + r.captain_name + ' – ' + t.name,
        body: org.join('\n')
      }
    };
  }

  /* ---------- sample data (two tournaments for the first demo) ---------- */

  var SAMPLE_TOURNAMENTS = [
    {
      id: 'aussie-pairs-2027-07-17', name: 'Aussie Pairs', type: 'open', date: '2027-07-17',
      start_time: '9:30 AM', format: 'Open pairs', fee: '$20 per player',
      sponsor: 'Barb Best Realty', cap: 16, deadline: '2027-07-10T23:59', status_override: 'auto',
      p2: 'optional', p3: 'hidden', home_club: 'optional',
      choice_label: '', choice_options: '', choice_mode: 'hidden',
      notes: 'Teams wear matching colours. Arrive by 9:15 AM; play starts promptly at 9:30 AM. ' +
        'No partner yet? Register with your own name and the organizers will help.'
    },
    {
      id: 'canada-vs-row-2027-08-14', name: 'Canada vs Rest of the World', type: 'in-club',
      date: '2027-08-14', start_time: '10:00 AM', format: 'Pairs, 3 x 10 end games',
      fee: '$5 per player', sponsor: '', cap: 20, deadline: '2027-08-07T23:59',
      status_override: 'auto', p2: 'optional', p3: 'hidden', home_club: 'hidden',
      choice_label: 'Which side are you playing for?', choice_options: 'Canada,ROW',
      choice_mode: 'required',
      notes: 'In-club event for members. Pick the side your team is playing for.'
    }
  ];

  return {
    MODES: MODES,
    OTHER: OTHER,
    DEFAULT_CLUBS: DEFAULT_CLUBS,
    cleanClubs: cleanClubs,
    SAMPLE_TOURNAMENTS: SAMPLE_TOURNAMENTS,
    nowMinute: nowMinute,
    normalizeDeadline: normalizeDeadline,
    normalizeTournament: normalizeTournament,
    state: state,
    publicView: publicView,
    validate: validate,
    decide: decide,
    makeRecord: makeRecord,
    confirmationEmail: confirmationEmail,
    organizerNotice: organizerNotice,
    cancellationEmails: cancellationEmails,
    fmtDate: fmtDate,
    fmtTime: fmtTime,
    fmtDeadline: fmtDeadline
  };
})();

if (typeof module !== 'undefined' && module.exports) { module.exports = KBCore; }
if (typeof window !== 'undefined') { window.KBCore = KBCore; }
