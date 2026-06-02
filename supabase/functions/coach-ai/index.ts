// ============================================================
// Edge Function : coach-ai
//
// Appelle l'API Google Gemini côté serveur — la clé reste un secret, jamais
// exposée au navigateur. Le front envoie le JWT Supabase + un contexte (résumé
// de la séance + forme), la fonction renvoie l'analyse générée.
//
// Appel (front, POST, JWT Supabase dans Authorization) :
//   body JSON : { "action": "analyze-session", "context": { ... } }
//
// Déploiement :
//   supabase secrets set GEMINI_API_KEY=...        (clé Google AI Studio)
//   supabase functions deploy coach-ai
// Secrets requis : GEMINI_API_KEY, SUPABASE_URL, SUPABASE_ANON_KEY.
// Optionnel : GEMINI_MODEL (défaut : gemini-2.5-flash).
// ============================================================
// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY") || "";
const GEMINI_MODEL = Deno.env.get("GEMINI_MODEL") || "gemini-2.5-flash";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SYS_ANALYZE = `Tu es un entraîneur de cyclisme et de sports d'endurance, expert, précis et bienveillant.
On te donne le résumé chiffré d'UNE séance d'un athlète, plus son état de forme (modèle PMC : CTL = forme/fitness, ATL = fatigue, TSB = fraîcheur).
Rédige un débrief court et actionnable EN FRANÇAIS, structuré ainsi :
- **Exécution** : intensité réalisée (NP, % FTP, IF), charge (TSS), dérive/variabilité si dispo — en 1-2 phrases.
- **Lecture forme** : ce que la séance apporte vu le CTL/ATL/TSB.
- **Conseil** : 1 recommandation concrète pour la suite (récup, prochaine séance type).
Règles : commence DIRECTEMENT par la section « Exécution », SANS salutation, sans phrase d'introduction et sans séparateurs (pas de « --- »). Reste concis (≈120-160 mots), parle à la 2e personne, pas de jargon inutile, pas de conseil médical. Si une donnée manque, ne l'invente pas.`;

const SYS_PLAN = `Tu es un entraîneur de cyclisme expert. Construis un PLAN d'entraînement personnalisé EN FRANÇAIS, du jour indiqué jusqu'à la prochaine compétition (incluse).
Principes : périodisation (Build si loin, Peak à 4-8 semaines, Taper à 1-4 semaines, semaine de course si <1 semaine) ; respecte le volume hebdomadaire récent de l'athlète (ne le double surtout pas) ; 1 à 2 jours de repos par semaine ; alterne intensité (seuil/VO2) et endurance ; allège nettement la dernière semaine (affûtage) ; place une activation courte 2 jours avant la course et du repos la veille.
Pour CHAQUE séance : date (YYYY-MM-DD, comprise dans la plage), sport (un de : cyclisme, course, musculation, natation, autre), name (court), type (un de : endurance, tempo, seuil, vo2, recup, force, rest), duration_min (entier ; 0 si repos), tss (entier estimé ; 0 si repos), description (1 phrase concrète, ex : "3×10' au seuil, récup 5'").
Regroupe les séances par semaine (label ex : "Semaine 1 · Peak", focus en 2-3 mots). Couvre tous les jours utiles. Ne mets pas de jour de course toi-même (la compétition est déjà connue). Base-toi uniquement sur le contexte fourni, n'invente pas de chiffres absents.`;

const PLAN_SCHEMA = {
  type: "OBJECT",
  properties: {
    summary: { type: "STRING" },
    weeks: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          label: { type: "STRING" },
          focus: { type: "STRING" },
          sessions: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                date: { type: "STRING" },
                sport: { type: "STRING" },
                name: { type: "STRING" },
                type: { type: "STRING" },
                duration_min: { type: "INTEGER" },
                tss: { type: "INTEGER" },
                description: { type: "STRING" },
              },
              required: ["date", "name", "duration_min"],
            },
          },
        },
        required: ["label", "sessions"],
      },
    },
  },
  required: ["weeks"],
};

const SYS_CHAT = `Tu es le coach IA d'un cycliste, intégré dans son app d'entraînement. Tu réponds en FRANÇAIS, de façon concise, concrète et bienveillante. Pas de conseil médical.
Tu peux AGIR sur son calendrier quand il le demande explicitement (planifier/ajouter une séance, poser un jour de repos), en renvoyant des "actions".
Réponds TOUJOURS au format JSON : { "reply": "<ta réponse courte à afficher dans le chat>", "actions": [ ... ] }.
Types d'action possibles :
- { "type":"add_session", "date":"YYYY-MM-DD", "mode":"prevu" (ou "realise"), "sport":"cyclisme|course|musculation|natation|autre", "name":"nom court", "sessionType":"endurance|tempo|seuil|vo2|recup|force", "duration_min":entier, "tss":entier, "description":"1 phrase concrète" }
- { "type":"add_rest", "date":"YYYY-MM-DD" }
Mets des actions UNIQUEMENT si l'utilisateur demande clairement de planifier/ajouter/poser quelque chose ; sinon "actions": []. Dans "reply", confirme en une phrase ce que tu as ajouté. Résous les dates relatives ("demain", "mardi prochain") en YYYY-MM-DD à partir de la date du jour fournie dans le contexte. Appuie-toi sur le contexte (forme, volume, objectifs) pour conseiller.`;

