import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const packagePath = path.join(root, 'dist', `${packageJson.name}-chromium-v${packageJson.version}.zip`);

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

async function parseJsonResponse(response, label) {
  const text = await response.text();
  let payload = {};
  try { payload = text ? JSON.parse(text) : {}; }
  catch (_) { payload = { raw: text }; }
  if (!response.ok) {
    throw new Error(`${label} failed (${response.status}): ${JSON.stringify(payload)}`);
  }
  return payload;
}

async function getAccessToken() {
  const body = new URLSearchParams({
    client_id: requiredEnv('CHROME_CLIENT_ID'),
    client_secret: requiredEnv('CHROME_CLIENT_SECRET'),
    refresh_token: requiredEnv('CHROME_REFRESH_TOKEN'),
    grant_type: 'refresh_token'
  });
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body
  });
  const payload = await parseJsonResponse(response, 'OAuth token request');
  if (!payload.access_token) throw new Error('OAuth token response did not include access_token');
  return payload.access_token;
}

async function main() {
  if (!fs.existsSync(packagePath)) {
    throw new Error(`Missing Chromium package. Run npm run build:all first: ${packagePath}`);
  }

  const publisherId = requiredEnv('CHROME_PUBLISHER_ID');
  const itemId = requiredEnv('CHROME_ITEM_ID');
  const itemName = `publishers/${publisherId}/items/${itemId}`;
  const accessToken = await getAccessToken();
  const zipBytes = fs.readFileSync(packagePath);

  const uploadResponse = await fetch(
    `https://chromewebstore.googleapis.com/upload/v2/${itemName}:upload`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${accessToken}`,
        'content-type': 'application/zip'
      },
      body: zipBytes
    }
  );
  const uploadPayload = await parseJsonResponse(uploadResponse, 'Chrome Web Store upload');
  console.log('Chrome Web Store upload response:', JSON.stringify(uploadPayload, null, 2));

  if (process.env.CHROME_SKIP_PUBLISH === '1') {
    console.log('CHROME_SKIP_PUBLISH=1, stopping after upload.');
    return;
  }

  const publishBody = {
    publishType: process.env.CHROME_PUBLISH_TYPE || 'DEFAULT_PUBLISH',
    skipReview: process.env.CHROME_SKIP_REVIEW === '1'
  };

  const publishResponse = await fetch(`https://chromewebstore.googleapis.com/v2/${itemName}:publish`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify(publishBody)
  });
  const publishPayload = await parseJsonResponse(publishResponse, 'Chrome Web Store publish');
  console.log('Chrome Web Store publish response:', JSON.stringify(publishPayload, null, 2));
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : String(err));
  process.exitCode = 1;
});
