#!/usr/bin/env python3
"""
fetch_data.py — Récupère les données intervals.icu et génère data.json
pour le dashboard Coach IA.

Données réelles (intervals.icu) : athlète, activités, wellness, events futurs.
Données simulées (Whoop) : recovery score, HRV, sommeil (marquées comme simulées).

Usage:
    python fetch_data.py
"""

import os
import sys
import json
import random
import math
from datetime import datetime, timedelta, date
from pathlib import Path

import requests
from requests.auth import HTTPBasicAuth

# Whoop : optionnel, si .whoop_tokens.json présent
try:
    import whoop as whoop_client
    WHOOP_AVAILABLE = True
except ImportError:
    WHOOP_AVAILABLE = False


# ============ CONFIG ============
ROOT = Path(__file__).parent
ENV_FILE = ROOT / ".env"
OUT_JSON = ROOT / "data.json"
OUT_JS = ROOT / "data.js"
BASE_URL = "https://intervals.icu/api/v1"


def load_env():
    """Lit .env très simplement (clé=valeur, une par ligne)."""
    env = {}
    if not ENV_FILE.exists():
        sys.exit(f"[X]Fichier .env introuvable à {ENV_FILE}")
    for line in ENV_FILE.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        env[k.strip()] = v.strip()
    return env


def make_session(api_key):
    """Session HTTP authentifiée pour intervals.icu."""
    s = requests.Session()
    s.auth = HTTPBasicAuth("API_KEY", api_key)
    s.headers.update({"Accept": "application/json"})
    return s


def get(session, path, params=None):
    """GET avec gestion d'erreur claire."""
    url = f"{BASE_URL}{path}"
    r = session.get(url, params=params or {}, timeout=30)
    if r.status_code != 200:
        print(f"[X]{r.status_code} {url}\n   {r.text[:300]}", file=sys.stderr)
        r.raise_for_status()
    return r.json()


# ============ FETCH ============
def fetch_athlete(session, athlete_id):
    """Profil athlète : FTP, poids, nom, zones."""
    print(f"->Athlète {athlete_id}...")
    return get(session, f"/athlete/{athlete_id}")


def fetch_activities(session, athlete_id, oldest, newest):
    """Toutes les activités entre deux dates (format YYYY-MM-DD)."""
    print(f"->Activités {oldest} ->{newest}...")
    return get(
        session,
        f"/athlete/{athlete_id}/activities",
        params={"oldest": oldest, "newest": newest},
    )


def fetch_wellness(session, athlete_id, oldest, newest):
    """Wellness (CTL/ATL/TSB calculés par intervals.icu)."""
    print(f"->Wellness {oldest} ->{newest}...")
    return get(
        session,
        f"/athlete/{athlete_id}/wellness",
        params={"oldest": oldest, "newest": newest},
    )


def fetch_events(session, athlete_id, oldest, newest):
    """Événements planifiés (séances futures)."""
    print(f"->Events planifiés {oldest} ->{newest}...")
    return get(
        session,
        f"/athlete/{athlete_id}/events",
        params={"oldest": oldest, "newest": newest},
    )


# ============ TRANSFORM ============
def classify_session(activity, ftp):
    """Déduit le 'type' simple de séance (endurance/tempo/seuil/vo2/recup/force/autre)
    à partir du type d'activité, du nom, puis de l'intensité (IF ratio 0-1.5)."""
    atype = (activity.get("type") or "").lower()
    name = (activity.get("name") or "").lower()

    # Sports non cyclisme/course : sortir tout de suite
    if any(k in atype for k in ["weight", "strength", "workout"]) or \
       any(k in name for k in ["musculation", "muscu", "renfo", "gym", "crossfit"]):
        return "force"
    if any(k in atype for k in ["yoga", "stretching"]) or "yoga" in name or "etirement" in name:
        return "mobilite"
    if "swim" in atype or "natation" in name:
        return "natation"

    # Mots-clés explicites dans le nom
    if any(k in name for k in ["repos", "rest", "récup", "recovery"]):
        return "recup"
    if any(k in name for k in ["vo2", "vmax"]):
        return "vo2"
    if any(k in name for k in ["seuil", "threshold", "ftp test"]):
        return "seuil"
    if any(k in name for k in ["tempo", "sweet"]):
        return "tempo"

    # Sinon : par intensité (intensité en ratio 0-1.5)
    intensity = activity.get("icu_intensity")
    if intensity is not None and intensity > 5:
        intensity = intensity / 100.0
    if intensity is None:
        np = activity.get("icu_normalized_watts") or activity.get("icu_weighted_avg_watts")
        if np and ftp:
            intensity = np / ftp
    if intensity is None or intensity == 0:
        return "endurance"
    if intensity < 0.70:
        return "recup"
    if intensity < 0.80:
        return "endurance"
    if intensity < 0.90:
        return "tempo"
    if intensity < 1.00:
        return "seuil"
    return "vo2"


