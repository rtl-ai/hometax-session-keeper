import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const backgroundPath = path.join(root, 'src', 'background.js');

function createBackgroundHarness() {
  const calls = {
    badgeText: [],
    badgeColor: [],
    createdWindows: [],
    removedWindows: [],
    logs: []
  };
  let listener = null;
  let tabUpdatedListener = null;
  let tabRemovedListener = null;
  let windowRemovedListener = null;
  let nextWindowId = 100;

  const context = {
    URL,
    Date,
    Promise,
    Error,
    Number,
    String,
    Boolean,
    Math,
    Map,
    Set,
    console: {
      log: (...args) => calls.logs.push(args)
    },
    setInterval: () => 0,
    setTimeout: (fn, ms = 0) => {
      if (ms <= 1000) fn();
      return 0;
    }
  };
  context.globalThis = context;
  context.chrome = {
    runtime: {
      lastError: null,
      onMessage: {
        addListener(fn) {
          listener = fn;
        }
      }
    },
    action: {
      setBadgeText(details, callback) {
        calls.badgeText.push({ ...details });
        if (callback) callback();
      },
      setBadgeBackgroundColor(details, callback) {
        calls.badgeColor.push({ ...details });
        if (callback) callback();
      }
    },
    windows: {
      create(createData, callback) {
        const created = { id: nextWindowId++ };
        calls.createdWindows.push({ ...createData, id: created.id });
        if (callback) callback(created);
      },
      remove(windowId, callback) {
        calls.removedWindows.push(windowId);
        if (callback) callback();
      },
      onRemoved: {
        addListener(fn) {
          windowRemovedListener = fn;
        }
      }
    },
    tabs: {
      onUpdated: {
        addListener(fn) {
          tabUpdatedListener = fn;
        }
      },
      onRemoved: {
        addListener(fn) {
          tabRemovedListener = fn;
        }
      }
    }
  };

  vm.createContext(context);
  const source = fs.readFileSync(backgroundPath, 'utf8');
  new vm.Script(source, { filename: backgroundPath }).runInContext(context);
  assert.equal(typeof listener, 'function', 'background listener should be registered');

  async function send(message, sender = {}) {
    let response;
    const defaultSender = {
      url: 'https://hometax.go.kr/websquare/websquare.html',
      frameId: 0,
      tab: { id: 7, windowId: 10 }
    };
    const returnValue = listener(message, { ...defaultSender, ...sender }, (value) => {
      response = JSON.parse(JSON.stringify(value));
    });
    await new Promise((resolve) => setImmediate(resolve));
    return { returnValue, response };
  }

  return {
    calls,
    send,
    triggerTabUpdated(tabId, changeInfo) {
      assert.equal(typeof tabUpdatedListener, 'function', 'tabs.onUpdated listener should be registered');
      tabUpdatedListener(tabId, changeInfo);
    },
    triggerTabRemoved(tabId) {
      assert.equal(typeof tabRemovedListener, 'function', 'tabs.onRemoved listener should be registered');
      tabRemovedListener(tabId);
    },
    triggerWindowRemoved(windowId) {
      assert.equal(typeof windowRemovedListener, 'function', 'windows.onRemoved listener should be registered');
      windowRemovedListener(windowId);
    }
  };
}

test('background updates badge text, color, and rejects invalid timer values', async () => {
  const { calls, send } = createBackgroundHarness();

  const accepted = await send({
    type: 'HOMETAX_SESSION_TIMER',
    secondsLeft: 125,
    source: 'prompt',
    frame: 'top'
  });

  assert.deepEqual(accepted.response, { ok: true });
  assert.deepEqual(calls.badgeText.at(-1), { tabId: 7, text: '3m' });
  assert.deepEqual(calls.badgeColor.at(-1), { tabId: 7, color: '#ef6c00' });

  const rejected = await send({
    type: 'HOMETAX_SESSION_TIMER',
    secondsLeft: -1,
    source: 'prompt',
    frame: 'top'
  });

  assert.deepEqual(rejected.response, { ok: false, error: 'invalid secondsLeft' });
  assert.equal(calls.badgeText.length, 1, 'invalid values must not mutate the badge');
});

