// ============================================================
// Edge Function : strava-oauth-callback
//
// Reçoit le callback OAuth de Strava :
//   GET ?code=XXX&state=JWT_SUPABASE
//
// Vérifie le JWT (= identité de l'utilisateur Supabase),
// échange le code contre les tokens Strava (via client_secret),
// stocke dans la table strava_connections,
// redirige vers l'app avec un flag de succès.
//
// Déploiement :
//   supabase functions deploy strava-oauth-callback --no-verify-jwt
//
// Secrets requis (à définir avant le deploy) :
//   supabase secrets set STRAVA_CLIENT_ID=248376
//   supabase secrets set STRAVA_CLIENT_SECRET=xxxx
//   supabase secrets set APP_REDIRECT_URL=https://yanisjaber.github.io/coach-ia/
//
// Note : on utilise --no-verify-jwt parce qu'on vérifie le JWT MANUELLEMENT
// avec le state (sinon Supabase exigerait l'auth header).
// ============================================================
// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const STRAVA_CLIENT_ID = Deno.env.get("STRAVA_CLIENT_ID")!;
const STRAVA_CLIENT_SECRET = Deno.env.get("STRAVA_CLIENT_SECRET")!;
const APP_REDIRECT_URL = Deno.env.get("APP_REDIRECT_URL") || "https://yanisjaber.github.io/coach-ia/";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  try {
    const url = new URL(req.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const error = url.searchParams.get("error");

    if (error) {
      return redirectToApp({ strava_error: error });
    }
    if (!code || !state) {
      return redirectToApp({ strava_error: "missing_code_or_state" });
    }

    // ===== 1) Vérifier le JWT state pour identifier l'utilisateur Supabase =====
    const sbAuth = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    const { data: { user }, error: userErr } = await sbAuth.auth.getUser(state);
    if (userErr || !user) {
      return redirectToApp({ strava_error: "invalid_state_jwt" });
    }

    // ===== 2) Échanger le code Strava contre les tokens =====
    const tokenRes = await fetch("https://www.strava.com/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: STRAVA_CLIENT_ID,
        client_secret: STRAVA_CLIENT_SECRET,
        code,
        grant_type: "authorization_code",
      }),
    });

    if (!tokenRes.ok) {
      const txt = await tokenRes.text();
      console.error("Strava token exchange failed:", tokenRes.status, txt);
      return redirectToApp({ strava_error: `token_exchange_${tokenRes.status}` });
    }

    const tokens: any = await tokenRes.json();
    if (!tokens.access_token) {
      return redirectToApp({ strava_error: "no_access_token" });
    }

    // ===== 3) Stocker dans strava_connections (utilise service_role pour bypass RLS) =====
    const sbAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const athlete = tokens.athlete || {};
    const expiresAt = new Date((tokens.expires_at || 0) * 1000).toISOString();

    const { error: insertErr } = await sbAdmin
      .from("strava_connections")
      .upsert({
        user_id: user.id,
        strava_athlete_id: athlete.id,
        athlete_name: `${athlete.firstname || ""} ${athlete.lastname || ""}`.trim() || null,
        athlete_email: athlete.email || null,
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expires_at: expiresAt,
        scope: tokens.scope || null,
        first_connected_at: new Date().toISOString(),
      }, { onConflict: "user_id" });

    if (insertErr) {
      console.error("Insert strava_connections failed:", insertErr);
      return redirectToApp({ strava_error: "db_insert_failed" });
    }

    // ===== 4) Mettre à jour aussi user_profiles avec FTP / weight / strava_athlete_id =====
    await sbAdmin
      .from("user_profiles")
      .upsert({
        user_id: user.id,
        display_name: `${athlete.firstname || ""} ${athlete.lastname || ""}`.trim() || null,
        strava_athlete_id: athlete.id,
        ftp: athlete.ftp || null,
        weight: athlete.weight || null,
      }, { onConflict: "user_id" });

    // ===== 5) Redirection vers l'app avec flag de succès =====
    return redirectToApp({ strava_connected: "1" });
  } catch (e) {
    console.error("Unhandled error:", e);
    return redirectToApp({ strava_error: "unexpected" });
  }
});

function redirectToApp(params: Record<string, string>): Response {
  const url = new URL(APP_REDIRECT_URL);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }
  return Response.redirect(url.toString(), 302);
}
