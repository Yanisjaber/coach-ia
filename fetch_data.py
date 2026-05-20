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

# Whoop : optionnel, si .whoop_tokens.json présent
try:
    import whoop as whoop_client
    WHOOP_AVAILABLE = True
except ImportError:
    WHOOP_AVAILABLE = False

# Strava : source PRINCIPALE des activités depuis la migration
import strava as strava_client


# ============ HELPERS COMPUTE (TSS, NP, CTL, ATL) ============
def compute_tss(activity, ftp, lthr):
    """Calcule TSS à partir des données d'activité.

    Priorité : NP/FTP (puissance) → HR/LTHR (cardio) → 0.
    Formule Coggan : TSS = duration_hr × IF² × 100.
    """
    dur_sec = activity.get("moving_time") or activity.get("elapsed_time") or 0
    if not dur_sec:
        return 0
    dur_hr = dur_sec / 3600.0
    np = activity.get("weighted_average_watts") or activity.get("icu_normalized_watts") or 0
    if np and ftp:
        intensity = np / ftp
        return round(dur_hr * intensity * intensity * 100)
    avg_hr = activity.get("average_heartrate") or 0
    if avg_hr and lthr:
        intensity = avg_hr / lthr
        return round(dur_hr * intensity * intensity * 100)
    return 0


def compute_fitness_curves(daily_tss):
    """Calcule CTL/ATL/TSB par EWMA depuis une liste {date: tss}.
    Retourne {date: {ctl, atl, tsb}} (date = string YYYY-MM-DD).

    - CTL : EWMA 42 jours (Chronic Training Load = fitness)
    - ATL : EWMA 7 jours (Acute Training Load = fatigue)
    - TSB : CTL - ATL (Training Stress Balance = forme)
    """
    if not daily_tss:
        return {}
    alpha_ctl = 2.0 / (42 + 1)
    alpha_atl = 2.0 / (7 + 1)
    ctl = 0.0
    atl = 0.0
    result = {}
    sorted_dates = sorted(daily_tss.keys())
    if not sorted_dates:
        return {}
    cur = datetime.fromisoformat(sorted_dates[0]).date()
    end = datetime.fromisoformat(sorted_dates[-1]).date()
    while cur <= end:
        iso = cur.isoformat()
        tss = daily_tss.get(iso, 0)
        ctl = alpha_ctl * tss + (1 - alpha_ctl) * ctl
        atl = alpha_atl * tss + (1 - alpha_atl) * atl
        result[iso] = {"ctl": ctl, "atl": atl, "tsb": ctl - atl}
        cur += timedelta(days=1)
    return result


def strava_to_internal(a, ftp, lthr):
    """Convertit une activité Strava au format attendu par build_day_index.
    Calcule TSS / IF / NP côté Python (puisque intervals.icu ne le fait plus).
    """
    # Strava utilise sport_type (récent) ou type (legacy) ; on prend les 2
    sport = a.get("sport_type") or a.get("type") or ""
    np = a.get("weighted_average_watts") or 0
    avg_w = a.get("average_watts") or 0
    intensity = (np / ftp) if (np and ftp) else 0
    tss = compute_tss(a, ftp, lthr)
    # ID Strava : numérique. On le préfixe avec "s" pour différencier si besoin.
    sid = a.get("id")
    return {
        "id": str(sid) if sid else None,
        "name": a.get("name"),
        "type": sport,
        "sport_type": sport,
        "start_date_local": a.get("start_date_local"),
        "moving_time": a.get("moving_time"),
        "elapsed_time": a.get("elapsed_time"),
        "distance": a.get("distance"),
        "total_elevation_gain": a.get("total_elevation_gain"),
        "total_elevation_loss": a.get("total_elevation_loss"),
        "average_speed": a.get("average_speed"),
        "max_speed": a.get("max_speed"),
        "average_heartrate": a.get("average_heartrate"),
        "max_heartrate": a.get("max_heartrate"),
        "average_cadence": a.get("average_cadence"),
        "calories": a.get("calories"),
        "kj": a.get("kilojoules"),
        # Champs au format intervals.icu pour compatibilité downstream
        "icu_average_watts": avg_w if avg_w else None,
        "icu_normalized_watts": np if np else None,
        "icu_max_watts": a.get("max_watts"),
        "icu_intensity": round(intensity, 3) if intensity else None,
        "icu_training_load": tss,
        "icu_ftp": ftp,  # FTP au moment de l'activité (approximatif : FTP courant)
        "has_heartrate": a.get("has_heartrate"),
        "has_power": a.get("device_watts") or bool(np or avg_w),
    }