def _coerce_zone_seconds(raw):
    """Convertit un élément de zone (int OU dict) en secondes.
    intervals.icu renvoie soit des entiers, soit des objets
    {id, max, secondsInZone} (ou variantes : 'time', 'seconds')."""
    if raw is None:
        return 0
    if isinstance(raw, (int, float)):
        return int(raw)
    if isinstance(raw, dict):
        for k in ("secondsInZone", "time", "seconds", "secs", "duration"):
            v = raw.get(k)
            if isinstance(v, (int, float)):
                return int(v)
        return 0
    return 0


def extract_zones(activity):
    """Récupère le temps passé dans chaque zone de FC (5 zones).
    intervals.icu renvoie selon les cas icu_hr_zone_times ou icu_zone_times
    soit en liste d'entiers (secondes), soit en liste d'objets
    {id, secondsInZone, ...}. On normalise en % du temps total."""
    # Priorité aux zones FC, puis puissance
    candidates = [
        activity.get("icu_hr_zone_times"),
        activity.get("icu_zone_times"),
        activity.get("zone_times"),
        activity.get("icu_power_zone_times"),
    ]
    zones_sec = None
    for c in candidates:
        if c and isinstance(c, list) and len(c) >= 5:
            zones_sec = [_coerce_zone_seconds(z) for z in c[:5]]
            break
    if not zones_sec:
        return None
    total = sum(zones_sec)
    if total == 0:
        return None
    return [round(z * 100 / total, 1) for z in zones_sec]


def build_day_index(activities, wellness, athlete_ftp):
    """Construit un dict date ->infos consolidées.
    Pour chaque jour : wellness (CTL/ATL/TSB) + activité dominante (max TSS)."""
    by_date = {}

    # Wellness
    for w in wellness or []:
        d = w.get("id")  # format YYYY-MM-DD
        if not d:
            continue
        by_date.setdefault(d, {})
        by_date[d].update({
            "ctl": w.get("ctl") or 0,
            "atl": w.get("atl") or 0,
            "weight": w.get("weight"),
        })

    # Activités : on agrège par jour, on garde la plus grosse comme "session du jour"
    daily_acts = {}
    for a in activities or []:
        ts = a.get("start_date_local") or a.get("start_date")
        if not ts:
            continue
        d = ts[:10]
        daily_acts.setdefault(d, []).append(a)

    for d, acts in daily_acts.items():
        # session principale = TSS max
        main = max(acts, key=lambda x: x.get("icu_training_load") or 0)
        ftp_at_time = main.get("icu_ftp") or athlete_ftp or 0
        np = main.get("icu_normalized_watts") or main.get("icu_weighted_avg_watts") or 0
        avg_w = main.get("icu_average_watts") or 0
        intensity = main.get("icu_intensity")
        if intensity is None and np and ftp_at_time:
            intensity = np / ftp_at_time
        intensity = intensity or 0
        # intervals.icu renvoie icu_intensity en POURCENTAGE (0-150) et non en ratio.
        # On normalise vers un ratio (0-1.5) si la valeur dépasse 5.
        if intensity > 5:
            intensity = intensity / 100.0

        # TSS total du jour (somme de toutes les activités)
        tss_day = sum((x.get("icu_training_load") or 0) for x in acts)
        # Durée totale (minutes)
        duration_min = sum(
            (x.get("moving_time") or x.get("elapsed_time") or 0)
            for x in acts
        ) / 60.0

        # Conformité = % du TSS prévu si on a un planned_load attaché
        planned = main.get("icu_planned_load") or main.get("planned_load")
        compliance = None
        if planned and planned > 0:
            compliance = round((main.get("icu_training_load") or 0) * 100 / planned)

        by_date.setdefault(d, {})
        by_date[d].update({
            "tss": round(tss_day),
            "duration": round(duration_min),
            "sessionName": main.get("name") or main.get("type") or "Activité",
            "sessionType": classify_session(main, ftp_at_time),
            "np": round(np) if np else 0,
            "avgW": round(avg_w) if avg_w else 0,
            "hr": round(main.get("average_heartrate") or 0),
            "ftpPct": round(intensity * 100) if intensity else 0,
            "intensity": round(intensity, 2) if intensity else 0,
            "compliance": compliance,
            "zones": extract_zones(main),
            "activityId": main.get("id"),
            "ftp_at_time": ftp_at_time,
        })

    return by_date


