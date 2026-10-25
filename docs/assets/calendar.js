/* Staging stand-in for the club's monthly calendar.
   On the real calendar, a tournament entry just needs its title linked to
   register.html?t=<tournament id> (the id is shown in the sheet's registration_link column). */
(function () {
  'use strict';
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
    'September', 'October', 'November', 'December'];
  var DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  var MIN = [2027, 6], MAX = [2027, 8];

  var RECURRING = { 1: 'MON AM BOWL', 2: 'TUES EVE BOWL', 4: 'THURS AM BOWL' };
  var ONE_OFF = {
    '2027-07-24': [{ text: 'PRIVATE EVENT' }],
    '2027-07-31': [{ text: 'JITNEY' }],
    '2027-06-19': [{ text: 'GREENS MAINTENANCE' }],
    '2027-07-17': [{ text: 'AUSSIE PAIRS', href: 'register.html?t=aussie-pairs-2027-07-17' }],
    '2027-08-14': [{ text: 'CANADA VS ROW', href: 'register.html?t=canada-vs-row-2027-08-14' }]
  };

  function pad(n) { return (n < 10 ? '0' : '') + n; }

  var q = new URLSearchParams(location.search).get('m') || '2027-07';
  var parts = q.split('-').map(Number);
  var y = parts[0], m = parts[1];
  if (y * 12 + m < MIN[0] * 12 + MIN[1] || y * 12 + m > MAX[0] * 12 + MAX[1]) { y = 2027; m = 7; }

  function monthLink(delta) {
    var t = y * 12 + (m - 1) + delta;
    var ny = Math.floor(t / 12), nm = (t % 12) + 1;
    if (ny * 12 + nm < MIN[0] * 12 + MIN[1] || ny * 12 + nm > MAX[0] * 12 + MAX[1]) { return null; }
    return '?m=' + ny + '-' + pad(nm);
  }

  document.getElementById('title').textContent = MONTHS[m - 1] + ' ' + y;
  document.title = MONTHS[m - 1] + ' ' + y + ' – Calendar – Kew Beach Lawn Bowling Club (staging)';
  [['prev', -1], ['next', 1]].forEach(function (p) {
    var a = document.getElementById(p[0]), href = monthLink(p[1]);
    if (href) { a.setAttribute('href', href); } else { a.style.visibility = 'hidden'; }
  });

  var first = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  var days = new Date(Date.UTC(y, m, 0)).getUTCDate();

  var table = document.createElement('table');
  table.className = 'cal';
  var thead = table.createTHead().insertRow();
  DAYS.forEach(function (d) {
    var th = document.createElement('th'); th.scope = 'col'; th.textContent = d.slice(0, 3); thead.appendChild(th);
  });
  var tbody = table.createTBody();
  var row = null;
  for (var cell = 0; cell < Math.ceil((first + days) / 7) * 7; cell++) {
    if (cell % 7 === 0) { row = tbody.insertRow(); }
    var td = row.insertCell();
    var day = cell - first + 1;
    if (day < 1 || day > days) { td.className = 'out'; continue; }
    var dow = cell % 7;
    var key = y + '-' + pad(m) + '-' + pad(day);
    var events = [];
    if (RECURRING[dow]) { events.push({ text: RECURRING[dow] }); }
    (ONE_OFF[key] || []).forEach(function (e) { events.push(e); });
    var dn = document.createElement('span');
    dn.className = 'dn'; dn.textContent = day; dn.setAttribute('data-label', DAYS[dow]);
    td.appendChild(dn);
    events.forEach(function (e) {
      var node = document.createElement(e.href ? 'a' : 'span');
      node.className = 'ev'; node.textContent = e.text;
      if (e.href) { node.href = e.href; }
      td.appendChild(node);
    });
    if (!events.length) { td.className = 'empty'; }
  }
  document.getElementById('grid').appendChild(table);
})();
