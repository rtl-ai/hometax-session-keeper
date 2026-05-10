# Changelog

## 0.0.1 - 2026-05-10

Initial public release candidate.

- Tightened the fallback popup allowlist so only the known HomeTax session-extension popup route `UTXPPABB27` can be opened or directly extended, and require the code in the actual URL rather than only in `target` or window features.
- Removed `match_about_blank` / `match_origin_as_fallback` from production manifests and expanded login/certificate-page blocking to inspect referrer, ancestor origins, and same-origin parent/top URLs.
- Raised Firefox MV2/MV3 minimum version to 128.0 because the release builds depend on manifest-declared `world: "MAIN"` behavior.
- Added badge clearing on disabled/logged-out contexts plus tab navigation/removal lifecycle hooks so stale MV3 badge state does not depend only on service-worker timers.
- Added sender validation for timer, click, popup, and badge-clear messages, and strengthened subframe timer rejection.
- Added regression tests for strict popup allowlisting, Firefox version support, navigation badge clearing, and removal of about:blank/origin-fallback injection.
- Added background-side stale timer defense so old subframe `ntsLoginVo` timers cannot overwrite the badge after a successful session extension.
- Expanded Playwright smoke tests to cover:
  - timeout prompt auto-clicking,
  - login/certificate page disable behavior,
  - logged-in fallback badge timer,
  - direct in-page extension for the `UTXPPABB27` HomeTax timeout route,
  - fallback popup behavior when direct extension APIs are unavailable,
  - timer bridge re-anchoring when a raw HomeTax timer value stays stale.
- Added enforced coverage gates:
  - `src/background.js` line/branch/function thresholds through Node test coverage,
  - browser-side named-function coverage for `src/content_script.js` and `src/page_hook.js`.
- Updated CI to use `npm ci`, install Chromium for Playwright, and run the full release gate.
- Documented production readiness, residual risk, and real HomeTax verification evidence handling.
