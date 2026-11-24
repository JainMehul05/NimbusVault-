import { defineConfig, devices } from '@playwright/test'

/**
 * Drives the production builds of both apps against real PostgreSQL and S3-compatible storage
 * (docker compose up -d postgres localstack, or any substitute named in the environment).
 * Build first: npm run build --workspace=backend --workspace=frontend
 */
const API_PORT = 3000
const WEB_PORT = 4173
const env = {
  NODE_ENV: 'development',
  PORT: String(API_PORT),
  API_PREFIX: 'v1',
  DATABASE_URL: 'postgresql://postgres:postgres@localhost:5433/nimbusvault_e2e?schema=public',
  JWT_ACCESS_SECRET: 'e2e-access-secret-0123456789-abcdefghijk',
  JWT_REFRESH_SECRET: 'e2e-refresh-secret-0123456789-abcdefghij',
  BCRYPT_ROUNDS: '4',
  FRONTEND_URL: `http://localhost:${WEB_PORT}`,
  AWS_REGION: 'us-east-1',
  AWS_ACCESS_KEY_ID: 'test',
  AWS_SECRET_ACCESS_KEY: 'test',
  AWS_S3_BUCKET: 'nimbusvault',
  S3_ENDPOINT: 'http://localhost:4566',
  S3_FORCE_PATH_STYLE: 'true',
  RATE_LIMIT_MAX: '100000',
  AUTH_RATE_LIMIT_MAX: '10000',
  REFRESH_RATE_LIMIT_MAX: '10000',
  AI_EMBEDDING_PROVIDER: 'local',
  AI_GENERATION_PROVIDER: 'none',
  AI_WORKER_POLL_MS: '500',
  LOG_LEVEL: 'warn',
}

export default defineConfig({
  testDir: './tests',
  outputDir: './test-results',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    ...devices['Desktop Chrome'],
  },
  webServer: [
    {
      command: 'npx prisma migrate deploy && node dist/main.js',
      cwd: '../backend',
      url: `http://localhost:${API_PORT}/api/v1/health/ready`,
      timeout: 90_000,
      reuseExistingServer: !process.env.CI,
      env: { ...env, ...(process.env as Record<string, string>) },
    },
    {
      command: 'npx vite preview --port 4173 --strictPort',
      cwd: '../frontend',
      url: `http://localhost:${WEB_PORT}`,
      reuseExistingServer: !process.env.CI,
    },
  ],
})
