# Production Readiness

This project is release-ready only when the automated gate and a real HomeTax idle-session test both pass.

## Automated Gate

Use this exact sequence on a clean checkout:

```bash
npm ci
npx playwright install chromium
npm run check
```

`npm run check` runs:

| Command | Purpose |
|---|---|
| `npm run validate` | Syntax, manifest host scope, restricted permissions, and forbidden browser data APIs |
| `npm run test:unit` | Background message handling, fallback popup validation, badge formatting, stale timer defense, and static regressions |
| `npm run test:browser` | Playwright execution of content script and page hook behavior in a real Chromium renderer |
| `npm run coverage` | Enforced background coverage and browser-side function coverage for content/page hook scripts |
| `npm run build:all` | Chromium, Firefox MV3, Firefox MV2, and Safari source packages |

Current coverage gates:

| Surface | Gate |
|---|---|
| `src/background.js` | 90% lines, 60% branches, 80% functions using Node's built-in coverage |
| `src/content_script.js` | At least 70% named browser functions covered by Playwright/V8 coverage |
| `src/page_hook.js` | At least 75% named browser functions covered by Playwright/V8 coverage |

These are not a claim of "zero bugs". They are minimum release gates that exercise the important runtime paths instead of only checking for strings.

## Hardened Runtime Criteria

The release build must keep these safety constraints:

- Production manifests do not use `match_about_blank` or `match_origin_as_fallback`.
- Firefox MV2/MV3 builds require Firefox 128+ because the page hook depends on manifest-declared `world: "MAIN"`.
- Fallback popup opening and direct in-page extension are allowlisted to the known `UTXPPABB27` HomeTax session-extension route.
- Low HomeTax timers request direct in-page extension before the browser has to rely on a timeout popup.
- Login/certificate blocking checks current URL, document URL, referrer, ancestor origins, and same-origin parent/top URLs.
- Background badge state clears on tab navigation/removal and on explicit disabled/logged-out messages from content scripts.
- HomeTax service-stop block pages clear session badge state and are not reported as active sessions.
- Runtime messages for popup opening, timer updates, extend clicks, and badge clearing are sender-validated against HomeTax origins.

## Real HomeTax Verification

The latest real-site run used a manually authenticated HomeTax session and kept the browser untouched for longer than one HomeTax timeout window.

| Item | Result |
|---|---|
| Start | 2026-05-10 11:06:21 KST |
| Finish | 2026-05-10 11:42:26 KST |
| Elapsed | 2165 seconds |
| Status | Still logged in |
| Final badge | `18m` |
| Timeout boundary | Passed the 30 minute boundary while still logged in |

Local evidence was captured under:

```text
private real-site evidence stored outside the public repository
```

Do not commit raw real-site logs or screenshots to a public repository without redaction.

## Release Criteria

A release can be tagged when all of the following are true:

1. `npm ci` succeeds from a clean checkout.
2. `npm run check` succeeds.
3. `dist/chromium/manifest.json` and package artifact names match `package.json`.
4. A fresh browser profile loads the Chromium build without install warnings.
5. HomeTax login and certificate pages remain untouched by automation.
6. A real 36 minute HomeTax idle-session test remains logged in.
7. Real-site evidence is stored outside the repository or redacted before commit.

## Known Residual Risk

- HomeTax is not a public API. Internal names such as `UTXPPABB27`, `$c.pp.sessionXtn`, `sessionTimer("N")`, and `ntsLoginVo` may change.
- Safari requires Xcode conversion, signing, and separate manual validation.
- Firefox packages are generated and smoke-tested at the WebExtension source level, but the latest real HomeTax idle run above was Chromium-based.
- Firefox private windows require the user to allow the extension in `about:addons`; Firefox blocks content scripts there by default when that permission is absent.
- The 36 minute evidence above was gathered before the final public `0.0.2` packaging pass. A public release should keep the same gate and repeat a real HomeTax idle-session run whenever HomeTax changes or the runtime logic changes materially.
- No automated test can prove there are zero bugs. The gate is designed to catch the regressions observed during real HomeTax testing.
