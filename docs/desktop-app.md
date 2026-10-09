# Molinova desktop app — architecture contract

This document is the single source of truth for how the Molinova macOS app (Electron) and the existing
Node server (`src/server.ts`) fit together. Every change to the paths, secrets, messages or routes
below must update this file.

## Two run modes

| | Dev mode (`pnpm ui`, `pnpm dev`, `pnpm ea`) | App mode (Molinova.app) |
|---|---|---|
| Started by | a terminal, `tsx src/server.ts` | Electron main process, `utilityProcess.fork(dist/server.js)` |
| `MOLINOVA_APP` | unset | `"1"` |
| `MOLINOVA_HOME` (writable data) | unset → the repository root (`ROOT`) | `~/Library/Application Support/Molinova` (`app.getPath("userData")`) |
| `MOLINOVA_PORT` | unset → `4310` | a free port chosen by main (4310 preferred) |
| `MOLINOVA_SESSION_KEY` | unset → `HOME/data/session.key` (created once, 0600) | a random key created by main at each launch |
| Secrets live in | `HOME/.env.local` (plain text, 0600 when Molinova writes it) | `HOME/secrets.bin`, encrypted with Electron `safeStorage` (macOS Keychain) |
| Browser | `open(url/?molinova_key=…)` unless `--no-open`; the link is also printed | always `--no-open`; the app window loads `http://127.0.0.1:PORT/?molinova_key=…` |

## Paths (`src/config.ts`)

- `ROOT` — directory that contains `ui/`, `config/*.example*.json` and the compiled code. Read-only in app mode (inside the app bundle).
- `HOME` — `process.env.MOLINOVA_HOME ? path.resolve(MOLINOVA_HOME) : ROOT`. Everything the app writes lives here.
- `PATHS`:
  - `config` = `HOME/config` (settings.json, taxonomy.json, rules.json, context.json, app.json) — created at startup
  - `examples` = `ROOT/config` (read-only `context.example*.json` templates)
  - `data` = `HOME/data`, `tokens` = `HOME/tokens` (0700), `credentials` = `HOME/credentials` (0700), `logs` = `HOME/logs`. The 0700 mode is also applied (`chmod`) to existing `tokens`/`credentials` folders at startup.
  - `db` = `HOME/data/molinova.sqlite`.
- `APP_MODE` = `process.env.MOLINOVA_APP === "1"`.
- `.env.local` is loaded from `HOME/.env.local` (never overrides variables already set).
- Without `HOME/config/context.json`, `loadContext()` reads `PATHS.examples/context.example.<lang>.json` and replaces its time zone with the system one (`Intl.DateTimeFormat().resolvedOptions().timeZone`), which is also the schema default.
- `postToMain(message)` (config.ts) posts to `process.parentPort` in app mode only; it returns `false` otherwise.

## Secrets (`src/secrets.ts`)

