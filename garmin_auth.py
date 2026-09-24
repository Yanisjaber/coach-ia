#!/usr/bin/env python3
"""
garmin_auth.py — Login manuel Garmin Connect (via garth) pour (re)générer
oauth1_token/oauth1_secret, consommés par l'Edge Function garmin-ingest.

Garmin n'a pas de portail OAuth développeur public : contrairement à
whoop_auth.py, ce script fait un vrai login (email + mot de passe entrés
ICI, en local, jamais envoyés ailleurs qu'à sso.garmin.com) via la
librairie garth (pip install garth), qui reproduit le flow SSO officiel.

Le login SSO (oauth1_token) réussit indépendamment du endpoint
connectapi.garmin.com/oauth-service/oauth/exchange/user/2.0, qui est
celui qu'utilise garmin-ingest pour rafraîchir l'access_token — et qui
peut être rate-limité (429) après trop d'appels rapprochés. Ce script
tente donc l'échange en access_token, mais sauvegarde l'oauth1_token
même si cet échange échoue : garmin-ingest retentera tout seul (cron
horaire) une fois le rate-limit retombé.

Usage :
    pip3 install garth
    python3 garmin_auth.py

Résultat : .garmin_tokens.json (local, jamais commité — voir .gitignore).
"""
import getpass
import json
import sys
import time
from pathlib import Path

import garth
from garth import sso

ROOT = Path(__file__).parent
TOKEN_FILE = ROOT / ".garmin_tokens.json"


def main():
    print("=" * 70)
    print("LOGIN GARMIN CONNECT (via garth)")
    print("=" * 70)
    email = input("\nEmail Garmin : ").strip()
    password = getpass.getpass("Mot de passe Garmin (invisible) : ")

    client = garth.http.Client()

    print("\n-> Connexion à sso.garmin.com...")
    SSO = f"https://sso.{client.domain}/sso"
    SSO_EMBED = f"{SSO}/embed"
    SSO_EMBED_PARAMS = dict(id="gauth-widget", embedWidget="true", gauthHost=SSO)
    SIGNIN_PARAMS = {
        **SSO_EMBED_PARAMS,
        **dict(
            gauthHost=SSO_EMBED,
            service=SSO_EMBED,
            source=SSO_EMBED,
            redirectAfterAccountLoginUrl=SSO_EMBED,
            redirectAfterAccountCreationUrl=SSO_EMBED,
        ),
    }

    client.get("sso", "/sso/embed", params=SSO_EMBED_PARAMS)
    client.get("sso", "/sso/signin", params=SIGNIN_PARAMS, referrer=True)
    csrf_token = sso.get_csrf_token(client.last_resp.text)

    client.post(
        "sso", "/sso/signin", params=SIGNIN_PARAMS, referrer=True,
        data=dict(username=email, password=password, embed="true", _csrf=csrf_token),
    )
    title = sso.get_title(client.last_resp.text)

    if "MFA" in title:
        print("-> Code MFA requis (envoyé par Garmin, ex: email/app).")
        sso.handle_mfa(client, SIGNIN_PARAMS, lambda: input("Code MFA : "))
        title = sso.get_title(client.last_resp.text)

    if title != "Success":
        sys.exit(f"[X] Login échoué (titre reçu: {title!r}) — vérifie email/mot de passe.")

    import re
    m = re.search(r'embed\?ticket=([^"]+)"', client.last_resp.text)
    if not m:
        sys.exit("[X] Ticket SSO introuvable dans la réponse Garmin.")
    ticket = m.group(1)

    oauth1 = sso.get_oauth1_token(ticket, client)
    print(f"[OK] oauth1_token obtenu (login réussi).")

    result = {
        "oauth1_token": oauth1.oauth_token,
        "oauth1_secret": oauth1.oauth_token_secret,
        "access_token": None,
        "expires_at": None,
    }

    print("-> Tentative d'échange en access_token (peut échouer si Garmin rate-limite)...")
    try:
        oauth2 = sso.exchange(oauth1, client)
        result["access_token"] = oauth2.access_token
        result["expires_at"] = oauth2.expires_at
        print(f"[OK] access_token obtenu, expire à {time.strftime('%Y-%m-%d %H:%M:%S', time.localtime(oauth2.expires_at))}")
    except Exception as e:
        print(f"[!] Échange access_token échoué ({e}) — pas grave, oauth1_token sauvegardé quand même.")
        print("    garmin-ingest retentera automatiquement (cron horaire) une fois le rate-limit retombé.")

    TOKEN_FILE.write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(f"\n[OK] Tokens sauvegardés dans {TOKEN_FILE.name}")
    print("Étape suivante : demande à Claude de pousser ces tokens dans connexions_app.")


if __name__ == "__main__":
    main()
