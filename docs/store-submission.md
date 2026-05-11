# Store Submission Notes

This document is the release checklist for Chrome Web Store and Firefox Add-ons.

## Listing Summary

Suggested short description:

> Extends the HomeTax session timeout prompt and shows the remaining session time when available.

Suggested Korean description:

> 홈택스 세션 만료 안내가 뜨면 공식 연장 버튼을 자동으로 누르고, 가능한 경우 남은 시간을 확장 아이콘 배지에 표시합니다.

Required disclosure:

> This extension is independent and is not affiliated with or endorsed by the Korean National Tax Service. It does not collect, store, or transmit user data.

## Data Use Answers

- Collects personal data: No.
- Uses cookies: No.
- Uses browser storage: No.
- Analytics/tracking: No.
- External network requests: No.
- Remote code: No.
- Host access: HomeTax domains only.

## Chrome Web Store

Manual account requirements:

1. Chrome Web Store developer account.
2. Store listing text, category, language, icons, screenshots, and privacy disclosures.
3. Privacy policy URL. If the repository is public, use the GitHub-rendered `PRIVACY.md` URL.
4. A first item may need to be created in the Developer Dashboard before API automation has a stable item ID.
5. Chrome Web Store does not accept an all-zero manifest version such as `0.0.0`; the first store-compatible release is `0.0.1`.

GitHub Actions secrets used by `.github/workflows/store-publish.yml`:

| Secret | Purpose |
|---|---|
| `CHROME_PUBLISHER_ID` | Chrome Web Store publisher ID |
| `CHROME_ITEM_ID` | Chrome Web Store item ID |
| `CHROME_CLIENT_ID` | OAuth client ID |
| `CHROME_CLIENT_SECRET` | OAuth client secret |
| `CHROME_REFRESH_TOKEN` | OAuth refresh token with Chrome Web Store publish access |
| `CHROME_PUBLISH_TYPE` | Optional API publish type, defaults to `DEFAULT_PUBLISH` |
| `CHROME_SKIP_REVIEW` | Optional `1` only for changes eligible to skip review |

The workflow uploads the Chromium ZIP. It only calls publish when `chrome_publish` is checked in the manual workflow input.

## Firefox Add-ons

Manual account requirements:

1. Mozilla Add-ons developer account.
2. Add-on listing text, icons, screenshots, source code/review information if requested, and privacy policy.
3. API credentials for automated signing/submission.
4. New Firefox submissions declare `browser_specific_settings.gecko.data_collection_permissions.required = ["none"]` because this extension does not transmit user data off device.

GitHub Actions secrets:

| Secret | Purpose |
|---|---|
| `AMO_JWT_ISSUER` | AMO API key / JWT issuer |
| `AMO_JWT_SECRET` | AMO API secret |

The workflow runs `web-ext sign` through `scripts/publish-firefox.mjs`. Use `listed` for AMO listing review or `unlisted` for signed self-distribution artifacts.

## Store Assets Still Needed

- Clean screenshots that do not show personal HomeTax data.
- Optional promotional images for Chrome Web Store.
- Final public privacy-policy URL after the GitHub repository exists.
- Developer contact/support URL.

## Release Command

After GitHub is configured:

```bash
git tag v0.0.2
git push origin main --tags
```

The `release` workflow builds and attaches generated packages to the GitHub release.