Known names: `AI_GATEWAY_API_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `TELEGRAM_BOT_TOKEN`.

- The single read path stays `process.env[name]` (the AI Gateway SDK reads `AI_GATEWAY_API_KEY` lazily on every request, so a key set at runtime takes effect immediately).
- `getSecret(name)`, `secretSource(name): "keychain" | ".env.local" | "env" | null` (app mode: any set value is `"keychain"`; dev mode: `".env.local"` when the file holds that exact value, else `"env"`).
- `/api/connections` reports `gateway.keySource`, `google.secretsSource` (`secretSource` or `"file"` for the legacy JSON) and `telegram.tokenSource` (`secretSource` or `"kv"` for the legacy database copy).
- `setSecret(name, value | null): boolean`: persists, then updates `process.env` (so a value `.env.local` refuses — newline, both quote kinds — throws and changes nothing, not even in memory):
  - app mode → `process.parentPort.postMessage({ type: "molinova:secret", name, value })`; main encrypts and rewrites `secrets.bin`. Returns `false` when there is no main process (value kept in memory only).
  - app mode with `MOLINOVA_SECRETS_OK=0` (main found safeStorage unavailable or `secrets.bin` undecryptable at spawn, see Electron main › Secrets) → throws `secret.unavailable` (HTTP 503) and changes nothing: the routes that save a secret answer that error instead of a false success, `migrateTgToken` keeps the kv row, and `POST /api/setup/import` is refused up front (`setup.importNoKeychain`). `secretsWritable()` exposes the flag.
  - dev mode → upserts / removes the `NAME=value` line in `HOME/.env.local` (file mode 0600).
- At spawn, main decrypts `secrets.bin` and passes the values as environment variables of the server process.
- Google OAuth client: env pair `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` first, legacy file `HOME/credentials/google-oauth.json` second.
- Telegram token: env first, legacy kv `tg.token` second; the UI now stores it through `setSecret` (and deletes the kv copy). `migrateTgToken(db)` (channels/telegram.ts) moves a legacy kv copy into the secrets (unless one is already set) and deletes the row; it runs when the server starts listening (before the bot starts) and at the end of an import. The row is kept only if the secret could not be persisted.
- OAuth refresh tokens stay in `HOME/tokens/<email>.json` (0600). Encrypting them is future work (see SECURITY.md).

## Server ⇄ main messages (app mode only, `process.parentPort`)

Server → main:
- `{ type: "molinova:ready", port }` — after `server.listen` succeeded.
- `{ type: "molinova:secret", name, value }` — persist a secret (`value: null` = delete).
- `{ type: "molinova:app-settings", settings }` — apply app settings (see below) at once.
- `{ type: "molinova:restart" }` — ask main to restart the server process (used after an import).

Main → server: nothing. Main reads state over HTTP (below). The environment at spawn carries `MOLINOVA_SECRETS_OK`
(`"1"` / `"0"`, see Secrets); a write that fails later in main (after a healthy spawn) is not reported back to the
request, which has already answered: main shows a notification and the next spawn gets `MOLINOVA_SECRETS_OK=0` if the
problem persists.

## App settings (`HOME/config/app.json`)

`{ openAtLogin: boolean (default true), preventSleep: boolean (default true, only on AC power), closeToTray: boolean (default true) }`

- `GET /api/app/settings` → current values (defaults if the file is missing).
- `PUT /api/app/settings` (partial JSON) → validates, writes the file, posts `molinova:app-settings` to main.
- Main reads `app.json` itself at startup (same `HOME`), then follows the messages.

## Status for the menu bar (`GET /api/app/status`)

Cheap (no network call): `{ version, appMode, setupComplete, accounts, watching, actions, review, whatsapp: { enabled, lastIngestAt, error }, telegram: { enabled, running, error }, tokenErrors: string[] }`.
`version` = `MOLINOVA_VERSION` if main passes it, else `ROOT/package.json`. `actions` = the Actions queue count (same as the nav badge), `review` = emails to sort (uncertain label; not part of `actions` since 2 Oct 2026). `tokenErrors` = Gmail accounts to reconnect (token file missing, or last job failed with `invalid_grant` / `unauthorized_client` / `invalid_client` — `isAuthError` in jobs.ts; a running job's `lastError` is checked too). A watch ends with status `error` on such an auth error instead of retrying forever. The messages behind it (`gmail.errInvalidGrant`, `gmail.noToken`) give the probable cause and fix: app left in Testing (publish it, step 7 of `docs/google-setup.md`) or Google password changed, then reconnect.
Main polls it every 60 s for the tray menu and the Dock badge (`actions`).

## First-run setup (the "launcher")

`GET /api/setup/state` →
`{ complete, appMode, steps: { gateway, google, account, context, finished } }`

- `gateway` = `AI_GATEWAY_API_KEY` set; `google` = OAuth client available; `account` = at least one Gmail account with a token; `context` = `HOME/config/context.json` exists; `finished` = kv `setup.finished`.
- `complete = finished || (gateway && google && account && context)` — existing installs (they all have a `context.json`) are never pushed back into the wizard, while a new install reloaded right after connecting Gmail stays in it.

Errors: every route answers an error as `{ error, code? }` with the HTTP status of the error (500 by default).
`error` is the translated message (unchanged for existing callers); `code` is the i18n key used to raise it
(`fail()` in server.ts, `setup.*` from `parseGoogleClient`, `gmail.*` from the Google sign-in) and is omitted
for errors that are not dictionary keys (Node `ENOENT`, Google HTTP codes, raw library errors). The value is
checked with `keyOf()` (`src/i18n/index.ts`).

Routes (all JSON, all through the existing HTTP guard; every setup route answers with the new `state`, except `pages-online`):
- `POST /api/setup/gateway-key { key }` → validates the key against the AI Gateway (credits call with that key) → `setSecret`. Errors: invalid key, network.
- `POST /api/setup/google-client { json } | { clientId, clientSecret }` → accepts the downloaded Google JSON (`installed` = Desktop app; `web` refused with a clear message) → `setSecret` both values. A client ID different from the current one while Gmail accounts have tokens → 409 `setup.googleReplace` (their refresh tokens belong to the old client) unless the body has `replace: true`; the wizard asks for confirmation, resends with `replace`, then sends the user to the Gmail step to reconnect each mailbox.
- `GET /api/setup/pages-online` → `{ online: boolean, home, privacy, terms, domain }`: Molinova's public pages (`MOLINOVA_PAGES` in `src/config.ts`: `https://kasiopajg.github.io/molinova/`, `…/privacy.html`, `…/terms.html`, domain `kasiopajg.github.io`), the three links and the authorized domain Google's Branding page needs (step 5 of `docs/google-setup.md`). `online` = a `HEAD` on `home` (then a `GET` if `HEAD` is not 2xx) answered 2xx within 4 s; cached 10 min when online, 2 min when not; never fails (no network = `false`). `false` while the repository is private: the wizard then suggests the user's own website.
- `POST /api/accounts/add { drafts?, calendar? }` (existing) → connects a Gmail account (first one or more). The OAuth redirect URI is local to each call; the one-shot listener closes after 5 minutes, when a new `/accounts/add` starts, or on `POST /api/accounts/add/cancel` (the wizard's Cancel button).
  - **Granted scopes**: Google's consent screen has one checkbox per scope. Molinova compares the requested scopes with `tokens.scope` from the token exchange (`analyseGrantedScopes` in `src/connectors/gmail.ts`, pure, unit-tested) and stores the **granted** list as `scopes` in `HOME/tokens/<email>.json` (read back by `scopesForAccount`). Without `tokens.scope` (older libraries) the requested list is used, as before.
  - `gmail.modify` not granted → HTTP 400 `{ error, code: "gmail.missingMailScope" }`; no token is written and no account is created (an already-connected mailbox keeps its previous token; the grant is not revoked, since that would also cut the existing token of the same user and client).
  - Drafts or Calendar requested but not granted → the account is connected anyway with the granted scopes; the answer is the account row plus `missingScopes: ("drafts" | "calendar")[]` and `warnings: string[]` (one translated message per missing option, `gmail.missingDrafts` / `gmail.missingCalendar`). Both arrays are always present (empty when everything was granted). A calendar option counts as missing when any of its three scopes is.
  - **Google errors** (`?error=` on the loopback redirect, or the token exchange's `error`) are translated with their fix and a reference to the steps of `docs/google-setup.md` (`googleAuthError` / `oauthErrorCode` in gmail.ts), HTTP 400 with `code`: `access_denied` → `gmail.errAccessDenied` (Cancel, or app still in Testing → step 7), `redirect_uri_mismatch` → `gmail.errRedirectUri` (Web client → step 8), `admin_policy_enforced` → `gmail.errAdminPolicy`, `org_internal` → `gmail.errOrgInternal`, `invalid_client` → `gmail.errInvalidClient` (steps 8–9), `invalid_grant` → `gmail.errInvalidGrant` (step 7, then reconnect). The browser tab shows the same explanation (HTML-escaped). Other errors keep their original message.
  - Later Gmail calls refused with `invalid_grant` / `invalid_client` (token refresh) are rethrown with the same translated messages; they keep the raw code in the text, so `isAuthError` (jobs.ts) and `tokenErrors` still recognise them.
- `POST /api/setup/context { name, emails[], timezone, language }` → creates/updates `context.json` (existing fields kept) and the language setting (through the same path as a language change in Settings, so default category names follow). `emails` empty → the connected Gmail addresses; `timezone` empty → the system one. The wizard's "Skip" on this step posts a minimal context (typed name, else one guessed from the Gmail address; `emails` and `timezone` empty) so the example owner is never used for real mail; it only navigates when `context.json` already exists.
- `POST /api/setup/finish { watchEvery?: seconds | null }` → kv `setup.finished = true`; if `watchEvery`, starts the Gmail watch on every connected account (persisted, see below).

## Gmail watch survives restarts

- `accounts.watch_every` (seconds) is stored next to `accounts.watch_since` when a watch starts; stopping a watch from the UI clears both.
- When the server starts listening, it restarts a watch for every Gmail account whose `watch_since` and `watch_every` are set and whose token exists (pure selection: `watchesToResume` in jobs.ts). A `watch_since` without `watch_every` predates this feature and may belong to a watch stopped long ago (stopping did not clear it then): it is not resumed. A failure on one account is logged and does not stop the others. The watch's preparation (Gmail labels, first `history_id`) runs inside its retry loop: a network error at login (Wi-Fi not up yet) is recorded in `lastError` and retried on the next pass, like any error after that.
- WhatsApp: off macOS, `wa.status()` reports `supported: false` with `appInstalled`/`dbFound` false (no `pgrep`); `/api/connections` passes `whatsapp.supported` too, and the UI shows "macOS only" in Sources and Settings › Connections.

## Electron main (`desktop/`)

Source in `desktop/*.ts`, compiled by `tsconfig.desktop.json` to `dist-desktop/` (`main.js` is ESM; the preload is
`preload.cts` → `preload.cjs`, because sandboxed preloads cannot be ESM). `package.json` `"main"` = `dist-desktop/main.js`.

| File | Role |
|---|---|
| `main.ts` | lifecycle, window, native menus, tray, IPC, power, login item, update check |
| `server-process.ts` | port choice, `utilityProcess.fork`, logs, restarts |
| `secrets.ts` | `HOME/secrets.bin` (safeStorage) |
| `logs.ts` | rotating logs (5 MB, 3 files) |
| `i18n.ts` | main-process strings in fr / en / es (language = `HOME/config/settings.json` `language`, else the system) |
| `version.ts` | semver comparison for the update check |
| `preload.cts` | `window.molinova` + `<html class="molinova-app">` |

- **Folders**: `app.setName("Molinova")`; `HOME = MOLINOVA_HOME || ~/Library/Application Support/Molinova`; `userData` is set to `HOME`
  (so the single-instance lock is per `HOME`: a test instance never collides with the real app) and `sessionData`
  (Chromium cache, cookies, localStorage) to `HOME/Chromium`. `HOME/logs/main.log` = main process log (port, restarts,
  secrets written — names only, never values).
- **Single-instance lock**; a second launch (or a Dock click) shows and focuses the window.
- **Port**: `MOLINOVA_PORT` if set (tests), else 4310, else any free port on 127.0.0.1; a restart keeps the current port when free.
- **Server**: `utilityProcess.fork(<app>/dist/server.js, ["--no-open"], { cwd: HOME, stdio: "pipe", env })` — the ESM entry
  loads directly from `app.asar` (checked with Electron 44). `env` = the inherited environment minus the four secret names
  and `ELECTRON_RUN_AS_NODE`, plus `MOLINOVA_APP=1`, `MOLINOVA_HOME`, `MOLINOVA_PORT`, `MOLINOVA_VERSION` (`app.getVersion()`),
  `MOLINOVA_SQLITE_BINDING`, `MOLINOVA_SECRETS_OK` and the secrets decrypted from `secrets.bin` (re-read at every spawn). stdout/stderr →
  `HOME/logs/server.log` (rotated at 5 MB: `server.log`, `.1`, `.2`).
- **Restarts**: an unexpected exit restarts the server after 1 s, doubling up to 30 s (back to 1 s after 60 s of uptime).
  5 crashes within 5 minutes → native notification, the window shows "could not start" with the log path, and no more
  retries until the tray's "Restart server" (a window opened meanwhile shows the same "could not start" page).
  `molinova:restart` = stop (SIGTERM, SIGKILL after 5 s) then start. `stop()` also cancels a scheduled retry and a start
  still choosing its port; a child forked but not yet spawned (no pid) is killed on its `spawn` event, and the pid for
  SIGKILL is read when the 5 s timer fires.
- **Quit** (Cmd+Q, tray Quit, SIGTERM/SIGINT): `before-quit` always calls `stop()` and waits (preventDefault) only while
  a server process exists.
- **Secrets**: `HOME/secrets.bin` = `safeStorage.encryptString(JSON.stringify({ NAME: value }))`. `molinova:secret` is accepted
  only for the four known names with a `string | null` value; written atomically (temporary file 0600 + rename).
  Before every spawn main checks the store: `unavailable` (`safeStorage.isEncryptionAvailable()` false — Keychain prompt
  denied, e.g. after an update of the ad-hoc-signed app) or `unreadable` (`secrets.bin` no longer decrypts — "Molinova Safe
  Storage" reset). Either one → `MOLINOVA_SECRETS_OK=0`, a notification, and a tray line "⚠︎ …" whose dialog offers
  "Retry" (unavailable: restart the server, which re-checks) or "Reset saved keys" (unreadable: `secrets.bin` renamed to
  `secrets.bin.bad`, or `secrets.bin.bad-<ms>` if that exists, then restart). A failed write in main is logged (names
  only) and notified.
- **Window**: 1280×820 (min 960×600), `titleBarStyle: "hiddenInset"`, shown on `ready-to-show`, `contextIsolation`,
  `sandbox`, no `nodeIntegration`. A local `data:` page ("Starting Molinova…") until `molinova:ready`, then
  `http://127.0.0.1:PORT` (reloaded on every `molinova:ready`, i.e. after each restart). Closing hides it when `closeToTray`.
  `setWindowOpenHandler` always denies new windows; `will-navigate` blocks any main-frame URL outside
  `http://127.0.0.1:PORT`; `will-frame-navigate` does the same for subframes (the e-mail iframe: a `target="_self"` link
  or a nested remote iframe), allowing only `about:blank`, `about:srcdoc`, `data:` and the local origin. All three open
  the URL with `shell.openExternal` only for `https:`, `http:` and `mailto:` (links in e-mails included). The e-mail
  iframe's CSP also has `frame-src 'none'`.
- **Preload** (`window.molinova`): `{ isApp: true, version, openExternal(url): Promise<boolean> }`.
  `version` comes through `webPreferences.additionalArguments` (`--molinova-version=`). The IPC handler
  (`molinova:openExternal`) checks that the sender frame is on `http://127.0.0.1:PORT`;
  `openExternal` returns `false` for anything but http(s)/mailto.
- **Native menus**: app menu (About, Settings… Cmd+, → `#settings`, Services, Hide, Quit), Edit (role menu: undo, redo,
  cut, copy, paste, select all — needed for inputs), View (Reload, DevTools only when not packaged, zoom, full screen), Window.
- **Tray** (template image `trayTemplate.png` + `@2x`): menu rebuilt every 60 s and after each message from
  `GET /api/app/status` (Node `fetch`, so `Host: 127.0.0.1:PORT`): setup not finished, Gmail accounts watched, actions
  waiting, WhatsApp last read / error (when enabled), Telegram bot running / stopped (when enabled), one "Reconnect <email>"
  line per `tokenErrors` entry, the available update; then Open Molinova, "Keep awake while plugged in" (checkbox →
  `PUT /api/app/settings { preventSleep }` with `Content-Type: application/json`), Restart server, Quit.
  Dock badge = `actions` (empty at 0). A native notification when `tokenErrors` gains an address.
- **Power**: `powerSaveBlocker.start("prevent-app-suspension")` only while `preventSleep` and on AC power
  (`powerMonitor.isOnBatteryPower()`, `on-ac` / `on-battery`); re-evaluated on `molinova:app-settings`.
- **Login item**: `app.setLoginItemSettings({ openAtLogin })` only when `app.isPackaged`, the status says `setupComplete` and
  `MOLINOVA_NO_LOGIN_ITEM !== "1"`; applied after each status poll and on `molinova:app-settings`.
- **Update check**: on start and every 24 h, `GET https://api.github.com/repos/kasiopajg/molinova/releases/latest` (no token);
  a newer, non-draft `tag_name` puts "⬆︎ Update available: vX → open release page" (its `html_url`) first in the tray menu,
  shows one macOS notification per version (remembered in `HOME/config/update-notified`), and sends `molinova:update` to
  the window: a banner at the top of every screen ("Download", or "Later" for three days) and a line in Settings
  (`window.molinova.getUpdate()` / `onUpdate()`). Errors and 404 (private repository) are silent.
  `MOLINOVA_NO_UPDATE_CHECK=1` disables it (tests). No auto-update: the app is not notarized.

### SQLite: one `node_modules`, two ABIs

- The dev server (Node ≥ 20.19, tsx, vitest) uses `node_modules/better-sqlite3/build/Release/better_sqlite3.node` as installed
  by pnpm. It is never rebuilt in place.
- `pnpm native:electron` (`scripts/native-electron.mjs`) copies the package to a temporary folder, tries the official
  prebuild (`prebuild-install --runtime electron --target <electron version>`), else compiles it with `@electron/rebuild`
  (Electron headers, node-gyp), and writes `build/native/darwin-<arch>/better_sqlite3.node` + a stamp
  (`better_sqlite3.json`: Electron and better-sqlite3 versions; up to date → nothing to do; `--force` rebuilds). It then
  opens an in-memory database with that binary under `ELECTRON_RUN_AS_NODE=1` to prove it loads.
- Main sets `MOLINOVA_SQLITE_BINDING` = `Resources/native/better_sqlite3.node` (packaged) or
  `build/native/darwin-<arch>/better_sqlite3.node` (dev; a missing file → error dialog asking for `pnpm native:electron`).
- Server side, every `new Database(...)` goes through `sqliteOptions(options)` (`src/db.ts`), which adds
  `{ nativeBinding: MOLINOVA_SQLITE_BINDING }` when the variable is set (`src/db.ts`, `src/connectors/whatsapp.ts` and the
  import's legacy-database read in `src/server.ts`; the import falls back to a raw file copy only on
  `SQLITE_CANTOPEN*` / `SQLITE_READONLY*`, any other error fails the import). As a fallback, the packaged app also carries the
  Electron binary at the standard `node_modules/better-sqlite3/build/Release/better_sqlite3.node` path (the Node binary,
  the C sources and `deps/` are excluded), so a `new Database()` without the option still loads.

### Build and packaging

- `pnpm build` = clean + `tsc -p tsconfig.build.json` (`src/` → `dist/`, without `*.test.ts` and `src/test-home.ts`) +
  `tsc -p tsconfig.desktop.json`. `ROOT` (`src/config.ts`) = `dist/..` = the app root: the repository in dev,
  `Molinova.app/Contents/Resources/app.asar` in the app (read through Electron's asar support).
- `pnpm icons` (`scripts/make-icons.sh`): `build/icon.svg` and `build/trayTemplate.svg` rendered by the project's Electron
  (`scripts/render-svg.mjs`, transparent background — `qlmanage` paints an opaque white one), then `sips` + `iconutil` →
  `build/icon.png`, `build/icon.icns`, `build/trayTemplate.png` (18 px), `build/trayTemplate@2x.png` (36 px). Outputs are committed.
- `pnpm app:dev` = build + native:electron + `electron .`. **It uses the real `~/Library/Application Support/Molinova` unless
  `MOLINOVA_HOME` is set**; for tests: `MOLINOVA_HOME=/tmp/… MOLINOVA_PORT=43xx MOLINOVA_NO_LOGIN_ITEM=1 MOLINOVA_NO_UPDATE_CHECK=1 pnpm app:dev`.
  Dev Electron and Molinova.app share the Keychain item "Molinova Safe Storage" but not the code signature: macOS asks once
  which app may read it. Tests add `--use-mock-keychain` (a Chromium switch) to keep the Keychain untouched.
- `pnpm app:dist` = build + native:electron + `electron-builder --mac dmg --arm64 --publish never` (`electron-builder.yml`):
  `release/Molinova-<version>-arm64.dmg` and `release/mac-arm64/Molinova.app`. `npmRebuild: false`, `asar: true` (`*.node`
  unpacked), whitelist `files` (`dist/`, `dist-desktop/`, `ui/`, `config/context.example*.json`, `package.json`,
  `LICENSE`, `THIRD_PARTY_NOTICES.md`, production `node_modules`) with explicit exclusions of every private file of the
  repository (`config/{context,settings,taxonomy,rules,app}.json`, `data/`, `tokens/`, `credentials/`, `.env*`, `logs/`,
  `ideas/`, `PLAN-*`, `.backup-*`, tests, sources, docs, scripts). `extraResources`: the Electron SQLite binary
  (`native/better_sqlite3.node`), the tray images, and Electron's license notices (`node_modules/electron/dist/LICENSE`
  → `Resources/LICENSE.electron.txt`, `LICENSES.chromium.html` → `Resources/LICENSES.chromium.html`; electron-builder
  deletes them from the mac bundle otherwise). Electron fuses (`electronFuses`): `runAsNode`,
  `enableNodeOptionsEnvironmentVariable`, `enableNodeCliInspectArguments` off; `onlyLoadAppFromAsar`,
  `enableEmbeddedAsarIntegrityValidation`, `enableCookieEncryption` on — no other process can run code as Molinova (which
  would bypass the Keychain protection of `secrets.bin` and Molinova's privacy grants). Ad-hoc signature (`identity: "-"`,
  no hardened runtime — without a Team ID, library validation would refuse the SQLite addon —, no notarization): the
  first launch needs right-click → Open (or System Settings → Privacy & Security → Open Anyway).
  Chromium locales limited to en / fr / es. No `publish` provider, no `app-update.yml`.
- An ad-hoc signature changes with every build, so macOS treats each new build as another app and asks again for
  "Molinova Safe Storage". For a developer's own Mac: `pnpm app:cert` creates once a self-signed code-signing certificate
  "Molinova Local Signing" in the login keychain (no trust settings touched; `codesign` added to the key's ACL), and
  `pnpm app:install` quits Molinova, keeps the installed app in `~/Library/Application Support/Molinova Backups/Molinova-previous.app`,
  copies `release/mac-arm64/Molinova.app` to `/Applications`, re-signs it `--deep` with that certificate when present
  (designated requirement = bundle id + certificate leaf, stable across builds) and relaunches it. Allow the Keychain
  prompt once with "Always Allow"; later installs keep the access.
- Published releases (`.github/workflows/release.yml`, tag `v*`): the build job runs in the GitHub environment
  `release` (required reviewer = maintainer). When its secrets `MOLINOVA_SIGNING_P12` (base64 PKCS#12) and
  `MOLINOVA_SIGNING_PASSWORD` exist, the project certificate "Molinova" (self-signed, O = Kasiopa SAS, created once by
  `scripts/make-release-cert.sh`; private key only in those secrets and the maintainer's password manager) is imported
  into a throwaway keychain; the app is built with `--mac dir`, re-signed `--deep` with it, then packed with
  `--mac dmg --prepackaged … -c.mac.identity=null` (no re-signing), and the keychain is deleted. Without the secrets
  (forks) the build stays ad-hoc. Same certificate for every release = same designated requirement, so users allow
  "Molinova Safe Storage" once. Gatekeeper still warns on first launch (no Apple notarization, by choice: no cost).
- Node: `engines.node` `>=20.19.0` (the Electron tooling is ESM-only and needs `require(esm)`); CI uses Node 22 LTS.
- CI (`.github/workflows/`, every action pinned to a commit SHA, checkout with `persist-credentials: false`): `ci.yml`
  (push / PR, macos-14, Node 22, `contents: read`: install, typecheck, test, i18n); `release.yml` (tag `v*` =
  `package.json` version, workflow `permissions: {}`): job `build` (`contents: read`: typecheck, test, build, Electron
  binary, native:electron, electron-builder, `codesign --verify`, fuse check with `@electron/fuses read`, dmg uploaded
  as an artifact), then job `release` (`contents: write`, only downloads the dmg and runs
  `gh release create "$TAG" --draft --generate-notes release/*.dmg`); `pages.yml` (push to `main` touching `site/**`,
  or manual: workflow `permissions: {}`, job `contents: read`, `pages: write`, `id-token: write`, concurrency group
  `pages`; publishes `site/` to GitHub Pages with `configure-pages`, `upload-pages-artifact`, `deploy-pages`; needs a
  public repository and Pages source "GitHub Actions").
