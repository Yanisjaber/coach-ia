"""
whoop.py — Client API Whoop (V1).

Gère le chargement/refresh automatique des tokens, et expose les fonctions
fetch_recovery / fetch_sleep / fetch_cycle pour une plage de dates.
"""
import json
import time
import sys
from pathlib import Path
from datetime import datetime, timezone, timedelta

import requests

ROOT = Path(__file__).parent
TOKEN_FILE = ROOT / ".whoop_tokens.json"
ENV_FILE = ROOT / ".env"
TOKEN_URL = "https://api.prod.whoop.com/oauth/oauth2/token"
API_BASE = "https://api.prod.whoop.com/developer/v2"


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
        raise RuntimeError(".whoop_tokens.json absent - lance python whoop_auth.py.")
    return json.loads(TOKEN_FILE.read_text(encoding="utf-8"))


def _save_tokens(tokens):
    TOKEN_FILE.write_text(json.dumps(tokens, indent=2), encoding="utf-8")


def _refresh_access(tokens):
    """Renouvelle l'access_token via le refresh_token."""
    env = _load_env()
    cid = env["WHOOP_CLIENT_ID"]
    sec = env["WHOOP_CLIENT_SECRET"]
    refresh = tokens.get("refresh_token")
    if not refresh:
        raise RuntimeError("Pas de refresh_token - relance python whoop_auth.py.")
    print("  -> Refresh du token Whoop...")
    resp = requests.post(TOKEN_URL, data={
        "grant_type": "refresh_token",
        "refresh_token": refresh,
        "client_id": cid,
        "client_secret": sec,
        "scope": "offline",
    }, timeout=30)
    if resp.status_code != 200:
        # On lève une exception au lieu de sys.exit pour ne pas tuer fetch_data.py
        raise RuntimeError(
            f"Whoop refresh failed {resp.status_code} : {resp.text[:300]}. "
            "Relance python whoop_auth.py localement puis push .whoop_tokens.json."
        )
    new = resp.json()
    new["obtained_at"] = int(time.time())
    new["expires_at"] = int(time.time()) + new.get("expires_in", 3600) - 60
    # Conserver refresh_token si pas renvoyé
    if "refresh_token" not in new:
        new["refresh_token"] = refresh
    _save_tokens(new)
    return new


def get_session():
    """Retourne une session HTTP authentifiée, refresh auto si besoin."""
    tokens = _load_tokens()
    if tokens.get("expires_at", 0) <= int(time.time()):
        tokens = _refresh_access(tokens)
    s = requests.Session()
    s.headers.update({
        "Authorization": f"Bearer {tokens['access_token']}",
        "Accept": "application/json",
    })
    return s


def _paginate(session, path, params):
    """Helper de pagination : suit nextToken jusqu'à épuisement.
    Tolère les variations de nom (next_token / nextToken)."""
    all_records = []
    params = dict(params)
    pages = 0
    while True:
        r = session.get(f"{API_BASE}{path}", params=params, timeout=30)
        if r.status_code == 401:
            # Token expiré entre temps : refresh + retry
            tokens = _refresh_access(_load_tokens())
            session.headers["Authorization"] = f"Bearer {tokens['access_token']}"
            r = session.get(f"{API_BASE}{path}", params=params, timeout=30)
        if r.status_code != 200:
            print(f"  [!]{r.status_code} sur {path} : {r.text[:200]}", file=sys.stderr)
            r.raise_for_status()
        data = r.json()
        records = data.get("records", [])
        all_records.extend(records)
        pages += 1
        next_token = data.get("next_token") or data.get("nextToken")
        if not next_token:
            break
        # Envoyer sous les deux noms par sécurité
        params["nextToken"] = next_token
        params["next_token"] = next_token
        # garde-fou : 500 pages max
        if pages >= 500:
            print(f"  [!]Stop pagination après {pages} pages sur {path}", file=sys.stderr)
            break
    return all_records


def _iso(dt):
    """Format ISO 8601 UTC accepté par Whoop."""
    if isinstance(dt, str):
        return dt
    return dt.strftime("%Y-%m-%dT%H:%M:%S.000Z")


def fetch_user_profile(session):
    r = session.get(f"{API_BASE}/user/profile/basic", timeout=30)
    if r.status_code != 200:
        return None
    return r.json()


def fetch_recovery(session, start, end):
    """Recovery scores (HRV, RHR, %) entre deux datetimes UTC."""
    return _paginate(session, "/recovery", {
        "start": _iso(start),
        "end": _iso(end),
        "limit": 25,
    })


def fetch_cycles(session, start, end):
    """Cycles physiologiques (strain, kilojoule, durée)."""
    return _paginate(session, "/cycle", {
        "start": _iso(start),
        "end": _iso(end),
        "limit": 25,
    })


def fetch_sleep(session, start, end):
    """Sessions de sommeil (durée, stades, performance)."""
    return _paginate(session, "/activity/sleep", {
        "start": _iso(start),
        "end": _iso(end),
        "limit": 25,
    })


