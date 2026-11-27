"""Private Windows launcher control; drain Uvicorn instead of terminating Python."""
import json
import os
import secrets
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

import uvicorn

ROOT = Path(__file__).resolve().parents[1]
token = secrets.token_hex(32)
server = uvicorn.Server(uvicorn.Config('app.internal:app', host='127.0.0.1', port=8101,
    access_log=False, timeout_graceful_shutdown=25))


class Control(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path != '/status' or not secrets.compare_digest(
                self.headers.get('x-launcher-token', ''), token):
            self.send_error(403)
            return
        from app.embeddings import engine
        from app.rag import generation_lock
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(json.dumps({'embeddings_loaded': engine.model is not None,
                                    'generation_busy': generation_lock.locked()}).encode())

    def do_POST(self):
        if self.path != '/shutdown' or not secrets.compare_digest(
                self.headers.get('x-launcher-token', ''), token):
            self.send_error(403)
            return
        self.send_response(200)
        self.end_headers()
        self.wfile.write(b'Draining')
        server.should_exit = True

    def log_message(self, *args):
        pass


if __name__ == '__main__':
    # The script lives outside intelligence/, whose app package is loaded as usual.
    import sys
    sys.path.insert(0, str(ROOT / 'intelligence'))
    control = HTTPServer(('127.0.0.1', 0), Control)
    (ROOT / '.runtime/launcher-control/intelligence.json').write_text(json.dumps({
        'pid': os.getpid(), 'port': control.server_port, 'token': token}))
    threading.Thread(target=control.serve_forever, daemon=True).start()
    try:
        server.run()
    finally:
        control.shutdown()
        control.server_close()
