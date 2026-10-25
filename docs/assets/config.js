/* Site settings. The only line you must change to go live is API_URL. */
window.KB_CONFIG = {
  // Paste the Apps Script web app URL here (ends in /exec).
  // Left empty, the page runs in DEMO MODE: data is kept in this browser only and emails are
  // shown on screen instead of being sent. Good for showing the board.
  API_URL: '',

  CLUB_NAME: 'Kew Beach Lawn Bowling Club',
  CLUB_PHONE: '416-694-4371',
  CLUB_EMAIL: 'kewbeachlbcinfo@gmail.com',
  CLUB_SITE: 'https://kewbeachlbc.ca/',
  LOGO_URL: 'https://kewbeachlbc.ca/data/102/style/better_logo_small.jpg',

  // Where "back" links go. In staging these are the cloned pages; on the real site, point them
  // at the club's own pages (e.g. 'https://kewbeachlbc.ca/tournamentPage.php').
  LINKS: {
    calendar: 'calendar.html',
    tournaments: 'tournaments.html',
    inclub: 'in-club.html'
  },

  // Shows a "staging preview" ribbon on every page. Set to false for the real thing.
  STAGING: true
};
