#!/usr/bin/env python3
"""
serve.py - Serveur local pour tester le dashboard Coach IA avant deploy GitHub.

- Sert les fichiers statiques (dashboard.html, data.js, etc.)
- Proxifie /api/intervals/* vers intervals.icu (avec la cle API stockee localement)

Usage:
    python serve.py            # port 8000 par defaut
    python serve.py 9000       # port custom

Puis ouvre : http://localhost:8000/dashboard.html
"""
import os
import sys
from pathlib import Path
from http.server import HTTPServer, SimpleHTTPRequestHandler

import requests
from requests.auth import HTTPBasicAuth

ROOT = Path(__file__).parent
ENV_FILE = ROOT / ".env"


def load_env():
    env = {}
    if not ENV_FILE.exists():
        sys.exit(f"[X] .env introuvable a {ENV_FILE}")
    for line in ENV_FILE.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        env[k.strip()] = v.strip()
    return env


env = load_env()
INTERVALS_API_KEY = env.get("INTERVALS_API_KEY")
if not INTERVALS_API_KEY:
    sys.exit("[X] INTERVALS_API_KEY manquant dans .env")


class CoachIAHandler(SimpleHTTPRequestHandler):
    # Reduit le bruit dans la console
    def log_message(self, fmt, *args):
        # Ne logue que les erreurs et les requetes API
        if "/api/" in self.path or args[1].startswith(("4", "5")):
            print(f"  {args[0]} {self.path} -> {args[1]}")

    def do_GET(self):
        # Proxy intervals.icu : /api/intervals/* -> https://intervals.icu/api/v1/*
        if self.path.startswith("/api/intervals/"):
            intervals_path = self.path.replace("/api/intervals/", "/api/v1/", 1)
            url = f"https://intervals.icu{intervals_path}"
            try:
                resp = requests.get(
                    url,
                    auth=HTTPBasicAuth("API_KEY", INTERVALS_API_KEY),
                    timeout=30,
                )
                self.send_response(resp.status_code)
                ct = resp.headers.get("Content-Type", "application/json")
                self.send_header("Content-Type", ct)
                self.send_header("Access-Control-Allow-Origin", "*")
                self.send_header("Cache-Control", "private, max-age=300")
                self.end_headers()
                self.wfile.write(resp.content)
            except Exception as e:
                self.send_response(502)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(f'{{"error":"{str(e)}"}}'.encode())
            return

        # Sinon : serveur de fichiers statiques classique
        return super().do_GET()


def run(port=8000):
    os.chdir(ROOT)
    server = HTTPServer(("localhost", port), CoachIAHandler)
    url = f"http://localhost:{port}/dashboard.html"
    print("=" * 60)
    print(f"Coach IA - Serveur local actif")
    print(f"  Dashboard : {url}")
    print(f"  Proxy API : http://localhost:{port}/api/intervals/...")
    print(f"  Ctrl+C pour stopper")
    print("=" * 60)
    server.serve_forever()


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    try:
        run(port)
    except KeyboardInterrupt:
        print("\nServeur stoppe.")
