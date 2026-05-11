import { test, expect } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');

async function gotoMockHometax(page) {
  await page.route('https://hometax.go.kr/test-opener', (route) => route.fulfill({
    contentType: 'text/html; charset=utf-8',
    body: '<!doctype html><html lang="ko"><head><meta charset="UTF-8"><title>mock opener</title></head><body><button id="open">open</button></body></html>'
  }));
  await page.goto('https://hometax.go.kr/test-opener');
}

async function installRuntimeMessageRecorder(page) {
  await page.evaluate(() => {
    window.__messages = [];
    const runtime = {
      sendMessage(message) {
        window.__messages.push(message);
      }
    };
    try {
      Object.defineProperty(window, 'chrome', {
        configurable: true,
        value: { runtime }
      });
    } catch {
      if (!window.chrome || typeof window.chrome !== 'object') throw new Error('cannot install chrome runtime test double');
      try {
        Object.defineProperty(window.chrome, 'runtime', {
          configurable: true,
          value: runtime
        });
      } catch {
        window.chrome.runtime = runtime;
      }
    }
  });
}

test('content_script clicks the sessionOut extend button in fixture', async ({ page }) => {
  await page.goto('file://' + path.join(root, 'tests/fixtures/sessionOut.html'));
  await page.addScriptTag({ path: path.join(root, 'src/content_script.js') });
  await expect.poll(() => page.evaluate(() => window.__extendClicked)).toBe(true);
});

test('content_script stays disabled on login and certificate pages', async ({ page }) => {
  await page.goto('file://' + path.join(root, 'tests/fixtures/sessionOut.html') + '?initPage=login');
  await page.addScriptTag({ path: path.join(root, 'src/content_script.js') });
  await page.waitForTimeout(1000);
  await expect.poll(() => page.evaluate(() => window.__extendClicked)).toBe(false);
});

test('content_script publishes a logged-in fallback badge timer', async ({ page }) => {
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
  await page.addScriptTag({ path: path.join(root, 'src/content_script.js') });
  await expect.poll(() => page.evaluate(() => {
    return window.__messages.find((message) => (
      message.type === 'HOMETAX_SESSION_TIMER' &&
      message.source === 'content-estimated-login' &&
      message.secondsLeft > 0
    ));
  })).toBeTruthy();
});

test('content_script clears the badge on a Hometax service-stop block page', async ({ page }) => {
  await page.route('https://hometax.go.kr/html/comm/error/blockPage.html?msg=stop', (route) => route.fulfill({
    contentType: 'text/html; charset=utf-8',
    body: '<!doctype html><html lang="ko"><head><title>서비스 중지</title></head><body>요청하신 서비스는 현재 서비스 중지 시간 입니다. (근무일) [MFE]</body></html>'
  }));
  await page.goto('https://hometax.go.kr/html/comm/error/blockPage.html?msg=stop');
  await installRuntimeMessageRecorder(page);
  await page.addScriptTag({ path: path.join(root, 'src/content_script.js') });
  await expect.poll(() => page.evaluate(() => {
    return window.__messages.find((message) => (
      message.type === 'HOMETAX_CLEAR_SESSION_BADGE' &&
      message.reason === 'hometax-service-stopped'
    ));
  })).toBeTruthy();
});

test('page_hook ignores generic blocked Hometax timeout/logout-looking popups', async ({ page }) => {
  await gotoMockHometax(page);
  await page.evaluate(() => {
    window.__hookMessages = [];
    window.open = () => null;
    window.addEventListener('message', (event) => {
      if (event.data && event.data.source === 'HOMETAX_AUTO_EXTEND_PAGE_HOOK') window.__hookMessages.push(event.data);
    });
  });
  await page.addScriptTag({ path: path.join(root, 'src/page_hook.js') });
  await page.evaluate(() => window.open('https://hometax.go.kr/some/sessionOut.do', 'sessionOut', 'width=560,height=420'));
  await page.evaluate(() => window.open('https://hometax.go.kr/logout?timeout=session', 'sessionOut', 'width=560,height=420'));
  await page.evaluate(() => window.open('https://hometax.go.kr/some/other-popup.do', '$c.pp_UTXPPABB27', 'width=560,height=420'));
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => window.__hookMessages.length)).toBe(0);
});

