# Security

Molinova is a personal assistant that runs on your own Mac. This page explains what stays on your
machine, where secrets are kept, what the local server accepts, and how to report a vulnerability.

## What stays local

- All data Molinova builds (the SQLite database, settings, taxonomy, rules, your context file, logs) is
  written to a single data folder on your Mac:
  - macOS app: `~/Library/Application Support/Molinova`
  - development: the repository itself, or the folder named by `MOLINOVA_HOME`
- There is no Molinova server, account or telemetry. Molinova only talks to the services you connect:
  - **Google** (Gmail, plus Google Calendar and Google Drive if you enable them) through the official
    APIs;
  - **Vercel AI Gateway**, which forwards to the AI model the text Molinova needs to understand
    (email headers and excerpts, the text of emails in which a date or a task was spotted, examples
    from your corrections, your context, messages from the WhatsApp chats you chose to follow with
    their identifiers, messages you send to the Telegram bot and what its tools read for the answer,
    the first 6,000 characters of the Google Drive documents you have Molinova classify, identity
    documents included; the full list is in the README, "Privacy and security"). Only use Molinova with data you are
    comfortable sending there;
  - **Telegram**, only if you set up the bot;
  - **GitHub**, once a day in the macOS app, to check for a newer release (no auto-update).
- **WhatsApp** is read locally: Molinova copies the database of the WhatsApp Desktop app for Mac and
  reads the copy in read-only mode. No linked device, no WhatsApp network access.
- **Google Drive** documents are read on your Mac: each file is downloaded to the system's temporary
  folder, its text is extracted (Google export, macOS text layer or OCR through the bundled
  `molinova-text` helper, or `textutil`), and the file is deleted. Only the first 6,000 characters are
  kept, and not even those for a document marked sensitive. Molinova never writes to Drive.
- The interface fonts and scripts are served from the app itself (no CDN, no Google Fonts).

## Where secrets live

The four secrets are `AI_GATEWAY_API_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and
`TELEGRAM_BOT_TOKEN`.

- **macOS app**: entered in the setup assistant, stored in `secrets.bin` in the data folder,
  encrypted with Electron `safeStorage` (the key is held in the macOS Keychain). They are decrypted
  only to start the local server process. The app's Electron fuses turn off `ELECTRON_RUN_AS_NODE`,
  `NODE_OPTIONS` and `--inspect`, so another program cannot run code as Molinova to read them. If the
  Keychain refuses access, Molinova says so (menu bar) and refuses to save keys instead of keeping them
  in memory only. See `docs/desktop-app.md`.
- **Development**: plain text in `.env.local` in the data folder (mode 0600 when Molinova writes it, never committed;
  `chmod 600 .env.local` if you created it yourself).
- **Google OAuth refresh tokens**: one file per account in `tokens/<email>.json` (file mode 0600,
  folder mode 0700). They are **not encrypted yet**; encrypting them with `safeStorage` is planned
  work. Anyone who can read files as your macOS user can read them, as with most desktop apps.

## Local server

The interface talks to a small HTTP server started by the app:

- it listens on `127.0.0.1` only, never on your network;
- every request goes through a guard (`src/core/http-guard.ts`):
  - the `Host` header must be `127.0.0.1:<port>` or `localhost:<port>` (blocks DNS rebinding);
  - every `/api/` request must carry the **session key**: a random 256-bit value the app creates at
    each launch, passes to the server process through its environment, and gives its window as an
    `HttpOnly`, `SameSite=Strict` cookie (the main process uses an `X-Molinova-Key` header). Another
    macOS account, or another app on the Mac, cannot read your mail or drive Molinova through the
    server. In development, the key is kept in `data/session.key` (mode 0600) and the terminal
    prints the link that sets the cookie;
  - `/api/` requests that a browser marks as coming from another site (`Sec-Fetch-Site`) are
    refused, even with the cookie;
  - every write must carry a JSON `Content-Type` and, when the browser sends one, an `Origin` equal
    to the interface.
- Emails are shown in a sandboxed frame without scripts, whose content policy blocks every remote
  resource (images, style sheets, fonts) until you ask to show the images, and then allows `https`
  only.

## Your own Google app

Molinova does not ship a shared Google OAuth client. Each user creates their own Google app in their own
Google Cloud project (steps in the README, "Your own Google app", and in
[docs/google-setup.md](docs/google-setup.md)):

- the OAuth client ID and secret belong to you and stay in Molinova's secrets on your Mac; nobody else,
  not the author of Molinova, holds a client that can reach your mailbox;
- the app is published ("In production") so that access does not expire every 7 days, but it stays
  **unverified**: Google shows "Google hasn't verified this app" when you sign in, because you are
  signing in to your own app. Verification is only required above 100 users. Do not start Google's
  verification (a paid security assessment) and do not go "Back to testing";
- the three links Google requires in Branding (home page, privacy policy, terms of service) can point
  to Molinova's public pages (`https://kasiopajg.github.io/molinova/`, published from `site/`) or to your own
  website. The privacy policy there states that the publisher receives no data and follows the
  Google API Services User Data Policy, including Limited Use;
- client type **Desktop app** only: the sign-in uses a one-shot loopback server on `127.0.0.1` with a
  random port, closed after 5 minutes, with PKCE (S256) and a random `state` checked on return; a
  "Web application" client is refused;
- withdraw access at any time at [myaccount.google.com/permissions](https://myaccount.google.com/permissions).

## Google permissions

Molinova asks for the smallest set of scopes that covers what it does (`src/connectors/gmail.ts`). Google's
consent screen has one checkbox per scope: Molinova stores the scopes **actually granted** (not the ones
it asked for). Without `gmail.modify`, no token is kept; without the drafts or calendar scopes, the
mailbox is connected and the missing features are reported.

| Scope | When | Why |
|---|---|---|
| `gmail.modify` | always | read emails, add and remove Molinova's labels, archive, mark as read |
| `gmail.compose` | only if you enable drafts | create drafts |
| `calendar.events` | only if you enable the calendar | add events to Google Calendar |
| `calendar.calendarlist.readonly` | only if you enable the calendar | list your calendars |
| `calendar.app.created` | only if you enable the calendar | create a dedicated family calendar |
| `drive.readonly` | only for the accounts you connect in Channels › Google Drive | read file names, folders and dates, and download documents to read their text on your Mac; never writes |

Google's `gmail.modify` and `gmail.compose` scopes technically allow sending. Molinova only sends an
email when you click a send button (reply, forward, follow-up).

What Molinova never does:

- it never deletes an email (no trash, no permanent deletion);
- it never deletes, moves, renames, shares or modifies a Google Drive document;
- it never pays, buys or moves money;
- it never sends a message on your behalf without an explicit click.

## Reporting a vulnerability

Please do **not** open a public issue. Report it privately through a GitHub security advisory:
https://github.com/kasiopajg/molinova/security/advisories/new

Include the version, the steps to reproduce and the impact you observed. You will get an answer
as soon as possible; Molinova is maintained by one person on their free time, so please allow a few
days. Fixes are published as a new GitHub Release.
