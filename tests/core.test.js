// Run: node tests/core.test.js
const assert = require('assert');
const C = require('../docs/assets/core.js');

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('ok  - ' + name); }
  catch (e) { console.error('FAIL - ' + name + '\n' + e.stack); process.exitCode = 1; }
}

const [aussieRaw, rowRaw] = C.SAMPLE_TOURNAMENTS;
const aussie = C.normalizeTournament(aussieRaw);
const row = C.normalizeTournament(rowRaw);
const good = { captain_name: 'Pat Smith', phone: '416-555-0123', email: 'pat@example.com' };
const reg = (t, i, status) => ({ tournament_id: t.id, status: status || 'confirmed', captain_name: 'Team ' + i });

test('sample dates are Saturdays in July / August', () => {
  assert.strictEqual(new Date(aussie.date + 'T12:00:00Z').getUTCDay(), 6);
  assert.strictEqual(new Date(row.date + 'T12:00:00Z').getUTCDay(), 6);
  assert.ok(aussie.date.startsWith('2027-07'));
  assert.ok(row.date.startsWith('2027-08'));
});

test('deadline: date only and midnight both mean 11:59 PM', () => {
  assert.strictEqual(C.normalizeDeadline('2027-07-10'), '2027-07-10T23:59');
  assert.strictEqual(C.normalizeDeadline('2027-07-10T00:00'), '2027-07-10T23:59');
  assert.strictEqual(C.normalizeDeadline('2027-07-10 18:30'), '2027-07-10T18:30');
  assert.strictEqual(C.normalizeDeadline('garbage'), '');
});

test('open before deadline, still open during the 11:59 PM minute, closed after', () => {
  assert.strictEqual(C.state(aussie, [], '2027-07-10T12:00').status, 'open');
  assert.strictEqual(C.state(aussie, [], '2027-07-10T23:59').status, 'open');
  assert.strictEqual(C.state(aussie, [], '2027-07-11T00:00').status, 'closed');
});

test('organizer override: closed closes early, open reopens past the deadline', () => {
  const closed = Object.assign({}, aussie, { override: 'closed' });
  assert.strictEqual(C.state(closed, [], '2027-07-01T09:00').status, 'closed');
  const reopened = Object.assign({}, aussie, { override: 'open' });
  assert.strictEqual(C.state(reopened, [], '2027-07-12T09:00').status, 'open');
});

test('changing the deadline reopens a closed form', () => {
  const later = Object.assign({}, aussie, { deadline: '2027-07-14T23:59' });
  assert.strictEqual(C.state(aussie, [], '2027-07-12T09:00').status, 'closed');
  assert.strictEqual(C.state(later, [], '2027-07-12T09:00').status, 'open');
});

test('cap: spots left count down, then new teams go to the waitlist', () => {
  const regs = [];
  for (let i = 0; i < aussie.cap - 1; i++) { regs.push(reg(aussie, i)); }
  assert.strictEqual(C.state(aussie, regs, '2027-07-01T09:00').spotsLeft, 1);
  assert.strictEqual(C.decide(aussie, regs, '2027-07-01T09:00'), 'confirmed');
  regs.push(reg(aussie, 99));
  assert.strictEqual(C.decide(aussie, regs, '2027-07-01T09:00'), 'waitlist');
  assert.strictEqual(C.state(aussie, regs, '2027-07-01T09:00').status, 'waitlist');
});

test('cancelled teams free their spot; waitlisted teams do not take one', () => {
  const regs = [];
  for (let i = 0; i < aussie.cap; i++) { regs.push(reg(aussie, i)); }
  regs.push(reg(aussie, 'w', 'waitlist'));
  assert.strictEqual(C.state(aussie, regs, '2027-07-01T09:00').confirmed, aussie.cap);
  regs[0].status = 'cancelled';
  assert.strictEqual(C.decide(aussie, regs, '2027-07-01T09:00'), 'confirmed');
});

test('registrations for other tournaments do not count', () => {
  const regs = [reg(row, 1), reg(row, 2)];
  assert.strictEqual(C.state(aussie, regs, '2027-07-01T09:00').confirmed, 0);
});

