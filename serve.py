#!/usr/bin/env python3
"""Static server for site/, with caching turned off.

Plain `python3 -m http.server` lets the browser cache aggressively, and ES
modules in particular stay cached across reloads. That is exactly wrong here:
the whole point of this project is that site/data/ gets regenerated whenever a
new quarterly EBD lands, and you want the browser to notice.
"""

import functools
import http.server
import os
import sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8777
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "site")


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def log_message(self, fmt, *args):  # quieter than the default
        if not args or "200" not in str(args):
            super().log_message(fmt, *args)


if __name__ == "__main__":
    handler = functools.partial(NoCacheHandler, directory=ROOT)
    print(f"eBird Iceland sveitarfelog -> http://127.0.0.1:{PORT}")
    http.server.ThreadingHTTPServer(("127.0.0.1", PORT), handler).serve_forever()
