"""
strava_auth.py — One-shot OAuth flow Strava.

Usage : `python strava_auth.py`
- Démarre un mini serveur HTTP local sur :8765
- Ouvre Strava dans le navigateur pour autoriser "Coach IA"
- Capture le code, échange contre access_token + refresh_token
- Sauvegarde dans .strava_tokens.json

Prérequis : STRAVA_CLIENT_ID et STRAVA_CLIENT_SECRET dans .env.
"""
import json
import sys
import time
import webbrowser
from pathlib import Path
from urllib.parse import urlparse, parse_qs
from http.server import BaseHTTPRequestHandler, HTTPServer

import requests

ROOT = Path(__file__).parent
ENV_FILE = ROOT / ".env"
TOKEN_FILE = ROOT / ".strava_tokens.json"
REDIRECT_URI = "http://localhost:8765/callback"
SCOPE = "read,activity:read_all,profile:read_all"

AUTH_URL = "https://www.strava.com/oauth/authorize"
TOKEN_URL = "https://www.strava.com/oauth/token"


def load_env():
    env = {}
    if not ENV_FILE.exists():
        sys.exit("[X] .env introuvable")
    for line in ENV_FILE.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        env[k.strip()] = v.strip()
    return env


_captured = {"code": None, "error": None}


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a, **k):
        pass  # silence

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path != "/callback":
            self.send_response(404)
            self.end_headers()
            return
        qs = parse_qs(parsed.query)
        if "error" in qs:
            _captured["error"] = qs["error"][0]
            msg = f"<h1>Echec : {qs['error'][0]}</h1>"
        elif "code" in qs:
            _captured["code"] = qs["code"][0]
            msg = "<h1>OK</h1><p>Code capturé. Tu peux fermer cette fenêtre.</p>"
        else:
            msg = "<h1>Pas de code dans la réponse.</h1>"
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.end_headers()
        self.wfile.write(msg.encode("utf-8"))


def main():
    env = load_env()
    cid = env.get("STRAVA_CLIENT_ID")
    secret = env.get("STRAVA_CLIENT_SECRET")
    if not cid or not secret:
        sys.exit("[X] STRAVA_CLIENT_ID ou STRAVA_CLIENT_SECRET manquant dans .env")

    # 1) Construire l'URL d'autorisation
    auth_url = (
        f"{AUTH_URL}?client_id={cid}&response_type=code"
        f"&redirect_uri={REDIRECT_URI}&approval_prompt=force"
        f"&scope={SCOPE}"
    )
    print("=" * 60)
    print("Strava OAuth — Coach IA")
    print("=" * 60)
    print(f"\nOuverture du navigateur sur :")
    print(f"  {auth_url}\n")
    print("Si le navigateur ne s'ouvre pas, copie-colle l'URL dans ton navigateur.")
    print("\nServeur local en attente du callback sur :8765 ...")

    # 2) Démarre le serveur local
    server = HTTPServer(("localhost", 8765), Handler)
    server.timeout = 1  # check loop interruptible

    # 3) Ouvre le navigateur
    try:
        webbrowser.open(auth_url)
    except Exception:
        pass

    # 4) Attend le callback (max 5 min)
    deadline = time.time() + 300
    while _captured["code"] is None and _captured["error"] is None and time.time() < deadline:
        server.handle_request()

    if _captured["error"]:
        sys.exit(f"[X] Refus utilisateur ou erreur Strava : {_captured['error']}")
    if not _captured["code"]:
        sys.exit("[X] Timeout : pas de code reçu dans les 5 min")

    code = _captured["code"]
    print(f"[OK] Code reçu, échange contre tokens...")

    # 5) Échange code → access_token + refresh_token
    resp = requests.post(TOKEN_URL, data={
        "client_id": cid,
        "client_secret": secret,
        "code": code,
        "grant_type": "authorization_code",
    }, timeout=30)
    if resp.status_code != 200:
        sys.exit(f"[X] Erreur token exchange {resp.status_code} : {resp.text[:300]}")

    tokens = resp.json()
    tokens["obtained_at"] = int(time.time())
    TOKEN_FILE.write_text(json.dumps(tokens, indent=2), encoding="utf-8")
    athlete = tokens.get("athlete") or {}
    print(f"[OK] Tokens sauvegardés dans {TOKEN_FILE.name}")
    print(f"     Athlete : {athlete.get('firstname', '?')} {athlete.get('lastname', '')}")
    print(f"     Scope : {SCOPE}")
    print(f"     Expire le : {time.ctime(tokens.get('expires_at', 0))}")


if __name__ == "__main__":
    main()
