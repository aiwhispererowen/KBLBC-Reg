/* Registration page: list of tournaments, one tournament's form, and the cancel page.
   Talks to the Apps Script backend, or to a built-in demo backend when API_URL is empty. */
(function () {
  'use strict';

  var CFG = window.KB_CONFIG;
  var Core = window.KBCore;
  var app = document.getElementById('app');
  var DEMO = !CFG.API_URL;

  /* ------------------------------------------------------------ tiny DOM helper */

  function h(tag, attrs) {
    var e = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      var v = attrs[k];
      if (v === false || v === null || v === undefined) { return; }
      if (k === 'class') { e.className = v; }
      else if (k === 'text') { e.textContent = v; }
      else if (k.slice(0, 2) === 'on') { e.addEventListener(k.slice(2), v); }
      else if (v === true) { e.setAttribute(k, ''); }
      else { e.setAttribute(k, v); }
    });
    for (var i = 2; i < arguments.length; i++) {
      append(e, arguments[i]);
    }
    return e;
  }

  function append(parent, kid) {
    if (kid === null || kid === undefined || kid === false) { return; }
    if (Array.isArray(kid)) { kid.forEach(function (k) { append(parent, k); }); return; }
    parent.appendChild(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }

  function show() {
    app.textContent = '';
    for (var i = 0; i < arguments.length; i++) { append(app, arguments[i]); }
    app.focus();
    window.scrollTo(0, 0);
  }

  /* ------------------------------------------------------------ real backend */

  var Real = {
    get: function (params) {
      return fetch(CFG.API_URL + '?' + new URLSearchParams(params)).then(function (r) { return r.json(); });
    },
    post: function (body) {
      // text/plain keeps this a "simple" request, so the browser does not need a CORS preflight.
      return fetch(CFG.API_URL, {
        method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body)
      }).then(function (r) { return r.json(); });
    },
    list: function () { return Real.get({ action: 'tournaments' }); },
    tournament: function (id) { return Real.get({ action: 'tournament', id: id }); },
    lookup: function (token) { return Real.get({ action: 'reg', token: token }); },
    register: function (p) { return Real.post(Object.assign({ action: 'register' }, p)); },
    cancel: function (token) { return Real.post({ action: 'cancel', token: token }); }
  };

  /* ------------------------------------------------------------ demo backend (browser only) */

  var Demo = (function () {
    var KEY = 'kb-demo-v1';
    var base = Core.SAMPLE_TOURNAMENTS.map(Core.normalizeTournament);
    var clubs = Core.DEFAULT_CLUBS.slice(); // in real mode this is the Clubs tab of the Sheet

    function load() {
      try { return JSON.parse(localStorage.getItem(KEY)) || fresh(); } catch (e) { return fresh(); }
    }
    function fresh() { return { regs: [], mails: [], ov: {} }; }
    function save(s) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) { /* private mode */ } }
    function tournaments(s) {
      return base.map(function (t) { return Object.assign({}, t, { override: s.ov[t.id] || t.override }); });
    }
    function find(s, id) {
      return tournaments(s).filter(function (t) { return t.id === id; })[0] || null;
    }
    function rand() { return Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 12); }
    function ctx(token) {
      return {
        clubName: CFG.CLUB_NAME, contactEmail: 'owen@owenstokes.com',
        cancelUrl: token ? new URL('register.html?cancel=' + token, location.href).href : ''
      };
    }
    function mail(s, to, m) { s.mails.push({ to: to, subject: m.subject, body: m.body }); }
    function ok(v) { return Promise.resolve(v); }

    return {
      list: function () {
        var s = load(), now = Core.nowMinute();
        return ok({ ok: true, tournaments: tournaments(s).map(function (t) { return Core.publicView(t, s.regs, now, clubs); }) });
      },
      tournament: function (id) {
        var s = load(), t = find(s, id);
        return ok(t ? { ok: true, tournament: Core.publicView(t, s.regs, Core.nowMinute(), clubs) }
          : { ok: false, error: 'Tournament not found.' });
      },
      lookup: function (token) {
        var s = load();
        var r = s.regs.filter(function (x) { return x.cancel_token === token; })[0];
        if (!r) { return ok({ ok: false, error: 'Registration not found.' }); }
        var t = find(s, r.tournament_id);
        return ok({ ok: true, registration: { status: r.status, captain_name: r.captain_name, p2: r.p2, p3: r.p3 },
          tournament: t ? Core.publicView(t, s.regs, Core.nowMinute(), clubs) : null });
      },
      register: function (p) {
        if (p.website) { return ok({ ok: true, status: 'confirmed' }); }
        var s = load(), t = find(s, p.tournament_id);
        if (!t) { return ok({ ok: false, error: 'Tournament not found.' }); }
        var v = Core.validate(t, p, clubs);
        if (!v.ok) { return ok({ ok: false, errors: v.errors }); }
        var now = Core.nowMinute();
        var status = Core.decide(t, s.regs, now);
        if (!status) { return ok({ ok: false, closed: true, error: 'Registration for this tournament is closed.' }); }
        var rec = Core.makeRecord(t, v.clean, status, { timestamp: new Date().toISOString(), regId: rand().slice(0, 8), token: rand() });
        s.regs.push(rec);
        var st = Core.state(t, s.regs, now);
        var c = Core.confirmationEmail(t, rec, ctx(rec.cancel_token));
        mail(s, rec.email, c);
        mail(s, 'organizers (owen@owenstokes.com in staging)', Core.organizerNotice(t, rec, st, ctx('')));
        save(s);
        return ok({ ok: true, status: status, token: rec.cancel_token, emailSent: true });
      },
      cancel: function (token) {
        var s = load();
        var r = s.regs.filter(function (x) { return x.cancel_token === token; })[0];
        if (!r) { return ok({ ok: false, error: 'Registration not found.' }); }
        if (r.status === 'cancelled') { return ok({ ok: true, alreadyCancelled: true }); }
        var was = r.status; r.status = 'cancelled';
        var t = find(s, r.tournament_id);
        if (t) {
          var m = Core.cancellationEmails(t, r, was, Core.state(t, s.regs, Core.nowMinute()), ctx(''));
          mail(s, r.email, m.captain);
          mail(s, 'organizers (owen@owenstokes.com in staging)', m.organizer);
        }
        save(s);
        return ok({ ok: true });
      },
      /* demo controls */
      fill: function (id) {
        var s = load(), t = find(s, id);
        if (!t) { return; }
        var names = ['Alex Morgan', 'Sam Patel', 'Jo Tremblay', 'Chris Nguyen', 'Dana Wright', 'Robin Lee',
          'Taylor Brown', 'Jamie Chen', 'Casey Singh', 'Morgan Dubois', 'Riley Fraser', 'Quinn Murphy',
          'Avery Kim', 'Drew Campbell', 'Jordan Ali', 'Blair Scott', 'Reese Martin', 'Skyler Ross',
          'Cameron Hall', 'Harper Young', 'Peyton Reid', 'Logan Boyd'];
        var have = s.regs.filter(function (r) { return r.tournament_id === id && r.status === 'confirmed'; }).length;
        for (var i = have; i < (t.cap || 12); i++) {
          s.regs.push({ timestamp: new Date().toISOString(), reg_id: 'demo' + i, tournament_id: id, status: 'confirmed',
            captain_name: names[i % names.length], phone: '', email: '', p2: '', p3: '', home_club: '', choice: '',
            cancel_token: 'demo-' + id + '-' + i, cancelled_at: '' });
        }
        save(s);
      },
      toggleClosed: function (id) {
        var s = load();
        s.ov[id] = s.ov[id] === 'closed' ? 'auto' : 'closed';
        save(s);
      },
      isClosed: function (id) { return load().ov[id] === 'closed'; },
      reset: function () { save(fresh()); },
      mails: function () { return load().mails; }
    };
  })();

  var api = DEMO ? Demo : Real;

  /* ------------------------------------------------------------ shared bits */

  function backLink() {
    return h('a', { class: 'back', href: 'register.html', text: '← All tournaments' });
  }

  function statusPill(t) {
    var text = t.status === 'open' ? 'Open for registration'
      : t.status === 'waitlist' ? 'Full – waitlist open' : 'Registration closed';
    return h('span', { class: 'pill ' + t.status, text: text });
  }

  function spotsText(t) {
    if (t.status === 'closed') { return ''; }
    if (!t.cap) { return t.confirmed + ' team' + (t.confirmed === 1 ? '' : 's') + ' registered'; }
    if (t.status === 'waitlist') {
      return 'All ' + t.cap + ' spots are taken' +
        (t.waitlisted ? ' – ' + t.waitlisted + ' team' + (t.waitlisted === 1 ? '' : 's') + ' on the waitlist' : '');
    }
    return t.spotsLeft + ' of ' + t.cap + ' team spots left';
  }

  function whenText(t) {
    return [t.date ? Core.fmtDate(t.date) : 'Date to be confirmed', t.start_time].filter(Boolean).join(', ');
  }

  function errorView(msg) {
    show(backLink(), h('h1', { text: 'Something went wrong' }),
      h('div', { class: 'banner error', role: 'alert', text: msg }),
      h('p', {}, 'You can try again, or contact the tournament organizers at ',
        h('a', { href: 'mailto:' + CFG.CLUB_EMAIL, text: CFG.CLUB_EMAIL }), '.'));
  }

  var NET_MSG = 'We couldn’t reach the registration system. Please check your connection and try again.';

  /* ------------------------------------------------------------ views */

  function renderList() {
    show(h('h1', { text: 'Tournament registration' }), h('p', { class: 'lede', text: 'Loading…' }));
    api.list().then(function (res) {
      if (!res.ok) { return errorView(res.error || NET_MSG); }
      var items = res.tournaments;
      show(
        h('h1', { text: 'Tournament registration' }),
        h('p', { class: 'lede', text: 'Team captains and skips: choose a tournament to register your team. Entry fees are paid in cash at the club on the day.' }),
        items.length ? h('div', { class: 'card' },
          h('ul', { class: 't-list' }, items.map(function (t) {
            return h('li', { class: 't-item' },
              h('div', {},
                h('h3', {}, h('a', { href: '?t=' + encodeURIComponent(t.id), text: t.name })),
                h('div', { class: 'meta', text: whenText(t) }),
                h('div', { class: 'meta', text: [t.format, t.fee].filter(Boolean).join(' · ') }),
                h('div', {}, statusPill(t), ' ', h('span', { class: 'fine', text: spotsText(t) }))),
              t.status === 'closed' ? null
                : h('a', { class: 'btn', href: '?t=' + encodeURIComponent(t.id), 'aria-label': 'Register for ' + t.name,
                  text: t.status === 'waitlist' ? 'Join waitlist' : 'Register' }));
          }))) : h('div', { class: 'card', text: 'No tournaments are open for registration right now. Please check back soon.' }),
        demoPanel(null));
    }, function () { errorView(NET_MSG); });
  }

  function renderTournament(id) {
    show(h('p', { class: 'lede', text: 'Loading…' }));
    api.tournament(id).then(function (res) {
      if (!res.ok) {
        return show(backLink(), h('h1', { text: 'Tournament not found' }),
          h('p', { text: 'That link doesn’t match a tournament. It may have been removed or the link may be mistyped.' }),
          h('a', { class: 'btn secondary', href: 'register.html', text: 'See all tournaments' }));
      }
      drawTournament(res.tournament);
    }, function () { errorView(NET_MSG); });
  }

  function drawTournament(t, successBox) {
    document.title = 'Register: ' + t.name + ' – ' + CFG.CLUB_NAME;
    var closedByDeadline = t.status === 'closed';

    show(
      backLink(),
      h('h1', { text: t.name }),
      h('p', { class: 'meta' }, statusPill(t), ' ', h('span', { class: 'fine', text: spotsText(t) })),
      successBox,
      h('div', { class: 'card' },
        h('p', { class: 'meta' }, h('strong', { text: whenText(t) })),
        t.format ? h('p', { class: 'meta', text: 'Format: ' + t.format }) : null,
        t.fee ? h('p', { class: 'meta', text: 'Entry fee: ' + t.fee + ' – cash, paid at the club on the day' }) : null,
        t.sponsor ? h('p', { class: 'meta', text: 'Sponsor: ' + t.sponsor }) : null,
        t.notes ? h('p', { text: t.notes }) : null,
        t.deadline ? h('p', { class: 'meta' }, h('strong', { text: closedByDeadline ? 'Registration closed.' : 'Registration closes: ' }),
          closedByDeadline ? '' : Core.fmtDeadline(t.deadline)) : null),
      successBox ? null : (closedByDeadline ? closedCard() : formCard(t)),
      rosterCard(t),
      demoPanel(t.id));
  }

  function closedCard() {
    return h('div', { class: 'card' },
      h('h2', { text: 'Registration is closed' }),
      h('p', {}, 'If you still want to enter, please contact the tournament organizers at ',
        h('a', { href: 'mailto:' + CFG.CLUB_EMAIL, text: CFG.CLUB_EMAIL }), ' or ' + CFG.CLUB_PHONE + '.'));
  }

  function rosterCard(t) {
    if (!t.captains.length && !t.waitlisted) { return null; }
    return h('div', { class: 'card' },
      h('h2', { text: 'Teams registered (' + t.confirmed + ')' }),
      h('p', { class: 'fine', text: 'Shown by team captain.' }),
      t.captains.length ? h('ol', { class: 'roster' }, t.captains.map(function (n) { return h('li', { text: n }); })) : null,
      t.waitlisted ? h('p', { class: 'meta', text: 'Waitlist: ' + t.waitlisted + ' team' + (t.waitlisted === 1 ? '' : 's') }) : null);
  }

  /* ------- the form */

  function field(id, label, mode, attrs, errors) {
    var tag = mode === 'required' ? 'required' : mode === 'optional' ? 'optional' : '';
    return h('div', { class: 'field' },
      h('label', { for: id }, label, ' ', tag ? h('span', { class: 'req', text: '(' + tag + ')' }) : null),
      h('input', Object.assign({ id: id, name: id, type: 'text', maxlength: 100,
        'aria-describedby': id + '-err', required: mode === 'required' ? true : false }, attrs)),
      h('div', { class: 'err', id: id + '-err', role: 'alert' }));
  }

  /** Home club: dropdown from the shared club list, plus "Other" which reveals a free-text box. */
  function clubField(t) {
    var tag = t.home_club === 'required' ? 'required' : 'optional';
    var other = h('input', { id: 'home_club_other', name: 'home_club_other', type: 'text', maxlength: 100,
      autocomplete: 'off', 'aria-describedby': 'home_club_other-err' });
    var otherWrap = h('div', { class: 'field other-club', hidden: true },
      h('label', { for: 'home_club_other', text: 'Name of your club' }), other,
      h('div', { class: 'err', id: 'home_club_other-err', role: 'alert' }));
    var select = h('select', { id: 'home_club', name: 'home_club', 'aria-describedby': 'home_club-err' },
      h('option', { value: '', text: 'Choose your club…' }),
      t.clubs.map(function (c) { return h('option', { value: c, text: c }); }),
      h('option', { value: Core.OTHER, text: 'Other (type the name)' }));
    select.addEventListener('change', function () {
      var isOther = select.value === Core.OTHER;
      otherWrap.hidden = !isOther;
      if (isOther) { other.focus(); } else { other.value = ''; }
    });
    return h('div', {},
      h('div', { class: 'field' },
        h('label', { for: 'home_club' }, 'Team’s home club ', h('span', { class: 'req', text: '(' + tag + ')' })),
        select,
        h('div', { class: 'err', id: 'home_club-err', role: 'alert' })),
      otherWrap);
  }

  function formCard(t) {
    var waitlist = t.status === 'waitlist';
    var btn = h('button', { type: 'submit', class: 'btn', text: waitlist ? 'Join the waitlist' : 'Register team' });
    var msg = h('div', { id: 'form-msg', role: 'alert' });

    var teamFields = [];
    if (t.p2 !== 'hidden') { teamFields.push(field('p2', 'Second player’s name', t.p2, { autocomplete: 'off' })); }
    if (t.p3 !== 'hidden') { teamFields.push(field('p3', 'Third player’s name', t.p3, { autocomplete: 'off' })); }
    if (t.home_club !== 'hidden') { teamFields.push(clubField(t)); }
    if (t.choice_mode !== 'hidden') {
      teamFields.push(h('div', { class: 'field', role: 'radiogroup', 'aria-labelledby': 'choice-lbl', 'aria-describedby': 'choice-err' },
        h('div', { class: 'lbl', id: 'choice-lbl' }, t.choice_label, ' ',
          h('span', { class: 'req', text: '(' + (t.choice_mode === 'required' ? 'required' : 'optional') + ')' })),
        h('div', { class: 'radios' }, t.choice_options.map(function (o, i) {
          return h('label', {}, h('input', { type: 'radio', name: 'choice', value: o, id: 'choice-' + i }), o);
        })),
        h('div', { class: 'err', id: 'choice-err', role: 'alert' })));
    }

    var form = h('form', { novalidate: true, autocomplete: 'on' },
      waitlist ? h('div', { class: 'banner warn', text: 'This tournament is full. You can still register: your team will be placed on the waitlist and the organizers will contact you if a spot opens.' }) : null,
      h('fieldset', {},
        h('legend', { text: 'Team captain / skip' }),
        field('captain_name', 'Your name', 'required', { autocomplete: 'name' }),
        field('phone', 'Phone number', 'required', { type: 'tel', inputmode: 'tel', autocomplete: 'tel', maxlength: 30 }),
        field('email', 'Email address', 'required', { type: 'email', inputmode: 'email', autocomplete: 'email', maxlength: 120 })),
      teamFields.length ? h('fieldset', {}, h('legend', { text: 'Your team' }), teamFields) : null,
      h('div', { class: 'hp', 'aria-hidden': 'true' },
        h('label', { for: 'website', text: 'Leave this empty' }),
        h('input', { id: 'website', name: 'website', type: 'text', tabindex: '-1', autocomplete: 'off' })),
      msg,
      btn,
      h('p', { class: 'fine', text: 'We use your details only to run this tournament. Only the captain’s name is shown publicly. A confirmation email will be sent to the address above.' }));

    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      clearErrors(form);
      var data = readForm(form);
      var v = Core.validate(Core.normalizeTournament(tournamentForValidation(t)), data, t.clubs);
      if (!v.ok) { return showErrors(form, v.errors); }

      btn.disabled = true; btn.textContent = 'Sending…';
      api.register(Object.assign({ tournament_id: t.id }, data)).then(function (res) {
        if (res.ok) { return afterRegister(t, res, data); }
        btn.disabled = false; btn.textContent = waitlist ? 'Join the waitlist' : 'Register team';
        if (res.errors) { return showErrors(form, res.errors); }
        if (res.closed) { return renderTournament(t.id); }
        msg.className = 'banner error'; msg.textContent = res.error || 'Something went wrong. Please try again.';
      }, function () {
        btn.disabled = false; btn.textContent = waitlist ? 'Join the waitlist' : 'Register team';
        msg.className = 'banner error'; msg.textContent = NET_MSG;
      });
    });

    return h('div', { class: 'card' }, h('h2', { text: waitlist ? 'Join the waitlist' : 'Register your team' }), form);
  }

  /** publicView carries the same field modes the server uses, so the browser can run the same checks. */
  function tournamentForValidation(t) {
    return {
      id: t.id, name: t.name, p2: t.p2, p3: t.p3, home_club: t.home_club,
      choice_label: t.choice_label, choice_options: t.choice_options.join(','), choice_mode: t.choice_mode
    };
  }

  function readForm(form) {
    var d = {};
    ['captain_name', 'phone', 'email', 'p2', 'p3', 'home_club', 'home_club_other', 'website'].forEach(function (k) {
      var el = form.elements[k];
      if (el) { d[k] = el.value; }
    });
    var checked = form.querySelector('input[name=choice]:checked');
    if (form.querySelector('input[name=choice]')) { d.choice = checked ? checked.value : ''; }
    return d;
  }

  function clearErrors(form) {
    Array.prototype.forEach.call(form.querySelectorAll('.err'), function (e) { e.textContent = ''; });
    Array.prototype.forEach.call(form.querySelectorAll('[aria-invalid]'), function (e) { e.removeAttribute('aria-invalid'); });
    var m = form.querySelector('#form-msg'); if (m) { m.className = ''; m.textContent = ''; }
  }

  function showErrors(form, errors) {
    var first = null;
    Object.keys(errors).forEach(function (k) {
      var box = form.querySelector('#' + k + '-err');
      if (box) { box.textContent = errors[k]; }
      var input = form.elements[k];
      if (input && input.setAttribute) { input.setAttribute('aria-invalid', 'true'); } // radio groups are a collection, not an element
      if (!first) { first = form.querySelector('#' + k) || form.querySelector('input[name=' + k + ']'); }
    });
    if (first) { first.focus(); }
  }

  function afterRegister(t, res, data) {
    var wait = res.status === 'waitlist';
    var cancelHref = res.token ? 'register.html?cancel=' + encodeURIComponent(res.token) : null;
    var box = h('div', { class: 'banner ' + (wait ? 'warn' : 'info'), role: 'status' },
      h('h2', { text: wait ? 'You’re on the waitlist' : 'You’re registered!' }),
      h('p', { text: wait
        ? 'The tournament is full, so ' + data.captain_name + '’s team is on the waitlist. The organizers will contact you if a spot opens.'
        : data.captain_name + '’s team is registered for ' + t.name + '.' }),
      res.emailSent === false
        ? h('p', { text: 'We couldn’t send the confirmation email, but your registration was saved. The organizers have your details.' })
        : h('p', {}, 'A confirmation email is on its way to ', h('strong', { text: data.email }), '. Check your junk folder if you don’t see it.'),
      h('p', { class: 'fine', text: 'Entry fee is paid in cash at the club on the day.' }),
      cancelHref ? h('p', {}, h('a', { href: cancelHref, text: 'Need to withdraw? Cancel this registration' })) : null);
    // Re-read so the roster and spot counts include the new team.
    api.tournament(t.id).then(function (r) { drawTournament(r.ok ? r.tournament : t, box); },
      function () { drawTournament(t, box); });
  }

  /* ------- cancel page */

  function renderCancel(token) {
    show(h('p', { class: 'lede', text: 'Loading…' }));
    api.lookup(token).then(function (res) {
      if (!res.ok) {
        return show(h('h1', { text: 'Registration not found' }),
          h('p', { text: 'This cancel link isn’t valid. If you need to withdraw your team, please contact the tournament organizers.' }),
          h('a', { class: 'btn secondary', href: 'register.html', text: 'See all tournaments' }));
      }
      var r = res.registration, t = res.tournament;
      if (r.status === 'cancelled') {
        return show(h('h1', { text: 'Already cancelled' }),
          h('p', { text: 'This registration has already been cancelled.' }),
          h('a', { class: 'btn secondary', href: 'register.html', text: 'See all tournaments' }));
      }
      var btn = h('button', { type: 'button', class: 'btn danger', text: 'Yes, cancel my registration' });
      var msg = h('div', { role: 'alert' });
      btn.addEventListener('click', function () {
        btn.disabled = true; btn.textContent = 'Cancelling…';
        api.cancel(token).then(function (c) {
          if (!c.ok) { btn.disabled = false; btn.textContent = 'Yes, cancel my registration'; msg.className = 'banner error'; msg.textContent = c.error || 'Something went wrong.'; return; }
          show(h('h1', { text: 'Registration cancelled' }),
            h('div', { class: 'banner info', role: 'status', text: 'Your registration has been cancelled and the organizers have been told. A confirmation email is on its way.' }),
            h('a', { class: 'btn secondary', href: 'register.html', text: 'See all tournaments' }), demoPanel(null));
        }, function () { btn.disabled = false; btn.textContent = 'Yes, cancel my registration'; msg.className = 'banner error'; msg.textContent = NET_MSG; });
      });
      show(h('h1', { text: 'Cancel registration?' }),
        h('div', { class: 'card' },
          t ? h('p', {}, h('strong', { text: t.name }), t.date ? ' – ' + Core.fmtDate(t.date) : '') : null,
          h('p', { text: 'Team captain: ' + r.captain_name + (r.p2 ? ' with ' + r.p2 : '') + (r.p3 ? ' and ' + r.p3 : '') }),
          h('p', { class: 'meta', text: 'Status: ' + (r.status === 'waitlist' ? 'on the waitlist' : 'registered') }),
          msg, btn, ' ',
          h('a', { class: 'btn secondary', href: t ? '?t=' + encodeURIComponent(t.id) : 'register.html', text: 'No, keep it' })));
    }, function () { errorView(NET_MSG); });
  }

  /* ------- demo-only panel */

  function demoPanel(tid) {
    if (!DEMO) { return null; }
    var mails = Demo.mails();
    var panel = h('section', { class: 'demo', 'aria-label': 'Demo controls' },
      h('h2', { text: 'Demo mode' }),
      h('p', { class: 'fine', text: 'Nothing here is real: registrations are stored only in this browser, and the emails that would be sent appear below instead.' }));
    function btnFor(label, fn) {
      return h('button', { type: 'button', text: label, onclick: function () { fn(); route(); } });
    }
    if (tid) {
      panel.appendChild(btnFor('Fill all spots (to see the waitlist)', function () { Demo.fill(tid); }));
      panel.appendChild(btnFor(Demo.isClosed(tid) ? 'Reopen registration' : 'Close registration (organizer)', function () { Demo.toggleClosed(tid); }));
    }
    panel.appendChild(btnFor('Reset demo data', function () { Demo.reset(); }));
    if (mails.length) {
      panel.appendChild(h('h2', { text: 'Emails that would have been sent (' + mails.length + ')' }));
      mails.slice(-6).reverse().forEach(function (m) {
        panel.appendChild(h('details', {}, h('summary', { text: 'To ' + m.to + ' — ' + m.subject }), h('pre', { text: m.body })));
      });
    }
    return panel;
  }

  /* ------------------------------------------------------------ router */

  function route() {
    var q = new URLSearchParams(location.search);
    if (q.get('cancel')) { return renderCancel(q.get('cancel')); }
    if (q.get('t')) { return renderTournament(q.get('t')); }
    document.title = 'Tournament registration – ' + CFG.CLUB_NAME;
    renderList();
  }

  route();
})();
