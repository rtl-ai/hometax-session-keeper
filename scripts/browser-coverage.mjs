import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const sourceFiles = new Map([
  ['content_script.js', path.join(root, 'src', 'content_script.js')],
  ['page_hook.js', path.join(root, 'src', 'page_hook.js')]
]);
const thresholds = new Map([
  ['content_script.js', 70],
  ['page_hook.js', 75]
]);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function mergeCoverage(target, entry) {
  const fileName = [...sourceFiles.keys()].find((name) => entry.url.endsWith(`/src/${name}`) || entry.url.endsWith(`\\src\\${name}`));
  if (!fileName) return;
  const bucket = target.get(fileName) || new Map();
  for (const fn of entry.functions || []) {
    if (!fn.functionName) continue;
    const first = fn.ranges && fn.ranges[0];
    if (!first) continue;
    const key = `${fn.functionName}:${first.startOffset}:${first.endOffset}`;
    bucket.set(key, (bucket.get(key) || false) || first.count > 0);
  }
  target.set(fileName, bucket);
}

async function collectFromPage(page, mergedCoverage) {
  const entries = await page.coverage.stopJSCoverage();
  for (const entry of entries) mergeCoverage(mergedCoverage, entry);
}

async function withCoveragePage(browser, mergedCoverage, fn) {
  const page = await browser.newPage();
  try {
    await page.coverage.startJSCoverage({ resetOnNavigation: false });
    await fn(page);
    await collectFromPage(page, mergedCoverage);
  } finally {
    await page.close();
  }
}

async function gotoMockHometax(page) {
  await page.route('https://hometax.go.kr/test-opener', (route) => route.fulfill({
    contentType: 'text/html; charset=utf-8',
    body: '<!doctype html><html lang="ko"><head><meta charset="UTF-8"><title>mock opener</title></head><body><main>HomeTax mock</main></body></html>'
  }));
  await page.goto('https://hometax.go.kr/test-opener');
}

async function installRuntimeMessageRecorder(page) {
  await page.evaluate(() => {
    window.__messages = [];
    Object.defineProperty(window, 'chrome', {
      configurable: true,
      value: {
        runtime: {
          sendMessage(message) {
            window.__messages.push(message);
          }
        }
      }
    });
  });
}

async function runContentScriptScenarios(browser, mergedCoverage) {
  await withCoveragePage(browser, mergedCoverage, async (page) => {
    await page.goto('file://' + path.join(root, 'tests/fixtures/sessionOut.html'));
    await page.addScriptTag({ path: sourceFiles.get('content_script.js') });
    await page.waitForFunction(() => window.__extendClicked === true);
  });

  await withCoveragePage(browser, mergedCoverage, async (page) => {
    await page.setContent(`
      <!doctype html>
      <html lang="ko">
        <body>
          <a>회원정보조회</a>
          <a>로그아웃</a>
          <nav>나의 홈택스 나의 메뉴</nav>
        </body>
      </html>
    `);
    await installRuntimeMessageRecorder(page);
    await page.addScriptTag({ path: sourceFiles.get('content_script.js') });
    await page.waitForFunction(() => window.__messages.some((message) => (
      message.type === 'HOMETAX_SESSION_TIMER' &&
      message.source === 'content-estimated-login' &&
      message.secondsLeft > 0
    )));
  });

  await withCoveragePage(browser, mergedCoverage, async (page) => {
    await gotoMockHometax(page);
    await installRuntimeMessageRecorder(page);
    await page.addScriptTag({ path: sourceFiles.get('content_script.js') });
    await page.evaluate(() => {
      window.postMessage({
        source: 'HOMETAX_AUTO_EXTEND_PAGE_HOOK',
        type: 'POPUP_BLOCKED',
        url: 'https://hometax.go.kr/websquare/popup.html?w2xPath=/ui/pp/a/b/UTXPPABB27.xml&popupID=$c.pp_UTXPPABB27',
        openerUrl: location.href,
        reason: 'coverage'
      }, location.origin);
      window.postMessage({
        source: 'HOMETAX_AUTO_EXTEND_PAGE_HOOK',
        type: 'EXTEND_ATTEMPTED_IN_PAGE',
        ok: true,
        method: 'top.$c.pp.sessionXtn',
        timerMethod: 'top.sessionTimer',
        secondsLeft: 1800
      }, location.origin);
    });
    await page.waitForFunction(() => window.__messages.some((message) => message.type === 'HOMETAX_OPEN_BLOCKED_SESSION_POPUP'));
    await page.waitForFunction(() => window.__messages.some((message) => (
      message.type === 'HOMETAX_SESSION_EXTEND_CLICKED' &&
      message.source === 'page-direct-extend'
    )));
  });
}

