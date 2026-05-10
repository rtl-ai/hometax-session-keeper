# Browser support matrix

| Browser family | Build | Status | Notes |
|---|---:|---|---|
| Chrome | `dist/chromium` | Primary | Manifest V3 service worker + MAIN-world page hook. |
| Microsoft Edge | `dist/chromium` | Primary | Chromium MV3 path. |
| Brave / Vivaldi / Opera / other Chromium desktop browsers | `dist/chromium` | Expected | Same MV3 WebExtension APIs. Test locally before distribution. |
| Firefox desktop 128+ | `dist/firefox-mv3` | Primary Firefox build | Uses MV3 with `background.scripts`, because Firefox handles MV3 background differently from Chrome. Requires Firefox 128+ for manifest-declared MAIN-world page hook behavior. |
| Firefox desktop 128+ MV2 fallback | `dist/firefox-mv2` | Fallback | Kept for debugging or MV3-specific issues. Do not prefer it unless MV3 is problematic. |
| Safari macOS/iOS | `dist/safari-src` via `scripts/safari-convert.sh` | Source-compatible, not one-click | Safari requires Xcode conversion and app wrapper. Must be tested and signed separately. |
| Chrome Android | N/A | Not supported | Chrome Android does not provide normal desktop-style extension loading. |
| Firefox Android | N/A | Not packaged | Not tested; desktop Firefox is the target. |

The code intentionally avoids broad host access and does not use `<all_urls>`. Production manifests also avoid `match_about_blank` and `match_origin_as_fallback`; login/certificate descendants are treated as inactive contexts.
