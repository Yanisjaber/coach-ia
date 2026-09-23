// ============================================================
// Edge Function : garmin-ingest
//
// Récupère le sommeil Garmin (phases, score, HRV, stress...) et l'upsert
// dans garmin_sleep. Port direct du script Python validé localement
// (mêmes endpoints connectapi.garmin.com, même mapping des phases).
//
// Différence avec strava-ingest/whoop-ingest : Garmin n'a pas de portail
// OAuth développeur public. Le token initial vient d'un login manuel
// (garth/garminconnect) inséré une fois dans connexions_app. Le
// renouvellement de l'access_token ne passe pas par un refresh_token
// classique mais par une signature OAuth1 HMAC-SHA1 sur oauth1_token/
// oauth1_secret (reproduite ici en Web Crypto, sans dépendance).
//
// Appel utilisateur (front, POST, JWT Supabase dans Authorization) :
//   body JSON optionnel : { "days": 3 }
//
// Appel interne (pg_cron, pas de session utilisateur) :
//   Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>
//   body JSON : { "user_id": "<uuid>", "days": 3 }
//
// Déploiement :
//   supabase functions deploy garmin-ingest --no-verify-jwt
//
// Secrets requis : SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
// (déjà posés pour whoop-ingest / strava-ingest, réutilisés ici)
// ============================================================
// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
// Secret dédié pour le déclenchement pg_cron — privilège minimal, distinct
// de la service role key (qui contourne toute RLS). Ce secret ne permet
// QUE d'appeler garmin-ingest pour un user_id donné, rien d'autre.
const GARMIN_CRON_SECRET = Deno.env.get("GARMIN_CRON_SECRET");

const OAUTH_CONSUMER_URL = "https://thegarth.s3.amazonaws.com/oauth_consumer.json";
const USER_AGENT_API = "GCM-iOS-5.7.2.1";
const USER_AGENT_SSO = "com.garmin.android.apps.connectmobile";
const DEFAULT_DAYS = 3;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    // ===== 1) Auth : JWT utilisateur normal, ou appel interne pg_cron =====
    const authHeader = (req.headers.get("Authorization") || "").replace("Bearer ", "").trim();
    const body = await safeJson(req);
    let userId: string;

    if (authHeader && GARMIN_CRON_SECRET && authHeader === GARMIN_CRON_SECRET) {
      if (!body?.user_id) return json({ error: "missing_user_id" }, 400);
      userId = body.user_id;
    } else {
      if (!authHeader) return json({ error: "missing_jwt" }, 401);
      const sbAuth = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
      const { data: { user }, error: authErr } = await sbAuth.auth.getUser(authHeader);
      if (authErr || !user) return json({ error: "invalid_jwt" }, 401);
      userId = user.id;
    }

    const days = clampInt(body?.days, 1, 30, DEFAULT_DAYS);
    const sbAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // ===== 2) Connexion Garmin + refresh si besoin =====
    const { data: conn, error: connErr } = await sbAdmin
      .from("connexions_app").select("*").eq("user_id", userId).eq("app", "garmin").maybeSingle();
    if (connErr || !conn) return json({ error: "no_garmin_connection" }, 400);

    await sbAdmin.from("connexions_app").update({
      last_sync_status: "running", last_sync_at: new Date().toISOString(),
    }).eq("user_id", userId).eq("app", "garmin");

    let accessToken = conn.access_token as string;
    if (new Date(conn.expires_at) <= new Date(Date.now() + 60_000)) {
      const refreshed = await refreshGarminToken(conn.oauth1_token, conn.oauth1_secret);
      if (!refreshed) {
        await markErr(sbAdmin, userId, "token_refresh_failed");
        return json({ error: "token_refresh_failed" }, 500);
      }
      accessToken = refreshed.access_token;
      await sbAdmin.from("connexions_app").update({
        access_token: refreshed.access_token,
        expires_at: new Date(refreshed.expires_at * 1000).toISOString(),
      }).eq("user_id", userId).eq("app", "garmin");
    }

    // ===== 3) Profil (displayName requis par l'endpoint sommeil) =====
    let displayName: string;
    try {
      const profile = await connectapiGet("/userprofile-service/socialProfile", accessToken);
      displayName = profile.displayName;
    } catch (e: any) {
      const msg = `profile_fetch_${(e?.message || e).toString().slice(0, 80)}`;
      await markErr(sbAdmin, userId, msg);
      return json({ error: "profile_fetch_failed", detail: e?.message || String(e) }, 502);
    }

    // ===== 4) Sommeil des N derniers jours =====
    const nights: any[] = [];
    const end = new Date();
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(end.getTime() - i * 86_400_000);
      const ds = d.toISOString().slice(0, 10);
      try {
        const raw = await connectapiGet(
          `/wellness-service/wellness/dailySleepData/${displayName}`,
          accessToken,
          { date: ds, nonSleepBufferMinutes: "60" },
        );
        const night = extractNight(raw, ds);
        if (night) nights.push(night);
      } catch (e: any) {
        console.error(`garmin sleep fetch ${ds}:`, e?.message || e);
      }
    }

    // ===== 5) Upsert garmin_sleep =====
    const rows = nights.map((n) => ({ ...n, user_id: userId, updated_at: new Date().toISOString() }));
    let upserted = 0;
    if (rows.length) {
      const { error } = await sbAdmin.from("garmin_sleep").upsert(rows, { onConflict: "user_id,date" });
      if (error) console.error("garmin_sleep upsert error:", error.message);
      else upserted = rows.length;
    }

    await sbAdmin.from("connexions_app").update({
      last_sync_status: "ok", last_sync_at: new Date().toISOString(), last_sync_error: null,
    }).eq("user_id", userId).eq("app", "garmin");

    return json({ ok: true, nights_found: nights.length, days_upserted: upserted });
  } catch (e: any) {
    console.error("garmin-ingest unhandled:", e);
    return json({ error: e.message || String(e) }, 500);
  }
});

