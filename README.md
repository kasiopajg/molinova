# Molinova

English · [Français](README.fr.md)

Molinova is a personal and family assistant for macOS. It triages your Gmail inboxes with AI: it sorts
every email into your categories and spots what needs a reply, a payment or a date. From there it
builds a family calendar and a task list. It can also read WhatsApp groups locally, through WhatsApp
Desktop on the same Mac (Molinova does not add a linked device of its own), and talk to the household
through a private Telegram bot. Molinova runs on your Mac: your data and your Google sign-in keys stay
there. There is no Molinova server on the internet and no Molinova account (Molinova only runs a small server
inside your Mac for its own window). AI calls go through **your own** key for Vercel AI Gateway (the
service that relays requests to AI models), with zero data retention: the AI providers keep nothing
and never train on your data.

Molinova is open source (MIT) and at version 0.1.0. It runs on macOS on Apple Silicon, in English,
French or Spanish.

## What it does

### Screens

- **Home**: what Molinova does on its own, channel by channel (Gmail watch, WhatsApp reading, the
  Telegram bot, follow-ups), with the time of the last and next pass; what you need to do to keep
  everything running (history catch-up, mailbox to reconnect, bot stopped…); what each channel
  brings up (to handle, to schedule, tasks); and a feed of what happened.
- **Actions**: one queue for everything that needs you, grouped as Handle, Reply, Follow up, Pay,
  Calendar, Task and To read. An email leaves the queue once you have replied, read,
  archived or ignored it. It also offers bulk actions, "Never again from these senders" rules and a
  one-click cleanup of the noise (archived, never deleted). Importance follows time: an email more
  than 3 days old is no longer *Urgent*, more than 14 days old it is at most *Normal*. An email whose
  relevance was limited in time (offer, invitation, alert, delivery…) becomes *Obsolete* once that
  time has passed: it leaves the queue and the *Obsolete* filter archives them all in one click.
- **Inbox**, with three folders in the left menu: *Received* (where Inbox opens), *Sent* and *Drafts*
  (drafts are read from Gmail when you open them, and finished in Gmail). Filters (unread, to answer, to follow up, to pay, calendar, noise, date:
  24 h, 7 days, 30 days or a range picked on a calendar; Actions has the same date filter),
  search, reading, reply and forward (with files attached from the Mac, 25 MB in total), AI drafts ("Write with AI") that you send or save as Gmail
  drafts, and event extraction from an email. Keyboard shortcuts: J / K next and previous email,
  R reply, F forward, E archive, A calendar, 1–9 fix the category.
- **Calendar**: the week, one lane per household member. Proposals "To schedule" come from emails
  and WhatsApp, with the person concerned already filled in. You can answer Google Calendar
  invitations here. By default, events go to a "Family" Google calendar (an existing one whose name
  starts with "Famil…", otherwise one Molinova creates); you can also add an event to your main
  calendar. Tasks live in the app, below the lanes. Proposals only come from the last 30 days of email, or have a date still
  to come. *Clean up the noise* has Jev reread every
  proposal and ignore the solicitations (promotions, newsletters, donation appeals), cost shown first.
- **Documents**: the Google Drive documents of the folders you included, each with a card (type,
  context, people concerned, validity, expiry date, issuer), filters, a search in plain words, and
  a preview or download without leaving Molinova. You correct a card in one click; Molinova never rewrites a
  card you corrected.
- **Channels**: one page per channel, each with its status light in the menu.
  - *Telegram*: Molinova in your pocket. Morning summary, the week ahead on Sunday, reminders, and a chat
    to search, schedule an event or note a task. You link your phone by scanning a QR code.
  - *Gmail*: your mailboxes, their watch, their history, and the classifier: *Preview* (classify
    without touching Gmail), *Classify the history* (apply the labels in Gmail), *Watch new
    emails* and *Reclassify* (Jev rereads the already-classified emails of a period, or of one
    category, with its current questions; your corrections keep their category, and the cost is
    shown first). In Actions and the Inbox, *Run Jev again* does the same for the emails you pick. The map of what the emails are about lives here too.
  - *To sort* (under Gmail): the emails whose label is uncertain. That isn't work to do, so they
    are not in Actions. You pick the category, or accept the proposals in bulk; your answers become
    examples and, if you want, rules per domain.
  - *WhatsApp*: the chats Molinova listens to.
  - *Google Drive*: the accounts allowed to read their Drive, the folder choices, and the AI cost
    before any run.
