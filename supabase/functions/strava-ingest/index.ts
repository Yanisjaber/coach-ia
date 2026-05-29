// ============================================================
// Edge Function : strava-ingest
//
// Récupère toutes les activités Strava de l'utilisateur connecté
// et les insère dans la table activities.
//
// Appelée par le front (POST) avec le JWT Supabase dans Authorization.
//
// Flow :
//   1. Vérifier le JWT pour identifier l'user
//   2. Lire les tokens Strava (table strava_connections)
//   3. Refresh si expiré
//   4. Fetch /athlete/activities paginé jusqu'à tout récupérer
//   5. Mapper chaque activité au format de notre table 'activities'
//   6. Upsert par batches
//   7. Recalculer les daily_metrics (CTL/ATL/TSB par jour)
//   8. Retourner un résumé { imported, errors }
//
// Déploiement :
//   supabase functions deploy strava-ingest
//   (avec verification JWT activée, c'est l'authent standard)
//
// Note timeout : Supabase Edge Functions ont 60s max. Pour gros historiques
// (>2000 activités), pourrait nécessiter pagination côté client + appels multiples.
// ============================================================
// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const STRAVA_CLIENT_ID = Deno.env.get("STRAVA_CLIENT_ID")!;
const STRAVA_CLIENT_SECRET = Deno.env.get("STRAVA_CLIENT_SECRET")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const STRAVA_API = "https://www.strava.com/api/v3";
const BATCH_SIZE = 100;
const PER_PAGE = 200;

