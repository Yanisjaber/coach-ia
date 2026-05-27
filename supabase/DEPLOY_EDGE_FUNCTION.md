# Déploiement de l'Edge Function Strava OAuth

10 étapes (20 min). Tu fais ça **une seule fois**, ensuite l'Edge Function tourne sur l'infra Supabase 24/7.

## 1. Installer la Supabase CLI

```bash
brew install supabase/tap/supabase
```

Vérif : `supabase --version` doit afficher `1.x.x` ou plus.

## 2. Se logger

```bash
cd ~/Documents/coach-ia
supabase login
```

Ça ouvre un navigateur, autorise.

## 3. Lier le projet local au projet cloud

```bash
supabase link --project-ref gfavgstyyaaidkpadkxz
```

Te demande le DB password (celui défini dans Supabase Settings → Database). Si tu l'as oublié, reset-le et retape.

## 4. Définir les secrets de la function

```bash
supabase secrets set STRAVA_CLIENT_ID=248376
supabase secrets set STRAVA_CLIENT_SECRET=<TON_STRAVA_CLIENT_SECRET>
supabase secrets set APP_REDIRECT_URL=http://localhost:8000/dashboard.html
```

> Le `STRAVA_CLIENT_SECRET` est dans ton `.env` local (variable `STRAVA_CLIENT_SECRET`). NE JAMAIS le commit. Si tu l'as accidentellement exposé, va sur https://www.strava.com/settings/api et clique "Reset Client Secret".

**Note** : Pour le `APP_REDIRECT_URL` :
- En local : `http://localhost:8000/dashboard.html`
- En prod : `https://yanisjaber.github.io/coach-ia/` (ou ton domaine custom)
- Tu peux changer plus tard avec la même commande.

Vérif : `supabase secrets list` doit montrer les 3 secrets.

## 5. Déployer l'Edge Function

```bash
supabase functions deploy strava-oauth-callback --no-verify-jwt
```

Le flag `--no-verify-jwt` est important : on vérifie le JWT manuellement dans le code (avec le `state`), pas via l'auth header standard.

Tu verras : `Deployed Function strava-oauth-callback...`

## 6. Tester que l'Edge Function répond

```bash
curl -i 'https://gfavgstyyaaidkpadkxz.supabase.co/functions/v1/strava-oauth-callback'
```

Doit te rediriger (HTTP 302) vers `?strava_error=missing_code_or_state`. C'est normal — tu n'as pas fourni de code.

## 7. Ajouter l'URL de callback dans l'app Strava

Va sur https://www.strava.com/settings/api

Dans **Authorization Callback Domain**, mets :
```
gfavgstyyaaidkpadkxz.supabase.co
```

(juste le domaine, sans https:// ni path). Save.

## 8. Tester le flow OAuth complet

1. Recharge `localhost:8000/dashboard.html`
2. Si tu es déjà connecté avec ton compte (qui a tes données) → tu ne verras PAS la bannière onboarding (tes données existent)
3. Pour tester en tant que "nouveau user", crée un compte test :
   - Supabase → Authentication → Users → Add user → email/password test
   - Déconnecte ton compte (bouton logout) → reconnecte avec le compte test
   - Tu vois la bannière bleue avec bouton **"Connecter Strava"**
4. Clique sur **Connecter Strava** → tu es redirigé vers Strava → autorise
5. Strava te redirige vers l'Edge Function qui :
   - Échange ton code contre les tokens
   - Stocke dans `strava_connections`
   - Te redirige vers `localhost:8000/dashboard.html?strava_connected=1`
6. Tu vois un toast vert "Strava connecté avec succès"

## 9. Vérification dans pgAdmin

```sql
SELECT * FROM strava_connections WHERE user_id = '<UUID-DU-COMPTE-TEST>';
```

Tu dois voir la ligne avec les tokens.

## 10. Limites actuelles (à savoir)

- Pour l'instant, **on stocke seulement les tokens**, on ne récupère PAS encore les activités automatiquement. La Phase C (pipeline d'ingestion) viendra dans une deuxième Edge Function `strava-ingest` qui fetch les activités et les insère dans la table `activities`.
- Le `APP_REDIRECT_URL` est un seul URL. Si tu veux qu'il marche pour LOCALHOST ET pour le DOMAINE en même temps, il faudra adapter (par exemple : déduire l'URL depuis le `Origin` header).

## Mettre à jour la function après modif

Si tu modifies `supabase/functions/strava-oauth-callback/index.ts`, redéploie :

```bash
supabase functions deploy strava-oauth-callback --no-verify-jwt
```

## Logs de la function (debug)

```bash
supabase functions logs strava-oauth-callback
```

Affiche les logs `console.log()` / `console.error()` en temps réel.

## Désactiver la function

```bash
supabase functions delete strava-oauth-callback
```
