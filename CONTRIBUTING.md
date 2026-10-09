# Contributing to Molinova

Thanks for your interest. Molinova is a small project maintained by one person: issues and pull
requests are welcome, but please open an issue first for anything larger than a fix, so we can
agree on the approach before you spend time on it.

## Development setup

Requirements: macOS, Node.js 20.19 or later, [pnpm](https://pnpm.io), and the Xcode Command Line
Tools to build the app (`swiftc` compiles the `molinova-text` helper with `pnpm native:text`).

```sh
pnpm install
cp .env.example .env.local   # then fill in the values you need
chmod 600 .env.local         # readable by you only
pnpm ui                      # starts the local server and opens the interface with its session key
pnpm dev                     # same, restarts on every change, does not open the browser (use the link it prints)
pnpm ea                      # command-line interface: lists the commands
```

By default the repository itself is the data folder (`config/`, `data/`, `tokens/`, `credentials/`,
`logs/`, `.env.local`). To experiment without touching your real data, point `MOLINOVA_HOME` to a
throwaway folder and pick another port:

```sh
MOLINOVA_HOME=/tmp/molinova-test MOLINOVA_PORT=4391 pnpm dev
```

With a fresh `MOLINOVA_HOME`, nothing is connected: no Gmail watch, no Telegram bot. The macOS app
architecture (Electron, secrets in the Keychain, setup assistant) is described in
`docs/desktop-app.md`; any change to the paths, secrets, messages or routes listed there must
update that file.

## Before sending a pull request

All three gates must pass:

```sh
pnpm typecheck   # TypeScript, no errors
pnpm test        # Vitest
pnpm i18n        # translation dictionaries complete and consistent, 0 errors
```

Tests must never call real services (Gmail, Google Calendar, Telegram, the AI Gateway): use the
existing fakes and fixtures.

## Translations (i18n)

Molinova is available in French, English and Spanish. Every user-visible string goes through `t()`,
in all three languages:

- **Interface**: `ui/lang/<fr|en|es>/<screen>.js`. French is the reference: a key missing in
  English or Spanish is an error for `pnpm i18n`.
- **Server** (errors, Telegram bot, summaries, drafts): `src/i18n/<fr|en|es>/{core,errors}.ts`.
  These are typed: a key missing in `en` or `es` breaks `pnpm typecheck`.
- In `ui/*.js`, **never name a variable or parameter `t`**: it would shadow the global `t()`
  helper and break translations in that scope.

## Code style

- TypeScript ESM on the server (`src/`), plain JavaScript without a build step in the interface
  (`ui/`).
- Code comments are currently written in **French**. Keep new comments in French, short, and at
  the same density as the surrounding code. Identifiers, commit messages and pull requests are in
  English.
- Keep changes focused: one fix or feature per pull request.

## Public pages (`site/`)

`site/` holds three static pages, in English and French: the home page, the privacy policy and the
terms of service. They give every user the three links Google requires before publishing their own
Google app (see `docs/google-setup.md`); the addresses are `MOLINOVA_PAGES` in `src/config.ts`.

- Self-contained: inline CSS, fonts copied in `site/fonts/`, no external request. Open the files
  directly or serve the folder (`python3 -m http.server 4396 --directory site`).
- `.github/workflows/pages.yml` publishes the folder to `https://kasiopajg.github.io/molinova/` on every
  push to `main` that touches `site/**`. It only works once the repository is **public** (or on a
  paid GitHub plan) and **Settings › Pages › Source** is set to **GitHub Actions**. Until then the
  setup assistant detects that the pages are offline (`GET /api/setup/pages-online`) and suggests
  the user's own website instead.
- Keep the privacy policy in line with the code: what is sent to Google, to the AI and to Telegram is
  listed in the README ("Privacy and security") and in `SECURITY.md`.

## Never commit personal data

Molinova handles private email, messages and calendars. Never commit:

- `.env.local`, `secrets.bin`, `tokens/`, `credentials/`;
- `data/` (databases, WhatsApp copy), `logs/`;
- `config/context.json` and the other generated config files (`settings.json`, `taxonomy.json`,
  `rules.json`, `app.json`).

They are all in `.gitignore`; check `git status` before committing anyway. Use the
`config/context.example*.json` templates and made-up data in tests, screenshots and bug reports.

## Releases (maintainer only)

A release reaches users only when the maintainer publishes it by hand. Contributors never tag.

1. Bump `version` in `package.json` on `main` (through a reviewed pull request).
2. Tag that commit on `main`: `git tag vX.Y.Z && git push origin vX.Y.Z`. The Release workflow refuses a tag that
   is not on `main` or that does not match `package.json`.
3. The workflow waits for the maintainer's approval (environment `release`), then builds, signs and attaches
   `Molinova-X.Y.Z-arm64.dmg` to a **draft** release. Installed apps ignore drafts.
4. Install the `.dmg` from the draft, check it, then click *Publish release*. From then on, every installed copy shows
   the new version (notification, banner in the window, first line of the menu bar menu) within a day.

Repository settings this relies on (GitHub › Settings):

- **Rules › Rulesets** on `main`: pull request with one approval required, no force push, no deletion.
- **Rules › Rulesets** on tags `v*`: only the maintainer may create, update or delete them.
- **Environments › release**: the maintainer as required reviewer, deployment limited to tags `v*`; secrets
  `MOLINOVA_SIGNING_P12` and `MOLINOVA_SIGNING_PASSWORD` (from `scripts/make-release-cert.sh`).
- **Actions › General**: require approval for workflows from all outside contributors; default `GITHUB_TOKEN`
  permissions read-only.

## License

By contributing, you agree that your contributions are licensed under the MIT License of this
project (see `LICENSE`).
