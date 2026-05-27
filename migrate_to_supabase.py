#!/usr/bin/env python3
"""
migrate_to_supabase.py — Push toutes les données existantes vers Supabase.

Lit :
  - data.json (activités + days + power_profile + athlete)
  - .strava_tokens.json (tokens OAuth Strava)
  - power_profile_cache.json (cache PP par activité, optionnel)

Pousse dans :
  - public.activities
  - public.daily_metrics
  - public.power_profile
  - public.whoop_data
  - public.strava_connections
  - public.user_profiles (ftp, hr_max, lthr, weight, strava_athlete_id)

Variables d'environnement requises (à mettre dans .env) :
  SUPABASE_URL                  ex: https://gfavgstyyaaidkpadkxz.supabase.co
  SUPABASE_SERVICE_ROLE_KEY     clé admin (bypass RLS) — JAMAIS exposer publiquement
  SUPABASE_USER_ID              UUID de ton user (depuis auth.users)

Usage:
    python migrate_to_supabase.py
    python migrate_to_supabase.py --dry-run     # n'envoie rien, affiche juste les counts
    python migrate_to_supabase.py --only=power  # ne pousse qu'une table

Lance d'abord avec --dry-run pour vérifier les chiffres.
"""
from __future__ import annotations
import json
import sys
from pathlib import Path
from datetime import datetime, date
from typing import Any

import requests

ROOT = Path(__file__).parent
ENV_FILE = ROOT / ".env"
DATA_JSON = ROOT / "data.json"
STRAVA_TOKENS = ROOT / ".strava_tokens.json"
PP_CACHE = ROOT / "power_profile_cache.json"

BATCH_SIZE = 200  # upsert par batches de 200 lignes


# ============ ENV ============
def load_env() -> dict:
    env = {}
    if ENV_FILE.exists():
        for line in ENV_FILE.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            env[k.strip()] = v.strip().strip('"').strip("'")
    return env


# ============ SUPABASE CLIENT (REST API) ============
class Supabase:
    def __init__(self, url: str, service_key: str):
        self.url = url.rstrip("/")
        self.key = service_key
        self.session = requests.Session()
        self.session.headers.update({
            "apikey": service_key,
            "Authorization": f"Bearer {service_key}",
            "Content-Type": "application/json",
            "Prefer": "return=minimal",
        })

    def upsert(self, table: str, rows: list[dict], on_conflict: str | None = None):
        if not rows:
            return 0
        url = f"{self.url}/rest/v1/{table}"
        params = {}
        if on_conflict:
            params["on_conflict"] = on_conflict
            # Pour upsert via REST il faut le header Prefer
        headers = {"Prefer": "resolution=merge-duplicates,return=minimal"}
        total = 0
        for i in range(0, len(rows), BATCH_SIZE):
            batch = rows[i:i + BATCH_SIZE]
            r = self.session.post(url, json=batch, params=params, headers=headers, timeout=60)
            if r.status_code not in (200, 201, 204):
                print(f"  [!] {table} batch {i//BATCH_SIZE} : {r.status_code} {r.text[:300]}", file=sys.stderr)
                r.raise_for_status()
            total += len(batch)
        return total


# ============ HELPERS DE FORMAT ============
def to_int(v):
    if v is None or v == "": return None
    try: return int(round(float(v)))
    except: return None

def to_float(v):
    if v is None or v == "": return None
    try: return float(v)
    except: return None

def to_bool(v):
    if v is None: return None
    return bool(v)

def first_nonnull(*vals):
    for v in vals:
        if v is not None:
            return v
    return None

def iso_to_str(d):
    """date | datetime | str → 'YYYY-MM-DD'"""
    if isinstance(d, str): return d[:10]
    if isinstance(d, (date, datetime)): return d.isoformat()[:10]
    return None


# ============ MIGRATIONS ============
def migrate_strava_connection(sb: Supabase, user_id: str, env: dict) -> None:
    if not STRAVA_TOKENS.exists():
        print("  [skip] strava_connection : .strava_tokens.json absent")
        return
    tokens = json.loads(STRAVA_TOKENS.read_text(encoding="utf-8"))
    athlete = tokens.get("athlete") or {}
    expires_at = datetime.fromtimestamp(tokens.get("expires_at", 0)).isoformat() + "Z"
    row = {
        "user_id": user_id,
        "strava_athlete_id": int(athlete.get("id") or 0),
        "athlete_name": f"{athlete.get('firstname','')} {athlete.get('lastname','')}".strip() or None,
        "access_token": tokens.get("access_token"),
        "refresh_token": tokens.get("refresh_token"),
        "expires_at": expires_at,
        "scope": tokens.get("scope"),
    }
    if not row["strava_athlete_id"] or not row["access_token"]:
        print("  [skip] strava_connection : tokens incomplets")
        return
    sb.upsert("strava_connections", [row], on_conflict="user_id")
    print(f"  [OK] strava_connections : 1 ligne ({row['athlete_name']})")