def simulate_whoop(day_data):
    """Génère recovery/HRV/sommeil simulés mais corrélés à la charge réelle.
    Pour chaque jour : recovery basse si fatigue (ATL haut) et grosse séance la veille.
    Tag whoopSource = "simulated" pour distinguer dans l'UI."""
    days_sorted = sorted(day_data.keys())
    rng = random.Random(42)  # déterministe : même résultat à chaque exécution

    base_hrv = 62
    for i, d in enumerate(days_sorted):
        day = day_data[d]
        atl = day.get("atl") or 0
        tss = day.get("tss") or 0
        # Stress de la veille (impact J+1)
        prev_tss = day_data[days_sorted[i - 1]].get("tss", 0) if i > 0 else 0

        # Recovery : haute base 80, dégradée par fatigue accumulée
        stress = max(0, (atl - 40) * 0.7) + tss * 0.10 + prev_tss * 0.05
        recovery = 85 - stress + rng.uniform(-12, 12)
        recovery = max(15, min(99, round(recovery)))

        # HRV corrélé à recovery
        hrv = round(base_hrv + (recovery - 60) * 0.4 + rng.uniform(-4, 4))

        # Sommeil
        sleep_h = round(rng.uniform(6.5, 8.6) - (0.3 if tss > 100 else 0), 1)
        sleep_q = max(30, min(100, round(recovery + rng.uniform(-10, 10))))

        day["recovery"] = recovery
        day["hrv"] = hrv
        day["sleepH"] = sleep_h
        day["sleepQ"] = sleep_q
        day["whoopSource"] = "simulated"


def integrate_whoop(day_data, oldest, newest):
    """Tente de récupérer les données Whoop réelles et les merge dans day_data.
    Retourne True si Whoop a fonctionné, False sinon (auquel cas fallback simulation)."""
    if not WHOOP_AVAILABLE:
        return False
    if not (ROOT / ".whoop_tokens.json").exists():
        print("->Whoop : .whoop_tokens.json absent, fallback simulation")
        print("  Pour activer Whoop réel : python whoop_auth.py")
        return False
    try:
        # Restreindre la plage Whoop aux jours où on a des données intervals.icu
        # (inutile de demander 15 ans si l'historique commence plus tard)
        actual_dates = sorted(day_data.keys())
        if actual_dates:
            real_oldest = actual_dates[0]
            real_newest = actual_dates[-1]
        else:
            real_oldest, real_newest = oldest, newest
        print(f"->Whoop {real_oldest} ->{real_newest}...")
        start = datetime.fromisoformat(real_oldest).date()
        end = datetime.fromisoformat(real_newest).date()
        raw = whoop_client.fetch_all(start, end)
        whoop_daily = whoop_client.build_daily_whoop(raw)

        # Merge dans day_data : on écrase les champs simulés par les vrais
        # et on tag chaque jour avec whoopSource = "real"
        merged = 0
        for d, w in whoop_daily.items():
            day_data.setdefault(d, {})
            for k, v in w.items():
                if v is not None:
                    day_data[d][k] = v
            day_data[d]["whoopSource"] = "real"
            merged += 1
        print(f"  [OK]{merged} jours Whoop mergés (réels)")
        # Compteur réel pour rapport ultérieur
        integrate_whoop.last_real_count = merged
        return True
    except SystemExit:
        raise
    except Exception as e:
        print(f"  [!]Erreur Whoop : {e}", file=sys.stderr)
        print("  ->Fallback sur données simulées")
        return False


def to_dashboard_format(day_index):
    """Convertit le dict date→infos en liste triée chronologiquement,
    avec calcul de TSB et remplissage des jours sans activité."""
    if not day_index:
        return []

    dates = sorted(day_index.keys())
    start = datetime.fromisoformat(dates[0]).date()
    end = datetime.fromisoformat(dates[-1]).date()

    rows = []
    cur = start
    while cur <= end:
        ds = cur.isoformat()
        d = day_index.get(ds, {})
        ctl = d.get("ctl") or 0
        atl = d.get("atl") or 0
        rows.append({
            "date": ds,
            "tss": d.get("tss", 0),
            "ctl": round(ctl, 1),
            "atl": round(atl, 1),
            "tsb": round(ctl - atl, 1),
            "duration": d.get("duration", 0),
            "sessionName": d.get("sessionName"),
            "sessionType": d.get("sessionType"),
            "np": d.get("np", 0),
            "avgW": d.get("avgW", 0),
            "hr": d.get("hr", 0),
            "ftpPct": d.get("ftpPct", 0),
            "intensity": d.get("intensity", 0),
            "compliance": d.get("compliance"),
            "zones": d.get("zones"),
            # Whoop (réel ou simulé selon whoopSource)
            "recovery": d.get("recovery"),
            "hrv": d.get("hrv"),
            "sleepH": d.get("sleepH"),
            "sleepQ": d.get("sleepQ"),
            "whoopSource": d.get("whoopSource", "simulated"),
            # Métriques Whoop additionnelles (uniquement si réelles)
            "rhr": d.get("rhr"),
            "strain": d.get("strain"),
            "deepH": d.get("deepH"),
            "remH": d.get("remH"),
        })
        cur += timedelta(days=1)
    return rows


