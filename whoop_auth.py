#!/usr/bin/env python3
"""
whoop_auth.py — Flow OAuth2 pour Whoop.

À lancer UNE FOIS pour autoriser l'app et obtenir les tokens.
Les tokens sont sauvegardés dans .whoop_tokens.json puis utilisés / refresh
automatiquement par fetch_data.py.

Usage:
    python whoop_auth.py
"""
import os
import sys
import json
import time
import secrets
import urllib.parse
import webbrowser
from pathlib import Path
from http.server import BaseHTTPRequestHandler, HTTPServer

import requests

ROOT = Path(__file__).parent
ENV_FILE = ROOT / ".env"
TOKEN_FILE = ROOT / ".whoop_tokens.json"

AUTH_URL = "https://api.prod.whoop.com/oauth/oauth2/auth"
TOKEN_URL = "https://api.prod.whoop.com/oauth/oauth2/token"
SCOPES = "offline read:recovery read:cycles read:sleep read:profile read:body_measurement read:workout"
LISTEN_PORT = 8765


def load_env():
    env = {}
    for line in ENV_FILE.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        env[k.strip()] = v.strip()
    return env


# ============ MINI SERVEUR LOCAL POUR CATCHER LE CALLBACK ============
_callback_data = {}


class CallbackHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        params = urllib.parse.parse_qs(parsed.query)
        if parsed.path == "/callback":
            _callback_data["code"] = params.get("code", [None])[0]
            _callback_data["state"] = params.get("state", [None])[0]
            _callback_data["error"] = params.get("error", [None])[0]
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.end_headers()
            if _callback_data["error"]:
                msg = f"<h2>[X]Erreur OAuth : {_callback_data['error']}</h2>"
            else:
                msg = """
                <h2 style='color:#4ade80;font-family:sans-serif;'>Autorisation Whoop reussie</h2>
                <p style='font-family:sans-serif;color:#666;'>Tu peux fermer cet onglet et revenir au terminal.</p>
                """
            self.wfile.write(msg.encode("utf-8"))
        else:
            self.send_response(404)
            self.end_headers()

    def log_message(self, fmt, *args):
        # Silencieux — pas de log HTTP polluant
        pass


def run_local_server():
    server = HTTPServer(("localhost", LISTEN_PORT), CallbackHandler)
    print(f"  ->Serveur local en écoute sur http://localhost:{LISTEN_PORT}/callback")
    server.handle_request()  # une seule requête puis arrêt


def main():
    env = load_env()
    cid = env.get("WHOOP_CLIENT_ID")
    sec = env.get("WHOOP_CLIENT_SECRET")
    redirect = env.get("WHOOP_REDIRECT_URI", f"http://localhost:{LISTEN_PORT}/callback")
    if not cid or not sec:
        sys.exit("[X]WHOOP_CLIENT_ID ou WHOOP_CLIENT_SECRET manquant dans .env")

    state = secrets.token_urlsafe(16)
    auth_params = {
        "response_type": "code",
        "client_id": cid,
        "redirect_uri": redirect,
        "scope": SCOPES,
        "state": state,
    }
    auth_url = AUTH_URL + "?" + urllib.parse.urlencode(auth_params)

    print("=" * 70)
    print("AUTORISATION WHOOP")
    print("=" * 70)
    print(f"\n-> Ouverture du navigateur pour autoriser l'app...")
    print(f"  Si le navigateur ne s'ouvre pas, copie ce lien manuellement :")
    print(f"  {auth_url}\n")

    webbrowser.open(auth_url)
    run_local_server()  # bloquant jusqu'au callback

    if _callback_data.get("error"):
        sys.exit(f"[X]OAuth refusé : {_callback_data['error']}")
    if _callback_data.get("state") != state:
        sys.exit("[X]State invalide (possible attaque CSRF) — recommencer.")
    code = _callback_data.get("code")
    if not code:
        sys.exit("[X]Pas de code reçu — vérifier la redirect URI dans le portail Whoop.")

    print("  [OK]Code d'autorisation reçu, échange contre tokens...")

    # Échange code → tokens
    resp = requests.post(TOKEN_URL, data={
        "grant_type": "authorization_code",
        "code": code,
        "client_id": cid,
        "client_secret": sec,
        "redirect_uri": redirect,
    }, timeout=30)
    if resp.status_code != 200:
        sys.exit(f"[X]Token endpoint {resp.status_code} : {resp.text[:300]}")
    tokens = resp.json()
    # Ajouter le timestamp d'expiration pour faciliter le refresh ultérieur
    tokens["obtained_at"] = int(time.time())
    tokens["expires_at"] = int(time.time()) + tokens.get("expires_in", 3600) - 60

    TOKEN_FILE.write_text(json.dumps(tokens, indent=2), encoding="utf-8")
    print(f"\n[OK] Tokens sauvegardes dans {TOKEN_FILE.name}")
    print(f"  Access token expire à : {time.strftime('%Y-%m-%d %H:%M:%S', time.localtime(tokens['expires_at']))}")
    print(f"  Refresh token disponible pour renouveler automatiquement.")
    print(f"\nÉtape suivante : python fetch_data.py")


if __name__ == "__main__":
    main()
