#!/usr/bin/env python3
# server.py — widget server for list-actions-terminal-on-submit
# Phase 138: interactive-messages templates + modes
# Source: substrate/skills/interactive-messages/templates/list-actions-terminal-on-submit/
#
# Binds to 127.0.0.1:$PORT, serves widget.html at / and POST /submit for
# writing state.json so the agent can read the list-actions result. Python stdlib only
# — zero external dependencies, zero build step.
#
# The scaffold script (create-widget.sh) substitutes __PORT__ with the claimed
# port number at scaffold time. The systemd unit's Environment=PORT= is
# authoritative at runtime; __PORT__ is a standalone-dev fallback.

import json
import os
import pathlib
import sys
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

STATE_FILE = pathlib.Path(__file__).parent / "state.json"
HTML_FILE  = pathlib.Path(__file__).parent / "widget.html"
PORT       = int(os.environ.get("PORT", "__PORT__"))
_lock      = threading.Lock()


def _read_metadata_optional():
    """Read metadata.json at startup for debug logging. Best-effort — never fatal."""
    meta_path = pathlib.Path(__file__).parent / "metadata.json"
    if meta_path.exists():
        try:
            meta = json.loads(meta_path.read_text())
            print(
                f"[widget:{meta.get('widget_id','?')}] list-actions config: "
                f"prompt={meta.get('config',{}).get('prompt','?')!r} "
                f"actions={meta.get('config',{}).get('actions',[])}",
                file=sys.stderr,
            )
        except Exception as exc:
            print(f"[widget] metadata.json read error (non-fatal): {exc}", file=sys.stderr)


class Handler(BaseHTTPRequestHandler):

    def do_GET(self):
        if self.path in ("/", "/index.html"):
            try:
                body = HTML_FILE.read_bytes()
            except OSError as exc:
                self._send(500, b"widget.html not found")
                print(f"[widget] ERROR reading widget.html: {exc}", file=sys.stderr)
                return
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        else:
            self._send(404, b"not found")

    def do_POST(self):
        if self.path == "/submit":
            length = int(self.headers.get("Content-Length", 0))
            try:
                raw = self.rfile.read(length) if length > 0 else b"{}"
                data = json.loads(raw)
            except (json.JSONDecodeError, ValueError) as exc:
                print(f"[widget] POST /submit bad JSON: {exc}", file=sys.stderr)
                self._send(400, b"bad JSON")
                return

            # Force template discriminator so the agent always has a
            # machine-readable field to distinguish list-actions state from other
            # template shapes.
            if not isinstance(data, dict):
                data = {}
            data["template"] = "list-actions"

            with _lock:
                try:
                    STATE_FILE.write_text(json.dumps(data, indent=2) + "\n")
                except OSError as exc:
                    print(f"[widget] ERROR writing state.json: {exc}", file=sys.stderr)
                    self._send(500, b"state write failed")
                    return

            self._send(204, b"")
        else:
            self._send(404, b"not found")

    def _send(self, status: int, body: bytes):
        self.send_response(status)
        if body:
            self.send_header("Content-Type", "text/plain; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if body:
            self.wfile.write(body)

    def log_message(self, *args):
        pass  # silence the default per-request access log


if __name__ == "__main__":
    _read_metadata_optional()
    print(f"[widget] list-actions server listening on 127.0.0.1:{PORT}", file=sys.stderr)
    HTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
