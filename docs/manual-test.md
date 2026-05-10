# Manual Test Checklist

Run the automated gate first:

```bash
npm ci
npx playwright install chromium
npm run check
```

## Chrome / Edge

1. Build with `npm run build`.
2. Load `dist/chromium` as an unpacked extension.
3. Open a fresh HomeTax tab after the extension is loaded.
4. Sign in manually.
5. Confirm the extension menu shows `Hometax Auto Session Extend` and a minute badge when the HomeTax timer is visible.
6. Leave the tab idle for at least 36 minutes.
7. Pass criteria:
   - HomeTax still shows a logged-in page.
   - `로그아웃` is visible and `로그인` is not visible.
   - The extension console includes `direct session extension attempted` or, for popup fallback, the fallback popup opens and closes after `연장하기`.
   - The badge remains in a plausible post-extension range and is not overwritten by stale second/minute values from older frames.

## Popup-Blocked Fallback

1. Keep browser popup blocking enabled.
2. Load the extension before opening HomeTax.
3. If HomeTax tries to open a session timeout popup and the direct in-page extension API is unavailable, confirm one small extension-created HomeTax popup opens.
4. Confirm the popup auto-clicks `연장하기` and closes.
5. Confirm the opener page remains logged in.

## Login / Certificate Safety

1. Open HomeTax login and 공동인증서 screens.
2. Confirm the extension does not click controls on these pages.
3. Confirm login/certificate UI does not flicker because of extension automation.

## Local Fixture Path

```bash
npm run debug:build
npm run debug:serve
```

Load `dist/chromium-debug-local`, then open `http://127.0.0.1:8787/`.
This verifies the DOM-click path against local fixtures without touching HomeTax.

## Evidence Handling

Real HomeTax screenshots and logs can contain personal information. Keep them outside the public repository unless they have been redacted.