// ============ EXTRACTION SOMMEIL (port de extract() Python) ============
function localMsToStr(ms: number | null | undefined): string | null {
  if (!ms) return null;
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

function extractSegments(d: any, sleepStartGmtMs: number): number[][] {
  const levels = d?.sleepLevels || [];
  const segments: number[][] = [];
  for (const seg of levels) {
    const level = seg.activityLevel;
    if (![0, 1, 2, 3].includes(level)) continue;
    const sMs = Date.parse(String(seg.startGMT).replace(/\.0$/, "") + "Z");
    const eMs = Date.parse(String(seg.endGMT).replace(/\.0$/, "") + "Z");
    if (Number.isNaN(sMs) || Number.isNaN(eMs)) continue;
    segments.push([
      Math.round((sMs - sleepStartGmtMs) / 60000),
      Math.round((eMs - sleepStartGmtMs) / 60000),
      level,
    ]);
  }
  return segments;
}

function extractNight(d: any, targetDate: string): any | null {
  const dto = d?.dailySleepDTO;
  if (!dto || !dto.sleepTimeSeconds) return null;

  const scores = dto.sleepScores || {};
  const overall = scores.overall || {};
  const scoreComponent = (key: string) => {
    const v = scores[key];
    if (!v || typeof v !== "object") return null;
    return { qualifierKey: v.qualifierKey ?? null, value: v.value ?? null };
  };
  const spo2 = d.wellnessSpO2SleepSummaryDTO || {};
  const segments = extractSegments(d, dto.sleepStartTimestampGMT);

  return {
    date: targetDate,
    bedtime: localMsToStr(dto.sleepStartTimestampLocal),
    wake_time: localMsToStr(dto.sleepEndTimestampLocal),
    total_sec: dto.sleepTimeSeconds ?? null,
    deep_sec: dto.deepSleepSeconds ?? null,
    light_sec: dto.lightSleepSeconds ?? null,
    rem_sec: dto.remSleepSeconds ?? null,
    awake_sec: dto.awakeSleepSeconds ?? null,
    awake_count: dto.awakeCount ?? null,
    restless_count: d.restlessMomentsCount ?? null,
    avg_stress: dto.avgSleepStress ?? null,
    avg_heart_rate: dto.avgHeartRate ?? null,
    body_battery_change: d.bodyBatteryChange ?? null,
    resp_avg: dto.averageRespirationValue ?? null,
    resp_min: dto.lowestRespirationValue ?? null,
    resp_max: dto.highestRespirationValue ?? null,
    spo2_avg: spo2.averageSPO2 ?? null,
    spo2_min: spo2.lowestSPO2 ?? null,
    hrv_avg: d.avgOvernightHrv ?? null,
    hrv_status: d.hrvStatus ?? null,
    score: overall.value ?? null,
    score_qualifier: overall.qualifierKey ?? null,
    score_detail: {
      totalDuration: scoreComponent("totalDuration"),
      stress: scoreComponent("stress"),
      awakeCount: scoreComponent("awakeCount"),
      remPercentage: scoreComponent("remPercentage"),
      restlessness: scoreComponent("restlessness"),
      lightPercentage: scoreComponent("lightPercentage"),
      deepPercentage: scoreComponent("deepPercentage"),
    },
    segments,
  };
}

// ============ APPELS GARMIN CONNECT ============
async function connectapiGet(path: string, accessToken: string, params?: Record<string, string>): Promise<any> {
  let url = `https://connectapi.garmin.com${path}`;
  if (params) url += "?" + new URLSearchParams(params).toString();
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}`, "User-Agent": USER_AGENT_API },
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`${res.status} on ${path}: ${txt.slice(0, 150)}`);
  }
  return await res.json();
}

async function refreshGarminToken(oauth1Token: string, oauth1Secret: string): Promise<any | null> {
  const consumerRes = await fetch(OAUTH_CONSUMER_URL);
  if (!consumerRes.ok) return null;
  const consumer = await consumerRes.json();

  const url = "https://connectapi.garmin.com/oauth-service/oauth/exchange/user/2.0";
  const authHeader = await oauth1AuthHeader(
    "POST", url, consumer.consumer_key, consumer.consumer_secret, oauth1Token, oauth1Secret,
  );
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: authHeader,
      "User-Agent": USER_AGENT_SSO,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "",
  });
  if (!res.ok) return null;
  const token = await res.json();
  const now = Math.floor(Date.now() / 1000);
  token.expires_at = now + Number(token.expires_in);
  return token;
}

// ============ SIGNATURE OAUTH1 HMAC-SHA1 (sans dépendance, Web Crypto) ============
function percentEncode(s: string): string {
  return encodeURIComponent(s).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
}

function randomNonce(len: number): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => chars[b % chars.length]).join("");
}

async function hmacSha1Base64(key: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    "raw", enc.encode(key), { name: "HMAC", hash: "SHA-1" }, false, ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, enc.encode(message));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

async function oauth1AuthHeader(
  method: string, url: string, consumerKey: string, consumerSecret: string, token: string, tokenSecret: string,
): Promise<string> {
  const oauthParams: Record<string, string> = {
    oauth_consumer_key: consumerKey,
    oauth_nonce: randomNonce(32),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: String(Math.floor(Date.now() / 1000)),
    oauth_token: token,
    oauth_version: "1.0",
  };
  const baseUrl = url.split("?")[0];
  const paramStr = Object.keys(oauthParams).sort()
    .map((k) => `${percentEncode(k)}=${percentEncode(oauthParams[k])}`)
    .join("&");
  const baseString = [method.toUpperCase(), percentEncode(baseUrl), percentEncode(paramStr)].join("&");
  const signingKey = `${percentEncode(consumerSecret)}&${percentEncode(tokenSecret)}`;
  const signature = await hmacSha1Base64(signingKey, baseString);

  oauthParams.oauth_signature = signature;
  return "OAuth " + Object.keys(oauthParams).sort()
    .map((k) => `${percentEncode(k)}="${percentEncode(oauthParams[k])}"`)
    .join(", ");
}

// ============ HELPERS ============
function json(body: any, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
async function safeJson(req: Request): Promise<any> { try { return await req.json(); } catch { return {}; } }
function clampInt(v: any, min: number, max: number, dflt: number): number {
  const n = Number(v); if (!Number.isFinite(n)) return dflt;
  return Math.max(min, Math.min(max, Math.round(n)));
}
async function markErr(sb: any, userId: string, msg: string) {
  await sb.from("connexions_app").update({
    last_sync_status: "error", last_sync_error: msg.slice(0, 500), last_sync_at: new Date().toISOString(),
  }).eq("user_id", userId).eq("app", "garmin");
}
