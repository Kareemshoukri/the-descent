"""LAN preview with fresh HTML and an exclusive Windows port binding."""
import socket
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

class Handler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()

class Server(ThreadingHTTPServer):
    allow_reuse_address = False
    def server_bind(self):
        if hasattr(socket, "SO_EXCLUSIVEADDRUSE"):
            self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        super().server_bind()

root = Path(__file__).resolve().parents[1] / "work" / "mobile-current"
print(f"Serving {root} on http://0.0.0.0:5199", flush=True)
Server(("0.0.0.0", 5199), partial(Handler, directory=str(root))).serve_forever()
