"""
power_profile.py — Calcul du Power Profile (Mean Maximal Power) depuis les streams.

Pour chaque activité avec un stream "watts" (1 valeur par seconde), on calcule
la puissance moyenne maximale sur des fenêtres glissantes de durées standard
(1s, 5s, 30s, 1min, 5min, 20min, 60min, etc.).

Le cache power_profile_cache.json accumule les PP par activité. Au global,
on construit :
  - power_profile_alltime : MAX par durée sur toutes les activités
  - power_profile_90d     : MAX par durée sur les activités des 90 derniers jours
"""
from pathlib import Path
import json
from datetime import datetime, date, timedelta

# Durées standard du PP (en secondes), de très bref à très long
DURATIONS = [
    1, 5, 10, 15, 30, 60,                        # sprints / efforts brefs
    120, 180, 300, 600, 900, 1200, 1800,         # tempo / seuil
    2700, 3600, 5400, 7200,                      # longue durée
]

CACHE_PATH = Path(__file__).parent / "power_profile_cache.json"


def compute_mmp(watts_stream, durations=DURATIONS):
    """Mean Maximal Power : pour chaque durée d, retourne la moyenne max
    sur une fenêtre glissante de d secondes consécutives.

    watts_stream : liste de watts (1 valeur par seconde, peut contenir des None/0)
    durations    : liste de durées en secondes
    Retourne    : dict {duration_str: power_int} (clé en string pour JSON)
    """
    if not watts_stream:
        return {}

    # Nettoie : remplace None par 0
    ws = [int(w) if (w is not None and w > 0) else 0 for w in watts_stream]
    n = len(ws)

    # Pré-calcul du cumsum pour O(1) sum sur une fenêtre
    cum = [0] * (n + 1)
    for i, v in enumerate(ws):
        cum[i + 1] = cum[i] + v

    result = {}
    for d in durations:
        if d > n:
            # Fenêtre plus longue que l'activité : on prend la moyenne globale si l'activité dépasse d/2,
            # sinon on skip cette durée (pas significatif).
            if n >= d // 2 and n > 0:
                avg = cum[n] / n
                # On marque mais on ne stocke que si > 0
                if avg > 0:
                    # Stocker quand même comme "best disponible" pour cette activité
                    pass
            continue
        # Fenêtre glissante : max moyenne sur d secondes consécutives
        best = 0
        for i in range(0, n - d + 1):
            window_sum = cum[i + d] - cum[i]
            avg = window_sum / d
            if avg > best:
                best = avg
        if best > 0:
            result[str(d)] = round(best, 1)

    return result


def load_cache():
    """Charge le cache PP. Format : { activity_id: {date, sport, pp: {dur: watts}} }"""
    if not CACHE_PATH.exists():
        return {}
    try:
        return json.loads(CACHE_PATH.read_text(encoding="utf-8"))
    except Exception:
        return {}


def save_cache(cache):
    CACHE_PATH.write_text(
        json.dumps(cache, ensure_ascii=False, indent=2, default=str),
        encoding="utf-8",
    )


def update_cache_with_activity(cache, activity, streams_dict):
    """Calcule le PP de l'activité depuis ses streams et l'ajoute au cache.

    activity : dict d'activité (au format interne — voir fetch_data.strava_to_internal)
    streams_dict : dict {stream_type: [data]} (format intervals.icu) ou None
    """
    aid = str(activity.get("id") or "")
    if not aid or not streams_dict:
        return None

    # Trouve le stream watts
    watts = None
    for stream in (streams_dict if isinstance(streams_dict, list) else []):
        if stream.get("type") == "watts":
            watts = stream.get("data") or []
            break
    if not watts:
        return None

    pp = compute_mmp(watts)
    if not pp:
        return None

    cache[aid] = {
        "date": (activity.get("start_date_local") or "")[:10],
        "sport": activity.get("sport_type") or activity.get("type"),
        "duration_s": int(activity.get("moving_time") or activity.get("elapsed_time") or 0),
        "pp": pp,
    }
    return pp


def aggregate(cache, since_iso=None):
    """Agrège le cache pour donner le PP best-of par durée.

    since_iso : si fourni (YYYY-MM-DD), ne considère que les activités à partir de cette date
    Retourne {dur_str: max_power}
    """
    best = {}
    for aid, info in cache.items():
        d = info.get("date") or ""
        if since_iso and d < since_iso:
            continue
        pp = info.get("pp") or {}
        for dur_str, watts in pp.items():
            if dur_str not in best or watts > best[dur_str]:
                best[dur_str] = watts
    return best


def build_alltime_and_90d(cache, today=None):
    """Construit les 2 séries PP all-time et PP des 90 derniers jours."""
    if today is None:
        today = date.today()
    since_90d = (today - timedelta(days=90)).isoformat()
    return {
        "alltime": aggregate(cache),
        "last_90d": aggregate(cache, since_iso=since_90d),
        "durations": [str(d) for d in DURATIONS],
        "cache_size": len(cache),
        "last_updated": datetime.now().isoformat(),
    }
