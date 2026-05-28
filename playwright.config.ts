import { defineConfig, devices } from '@playwright/test';

const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
const reportDir = `./test-results/${date}`;

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  outputDir: `${reportDir}/artifacts`,
  // Default reporters — a plain `npx playwright test` writes all three:
  //   • list  → green-tick terminal output (matches the slide-deck screenshot)
  //   • html  → ./test-results/<date>/html  (open with `playwright show-report`)
  //   • json  → ./test-results/<date>/results.json (CI / regression analysis)
  // Pass --reporter=… to override, but adding flags removes the rest, so the
  // default keeps the HTML report alive without anyone remembering to ask.
  reporter: [
    ['list'],
    ['html', { outputFolder: `${reportDir}/html`, open: 'never' }],
    ['json', { outputFile: `${reportDir}/results.json` }],
  ],
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    storageState: './e2e/.auth-state.json',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    // The Edge middleware verifies the JWT. In dev we don't share the
    // backend's JWT_SECRET with the Next server, so we opt into the
    // payload-only validation path (structure + exp + role). Production
    // continues to require the secret — this flag is hard-blocked when
    // NODE_ENV=production.
    env: {
      ALLOW_PAYLOAD_ONLY_AUTH: 'true',
    },
  },
});
