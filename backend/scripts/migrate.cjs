/**
 * Applies pending migrations using the same database settings as the application (including
 * DB_* parts and the TLS CA bundle), without npx so it works on a read-only filesystem.
 */
const { spawnSync } = require('child_process');
const path = require('path');
const { config } = require('../dist/config');

if (!config.database.url) {
  console.error('No database configured: set DATABASE_URL, or DB_HOST, DB_USER and DB_PASSWORD');
  process.exit(1);
}
const cli = require.resolve('prisma/build/index.js');
const result = spawnSync(process.execPath, [cli, 'migrate', 'deploy'], {
  cwd: path.join(__dirname, '..'),
  stdio: 'inherit',
  env: { ...process.env, DATABASE_URL: config.database.url },
});
process.exit(result.status ?? 1);
