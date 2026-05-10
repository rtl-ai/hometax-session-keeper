# Security Policy

## Supported Versions

Only the latest tagged release is supported.

## Reporting a Vulnerability

Please open a private security advisory on GitHub if the repository is public and advisories are enabled. If advisories are not available, open a GitHub issue with a minimal description and avoid posting private HomeTax account data, screenshots, certificate details, cookies, or logs containing personal information.

## Security Model

The extension is intentionally narrow:

- HomeTax-only host matches.
- No `cookies`, `storage`, `tabs`, `webRequest`, `debugger`, or `<all_urls>` permission.
- No external network calls.
- No remote code.
- Fallback popup handling is allowlisted to the known HomeTax session-extension route.
- Login and certificate pages are treated as inactive contexts.

Known residual risk: HomeTax internals are not a public API. If HomeTax changes route names, timer objects, or session-extension functions, the extension may stop working or require a new review.