# ============ CONFIG ============
ROOT = Path(__file__).parent
ENV_FILE = ROOT / ".env"
OUT_JSON = ROOT / "data.json"
OUT_JS = ROOT / "data.js"
OUT_STREAMS_JS = ROOT / "streams.js"
PREFETCH_STREAMS_COUNT = 30  # Nombre d'activités récentes dont on pré-télécharge les streams


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


# Note : intervals.icu n'est plus utilisé. Toutes les activités viennent de Strava.
# Voir strava.py pour le client API et fetch_data.py main() pour l'orchestration.


# ============ TRANSFORM ============
# Catalogue de tous les types Strava/intervals.icu reconnus, mappés vers les 5 catégories
# de filtre du dashboard. Garder en sync avec window.SPORTS_CATALOG dans dashboard.html.
SPORT_TYPE_TO_CATEGORY = {
    # Cyclisme
    "ride": "cyclisme", "virtualride": "cyclisme", "mountainbikeride": "cyclisme",
    "gravelride": "cyclisme", "ebikeride": "cyclisme", "emountainbikeride": "cyclisme",
    "velomobile": "cyclisme", "handcycle": "cyclisme",
    # Course à pied
    "run": "course", "trailrun": "course", "virtualrun": "course",
    # Natation
    "swim": "natation", "openwaterswim": "natation",
    # Musculation / salle
    "weighttraining": "musculation", "workout": "musculation", "crossfit": "musculation",
    "elliptical": "musculation", "stairstepper": "musculation", "virtualworkout": "musculation",
    # Autre (rando, ski, eau, sports co, mobilité, etc.)
    "walk": "autre", "hike": "autre", "snowshoe": "autre",
    "alpineski": "autre", "backcountryski": "autre", "nordicski": "autre",
    "snowboard": "autre", "iceskate": "autre", "inlineskate": "autre",
    "rowing": "autre", "kayaking": "autre", "canoeing": "autre",
    "standuppaddling": "autre", "surfing": "autre", "windsurf": "autre",
    "kitesurf": "autre", "sailing": "autre",
    "soccer": "autre", "basketball": "autre", "volleyball": "autre",
    "hockey": "autre", "tennis": "autre", "squash": "autre",
    "badminton": "autre", "tabletennis": "autre", "cricket": "autre",
    "americanfootball": "autre",
    "yoga": "autre", "pilates": "autre", "stretching": "autre",
    "rockclimbing": "autre", "boxing": "autre", "dance": "autre", "golf": "autre",
    "skateboard": "autre", "wheelchair": "autre", "transition": "autre",
}


