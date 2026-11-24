/** Container health check. `http`: the API answers. `worker`: the heartbeat file is fresh. */
const fs = require('fs');

const fail = () => process.exit(1);
const mode = process.argv[2];

if (mode === 'worker') {
  const file = process.env.AI_WORKER_HEARTBEAT_FILE || '/tmp/worker-heartbeat';
  try {
    if (Date.now() - fs.statSync(file).mtimeMs > 90_000) fail();
  } catch {
    fail();
  }
} else {
  const prefix = (process.env.API_PREFIX || 'v1').replace(/^\/?(api\/)?|\/$/g, '');
  fetch(`http://127.0.0.1:${process.env.PORT || 3000}/api/${prefix}/health`, { signal: AbortSignal.timeout(4000) })
    .then((r) => process.exit(r.ok ? 0 : 1))
    .catch(fail);
}
