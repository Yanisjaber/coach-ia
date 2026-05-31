// ============================================================
// Edge Function : disconnect-integration
//
// Déconnecte une intégration ET efface toutes les données associées
// de l'utilisateur (option "tout effacer").
//
// Appel (front, POST, JWT Supabase dans Authorization) :
//   body JSON : { "provider": "strava" | "whoop", "wipe": true | false }
//
// wipe=false (déconnexion seule) → supprime UNIQUEMENT la connexion
//   (strava_connections / whoop_connections). Les données importées restent.
// wipe=true (déconnexion + suppression) :
//   provider=strava → supprime power_profile, daily_metrics, activities,
//     strava_connections, et remet à zéro strava_athlete_id/ftp/weight dans user_profiles.
//   provider=whoop  → supprime whoop_data, whoop_connections.
//
// Utilise la service_role (bypass RLS) mais ne touche QUE les lignes de
// l'utilisateur identifié par le JWT → un user ne peut effacer que ses données.
//
// Déploiement :
//   supabase functions deploy disconnect-integration
// Secrets : SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY (déjà présents).
// ============================================================
// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const jwt = (req.headers.get("Authorization") || "").replace("Bearer ", "").trim();
    if (!jwt) return json({ error: "missing_jwt" }, 401);
    const sbAuth = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    const { data: { user }, error: authErr } = await sbAuth.auth.getUser(jwt);
    if (authErr || !user) return json({ error: "invalid_jwt" }, 401);

    const body = await safeJson(req);
    const provider = String(body?.provider || "").toLowerCase();
    const wipe = body?.wipe === true; // false/absent = déconnexion seule
    if (provider !== "strava" && provider !== "whoop") {
      return json({ error: "invalid_provider" }, 400);
    }

    const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const uid = user.id;
    const deleted: Record<string, boolean> = {};

    // Tables à vider selon le mode. La connexion est toujours supprimée en dernier.
    let tables: string[];
    if (provider === "strava") {
      // Ordre FK : daily_metrics.main_activity_id et power_profile.activity_id_*
      // référencent activities → on les vide avant activities.
      tables = wipe
        ? ["power_profile", "daily_metrics", "activities", "strava_connections"]
        : ["strava_connections"];
    } else {
      tables = wipe ? ["whoop_data", "whoop_connections"] : ["whoop_connections"];
    }

    for (const table of tables) {
      const { error } = await sb.from(table).delete().eq("user_id", uid);
      if (error) { console.error(`delete ${table}:`, error.message); return json({ error: `delete_${table}_failed`, detail: error.message }, 500); }
      deleted[table] = true;
    }

    // En mode wipe Strava, on remet aussi à zéro les infos athlète issues de Strava.
    if (wipe && provider === "strava") {
      await sb.from("user_profiles").update({
        strava_athlete_id: null, ftp: null, weight: null,
      }).eq("user_id", uid);
      deleted["user_profiles_reset"] = true;
    }

    return json({ ok: true, provider, wipe, deleted });
  } catch (e: any) {
    console.error("disconnect-integration unhandled:", e);
    return json({ error: e.message || String(e) }, 500);
  }
});

function json(body: any, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
async function safeJson(req: Request): Promise<any> { try { return await req.json(); } catch { return {}; } }
