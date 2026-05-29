// ============================================================
// Edge Function : strava-webhook
//
// Reçoit les events Strava en temps réel via leur système de webhooks
// (https://developers.strava.com/docs/webhooks/).
//
// Flow :
//   GET ?hub.mode=subscribe&hub.challenge=XXX&hub.verify_token=YYY
//     → Strava valide l'URL lors de l'inscription. On renvoie le challenge
//       en JSON si le verify_token matche le nôtre.
//
//   POST { aspect_type, event_time, object_id, object_type, owner_id, ... }
//     → On traite l'event :
//       - object_type=activity, aspect_type=create  → fetch + insert
//       - object_type=activity, aspect_type=update  → fetch + upsert (TSS/IF peut changer)
//       - object_type=activity, aspect_type=delete  → delete + recompute
//       - object_type=athlete, updates.authorized=false → désauthorisation, on supprime
//         la strava_connection (l'user reste, juste plus de sync auto)
//
// Déploiement :
//   supabase functions deploy strava-webhook --no-verify-jwt
//
// Secrets requis :
//   STRAVA_CLIENT_ID
//   STRAVA_CLIENT_SECRET
//   SUPABASE_URL (auto)
//   SUPABASE_SERVICE_ROLE_KEY (auto)
//   STRAVA_WEBHOOK_VERIFY_TOKEN  ← à définir, une chaîne aléatoire qu'on partage avec Strava
//
// Abonnement (1 seule fois, voir SETUP_STRAVA_WEBHOOK.md) :
//   curl -X POST https://www.strava.com/api/v3/push_subscriptions \
//     -F client_id=$STRAVA_CLIENT_ID \
//     -F client_secret=$STRAVA_CLIENT_SECRET \
//     -F callback_url=https://<projet>.supabase.co/functions/v1/strava-webhook \
//     -F verify_token=$STRAVA_WEBHOOK_VERIFY_TOKEN
//
// Note : Strava n'autorise QU'UN SEUL abonnement actif par client_id.
// ============================================================
// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const STRAVA_CLIENT_ID = Deno.env.get("STRAVA_CLIENT_ID")!;
const STRAVA_CLIENT_SECRET = Deno.env.get("STRAVA_CLIENT_SECRET")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const VERIFY_TOKEN = Deno.env.get("STRAVA_WEBHOOK_VERIFY_TOKEN") || "coachia-webhook-token";

const STRAVA_API = "https://www.strava.com/api/v3";