def migrate_user_profile(sb: Supabase, user_id: str, data: dict) -> None:
    athlete = data.get("athlete") or {}
    row = {
        "user_id": user_id,
        "ftp": to_int(athlete.get("ftp")),
        "hr_max": to_int(athlete.get("hr_max")),
        "lthr": to_int(athlete.get("lthr")),
        "weight": to_float(athlete.get("weight")),
        "strava_athlete_id": to_int(athlete.get("id")),
        "display_name": athlete.get("name"),
    }
    sb.upsert("user_profiles", [row], on_conflict="user_id")
    print(f"  [OK] user_profiles : FTP {row['ftp']}, HRmax {row['hr_max']}, LTHR {row['lthr']}")


def migrate_activities(sb: Supabase, user_id: str, data: dict) -> int:
    rows = []
    for day in data.get("days", []):
        for a in (day.get("activities") or []):
            sid = a.get("id")
            if not sid: continue
            try:
                strava_id = int(sid)
            except (TypeError, ValueError):
                continue
            row = {
                "user_id": user_id,
                "strava_id": strava_id,
                "name": a.get("name"),
                "sport": a.get("sport"),
                "sport_raw": a.get("raw_type"),
                "type": a.get("type"),
                "start_date_local": a.get("start_date_local"),
                "elapsed_time": to_int(a.get("elapsed_time")),
                "moving_time": to_int(a.get("moving_time")),
                "distance_km": to_float(a.get("distance_km")),
                "total_elevation_gain": to_int(a.get("elevation_gain")),
                "total_elevation_loss": to_int(a.get("elevation_loss")),
                "avg_speed_kmh": to_float(a.get("avg_speed_kmh")),
                "max_speed_kmh": to_float(a.get("max_speed_kmh")),
                "max_speed_smooth_kmh": to_float(a.get("max_speed_smooth_kmh")),
                "avg_heartrate": to_int(a.get("hr")),
                "max_heartrate": to_int(a.get("max_hr")),
                "avg_watts": to_int(a.get("avg_watts")),
                "max_watts": to_int(a.get("max_watts")),
                "np": to_int(a.get("np")),
                "intensity": to_float(a.get("intensity")),
                "avg_cadence": to_int(a.get("cadence")),
                "max_cadence": to_int(a.get("max_cadence")),
                "kj": to_int(a.get("kj")),
                "calories": to_int(a.get("calories")),
                "tss": to_int(a.get("tss") or a.get("training_load")),
                "variability_index": to_float(a.get("variability_index")),
                "zones_hr": a.get("zones_hr"),
                "zones_power": a.get("zones_power"),
            }
            rows.append(row)
    if not rows:
        print("  [skip] activities : aucune dans data.json")
        return 0
    sb.upsert("activities", rows, on_conflict="user_id,strava_id")
    print(f"  [OK] activities : {len(rows)} lignes")
    return len(rows)


def migrate_daily_metrics(sb: Supabase, user_id: str, data: dict) -> int:
    rows = []
    for day in data.get("days", []):
        iso = day.get("date")
        if not iso: continue
        # day.date est string YYYY-MM-DD ou objet date selon
        iso = str(iso)[:10]
        rows.append({
            "user_id": user_id,
            "iso_date": iso,
            "tss": to_int(day.get("tss")) or 0,
            "ctl": to_float(day.get("ctl")) or 0,
            "atl": to_float(day.get("atl")) or 0,
            "tsb": to_float(day.get("tsb")) or 0,
            "duration_min": to_int(day.get("duration")) or 0,
            "activity_count": len(day.get("activities") or []),
        })
    if not rows:
        return 0
    sb.upsert("daily_metrics", rows, on_conflict="user_id,iso_date")
    print(f"  [OK] daily_metrics : {len(rows)} jours")
    return len(rows)


