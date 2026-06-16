// ============================================================
// Edge Function : send-invite
//
// Envoie un email d'invitation coach -> athlete via Resend.
// Le front (coach connecte) appelle :
//   supabase.functions.invoke('send-invite', { body: { email, acceptUrl, coachName } })
//
// Deploiement :
//   1) Cree un compte gratuit sur https://resend.com et genere une API key.
//   2) supabase secrets set RESEND_API_KEY=re_xxx
//      (optionnel) supabase secrets set INVITE_FROM="Coach IA <onboarding@resend.dev>"
//   3) supabase functions deploy send-invite
//
// Sans domaine verifie, Resend autorise l'envoi depuis onboarding@resend.dev
// (suffisant pour tester). Pour la prod, verifie ton domaine dans Resend.
// ============================================================
// deno-lint-ignore-file no-explicit-any
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") || "";
const INVITE_FROM = Deno.env.get("INVITE_FROM") || "Coach IA <onboarding@resend.dev>";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function esc(s: string) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" } as any)[c]);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    if (!RESEND_API_KEY) {
      return new Response(JSON.stringify({ error: "RESEND_API_KEY non configure" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const { email, acceptUrl, coachName } = await req.json();
    if (!email || !acceptUrl) {
      return new Response(JSON.stringify({ error: "email et acceptUrl requis" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const who = esc(coachName || "Ton coach");
    const url = esc(acceptUrl);
    const html =
      '<div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;color:#111">' +
      '<h2 style="color:#16a34a">Coach IA - Invitation</h2>' +
      '<p><strong>' + who + '</strong> souhaite devenir ton coach sur Coach IA et suivre ton entrainement.</p>' +
      '<p>Clique ci-dessous pour accepter (tu devras te connecter a ton compte) :</p>' +
      '<p style="text-align:center;margin:28px 0">' +
      '<a href="' + url + '" style="background:#16a34a;color:#fff;text-decoration:none;padding:12px 22px;border-radius:10px;font-weight:bold">Accepter l\'invitation</a>' +
      '</p>' +
      '<p style="font-size:12px;color:#666">Ou copie ce lien : ' + url + '</p>' +
      '<p style="font-size:12px;color:#999">Si tu n\'es pas concerne, ignore cet email.</p>' +
      '</div>';

    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": "Bearer " + RESEND_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ from: INVITE_FROM, to: [email], subject: "Invitation de coaching - Coach IA", html }),
    });
    if (!r.ok) {
      const t = await r.text();
      return new Response(JSON.stringify({ error: "Resend: " + t }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    return new Response(JSON.stringify({ ok: true }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