test('closed tournaments refuse registration', () => {
  assert.strictEqual(C.decide(aussie, [], '2027-07-20T09:00'), null);
});

test('Aussie Pairs: p3 is hidden and ignored, p2 optional, home club optional', () => {
  const v = C.validate(aussie, Object.assign({ p3: 'Sneaky Third', home_club: 'Balmy Beach' }, good));
  assert.ok(v.ok);
  assert.strictEqual(v.clean.p3, '');
  assert.strictEqual(v.clean.p2, '');
  assert.strictEqual(v.clean.home_club, 'Balmy Beach');
});

test('Canada vs ROW: side is mandatory and must be one of the options', () => {
  const missing = C.validate(row, good);
  assert.ok(!missing.ok && missing.errors.choice);
  const bad = C.validate(row, Object.assign({ choice: 'Mars' }, good));
  assert.ok(!bad.ok && bad.errors.choice);
  const okCanada = C.validate(row, Object.assign({ choice: 'Canada' }, good));
  assert.ok(okCanada.ok);
  assert.strictEqual(okCanada.clean.choice, 'Canada');
  assert.ok(C.validate(row, Object.assign({ choice: 'ROW' }, good)).ok);
});

test('home club: pick from the shared list, or Other + typed name', () => {
  const clubs = ['Kew Beach', 'Cosburn', 'Balmy Beach'];
  const ok1 = C.validate(aussie, Object.assign({ home_club: 'cosburn' }, good), clubs);
  assert.ok(ok1.ok); assert.strictEqual(ok1.clean.home_club, 'Cosburn'); // list spelling wins
  const other = C.validate(aussie, Object.assign({ home_club: 'Other', home_club_other: ' Scarboro LBC ' }, good), clubs);
  assert.ok(other.ok); assert.strictEqual(other.clean.home_club, 'Other: Scarboro LBC');
  const noText = C.validate(aussie, Object.assign({ home_club: 'Other', home_club_other: '  ' }, good), clubs);
  assert.ok(!noText.ok && noText.errors.home_club_other);
  const fake = C.validate(aussie, Object.assign({ home_club: 'Atlantis LBC' }, good), clubs);
  assert.ok(!fake.ok && fake.errors.home_club, 'made-up value outside the list is rejected');
  const blank = C.validate(aussie, good, clubs); // optional + empty is fine
  assert.ok(blank.ok && blank.clean.home_club === '');
});

test('home club required: blank is an error', () => {
  const t = C.normalizeTournament(Object.assign({}, aussieRaw, { home_club: 'required' }));
  assert.ok(C.validate(t, good).errors.home_club);
  assert.ok(C.validate(t, Object.assign({ home_club: 'Kew Beach' }, good)).ok);
});

test('club list: trimmed, de-duplicated, "Other" never listed, organizer edits take effect', () => {
  assert.deepStrictEqual(C.cleanClubs([' Kew Beach ', 'kew beach', '', 'Other', 'Cosburn']), ['Kew Beach', 'Cosburn']);
  assert.deepStrictEqual(C.cleanClubs(undefined), C.DEFAULT_CLUBS);
  assert.deepStrictEqual(C.cleanClubs([]), []);
  // a club added to the list becomes valid for every tournament; one removed stops being valid
  const withNew = ['Kew Beach', 'Scarboro LBC'];
  assert.ok(C.validate(aussie, Object.assign({ home_club: 'Scarboro LBC' }, good), withNew).ok);
  assert.ok(!C.validate(aussie, Object.assign({ home_club: 'Cosburn' }, good), withNew).ok);
});

test('public view carries the club list only when the tournament shows the field', () => {
  assert.deepStrictEqual(C.publicView(aussie, [], '2027-07-01T09:00', ['A', 'B']).clubs, ['A', 'B']);
  assert.deepStrictEqual(C.publicView(row, [], '2027-08-01T09:00', ['A', 'B']).clubs, []);
});

test('Canada vs ROW: home club hidden is dropped', () => {
  const v = C.validate(row, Object.assign({ choice: 'ROW', home_club: 'Elsewhere' }, good));
  assert.strictEqual(v.clean.home_club, '');
});