def fetch_all(start_date, end_date):
    """Récupère recovery + sleep + cycles entre deux dates (objets date).
    Renvoie un dict {recovery, sleep, cycles} avec listes brutes."""
    s = get_session()
    # Convertir date → datetime UTC bornes
    if hasattr(start_date, "year") and not hasattr(start_date, "hour"):
        start_dt = datetime(start_date.year, start_date.month, start_date.day, 0, 0, 0, tzinfo=timezone.utc)
    else:
        start_dt = start_date
    if hasattr(end_date, "year") and not hasattr(end_date, "hour"):
        end_dt = datetime(end_date.year, end_date.month, end_date.day, 23, 59, 59, tzinfo=timezone.utc)
    else:
        end_dt = end_date

    profile = fetch_user_profile(s)
    print(f"  [OK]Profil Whoop : {profile.get('first_name', '?')} {profile.get('last_name', '')}"
          if profile else "  [!]Profil indisponible")

    def _summ(name, records, ts_key="created_at"):
        if not records:
            print(f"  [!]{name} : 0 record")
            return
        dates = sorted([r.get(ts_key, "")[:10] for r in records if r.get(ts_key)])
        if dates:
            print(f"  [OK]{len(records)} {name}  (de {dates[0]} à {dates[-1]})")
        else:
            print(f"  [OK]{len(records)} {name}")

    recovery = fetch_recovery(s, start_dt, end_dt)
    _summ("recovery scores", recovery)

    sleep = fetch_sleep(s, start_dt, end_dt)
    _summ("sessions de sommeil", sleep, "end")

    cycles = fetch_cycles(s, start_dt, end_dt)
    _summ("cycles physiologiques", cycles, "start")

    return {"profile": profile, "recovery": recovery, "sleep": sleep, "cycles": cycles}


def build_daily_whoop(raw):
    """Transforme les listes brutes Whoop en dict date(YYYY-MM-DD) → metrics.
    Une entrée par jour, fusionnant recovery (HRV/RHR/%), sleep (durée/qualité),
    cycle (strain)."""
    by_date = {}

    # Recovery — clé : recovery.score (% recovery, HRV en ms, RHR)
    # Chaque record a un cycle_id et un created_at ; la date correspond au jour
    # du début du cycle de sommeil (le réveil).
    for r in raw.get("recovery") or []:
        score = r.get("score") or {}
        # Date : on prend "created_at" du recovery (correspond à fin de nuit)
        ts = r.get("created_at") or r.get("updated_at")
        if not ts:
            continue
        d = ts[:10]
        by_date.setdefault(d, {})
        if score.get("recovery_score") is not None:
            by_date[d]["recovery"] = round(score["recovery_score"])
        if score.get("hrv_rmssd_milli") is not None:
            by_date[d]["hrv"] = round(score["hrv_rmssd_milli"])
        if score.get("resting_heart_rate") is not None:
            by_date[d]["rhr"] = round(score["resting_heart_rate"])
        if score.get("spo2_percentage") is not None:
            by_date[d]["spo2"] = round(score["spo2_percentage"], 1)
        if score.get("skin_temp_celsius") is not None:
            by_date[d]["skinTemp"] = round(score["skin_temp_celsius"], 1)

    # Sleep — clé : durées et qualité
    for sl in raw.get("sleep") or []:
        score = sl.get("score") or {}
        stage = score.get("stage_summary") or {}
        # Date = jour de réveil (end)
        end_ts = sl.get("end") or sl.get("created_at")
        if not end_ts:
            continue
        d = end_ts[:10]
        by_date.setdefault(d, {})
        # Durée de sommeil = total in bed - awake (ms → heures)
        total_sleep_ms = (
            (stage.get("total_light_sleep_time_milli", 0) or 0)
            + (stage.get("total_slow_wave_sleep_time_milli", 0) or 0)
            + (stage.get("total_rem_sleep_time_milli", 0) or 0)
        )
        if total_sleep_ms:
            by_date[d]["sleepH"] = round(total_sleep_ms / 1000 / 3600, 1)
        # Qualité (sleep performance %)
        if score.get("sleep_performance_percentage") is not None:
            by_date[d]["sleepQ"] = round(score["sleep_performance_percentage"])
        # Détails par stade
        if stage.get("total_slow_wave_sleep_time_milli"):
            by_date[d]["deepH"] = round(stage["total_slow_wave_sleep_time_milli"] / 1000 / 3600, 1)
        if stage.get("total_rem_sleep_time_milli"):
            by_date[d]["remH"] = round(stage["total_rem_sleep_time_milli"] / 1000 / 3600, 1)

    # Cycles — clé : strain quotidien
    for c in raw.get("cycles") or []:
        score = c.get("score") or {}
        start_ts = c.get("start")
        if not start_ts:
            continue
        d = start_ts[:10]
        by_date.setdefault(d, {})
        if score.get("strain") is not None:
            by_date[d]["strain"] = round(score["strain"], 1)
        if score.get("kilojoule") is not None:
            by_date[d]["kilojoule"] = round(score["kilojoule"])
        if score.get("average_heart_rate") is not None:
            by_date[d]["avgHR"] = round(score["average_heart_rate"])
        if score.get("max_heart_rate") is not None:
            by_date[d]["maxHR"] = round(score["max_heart_rate"])

    return by_date