- **Settings**:
  - *Connections*: gateway, models, credits, Google accounts, WhatsApp, Telegram, the Mac app's
    options.
  - *Tokens and costs*: every model call by purpose, model, source and day.
  - *Context*: family, schools, clubs, key people.
  - *Rules*: fixed rules by sender, domain or subject (no AI), confidence thresholds, a cleanup
    date (emails received before it leave Actions and reminders; nothing changes in Gmail), language
    and date format.
  - *Taxonomy*: your categories, two levels, drag and drop.
  - *Jev questions*: what the classifier is asked about each email.

### How an email is classified

A cascade picks each email's category and stops at the first level that is sure of itself:

1. **Rules**: yours, and the ones learned from your corrections.
2. **Sender memory**: the same sender got the same category at least three times.
3. **Jev** (`typesafe-ai/jev`): a fixed list of questions with set answers, answered in one AI
   call, each with a confidence score. They cover category, reply expected, priority, spam, action
   required, event, task, to pay, whether its relevance is limited in time, which child it concerns
   and, for an email you sent, whether it is waiting for an answer. Jev gets the email's date and
   today's date.
4. **You**: below the confidence threshold, the email waits in *To sort*.

A rule or the sender memory only fixes the category: Jev is still asked about every email for its
signals (reply, payment, date, task, priority). The exceptions are emails covered by a rule marked
*Without Jev*, such as the "nothing to do" rules that *Never again from these senders* creates:
those never reach the AI.

Molinova adds labels under the `AI/` prefix in Gmail (`AI/Home/Garden` for a subcategory) and archives
nothing on its own. Renaming or moving a category in *Taxonomy* renames the Gmail label, and Molinova
offers to reclassify the affected emails.

Default models, set in `config/settings.json` in the data folder: `typesafe-ai/jev` classifies,
`openai/gpt-5.4-mini` writes drafts and extracts events and tasks, and
`google/gemini-3.1-flash-lite` runs the Telegram chat.

### WhatsApp (optional)

- Molinova reads the database that **WhatsApp Desktop** keeps on this Mac. It copies that file into its
  data folder and reads the copy read-only. It is not a linked device, it never talks to WhatsApp's
  servers, it never sends anything and your number is not exposed.
- On the first read, macOS asks whether Molinova may access data from other apps: click **Allow**. If
  you refused by mistake, see **System Settings › Privacy & Security**.
- Only the conversations you tick go to the AI (Molinova scans the others on your Mac only, to show
  which ones mention dates). Their text is sent in chunks of a few hours. Photos, voice notes and
  files stay on disk; captions and document names are sent only if you turn on *Photo captions and
  document names*. Each conversation's WhatsApp identifier is sent too: for a one-to-one chat, that
  is the contact's phone number, which also stands in for the name when the contact has none saved.
- Dates and things to do found in the groups land in *Calendar › To schedule · WhatsApp* and in
  *Actions*.
- If a WhatsApp update changes the database format, Molinova refuses to read it and explains the
  fallback: export the chat from your phone.

### Google Drive (optional)

- In **Channels › Google Drive**, each Google account can allow Molinova to *read* its Drive
  (`drive.readonly`). You enable Google Drive API in your own Google project once, then allow
  reading; your other permissions are asked again at the same time, so nothing is lost.
- **The index**: every 15 minutes, Molinova reads the names, folders and dates of what changed since
  the last read. The index lives in the local database.
- **The cards**, on the *Documents* page, only for the folders you include, and only after you have
  seen the estimated AI cost: Molinova downloads each document to the system's temporary folder, reads
  its text on your Mac (Google's export for Docs, Sheets and Slides; the macOS text layer or OCR for
  PDFs and images, through the bundled `molinova-text` helper; `textutil` for Word, RTF and
  OpenDocument), keeps the first 6,000 characters and deletes the file. That text, with the name,
  folder and dates, goes to Jev, which fills the card. Afterwards, only new documents are classified
  on their own, at most 50 per pass; a bigger batch waits for you, with its cost. A document Jev
  marks as sensitive (identity, health, bank…) keeps its card, but its text is not stored.
