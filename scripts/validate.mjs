import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const requiredFiles = [
  'src/content_script.js',
  'src/page_hook.js',
  'src/background.js',
  'manifests/chromium.mv3.json',
  'manifests/firefox.mv3.json',
  'manifests/firefox.mv2.json',
  'manifests/safari.mv3.json',
  'CHANGELOG.md',
  'AGENTS.md',
  'CLAUDE.md',
  'PRIVACY.md',
  'SECURITY.md',
  'SUPPORT.md',
  'README.md',
  'package-lock.json',
  'docs/manual-test.md',
  'docs/production-readiness.md',
  'docs/store-submission.md'
];

for (const rel of requiredFiles) {
  if (!fs.existsSync(path.join(root, rel))) throw new Error(`Missing required file: ${rel}`);
}

for (const rel of [
  'src/content_script.js',
  'src/page_hook.js',
  'src/background.js',
  'scripts/build.mjs',
  'scripts/validate.mjs',
  'scripts/serve-fixtures.mjs',
  'scripts/publish-chrome.mjs',
  'scripts/publish-firefox.mjs'
]) {
  execFileSync(process.execPath, ['--check', path.join(root, rel)], { stdio: 'inherit' });
}

const forbiddenPermissions = new Set(['cookies', 'history', 'bookmarks', 'storage', 'tabs', 'activeTab', 'webRequest', 'webRequestBlocking', 'debugger']);
const packageVersion = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
const lockVersion = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8')).version;
if (lockVersion !== packageVersion) throw new Error(`package-lock.json version ${lockVersion} does not match package.json ${packageVersion}`);

for (const manifestName of fs.readdirSync(path.join(root, 'manifests')).filter((f) => f.endsWith('.json'))) {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifests', manifestName), 'utf8'));
  if (manifest.version !== packageVersion) throw new Error(`${manifestName} version ${manifest.version} does not match package.json ${packageVersion}`);
  for (const permission of manifest.permissions || []) {
    if (forbiddenPermissions.has(permission)) throw new Error(`${manifestName} contains forbidden permission: ${permission}`);
  }
  const matchValues = [];
  for (const cs of manifest.content_scripts || []) matchValues.push(...(cs.matches || []));
  for (const pattern of matchValues) {
    if (!pattern.includes('hometax.go.kr')) throw new Error(`${manifestName} contains non-Hometax content script match: ${pattern}`);
  }
  if (JSON.stringify(manifest).includes('<all_urls>')) throw new Error(`${manifestName} must not use <all_urls>`);
}

const content = fs.readFileSync(path.join(root, 'src/content_script.js'), 'utf8');
for (const text of ['sessionOut', '로그아웃 시간이', '로그인 시간을 연장하시겠습니까', '연장하기', 'mf_trigger16']) {
  if (!content.includes(text)) throw new Error(`content_script.js is missing detection string: ${text}`);
}
const combinedSource = ['content_script.js', 'page_hook.js', 'background.js']
  .map((file) => fs.readFileSync(path.join(root, 'src', file), 'utf8'))
  .join('\n');
for (const forbidden of ['document.cookie', 'localStorage', 'sessionStorage', 'indexedDB', 'XMLHttpRequest']) {
  if (combinedSource.includes(forbidden)) throw new Error(`src contains forbidden browser data access: ${forbidden}`);
}

console.log('Validation passed.');
