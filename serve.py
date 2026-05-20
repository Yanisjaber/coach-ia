#!/usr/bin/env python3
"""
serve.py — Serveur local pour tester le dashboard Coach IA.

Sert les fichiers statiques (dashboard.html, data.js, streams.js, etc.).
Plus de proxy API depuis la migration vers Strava (data.js déjà généré par fetch_data.py).

Usage:
    python serve.py            # port 8000 par défaut
    python serve.py 9000       # port custom

Puis ouvre : http://localhost:8000/dashboard.html
"""
import os
import sys
from pathlib import Path
from http.server import HTTPServer, SimpleHTTPRequestHandler

ROOT = Path(__file__).parent


class CoachIAHandler(SimpleHTTPRequestHandler):
    def log_message(self, fmt, *args):
        # N'affiche que les erreurs 4xx / 5xx
        if args[1].startswith(("4", "5")):
            print(f"  {args[0]} {self.path} -> {args[1]}")

    def end_headers(self):
        # Anti-cache sur les data files pour voir les updates immédiatement
        if any(self.path.endswith(s) for s in ('.js', '.json', '.html')):
            self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        super().end_headers()


def run(port=8000):
    os.chdir(ROOT)
    server = HTTPServer(("localhost", port), CoachIAHandler)
    url = f"http://localhost:{port}/dashboard.html"
    print("=" * 60)
    print("Coach IA - Serveur local actif")
    print(f"  Dashboard : {url}")
    print("  Ctrl+C pour stopper")
    print("=" * 60)
    server.serve_forever()


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    try:
        run(port)
    except KeyboardInterrupt:
        print("\nServeur stoppé.")