// CORS headers pour pouvoir être appelée depuis n'importe quel domaine front
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // ===== 1) Auth via JWT =====
    const authHeader = req.headers.get("Authorization") || "";
    const jwt = authHeader.replace("Bearer ", "").trim();
    if (!jwt) return json({ error: "missing_jwt" }, 401);

    const sbAuth = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    const { data: { user }, error: authErr } = await sbAuth.auth.getUser(jwt);
    if (authErr || !user) return json({ error: "invalid_jwt" }, 401);

    // ===== 2) Récupérer les tokens Strava + profil athlète (FTP, HRmax, LTHR) =====
    const sbAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data: conn, error: connErr } = await sbAdmin
      .from("strava_connections")
      .select("*")
      .eq("user_id", user.id)
      .maybeSingle();

    if (connErr || !conn) {
      return json({ error: "no_strava_connection" }, 400);
    }

    // FTP / HRmax / LTHR vivent dans user_profiles, pas dans strava_connections.
    // On les récupère pour pouvoir calculer le TSS correctement.
    const { data: profile } = await sbAdmin
      .from("user_profiles")
      .select("ftp, hr_max, lthr")
      .eq("user_id", user.id)
      .maybeSingle();
    const athleteFtp = profile?.ftp || null;
    const athleteHrMax = profile?.hr_max || null;
    const athleteLthr = profile?.lthr || (athleteHrMax ? Math.round(athleteHrMax * 0.92) : null);

    // Marquer le sync comme "running"
    await sbAdmin.from("strava_connections").update({
      last_sync_status: "running",
      last_sync_at: new Date().toISOString(),
    }).eq("user_id", user.id);

    // ===== 3) Refresh token si expiré =====
    let accessToken = conn.access_token;
    if (new Date(conn.expires_at) <= new Date(Date.now() + 60_000)) {
      const refreshed = await refreshStravaToken(conn.refresh_token);
      if (!refreshed) {
        await markError(sbAdmin, user.id, "token_refresh_failed");
        return json({ error: "token_refresh_failed" }, 500);
      }
      accessToken = refreshed.access_token;
      await sbAdmin.from("strava_connections").update({
        access_token: refreshed.access_token,
        refresh_token: refreshed.refresh_token,
        expires_at: new Date(refreshed.expires_at * 1000).toISOString(),
      }).eq("user_id", user.id);
    }

    // ===== 4) Fetch activités paginé =====
    const all: any[] = [];
    let page = 1;
    while (page <= 50) { // garde-fou 10 000 activités max
      const res = await fetch(`${STRAVA_API}/athlete/activities?page=${page}&per_page=${PER_PAGE}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (res.status === 401) {
        await markError(sbAdmin, user.id, "strava_unauthorized");
        return json({ error: "strava_unauthorized" }, 401);
      }
      if (res.status === 429) {
        // Rate limit Strava (100/15min) : on stoppe ce qu'on a déjà
        console.warn("Strava rate limit hit at page", page);
        break;
      }
      if (!res.ok) {
        const txt = await res.text();
        await markError(sbAdmin, user.id, `strava_${res.status}_${txt.slice(0, 80)}`);
        return json({ error: `strava_${res.status}` }, 500);
      }
      const acts = await res.json();
      if (!acts.length) break;
      all.push(...acts);
      if (acts.length < PER_PAGE) break;
      page++;
    }

    // ===== 5) Mapper au format de notre table =====
    const rows = all
      .filter((a: any) => a && a.id)
      .map((a: any) => stravaToRow(a, user.id, athleteFtp, athleteLthr));

    // ===== 6) Upsert par batches =====
    let inserted = 0;
    let errors = 0;
    let firstError: string | null = null;
    let firstErrorBatchIndex = -1;
    let firstErrorSample: any = null;
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = rows.slice(i, i + BATCH_SIZE);
      const { error: upErr } = await sbAdmin
        .from("activities")
        .upsert(batch, { onConflict: "user_id,strava_id" });
      if (upErr) {
        console.error(`Upsert batch ${i / BATCH_SIZE} error:`, upErr.message, upErr.details, upErr.hint);
        console.error("Sample row from failing batch:", JSON.stringify(batch[0]));
        errors += batch.length;
        if (!firstError) {
          firstError = `${upErr.message}${upErr.details ? ' | ' + upErr.details : ''}${upErr.hint ? ' | hint: ' + upErr.hint : ''}`;
          firstErrorBatchIndex = i / BATCH_SIZE;
          firstErrorSample = batch[0];
        }
      } else {
        inserted += batch.length;
      }
    }

    // ===== 7) Recalculer les daily_metrics depuis les activities =====
    // On regroupe par jour : tss total + nombre d'activités + main activity (max TSS)
    // Puis on calcule CTL/ATL/TSB via EWMA (Coggan)
    const dailyMap = new Map<string, { tss: number; duration: number; count: number; mainId: string | null; mainTss: number }>();
    for (const r of rows) {
      const iso = String(r.start_date_local).slice(0, 10);
      const existing = dailyMap.get(iso) || { tss: 0, duration: 0, count: 0, mainId: null, mainTss: -1 };
      existing.tss += r.tss || 0;
      existing.duration += Math.round((r.moving_time || r.elapsed_time || 0) / 60);
      existing.count += 1;
      if ((r.tss || 0) > existing.mainTss) {
        existing.mainTss = r.tss || 0;
        existing.mainId = r.strava_id; // on relinkera plus tard avec l'UUID
      }
      dailyMap.set(iso, existing);
    }

    // Calcul CTL/ATL/TSB EWMA (continu, comble les trous)
    const sortedIsos = [...dailyMap.keys()].sort();
    let ctl = 0, atl = 0;
    const dailyRows: any[] = [];
    if (sortedIsos.length > 0) {
      const start = new Date(sortedIsos[0] + "T00:00:00Z");
      const end = new Date(sortedIsos[sortedIsos.length - 1] + "T00:00:00Z");
      const cursor = new Date(start);
      while (cursor <= end) {
        const iso = cursor.toISOString().slice(0, 10);
        const d = dailyMap.get(iso) || { tss: 0, duration: 0, count: 0, mainId: null, mainTss: 0 };
        const tss = d.tss;
        ctl = ctl + (tss - ctl) * (2 / (42 + 1));
        atl = atl + (tss - atl) * (2 / (7 + 1));
        dailyRows.push({
          user_id: user.id,
          iso_date: iso,
          tss: Math.round(tss),
          ctl: +ctl.toFixed(1),
          atl: +atl.toFixed(1),
          tsb: +(ctl - atl).toFixed(1),
          duration_min: d.duration,
          activity_count: d.count,
        });
        cursor.setUTCDate(cursor.getUTCDate() + 1);
      }
    }

    // Upsert daily_metrics par batches
    for (let i = 0; i < dailyRows.length; i += 500) {
      const batch = dailyRows.slice(i, i + 500);
      const { error: dmErr } = await sbAdmin
        .from("daily_metrics")
        .upsert(batch, { onConflict: "user_id,iso_date" });
      if (dmErr) console.error("Upsert daily_metrics error:", dmErr);
    }

    // ===== 8) Marquer sync OK =====
    await sbAdmin.from("strava_connections").update({
      last_sync_status: "ok",
      last_sync_at: new Date().toISOString(),
      last_sync_error: null,
      total_activities_synced: inserted,
    }).eq("user_id", user.id);

    return json({
      ok: true,
      pages_fetched: page,
      activities_received: all.length,
      activities_inserted: inserted,
      activities_errored: errors,
      daily_metrics_computed: dailyRows.length,
      first_error: firstError,
      first_error_batch: firstErrorBatchIndex,
      first_error_sample: firstErrorSample,
    });
  } catch (e: any) {
    console.error("strava-ingest unhandled:", e);
    return json({ error: e.message || String(e) }, 500);
  }
});

// ============ HELPERS ============
function json(body: any, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function markError(sb: any, userId: string, msg: string) {
  await sb.from("strava_connections").update({
    last_sync_status: "error",
    last_sync_error: msg.slice(0, 500),
    last_sync_at: new Date().toISOString(),
  }).eq("user_id", userId);
}

async function refreshStravaToken(refreshToken: string) {
  const res = await fetch("https://www.strava.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: STRAVA_CLIENT_ID,
      client_secret: STRAVA_CLIENT_SECRET,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });
  if (!res.ok) return null;
  return await res.json();
}

// Mapping COMPLET Strava sport_type / type → catégorie Coach IA.
// Source : https://developers.strava.com/docs/reference/#api-models-SportType
const SPORT_TO_CAT: Record<string, string> = {
  // Cyclisme
  Ride: "cyclisme", VirtualRide: "cyclisme", MountainBikeRide: "cyclisme",
  GravelRide: "cyclisme", EBikeRide: "cyclisme", EMountainBikeRide: "cyclisme",
  Velomobile: "cyclisme", Handcycle: "cyclisme",
  // Course
  Run: "course", TrailRun: "course", VirtualRun: "course",
  // Natation
  Swim: "natation", OpenWaterSwim: "natation",
  // Musculation / salle
  WeightTraining: "musculation", Workout: "musculation", Crossfit: "musculation",
  Elliptical: "musculation", StairStepper: "musculation", VirtualWorkout: "musculation",
  // Marche / rando
  Walk: "autre", Hike: "autre", Snowshoe: "autre",
  // Neige
  AlpineSki: "autre", BackcountrySki: "autre", NordicSki: "autre",
  Snowboard: "autre", IceSkate: "autre", InlineSkate: "autre",
  // Eau
  Rowing: "autre", Kayaking: "autre", Canoeing: "autre",
  StandUpPaddling: "autre", Surfing: "autre", Windsurf: "autre",
  Kitesurf: "autre", Sailing: "autre",
  // Sports co / raquettes
  Soccer: "autre", Basketball: "autre", Volleyball: "autre",
  Hockey: "autre", Tennis: "autre", Squash: "autre",
  Badminton: "autre", TableTennis: "autre", Cricket: "autre",
  AmericanFootball: "autre",
  // Souplesse / autre
  Yoga: "autre", Pilates: "autre", Stretching: "autre",
  RockClimbing: "autre", Boxing: "autre", Dance: "autre", Golf: "autre",
  Skateboard: "autre", Wheelchair: "autre", Transition: "autre",
};
function getSportCategory(sportRaw: string): string {
  if (!sportRaw) return "autre";
  return SPORT_TO_CAT[sportRaw] || "autre";
}

// Classification type d'effort : par mot-clé du nom puis fallback intensité.
function classifyType(name: string, intensity: number, sportCat: string): string {
  const n = (name || "").toLowerCase();
  if (sportCat === "musculation") return "force";
  if (sportCat === "natation") return "natation";
  // Mots-clés explicites dans le nom
  if (/\b(repos|rest|récup|recovery)\b/.test(n)) return "recup";
  if (/\b(vo2|vmax)\b/.test(n)) return "vo2";
  if (/\b(seuil|threshold|ftp\s*test)\b/.test(n)) return "seuil";
  if (/\b(tempo|sweet\s*spot)\b/.test(n)) return "tempo";
  // Fallback : intensité (ratio 0-1.5)
  if (!intensity || intensity === 0) return "endurance";
  if (intensity < 0.70) return "recup";
  if (intensity < 0.80) return "endurance";
  if (intensity < 0.90) return "tempo";
  if (intensity < 1.00) return "seuil";
  return "vo2";
}

// Calcul TSS Coggan : (durée_h) × IF² × 100
// Priorité : NP/FTP (puissance) → HR/LTHR (cardio) → 0
function computeTss(a: any, ftp: number | null, lthr: number | null): number {
  const dur = a.moving_time || a.elapsed_time || 0;
  if (!dur) return 0;
  const durHr = dur / 3600;
  const np = a.weighted_average_watts || 0;
  if (np && ftp) {
    const intensity = np / ftp;
    return Math.round(durHr * intensity * intensity * 100);
  }
  const avgHr = a.average_heartrate || 0;
  if (avgHr && lthr) {
    const intensity = avgHr / lthr;
    return Math.round(durHr * intensity * intensity * 100);
  }
  return 0;
}

function stravaToRow(a: any, userId: string, ftp: number | null, lthr: number | null) {
  const sportRaw = a.sport_type || a.type || "";
  const sport = getSportCategory(sportRaw);
  const np = a.weighted_average_watts || 0;
  const intensity = (np && ftp) ? np / ftp : 0;
  const tss = computeTss(a, ftp, lthr);
  const distKm = a.distance ? +(a.distance / 1000).toFixed(2) : null;
  const speedMs = a.average_speed || 0;
  const maxSpeedMs = a.max_speed || 0;

  return {
    user_id: userId,
    strava_id: a.id,
    name: a.name || "Activité",
    sport,
    sport_raw: sportRaw,
    type: classifyType(a.name, intensity, sport),
    start_date_local: a.start_date_local || a.start_date,
    elapsed_time: a.elapsed_time != null ? Math.round(a.elapsed_time) : null,
    moving_time: a.moving_time != null ? Math.round(a.moving_time) : null,
    distance_km: distKm,
    total_elevation_gain: a.total_elevation_gain != null ? Math.round(a.total_elevation_gain) : null,
    total_elevation_loss: a.total_elevation_loss != null ? Math.round(a.total_elevation_loss) : null,
    avg_speed_kmh: speedMs ? +(speedMs * 3.6).toFixed(2) : null,
    max_speed_kmh: maxSpeedMs ? +(maxSpeedMs * 3.6).toFixed(2) : null,
    avg_heartrate: a.average_heartrate ? Math.round(a.average_heartrate) : null,
    max_heartrate: a.max_heartrate ? Math.round(a.max_heartrate) : null,
    avg_watts: a.average_watts ? Math.round(a.average_watts) : null,
    max_watts: a.max_watts ? Math.round(a.max_watts) : null,
    np: np ? Math.round(np) : null,
    intensity: intensity ? +intensity.toFixed(3) : null,
    ftp_at_time: ftp,
    avg_cadence: a.average_cadence ? Math.round(a.average_cadence) : null,
    max_cadence: null,
    kj: a.kilojoules ? Math.round(a.kilojoules) : null,
    calories: a.calories ? Math.round(a.calories) : null,
    tss,
    has_heartrate: !!a.has_heartrate,
    has_power: !!(a.device_watts || np),
    device_watts: !!a.device_watts,
  };
}