Deno.serve(async (req) => {
  const url = new URL(req.url);

  // ============================================================
  // 1) GET — Strava validation challenge (au moment de l'abonnement)
  // ============================================================
  if (req.method === "GET") {
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");
    console.log(`[webhook] GET validation : mode=${mode} token=${token ? "(set)" : "(missing)"}`);
    if (mode === "subscribe" && token === VERIFY_TOKEN && challenge) {
      return json({ "hub.challenge": challenge });
    }
    return new Response("Forbidden", { status: 403 });
  }

  // ============================================================
  // 2) POST — Event Strava
  // ============================================================
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  let event: any;
  try {
    event = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  console.log("[webhook] event:", JSON.stringify(event));

  // ⚠ IMPORTANT : Strava attend une réponse 200 RAPIDEMENT (< 2s) sinon il retente.
  // On retourne tout de suite, puis on traite en arrière-plan.
  const responsePromise = (async () => {
    try {
      await handleEvent(event);
    } catch (e) {
      console.error("[webhook] handleEvent error:", e);
    }
  })();

  // Cas spécial Deno : utiliser EdgeRuntime.waitUntil pour finir le traitement
  // après avoir répondu. Fallback : attendre normalement.
  // @ts-ignore
  if (typeof EdgeRuntime !== "undefined" && EdgeRuntime.waitUntil) {
    // @ts-ignore
    EdgeRuntime.waitUntil(responsePromise);
  } else {
    await responsePromise;
  }

  return json({ ok: true });
});

// ============================================================
// HANDLER PRINCIPAL
// ============================================================
async function handleEvent(event: any) {
  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const objectType = event.object_type;
  const aspectType = event.aspect_type;
  const objectId = event.object_id;
  const ownerId = event.owner_id;
  const updates = event.updates || {};

  if (!ownerId) {
    console.warn("[webhook] no owner_id, skipping");
    return;
  }

  // ===== Désauthorisation =====
  // Si l'athlète a révoqué l'autorisation de l'app via Strava → on supprime la connection.
  if (objectType === "athlete" && updates.authorized === "false") {
    console.log(`[webhook] deauth pour athlete ${ownerId}`);
    await sb.from("strava_connections").delete().eq("strava_athlete_id", ownerId);
    return;
  }

  // ===== Events sur activités =====
  if (objectType !== "activity") {
    console.log(`[webhook] event ignoré : object_type=${objectType}`);
    return;
  }

  // Récupère TOUTES les connections liées à ce strava_athlete_id (peut être >1 user)
  const { data: conns } = await sb
    .from("strava_connections")
    .select("*")
    .eq("strava_athlete_id", ownerId);

  if (!conns || conns.length === 0) {
    console.warn(`[webhook] aucune connection pour athlete ${ownerId}`);
    return;
  }

  for (const conn of conns) {
    try {
      if (aspectType === "delete") {
        await handleActivityDelete(sb, conn.user_id, objectId);
      } else {
        // create ou update : on (re)fetch l'activité complète
        await handleActivityUpsert(sb, conn, objectId);
      }
      // Marquer le temps de dernier event reçu
      await sb.from("strava_connections").update({
        last_sync_at: new Date().toISOString(),
        last_sync_status: "ok",
      }).eq("user_id", conn.user_id);
    } catch (e: any) {
      console.error(`[webhook] erreur user ${conn.user_id}:`, e);
      await sb.from("strava_connections").update({
        last_sync_status: "error",
        last_sync_error: String(e?.message || e).slice(0, 500),
      }).eq("user_id", conn.user_id);
    }
  }
}

// ============================================================
// CREATE / UPDATE : fetch + upsert + recompute
// ============================================================
async function handleActivityUpsert(sb: any, conn: any, activityId: number) {
  // 1) Token refresh si nécessaire
  let accessToken = conn.access_token;
  if (new Date(conn.expires_at) <= new Date(Date.now() + 60_000)) {
    const refreshed = await refreshStravaToken(conn.refresh_token);
    if (!refreshed) throw new Error("token_refresh_failed");
    accessToken = refreshed.access_token;
    await sb.from("strava_connections").update({
      access_token: refreshed.access_token,
      refresh_token: refreshed.refresh_token,
      expires_at: new Date(refreshed.expires_at * 1000).toISOString(),
    }).eq("user_id", conn.user_id);
  }

  // 2) Fetch activité depuis Strava
  const res = await fetch(`${STRAVA_API}/activities/${activityId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (res.status === 404) {
    console.warn(`[webhook] activité ${activityId} introuvable (probablement supprimée)`);
    await handleActivityDelete(sb, conn.user_id, activityId);
    return;
  }
  if (!res.ok) throw new Error(`strava_api_${res.status}`);
  const activity = await res.json();

  // 3) Récupérer FTP/HRmax/LTHR de l'user pour le calcul TSS
  const { data: profile } = await sb
    .from("user_profiles")
    .select("ftp, hr_max, lthr")
    .eq("user_id", conn.user_id)
    .maybeSingle();
  const ftp = profile?.ftp || null;
  const hrMax = profile?.hr_max || null;
  const lthr = profile?.lthr || (hrMax ? Math.round(hrMax * 0.92) : null);

  // 4) Mapper + upsert
  const row = stravaToRow(activity, conn.user_id, ftp, lthr);
  const { error: upErr } = await sb
    .from("activities")
    .upsert(row, { onConflict: "user_id,strava_id" });
  if (upErr) throw upErr;
  console.log(`[webhook] activité ${activityId} (${row.name}) upserted pour user ${conn.user_id}`);

  // 5) Recalculer les daily_metrics depuis la date de cette activité
  const startIso = String(row.start_date_local).slice(0, 10);
  await recomputeDailyMetricsFrom(sb, conn.user_id, startIso);
}

// ============================================================
// DELETE : supprimer activité + recompute
// ============================================================
async function handleActivityDelete(sb: any, userId: string, activityId: number) {
  // Récupérer la date de l'activité avant de la supprimer (pour savoir d'où recomputer)
  const { data: existing } = await sb
    .from("activities")
    .select("start_date_local")
    .eq("user_id", userId)
    .eq("strava_id", activityId)
    .maybeSingle();

  const { error: delErr } = await sb
    .from("activities")
    .delete()
    .eq("user_id", userId)
    .eq("strava_id", activityId);
  if (delErr) throw delErr;
  console.log(`[webhook] activité ${activityId} supprimée pour user ${userId}`);

  if (existing?.start_date_local) {
    const startIso = String(existing.start_date_local).slice(0, 10);
    await recomputeDailyMetricsFrom(sb, userId, startIso);
  }
}

// ============================================================
// RECOMPUTE daily_metrics depuis une date (chaîne EWMA continue)
// ============================================================
async function recomputeDailyMetricsFrom(sb: any, userId: string, startIso: string) {
  // 1) Seed : CTL/ATL de la veille
  const prevDate = new Date(startIso + "T00:00:00Z");
  prevDate.setUTCDate(prevDate.getUTCDate() - 1);
  const prevIso = prevDate.toISOString().slice(0, 10);
  const { data: seed } = await sb
    .from("daily_metrics")
    .select("ctl, atl")
    .eq("user_id", userId)
    .eq("iso_date", prevIso)
    .maybeSingle();
  let ctl = Number(seed?.ctl || 0);
  let atl = Number(seed?.atl || 0);

  // 2) Toutes les activités depuis startIso (paginé)
  const activities = await fetchAllActivities(sb, userId, startIso);

  // 3) Grouper par date
  const byDate = new Map<string, { tss: number; duration: number; count: number }>();
  for (const a of activities) {
    const iso = String(a.start_date_local).slice(0, 10);
    const cur = byDate.get(iso) || { tss: 0, duration: 0, count: 0 };
    cur.tss += a.tss || 0;
    cur.duration += Math.round((a.moving_time || a.elapsed_time || 0) / 60);
    cur.count += 1;
    byDate.set(iso, cur);
  }

  // 4) Aller jusqu'à aujourd'hui (au minimum)
  const endDate = new Date();
  const lastActIso = activities.length > 0
    ? String(activities[activities.length - 1].start_date_local).slice(0, 10)
    : startIso;
  const endIso = lastActIso > endDate.toISOString().slice(0, 10)
    ? lastActIso
    : endDate.toISOString().slice(0, 10);

  // 5) Construire la chaîne jour par jour
  const rows: any[] = [];
  const cursor = new Date(startIso + "T00:00:00Z");
  const end = new Date(endIso + "T00:00:00Z");
  while (cursor <= end) {
    const iso = cursor.toISOString().slice(0, 10);
    const d = byDate.get(iso) || { tss: 0, duration: 0, count: 0 };
    const tss = d.tss;
    ctl = ctl + (tss - ctl) * (2 / (42 + 1));
    atl = atl + (tss - atl) * (2 / (7 + 1));
    rows.push({
      user_id: userId,
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

  // 6) Upsert par batches
  for (let i = 0; i < rows.length; i += 500) {
    const batch = rows.slice(i, i + 500);
    const { error } = await sb
      .from("daily_metrics")
      .upsert(batch, { onConflict: "user_id,iso_date" });
    if (error) console.error("[webhook] upsert daily_metrics error:", error);
  }
  console.log(`[webhook] daily_metrics recalculés : ${rows.length} jours depuis ${startIso}`);
}

async function fetchAllActivities(sb: any, userId: string, fromIso: string) {
  const all: any[] = [];
  const PAGE = 1000;
  let from = 0;
  while (true) {
    const { data, error } = await sb
      .from("activities")
      .select("strava_id, start_date_local, tss, moving_time, elapsed_time")
      .eq("user_id", userId)
      .gte("start_date_local", fromIso)
      .order("start_date_local", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) { console.error(error); break; }
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return all;
}

// ============================================================
// HELPERS (dupliqués de strava-ingest pour rester autonome)
// ============================================================
function json(body: any, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
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

const SPORT_TO_CAT: Record<string, string> = {
  Ride: "cyclisme", VirtualRide: "cyclisme", MountainBikeRide: "cyclisme",
  GravelRide: "cyclisme", EBikeRide: "cyclisme", EMountainBikeRide: "cyclisme",
  Velomobile: "cyclisme", Handcycle: "cyclisme",
  Run: "course", TrailRun: "course", VirtualRun: "course",
  Swim: "natation", OpenWaterSwim: "natation",
  WeightTraining: "musculation", Workout: "musculation", Crossfit: "musculation",
  Elliptical: "musculation", StairStepper: "musculation", VirtualWorkout: "musculation",
  Walk: "autre", Hike: "autre", Snowshoe: "autre",
  AlpineSki: "autre", BackcountrySki: "autre", NordicSki: "autre",
  Snowboard: "autre", IceSkate: "autre", InlineSkate: "autre",
  Rowing: "autre", Kayaking: "autre", Canoeing: "autre",
  StandUpPaddling: "autre", Surfing: "autre", Windsurf: "autre",
  Kitesurf: "autre", Sailing: "autre",
  Soccer: "autre", Basketball: "autre", Volleyball: "autre",
  Hockey: "autre", Tennis: "autre", Squash: "autre",
  Badminton: "autre", TableTennis: "autre", Cricket: "autre",
  AmericanFootball: "autre",
  Yoga: "autre", Pilates: "autre", Stretching: "autre",
  RockClimbing: "autre", Boxing: "autre", Dance: "autre", Golf: "autre",
  Skateboard: "autre", Wheelchair: "autre", Transition: "autre",
};
function getSportCategory(sportRaw: string): string {
  if (!sportRaw) return "autre";
  return SPORT_TO_CAT[sportRaw] || "autre";
}

function classifyType(name: string, intensity: number, sportCat: string): string {
  const n = (name || "").toLowerCase();
  if (sportCat === "musculation") return "force";
  if (sportCat === "natation") return "natation";
  if (/\b(repos|rest|récup|recovery)\b/.test(n)) return "recup";
  if (/\b(vo2|vmax)\b/.test(n)) return "vo2";
  if (/\b(seuil|threshold|ftp\s*test)\b/.test(n)) return "seuil";
  if (/\b(tempo|sweet\s*spot)\b/.test(n)) return "tempo";
  if (!intensity || intensity === 0) return "endurance";
  if (intensity < 0.70) return "recup";
  if (intensity < 0.80) return "endurance";
  if (intensity < 0.90) return "tempo";
  if (intensity < 1.00) return "seuil";
  return "vo2";
}

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
