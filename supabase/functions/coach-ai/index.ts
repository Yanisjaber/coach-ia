// ============================================================
// Edge Function : coach-ai
//
// Proxy serveur vers l'API Google Gemini (clé en secret, jamais exposée).
// Le front envoie son JWT Supabase + une action ; la fonction renvoie la réponse.
//
// Actions (POST, JWT Supabase dans Authorization, body JSON) :
//   - "analyze-session" { context }            → débrief texte d'une séance
//   - "home-report"     { context }            → bilan coureur (JSON court)
//   - "daily-reco"      { context }            → reco du jour (texte)
//   - "generate-plan"   { context }            → plan périodisé (JSON)
//   - "chat"            { context, messages[] } → réponse + actions (JSON)
//
// Déploiement :
//   supabase secrets set GEMINI_API_KEY=...
//   supabase functions deploy coach-ai
// Secrets : GEMINI_API_KEY, SUPABASE_URL, SUPABASE_ANON_KEY. Optionnel : GEMINI_MODEL, GEMINI_FALLBACK_MODEL.
// ============================================================
// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY") || "";
const GEMINI_MODEL = Deno.env.get("GEMINI_MODEL") || "gemini-2.5-flash";
const GEMINI_FALLBACK = Deno.env.get("GEMINI_FALLBACK_MODEL") || "gemini-2.5-flash-lite";

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
Regroupe les séances par semaine (label ex : "Semaine 1 · Peak", focus en 2-3 mots). Couvre tous les jours utiles. Ne mets pas de jour de course toi-même. Base-toi uniquement sur le contexte fourni.`;

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
Pouvoirs et limites STRICTS :
- Tu peux PLANIFIER des séances FUTURES (séances « prévues ») et poser des jours de repos FUTURS, uniquement quand l'utilisateur le demande explicitement.
- Tu peux LIRE les activités passées / réalisées (pour analyser et conseiller) mais tu ne dois JAMAIS créer, modifier ni supprimer une activité passée ou réalisée.
- Toutes les dates d'action doivent être >= la date du jour (fournie dans le contexte).
Réponds TOUJOURS au format JSON : { "reply": "<réponse courte à afficher>", "actions": [ ... ] }.
Types d'action possibles (futurs uniquement) :
- { "type":"add_session", "date":"YYYY-MM-DD", "sport":"cyclisme|course|musculation|natation|autre", "name":"nom court", "sessionType":"endurance|tempo|seuil|vo2|recup|force", "duration_min":entier, "tss":entier, "description":"1 phrase concrète" }  → crée une séance PRÉVUE
- { "type":"add_rest", "date":"YYYY-MM-DD" }  → pose un jour de repos prévu
Mets des actions UNIQUEMENT si l'utilisateur demande clairement de planifier/ajouter/poser quelque chose ; sinon "actions": []. Dans "reply", confirme en une phrase. Résous les dates relatives à partir de la date du jour du contexte.`;

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

