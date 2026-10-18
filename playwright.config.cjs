const { defineConfig } = require('@playwright/test');
module.exports = defineConfig({
  testDir: './e2e', testMatch: '**/*.spec.ts', fullyParallel: false, workers: 1,
  timeout: 45000, expect: { timeout: 12000 }, reporter: 'list',
  use: { channel: process.env.PW_CHANNEL || 'chrome', headless: true, timezoneId: 'America/Vancouver', reducedMotion: 'reduce', trace: 'retain-on-failure' },
  projects: [
    { name: 'desktop-chrome', use: { viewport: { width: 1440, height: 1050 } } },
    { name: 'mobile-chrome', use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } }
  ]
});
