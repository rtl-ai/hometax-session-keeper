import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const dist = path.join(root, 'dist');
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const version = packageJson.version;
const packageName = packageJson.name;
const args = new Set(process.argv.slice(2));
const debugLocal = args.has('--debug-local');

const targetConfigs = [
  { name: debugLocal ? 'chromium-debug-local' : 'chromium', manifest: 'chromium.mv3.json', packageExt: 'zip' },
  { name: debugLocal ? 'firefox-mv3-debug-local' : 'firefox-mv3', manifest: 'firefox.mv3.json', packageExt: 'xpi' },
  { name: 'firefox-mv2', manifest: 'firefox.mv2.json', packageExt: 'xpi', skipInDebug: true },
  { name: 'safari-src', manifest: 'safari.mv3.json', packageExt: 'zip', skipInDebug: true }
].filter((target) => !(debugLocal && target.skipInDebug));

function rmrf(p) { fs.rmSync(p, { recursive: true, force: true }); }
function mkdirp(p) { fs.mkdirSync(p, { recursive: true }); }
function copyFile(src, dest) { mkdirp(path.dirname(dest)); fs.copyFileSync(src, dest); }
function readText(p) { return fs.readFileSync(p, 'utf8'); }
function writeText(p, value) { mkdirp(path.dirname(p)); fs.writeFileSync(p, value); }

function transformDebugSource(text) {
  return debugLocal ? text.replaceAll('const DEBUG_ALLOW_LOCALHOST = false;', 'const DEBUG_ALLOW_LOCALHOST = true;') : text;
}

function addDebugLocalManifestAccess(manifest) {
  if (!debugLocal) return manifest;
  manifest.name += ' (debug local)';
  const localMatches = ['http://127.0.0.1:8787/*', 'http://localhost:8787/*'];
  for (const cs of manifest.content_scripts || []) cs.matches = [...new Set([...(cs.matches || []), ...localMatches])];
  for (const war of manifest.web_accessible_resources || []) {
    if (typeof war === 'object') war.matches = [...new Set([...(war.matches || []), ...localMatches])];
  }
  return manifest;
}

function readManifest(fileName) {
  const manifest = JSON.parse(readText(path.join(root, 'manifests', fileName)));
  return addDebugLocalManifestAccess(manifest);
}

function writeTarget(target) {
  const outDir = path.join(dist, target.name);
  rmrf(outDir);
  mkdirp(outDir);

  writeText(path.join(outDir, 'manifest.json'), JSON.stringify(readManifest(target.manifest), null, 2) + '\n');

  for (const file of ['content_script.js', 'page_hook.js', 'background.js']) {
    writeText(path.join(outDir, file), transformDebugSource(readText(path.join(root, 'src', file))));
  }
  for (const size of [16, 32, 48, 128]) {
    copyFile(path.join(root, 'assets', 'icons', `icon-${size}.png`), path.join(outDir, 'icons', `icon-${size}.png`));
  }
  return outDir;
}

function zipDir(srcDir, outFile) {
  fs.rmSync(outFile, { force: true });
  execFileSync('zip', ['-qr', outFile, '.'], { cwd: srcDir, stdio: 'inherit' });
}

rmrf(dist);
mkdirp(dist);

const built = [];
for (const target of targetConfigs) {
  const outDir = writeTarget(target);
  built.push(outDir);
  const base = `${packageName}-${target.name}-v${version}`;
  const primary = path.join(dist, `${base}.${target.packageExt}`);
  zipDir(outDir, primary);
  if (target.packageExt === 'xpi') zipDir(outDir, path.join(dist, `${base}.zip`));
}

console.log(`Built ${built.length} target(s):`);
for (const p of built) console.log(`- ${path.relative(root, p)}`);
console.log(`Packages are in ${path.relative(root, dist)}/`);