const SYS_HOME = `Tu es un entraîneur de cyclisme expert. À partir des données de l'athlète (profil de puissance par durée, FTP, poids/W·kg, forme PMC CTL/ATL/TSB, volume, polarisation des zones, régularité, séances récentes, prochain objectif), produis un BILAN ANALYTIQUE EN FRANÇAIS.
OBJECTIF : apporter de la VALEUR D'ENTRAÎNEUR — des DÉDUCTIONS et des CONSEILS, PAS un simple rappel de statistiques que l'athlète voit déjà ailleurs.
Renvoie un JSON : { type_label, niveau_label, forme_label, synthese, insights[], alerts[], prediction{}, archetypes{}, action_plan[] }.
- type_label : profil en 1-3 mots (ex "Puncheur-grimpeur") — déduit des ratios 5s/1min/5min/20min vs FTP.
- niveau_label : 2-4 mots (ex "Amateur entraîné") selon W/kg au FTP (~2.5 débutant, 3.5 amateur, 4.5 compétiteur, 5.5+ élite) et CTL.
- forme_label : 1-3 mots sur la fraîcheur (ex "Très frais", "Fatigué") d'après le TSB.
- synthese : EXACTEMENT 1 à 2 phrases courtes (≤ 35 mots AU TOTAL). C'est une CONCLUSION générale (profil + forme + enjeu), surtout PAS un résumé des cartes insights ni une énumération de chiffres. Sois concis et percutant.
- insights : 4 à 6 cartes { kind, titre, detail, reco }. kind ∈ "force"|"axe"|"tendance"|"risque". titre = constat 3-6 mots. detail = 1 SEULE phrase (≤ 20 mots) qui cite la donnée justifiant la déduction. reco = 1 action concrète (≤ 12 mots). Angles variés, pas de redite entre cartes.
- alerts : 0 à 3 alertes { level, titre (≤ 5 mots), detail (1 phrase, ≤ 20 mots) }. level ∈ "warn" (risque réel : surcharge, ramp CTL trop haute, TSB très négatif, déséquilibre intensité) | "info" (point d'attention). N'en mets que si les données le justifient ; sinon tableau vide.
- prediction : prédiction sur le PROCHAIN objectif (champ competition) { objectif, echeance (ex "J-12"), type, classement (ex "Top 10-15"), confiance (entier 0-100), cible (≤ 8 mots), scenario (≤ 2 phrases, ≤ 35 mots), cles (2-4 conseils ≤ 10 mots chacun), gpx_manquant (booléen) }. Déduis le classement du niveau et du type d'épreuve.
  RÈGLE GPX — IMPORTANT : si competition.parcours.gpx_present est false ET qu'il n'y a ni distance_km ni denivele_m, tu NE DOIS PAS inventer le profil du parcours (ne dis JAMAIS "probablement vallonné/plat/montagneux"). Dans ce cas : gpx_manquant=true, cible=null, scenario décrit seulement les forces du coureur SANS supposer le terrain, et la 1re entrée de cles invite à renseigner le GPX du parcours. Si le parcours est connu (gpx_present true ou distance/dénivelé fournis), gpx_manquant=false et donne une cible chiffrée adaptée au terrain.
  Si aucun objectif (competition null), objectif:"Aucun objectif planifié", confiance:0, gpx_manquant:false.
- archetypes : { dominant (libellé), scores: [{label, pct}] pour "Puncheur","Grimpeur","Sprinteur","Rouleur" (pct 0-100 selon les ratios de puissance), pro (1 phrase : type de coureur pro auquel il ressemble, SANS citation inventée) }.
- action_plan : 3 à 5 étapes { titre, detail, impact } priorisées sur les prochaines semaines pour corriger les points faibles et préparer l'objectif. impact = bénéfice attendu en 3-5 mots.
Si profil_puissance.puissance_max_watts contient des valeurs, tu DOIS déterminer type/niveau/archétypes — ne réponds JAMAIS "impossible". N'invente pas de chiffres absents : appuie-toi sur les données fournies.`;

const HOME_SCHEMA = {
  type: "OBJECT",
  properties: {
    type_label: { type: "STRING" },
    niveau_label: { type: "STRING" },
    forme_label: { type: "STRING" },
    synthese: { type: "STRING" },
    insights: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          kind: { type: "STRING" }, titre: { type: "STRING" }, detail: { type: "STRING" }, reco: { type: "STRING" },
        },
        required: ["kind", "titre", "detail"],
      },
    },
    alerts: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: { level: { type: "STRING" }, titre: { type: "STRING" }, detail: { type: "STRING" } },
        required: ["level", "titre", "detail"],
      },
    },
    prediction: {
      type: "OBJECT",
      properties: {
        objectif: { type: "STRING" }, echeance: { type: "STRING" }, type: { type: "STRING" },
        classement: { type: "STRING" }, confiance: { type: "INTEGER" }, cible: { type: "STRING" },
        scenario: { type: "STRING" }, cles: { type: "ARRAY", items: { type: "STRING" } },
        gpx_manquant: { type: "BOOLEAN" },
      },
    },
    archetypes: {
      type: "OBJECT",
      properties: {
        dominant: { type: "STRING" },
        scores: { type: "ARRAY", items: { type: "OBJECT", properties: { label: { type: "STRING" }, pct: { type: "INTEGER" } }, required: ["label", "pct"] } },
        pro: { type: "STRING" },
      },
    },
    action_plan: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: { titre: { type: "STRING" }, detail: { type: "STRING" }, impact: { type: "STRING" } },
        required: ["titre", "detail"],
      },
    },
  },
  required: ["type_label", "niveau_label", "forme_label", "insights"],
};

