// ============================================================
// Edge Function : strava-streams
//
// Récupère les STREAMS Strava (watts/fc/cadence/altitude/distance) des
// activités qui n'en ont pas encore, les stocke compressés (gzip+base64)
// dans activities.streams_gz, calcule le Power Profile (MMP) par activité
// dans activities.power_curve, puis recalcule la table power_profile
// (best alltime + best 90 jours par durée).
//
// Conçue pour être appelée plusieurs fois : elle traite un LOT à chaque
// appel (param 'limit', défaut 40) en partant des activités les plus
// récentes sans streams. Respecte le rate-limit Strava (100 req / 15 min) :
// si un 429 survient, elle s'arrête proprement et renvoie ce qui reste.
//
// Appel (front, POST, JWT Supabase dans Authorization) :
//   body JSON optionnel : { "limit": 40, "recompute_only": false }
//   - recompute_only:true → ne fetch aucun stream, recalcule juste power_profile.
//
// Déploiement :
//   supabase functions deploy strava-streams
//
// Secrets requis (déjà définis pour strava-ingest) :
//   STRAVA_CLIENT_ID, STRAVA_CLIENT_SECRET,
//   SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
// ============================================================
// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const STRAVA_CLIENT_ID = Deno.env.get("STRAVA_CLIENT_ID")!;
const STRAVA_CLIENT_SECRET = Deno.env.get("STRAVA_CLIENT_SECRET")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const STRAVA_API = "https://www.strava.com/api/v3";
const DEFAULT_LIMIT = 40;          // activités traitées par appel
const STREAM_FORMAT = "gzip+base64+json-array";

// Durées standard du Power Profile (secondes) — identique à power_profile.py
const DURATIONS = [
  1, 5, 10, 15, 30, 60,
  120, 180, 300, 600, 900, 1200, 1800,
  2700, 3600, 5400, 7200,
];

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    // ===== 1) Auth via JWT =====
    const jwt = (req.headers.get("Authorization") || "").replace("Bearer ", "").trim();
    if (!jwt) return json({ error: "missing_jwt" }, 401);
    const sbAuth = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    const { data: { user }, error: authErr } = await sbAuth.auth.getUser(jwt);
    if (authErr || !user) return json({ error: "invalid_jwt" }, 401);

    const body = await safeJson(req);
    const limit = clampInt(body?.limit, 1, 200, DEFAULT_LIMIT);
    const recomputeOnly = !!body?.recompute_only;

    const sbAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    let streamsSynced = 0;
    let rateLimited = false;
    let fetchErrors = 0;

    if (!recomputeOnly) {
      // ===== 2) Tokens Strava + refresh =====
      const { data: conn, error: connErr } = await sbAdmin
        .from("connexions_app").select("*").eq("user_id", user.id).eq("app", "strava").maybeSingle();
      if (connErr || !conn) return json({ error: "no_strava_connection" }, 400);

      let accessToken = conn.access_token;
      if (new Date(conn.expires_at) <= new Date(Date.now() + 60_000)) {
        const refreshed = await refreshStravaToken(conn.refresh_token);
        if (!refreshed) return json({ error: "token_refresh_failed" }, 500);
        accessToken = refreshed.access_token;
        await sbAdmin.from("connexions_app").update({
          access_token: refreshed.access_token,
          refresh_token: refreshed.refresh_token,
          expires_at: new Date(refreshed.expires_at * 1000).toISOString(),
        }).eq("user_id", user.id).eq("app", "strava");
      }

      // ===== 3) Activités sans streams (les plus récentes d'abord) =====
      const { data: todo, error: todoErr } = await sbAdmin
        .from("activities")
        .select("id, strava_id, start_date_local")
        .eq("user_id", user.id)
        .is("streams_synced_at", null)
        .order("start_date_local", { ascending: false })
        .limit(limit);
      if (todoErr) return json({ error: "query_todo_failed", detail: todoErr.message }, 500);

      // ===== 4) Fetch + stockage stream par stream =====
      for (const a of todo || []) {
        const res = await fetch(
          `${STRAVA_API}/activities/${a.strava_id}/streams` +
          `?keys=time,watts,heartrate,cadence,altitude,distance,velocity_smooth&key_by_type=true`,
          { headers: { Authorization: `Bearer ${accessToken}` } },
        );

        if (res.status === 429) { rateLimited = true; break; }           // stop net
        if (res.status === 404) {                                        // pas de stream → marqué fait
          await sbAdmin.from("activities").update({
            streams_synced_at: new Date().toISOString(), streams_format: "none",
          }).eq("id", a.id);
          continue;
        }
        if (!res.ok) { fetchErrors++; continue; }

        const raw = await res.json();                                    // { watts:{data:[]}, ... }
        const streamArray = toIntervalsFormat(raw);                      // [{type,data}, ...]
        const watts = (raw?.watts?.data) || [];
        const powerCurve = computeMMP(watts);
        const gz = await gzipBase64(JSON.stringify(streamArray));

        const { error: upErr } = await sbAdmin.from("activities").update({
          streams_gz: gz,
          streams_format: STREAM_FORMAT,
          streams_synced_at: new Date().toISOString(),
          power_curve: Object.keys(powerCurve).length ? powerCurve : null,
        }).eq("id", a.id);
        if (upErr) { fetchErrors++; continue; }
        streamsSynced++;
      }
    }

    // ===== 5) Recalcul power_profile (alltime + 90j) depuis les power_curve =====
    const ppRows = await recomputePowerProfile(sbAdmin, user.id);

    // ===== 6) Combien d'activités restent sans streams ? =====
    const { count: remaining } = await sbAdmin
      .from("activities").select("id", { count: "exact", head: true })
      .eq("user_id", user.id).is("streams_synced_at", null);

    return json({
      ok: true,
      streams_synced: streamsSynced,
      fetch_errors: fetchErrors,
      rate_limited: rateLimited,
      remaining: remaining ?? 0,
      power_profile_durations: ppRows,
      hint: rateLimited
        ? "Rate-limit Strava atteint — relance dans ~15 min pour continuer."
        : (remaining ? "Reste des activités à traiter — relance pour continuer." : "Tout est à jour."),
    });
  } catch (e: any) {
    console.error("strava-streams unhandled:", e);
    return json({ error: e.message || String(e) }, 500);
  }
});

