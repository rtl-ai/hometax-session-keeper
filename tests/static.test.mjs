import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

test('all manifests scope content scripts to Hometax only', () => {
  const manifestDir = path.join(root, 'manifests');
  for (const file of fs.readdirSync(manifestDir).filter((name) => name.endsWith('.json'))) {
    const manifest = JSON.parse(fs.readFileSync(path.join(manifestDir, file), 'utf8'));
    assert.notEqual(JSON.stringify(manifest).includes('<all_urls>'), true, `${file} must not use <all_urls>`);
    assert.notEqual(JSON.stringify(manifest).includes('match_about_blank'), true, `${file} must not inject into about:blank frames`);
    assert.notEqual(JSON.stringify(manifest).includes('match_origin_as_fallback'), true, `${file} must not inject via origin fallback`);
    for (const cs of manifest.content_scripts || []) {
      for (const pattern of cs.matches || []) assert.match(pattern, /hometax\.go\.kr/);
    }
  }
});

test('Firefox builds only target versions with manifest MAIN world support', () => {
  const manifestDir = path.join(root, 'manifests');
  for (const file of ['firefox.mv2.json', 'firefox.mv3.json']) {
    const manifest = JSON.parse(fs.readFileSync(path.join(manifestDir, file), 'utf8'));
    assert.equal(manifest.browser_specific_settings.gecko.strict_min_version, '128.0');
  }
});

test('content script uses exact Hometax session prompt signals', () => {
  const text = fs.readFileSync(path.join(root, 'src', 'content_script.js'), 'utf8');
  for (const expected of ['sessionOut', '로그아웃 시간이', '로그아웃을 연장하시려면', '로그인 시간을 연장하시겠습니까', 'mf_trigger16', '연장하기']) {
    assert.ok(text.includes(expected), `missing ${expected}`);
  }
});

test('blocked popup fallback recognizes the current Hometax session-extension popup route', () => {
  const hook = fs.readFileSync(path.join(root, 'src', 'page_hook.js'), 'utf8');
  const background = fs.readFileSync(path.join(root, 'src', 'background.js'), 'utf8');
  for (const expected of ['UTXPPABB27']) {
    assert.ok(hook.toLowerCase().includes(expected.toLowerCase()), `page hook missing ${expected}`);
    assert.ok(background.toLowerCase().includes(expected.toLowerCase()), `background missing ${expected}`);
  }
});

test('fallback popup heuristics are allowlisted to the known session-extension route', () => {
  const hook = fs.readFileSync(path.join(root, 'src', 'page_hook.js'), 'utf8');
  const background = fs.readFileSync(path.join(root, 'src', 'background.js'), 'utf8');
  assert.ok(background.includes('URL is not the known Hometax session-extension popup'));
  assert.ok(hook.includes('SESSION_POPUP_CODES.some'));
  assert.equal(background.includes('hasLogout'), false);
  assert.equal(hook.includes('hasLogout'), false);
});

test('blocked Hometax timeout popup can extend the original page context directly', () => {
  const hook = fs.readFileSync(path.join(root, 'src', 'page_hook.js'), 'utf8');
  const content = fs.readFileSync(path.join(root, 'src', 'content_script.js'), 'utf8');
  const background = fs.readFileSync(path.join(root, 'src', 'background.js'), 'utf8');
  for (const expected of [
    'attemptDirectSessionExtend',
    '$c.pp.sessionXtn',
    'sessionTimer("N")',
    'EXTEND_ATTEMPTED_IN_PAGE',
    'page-direct-extend'
  ]) {
    assert.ok(`${hook}\n${content}\n${background}`.includes(expected), `missing ${expected}`);
  }
});

test('extension code avoids sensitive browser data APIs', () => {
  const combined = ['content_script.js', 'page_hook.js', 'background.js']
    .map((file) => fs.readFileSync(path.join(root, 'src', file), 'utf8'))
    .join('\n');
  for (const forbidden of ['document.cookie', 'localStorage', 'sessionStorage', 'indexedDB', 'XMLHttpRequest']) {
    assert.equal(combined.includes(forbidden), false, `forbidden token found: ${forbidden}`);
  }
});

test('login and certificate pages are excluded from active hooks', () => {
  const content = fs.readFileSync(path.join(root, 'src', 'content_script.js'), 'utf8');
  const hook = fs.readFileSync(path.join(root, 'src', 'page_hook.js'), 'utf8');
  for (const expected of ['initPage=login', 'UTXPPABC14', 'yessign.or.kr', 'ancestorOrigins', 'document.referrer']) {
    assert.ok(content.toLowerCase().includes(expected.toLowerCase()), `content script missing ${expected}`);
    assert.ok(hook.toLowerCase().includes(expected.toLowerCase()), `page hook missing ${expected}`);
  }
});

test('icon badge is driven only by numeric session timer fields', () => {
  const hook = fs.readFileSync(path.join(root, 'src', 'page_hook.js'), 'utf8');
  const background = fs.readFileSync(path.join(root, 'src', 'background.js'), 'utf8');
  assert.ok(hook.includes('ntsLoginVo'));
  assert.ok(hook.includes('FN_CURRENT_TIME'));
  assert.ok(hook.includes('FN_MAX_TIME'));
  assert.ok(hook.includes('TIMER_HEARTBEAT_MS'));
  assert.ok(hook.includes('timerAnchor'));
  assert.ok(background.includes('setBadgeText'));
  assert.ok(background.includes('MSG_SESSION_TIMER'));
});

test('timer bridge survives repeated page hook injection and has a logged-in fallback', () => {
  const hook = fs.readFileSync(path.join(root, 'src', 'page_hook.js'), 'utf8');
  const content = fs.readFileSync(path.join(root, 'src', 'content_script.js'), 'utf8');
  assert.ok(hook.includes('TIMER_BRIDGE_INSTALL_FLAG'));
  assert.ok(hook.includes('hookAlreadyInstalled'));
  assert.ok(content.includes('content-estimated-login'));
  assert.ok(content.includes('AUTHORITATIVE_TIMER_STALE_MS'));
  assert.ok(content.includes('pageLooksLoggedIn'));
});

test('low timer path proactively requests a direct in-page session extension', () => {
  const hook = fs.readFileSync(path.join(root, 'src', 'page_hook.js'), 'utf8');
  const content = fs.readFileSync(path.join(root, 'src', 'content_script.js'), 'utf8');
  for (const expected of [
    'PROACTIVE_EXTEND_THRESHOLD_SECONDS',
    'REQUEST_DIRECT_EXTEND',
    'HOMETAX_AUTO_EXTEND_CONTENT_SCRIPT',
    'proactive-low-timer:',
    'performDirectSessionExtend'
  ]) {
    assert.ok(`${hook}\n${content}`.includes(expected), `missing ${expected}`);
  }
});

test('Hometax service-stop block pages clear state instead of pretending to be active sessions', () => {
  const content = fs.readFileSync(path.join(root, 'src', 'content_script.js'), 'utf8');
  assert.ok(content.includes('blockPage.html?msg=stop'));
  assert.ok(content.includes('서비스 중지 시간'));
  assert.ok(content.includes('hometax-service-stopped'));
});
