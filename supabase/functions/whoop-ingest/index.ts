// ============================================================
// Edge Function : whoop-ingest
//
// Récupère les données Whoop RÉELLES de l'utilisateur (recovery, sommeil,
// cycles/strain) et les agrège par jour dans la table whoop_data.
// Port direct de whoop.py (fetch_all + build_daily_whoop).
//
// Appel (front, POST, JWT Supabase dans Authorization) :
//   body JSON optionnel : { "days": 365 }   // historique à récupérer
//
// Flow :
//   1. vérifier le JWT → user
//   2. lire whoop_connections, refresh le token si expiré
//   3. fetch /recovery, /activity/sleep, /cycle (paginés via next_token)
//   4. agréger par jour → upsert whoop_data (source='whoop')
//   5. maj whoop_connections.last_sync_*
//
// Déploiement :
//   supabase functions deploy whoop-ingest
//
// Secrets requis : WHOOP_CLIENT_ID, WHOOP_CLIENT_SECRET,
//   SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
// ============================================================
// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const WHOOP_CLIENT_ID = Deno.env.get("WHOOP_CLIENT_ID")!;
const WHOOP_CLIENT_SECRET = Deno.env.get("WHOOP_CLIENT_SECRET")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const WHOOP_TOKEN_URL = "https://api.prod.whoop.com/oauth/oauth2/token";
const WHOOP_API = "https://api.prod.whoop.com/developer/v2";
const DEFAULT_DAYS = 365;
const MAX_PAGES = 500;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    // ===== 1) Auth =====
    const jwt = (req.headers.get("Authorization") || "").replace("Bearer ", "").trim();
    if (!jwt) return json({ error: "missing_jwt" }, 401);
    const sbAuth = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    const { data: { user }, error: authErr } = await sbAuth.auth.getUser(jwt);
    if (authErr || !user) return json({ error: "invalid_jwt" }, 401);

    const body = await safeJson(req);
    const days = clampInt(body?.days, 1, 1825, DEFAULT_DAYS);

    const sbAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // ===== 2) Connexion Whoop + refresh =====
    const { data: conn, error: connErr } = await sbAdmin
      .from("connexions_app").select("*").eq("user_id", user.id).eq("app", "whoop").maybeSingle();
    if (connErr || !conn) return json({ error: "no_whoop_connection" }, 400);

    await sbAdmin.from("connexions_app").update({
      last_sync_status: "running", last_sync_at: new Date().toISOString(),
    }).eq("user_id", user.id).eq("app", "whoop");

    let accessToken = conn.access_token;
    if (new Date(conn.expires_at) <= new Date(Date.now() + 60_000)) {
      const refreshed = await refreshWhoopToken(conn.refresh_token);
      if (!refreshed) { await markErr(sbAdmin, user.id, "token_refresh_failed"); return json({ error: "token_refresh_failed" }, 500); }
      accessToken = refreshed.access_token;
      await sbAdmin.from("connexions_app").update({
        access_token: refreshed.access_token,
        refresh_token: refreshed.refresh_token || conn.refresh_token,
        expires_at: new Date(Date.now() + (refreshed.expires_in || 3600) * 1000 - 60_000).toISOString(),
      }).eq("user_id", user.id).eq("app", "whoop");
    }

    // ===== 3) Fetch recovery + sleep + cycles =====
    const end = new Date();
    const start = new Date(Date.now() - days * 86400_000);
    const startIso = start.toISOString().replace(/\.\d+Z$/, ".000Z");
    const endIso = end.toISOString().replace(/\.\d+Z$/, ".000Z");

    let recovery: any[], sleep: any[], cycles: any[];
    try {
      [recovery, sleep, cycles] = await Promise.all([
        paginate(accessToken, "/recovery", startIso, endIso),
        paginate(accessToken, "/activity/sleep", startIso, endIso),
        paginate(accessToken, "/cycle", startIso, endIso),
      ]);
    } catch (e: any) {
      await markErr(sbAdmin, user.id, `whoop_fetch_${(e?.message || e).toString().slice(0, 80)}`);
      return json({ error: "whoop_fetch_failed", detail: e?.message || String(e) }, 502);
    }

    // ===== 4) Agrégation par jour =====
    const byDate = buildDailyWhoop({ recovery, sleep, cycles });
    const rows = Object.entries(byDate).map(([iso, m]: [string, any]) => ({
      user_id: user.id,
      iso_date: iso,
      recovery: m.recovery ?? null,
      hrv: m.hrv ?? null,
      rhr: m.rhr ?? null,
      spo2: m.spo2 ?? null,
      skin_temp_c: m.skinTemp ?? null,
      sleep_h: m.sleepH ?? null,
      sleep_q: m.sleepQ ?? null,
      deep_h: m.deepH ?? null,
      rem_h: m.remH ?? null,
      strain: m.strain ?? null,
      source: "whoop",
      updated_at: new Date().toISOString(),
    }));

    let upserted = 0;
    for (let i = 0; i < rows.length; i += 200) {
      const batch = rows.slice(i, i + 200);
      const { error } = await sbAdmin.from("whoop_data").upsert(batch, { onConflict: "user_id,iso_date" });
      if (error) console.error("whoop_data upsert error:", error.message);
      else upserted += batch.length;
    }

    // ===== 5) Sync OK =====
    await sbAdmin.from("connexions_app").update({
      last_sync_status: "ok", last_sync_at: new Date().toISOString(), last_sync_error: null,
    }).eq("user_id", user.id).eq("app", "whoop");

    return json({
      ok: true,
      recovery_records: recovery.length,
      sleep_records: sleep.length,
      cycle_records: cycles.length,
      days_upserted: upserted,
    });
  } catch (e: any) {
    console.error("whoop-ingest unhandled:", e);
    return json({ error: e.message || String(e) }, 500);
  }
});