// ============ POWER PROFILE ============

// MMP : pour chaque durée, meilleure moyenne sur une fenêtre glissante.
function computeMMP(wattsStream: any[]): Record<string, number> {
  if (!wattsStream || !wattsStream.length) return {};
  const ws = wattsStream.map((w) => (w != null && w > 0 ? Math.round(w) : 0));
  const n = ws.length;
  const cum = new Array(n + 1).fill(0);
  for (let i = 0; i < n; i++) cum[i + 1] = cum[i] + ws[i];

  const result: Record<string, number> = {};
  for (const d of DURATIONS) {
    if (d > n) continue;
    let best = 0;
    for (let i = 0; i + d <= n; i++) {
      const avg = (cum[i + d] - cum[i]) / d;
      if (avg > best) best = avg;
    }
    if (best > 0) result[String(d)] = Math.round(best);
  }
  return result;
}

// Recalcule la table power_profile pour un user à partir des power_curve.
async function recomputePowerProfile(sb: any, userId: string): Promise<number> {
  // On pagine : récupère toutes les activités avec une power_curve.
  const acts: any[] = [];
  const PAGE = 1000;
  let from = 0;
  while (true) {
    const { data, error } = await sb
      .from("activities")
      .select("id, start_date_local, power_curve")
      .eq("user_id", userId)
      .not("power_curve", "is", null)
      .range(from, from + PAGE - 1);
    if (error) throw error;
    if (!data || !data.length) break;
    acts.push(...data);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  if (!acts.length) return 0;

  const cutoff90 = new Date(Date.now() - 90 * 86400_000);
  const best: Record<string, { all: number; allDate: string; allId: string;
                               d90: number; d90Date: string | null; d90Id: string | null }> = {};

  for (const a of acts) {
    const pc = a.power_curve || {};
    const date = String(a.start_date_local).slice(0, 10);
    const isRecent = new Date(a.start_date_local) >= cutoff90;
    for (const [dur, wattsRaw] of Object.entries(pc)) {
      const watts = Number(wattsRaw);
      if (!watts) continue;
      const b = best[dur] || { all: 0, allDate: date, allId: a.id, d90: 0, d90Date: null, d90Id: null };
      if (watts > b.all) { b.all = watts; b.allDate = date; b.allId = a.id; }
      if (isRecent && watts > b.d90) { b.d90 = watts; b.d90Date = date; b.d90Id = a.id; }
      best[dur] = b;
    }
  }

  const rows = Object.entries(best).map(([dur, b]) => ({
    user_id: userId,
    duration_s: Number(dur),
    watts_alltime: b.all,
    watts_90d: b.d90 || null,
    achieved_at_alltime: b.allDate,
    achieved_at_90d: b.d90Date,
    activity_id_alltime: b.allId,
    activity_id_90d: b.d90Id,
    updated_at: new Date().toISOString(),
  }));

  for (let i = 0; i < rows.length; i += 200) {
    const batch = rows.slice(i, i + 200);
    const { error } = await sb.from("power_profile").upsert(batch, { onConflict: "user_id,duration_s" });
    if (error) console.error("power_profile upsert error:", error.message);
  }
  return rows.length;
}

// ============ STREAMS ============

// Strava (key_by_type=true) → format intervals.icu attendu par l'app : [{type,data}]
function toIntervalsFormat(raw: any): any[] {
  if (!raw || typeof raw !== "object") return [];
  const out: any[] = [];
  for (const [type, obj] of Object.entries<any>(raw)) {
    if (obj && Array.isArray(obj.data)) out.push({ type, data: obj.data });
  }
  return out;
}

async function gzipBase64(str: string): Promise<string> {
  const cs = new CompressionStream("gzip");
  const writer = cs.writable.getWriter();
  writer.write(new TextEncoder().encode(str));
  writer.close();
  const buf = new Uint8Array(await new Response(cs.readable).arrayBuffer());
  // base64 par chunks (évite "Maximum call stack" sur gros buffers)
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < buf.length; i += CHUNK) {
    bin += String.fromCharCode(...buf.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

// ============ HELPERS ============
function json(body: any, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
async function safeJson(req: Request): Promise<any> {
  try { return await req.json(); } catch { return {}; }
}
function clampInt(v: any, min: number, max: number, dflt: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return dflt;
  return Math.max(min, Math.min(max, Math.round(n)));
}
async function refreshStravaToken(refreshToken: string) {
  const res = await fetch("https://www.strava.com/oauth/token", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: STRAVA_CLIENT_ID, client_secret: STRAVA_CLIENT_SECRET,
      grant_type: "refresh_token", refresh_token: refreshToken,
    }),
  });
  if (!res.ok) return null;
  return await res.json();
}