def build_plan(events, today):
    """Transforme les events futurs en plan affichable."""
    plan = []
    for e in events or []:
        ts = e.get("start_date_local") or e.get("start_date")
        if not ts:
            continue
        d = datetime.fromisoformat(ts.replace("Z", "+00:00")).date()
        if d < today or (d - today).days > 14:
            continue
        plan.append({
            "date": d.isoformat(),
            "dayOffset": (d - today).days,
            "name": e.get("name") or e.get("type") or "Séance",
            "desc": (e.get("description") or "")[:120],
            "plannedTSS": e.get("icu_training_load") or e.get("icu_planned_load") or 0,
            "type": (e.get("type") or "").lower(),
        })
    plan.sort(key=lambda x: x["dayOffset"])
    return plan


# ============ MAIN ============
def main():
    env = load_env()
    athlete_id = env.get("INTERVALS_ATHLETE_ID")
    api_key = env.get("INTERVALS_API_KEY")
    if not athlete_id or not api_key:
        sys.exit("[X]INTERVALS_ATHLETE_ID ou INTERVALS_API_KEY manquant dans .env")

    session = make_session(api_key)

    # Athlète
    athlete = fetch_athlete(session, athlete_id)
    name = athlete.get("name", "Athlète")
    ftp = athlete.get("icu_ftp") or athlete.get("ftp") or 0
    weight = athlete.get("icu_weight") or athlete.get("weight") or 0
    print(f"  [OK]{name} · FTP {ftp}W · {weight}kg")

    # Plage de dates : tout l'historique
    today = date.today()
    newest = today.isoformat()
    oldest = "2010-01-01"  # bien au-delà du début probable

    activities = fetch_activities(session, athlete_id, oldest, newest)
    print(f"  [OK]{len(activities)} activités récupérées")

    wellness = fetch_wellness(session, athlete_id, oldest, newest)
    print(f"  [OK]{len(wellness)} jours de wellness")

    events = fetch_events(session, athlete_id, today.isoformat(),
                         (today + timedelta(days=14)).isoformat())
    print(f"  [OK]{len(events)} events planifiés (14 jours à venir)")

    # Construction
    day_index = build_day_index(activities, wellness, ftp)

    # Whoop réel uniquement — pas de simulation. Les jours antérieurs au
    # bracelet auront recovery/hrv/sleep = null (trous honnêtes dans l'UI).
    whoop_ok = integrate_whoop(day_index, oldest, newest)
    if not whoop_ok:
        print("  ->Aucune donnée Whoop disponible : tous les jours seront sans recovery")

    rows = to_dashboard_format(day_index)
    plan = build_plan(events, today)

    # Métadonnées athlète + résumé
    out = {
        "generated_at": datetime.now().isoformat(),
        "athlete": {
            "id": athlete_id,
            "name": name,
            "ftp": ftp,
            "weight": weight,
        },
        "source": {
            "intervals_icu": True,
            "whoop_real": whoop_ok,
            "whoop_real_days": getattr(integrate_whoop, "last_real_count", 0) if whoop_ok else 0,
            "whoop_simulated_days": len(rows) - (getattr(integrate_whoop, "last_real_count", 0) if whoop_ok else 0),
            "history_days": len(rows),
            "activities_count": len(activities),
            "planned_events_count": len(plan),
        },
        "days": rows,
        "plan": plan,
    }

    # Écrit data.json (lisible) et data.js (chargeable depuis HTML en file://)
    json_str = json.dumps(out, ensure_ascii=False, indent=2, default=str)
    OUT_JSON.write_text(json_str, encoding="utf-8")
    OUT_JS.write_text(f"window.DASHBOARD_DATA = {json_str};\n", encoding="utf-8")
    print(f"\n[OK] Ecrit {OUT_JSON.name} ({OUT_JSON.stat().st_size // 1024} KB)")
    print(f"[OK] Ecrit {OUT_JS.name}   ({OUT_JS.stat().st_size // 1024} KB)")
    print(f"  Couverture : {rows[0]['date']} ->{rows[-1]['date']} ({len(rows)} jours)")


if __name__ == "__main__":
    main()