def migrate_power_profile(sb: Supabase, user_id: str, data: dict) -> int:
    pp = (data.get("power_profile") or {})
    alltime = pp.get("alltime") or {}
    recent = pp.get("last_90d") or {}
    if not alltime:
        print("  [skip] power_profile : aucun dans data.json")
        return 0
    rows = []
    all_keys = set(alltime.keys()) | set(recent.keys())
    for k in all_keys:
        try:
            dur = int(k)
        except ValueError:
            continue
        rows.append({
            "user_id": user_id,
            "duration_s": dur,
            "watts_alltime": to_int(alltime.get(k)),
            "watts_90d": to_int(recent.get(k)),
        })
    sb.upsert("power_profile", rows, on_conflict="user_id,duration_s")
    print(f"  [OK] power_profile : {len(rows)} durées")
    return len(rows)


def migrate_whoop_data(sb: Supabase, user_id: str, data: dict) -> int:
    rows = []
    for day in data.get("days", []):
        # On stocke seulement les jours qui ont au moins une mesure Whoop
        if day.get("recovery") is None and day.get("hrv") is None and day.get("sleepH") is None:
            continue
        iso = str(day.get("date") or "")[:10]
        if not iso: continue
        rows.append({
            "user_id": user_id,
            "iso_date": iso,
            "recovery": to_int(day.get("recovery")),
            "hrv": to_int(day.get("hrv")),
            "rhr": to_int(day.get("rhr")),
            "sleep_h": to_float(day.get("sleepH")),
            "sleep_q": to_int(day.get("sleepQ")),
            "deep_h": to_float(day.get("deepH")),
            "rem_h": to_float(day.get("remH")),
            "strain": to_float(day.get("strain")),
            "source": day.get("whoopSource") or "whoop",
        })
    if not rows:
        print("  [skip] whoop_data : rien dans data.json")
        return 0
    sb.upsert("whoop_data", rows, on_conflict="user_id,iso_date")
    print(f"  [OK] whoop_data : {len(rows)} jours")
    return len(rows)


# ============ MAIN ============
def main():
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true", help="Affiche les counts sans envoyer")
    parser.add_argument("--only", help="Une seule table (strava|profile|activities|metrics|power|whoop)")
    args = parser.parse_args()

    env = load_env()
    url = env.get("SUPABASE_URL")
    key = env.get("SUPABASE_SERVICE_ROLE_KEY")
    user_id = env.get("SUPABASE_USER_ID")

    missing = [k for k, v in {
        "SUPABASE_URL": url, "SUPABASE_SERVICE_ROLE_KEY": key, "SUPABASE_USER_ID": user_id,
    }.items() if not v]
    if missing:
        sys.exit(f"[X] Variables manquantes dans .env : {', '.join(missing)}\n"
                 f"   → Récupère-les sur Supabase et ajoute-les à {ENV_FILE.name}")

    if not DATA_JSON.exists():
        sys.exit(f"[X] data.json absent ({DATA_JSON}). Lance fetch_data.py d'abord.")

    print(f"== Migration Supabase ==")
    print(f"   URL     : {url}")
    print(f"   User ID : {user_id}")
    print(f"   Source  : {DATA_JSON.name} ({DATA_JSON.stat().st_size // 1024} KB)")
    print()

    data = json.loads(DATA_JSON.read_text(encoding="utf-8"))

    # Compte les choses sans rien envoyer
    counts = {
        "activities": sum(len(d.get("activities") or []) for d in data.get("days", [])),
        "daily_metrics": len(data.get("days", [])),
        "power_profile": len((data.get("power_profile") or {}).get("alltime") or {}),
        "whoop_data": sum(1 for d in data.get("days", []) if d.get("recovery") is not None),
    }
    print(f"Données à migrer :")
    for k, v in counts.items():
        print(f"   {k:20s} {v:>6}")
    print()

    if args.dry_run:
        print("[DRY-RUN] Aucune écriture. Lance sans --dry-run pour exécuter.")
        return

    sb = Supabase(url, key)

    only = args.only
    if not only or only == "strava":
        migrate_strava_connection(sb, user_id, env)
    if not only or only == "profile":
        migrate_user_profile(sb, user_id, data)
    if not only or only == "activities":
        migrate_activities(sb, user_id, data)
    if not only or only == "metrics":
        migrate_daily_metrics(sb, user_id, data)
    if not only or only == "power":
        migrate_power_profile(sb, user_id, data)
    if not only or only == "whoop":
        migrate_whoop_data(sb, user_id, data)

    print()
    print("[OK] Migration terminée.")
    print()
    print("Vérification dans pgAdmin :")
    print("   SELECT COUNT(*) FROM activities;       -- doit montrer ~1339")
    print("   SELECT COUNT(*) FROM daily_metrics;   -- doit montrer ~3177")
    print("   SELECT * FROM power_profile ORDER BY duration_s;")
    print("   SELECT * FROM strava_connections;")


if __name__ == "__main__":
    main()