const CHAT_SCHEMA = {
  type: "OBJECT",
  properties: {
    reply: { type: "STRING" },
    actions: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          type: { type: "STRING" },
          date: { type: "STRING" },
          mode: { type: "STRING" },
          sport: { type: "STRING" },
          name: { type: "STRING" },
          sessionType: { type: "STRING" },
          duration_min: { type: "INTEGER" },
          tss: { type: "INTEGER" },
          description: { type: "STRING" },
        },
        required: ["type"],
      },
    },
  },
  required: ["reply"],
};

async function geminiCall(systemText: string, contents: any[], genConfig: any) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": GEMINI_API_KEY },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: systemText }] },
      contents,
      generationConfig: genConfig,
    }),
  });
  const data = await res.json().catch(() => ({}));
  const parts = data?.candidates?.[0]?.content?.parts || [];
  const text = parts.map((p: any) => p.text || "").join("\n").trim();
  return { res, data, text };
}
async function gemini(systemText: string, userText: string, genConfig: any) {
  return geminiCall(systemText, [{ role: "user", parts: [{ text: userText }] }], genConfig);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const jwt = (req.headers.get("Authorization") || "").replace("Bearer ", "").trim();
    if (!jwt) return json({ error: "missing_jwt" }, 401);
    const sbAuth = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    const { data: { user }, error: authErr } = await sbAuth.auth.getUser(jwt);
    if (authErr || !user) return json({ error: "invalid_jwt" }, 401);

    if (!GEMINI_API_KEY) {
      return json({ error: "gemini_key_missing", hint: "Définis le secret GEMINI_API_KEY." }, 500);
    }

    const body = await safeJson(req);
    const action = String(body?.action || "");
    const ctx = body?.context || {};

    if (action === "analyze-session") {
      const userMsg =
        "Voici la séance à analyser (JSON). Les champs nuls/absents sont inconnus, ne les invente pas.\n\n```json\n"
        + JSON.stringify(ctx, null, 2) + "\n```";
      const { res, data, text } = await gemini(SYS_ANALYZE, userMsg, {
        maxOutputTokens: 900, temperature: 0.6, thinkingConfig: { thinkingBudget: 0 },
      });
      if (!res.ok) {
        console.error("gemini error:", res.status, JSON.stringify(data).slice(0, 300));
        return json({ error: "gemini_error", status: res.status, detail: data?.error?.message || "" }, 502);
      }
      if (!text) return json({ error: "empty_response", detail: data?.candidates?.[0]?.finishReason || "" }, 502);
      return json({ ok: true, text });
    }

    if (action === "generate-plan") {
      const userMsg =
        "Contexte de l'athlète (JSON) :\n```json\n" + JSON.stringify(ctx, null, 2) + "\n```\n"
        + `Génère le plan du ${ctx.today || "(aujourd'hui)"} jusqu'à la compétition`
        + (ctx.competition?.date ? ` du ${ctx.competition.date}` : "") + " (exclue).";
      const { res, data, text } = await gemini(SYS_PLAN, userMsg, {
        maxOutputTokens: 2600, temperature: 0.6, thinkingConfig: { thinkingBudget: 0 },
        responseMimeType: "application/json", responseSchema: PLAN_SCHEMA,
      });
      if (!res.ok) {
        console.error("gemini plan error:", res.status, JSON.stringify(data).slice(0, 300));
        return json({ error: "gemini_error", status: res.status, detail: data?.error?.message || "" }, 502);
      }
      let plan: any = null;
      try { plan = JSON.parse(text); } catch { return json({ error: "plan_parse_failed", detail: text.slice(0, 200) }, 502); }
      return json({ ok: true, plan });
    }

    if (action === "chat") {
      const msgs = Array.isArray(body?.messages) ? body.messages : [];
      const contents = msgs.slice(-24)
        .filter((m: any) => m && m.text)
        .map((m: any) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: String(m.text) }] }));
      if (!contents.length) return json({ error: "no_messages" }, 400);
      const sys = SYS_CHAT + "\n\nContexte actuel (JSON) :\n" + JSON.stringify(ctx);
      const { res, data, text } = await geminiCall(sys, contents, {
        maxOutputTokens: 1200, temperature: 0.6, thinkingConfig: { thinkingBudget: 0 },
        responseMimeType: "application/json", responseSchema: CHAT_SCHEMA,
      });
      if (!res.ok) {
        console.error("gemini chat error:", res.status, JSON.stringify(data).slice(0, 300));
        return json({ error: "gemini_error", status: res.status, detail: data?.error?.message || "" }, 502);
      }
      let parsed: any = null;
      try { parsed = JSON.parse(text); } catch { parsed = { reply: text, actions: [] }; }
      return json({ ok: true, reply: parsed.reply || "", actions: Array.isArray(parsed.actions) ? parsed.actions : [] });
    }

    return json({ error: "unknown_action", action }, 400);
  } catch (e: any) {
    console.error("coach-ai unhandled:", e);
    return json({ error: e.message || String(e) }, 500);
  }
});

function json(body: any, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
async function safeJson(req: Request): Promise<any> { try { return await req.json(); } catch { return {}; } }
