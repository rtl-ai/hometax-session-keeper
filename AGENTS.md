# AGENTS.md

## Project role

This repository builds a narrow browser extension for one task: on `hometax.go.kr`, detect the official session timeout prompt and click `연장하기`. It also handles a blocked `window.open()` session popup by asking the extension background context to open the same HomeTax session popup URL.

## Non-negotiable safety boundaries

- Do not broaden host scope beyond `https://hometax.go.kr/*`, `https://www.hometax.go.kr/*`, and `https://*.hometax.go.kr/*` in production manifests.
- Do not add `<all_urls>`.
- Do not request or add permissions for `cookies`, `tabs`, `storage`, `history`, `bookmarks`, `webRequest`, `webRequestBlocking`, `debugger`, native messaging, or remote code.
- Do not read, log, copy, transmit, or persist HomeTax tax data, credentials, certificates, resident registration numbers, cookies, local storage, session storage, or form values unrelated to the session extension button.
- Do not automate tax filing actions, payment actions, authentication, certificate selection, or form submission. This project only clicks the session-extension button after the official timeout prompt appears.
- Keep logs minimal. Prefer hostname/path labels; avoid full URLs with query strings unless needed for the blocked popup URL validation path.
- Do not commit user tax PDFs, screenshots, logs, or personally identifying data.

## Expected file layout

- `src/content_script.js`: DOM detection and click logic; receives messages from the page hook.
- `src/page_hook.js`: MAIN-world `window.open()` wrapper; posts a message when a HomeTax session popup is blocked.
- `src/background.js`: validates popup URLs and opens fallback popup windows.
- `manifests/*.json`: per-browser manifests.
- `tests/fixtures/`: non-private HTML fixtures.
- `docs/`: install/debug/browser-support docs.

## Build and validation commands

Run these before producing a patch:

```bash
npm run validate
npm test
npm run build:all
```

For local browser debugging:

```bash
npm run debug:build
npm run debug:serve
```

Then load `dist/chromium-debug-local` as an unpacked extension and open `http://127.0.0.1:8787/`.

For Playwright smoke tests, first install browsers and dependencies in the local environment:

```bash
npm install
npx playwright install chromium
npm run smoke:playwright
```

## Computer-use debugging playbook

1. Build `npm run debug:build`.
2. Open Chrome/Edge extension manager.
3. Enable developer mode.
4. Load `dist/chromium-debug-local` as unpacked.
5. Start fixtures with `npm run debug:serve`.
6. Open `http://127.0.0.1:8787/sessionOut.html` and verify the page changes `#status` to `extended`.
7. Open `http://127.0.0.1:8787/`, click the open button, and verify the blocked-popup path logs a fallback request.
8. For real HomeTax testing, load the production build `dist/chromium` or `dist/firefox-mv3`, open HomeTax only after extension load, and wait for the official timeout prompt.

## Implementation notes

- The fixture must remain generic and must not contain personal taxpayer data.
- `DEBUG_ALLOW_LOCALHOST` must stay `false` in source. `scripts/build.mjs --debug-local` flips it only in generated `dist/*-debug-local` files.
- If HomeTax changes the button ID, keep the exact-label fallback for `연장하기` and the prompt-text checks.
- If HomeTax changes the popup URL vocabulary, update `sessionOut`/`timeout`/`logout` matching conservatively. Do not match arbitrary popup URLs.