test('organizer can make p2 required and the form enforces it', () => {
  const t = C.normalizeTournament(Object.assign({}, aussieRaw, { p2: 'required' }));
  const v = C.validate(t, good);
  assert.ok(!v.ok && v.errors.p2);
  assert.ok(C.validate(t, Object.assign({ p2: 'Lee Wong' }, good)).ok);
});

test('captain name, phone and email are always required and checked', () => {
  const v = C.validate(aussie, {});
  assert.deepStrictEqual(Object.keys(v.errors).sort(), ['captain_name', 'email', 'phone']);
  assert.ok(C.validate(aussie, Object.assign({}, good, { email: 'not-an-email' })).errors.email);
  assert.ok(C.validate(aussie, Object.assign({}, good, { phone: '555' })).errors.phone);
  assert.ok(C.validate(aussie, Object.assign({}, good, { phone: 'call me maybe' })).errors.phone);
  assert.ok(C.validate(aussie, Object.assign({}, good, { phone: '+1 (416) 555-0123' })).ok);
});

test('newlines are stripped from single-line fields (email header safety)', () => {
  const v = C.validate(aussie, Object.assign({}, good, { captain_name: 'Pat\r\nBcc: x@evil.com' }));
  assert.ok(!/[\r\n]/.test(v.clean.captain_name));
});

test('public view never exposes phone, email, or other players', () => {
  const rec = C.makeRecord(aussie, C.validate(aussie, Object.assign({ p2: 'Lee Wong' }, good)).clean,
    'confirmed', { timestamp: 't', regId: 'r1', token: 'tok' });
  const pv = C.publicView(aussie, [rec], '2027-07-01T09:00');
  assert.deepStrictEqual(pv.captains, ['Pat Smith']);
  const dump = JSON.stringify(pv);
  ['416-555-0123', 'pat@example.com', 'Lee Wong', 'tok'].forEach(s => assert.ok(!dump.includes(s), s));
});

test('confirmation email: confirmed vs waitlist, includes cancel link', () => {
  const clean = C.validate(row, Object.assign({ choice: 'Canada', p2: 'Lee Wong' }, good)).clean;
  const ctx = { clubName: 'Kew Beach LBC', contactEmail: 'o@x.ca', cancelUrl: 'https://x/register.html?cancel=abc' };
  const ok = C.confirmationEmail(row, C.makeRecord(row, clean, 'confirmed', { timestamp: '', regId: '', token: '' }), ctx);
  assert.ok(ok.subject.startsWith('Registered:'));
  assert.ok(ok.body.includes('cancel=abc') && ok.body.includes('Canada') && ok.body.includes('cash'));
  const wl = C.confirmationEmail(row, C.makeRecord(row, clean, 'waitlist', { timestamp: '', regId: '', token: '' }), ctx);
  assert.ok(wl.subject.startsWith('Waitlisted:') && wl.body.includes('WAITLIST'));
});

test('cancel email flags a free spot when the waitlist has teams', () => {
  const clean = C.validate(aussie, good).clean;
  const r = C.makeRecord(aussie, clean, 'confirmed', { timestamp: '', regId: '', token: '' });
  const ctx = { clubName: 'Kew Beach LBC' };
  const m = C.cancellationEmails(aussie, r, 'confirmed', { confirmed: 15, waitlisted: 2 }, ctx);
  assert.ok(m.organizer.body.includes('2 team(s) are on the waitlist'));
  const none = C.cancellationEmails(aussie, r, 'confirmed', { confirmed: 15, waitlisted: 0 }, ctx);
  assert.ok(!none.organizer.body.includes('waitlist.'));
});

test('date formatting', () => {
  assert.strictEqual(C.fmtDate('2027-07-17'), 'Saturday, July 17, 2027');
  assert.strictEqual(C.fmtDeadline('2027-07-10T23:59'), 'Saturday, July 10, 2027 at 11:59 PM');
  assert.strictEqual(C.fmtTime('00:05'), '12:05 AM');
});

console.log('\n' + passed + ' tests passed');
