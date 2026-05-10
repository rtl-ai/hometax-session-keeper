# CLAUDE.md

## Working objective

Maintain a minimal HomeTax session-extension WebExtension. The correct behavior is narrow: when the HomeTax timeout UI asks whether to extend login time, click `연장하기`. When a HomeTax session popup is blocked, reopen only a validated HomeTax session/timeout/logout popup URL through the extension background.

## Guardrails

Never expand this into a general HomeTax automation tool. Avoid credential handling, cookie handling, storage access, scraping, form submission, tax filing automation, payment automation, or certificate automation.

Production manifests must remain limited to HomeTax URL patterns. Do not add broad permissions. Do not add network calls. Do not add analytics. Do not add background keepalive loops.

## Key commands

```bash
npm run validate
npm test
npm run build:all
```

Local fixture debugging:

```bash
npm run debug:build
npm run debug:serve
```

Load `dist/chromium-debug-local` in Chrome/Edge and test `http://127.0.0.1:8787/`.

Optional Playwright smoke path:

```bash
npm install
npx playwright install chromium
npm run smoke:playwright
```

## What to inspect when debugging

- `src/content_script.js`
  - prompt detection strings: `sessionOut`, `로그아웃 시간이`, `로그아웃을 연장하시려면`, `로그인 시간을 연장하시겠습니까`
  - button matching: exact label `연장하기`, preferred ID `mf_trigger16`
- `src/page_hook.js`
  - MAIN-world `window.open` wrapper
  - blocked popup signal posted with `source: HOMETAX_AUTO_EXTEND_PAGE_HOOK`
- `src/background.js`
  - URL validation before `windows.create`
  - fallback window close after successful click
- `manifests/*`
  - no `<all_urls>`
  - HomeTax-only matches
  - Chrome uses `background.service_worker`
  - Firefox uses `background.scripts`

## Review criteria

A good patch keeps scope smaller, reduces permissions, improves detection precision, or improves testability. A bad patch broadens host access, makes the extension read user data, depends on remote scripts, or clicks buttons without verifying the timeout prompt text.