test('background ignores stale subframe timers after a successful extension reset', async () => {
  const { calls, send } = createBackgroundHarness();

  await send({
    type: 'HOMETAX_SESSION_TIMER',
    secondsLeft: 1800,
    source: 'page-direct-extend',
    frame: 'top'
  });
  assert.equal(calls.badgeText.at(-1).text, '30m');

  const subframe = await send({
    type: 'HOMETAX_SESSION_TIMER',
    secondsLeft: 25,
    source: 'ntsLoginVo',
    frame: 'subframe'
  }, { frameId: 3 });

  assert.deepEqual(subframe.response, {
    ok: true,
    ignored: true,
    reason: 'stale-or-subframe-timer'
  });
  assert.equal(calls.badgeText.at(-1).text, '30m');

  const staleTopFrame = await send({
    type: 'HOMETAX_SESSION_TIMER',
    secondsLeft: 25,
    source: 'ntsLoginVo',
    frame: 'top'
  });

  assert.deepEqual(staleTopFrame.response, {
    ok: true,
    ignored: true,
    reason: 'stale-or-subframe-timer'
  });
  assert.equal(calls.badgeText.at(-1).text, '30m');

  const plausibleTopFrame = await send({
    type: 'HOMETAX_SESSION_TIMER',
    secondsLeft: 1500,
    source: 'ntsLoginVo',
    frame: 'top'
  });

  assert.deepEqual(plausibleTopFrame.response, { ok: true });
  assert.equal(calls.badgeText.at(-1).text, '25m');
});

test('background only opens validated Hometax timeout fallback popups', async () => {
  const { calls, send } = createBackgroundHarness();

  const rejectedSender = await send({
    type: 'HOMETAX_OPEN_BLOCKED_SESSION_POPUP',
    url: 'https://hometax.go.kr/websquare/popup.html?w2xPath=/ui/pp/a/b/UTXPPABB27.xml',
    openerUrl: 'https://hometax.go.kr/websquare/websquare.html',
    reason: 'blocked'
  }, { url: 'https://example.com/' });

  assert.deepEqual(rejectedSender.response, { ok: false, error: 'sender rejected' });
  assert.equal(calls.createdWindows.length, 0);

  const rejectedUrl = await send({
    type: 'HOMETAX_OPEN_BLOCKED_SESSION_POPUP',
    url: 'https://hometax.go.kr/not-a-session-page',
    openerUrl: 'https://hometax.go.kr/websquare/websquare.html',
    reason: 'blocked'
  });

  assert.equal(rejectedUrl.response.ok, false);
  assert.match(rejectedUrl.response.error, /known Hometax session-extension popup/);
  assert.equal(calls.createdWindows.length, 0);

  const rejectedBroadLogout = await send({
    type: 'HOMETAX_OPEN_BLOCKED_SESSION_POPUP',
    url: 'https://hometax.go.kr/logout?timeout=session',
    openerUrl: 'https://hometax.go.kr/websquare/websquare.html',
    reason: 'blocked'
  });

  assert.equal(rejectedBroadLogout.response.ok, false);
  assert.match(rejectedBroadLogout.response.error, /known Hometax session-extension popup/);
  assert.equal(calls.createdWindows.length, 0);

  const opened = await send({
    type: 'HOMETAX_OPEN_BLOCKED_SESSION_POPUP',
    url: 'https://hometax.go.kr/websquare/popup.html?w2xPath=/ui/pp/a/b/UTXPPABB27.xml&popupID=$c.pp_UTXPPABB27',
    openerUrl: 'https://hometax.go.kr/websquare/websquare.html',
    reason: 'blocked'
  });

  assert.equal(opened.response.ok, true);
  assert.equal(opened.response.skipped, false);
  assert.equal(opened.response.windowId, 100);
  assert.equal(calls.createdWindows.length, 1);
  assert.match(calls.createdWindows[0].url, /UTXPPABB27/);

  const skipped = await send({
    type: 'HOMETAX_OPEN_BLOCKED_SESSION_POPUP',
    url: 'https://hometax.go.kr/websquare/popup.html?w2xPath=/ui/pp/a/b/UTXPPABB27.xml&popupID=$c.pp_UTXPPABB27',
    openerUrl: 'https://hometax.go.kr/websquare/websquare.html',
    reason: 'blocked'
  });

  assert.deepEqual(skipped.response, { ok: true, skipped: true, reason: 'cooldown' });
  assert.equal(calls.createdWindows.length, 1);
});