test('page_hook uses direct in-page extension for the real UTXPPABB27 timeout route', async ({ page }) => {
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
  await page.addScriptTag({ path: path.join(root, 'src/page_hook.js') });
  await page.evaluate(() => window.open('https://hometax.go.kr/websquare/popup.html?w2xPath=/ui/pp/a/b/UTXPPABB27.xml&popupID=$c.pp_UTXPPABB27&w2xHome=/ui/pp/&w2xDocumentRoot=', '$c.pp_UTXPPABB27', 'width=560,height=420'));
  await expect.poll(() => page.evaluate(() => window.__sessionExtended)).toBe(1);
  await expect.poll(() => page.evaluate(() => window.__timerResetArgs)).toEqual(['N']);
  const messages = await page.evaluate(() => window.__hookMessages);
  expect(messages.find((message) => message.type === 'EXTEND_ATTEMPTED_IN_PAGE' && message.ok)).toBeTruthy();
  expect(messages.find((message) => message.type === 'SESSION_TIMER' && message.secondsLeft === 1800)).toBeTruthy();
  expect(messages.find((message) => message.type === 'POPUP_BLOCKED')).toBeFalsy();
});

test('content_script requests proactive in-page extension when a Hometax timer is low', async ({ page }) => {
  await gotoMockHometax(page);
  await installRuntimeMessageRecorder(page);
  await page.evaluate(() => {
    window.__hookMessages = [];
    window.__sessionExtended = 0;
    window.__timerResetArgs = [];
    window.ntsLoginVo = { FN_CURRENT_TIME: 240, FN_MAX_TIME: 1800 };
    window.$c = { pp: { sessionXtn() { window.__sessionExtended += 1; } } };
    window.sessionTimer = (arg) => window.__timerResetArgs.push(arg);
    window.addEventListener('message', (event) => {
      if (event.data && event.data.source === 'HOMETAX_AUTO_EXTEND_PAGE_HOOK') window.__hookMessages.push(event.data);
    });
  });
  await page.addScriptTag({ path: path.join(root, 'src/content_script.js') });
  await page.addScriptTag({ path: path.join(root, 'src/page_hook.js') });
  await expect.poll(() => page.evaluate(() => window.__sessionExtended)).toBe(1);
  await expect.poll(() => page.evaluate(() => window.__timerResetArgs)).toEqual(['N']);
  const hookMessages = await page.evaluate(() => window.__hookMessages);
  expect(hookMessages.find((message) => (
    message.type === 'EXTEND_ATTEMPTED_IN_PAGE' &&
    message.ok &&
    String(message.reason).startsWith('proactive-low-timer:')
  ))).toBeTruthy();
  const runtimeMessages = await page.evaluate(() => window.__messages);
  expect(runtimeMessages.find((message) => (
    message.type === 'HOMETAX_SESSION_EXTEND_CLICKED' &&
    message.source === 'page-direct-extend'
  ))).toBeTruthy();
});

test('page_hook falls back to POPUP_BLOCKED when direct extension API is unavailable', async ({ page }) => {
  await gotoMockHometax(page);
  await page.evaluate(() => {
    window.__hookMessages = [];
    window.open = () => null;
    window.addEventListener('message', (event) => {
      if (event.data && event.data.source === 'HOMETAX_AUTO_EXTEND_PAGE_HOOK') window.__hookMessages.push(event.data);
    });
  });
  await page.addScriptTag({ path: path.join(root, 'src/page_hook.js') });
  await page.evaluate(() => window.open('https://hometax.go.kr/websquare/popup.html?w2xPath=/ui/pp/a/b/UTXPPABB27.xml&popupID=$c.pp_UTXPPABB27', '$c.pp_UTXPPABB27', 'width=560,height=420'));
  await expect.poll(() => page.evaluate(() => window.__hookMessages.length)).toBe(2);
  const messages = await page.evaluate(() => window.__hookMessages);
  expect(messages[0].type).toBe('EXTEND_ATTEMPTED_IN_PAGE');
  expect(messages[0].ok).toBe(false);
  expect(messages[1].type).toBe('POPUP_BLOCKED');
  expect(messages[1].url.toLowerCase()).toContain('utxppabb27');
});

test('page_hook timer bridge re-anchors instead of counting a stale login timer to zero', async ({ page }) => {
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
  await page.addScriptTag({ path: path.join(root, 'src/page_hook.js') });
  await expect.poll(() => page.evaluate(() => {
    return window.__hookMessages.find((message) => message.type === 'SESSION_TIMER' && message.secondsLeft === 1800);
  })).toBeTruthy();

  await page.evaluate(() => {
    window.__now += 1_801_000;
    for (const callback of window.__timerCallbacks) callback();
  });

  const lastTimer = await page.evaluate(() => {
    return window.__hookMessages.filter((message) => message.type === 'SESSION_TIMER').at(-1);
  });
  expect(lastTimer.secondsLeft).toBe(1800);
});
