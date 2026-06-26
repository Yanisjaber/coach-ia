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

// Durée (secondes) → nom de colonne de power_profile_sport (libellé lisible).
const SEC_TO_COL: Record<number, string> = {
  1:"1s",2:"2s",3:"3s",4:"4s",5:"5s",6:"6s",7:"7s",8:"8s",9:"9s",10:"10s",
  11:"11s",12:"12s",13:"13s",14:"14s",15:"15s",20:"20s",25:"25s",30:"30s",45:"45s",
  60:"1min",120:"2min",180:"3min",240:"4min",300:"5min",360:"6min",420:"7min",480:"8min",540:"9min",600:"10min",
  720:"12min",900:"15min",1200:"20min",1500:"25min",1800:"30min",2100:"35min",2400:"40min",2700:"45min",
  3600:"1h",5400:"1h30",7200:"2h",9000:"2h30",10800:"3h",12600:"3h30",14400:"4h",16200:"4h30",18000:"5h",
  21600:"6h",25200:"7h",28800:"8h",
};
// Durées du Power Profile (secondes), dérivées de SEC_TO_COL (table power_profile).
const DURATIONS = Object.keys(SEC_TO_COL).map(Number).sort((a, b) => a - b);

// Jeu de durées du CLIENT (doit rester identique à __PC_DURS dans js/app.js).
// La courbe est calculée sur l'UNION (SEC_TO_COL ∪ client) pour servir à la fois
// la table power_profile ET le tableau des records côté client.
const PC_DURS: number[] = (() => {
  const d: number[] = [];
  for (let s = 1; s <= 600; s++) d.push(s);
  for (let s = 605; s <= 1800; s += 5) d.push(s);
  for (let s = 1830; s <= 3600; s += 30) d.push(s);
  for (let s = 3900; s <= 28800; s += 300) d.push(s);
  return d;
})();
const MMP_DURS = Array.from(new Set([...DURATIONS, ...PC_DURS])).sort((a, b) => a - b);
// Version du jeu de durées CLIENT (doit rester égale à __PC_VERSION dans js/app.js).
const CLIENT_PC_VERSION = 3;

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

    // Profil athlete (pour les metriques : TRIMP, eFTP, W'bal, CHO...).
    const { data: _prof } = await sbAdmin
      .from("user_profiles").select("ftp, hr_max, lthr, extras").eq("user_id", user.id).maybeSingle();
    const ATH = {
      ftp: +(_prof?.ftp) || 0,
      hrMax: +(_prof?.hr_max) || 0,
      hrRest: 50,
      sex: (_prof?.extras && _prof.extras.x_sex) || 'M',
    };

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
        const powerCurve: Record<string, number> = computeMMP(watts);
        powerCurve.v = POWER_CURVE_VERSION; // marqueur de version (ignoré par l'agrégation)
        powerCurve._v = CLIENT_PC_VERSION; // marqueur attendu par le client (records sans recalcul manuel)
        const metrics = computeMetrics(watts, (raw?.heartrate?.data) || [], (raw?.time?.data) || [], ATH);
        const gz = await gzipBase64(JSON.stringify(streamArray));

        const { error: upErr } = await sbAdmin.from("activities").update({
          streams_gz: gz,
          streams_format: STREAM_FORMAT,
          streams_synced_at: new Date().toISOString(),
          power_curve: powerCurve,
          metrics: metrics,
        }).eq("id", a.id);
        if (upErr) { fetchErrors++; continue; }
        streamsSynced++;
      }
    }

    // ===== 5) Backfill power_curve (nouvelles durées) depuis les streams stockés =====
    // Lot limité (idempotent) : recalcule la courbe des activités obsolètes.
    const backfill = await backfillPowerCurves(sbAdmin, user.id, 50, ATH);  // lot reduit : calcul dense plus lourd

    // ===== 6) Recalculs power_profile (legacy) + power_profile_sport (par sport) =====
    // On recalcule le profil par sport à CHAQUE passage : il s'appuie sur les power_curve
    // déjà calculées, donc on obtient un profil partiel qui s'enrichit au fil du backfill
    // (au lieu de n'afficher RIEN tant que tout n'est pas téléchargé).
    const ppRows = await recomputePowerProfile(sbAdmin, user.id);
    const ppSportRows = await recomputePowerProfileBySport(sbAdmin, user.id);

    // ===== 7) Combien d'activités restent sans streams ? =====
    const { count: remaining } = await sbAdmin
      .from("activities").select("id", { count: "exact", head: true })
      .eq("user_id", user.id).is("streams_synced_at", null);

    const moreBackfill = backfill.remaining > 0;
    return json({
      ok: true,
      streams_synced: streamsSynced,
      fetch_errors: fetchErrors,
      rate_limited: rateLimited,
      remaining: remaining ?? 0,
      power_profile_durations: ppRows,
      power_profile_sports: ppSportRows,
      power_curve_backfilled: backfill.done,
      power_curve_remaining: backfill.remaining,
      hint: rateLimited
        ? "Rate-limit Strava atteint — relance dans ~15 min pour continuer."
        : (remaining || moreBackfill)
          ? "Reste des activités à traiter — relance pour continuer."
          : "Tout est à jour.",
    });
  } catch (e: any) {
    console.error("strava-streams unhandled:", e);
    return json({ error: e.message || String(e) }, 500);
  }
});