def get_sport_category(activity):
    """Mappe une activite intervals.icu vers une grande categorie de sport.

    Catégories alignées sur les filtres du dashboard : cyclisme / course /
    musculation / natation / autre.
    Inférence par métriques si type absent (watts → cyclisme, etc.).
    """
    # intervals.icu utilise plusieurs champs pour le sport selon les cas :
    # type (Strava legacy), sport_type (Strava récent), activity_type, sport, category
    raw_type = (
        activity.get("type")
        or activity.get("sport_type")
        or activity.get("activity_type")
        or activity.get("sport")
        or activity.get("category")
        or ""
    )
    atype = str(raw_type).lower().replace(" ", "").replace("_", "")
    name = (activity.get("name") or "").lower()

    # 1. Lookup exact dans le catalogue
    if atype in SPORT_TYPE_TO_CATEGORY:
        return SPORT_TYPE_TO_CATEGORY[atype]

    # 2. Fallback heuristique sur le mot-clé dans le type
    if any(k in atype for k in ["ride", "bike", "cycle", "mtb", "spin"]):
        return "cyclisme"
    if "run" in atype:
        return "course"
    if "swim" in atype:
        return "natation"
    if any(k in atype for k in ["weight", "strength", "workout", "crossfit", "gym"]):
        return "musculation"

    # 3. Recherche dans le nom de l'activité
    if any(k in name for k in ["velo", "vélo", "cyclisme", "bike", "bicycl"]):
        return "cyclisme"
    if any(k in name for k in ["course a pied", "course à pied", "footing", "running", "trail", "jogging"]):
        return "course"
    if any(k in name for k in ["musculation", "muscu", "renfo", "gym", "crossfit", "weights"]):
        return "musculation"
    if "natation" in name or "piscine" in name:
        return "natation"

    # 4. Inférence par métriques
    avg_w = activity.get("icu_average_watts") or activity.get("avg_watts") or 0
    max_w = activity.get("max_watts") or activity.get("icu_max_watts") or 0
    avg_pace = activity.get("icu_average_pace") or 0
    dist_m = activity.get("distance") or 0
    avg_speed = activity.get("average_speed") or 0
    avg_cad = activity.get("average_cadence") or 0
    if avg_w or max_w:
        return "cyclisme"
    if avg_pace or (dist_m and avg_speed and avg_speed < 6 and avg_cad and 60 <= avg_cad <= 100):
        return "course"
    if dist_m and avg_speed and 6 <= avg_speed <= 25:
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
                "raw_type": (a.get("type") or a.get("sport_type") or a.get("activity_type") or a.get("sport") or a.get("category")),
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

    # Profil athlète : FTP / HRmax / LTHR depuis .env (puisqu'on n'a plus intervals.icu)
    ftp_env = int(env.get("FTP") or 0) or 240
    hr_max = int(env.get("HR_MAX") or 0) or 190
    lthr = int(env.get("LTHR") or 0) or int(hr_max * 0.92)

    # Strava — source PRINCIPALE des activités
    print("Connexion Strava...")
    strava_session = strava_client.get_session()
    strava_athlete = strava_client.fetch_athlete(strava_session)
    name = f"{strava_athlete.get('firstname', '')} {strava_athlete.get('lastname', '')}".strip() or "Athlete"
    weight = strava_athlete.get("weight") or 0
    ftp = strava_athlete.get("ftp") or ftp_env
    print(f"  [OK] {name} · FTP {ftp}W · HRmax {hr_max} · LTHR {lthr}bpm · {weight}kg")

    # Plage de dates : tout l'historique
    today = date.today()
    newest = today.isoformat()
    oldest = "2010-01-01"

    print(f"\n-> Récupération des activités Strava (peut prendre 1-2 min pour gros historiques)...")
    strava_acts = strava_client.fetch_activities(strava_session, after_iso=oldest, before_iso=newest)
    print(f"  [OK] {len(strava_acts)} activités Strava récupérées")

    # Conversion au format interne (avec calcul TSS / IF / NP côté Python)
    activities = [strava_to_internal(a, ftp, lthr) for a in strava_acts]

    # Plus de wellness intervals.icu : on calcule CTL/ATL/TSB nous-mêmes plus bas
    wellness = []

    # Pas d'events futurs (on n'a plus la planification intervals.icu) → liste vide
    events = []

    # ====== PRE-FETCH STREAMS + CALCUL DES MAX MANQUANTS ======
    # intervals.icu retourne max_watts=null pour beaucoup d'activités.
    # On le calcule depuis les streams pour les N dernières.
    print(f"\n-> Pre-fetch streams Strava des {PREFETCH_STREAMS_COUNT} dernieres activites...")
    recent_acts = sorted(
        [a for a in activities if a.get("id") and a.get("start_date_local")],
        key=lambda a: a["start_date_local"],
        reverse=True,
    )[:PREFETCH_STREAMS_COUNT]
    streams_cache = {}
    streams_max = {}
    for i, a in enumerate(recent_acts):
        aid = a.get("id")
        try:
            # Strava retourne {type: {data: [...]}, ...}, on convertit en [{type, data}, ...]
            strava_streams = strava_client.fetch_streams(strava_session, aid)
            s = [
                {"type": k, "data": (v.get("data") if isinstance(v, dict) else v) or []}
                for k, v in (strava_streams or {}).items()
            ] if isinstance(strava_streams, dict) else []
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

    # ====== CALCUL CTL/ATL/TSB nous-mêmes (Coggan EWMA) ======
    # Plus de wellness intervals.icu → on calcule depuis les TSS quotidiens
    daily_tss = {d: info.get("tss", 0) for d, info in day_index.items()}
    curves = compute_fitness_curves(daily_tss)
    for d, c in curves.items():
        day_index.setdefault(d, {}).update({
            "ctl": round(c["ctl"], 1),
            "atl": round(c["atl"], 1),
        })
    print(f"  [OK] CTL/ATL/TSB calculés sur {len(curves)} jours")

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
            "id": str(strava_athlete.get("id") or ""),
            "name": name,
            "ftp": ftp,
            "hr_max": hr_max,
            "lthr": lthr,
            "weight": weight,
        },
        "source": {
            "strava": True,
            "intervals_icu": False,
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
