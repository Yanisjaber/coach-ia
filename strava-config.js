// ============================================================
// strava-config.js — Configuration OAuth Strava (client_id PUBLIC, OK exposé)
// ⚠️ NE JAMAIS METTRE le client_secret ici (c'est dans les secrets de l'Edge Function)
// ============================================================
window.STRAVA_CONFIG = {
  // Ton client_id Strava (visible dans https://www.strava.com/settings/api)
  client_id: '248376',
  // URL de l'Edge Function Supabase qui reçoit le callback
  // Format : https://<PROJECT_REF>.supabase.co/functions/v1/strava-oauth-callback
  redirect_uri: 'https://gfavgstyyaaidkpadkxz.supabase.co/functions/v1/strava-oauth-callback',
};
