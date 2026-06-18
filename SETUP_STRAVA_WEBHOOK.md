# Synchro Strava automatique (webhook) — comme Nolio

Objectif : dès que tu postes une activité sur Strava, elle remonte toute seule dans Coach IA
(plus besoin de cliquer « Re-synchroniser »). La fonction `supabase/functions/strava-webhook`
est déjà écrite : elle reçoit l'event Strava, fetch l'activité, l'insère et recalcule tes
métriques (création / modification / suppression).

Il reste 3 étapes (à faire **une seule fois**).

Valeurs de ton projet :
- `client_id` Strava : **248376**
- URL callback : **https://gfavgstyyaaidkpadkxz.supabase.co/functions/v1/strava-webhook**

---

## 1. Choisir un jeton secret (verify token)

Une chaîne aléatoire de ton choix, par ex. : `coachia-2f9a1c7e4b` (mets la tienne).

## 2. Poser le secret + déployer la fonction

Dans le dossier du projet :

```bash
supabase secrets set STRAVA_WEBHOOK_VERIFY_TOKEN=coachia-2f9a1c7e4b
supabase functions deploy strava-webhook --no-verify-jwt
```

> Le `--no-verify-jwt` est **obligatoire** (Strava appelle sans header d'auth).

## 3. Créer l'abonnement Strava (une fois)

Récupère ton `client_secret` Strava sur https://www.strava.com/settings/api, puis :

```bash
curl -X POST https://www.strava.com/api/v3/push_subscriptions \
  -F client_id=248376 \
  -F client_secret=TON_CLIENT_SECRET \
  -F callback_url=https://gfavgstyyaaidkpadkxz.supabase.co/functions/v1/strava-webhook \
  -F verify_token=coachia-2f9a1c7e4b
```

Strava va appeler ta fonction en GET pour valider (elle renvoie le challenge automatiquement),
puis l'abonnement devient actif. Réponse attendue : `{"id": 123456}`.

### Vérifier que l'abonnement existe

```bash
curl -G https://www.strava.com/api/v3/push_subscriptions \
  -d client_id=248376 -d client_secret=TON_CLIENT_SECRET
```

### Le supprimer si besoin (un seul abonnement autorisé par client_id)

```bash
curl -X DELETE "https://www.strava.com/api/v3/push_subscriptions/ID_ABONNEMENT?client_id=248376&client_secret=TON_CLIENT_SECRET"
```

---

## Notes

- **Un seul abonnement actif par `client_id`.** Si la création renvoie une erreur « already exists »,
  liste-le (commande ci-dessus) et soit tu le réutilises, soit tu le supprimes puis recrées.
- L'activité arrive dans la base Supabase en quelques secondes. Si l'app est **déjà ouverte**,
  recharge-la pour la voir (à l'ouverture suivante elle est là sans rien faire).
- Pré-requis : ta connexion Strava doit avoir son `external_id` (= ton athlete id Strava) renseigné
  dans `connexions_app` — c'est posé automatiquement par le callback OAuth lors de la connexion Strava.
  Si la sync auto ne marche pas, reconnecte Strava une fois (Connexions → Déconnecter → Connecter).
- Secrets requis sur la fonction : `STRAVA_CLIENT_ID`, `STRAVA_CLIENT_SECRET` (déjà posés pour l'ingest),
  `STRAVA_WEBHOOK_VERIFY_TOKEN` (étape 2). `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` sont injectés auto.
