# Setup Strava Webhooks

Les webhooks Strava permettent de recevoir **en temps réel** les nouvelles activités, modifications et suppressions, au lieu de poller toutes les 15 min / 3h. Dès que tu termines une sortie et que ta montre uploade sur Strava, l'activité apparaît dans Coach IA en quelques secondes.

## Architecture

```
Ta montre → Strava → Webhook POST → Edge Function strava-webhook → Supabase
                                                       └→ insert activity + recompute daily_metrics
```

## Étapes

### 1. Générer un verify_token (secret partagé avec Strava)

Choisis une chaîne aléatoire (genre 32 caractères). Exemple :

```bash
openssl rand -hex 16
# → e.g. "f3b8a2c1d9e4f7a6b5c8d3e2f1a4b7c8"
```

Garde-la, tu vas en avoir besoin deux fois.

### 2. Ajouter le secret dans Supabase

```bash
supabase secrets set STRAVA_WEBHOOK_VERIFY_TOKEN=f3b8a2c1d9e4f7a6b5c8d3e2f1a4b7c8
```

(STRAVA_CLIENT_ID, STRAVA_CLIENT_SECRET, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY doivent déjà être set — ils servent aussi à strava-ingest.)

### 3. Déployer l'Edge Function

```bash
cd ~/Documents/coach-ia
supabase functions deploy strava-webhook --no-verify-jwt
```

⚠ Le flag `--no-verify-jwt` est obligatoire : Strava n'envoie pas de JWT, on s'authentifie via le `verify_token` qui est dans l'URL au moment de l'inscription, et après les events sont juste acceptés (Strava est la seule source possible vu l'URL).

### 4. Créer l'abonnement Strava (1 SEULE FOIS)

```bash
# Remplace les valeurs entre <…>
curl -X POST https://www.strava.com/api/v3/push_subscriptions \
  -F client_id=248376 \
  -F client_secret=<TON_STRAVA_CLIENT_SECRET> \
  -F callback_url=https://gfavgstyyaaidkpadkxz.supabase.co/functions/v1/strava-webhook \
  -F verify_token=f3b8a2c1d9e4f7a6b5c8d3e2f1a4b7c8
```

Strava va alors :
1. Faire un `GET` sur ton callback URL avec `hub.challenge=XXX&hub.verify_token=YYY`
2. Si ton edge function répond `{"hub.challenge":"XXX"}` (ce qu'elle fait), l'abonnement est créé
3. Strava te renvoie `{"id": <subscription_id>}` → note le `id`

### 5. Vérifier que l'abonnement existe

```bash
curl "https://www.strava.com/api/v3/push_subscriptions?client_id=248376&client_secret=<TON_SECRET>"
```

Tu dois voir ton abonnement avec son id et le callback_url.

### 6. Tester

Fais une petite activité Strava (ou édite une existante depuis l'app Strava). Tu devrais voir :

- Dans les logs Supabase (Dashboard → Edge Functions → strava-webhook → Logs) un message `[webhook] event: {...}`
- Dans la table `activities` Supabase, la nouvelle ligne (ou la mise à jour)
- Dans Coach IA, après un refresh, l'activité apparaît avec son TSS

## Désabonnement (si besoin)

```bash
# Remplace <SUB_ID> par l'id retourné à l'étape 4
curl -X DELETE \
  "https://www.strava.com/api/v3/push_subscriptions/<SUB_ID>?client_id=248376&client_secret=<TON_SECRET>"
```

## Limitations Strava

- **1 seul abonnement actif par client_id Strava.** Si tu re-crées, il faut d'abord supprimer l'ancien.
- L'URL callback doit être **HTTPS** (Supabase l'est par défaut).
- Strava attend une réponse en **< 2s** sinon il retente. L'Edge Function répond immédiatement et fait le boulot en arrière-plan via `EdgeRuntime.waitUntil`.
- Les events sont envoyés **pour TOUS les utilisateurs** ayant autorisé ton app — d'où le lookup par `strava_athlete_id` au début du handler.

## Que se passe-t-il pour chaque event ?

| object_type | aspect_type | updates.authorized | Action |
|---|---|---|---|
| activity | create | — | Fetch activité → insert → recompute daily_metrics depuis ce jour |
| activity | update | — | Fetch activité → upsert → recompute (au cas où TSS change) |
| activity | delete | — | Delete activité → recompute |
| athlete | update | "false" | Désauthorisation : delete strava_connections |

Le recompute de daily_metrics part de la date de l'activité et avance jusqu'à aujourd'hui, en seed-ant CTL/ATL avec la valeur de la veille (donc rapide et correct).