async function runPageHookScenarios(browser, mergedCoverage) {
  await withCoveragePage(browser, mergedCoverage, async (page) => {
    await gotoMockHometax(page);
    await page.evaluate(() => {
      window.__hookMessages = [];
      window.__sessionExtended = 0;
      window.__timerResetArgs = [];
      window.ntsLoginVo = { FN_CURRENT_TIME: 1800, FN_MAX_TIME: 1800 };
      window.$c = { pp: { sessionXtn() { window.__sessionExtended += 1; } } };
      window.sessionTimer = (arg) => window.__timerResetArgs.push(arg);
      window.open = () => null;
      window.addEventListener('message', (event) => {
        if (event.data && event.data.source === 'HOMETAX_AUTO_EXTEND_PAGE_HOOK') window.__hookMessages.push(event.data);
      });
    });
    await page.addScriptTag({ path: sourceFiles.get('page_hook.js') });
    await page.evaluate(() => window.open('https://hometax.go.kr/websquare/popup.html?w2xPath=/ui/pp/a/b/UTXPPABB27.xml&popupID=$c.pp_UTXPPABB27', '$c.pp_UTXPPABB27', 'width=560,height=420'));
    await page.waitForFunction(() => window.__sessionExtended === 1);
    assert(await page.evaluate(() => window.__timerResetArgs[0] === 'N'), 'page hook should reset HomeTax session timer');
  });

  await withCoveragePage(browser, mergedCoverage, async (page) => {
    await gotoMockHometax(page);
    await page.evaluate(() => {
      window.__hookMessages = [];
      window.open = () => null;
      window.addEventListener('message', (event) => {
        if (event.data && event.data.source === 'HOMETAX_AUTO_EXTEND_PAGE_HOOK') window.__hookMessages.push(event.data);
      });
    });
    await page.addScriptTag({ path: sourceFiles.get('page_hook.js') });
    await page.evaluate(() => window.open('https://hometax.go.kr/websquare/popup.html?w2xPath=/ui/pp/a/b/UTXPPABB27.xml&popupID=$c.pp_UTXPPABB27', '$c.pp_UTXPPABB27', 'width=560,height=420'));
    await page.waitForFunction(() => window.__hookMessages.some((message) => message.type === 'POPUP_BLOCKED'));
  });

  await withCoveragePage(browser, mergedCoverage, async (page) => {
    await gotoMockHometax(page);
    await page.evaluate(() => {
      window.__hookMessages = [];
      window.__now = 1_000_000;
      Date.now = () => window.__now;
      window.__timerCallbacks = [];
      window.setInterval = (fn) => {
        window.__timerCallbacks.push(fn);
        return window.__timerCallbacks.length;
      };
      window.ntsLoginVo = { FN_CURRENT_TIME: 1800, FN_MAX_TIME: 1800 };
      window.addEventListener('message', (event) => {
        if (event.data && event.data.source === 'HOMETAX_AUTO_EXTEND_PAGE_HOOK') window.__hookMessages.push(event.data);
      });
    });
    await page.addScriptTag({ path: sourceFiles.get('page_hook.js') });
    await page.waitForFunction(() => window.__hookMessages.some((message) => message.type === 'SESSION_TIMER' && message.secondsLeft === 1800));
    await page.evaluate(() => {
      window.__now += 1_801_000;
      for (const callback of window.__timerCallbacks) callback();
    });
    assert(await page.evaluate(() => {
      const timers = window.__hookMessages.filter((message) => message.type === 'SESSION_TIMER');
      return timers.at(-1).secondsLeft === 1800;
    }), 'page hook timer bridge should re-anchor stale raw timers');
  });
}

function printAndCheckCoverage(mergedCoverage) {
  let ok = true;
  for (const [fileName, expectedPath] of sourceFiles) {
    const functions = mergedCoverage.get(fileName) || new Map();
    const total = functions.size;
    const covered = [...functions.values()].filter(Boolean).length;
    const percent = total === 0 ? 0 : (covered / total) * 100;
    const threshold = thresholds.get(fileName) || 0;
    console.log(`${fileName}: ${covered}/${total} named functions covered (${percent.toFixed(2)}%), threshold ${threshold}%`);
    if (percent < threshold) ok = false;
    assert(expectedPath, `missing coverage source path for ${fileName}`);
  }
  if (!ok) throw new Error('browser coverage threshold failed');
}

const browser = await chromium.launch();
const mergedCoverage = new Map();
try {
  await runContentScriptScenarios(browser, mergedCoverage);
  await runPageHookScenarios(browser, mergedCoverage);
} finally {
  await browser.close();
}
printAndCheckCoverage(mergedCoverage);
