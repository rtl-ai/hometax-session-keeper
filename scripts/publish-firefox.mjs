import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const sourceDir = process.env.FIREFOX_SOURCE_DIR || path.join(root, 'dist', 'firefox-mv3');
const artifactsDir = process.env.FIREFOX_ARTIFACTS_DIR || path.join(root, 'release', 'firefox');
const channel = process.env.AMO_CHANNEL || 'listed';
const apiKey = process.env.AMO_JWT_ISSUER || process.env.WEB_EXT_API_KEY;
const apiSecret = process.env.AMO_JWT_SECRET || process.env.WEB_EXT_API_SECRET;

if (!apiKey) throw new Error('Missing AMO_JWT_ISSUER or WEB_EXT_API_KEY');
if (!apiSecret) throw new Error('Missing AMO_JWT_SECRET or WEB_EXT_API_SECRET');
if (!fs.existsSync(path.join(sourceDir, 'manifest.json'))) {
  throw new Error(`Missing Firefox build manifest. Run npm run build:all first: ${sourceDir}`);
}
fs.mkdirSync(artifactsDir, { recursive: true });

const args = [
  '--yes',
  'web-ext@8',
  'sign',
  '--source-dir',
  sourceDir,
  '--artifacts-dir',
  artifactsDir,
  '--channel',
  channel,
  '--api-key',
  apiKey,
  '--api-secret',
  apiSecret
];

execFileSync('npx', args, { cwd: root, stdio: 'inherit' });