test('background closes its own fallback popup after an extend click', async () => {
  const { calls, send } = createBackgroundHarness();

  await send({
    type: 'HOMETAX_OPEN_BLOCKED_SESSION_POPUP',
    url: 'https://hometax.go.kr/websquare/popup.html?w2xPath=/ui/pp/a/b/UTXPPABB27.xml',
    openerUrl: 'https://hometax.go.kr/websquare/websquare.html',
    reason: 'blocked'
  });

  const clicked = await send({
    type: 'HOMETAX_SESSION_EXTEND_CLICKED',
    secondsLeft: 1800
  }, {
    tab: { id: 7, windowId: 100 }
  });

  assert.equal(clicked.response.ok, true);
  assert.equal(clicked.response.closed, true);
  assert.equal(clicked.response.windowId, 100);
  assert.deepEqual(calls.removedWindows, [100]);
  assert.equal(calls.badgeText.at(-1).text, '30m');
});

test('background validates timer senders and clears badges on navigation', async () => {
  const { calls, send, triggerTabUpdated, triggerTabRemoved } = createBackgroundHarness();

  const rejectedTimer = await send({
    type: 'HOMETAX_SESSION_TIMER',
    secondsLeft: 120,
    source: 'prompt',
    frame: 'top'
  }, { url: 'https://example.com/' });

  assert.deepEqual(rejectedTimer.response, { ok: false, error: 'sender rejected' });
  assert.equal(calls.badgeText.length, 0);

  await send({
    type: 'HOMETAX_SESSION_TIMER',
    secondsLeft: 120,
    source: 'prompt',
    frame: 'top'
  });
  assert.equal(calls.badgeText.at(-1).text, '2m');

  triggerTabUpdated(7, { status: 'loading' });
  assert.deepEqual(calls.badgeText.at(-1), { tabId: 7, text: '' });

  await send({
    type: 'HOMETAX_SESSION_TIMER',
    secondsLeft: 1800,
    source: 'prompt',
    frame: 'top'
  });
  assert.equal(calls.badgeText.at(-1).text, '30m');

  triggerTabRemoved(7);
  const staleAfterRemoved = await send({
    type: 'HOMETAX_SESSION_TIMER',
    secondsLeft: 20,
    source: 'ntsLoginVo',
    frame: 'top'
  });

  assert.deepEqual(staleAfterRemoved.response, { ok: true });
  assert.equal(calls.badgeText.at(-1).text, '20s');
});

test('background accepts explicit badge clear and closes known session popups after restart', async () => {
  const { calls, send, triggerWindowRemoved } = createBackgroundHarness();

  await send({
    type: 'HOMETAX_SESSION_TIMER',
    secondsLeft: 300,
    source: 'prompt',
    frame: 'top'
  });
  assert.equal(calls.badgeText.at(-1).text, '5m');

  const cleared = await send({
    type: 'HOMETAX_CLEAR_SESSION_BADGE',
    reason: 'disabled-context'
  });
  assert.deepEqual(cleared.response, { ok: true });
  assert.deepEqual(calls.badgeText.at(-1), { tabId: 7, text: '' });

  const clickedKnownPopup = await send({
    type: 'HOMETAX_SESSION_EXTEND_CLICKED',
    secondsLeft: 1800
  }, {
    url: 'https://hometax.go.kr/websquare/popup.html?w2xPath=/ui/pp/a/b/UTXPPABB27.xml',
    tab: { id: 9, windowId: 123 }
  });

  assert.equal(clickedKnownPopup.response.ok, true);
  assert.equal(clickedKnownPopup.response.closed, true);
  assert.equal(clickedKnownPopup.response.windowId, 123);
  assert.equal(calls.removedWindows.at(-1), 123);

  triggerWindowRemoved(123);
});
