import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  testMatch: ['text-box-zoom.spec.ts', 'arc-refresh-screens.spec.ts', 'player-home-contrast.spec.ts', 'coach-wide-layout.spec.ts', 'training.spec.ts', 'season-plan.spec.ts', 'positions.spec.ts', 'player-roles.spec.ts', 'player-objectives.spec.ts', 'formations.spec.ts', 'lineup-pitch.spec.ts', 'watch-first.spec.ts', 'season-plan-share.spec.ts', 'season-plan-card.spec.ts', 'evaluation.spec.ts', 'my-season-card.spec.ts', 'family-season-page.spec.ts', 'family-season-plan.spec.ts', 'language.spec.ts', 'player-evaluation.spec.ts'],
  timeout: 45_000,
  retries: 0,
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:4189',
    viewport: { width: 390, height: 844 },
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: process.env.PW_CHROMIUM_EXECUTABLE
      ? { executablePath: process.env.PW_CHROMIUM_EXECUTABLE } : {},
  },
  webServer: {
    command: 'npm run preview -- --host 127.0.0.1 --port 4189',
    url: 'http://127.0.0.1:4189',
    reuseExistingServer: false,
  },
})
