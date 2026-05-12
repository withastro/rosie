#!/usr/bin/env python3
# Tiny HTTP server that serves rosie test fixtures.
#
# Layout under fixtures/repos/ mirrors the GitHub URL paths rosie hits:
#   <owner>/<repo>/archive/refs/heads/<ref>.tar.gz
#   <owner>/<repo>/archive/refs/tags/<ref>.tar.gz
#   <owner>/<repo>/info/refs                 (query string ignored)
#
# Usage:
#   mock_server.py --port 8765 --root /path/to/fixtures/repos
#
# Logs each request to stderr. Exits cleanly on SIGTERM/SIGINT.

import argparse
import http.server
import os
import sys
from urllib.parse import urlparse


class FixtureHandler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):  # noqa: N802 — stdlib API
        parsed = urlparse(self.path)
        # Drop the query string so /info/refs?service=git-upload-pack resolves
        # to the file at info/refs on disk.
        self.path = parsed.path
        return super().do_GET()

    def log_message(self, fmt, *args):
        sys.stderr.write(
            "[mock_server] %s - %s\n" % (self.address_string(), fmt % args)
        )


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, required=True)
    ap.add_argument("--root", required=True, help="Directory to serve")
    args = ap.parse_args()

    os.chdir(args.root)

    # Bind to localhost only — these tests aren't a remote service.
    server = http.server.ThreadingHTTPServer(("127.0.0.1", args.port), FixtureHandler)
    sys.stderr.write("[mock_server] listening on 127.0.0.1:%d, root=%s\n" % (args.port, args.root))
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