// ============ POWER PROFILE ============

// MMP : pour chaque durée, meilleure moyenne sur une fenêtre glissante.
const METRICS_VERSION = 2; // doit rester egal a `var m = { _v: ? }` cote client (app.js)

// Extrait un flux par type depuis [{type,data}].
function streamData(arr: any[], type: string): any[] {
  if (!Array.isArray(arr)) return [];
  const s = arr.find((x) => x && x.type === type);
  return (s && Array.isArray(s.data)) ? s.data : [];
}

// Calcule les metriques avancees (port serveur de __computeActivityMetrics).
function computeMetrics(W: any[], HR: any[], T: any[], ath: any): Record<string, any> {
  const ftp = +ath.ftp || 250;
  const hrMax = +ath.hrMax || 190;
  const sex = ath.sex || 'M';
  const hrRest = +ath.hrRest || 50;
  const m: Record<string, any> = { _v: METRICS_VERSION };
  const n = (W && W.length) || 0;

  if (n) {
    const ps = new Float64Array(n + 1);
    for (let i = 0; i < n; i++) ps[i + 1] = ps[i] + (+W[i] || 0);
    const bestAvg = (d: number) => { if (d > n) return 0; let b = 0; for (let s = 0; s + d <= n; s++) { const v = (ps[s + d] - ps[s]) / d; if (v > b) b = v; } return b; };

    let pmax = 0; for (let i = 0; i < n; i++) { const w0 = +W[i] || 0; if (w0 > pmax) pmax = w0; }
    m.pmax = Math.round(pmax);
    let ex = 0; for (let i = 0; i < n; i++) { const w1 = +W[i] || 0; if (w1 > ftp) ex += (w1 - ftp); }
    m.work_over_ftp_kj = Math.round(ex / 100) / 10;

    if (n >= 30) {
      let np4 = 0, npc = 0;
      for (let r = 30; r <= n; r++) { const a30 = (ps[r] - ps[r - 30]) / 30; np4 += a30 * a30 * a30 * a30; npc++; }
      if (npc) m.np = Math.round(Math.pow(np4 / npc, 0.25));
    }
    if (m.np && ftp) { const ifr = m.np / ftp; m.if_pct = Math.round(ifr * 100); m.tss = Math.round(n / 3600 * ifr * ifr * 100); }

    const hard = (bestAvg(300) >= ftp * 0.86) || (bestAvg(60) >= ftp * 1.15) || (bestAvg(1200) >= ftp * 0.84);
    if (hard) {
      const durs = [120, 180, 240, 300, 420, 600, 720, 900, 1200].filter((d) => d <= n);
      if (durs.length >= 2) {
        let sx = 0, sy = 0, sxy = 0, sxx = 0; const k = durs.length;
        durs.forEach((d) => { const x = 1 / d, y = bestAvg(d); sx += x; sy += y; sxy += x * y; sxx += x * x; });
        const slope = (k * sxy - sx * sy) / (k * sxx - sx * sx); const inter = (sy - slope * sx) / k;
        if (isFinite(inter) && inter > 0) m.cp = Math.round(inter);
        if (isFinite(slope) && slope > 0) m.w_prime = Math.round(slope);
      }
      const p20 = bestAvg(1200), p5 = bestAvg(300);
      if (p20) m.eftp = Math.round(0.95 * p20);
      else if (p5) m.eftp = Math.round(0.90 * p5);
      else if (m.cp) m.eftp = Math.round(0.97 * m.cp);
      const cp = m.cp || Math.round(0.97 * ftp), wp = m.w_prime || 20000;
      if (cp > 0 && wp > 0) {
        let bSum = 0, bN = 0; for (let i = 0; i < n; i++) { const w2 = +W[i] || 0; if (w2 < cp) { bSum += w2; bN++; } }
        const dcp = bN ? (cp - bSum / bN) : 0; const tau = 546 * Math.exp(-0.01 * dcp) + 316;
        let bal = wp, minb = wp; const rec = 1 - Math.exp(-1 / tau);
        for (let i = 0; i < n; i++) { const w3 = +W[i] || 0; if (w3 > cp) bal -= (w3 - cp); else bal += (wp - bal) * rec; if (bal > wp) bal = wp; if (bal < minb) minb = bal; }
        m.wbal_kj = Math.round(Math.min(wp, wp - minb) / 100) / 10;
      }
    }

    let choMech = 0;
    for (let i = 0; i < n; i++) { const w4 = +W[i] || 0; if (w4 <= 0) continue; const I = w4 / ftp; let fr = 1 / (1 + Math.exp(-5 * (I - 0.45))); if (fr < 0.15) fr = 0.15; if (fr > 1) fr = 1; choMech += (w4 / 1000) * fr; }
    m.cho_g = Math.round(choMech / 4.0);

    let z1 = 0, z2 = 0, z3 = 0;
    for (let i = 0; i < n; i++) { const ww = W[i]; if (ww == null) continue; const pr = ww / ftp; if (pr < 0.80) z1++; else if (pr <= 1.05) z2++; else z3++; }
    const zt = z1 + z2 + z3;
    if (zt) {
      const f1 = z1 / zt, f2 = z2 / zt, f3 = z3 / zt;
      if (f2 > 0 && f3 > 0) m.pol_index = Math.round(Math.log10((f1 * f3) / (f2 * f2)) * 100) / 100;
      m.pol_class = (f1 >= f2 && f2 >= f3) ? 'Pyramidal' : (f3 > f2) ? 'Polarisé' : (f2 > f1) ? 'Seuil' : 'Endurance';
    }
  }

  if (HR && HR.length) {
    const hn = HR.length, denom = (hrMax - hrRest) || 1, kk = (sex === 'F') ? 1.67 : 1.92;
    let trimp = 0;
    for (let i = 0; i < hn; i++) { const hh = HR[i]; if (hh == null) continue; let r = (hh - hrRest) / denom; if (r < 0) r = 0; if (r > 1) r = 1; trimp += (1 / 60) * r * 0.64 * Math.exp(kk * r); }
    m.trimp = Math.round(trimp);
    let drop = 0;
    if (T && T.length === hn) {
      let j = 0;
      for (let i = 0; i < hn; i++) {
        if (j < i) j = i;
        const target = T[i] + 60;
        while (j < hn && T[j] < target) j++;
        if (j >= hn) break;
        if (HR[i] != null && HR[j] != null && HR[i] >= 0.85 * hrMax) { const d1 = HR[i] - HR[j]; if (d1 > drop) drop = d1; }
      }
    } else {
      for (let i = 0; i + 60 < hn; i++) { if (HR[i] == null || HR[i + 60] == null) continue; if (HR[i] >= 0.85 * hrMax) { const d2 = HR[i] - HR[i + 60]; if (d2 > drop) drop = d2; } }
    }
    if (drop > 0) m.hrrc = Math.round(drop);
  }
  return m;
}

