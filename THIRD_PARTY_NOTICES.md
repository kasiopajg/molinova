# Third-party notices

Molinova is released under the MIT License (see `LICENSE`). It includes or depends on the third-party
software listed below, each under its own license.

## Bundled in this repository

### d3 v7.9.0

- File: `ui/vendor/d3.min.js`
- Source: https://d3js.org
- License: ISC

```
Copyright 2010-2023 Mike Bostock

Permission to use, copy, modify, and/or distribute this software for any purpose
with or without fee is hereby granted, provided that the above copyright notice
and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND
FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS
OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER
TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF
THIS SOFTWARE.
```

### qrcode-generator v1.4.4

- File: `ui/vendor/qrcode.js`
- Source: https://github.com/kazuhikoarase/qrcode-generator
- License: MIT

```
Copyright (c) 2009 Kazuhiko Arase

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
```

"QR Code" is a registered trademark of DENSO WAVE INCORPORATED.

### Outfit (font)

- Files: `ui/fonts/outfit-*.woff2` (latin and latin-ext subsets, weights 400, 500, 600, 700, taken from the Fontsource package `@fontsource/outfit` 5.3.0)
- Source: https://github.com/Outfitio/Outfit-Fonts
- Copyright 2021 The Outfit Project Authors
- License: SIL Open Font License 1.1, full text in `ui/fonts/OFL-Outfit.txt`

### IBM Plex Mono (font)

- Files: `ui/fonts/ibm-plex-mono-*.woff2` (latin and latin-ext subsets, weights 400 and 500, taken from the Fontsource package `@fontsource/ibm-plex-mono` 5.3.0)
- Source: https://github.com/IBM/plex
- Copyright 2017 IBM Corp.
- License: SIL Open Font License 1.1, full text in `ui/fonts/OFL-IBMPlexMono.txt`

The fonts are served by the local server from `ui/fonts/`; the app makes no request to Google Fonts.
The public pages in `site/` carry their own copies of the same two fonts (`site/fonts/*.woff2`, latin
subset, weights 400 and 600), with the same licenses in `site/fonts/OFL-Outfit.txt` and
`site/fonts/OFL-IBMPlexMono.txt`.

## Runtime npm dependencies

Installed by `pnpm install`, not stored in this repository. Each package ships its license text in
`node_modules/<package>/`. Versions are those currently resolved in `pnpm-lock.yaml`.

| Package | Version | License |
|---|---|---|
| `@ai-sdk/gateway` | 4.0.90 | Apache-2.0 |
| `ai` | 7.0.112 | Apache-2.0 |
| `better-sqlite3` | 12.11.1 | MIT (embeds SQLite, public domain); the app ships an Electron build of it compiled from these sources |
| `dotenv` | 17.4.2 | BSD-2-Clause |
| `google-auth-library` | 11.1.0 | Apache-2.0 |
| `googleapis` | 181.0.0 | Apache-2.0 |
| `open` | 10.2.0 | MIT |
| `zod` | 4.6.5 | MIT |

Their own transitive dependencies are covered by the license files inside `node_modules/`.

## Runtime of the macOS app (Molinova.app and the .dmg)

| Component | Version | License |
|---|---|---|
| Electron | 44.4.5 | MIT; bundles Chromium and Node.js, each under its own licenses |

Molinova.app carries these notices in `Molinova.app/Contents/Resources/`: `LICENSE.electron.txt` (Electron's MIT license)
and `LICENSES.chromium.html` (the licenses of Chromium, Node.js and every other component bundled in Electron).

Development-only tools (TypeScript, tsx, Vitest, electron-builder, @electron/rebuild, type definitions) are not shipped
with the app.
