# Kew Beach LBC – tournament registration (staging prototype)

A replacement for SignUpGenius. Static pages on GitHub Pages; a Google Sheet plus Apps Script
holds the data and sends the emails.

```
docs/            the website (publish this folder with GitHub Pages)
  register.html  the registration page: ?t=<id> one tournament, ?cancel=<token> cancel page
  index.html     board preview start page
  calendar.html, tournaments.html, in-club.html   staging stand-ins for the club pages
  assets/config.js   the one file to edit (API_URL, club details)
  assets/core.js     the rules (single source of truth, see build.sh)
apps-script/     Code.gs + Core.gs + appsscript.json (paste into the Sheet's Apps Script)
tests/           node tests/core.test.js
build.sh         copies docs/assets/core.js to apps-script/Core.gs
```

## 1. Show it now (demo mode, no setup)

Leave `API_URL` empty in `docs/assets/config.js`. Everything works in the browser:
registrations are stored only on that device, and the emails that *would* be sent are shown in a
yellow "Demo mode" box, which also has buttons to fill the tournament (to see the waitlist) and
close or reopen registration.

Publish: push this folder to a GitHub repo, then Settings > Pages > Deploy from branch >
`main` / `/docs`. The site is at `https://<user>.github.io/<repo>/`.

## 2. Make it real (Google Sheet + emails)

1. Create a new Google Sheet (as owen@owenstokes.com for staging).
2. Extensions > Apps Script. Create files `Code.gs` and `Core.gs` with the contents of
   `apps-script/Code.gs` and `apps-script/Core.gs`. In Project Settings, tick "Show appsscript.json"
   and paste `apps-script/appsscript.json`.
3. Reload the Sheet. Use the new **Tournament tools** menu: *Set up / repair tabs* (this also creates
   the Clubs tab), then *Add the two sample tournaments* (skipped if they are already there). Approve the permissions when asked.
4. On the **Config** tab set `organizer_emails` (comma-separated), `contact_email`, and
   `site_base_url` (your GitHub Pages URL, ending in `/`). Staging default is owen@owenstokes.com.
5. In Apps Script: Deploy > New deployment > Web app. Execute as **Me**, access **Anyone**.
   Copy the `/exec` URL into `API_URL` in `docs/assets/config.js`, commit, push.
6. Use *Send myself a test email*, then register a test team on the live page.

Emails send from the Google account that owns the script (about 100 recipients per day on a free
account, so roughly 50 registrations a day, plenty for this). For the real club, move the Sheet
to a club-owned account.

## How organizers use the Sheet

**Tournaments tab** – one row per tournament. Dropdowns keep values valid.

| Column | Meaning |
|---|---|
| `id` | Unique, no spaces, e.g. `aussie-pairs-2027-07-17` (name + date). Never change it after people register. |
| `type` | `open` or `in-club` |
| `cap` | Number of teams. Blank = no limit. Over the cap, new teams go on the waitlist. |
| `deadline` | Date and time. A date alone (or 00:00) means 11:59 PM. Change it to extend. |
| `status_override` | `auto` (use the deadline), `closed` (close now), `open` (reopen after the deadline) |
| `p2`, `p3`, `home_club` | `hidden`, `optional` or `required` (home club uses the Clubs tab) |
| `choice_label`, `choice_options`, `choice_mode` | An optional radio question. Options comma-separated, e.g. `Canada,ROW`. |
| grey columns | Live counts, spots left, and `registration_link`: **copy this into the calendar entry / Register button.** |

Captain name, phone and email are always required.

**Clubs tab** – the one shared list behind every "Team's home club" dropdown. One club per row in
column A (starts with Kew Beach, Cosburn, Balmy Beach). Add or remove rows and every tournament
that shows the Home Club field changes at once. The page always adds an **Other** choice that opens a
free-text box; an "Other" entry is saved as `Other: <typed name>`, so organizers can spot new clubs and
add them to the list. Do not type "Other" in the list yourself. Registrations store the club name as
text, so renaming a club in the list does not alter past registrations.

**Registrations tab** – written by the script. Organizers can set `status` to `cancelled`
(cancels a team) or change `waitlist` to `confirmed` (promotes a team; earliest timestamp first).
Do not rename the header row.

Cancelling: captains use the link in their confirmation email; the organizers get an email, and it
says when a spot has opened with teams waiting.

## Privacy

The public page shows only captain names and spot counts. Phone, email and other players are
visible only in the Sheet, so share the Sheet only with organizers. Cells are stored as plain text,
so a name like `=HYPERLINK(...)` cannot run as a formula.

## Deliberately not in this version

Waitlist auto-promotion, duplicate-registration checks, online payment (cash on the day), the
Balmy Beach home-and-away challenges, rate limiting beyond a hidden spam-trap field.

**Planned next:** reminder emails to registrants 7 days and 48 hours before each tournament (a
time-driven Apps Script trigger that reads the Registrations tab; cancelled and waitlisted teams get
different wording or are skipped).

## Tests

`node tests/core.test.js` covers the rules (caps, waitlist, deadlines, overrides, field modes,
privacy of the public view, emails). The Apps Script file itself can only run inside Google, so it
has been syntax-checked but not executed; step 6 above is the real test.