const _sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Appel Gemini résilient : réessaie sur surcharge/limite (503/429), puis bascule
// sur un modèle de secours si le principal reste indisponible.
async function geminiCall(systemText: string, contents: any[], genConfig: any) {
  const models = [GEMINI_MODEL, GEMINI_FALLBACK].filter((m, i, a) => m && a.indexOf(m) === i);
  const payload = JSON.stringify({
    system_instruction: { parts: [{ text: systemText }] },
    contents,
    generationConfig: genConfig,
  });
  let last: any = { res: { ok: false, status: 0 }, data: {}, text: "" };
  for (const model of models) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": GEMINI_API_KEY },
        body: payload,
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        const parts = data?.candidates?.[0]?.content?.parts || [];
        return { res, data, text: parts.map((p: any) => p.text || "").join("\n").trim() };
      }
      last = { res, data, text: "" };
      if (res.status === 503 || res.status === 429) { await _sleep(600 * (attempt + 1)); continue; }
      break;
    }
  }
  return last;
}
async function gemini(systemText: string, userText: string, genConfig: any) {
  return geminiCall(systemText, [{ role: "user", parts: [{ text: userText }] }], genConfig);
}

// Parse tolérant : retire les caractères de contrôle et les retours répétés (le
// modèle peut "boucler"), isole le bloc {...}, puis JSON.parse. null si invalide.
function cleanParse(text: string): any {
  if (!text) return null;
  let t = String(text);
  let out = "";
  for (let i = 0; i < t.length; i++) {
    const c = t.charCodeAt(i);
    if (c === 13) continue;                 // \r
    if (c < 32 && c !== 10 && c !== 9) continue; // contrôles sauf \n \t
    out += t[i];
  }
  out = out.replace(/\n{2,}/g, "\n").trim();
  const s = out.indexOf("{"), e = out.lastIndexOf("}");
  if (s >= 0 && e > s) out = out.slice(s, e + 1);
  try { return JSON.parse(out); } catch { return null; }
}

