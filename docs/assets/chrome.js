/* Builds the header, menu and footer so every page looks like part of the club site.
   On the real site the club's own header/footer replace this file. */
(function () {
  'use strict';
  var C = window.KB_CONFIG;
  var S = C.CLUB_SITE;

  var MENU = [
    { label: 'Welcome to our Club', href: S + 'index.php', sub: [
      ['Contact', S + 'contactUs.php'], ['Links', S + 'links.php']] },
    { label: 'Membership', sub: [
      ['Join Our Club', S + 'signup.php'], ['Renew Membership', S + 'renew.php'],
      ['Calendar', C.LINKS.calendar]] },
    { label: 'Tournaments & Leagues', sub: [
      ['Leagues', S + 'leagues.php'], ['Tournaments', C.LINKS.tournaments],
      ['In Club Tournaments', C.LINKS.inclub]] },
    { label: 'Club Use / Sponsorship', sub: [
      ['Rentals Information', S + 'rentalsPage.php'], ['Rental Request Form', S + 'rentalForm.php'],
      ['Sponsorships', S + 'sponsorPage.php'], ['Our Sponsors', S + 'sponsorDisplay.php']] },
    { label: 'Croquet / Coaches Corner', sub: [
      ['Coaches Corner', S + 'newMemberPage.php'], ['Croquet', S + 'customPage.php/croquet']] },
    { label: 'Login', href: S + 'login.php' }
  ];

  function el(tag, attrs, kids) {
    var e = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === 'text') { e.textContent = attrs[k]; } else { e.setAttribute(k, attrs[k]); }
    });
    (kids || []).forEach(function (k) { e.appendChild(k); });
    return e;
  }

  function link(text, href) { return el('a', { href: href, text: text }); }

  // ----- header
  var head = el('header', { 'class': 'site-head' });
  var top = el('div', { 'class': 'wrap head-top' });
  var logoLink = el('a', { href: S, 'aria-label': C.CLUB_NAME + ' home' });
  var img = el('img', { src: C.LOGO_URL, alt: C.CLUB_NAME + ' logo' });
  logoLink.appendChild(img);
  var contact = el('div', { 'class': 'head-contact' }, [
    link('☎ ' + C.CLUB_PHONE, 'tel:' + C.CLUB_PHONE.replace(/\D/g, '')),
    link('✉ ' + C.CLUB_EMAIL, 'mailto:' + C.CLUB_EMAIL)
  ]);
  top.appendChild(logoLink);
  top.appendChild(contact);
  head.appendChild(top);

  var toggle = el('button', { type: 'button', 'class': 'nav-toggle', 'aria-expanded': 'false', text: '☰ Menu' });
  var wrapToggle = el('div', { 'class': 'wrap' }, [toggle]);
  wrapToggle.style.paddingBottom = '0';

  var nav = el('nav', { 'class': 'site-nav', 'aria-label': 'Main menu' });
  var ul = el('ul');
  MENU.forEach(function (item) {
    var li = el('li');
    if (item.sub) {
      var btn = el('button', { type: 'button', 'class': 'nav-top', 'aria-expanded': 'false', text: item.label + ' ▾' });
      var sub = el('ul', { 'class': 'sub' });
      item.sub.forEach(function (s) { sub.appendChild(el('li', {}, [link(s[0], s[1])])); });
      btn.addEventListener('click', function () {
        var open = li.classList.toggle('open');
        btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      });
      li.appendChild(btn);
      li.appendChild(sub);
    } else {
      li.appendChild(link(item.label, item.href));
    }
    ul.appendChild(li);
  });
  nav.appendChild(el('div', { 'class': 'wrap' }, [ul]));
  toggle.addEventListener('click', function () {
    var show = nav.classList.toggle('show');
    toggle.setAttribute('aria-expanded', show ? 'true' : 'false');
  });
  document.addEventListener('click', function (e) {
    if (!nav.contains(e.target)) {
      Array.prototype.forEach.call(nav.querySelectorAll('li.open'), function (li) { li.classList.remove('open'); });
    }
  });

  var skip = el('a', { 'class': 'skip', href: '#main', text: 'Skip to content' });
  var frag = document.createDocumentFragment();
  frag.appendChild(skip);
  if (C.STAGING) {
    frag.appendChild(el('div', { 'class': 'ribbon', role: 'note',
      text: 'STAGING PREVIEW – a mock-up for the board. This is not the real club website.' }));
  }
  frag.appendChild(head);
  head.appendChild(wrapToggle);
  head.appendChild(nav);
  document.body.insertBefore(frag, document.body.firstChild);

  // ----- footer
  var foot = el('footer', { 'class': 'site-foot' }, [
    el('div', { 'class': 'wrap' }, [
      el('div', {}, [
        el('strong', { text: C.CLUB_NAME }),
        el('br'), document.createTextNode('12 Lee Avenue, Toronto, ON M4E 2N9'),
        el('br'), document.createTextNode(C.CLUB_PHONE)
      ]),
      el('div', {}, [document.createTextNode('Website powered by Lawn Bowling Manager'),
        el('br'), document.createTextNode('Registration page: staging prototype')])
    ])
  ]);
  document.body.appendChild(foot);
})();
