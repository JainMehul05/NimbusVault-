// Keeps the existing application and its SIGTERM drain path unchanged on Windows.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const token = crypto.randomBytes(32).toString('hex');
const control = http.createServer((req, res) => {
  if (req.method !== 'POST' || req.url !== '/shutdown' || req.headers['x-launcher-token'] !== token) {
    res.writeHead(403).end(); return;
  }
  res.end('Draining');
  control.close();
  process.emit('SIGTERM');
});
control.listen(0, '127.0.0.1', () => {
  fs.writeFileSync(path.join(root, '.runtime/launcher-control/api.json'), JSON.stringify({
    pid: process.pid, port: control.address().port, token
  }));
  require(path.join(root, 'backend/dist/main.js'));
});