// JSON structuré avec réessai si le modèle produit un JSON cassé (boucle, troncature).
async function geminiJson(systemText: string, contents: any[], schema: any, maxTokens: number) {
  for (let i = 0; i < 2; i++) {
    const { res, data, text } = await geminiCall(systemText, contents, {
      maxOutputTokens: maxTokens, temperature: 0.5, thinkingConfig: { thinkingBudget: 0 },
      responseMimeType: "application/json", responseSchema: schema,
    });
    if (!res.ok) return { error: { status: res.status, detail: data?.error?.message || "" } };
    const parsed = cleanParse(text);
    if (parsed) return { value: parsed };
  }
  return { error: { status: 502, detail: "json_invalide" } };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const jwt = (req.headers.get("Authorization") || "").replace("Bearer ", "").trim();
    if (!jwt) return json({ error: "missing_jwt" }, 401);
    const sbAuth = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    const { data: { user }, error: authErr } = await sbAuth.auth.getUser(jwt);
    if (authErr || !user) return json({ error: "invalid_jwt" }, 401);

    if (!GEMINI_API_KEY) return json({ error: "gemini_key_missing", hint: "Définis le secret GEMINI_API_KEY." }, 500);

    const body = await safeJson(req);
    const action = String(body?.action || "");
    const ctx = body?.context || {};

    if (action === "analyze-session") {
      const userMsg = "Voici la séance à analyser (JSON). Les champs nuls/absents sont inconnus, ne les invente pas.\n\n```json\n" + JSON.stringify(ctx, null, 2) + "\n```";
      const { res, data, text } = await gemini(SYS_ANALYZE, userMsg, { maxOutputTokens: 900, temperature: 0.6, thinkingConfig: { thinkingBudget: 0 } });
      if (!res.ok) return json({ error: "gemini_error", status: res.status, detail: data?.error?.message || "" }, 502);
      if (!text) return json({ error: "empty_response" }, 502);
      return json({ ok: true, text });
    }

    if (action === "home-report") {
      const userMsg = "Données de l'athlète (JSON) :\n```json\n" + JSON.stringify(ctx, null, 2) + "\n```";
      const r = await geminiJson(SYS_HOME, [{ role: "user", parts: [{ text: userMsg }] }], HOME_SCHEMA, 3600);
      if (r.error) return json({ error: "gemini_error", status: r.error.status, detail: r.error.detail }, 502);
      return json({ ok: true, report: r.value });
    }

    if (action === "daily-reco") {
      const userMsg = "Contexte de l'athlète (JSON) :\n```json\n" + JSON.stringify(ctx, null, 2) + "\n```\n"
        + "Donne UNE recommandation concrète pour AUJOURD'HUI (type de séance + durée approximative, ou repos), adaptée à la forme (CTL/ATL/TSB), au volume récent et à la prochaine compétition. 2-3 phrases max, en français, sans salutation ni titre.";
      const { res, data, text } = await gemini(
        "Tu es un entraîneur de cyclisme. Tu donnes des recommandations quotidiennes concises et concrètes, en français, sans conseil médical.",
        userMsg, { maxOutputTokens: 400, temperature: 0.6, thinkingConfig: { thinkingBudget: 0 } });
      if (!res.ok) return json({ error: "gemini_error", status: res.status, detail: data?.error?.message || "" }, 502);
      if (!text) return json({ error: "empty_response" }, 502);
      return json({ ok: true, text });
    }

    if (action === "generate-plan") {
      const userMsg = "Contexte de l'athlète (JSON) :\n```json\n" + JSON.stringify(ctx, null, 2) + "\n```\n"
        + `Génère le plan du ${ctx.today || "(aujourd'hui)"} jusqu'à la compétition` + (ctx.competition?.date ? ` du ${ctx.competition.date}` : "") + " (exclue).";
      const r = await geminiJson(SYS_PLAN, [{ role: "user", parts: [{ text: userMsg }] }], PLAN_SCHEMA, 2600);
      if (r.error) return json({ error: "gemini_error", status: r.error.status, detail: r.error.detail }, 502);
      return json({ ok: true, plan: r.value });
    }

    if (action === "chat") {
      const msgs = Array.isArray(body?.messages) ? body.messages : [];
      const contents = msgs.slice(-24).filter((m: any) => m && m.text)
        .map((m: any) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: String(m.text) }] }));
      if (!contents.length) return json({ error: "no_messages" }, 400);
      const sys = SYS_CHAT + "\n\nContexte actuel (JSON) :\n" + JSON.stringify(ctx);
      const r = await geminiJson(sys, contents, CHAT_SCHEMA, 1200);
      if (r.error) return json({ error: "gemini_error", status: r.error.status, detail: r.error.detail }, 502);
      return json({ ok: true, reply: r.value.reply || "", actions: Array.isArray(r.value.actions) ? r.value.actions : [] });
    }

    return json({ error: "unknown_action", action }, 400);
  } catch (e: any) {
    console.error("coach-ai unhandled:", e);
    return json({ error: e.message || String(e) }, 500);
  }
});

function json(body: any, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
async function safeJson(req: Request): Promise<any> { try { return await req.json(); } catch { return {}; } }