function computeMMP(wattsStream: any[]): Record<string, number> {
  if (!wattsStream || !wattsStream.length) return {};
  const ws = wattsStream.map((w) => (w != null && w > 0 ? Math.round(w) : 0));
  const n = ws.length;
  const cum = new Array(n + 1).fill(0);
  for (let i = 0; i < n; i++) cum[i + 1] = cum[i] + ws[i];

  const result: Record<string, number> = {};
  for (const d of MMP_DURS) {
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

// MMP "tardive" : meilleure moyenne pour 5/20 min dont la fenêtre DÉMARRE après `afterSec`
// (par défaut 2 h 30). Sert à mesurer la durabilité (résistance à la fatigue en fin de sortie).
const DURABILITY_AFTER_SEC = 9000;        // 2 h 30
const DURABILITY_DURS = [300, 1200];      // 5 min, 20 min
function computeLateMMP(wattsStream: any[], afterSec = DURABILITY_AFTER_SEC): Record<string, number> {
  if (!wattsStream || !wattsStream.length) return {};
  const ws = wattsStream.map((w) => (w != null && w > 0 ? Math.round(w) : 0));
  const n = ws.length;
  if (n <= afterSec + DURABILITY_DURS[0]) return {}; // sortie trop courte
  const cum = new Array(n + 1).fill(0);
  for (let i = 0; i < n; i++) cum[i + 1] = cum[i] + ws[i];
  const out: Record<string, number> = {};
  for (const d of DURABILITY_DURS) {
    let best = 0;
    for (let i = afterSec; i + d <= n; i++) {   // fenêtre démarrant après afterSec
      const avg = (cum[i + d] - cum[i]) / d;
      if (avg > best) best = avg;
    }
    if (best > 0) out["late_" + d] = Math.round(best);
  }
  return out;
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
      if (!Number.isFinite(Number(dur))) continue; // ignore le marqueur "v"
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

// ============ POWER PROFILE PAR SPORT (table large power_profile_sport) ============
// Recalcule la MMP par sport depuis les power_curve déjà stockées et remplit la
// table large (une ligne par sport, une colonne par durée) + details jsonb.
async function recomputePowerProfileBySport(sb: any, userId: string): Promise<number> {
  // Récupère toutes les activités avec une power_curve + leur sport + durée.
  const acts: any[] = [];
  const PAGE = 1000;
  let from = 0;
  while (true) {
    const { data, error } = await sb
      .from("activities")
      .select("id, sport, start_date_local, moving_time, elapsed_time, power_curve")
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

  const cutoff90 = Date.now() - 90 * 86400_000;
  // best[sport][dur] = { all, allDate, allId, d90, d90Date, d90Id }
  const best: Record<string, Record<string, any>> = {};
  const count: Record<string, number> = {};
  const longest: Record<string, number> = {};
  const nLong: Record<string, number> = {};   // nb de sorties > 2 h 30 (toutes)
  const nLong90: Record<string, number> = {}; // idem sur les 90 derniers jours

  for (const a of acts) {
    const sport = a.sport || "autre";
    const pc = a.power_curve || {};
    const date = String(a.start_date_local).slice(0, 10);
    const isRecent = new Date(a.start_date_local).getTime() >= cutoff90;
    const durS = a.moving_time || a.elapsed_time || 0;
    count[sport] = (count[sport] || 0) + 1;
    if (durS > (longest[sport] || 0)) longest[sport] = durS;
    if (pc.late_300 || pc.late_1200) {
      nLong[sport] = (nLong[sport] || 0) + 1;
      if (isRecent) nLong90[sport] = (nLong90[sport] || 0) + 1;
    }
    best[sport] = best[sport] || {};
    for (const [dur, wattsRaw] of Object.entries(pc)) {
      const watts = Number(wattsRaw);
      if (!watts) continue;
      const b = best[sport][dur] || { all: 0, allDate: date, allId: a.id, d90: 0, d90Date: null, d90Id: null };
      if (watts > b.all) { b.all = watts; b.allDate = date; b.allId = a.id; }
      if (isRecent && watts > b.d90) { b.d90 = watts; b.d90Date = date; b.d90Id = a.id; }
      best[sport][dur] = b;
    }
  }

  // Construit une ligne large par sport.
  const rows = Object.keys(best).map((sport) => {
    const row: Record<string, any> = {
      user_id: userId, sport,
      activities_count: count[sport] || 0,
      longest_activity_s: longest[sport] || null,
      updated_at: new Date().toISOString(),
    };
    const details: Record<string, any> = {};
    for (const [dur, b] of Object.entries(best[sport])) {
      const col = SEC_TO_COL[Number(dur)];
      if (!col) continue;                       // durée hors plafond / clés "late_*" ignorées ici
      row[col] = Math.round((b as any).all);
      details[col] = {
        w90: (b as any).d90 ? Math.round((b as any).d90) : null,
        date: (b as any).allDate,
        activity_id: (b as any).allId,
      };
    }
    // Durabilité : meilleure puissance 5/20 min APRÈS 2 h 30 vs meilleure "à froid".
    const sb_ = best[sport];
    const fresh5 = sb_['300'] ? sb_['300'].all : null;
    const fresh20 = sb_['1200'] ? sb_['1200'].all : null;
    const late5 = sb_['late_300'] ? sb_['late_300'].all : null;
    const late20 = sb_['late_1200'] ? sb_['late_1200'].all : null;
    // Versions 90 jours (forme actuelle)
    const fresh5_90 = sb_['300'] ? sb_['300'].d90 : null;
    const fresh20_90 = sb_['1200'] ? sb_['1200'].d90 : null;
    const late5_90 = sb_['late_300'] ? sb_['late_300'].d90 : null;
    const late20_90 = sb_['late_1200'] ? sb_['late_1200'].d90 : null;
    const rr = (l: any, f: any) => (l && f) ? Math.round((l / f) * 100) / 100 : null;
    if (late5 || late20 || late5_90 || late20_90) {
      details.durability = {
        after_sec: DURABILITY_AFTER_SEC,
        // carrière (record)
        late_5min: late5 ? Math.round(late5) : null,
        late_20min: late20 ? Math.round(late20) : null,
        fresh_5min: fresh5 ? Math.round(fresh5) : null,
        fresh_20min: fresh20 ? Math.round(fresh20) : null,
        ratio_5min: rr(late5, fresh5),
        ratio_20min: rr(late20, fresh20),
        n_long: nLong[sport] || 0,
        // forme actuelle (90 jours)
        ratio_5min_90: rr(late5_90, fresh5_90),
        ratio_20min_90: rr(late20_90, fresh20_90),
        late_20min_90: late20_90 ? Math.round(late20_90) : null,
        fresh_20min_90: fresh20_90 ? Math.round(fresh20_90) : null,
        n_long_90: nLong90[sport] || 0,
      };
    }
    row.details = details;
    return row;
  });

  // Remplace l'ensemble pour ce user (purge puis upsert).
  await sb.from("power_profile_sport").delete().eq("user_id", userId);
  for (let i = 0; i < rows.length; i += 50) {
    const batch = rows.slice(i, i + 50);
    const { error } = await sb.from("power_profile_sport").upsert(batch, { onConflict: "user_id,sport" });
    if (error) console.error("power_profile_sport upsert error:", error.message);
  }
  return rows.length;
}

// Recalcule la power_curve (avec les NOUVELLES durées) depuis les streams déjà
// stockés, pour les activités dont la courbe est absente/obsolète. Lot limité
// (idempotent, relançable). Renvoie { done, remaining }.
const POWER_CURVE_VERSION = 5; // bump quand on change les durées/calculs (force un re-backfill local)
async function backfillPowerCurves(sb: any, userId: string, limit: number, ath: any): Promise<{ done: number; remaining: number }> {
  // 1) Repère les activités obsolètes SANS charger les streams (power_curve est léger).
  const { data, error } = await sb
    .from("activities")
    .select("id, power_curve")
    .eq("user_id", userId)
    .not("streams_gz", "is", null)
    .order("start_date_local", { ascending: false })
    .limit(2000);
  if (error) throw error;
  // Obsolète = pas de power_curve OU version différente (durées étendues).
  const stale = (data || []).filter((a: any) => !a.power_curve || a.power_curve.v !== POWER_CURVE_VERSION);
  const todo = stale.slice(0, limit);
  let done = 0;
  for (const a of todo) {
    try {
      // 2) Charge le stream de CETTE activité uniquement (évite un gros payload global).
      const { data: row } = await sb.from("activities").select("streams_gz").eq("id", a.id).maybeSingle();
      if (!row || !row.streams_gz) {
        await sb.from("activities").update({ power_curve: { v: POWER_CURVE_VERSION } }).eq("id", a.id);
        done++; continue;
      }
      const jsonStr = await gunzipBase64(row.streams_gz);
      const arr = JSON.parse(jsonStr);
      const watts = streamData(arr, "watts");
      const pc: Record<string, number> = computeMMP(watts);
      Object.assign(pc, computeLateMMP(watts)); // late_300 / late_1200 si sortie > 2 h 30
      pc.v = POWER_CURVE_VERSION; // marqueur de version (ignoré par l'agrégation)
      pc._v = CLIENT_PC_VERSION; // marqueur attendu par le client
      const metrics = computeMetrics(watts, streamData(arr, "heartrate"), streamData(arr, "time"), ath);
      await sb.from("activities").update({ power_curve: pc, metrics: metrics }).eq("id", a.id);
      done++;
    } catch (e) {
      console.error("backfill power_curve", a.id, (e as any)?.message);
    }
  }
  return { done, remaining: Math.max(0, stale.length - done) };
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

// Inverse de gzipBase64 : base64(gzip(json)) → string JSON.
async function gunzipBase64(b64: string): Promise<string> {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const ds = new DecompressionStream("gzip");
  const writer = ds.writable.getWriter();
  writer.write(bytes);
  writer.close();
  const buf = await new Response(ds.readable).arrayBuffer();
  return new TextDecoder().decode(buf);
}

// Extrait le tableau de watts depuis les streams stockés [{type,data}].
function wattsFromStreamArray(streamArray: any[]): number[] {
  if (!Array.isArray(streamArray)) return [];
  const w = streamArray.find((s) => s && s.type === "watts");
  return (w && Array.isArray(w.data)) ? w.data : [];
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
