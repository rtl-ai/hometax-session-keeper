import { defineConfig } from '@playwright/test';

const chromeChannel = process.env.PLAYWRIGHT_CHROME_CHANNEL || undefined;

export default defineConfig({
  use: {
    browserName: 'chromium',
    ...(chromeChannel ? { channel: chromeChannel } : {})
  }
});