// ============ AGRÉGATION (port de build_daily_whoop) ============
function buildDailyWhoop({ recovery, sleep, cycles }: any): Record<string, any> {
  const byDate: Record<string, any> = {};
  const get = (d: string) => (byDate[d] ||= {});

  for (const r of recovery || []) {
    const score = r.score || {};
    const ts = r.created_at || r.updated_at;
    if (!ts) continue;
    const d = get(ts.slice(0, 10));
    if (score.recovery_score != null) d.recovery = Math.round(score.recovery_score);
    if (score.hrv_rmssd_milli != null) d.hrv = Math.round(score.hrv_rmssd_milli);
    if (score.resting_heart_rate != null) d.rhr = Math.round(score.resting_heart_rate);
    if (score.spo2_percentage != null) d.spo2 = round1(score.spo2_percentage);
    if (score.skin_temp_celsius != null) d.skinTemp = round1(score.skin_temp_celsius);
  }

  for (const sl of sleep || []) {
    const score = sl.score || {};
    const stage = score.stage_summary || {};
    const ts = sl.end || sl.created_at;
    if (!ts) continue;
    const d = get(ts.slice(0, 10));
    const totalMs = (stage.total_light_sleep_time_milli || 0)
      + (stage.total_slow_wave_sleep_time_milli || 0)
      + (stage.total_rem_sleep_time_milli || 0);
    if (totalMs) d.sleepH = round1(totalMs / 1000 / 3600);
    if (score.sleep_performance_percentage != null) d.sleepQ = Math.round(score.sleep_performance_percentage);
    if (stage.total_slow_wave_sleep_time_milli) d.deepH = round1(stage.total_slow_wave_sleep_time_milli / 1000 / 3600);
    if (stage.total_rem_sleep_time_milli) d.remH = round1(stage.total_rem_sleep_time_milli / 1000 / 3600);
  }

  for (const c of cycles || []) {
    const score = c.score || {};
    const ts = c.start;
    if (!ts) continue;
    const d = get(ts.slice(0, 10));
    if (score.strain != null) d.strain = round1(score.strain);
  }

  return byDate;
}

// ============ PAGINATION WHOOP ============
async function paginate(token: string, path: string, startIso: string, endIso: string): Promise<any[]> {
  const out: any[] = [];
  let nextToken: string | null = null;
  let pages = 0;
  do {
    const params = new URLSearchParams({ start: startIso, end: endIso, limit: "25" });
    if (nextToken) params.set("nextToken", nextToken);
    const res = await fetch(`${WHOOP_API}${path}?${params.toString()}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    });
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`${res.status} on ${path}: ${txt.slice(0, 120)}`);
    }
    const data = await res.json();
    if (Array.isArray(data.records)) out.push(...data.records);
    nextToken = data.next_token || data.nextToken || null;
    pages++;
  } while (nextToken && pages < MAX_PAGES);
  return out;
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
function round1(v: number): number { return Math.round(v * 10) / 10; }
async function markErr(sb: any, userId: string, msg: string) {
  await sb.from("connexions_app").update({
    last_sync_status: "error", last_sync_error: msg.slice(0, 500), last_sync_at: new Date().toISOString(),
  }).eq("user_id", userId).eq("app", "whoop");
}
async function refreshWhoopToken(refreshToken: string) {
  const form = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: WHOOP_CLIENT_ID,
    client_secret: WHOOP_CLIENT_SECRET,
    scope: "offline",
  });
  const res = await fetch(WHOOP_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form.toString(),
  });
  if (!res.ok) return null;
  return await res.json();
}
