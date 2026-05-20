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
OUT_STREAMS_JS = ROOT / "streams.js"
PREFETCH_STREAMS_COUNT = 30  # Nombre d'activités récentes dont on pré-télécharge les streams
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


def fetch_streams(session, activity_id):
    """Streams haute resolution (watts, heartrate, cadence, distance, altitude)."""
    return get(
        session,
        f"/activity/{activity_id}/streams",
        params={"types": "watts,heartrate,cadence,distance,altitude"},
    )


# ============ TRANSFORM ============
def get_sport_category(activity):
    """Mappe une activite intervals.icu vers une grande categorie de sport.

    Catégories (alignées sur les filtres du dashboard) :
        cyclisme / course / musculation / natation / randonnee / ski / autre

    Quand le champ ``type`` est absent (entrée manuelle), on tente une
    inférence depuis les métriques disponibles (watts → cyclisme, etc.).
    """
    atype = (activity.get("type") or "").lower()
    name = (activity.get("name") or "").lower()

    # --- Mapping par type intervals.icu ---
    # Cyclisme : route, MTB, gravel, home-trainer, e-bike
    if any(k in atype for k in ["ride", "bike", "cycle", "mtb", "spin"]) or \
       any(k in name for k in ["velo", "vélo", "cyclisme", "bike", "bicycl"]):
        return "cyclisme"
    # Course : route, trail, treadmill, virtual
    if "run" in atype or \
       any(k in name for k in ["course a pied", "course à pied", "footing", "running", "trail", "jogging"]):
        return "course"
    # Natation : piscine + eau libre
    if "swim" in atype or "natation" in name or "piscine" in name:
        return "natation"
    # Musculation / renforcement
    if any(k in atype for k in ["weight", "strength", "workout", "crossfit", "gym"]) or \
       any(k in name for k in ["musculation", "muscu", "renfo", "gym", "crossfit", "weights"]):
        return "musculation"
    # Tout le reste (ski, rando, marche, mobilité, sports co, etc.) → "autre"
    if any(k in atype for k in [
        "ski", "snowboard", "hike", "walk",
        "yoga", "stretching", "pilates",
        "soccer", "tennis", "basket", "volley", "hockey", "golf",
        "kayak", "rowing", "paddle", "climb",
        "transition", "ebike",
    ]) or any(k in name for k in ["ski", "snowboard", "rando", "marche", "hike"]):
        return "autre"

    # --- Pas de type connu : inférence par métriques ---
    avg_w = activity.get("icu_average_watts") or activity.get("avg_watts") or 0
    max_w = activity.get("max_watts") or activity.get("icu_max_watts") or 0
    avg_pace = activity.get("icu_average_pace") or 0  # min/km
    dist_m = activity.get("distance") or 0
    avg_speed = activity.get("average_speed") or 0  # m/s
    avg_cad = activity.get("average_cadence") or 0
    if avg_w or max_w:
        # Puissance dispo → presque toujours du vélo
        return "cyclisme"
    if avg_pace or (dist_m and avg_speed and avg_speed < 6 and avg_cad and 60 <= avg_cad <= 100):
        # Cadence 60-100 rpm + vitesse < 21 km/h = course à pied typique
        return "course"
    if dist_m and avg_speed and 6 <= avg_speed <= 25:
        # Vitesse 21-90 km/h sans watts → souvent vélo route/descente
        return "cyclisme"
    return "autre"


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


def _zones_from_key(activity, key):
    """Extrait les zones d'une clé spécifique et normalise en % du temps total."""
    c = activity.get(key)
    if not c or not isinstance(c, list) or len(c) < 5:
        return None
    zones_sec = [_coerce_zone_seconds(z) for z in c[:5]]
    total = sum(zones_sec)
    if total == 0:
        return None
    return [round(z * 100 / total, 1) for z in zones_sec]


def extract_zones_hr(activity):
    """Zones FC (5 zones, % du temps)."""
    return _zones_from_key(activity, "icu_hr_zone_times")


