// ============================================================
// Edge Function : send-invite
//
// Envoie un email d'invitation coach -> athlete via Resend.
// Le front (coach connecte) appelle :
//   supabase.functions.invoke('send-invite', { body: { email, acceptUrl, coachName } })
//
// Deploiement :
//   1) Compte gratuit sur https://resend.com + API key.
//   2) supabase secrets set RESEND_API_KEY=re_xxx
//      (optionnel) supabase secrets set INVITE_FROM="Coach IA <coach@jaberautomations.fr>"
//   3) supabase functions deploy send-invite
//   Domaine verifie dans Resend requis pour envoyer a n'importe quelle adresse.
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

function buildHtml(coach: string, url: string) {
  const who = esc(coach || "Votre coach");
  const u = esc(url);
  return `<!DOCTYPE html>
<html lang="fr">
<body style="margin:0;padding:0;background:#eef0f4;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef0f4;padding:32px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #e3e6ec;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;">
        <!-- En-tete -->
        <tr><td style="padding:30px 32px 16px;border-bottom:1px solid #f0f1f4;">
          <span style="font-size:17px;font-weight:800;color:#16a34a;letter-spacing:-0.3px;">Coach IA</span>
        </td></tr>
        <!-- Corps -->
        <tr><td style="padding:26px 32px 6px;">
          <h1 style="margin:0 0 12px;font-size:19px;color:#11141b;">Vous avez recu une invitation</h1>
          <p style="margin:0 0 18px;font-size:15px;line-height:1.6;color:#3a4150;">
            <strong>${who}</strong> souhaite devenir votre coach sur Coach IA et suivre votre entrainement.
          </p>
        </td></tr>
        <!-- Bouton -->
        <tr><td style="padding:0 32px 8px;">
          <a href="${u}" style="display:inline-block;background:#11141b;color:#ffffff;text-decoration:none;padding:13px 26px;border-radius:8px;font-size:14px;font-weight:700;">Accepter l'invitation &rarr;</a>
        </td></tr>
        <tr><td style="padding:14px 32px 6px;">
          <p style="margin:0;font-size:12px;color:#9aa2b1;">Vous devrez vous connecter a votre compte pour confirmer.</p>
        </td></tr>
        <!-- Lien de secours -->
        <tr><td style="padding:4px 32px 24px;">
          <p style="margin:0;font-size:12px;line-height:1.5;color:#9aa2b1;word-break:break-all;">
            Si le bouton ne fonctionne pas : <a href="${u}" style="color:#2563eb;">${u}</a>
          </p>
        </td></tr>
        <!-- Pied -->
        <tr><td style="background:#fafbfc;padding:14px 32px;border-top:1px solid #f0f1f4;">
          <p style="margin:0;font-size:11px;line-height:1.5;color:#aab0bd;">
            Coach IA &middot; suivi d'entrainement &amp; recuperation.<br>
            Vous recevez cet email car votre adresse a ete invitee. Sinon, ignorez-le simplement.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
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
    const html = buildHtml(coachName, acceptUrl);
    const text = `${coachName || "Votre coach"} vous invite a rejoindre Coach IA en tant qu'athlete.\n\n` +
      `Acceptez l'invitation : ${acceptUrl}\n\n` +
      `Coach IA - plateforme de suivi d'entrainement.`;

    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": "Bearer " + RESEND_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: INVITE_FROM,
        to: [email],
        subject: (coachName ? coachName + " vous invite sur Coach IA" : "Invitation - Coach IA"),
        html, text,
      }),
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
