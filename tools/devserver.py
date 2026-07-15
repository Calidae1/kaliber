#!/usr/bin/env python3
"""Lokaler Testserver für die Entwicklung.

    python tools/devserver.py [port]

Wie 'python -m http.server', aber mit 'Cache-Control: no-store'. Das ist der
entscheidende Unterschied: Pythons eingebauter Server sendet gar keine
Cache-Header, woraufhin der Browser nach eigenem Gutdünken cacht — man ändert
app.js, lädt neu und bekommt trotzdem die alte Version serviert. Das kostet
beim Entwickeln viel Zeit und führt zu Fehlersuchen an der falschen Stelle.

Nur fürs Entwickeln. Im Hosting (GitHub Pages) setzt der Server korrekte
Cache-Header, und um die Versionierung kümmert sich der Service Worker über
seine VERSION-Konstante.
"""

import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

WURZEL = Path(__file__).resolve().parent.parent


# Muss inhaltlich mit der Content-Security-Policy in index.html übereinstimmen.
# GitHub Pages kann keine eigenen HTTP-Header setzen, im Betrieb gilt deshalb die
# <meta>-Angabe. Hier senden wir sie zusätzlich als echten Header, damit sich beim
# Entwickeln überhaupt prüfen lässt, ob die Richtlinie die App nicht lahmlegt.
CSP = (
    "default-src 'self'; "
    "script-src 'self'; "
    "style-src 'self' 'unsafe-inline'; "
    "img-src 'self' data:; "
    "connect-src 'self'; "
    "worker-src 'self'; "
    "manifest-src 'self'; "
    "base-uri 'none'; "
    "object-src 'none'"
)


class NoCacheHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        self.send_header("Content-Security-Policy", CSP)
        super().end_headers()

    def log_message(self, fmt, *args):
        # Nur Fehler zeigen — jeder einzelne 200er im Log ist hier nur Rauschen
        if args and str(args[1]).startswith(("4", "5")):
            super().log_message(fmt, *args)


def main() -> None:
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8731
    handler = partial(NoCacheHandler, directory=str(WURZEL))
    with ThreadingHTTPServer(("0.0.0.0", port), handler) as srv:
        print(f"KALIBER Testserver: http://localhost:{port}")
        print(f"Verzeichnis: {WURZEL}")
        print("Cache-Control: no-store — Änderungen sind sofort sichtbar.")
        try:
            srv.serve_forever()
        except KeyboardInterrupt:
            print("\nBeendet.")


if __name__ == "__main__":
    main()
