# Hometax Session Keeper

국세청 홈택스에서 세션 만료 전 `로그인 시간을 연장하시겠습니까?` 팝업이 뜨면 `연장하기` 버튼을 자동 클릭하는 WebExtension입니다.

## 동작 요약

- 실제 세션연장 팝업 창이 열리면 그 창 안에서 `연장하기` 버튼을 자동 클릭합니다.
- 홈택스가 알려진 `UTXPPABB27` 세션 연장 팝업을 열려다가 브라우저 팝업 차단으로 실패하면, background script가 같은 홈택스 URL을 확장 창으로 다시 열고 자동 클릭합니다.
- 홈택스의 현재 `UTXPPABB27` 세션 만료 경로에서는 팝업에 의존하지 않고 원래 페이지 컨텍스트에서 세션 연장 함수를 먼저 호출합니다.
- 대체 팝업 창에서 클릭에 성공하면 해당 창을 닫습니다.
- 홈택스가 공개한 세션 타이머 숫자(`ntsLoginVo.FN_CURRENT_TIME`)가 보이는 경우 확장 아이콘 배지에 남은 시간을 표시합니다.
- 세션 연장 직후 오래된 서브프레임 타이머가 배지를 낮은 값으로 덮어쓰는 경우를 background에서 거릅니다.
- 탭 이동, 비로그인 상태, 로그인/인증서 화면 진입 시 배지를 지웁니다.
- 공동인증서 로그인 안내/인증서 팝업 화면에서는 현재 URL뿐 아니라 referrer, ancestor origin, same-origin parent/top URL까지 확인해 자동 클릭 스캔과 `window.open()` 후킹을 비활성화합니다.
- 쿠키, 인증서, 주민번호, 비밀번호, 세금 자료를 읽거나 저장하지 않습니다.
- 외부 서버로 통신하지 않습니다.

## 감지 조건

자동 클릭은 아래 조건을 모두 만족할 때만 실행됩니다.

1. 문서 제목 또는 본문에 다음 신호 중 하나가 있음: `sessionOut`, `로그아웃 시간이`, `로그아웃을 연장하시려면`, `로그인 시간을 연장하시겠습니까`.
2. 보이는 버튼 또는 input의 라벨이 정확히 `연장하기`.
3. 기본 ID `mf_trigger16`을 우선 찾고, ID가 바뀌면 라벨 기반으로 보완 탐색.

팝업 차단 보완은 홈택스 도메인에서 `window.open()`이 차단되고, URL/target/features에 알려진 세션 연장 코드 `UTXPPABB27`이 있을 때만 동작합니다.

## 빠른 사용

```bash
npm ci
npx playwright install chromium
npm run check
```

개발/CI 기준 Node 버전은 26 이상입니다. Node 내장 test coverage 임계값 옵션을 사용하므로 더 낮은 Node에서는 `npm run check`가 실패합니다.

빌드 결과는 `dist/`에 생성됩니다.

| 대상 | 산출물 | 설치 방식 |
|---|---|---|
| Chrome / Edge / Brave / Vivaldi / Opera | `dist/chromium` 또는 `dist/hometax-session-keeper-chromium-v0.0.1.zip` | 확장 프로그램 관리 페이지에서 `dist/chromium`을 압축해제 확장으로 로드 |
| Firefox 128+ 최신 | `dist/firefox-mv3` 또는 `.xpi` | `about:debugging` → This Firefox → Load Temporary Add-on |
| Firefox 128+ MV2 보완 | `dist/firefox-mv2` 또는 `.xpi` | 최신 Firefox MV3에서 문제가 있을 때만 사용 |
| Safari | `dist/safari-src` | `scripts/safari-convert.sh`로 Xcode Safari Web Extension 프로젝트 생성 후 테스트/서명 |

## 품질 게이트

`npm run check`는 아래를 전부 통과해야 성공합니다.

- `npm run validate`: manifest 권한, 홈택스 host scope, 금지 API 사용, 문법 검사
- `npm run test:unit`: background 보안/배지/팝업 fallback 단위 테스트와 정적 회귀 테스트
- `npm run test:browser`: Playwright에서 실제 DOM 클릭, 로그인 페이지 비활성화, fallback timer, 직접 세션연장, 타이머 re-anchor 검증
- `npm run coverage`: background 라인/브랜치/함수 커버리지 게이트와 content/page hook 브라우저 함수 커버리지 게이트
- `npm run build:all`: Chromium, Firefox MV3, Firefox MV2, Safari source 패키지 생성

자세한 릴리즈 기준은 [`docs/production-readiness.md`](docs/production-readiness.md)를 보세요.

## 배포

- GitHub Release: `v0.0.1` 같은 태그를 push하면 `.github/workflows/release.yml`이 전체 검증 후 패키지를 릴리즈에 첨부합니다.
- Chrome Web Store / Firefox Add-ons: `.github/workflows/store-publish.yml`을 수동 실행합니다. 스토어 계정과 API secrets가 필요합니다.
- 스토어 제출 문구와 개인정보 고지는 [`docs/store-submission.md`](docs/store-submission.md)와 [`PRIVACY.md`](PRIVACY.md)를 기준으로 관리합니다.

## Chrome / Edge 계열 설치

```bash
npm run build
```

1. `chrome://extensions` 또는 `edge://extensions`로 이동.
2. 개발자 모드 활성화.
3. `Load unpacked` / `압축해제된 확장 프로그램 로드`.
4. `dist/chromium` 폴더 선택.
5. 기존 홈택스 탭을 새로고침.

## Firefox 설치

```bash
npm run build
```

1. `about:debugging`으로 이동.
2. `This Firefox` 선택.
3. `Load Temporary Add-on`.
4. `dist/firefox-mv3/manifest.json` 또는 `dist/hometax-session-keeper-firefox-mv3-v0.0.1.xpi` 선택.
5. 기존 홈택스 탭을 새로고침.

## Safari 변환

Safari는 WebExtension 소스만으로 바로 설치되는 구조가 아니라 Safari 앱 확장 wrapper가 필요합니다.

```bash
./scripts/safari-convert.sh
```

Xcode 프로젝트가 생성되면 Safari에서 개발자용으로 테스트하고, 배포하려면 Apple 개발자 서명/배포 절차를 진행해야 합니다.

## 로컬 디버깅

```bash
npm run debug:build
npm run debug:serve
```

그 다음 `dist/chromium-debug-local`을 압축해제 확장으로 로드하고 `http://127.0.0.1:8787/`을 열어 테스트합니다. 디버그 빌드만 localhost를 허용합니다. 배포 빌드는 홈택스 도메인으로만 제한됩니다.

## 알려진 한계

홈택스가 `window.open('', 'sessionOut')`처럼 URL 없이 빈 팝업을 만들고 내부에 HTML을 직접 써 넣는 구조로 바꾸면, 팝업 차단 상태에서는 확장 프로그램도 원래 URL을 알 수 없습니다. 이 경우 홈택스 도메인 팝업을 브라우저에서 허용해야 합니다.

브라우저 확장은 홈택스 내부 구현에 의존합니다. `UTXPPABB27`, `$c.pp.sessionXtn`, `sessionTimer("N")`, `ntsLoginVo` 같은 내부 이름이 바뀌면 새 실사이트 회귀 테스트가 필요합니다.

## 보안 주의

자동 세션 연장은 로그인 상태를 더 오래 유지합니다. 공용 PC나 타인이 접근 가능한 PC에서는 사용하지 마세요. 작업이 끝나면 홈택스에서 직접 로그아웃하세요.
