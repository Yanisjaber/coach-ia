"""
strava.py — Client API Strava V3.

Gère le refresh automatique des tokens et expose :
- fetch_activities(after_date, before_date) : liste d'activités
- fetch_activity_detail(id) : détail complet
- fetch_streams(id, types=['watts','heartrate',...]) : streams seconde par seconde
"""
import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import requests

ROOT = Path(__file__).parent
TOKEN_FILE = ROOT / ".strava_tokens.json"
ENV_FILE = ROOT / ".env"
TOKEN_URL = "https://www.strava.com/oauth/token"
API_BASE = "https://www.strava.com/api/v3"


def _load_env():
    env = {}
    for line in ENV_FILE.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        env[k.strip()] = v.strip()
    return env


def _load_tokens():
    if not TOKEN_FILE.exists():
        raise RuntimeError(".strava_tokens.json absent — lance python strava_auth.py.")
    return json.loads(TOKEN_FILE.read_text(encoding="utf-8"))


def _save_tokens(tokens):
    TOKEN_FILE.write_text(json.dumps(tokens, indent=2), encoding="utf-8")


def _refresh_access(tokens):
    """Renouvelle l'access_token via le refresh_token."""
    env = _load_env()
    cid = env["STRAVA_CLIENT_ID"]
    secret = env["STRAVA_CLIENT_SECRET"]
    refresh = tokens.get("refresh_token")
    if not refresh:
        raise RuntimeError("Pas de refresh_token — relance python strava_auth.py.")
    print("  -> Refresh du token Strava...")
    resp = requests.post(TOKEN_URL, data={
        "client_id": cid,
        "client_secret": secret,
        "grant_type": "refresh_token",
        "refresh_token": refresh,
    }, timeout=30)
    if resp.status_code != 200:
        raise RuntimeError(
            f"Strava refresh failed {resp.status_code} : {resp.text[:300]}. "
            "Relance python strava_auth.py."
        )
    new = resp.json()
    # Strava renvoie expires_at en epoch et expires_in en secondes
    new["obtained_at"] = int(time.time())
    _save_tokens(new)
    return new


def get_session():
    """Retourne une session HTTP authentifiée, refresh auto si besoin."""
    tokens = _load_tokens()
    # Strava : expires_at est epoch UTC
    if tokens.get("expires_at", 0) <= int(time.time()) + 60:
        tokens = _refresh_access(tokens)
    s = requests.Session()
    s.headers.update({
        "Authorization": f"Bearer {tokens['access_token']}",
        "Accept": "application/json",
    })
    return s


def _get(session, path, params=None):
    """GET avec gestion 401 (refresh + retry) + rate limit."""
    r = session.get(f"{API_BASE}{path}", params=params, timeout=30)
    if r.status_code == 401:
        # Token expiré entre temps → refresh + retry
        tokens = _refresh_access(_load_tokens())
        session.headers["Authorization"] = f"Bearer {tokens['access_token']}"
        r = session.get(f"{API_BASE}{path}", params=params, timeout=30)
    if r.status_code == 429:
        # Rate limit Strava (100/15min, 1000/jour)
        print(f"  [!] Strava rate limit atteint, pause 15 min...", file=sys.stderr)
        time.sleep(15 * 60)
        r = session.get(f"{API_BASE}{path}", params=params, timeout=30)
    if r.status_code != 200:
        print(f"  [!] Strava {r.status_code} sur {path} : {r.text[:200]}", file=sys.stderr)
        r.raise_for_status()
    return r.json()


def fetch_activities(session, after_iso=None, before_iso=None, per_page=200):
    """Liste paginée des activités entre deux dates (format YYYY-MM-DD ou epoch)."""
    def to_epoch(d):
        if d is None:
            return None
        if isinstance(d, (int, float)):
            return int(d)
        if isinstance(d, str):
            # YYYY-MM-DD
            try:
                dt = datetime.fromisoformat(d).replace(tzinfo=timezone.utc)
                return int(dt.timestamp())
            except Exception:
                return None
        if hasattr(d, "year"):
            dt = datetime(d.year, d.month, d.day, tzinfo=timezone.utc)
            return int(dt.timestamp())
        return None

    params_base = {"per_page": per_page}
    after = to_epoch(after_iso)
    before = to_epoch(before_iso)
    if after:
        params_base["after"] = after
    if before:
        params_base["before"] = before

    all_acts = []
    page = 1
    while True:
        params = dict(params_base, page=page)
        acts = _get(session, "/athlete/activities", params)
        if not acts:
            break
        all_acts.extend(acts)
        if len(acts) < per_page:
            break
        page += 1
        if page > 100:  # garde-fou : 20 000 activités max
            print("  [!] Stop pagination à 100 pages", file=sys.stderr)
            break
    return all_acts


def fetch_activity_detail(session, activity_id):
    """Détail complet d'une activité (incl. description, gear, splits, etc.)."""
    return _get(session, f"/activities/{activity_id}")


def fetch_streams(session, activity_id, types=None):
    """Streams seconde par seconde. Retourne un dict {type: {data:[...]}}."""
    if types is None:
        types = ["watts", "heartrate", "cadence", "distance", "altitude", "velocity_smooth", "time"]
    params = {"keys": ",".join(types), "key_by_type": "true"}
    return _get(session, f"/activities/{activity_id}/streams", params)


def fetch_athlete(session):
    """Profil athlète Strava (FTP, weight, etc.)."""
    return _get(session, "/athlete")


# Mapping Strava sport_type → notre catégorie (sync avec SPORT_TYPE_TO_CATEGORY de fetch_data.py)
STRAVA_TYPE_NORMALIZE = {
    # Strava utilise CamelCase, on garde tel quel
}
