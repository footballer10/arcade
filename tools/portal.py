#!/usr/bin/env python3
"""Developer tuning portal: serves the arcade on THIS computer only and lets the portal save tuning files.

    python3 tools/portal.py            (then the browser opens http://localhost:8000/?portal=1)
    python3 tools/portal.py 8080       (another port)

It listens on 127.0.0.1 only, so nobody else on the network can open it. The only thing it can write is
games/<id>/tuning.js (the "Save as defaults" button). Everything else is read-only static files, same as GitHub Pages.
Needs nothing but Python 3. Stop it with Ctrl+C.
"""
import http.server
import json
import os
import re
import sys
import threading
import webbrowser
from urllib.parse import urlparse, parse_qs

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8000


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map,
                      '.js': 'text/javascript', '.mjs': 'text/javascript', '.svg': 'image/svg+xml',
                      '.json': 'application/json', '.wasm': 'application/wasm'}

    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')   # edits show up on refresh
        super().end_headers()

    def log_message(self, fmt, *args):
        if self.command != 'GET':
            super().log_message(fmt, *args)

    def _reply(self, code, body, ctype='application/json'):
        data = body.encode()
        self.send_response(code)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if urlparse(self.path).path == '/__portal':
            return self._reply(200, json.dumps({'ok': True}))
        return super().do_GET()

    def do_PUT(self):
        url = urlparse(self.path)
        if url.path != '/__portal/save':
            return self._reply(404, 'not found', 'text/plain')
        game = (parse_qs(url.query).get('game') or [''])[0]
        if not re.fullmatch(r'[A-Za-z0-9_-]+', game):
            return self._reply(400, 'bad game id', 'text/plain')
        target = os.path.join(ROOT, 'games', game, 'tuning.js')
        if not os.path.isfile(target):
            return self._reply(404, f'games/{game}/tuning.js does not exist', 'text/plain')
        length = int(self.headers.get('Content-Length') or 0)
        if length <= 0 or length > 200_000:
            return self._reply(400, 'bad size', 'text/plain')
        text = self.rfile.read(length).decode('utf-8')
        if 'tunable(' not in text:
            return self._reply(400, 'that does not look like a tuning file', 'text/plain')
        with open(target, 'w', encoding='utf-8', newline='\n') as f:
            f.write(text)
        print(f'  saved games/{game}/tuning.js')
        return self._reply(200, json.dumps({'ok': True}))


def main():
    server = http.server.ThreadingHTTPServer(('127.0.0.1', PORT), Handler)
    url = f'http://localhost:{PORT}/?portal=1'
    print(f'Tuning portal running at {url}  (this computer only, Ctrl+C to stop)')
    threading.Timer(0.6, lambda: webbrowser.open(url)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('\nstopped')


if __name__ == '__main__':
    main()