- **The search** (Documents page and Telegram) combines the local index and Google's own full-text
  search, then Jev rereads the 10 best results (name, card and up to 1,200 characters of text, none
  for a sensitive document) and keeps those that answer. A relative on Telegram never gets a
  sensitive document unless you allowed it.
- You choose, folder by folder: *Read & file* (read, classified, may later be moved or renamed in
  batches you approve), *Read, don't move* (read and classified, never moved or renamed) or
  *Ignore* (nothing read, no cost). Each folder follows its parent's choice. Photos, Meet
  recordings and notebooks are ignored by default, and so are images (mostly photos).
- Molinova never deletes, never trashes, never changes who can see a document and never changes a
  document's content. A test in the code base fails if such a call ever appears.

### Telegram (optional)

- A private bot that you create with [@BotFather](https://t.me/BotFather). Molinova polls it from your
  Mac, so there is no public URL and no server. It only runs while Molinova is running.
- **It writes to you on its own**, without any AI call: a morning digest, the week ahead on Sunday
  evening, and reminders. Reminders cover a deadline tomorrow, an overdue task, an invoice, an
  unanswered email or something to schedule within 48 h. Each one is sent once, and held back
  during quiet hours.
- **You talk to it.** The commands `/day`, `/week`, `/actions`, `/topay`, `/reply`, `/tasks`,
  `/reminders` and `/help` answer straight from the database, without AI, and cost nothing;
  `/reset` starts a fresh conversation. The French and Spanish names are accepted too. Free text
  goes to the chat model, which can search, read the calendar and add tasks. Creating an event or
  sending a message to a relative always waits for a button tap. Several things in one message
  ("create these 8 appointments") are prepared together and confirmed with a single button.
- **Send it a photo, a PDF or a text file** (a poster, a schedule, an `.ics`): it reads it, says
  what matters (dates, places, amounts) and suggests what to do. Photos sent together are read
  together. The file goes to the chat model only once.
- **Relatives** (your partner, a grandparent) are invited with a QR code. They talk to the bot like
  you do (calendar, tasks, events), never to your mailbox. You link each one to a household member
  and choose what they follow: their own events, a child's, the whole family, or a specific Google
  calendar. Molinova can then send them, each switch on its own: their morning summary, reminders
  before their events, news that concerns them as it happens (with a button to add it; from an
  email they only see the sender and subject) and their week on Sunday. You are told what they add
  or dismiss.
- Only your paired account and the relatives you invited can use the bot; anyone else gets a single
  "This bot is private." reply, then nothing. The bot never sends a whole email: only the sender,
  the subject and one line.

### In the menu bar

Molinova keeps running in the menu bar when you close the window. `Cmd+Q` really quits. The menu shows:

- the mailboxes being watched, the actions waiting, and the WhatsApp and Telegram status;
- the accounts to reconnect, and whether an update is available;
- *Keep awake while plugged in*, *Restart server* and *Quit Molinova*.

The Dock badge counts the actions waiting.

## Requirements

- **A Mac with Apple Silicon** (M1 or later). The app is built for `arm64` only.
- **A Vercel account on the Pro plan.** Molinova only uses models with zero data retention, and that
  option is part of the Pro plan: without it, the gateway refuses the calls. The Pro plan is a paid
  monthly subscription (see [vercel.com/pricing](https://vercel.com/pricing)). AI usage is paid on
  top, from AI Gateway credits you buy in the Vercel dashboard (*AI Gateway*, then the balance button
  at the top right; automatic top-up is available). You pay Vercel directly for what the AI reads
  and writes, counted in tokens (small chunks of text), at the AI providers' list price. The *Tokens
  and costs* page shows where they go.
- **A Google account** (Gmail, and Google Calendar if you want the calendar) and **your own Google
  app**, created in your own Google Cloud project. It is free, and the setup assistant walks you
  through it in about fifteen minutes (see [Your own Google app](#your-own-google-app)).
- Optional: **WhatsApp Desktop** from the Mac App Store, linked to your phone once.
- Optional: **Telegram**, to create and use the bot.

The Mac has to be on, with Molinova running, for the Gmail watch, WhatsApp reading and the bot to work.

## Install

There is no published release yet. Until there is, [build the app
yourself](#until-then-build-the-app-yourself): it takes a few commands in Terminal. Once releases
exist, installing will work like this:

1. Download `Molinova-<version>-arm64.dmg` from the
   [GitHub Releases](https://github.com/kasiopajg/molinova/releases) page.
2. Open it and drag **Molinova** to **Applications**.
3. First launch: Molinova is not registered with Apple (that needs a paid Apple developer account), so
   macOS blocks it the first time. Right-click the app › **Open**, then confirm. On recent macOS
   versions that option is no longer offered: try to open Molinova once, then go to **System Settings ›
   Privacy & Security** and click **Open Anyway**.
4. Molinova keeps your secrets encrypted with its own Keychain item, "Molinova Safe Storage". Every release
   is signed with the same "Molinova" certificate, so macOS normally never asks about it, updates
   included. If it ever does (after building Molinova yourself, for example), enter your Mac password
   and click **Always Allow**. The setup assistant lists every permission macOS or Google will ask
   for, why Molinova needs it, and what it never does with it.

### Until then, build the app yourself

You need the Terminal app (in *Applications › Utilities*).

1. Install [Node.js](https://nodejs.org) (the LTS version, 20.19 or later) and
   [pnpm](https://pnpm.io/installation).
2. Get the code:

   ```sh
   git clone https://github.com/kasiopajg/molinova.git
   cd molinova
   ```

   If macOS offers to install the command line developer tools, accept, then run the command again.
3. Build the app:

   ```sh
   pnpm install
   node node_modules/electron/install.js
   pnpm app:dist
   ```

4. Open `release/Molinova-0.1.0-arm64.dmg` (the number follows the version), from Finder or with
   `open release/Molinova-0.1.0-arm64.dmg`, then continue at step 2 above.

To work on Molinova itself, see [Build from source](#build-from-source).

### The setup assistant

On first launch, Molinova opens a setup assistant with six steps. You can go back to any finished step.

1. **Welcome**
   - What Molinova does, what stays on the Mac and what is sent to the AI.
   - Choose the language: English, French or Spanish.
2. **AI key**
   - On [vercel.com/ai-gateway](https://vercel.com/ai-gateway), sign up or log in.
   - Switch the account to the Pro plan (required, see [Requirements](#requirements)) and add AI
     Gateway credits.
   - In the [dashboard](https://vercel.com/dashboard): *AI Gateway › API Keys › Create Key*.
   - Paste the key and click *Test and save*. Molinova checks it with the gateway, then stores it in the
     macOS Keychain. This check does not cover the plan or the credits.
3. **Google**: your own Google app, so nobody else has access. About fifteen minutes, once, free.
   The assistant guides you screen by screen, with the exact button labels; the same steps are in
   [Your own Google app](#your-own-google-app) below. At the end, drop the downloaded JSON file on
   the assistant, or paste the client ID and secret instead. A "Web application" client is refused.
4. **Gmail**
   - Two options, both ticked by default:
     - *Drafts*: Molinova prepares replies in your Gmail drafts.
     - *Calendar*: Molinova reads your calendars and creates events in a calendar of its own.
   - Click *Connect a Gmail account*. Google opens in your browser:
     1. choose the account;
     2. on "Google hasn't verified this app", click *Advanced*, then *Go to … (unsafe)*: it is your
        own app (the name shown may be your project or your domain rather than "Molinova");
     3. **tick every box**, then *Continue*.
   - Molinova checks the permissions Google actually granted. Without the Gmail box, nothing is
     connected and it asks you to start again; without Drafts or Calendar, the mailbox is connected
     and Molinova tells you what is missing (reconnect it later to add them).
   - You can add more mailboxes here or later, in *Channels › Gmail*.
5. **You**
   - Your name, your email addresses (leave empty to use the connected mailboxes) and your time zone
     (the Mac's time zone is suggested).
   - The rest of the household (for example Léo, Inès and Noé, their schools and clubs) can wait for
     *Settings › Context*.
6. **Always on**
   - *Open Molinova at login* and *Keep the Mac awake while plugged in*. On battery, nothing changes.
   - The Gmail watch pace: off, or every 5, 15 or 30 minutes.
   - Click *Finish*.

Molinova is then ready. With the watch on, new emails are sorted as they arrive. To sort the ones you
already have, start the catch-up from **Home** or *Channels › Gmail*. Start with a short period (a month,
say): each email sorted is a paid AI call, and the labels are written into Gmail. Try *Preview*
first: it sorts the same way (so it costs the same) without touching Gmail, and *Classify the
history* then reuses those results instead of paying again. You can connect Telegram and WhatsApp
later, from *Channels*.

### Your own Google app

Molinova has no server, so it cannot share one Google app between its users: Gmail access
(`gmail.modify`) is a *restricted* Google permission, and a shared app would need a paid yearly
security audit and would make its publisher responsible for every user. Instead, **each user creates
their own Google app**: free, about fifteen minutes, once. Nobody else, not even the author of Molinova,
can use it or see your data. Home Assistant and n8n work the same way. The full reference, kept up to
date with Google's console, is [docs/google-setup.md](docs/google-setup.md).

**Which path?**

- **Personal** (an `@gmail.com` address, or a Google Workspace address without admin rights): steps 1
  to 9.
- **Workspace admin** (the project is created inside your organisation): steps 1, 2, 3 and 4 with the
  audience **Internal**, then 8 and 9. No branding, no publishing, no warning screen, no 7-day expiry.
  On a Workspace account without admin rights, follow the personal path: the administrator may still
  block unverified apps ("This app is blocked").

**The steps** (console labels in English; the assistant also shows the French ones):

1. **Create a project**: [console.cloud.google.com/projectcreate](https://console.cloud.google.com/projectcreate).
   Project name "Molinova", location "No organization" (Workspace admin: your domain), *Create*. If a
   billing prompt appears, skip it: nothing here needs billing. Check that the new project is selected
   in the picker at the top.
2. **Enable the Gmail API**: [Gmail API](https://console.cloud.google.com/apis/library/gmail.googleapis.com) › *Enable*.
3. **Enable the Google Calendar API**: [Google Calendar API](https://console.cloud.google.com/apis/library/calendar-json.googleapis.com) › *Enable*.
4. **Google Auth Platform › Get started**: [console.cloud.google.com/auth/overview](https://console.cloud.google.com/auth/overview).
   Four parts on one page: *App information* (app name "Molinova", your address as user support email) ›
   *Audience*: **External** (Workspace admin: **Internal**) › *Contact information*: your address ›
   *Finish*: tick "I agree to the Google API Services: User Data Policy", *Continue*, then *Create*.
5. **Branding**: [console.cloud.google.com/auth/branding](https://console.cloud.google.com/auth/branding).
   Google requires three links and their domain before publishing. Use Molinova's public pages, or pages
   of your own website, then *Save*:

   | Field | Value |
   |---|---|
   | Application home page | `https://kasiopajg.github.io/molinova/` |
   | Application privacy policy link | `https://kasiopajg.github.io/molinova/privacy.html` |
   | Application terms of service link | `https://kasiopajg.github.io/molinova/terms.html` |
   | Authorized domains › *Add domain* | `kasiopajg.github.io` |

   Molinova's pages are published from `site/` in this repository. If they do not open, the assistant
   tells you and suggests your own website instead.
6. **Data access** (recommended): [console.cloud.google.com/auth/scopes](https://console.cloud.google.com/auth/scopes) ›
   *Add or remove scopes*, paste the scopes below, *Update*, then *Save*:
   `https://www.googleapis.com/auth/gmail.modify`, `https://www.googleapis.com/auth/gmail.compose`,
   `https://www.googleapis.com/auth/calendar.events`,
   `https://www.googleapis.com/auth/calendar.calendarlist.readonly`,
   `https://www.googleapis.com/auth/calendar.app.created`.
7. **Audience**: [console.cloud.google.com/auth/audience](https://console.cloud.google.com/auth/audience) ›
   *Publish app* › "Push to production?" › *Confirm*. The status must read **In production**.
   Without publishing, access expires every 7 days. Right after, a yellow banner says "Your app needs
   verification", and a list of failed brand checks may appear: ignore both. Verification is only for
   apps used by more than 100 people; your own app keeps working unverified.
8. **Clients**: [console.cloud.google.com/auth/clients](https://console.cloud.google.com/auth/clients) ›
   *Create client* › application type **Desktop app** › name "Molinova" › *Create*. In the "OAuth client
   created" dialog, click **Download JSON** *before closing it*: the secret is shown only once. Missed
   it? Open the client and add a new secret, or create a new client.
9. **Give the file to Molinova**: drop the downloaded `client_secret_….json` on the assistant.

**Never click** *Verification center*, *Prepare for verification* or *Submit for verification*
(a paid security assessment), nor *Back to testing* (it brings back the 7-day expiry).

**When something goes wrong** (Molinova shows the same explanations):

| Error | Meaning | Fix |
|---|---|---|
| "Access blocked: … has not completed the Google verification process" / `access_denied` | The app is still in Testing (or you clicked Cancel) | Step 7: publish |
| `redirect_uri_mismatch` | The client is a "Web application" | Step 8 with "Desktop app" |
| `invalid_grant` | App left in Testing (7-day expiry), Google password changed, or access removed | Step 7, then reconnect the mailbox in *Channels › Gmail* |
| `admin_policy_enforced`, "This app is blocked" | The Workspace admin blocks unverified apps | Ask the admin, or use the Workspace-admin path |
| `org_internal` | Audience Internal, account outside the organisation | Use an account of the organisation, or audience External (steps 4 and 7) |
| `invalid_client` | The client was deleted, or its secret changed | Step 8 (new Desktop client), then step 9 |

### Where your data lives

Everything Molinova writes is in `~/Library/Application Support/Molinova`:

| Path | Content |
|---|---|
| `config/` | `settings.json`, `taxonomy.json`, `doc-taxonomy.json`, `rules.json`, `context.json`, `app.json` |
| `data/molinova.sqlite` | the database: emails read, decisions, tasks, usage; `data/whatsapp/` holds the WhatsApp copy |
| `tokens/<email>.json` | your Google sign-in, one file per account (readable only by your macOS user, not encrypted yet) |
| `secrets.bin` | the AI key, the Google client and the Telegram token, encrypted with the macOS Keychain |
| `logs/` | `main.log` (the app) and `server.log` (the local server) |

This folder is hidden in Finder: choose **Go › Go to Folder…** (Shift-Cmd-G) and paste
`~/Library/Application Support/Molinova`.

### Updating and uninstalling

- **Updating**: Molinova checks GitHub for a newer release once a day. When there is one, the menu bar
  shows *Update available*. There is no auto-update. Quit Molinova and replace the app with the one from
  the new `.dmg`; your data folder is kept. macOS may block the new version like the first time.
  It may also ask whether Molinova can use its Keychain item: choose *Always Allow*.
- **Uninstalling**:
  - Quit Molinova from the menu bar, then delete `/Applications/Molinova.app` and the data folder: in
    Finder, choose **Go › Go to Folder…** (Shift-Cmd-G), paste `~/Library/Application Support/Molinova`,
    then move that folder to the Trash.
  - Optionally, delete "Molinova Safe Storage" in Keychain Access, remove your Google app from your
    Google account's third-party connections
    ([myaccount.google.com/permissions](https://myaccount.google.com/permissions)), and delete the
    bot with @BotFather.

## Privacy and security

The details are in [SECURITY.md](SECURITY.md). In short:

- **What stays on your Mac**: the database, settings, context, rules and logs. There is no Molinova
  server on the internet, no Molinova account and no telemetry. The interface's fonts and scripts ship
  with the app: they are not loaded from the internet.
- **Who Molinova talks to**:
  - Google (Gmail, Calendar and, if you connect it, Drive APIs);
  - Vercel AI Gateway;
  - Telegram, if you set up the bot;
  - GitHub, once a day, to check for a new release.
- **What goes to the AI**, only through your own Vercel AI Gateway key, with zero data retention
  requested on every call:
  - for each email (except those covered by a *Without Jev* rule): the sender, subject, date, a few
    flags and the beginning of the body (1,500 characters, without quoted history or signature),
    with your category definitions and the context they need. As examples, it also carries the
    sender and subject of emails you corrected (up to 8 per category), plus your name, your
    standing instructions and the household context (a key person's name and relation, the
    children's names, schools and activities);
  - for an email in which Jev spots a date or a task, its text (up to 5,000 characters, cleaned the
    same way), so that the writer model can extract the event or the task; this happens on its own,
    without a click;
  - the text of the WhatsApp conversations you ticked, with each conversation's identifier (for a
    one-to-one chat, the contact's phone number), and the captions and document names if you
    turned that option on;
  - your free-text messages to the Telegram bot (and those of relatives set to *talks to the bot*),
    the photos, PDFs and text files you send it, with what the chat reads to answer: email and
    WhatsApp excerpts, calendar events, tasks and the household context;
  - when you ask for a draft or an event from an email, the email concerned (and, for drafts, up to
    15 excerpts of your sent emails as tone examples);
  - for each Google Drive document you have Molinova classify (see
    [Google Drive](#google-drive-optional)): its name, folder, dates and the first 6,000 characters
    of its text, identity documents included; for a document search, the request and the 10 best
    results (card and up to 1,200 characters of text, none for a sensitive document).
- **Secrets**:
  - In the app, the AI key, the Google client and the Telegram token are in `secrets.bin`,
    encrypted with Electron `safeStorage`, whose key sits in the macOS Keychain item "Molinova Safe
    Storage".
  - Your Google sign-ins (`tokens/`) are files readable by your macOS user only; encrypting them is
    planned.
  - In development, the secrets are in `.env.local` (plain text, mode 0600 when Molinova writes it).
- **Local server**: it listens on `127.0.0.1` only, and answers the interface only:
  - every `/api/` request needs the session key, a random value the app creates at each launch and
    hands to its window as an `HttpOnly`, `SameSite=Strict` cookie; another macOS account or another
    app on the Mac cannot use the server;
  - it checks `Host` on every request (against DNS rebinding), refuses `/api/` requests that a
    browser marks as coming from another site, and on every write requires a JSON `Content-Type`
    and, when the browser sends one, the right `Origin`.
- **Google permissions**:
  - `gmail.modify`, always: read, label, archive, mark as read, and send the replies, forwards and
    follow-ups you click Send on (Google's scope allows sending; Molinova only sends on your click);
  - `gmail.compose`, only with the Drafts option;
  - `calendar.events`, `calendar.calendarlist.readonly` and `calendar.app.created`, only with the
    Calendar option;
  - `drive.readonly`, only for the accounts you connect in Channels › Google Drive: read-only;
  - they go to **your own** Google app (see [Your own Google app](#your-own-google-app)): no one
    else holds a client that can reach your mailbox. Molinova stores the permissions Google actually
    granted, and you can withdraw them at any time at
    [myaccount.google.com/permissions](https://myaccount.google.com/permissions).
- **What Molinova does on its own**: it applies its `AI/…` labels. If you set up the Telegram bot, it
  also sends you the digests and reminders on its own, and the Sunday summary to the relatives you
  turned it on for; the chat can add a task directly. Everything else waits for your click: sending
  an email, archiving, marking as read, creating or deleting a calendar event, messaging a relative.
  It **never deletes an email**, and it never pays or moves money.

Found a vulnerability? Report it privately as described in [SECURITY.md](SECURITY.md), not in a
public issue.

## Build from source

Requirements:

- macOS;
- Node.js 20.19 or later (CI uses Node 22);
- [pnpm](https://pnpm.io) (CI uses pnpm 10);
- Xcode Command Line Tools: `swiftc` builds the `molinova-text` helper (PDF text and OCR) for the app,
  and they also build `better-sqlite3` if it has no prebuilt binary for your setup.

### Run in development

From a clone of the repository:

```sh
pnpm install
pnpm ui      # local server on http://127.0.0.1:4310, opens your browser with its session key
pnpm dev     # same, restarts on every change, does not open the browser: use the link it prints
pnpm ea      # command-line interface: lists its commands
```

- The server only answers a browser that came through the link it prints (`/?molinova_key=…`), which
  sets the session cookie. In development the key is kept in `data/session.key`, so the link stays
  the same from one start to the next.
- The same setup assistant runs in the browser. In development, it writes the secrets to
  `.env.local` in the data folder. You can also copy `.env.example` to `.env.local`, run
  `chmod 600 .env.local` so that only you can read it, and fill it in yourself.
- **The data folder is the repository itself** (the generated files in `config/`, plus `data/`,
  `tokens/`, `credentials/`, `logs/` and `.env.local`, are all in `.gitignore`), unless `MOLINOVA_HOME`
  is set. To experiment without touching real data:

  ```sh
  MOLINOVA_HOME=/tmp/molinova-test MOLINOVA_PORT=4391 pnpm dev   # then open the link it prints
  ```

### Build the macOS app

```sh
node node_modules/electron/install.js   # once: pnpm does not run Electron's download script
pnpm app:dev                            # build + native:electron + native:text + electron .
pnpm app:dist                           # build + native:electron + native:text + electron-builder
```

- `pnpm app:dist` writes `release/Molinova-<version>-arm64.dmg` and `release/mac-arm64/Molinova.app`. The
  app has an ad-hoc signature and is not notarized.
- `pnpm app:dev` uses your real `~/Library/Application Support/Molinova` unless `MOLINOVA_HOME` is set. To
  test on a throwaway folder:

  ```sh
  MOLINOVA_HOME=/tmp/molinova-app MOLINOVA_PORT=4392 MOLINOVA_NO_LOGIN_ITEM=1 MOLINOVA_NO_UPDATE_CHECK=1 pnpm app:dev
  ```

  The development Electron and Molinova.app share the Keychain item "Molinova Safe Storage", so macOS asks
  once which one may read it.
- The other scripts:
  - `pnpm build` compiles `src/` → `dist/` and `desktop/` → `dist-desktop/`.
  - `pnpm native:electron` builds the `better-sqlite3` binary for Electron in `build/native/`.
  - `pnpm native:text` compiles `native/molinova-text` (Swift: PDF text, macOS OCR, page previews) into
    `build/native/`.
  - `pnpm icons` regenerates the icons from `build/*.svg`.
- Releases: pushing a tag `v<version>` that matches `package.json` runs
  `.github/workflows/release.yml`. The workflow builds the `.dmg`, checks the signature and the
  Electron fuses, and creates a draft GitHub Release.

### Checks

All three must pass before a pull request:

```sh
pnpm typecheck   # TypeScript
pnpm test        # Vitest; tests never call real services
pnpm i18n        # translation dictionaries complete (fr, en, es)
```

### Environment variables

| Variable | Meaning |
|---|---|
| `AI_GATEWAY_API_KEY` | Vercel AI Gateway key |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Google OAuth client of the "Desktop app" type. The legacy alternative is `credentials/google-oauth.json` in the data folder. |
| `TELEGRAM_BOT_TOKEN` | optional, the bot token from @BotFather |
| `MOLINOVA_HOME` | the data folder. Default: the repository in development, `~/Library/Application Support/Molinova` for the app and `pnpm app:dev`. |
| `MOLINOVA_PORT` | the local server port. Default: `4310`. The app uses 4310 when it is free, otherwise another free port. |
| `MOLINOVA_NO_LOGIN_ITEM=1` | the app never registers itself as a login item (tests) |
| `MOLINOVA_NO_UPDATE_CHECK=1` | the app skips the daily GitHub release check (tests) |

- **The secrets** (`AI_GATEWAY_API_KEY`, `GOOGLE_CLIENT_*`, `TELEGRAM_BOT_TOKEN`): in development
  they are read from `.env.local` in the data folder (see `.env.example`); in the app they are in
  the Keychain. In development, variables already set in the environment win over `.env.local`. The
  app ignores them and uses only the Keychain values.
- **The `MOLINOVA_*` variables** go in your shell. In particular, `MOLINOVA_HOME` cannot be set from
  `.env.local`, since that file is read from the data folder.

### Project layout

| Path | Content |
|---|---|
| `src/` | local server and CLI (TypeScript, ESM): Gmail, Calendar, Drive and WhatsApp connectors, classification, documents, Telegram bot, server strings (`src/i18n/`) |
| `ui/` | the interface, plain JavaScript without a build step; dictionaries in `ui/lang/<fr\|en\|es>/` |
| `desktop/` | the Electron main process and preload |
| `native/molinova-text/` | the Swift helper that reads PDFs and images (text layer, OCR) and renders previews |
| `site/` | the public pages (home, privacy, terms) published on GitHub Pages |
| `docs/` | the Google setup guide and the macOS app's architecture |
| `config/context.example*.json` | templates for the household context |
| `scripts/` | i18n check, native module build, icons |

Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request. The macOS app's architecture
(run modes, paths, secrets, setup routes, packaging) is described in
[docs/desktop-app.md](docs/desktop-app.md).

## License

[MIT](LICENSE) © 2026 Kasiopa SAS. Third-party software and its licenses are listed in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
