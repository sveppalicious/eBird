import { defineConfig, devices } from '@playwright/test';

// The site is static, so the "server" is python's http.server pointed at site/.
// serve.py sends Cache-Control: no-store, which matters here for the same
// reason it matters in development: ES modules and JSON cache hard, and a run
// against a stale module tests the previous commit.
export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',

  use: {
    baseURL: 'http://127.0.0.1:8788',
    trace: 'on-first-retry',
    // A desktop viewport: several controls wrap on a phone and the map is only
    // a couple of hundred pixels wide, which makes coordinate clicks fragile.
    viewport: { width: 1280, height: 900 }
  },

  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } }
  ],

  webServer: {
    command: './serve.py 8788',
    url: 'http://127.0.0.1:8788/index.html',
    reuseExistingServer: !process.env.CI,
    stdout: 'ignore',
    stderr: 'pipe'
  }
});
