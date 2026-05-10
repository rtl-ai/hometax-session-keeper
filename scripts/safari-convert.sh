#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
npm run build
xcrun safari-web-extension-converter --force "$ROOT/dist/safari-src"
