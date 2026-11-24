/**
 * Runs a command with the test environment. Values already set win, so CI (and the substitute
 * database used when Docker is unavailable) can point the suites elsewhere.
 */
const { spawnSync } = require('child_process');

const defaults = {
  NODE_ENV: 'test',
  API_PREFIX: 'v1',
  DATABASE_URL: 'postgresql://postgres:postgres@localhost:5433/nimbusvault_test?schema=public',
  JWT_ACCESS_SECRET: 'test-access-secret-min-32-characters-long',
  JWT_REFRESH_SECRET: 'test-refresh-secret-min-32-characters-long',
  JWT_ACCESS_EXPIRES_IN: '15m',
  JWT_REFRESH_EXPIRES_IN: '7d',
  BCRYPT_ROUNDS: '4',
  FRONTEND_URL: 'http://localhost:5173',
  PORT: '3000',
  AWS_REGION: 'us-east-1',
  AWS_ACCESS_KEY_ID: 'test',
  AWS_SECRET_ACCESS_KEY: 'test',
  AWS_S3_BUCKET: 'nimbusvault',
  S3_ENDPOINT: 'http://localhost:4566',
  S3_FORCE_PATH_STYLE: 'true',
  AI_EMBEDDING_PROVIDER: 'none',
  AI_GENERATION_PROVIDER: 'none',
  NODE_OPTIONS: '--experimental-vm-modules',
};

const [command, ...args] = process.argv.slice(2);
const result = spawnSync(command, args, { stdio: 'inherit', shell: true, env: { ...defaults, ...process.env } });
process.exit(result.status ?? 1);