def extract_zones_power(activity):
    """Zones puissance (5 zones, % du temps).
    intervals.icu peut renvoyer ça sous plusieurs noms selon la version."""
    for key in ["icu_power_zone_times", "icu_zone_times", "zone_times"]:
        z = _zones_from_key(activity, key)
        if z is not None:
            return z
    return None


def extract_zones(activity):
    """Compat : zones FC en priorité, puissance en fallback (pour ancien code)."""
    return extract_zones_hr(activity) or extract_zones_power(activity)


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

        # Liste de TOUTES les activités du jour (pour permettre le défilement dans l'UI)
        all_activities = []
        for a in sorted(acts, key=lambda x: -(x.get("icu_training_load") or 0)):
            a_dur_min = (a.get("moving_time") or a.get("elapsed_time") or 0) / 60.0
            a_np = a.get("icu_normalized_watts") or a.get("icu_weighted_avg_watts") or 0
            a_intensity = a.get("icu_intensity") or 0
            if a_intensity and a_intensity > 5:
                a_intensity = a_intensity / 100.0
            a_ftp = a.get("icu_ftp") or athlete_ftp or 0
            # Distance en km
            dist_m = a.get("distance") or 0
            # Vitesse moyenne km/h
            avg_speed = a.get("average_speed") or 0  # m/s
            all_activities.append({
                "id": a.get("id"),
                "name": a.get("name") or a.get("type") or "Activité",
                "type": classify_session(a, a_ftp),
                "sport": get_sport_category(a),
                "raw_type": a.get("type"),  # type brut intervals.icu (Ride, Run, etc.)
                "tss": round(a.get("icu_training_load") or 0),
                "duration": round(a_dur_min),
                "elapsed_time": a.get("elapsed_time"),
                "moving_time": a.get("moving_time"),
                "start_date_local": a.get("start_date_local"),
                "distance_km": round(dist_m / 1000, 2) if dist_m else None,
                "elevation_gain": round(a.get("total_elevation_gain") or 0) or None,
                "elevation_loss": round(a.get("total_elevation_loss") or 0) or None,
                "avg_speed_kmh": round(avg_speed * 3.6, 1) if avg_speed else None,
                "max_speed_kmh": round((a.get("max_speed") or 0) * 3.6, 1) or None,
                "max_speed_smooth_kmh": round((a.get("max_speed_smooth") or 0), 1) or None,
                "np": round(a_np) if a_np else 0,
                "avg_watts": round(a.get("icu_average_watts") or 0) or None,
                "max_watts": round(a.get("max_watts") or a.get("icu_max_watts") or 0) or None,
                "hr": round(a.get("average_heartrate") or 0),
                "max_hr": round(a.get("max_heartrate") or 0) or None,
                "cadence": round(a.get("average_cadence") or 0) or None,
                "max_cadence": round(a.get("max_cadence") or 0) or None,
                "kj": round(a.get("kj") or ((a.get("icu_joules") or 0) / 1000)) or None,
                "calories": round(a.get("calories") or 0) or None,
                "ftpPct": round(a_intensity * 100) if a_intensity else 0,
                "intensity": round(a_intensity, 2) if a_intensity else 0,
                "variability_index": round(a.get("icu_variability_index") or 0, 2) or None,
                "training_load": round(a.get("icu_training_load") or 0) or None,
                "zones_hr": extract_zones_hr(a),
                "zones_power": extract_zones_power(a),
            })
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
            "sport": get_sport_category(main),
            "np": round(np) if np else 0,
            "avgW": round(avg_w) if avg_w else 0,
            "hr": round(main.get("average_heartrate") or 0),
            "ftpPct": round(intensity * 100) if intensity else 0,
            "intensity": round(intensity, 2) if intensity else 0,
            "compliance": compliance,
            "zones": extract_zones(main),
            "zones_hr": extract_zones_hr(main),
            "zones_power": extract_zones_power(main),
            "activities": all_activities,
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
    except Exception as e:
        print(f"  [!] Erreur Whoop : {e}", file=sys.stderr)
        print("  -> Continue sans Whoop (data.js sera quand meme genere)")
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
            "sport": d.get("sport"),
            "np": d.get("np", 0),
            "avgW": d.get("avgW", 0),
            "hr": d.get("hr", 0),
            "ftpPct": d.get("ftpPct", 0),
            "intensity": d.get("intensity", 0),
            "compliance": d.get("compliance"),
            "zones": d.get("zones"),
            "zones_hr": d.get("zones_hr"),
            "zones_power": d.get("zones_power"),
            "activities": d.get("activities", []),
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

    # ====== PRE-FETCH STREAMS + CALCUL DES MAX MANQUANTS ======
    # intervals.icu retourne max_watts=null pour beaucoup d'activités.
    # On le calcule depuis les streams pour les N dernières.
    print(f"\n-> Pre-fetch streams des {PREFETCH_STREAMS_COUNT} dernieres activites...")
    recent_acts = sorted(
        [a for a in activities if a.get("id") and a.get("start_date_local")],
        key=lambda a: a["start_date_local"],
        reverse=True,
    )[:PREFETCH_STREAMS_COUNT]
    streams_cache = {}
    streams_max = {}  # id activité -> {max_watts, max_hr, max_cadence}
    for i, a in enumerate(recent_acts):
        aid = a.get("id")
        try:
            s = fetch_streams(session, aid)
            streams_cache[str(aid)] = s
            maxes = {}
            dist_stream = None
            for stream in s or []:
                t = stream.get("type")
                data = stream.get("data") or []
                non_zero = [x for x in data if x]
                if t == "distance":
                    dist_stream = data
                if not non_zero:
                    continue
                if t == "watts":
                    maxes["max_watts"] = max(non_zero)
                elif t == "heartrate":
                    maxes["max_hr"] = max(non_zero)
                elif t == "cadence":
                    maxes["max_cadence"] = max(non_zero)
            # Vitesse max lissée (±15s) depuis le stream distance, en km/h
            if dist_stream and len(dist_stream) > 30:
                raw = [0.0] * len(dist_stream)
                for j in range(1, len(dist_stream)):
                    raw[j] = max(0, (dist_stream[j] or 0) - (dist_stream[j-1] or 0))
                raw[0] = raw[1] if len(raw) > 1 else 0
                win = 15
                n = len(raw)
                smooth_max = 0.0
                # Moyenne glissante centrée via accumulateur
                window_sum = sum(raw[:min(win + 1, n)])
                window_count = min(win + 1, n)
                for j in range(n):
                    if j > 0 and j + win < n:
                        window_sum += raw[j + win]
                        window_count += 1
                    if j - win - 1 >= 0:
                        window_sum -= raw[j - win - 1]
                        window_count -= 1
                    avg = window_sum / window_count if window_count > 0 else 0
                    if avg > smooth_max:
                        smooth_max = avg
                maxes["max_speed_smooth"] = smooth_max * 3.6  # m/s → km/h
            streams_max[aid] = maxes
            if (i + 1) % 5 == 0:
                print(f"  [OK] {i+1}/{len(recent_acts)} streams")
        except Exception as e:
            print(f"  [!] Skip {aid} : {e}", file=sys.stderr)

    # Patch les activités avec les max calculés depuis les streams
    patched = 0
    for a in activities:
        aid = a.get("id")
        m = streams_max.get(aid)
        if not m:
            continue
        if not a.get("max_watts") and m.get("max_watts"):
            a["max_watts"] = m["max_watts"]
            patched += 1
        if not a.get("max_heartrate") and m.get("max_hr"):
            a["max_heartrate"] = m["max_hr"]
        if not a.get("max_cadence") and m.get("max_cadence"):
            a["max_cadence"] = m["max_cadence"]
        if m.get("max_speed_smooth"):
            a["max_speed_smooth"] = m["max_speed_smooth"]
    print(f"  [OK] {patched} max_watts ajoutés depuis les streams")

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

    # ====== ÉCRITURE streams.js (déjà téléchargés en amont) ======
    streams_json = json.dumps(streams_cache, ensure_ascii=False, default=str)
    OUT_STREAMS_JS.write_text(f"window.STREAMS_CACHE = {streams_json};\n", encoding="utf-8")
    print(f"[OK] Ecrit {OUT_STREAMS_JS.name} ({OUT_STREAMS_JS.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
