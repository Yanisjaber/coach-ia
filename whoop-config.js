// ============================================================
// whoop-config.js — Configuration OAuth Whoop (client_id PUBLIC, OK exposé)
// ⚠️ NE JAMAIS METTRE le client_secret ici (il est dans les secrets de l'Edge Function)
// ============================================================
window.WHOOP_CONFIG = {
  // Ton client_id Whoop (portail développeur Whoop)
  client_id: '7e159226-403f-41a2-8dc6-10f06c81671e',
  // URL de l'Edge Function Supabase qui reçoit le callback.
  // DOIT être déclarée à l'identique dans le portail développeur Whoop (Redirect URIs).
  redirect_uri: 'https://gfavgstyyaaidkpadkxz.supabase.co/functions/v1/whoop-oauth-callback',
};
