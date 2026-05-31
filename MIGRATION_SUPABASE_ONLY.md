# Migration « Supabase-only » — guide de déploiement

Objectif : supprimer le circuit Python statique (`fetch_data.py` → `data.js`/`streams.js`)
et tout faire passer par Supabase, avec un modèle sécurisé (tokens jamais exposés au navigateur).

Ce qui a été codé dans cette session :

| Domaine | Fichier(s) | Rôle |
|---|---|---|
| Sécurité + colonnes | `supabase/migrations/2026-06-01_supabase_only.sql` | masque les tokens, ajoute `streams_gz` / `power_curve` |
| Power profile + streams | `supabase/functions/strava-streams/index.ts` | récupère les streams Strava, les stocke compressés, calcule le power profile |
| Whoop OAuth | `supabase/functions/whoop-oauth-callback/index.ts` | échange le code, stocke les tokens Whoop |
| Whoop ingestion | `supabase/functions/whoop-ingest/index.ts` | remplit `whoop_data` (recovery/sommeil/strain réels) |
| Client Whoop | `js/whoop-oauth.js`, `whoop-config.js` | bouton « Connecter Whoop » + import |
| Bascule client | `js/data-loader.js`, `js/supabase-data-loader.js`, `js/strava-oauth.js`, `js/app.js`, `index.html`, `dashboard.html` | lecture 100 % Supabase, streams à la demande, plus de `data.js`/`streams.js` |

L'ordre ci-dessous est important. Tout se fait depuis ton Mac (CLI Supabase).

---

## 1. Appliquer la migration SQL

Supabase Dashboard → **SQL Editor** → colle le contenu de
`supabase/migrations/2026-06-01_supabase_only.sql` → **Run**.

La migration est idempotente (relançable). Elle :
- ajoute `activities.streams_gz`, `activities.streams_synced_at`, `activities.power_curve` ;
- **révoque** l'accès aux colonnes `access_token` / `refresh_token` pour le rôle `authenticated`
  (le navigateur ne peut donc plus jamais lire les tokens) ;
- garantit la RLS « own rows » sur les tables Whoop.

Vérifie ensuite (lecture seule) que les tokens sont bien masqués :

```sql
select column_name from information_schema.column_privileges
where table_name='strava_connections' and grantee='authenticated';
-- access_token / refresh_token NE DOIVENT PAS apparaître.
```

---

## 2. Définir les secrets des Edge Functions

```bash
supabase secrets set WHOOP_CLIENT_ID=7e159226-403f-41a2-8dc6-10f06c81671e
supabase secrets set WHOOP_CLIENT_SECRET=<ton_client_secret_whoop>
supabase secrets set WHOOP_REDIRECT_URI=https://gfavgstyyaaidkpadkxz.supabase.co/functions/v1/whoop-oauth-callback
# Déjà définis pour Strava (vérifier) :
#   STRAVA_CLIENT_ID, STRAVA_CLIENT_SECRET, APP_REDIRECT_URL
# Fournis automatiquement par Supabase :
#   SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
```

> `WHOOP_REDIRECT_URI` doit être **strictement identique** à `redirect_uri` dans `whoop-config.js`
> et à l'URL déclarée dans le portail Whoop (étape 4).

---

## 3. Déployer les Edge Functions

```bash
supabase functions deploy strava-streams
supabase functions deploy whoop-ingest
supabase functions deploy whoop-oauth-callback --no-verify-jwt
```

`--no-verify-jwt` sur le callback Whoop car le JWT est vérifié **manuellement** via le `state`
(Whoop appelle l'URL sans header Authorization), exactement comme `strava-oauth-callback`.

---

## 4. Portail développeur Whoop

Dans ton app Whoop (developer dashboard) :
- **Redirect URIs** : ajoute `https://gfavgstyyaaidkpadkxz.supabase.co/functions/v1/whoop-oauth-callback`
- **Scopes** : `read:recovery`, `read:cycles`, `read:sleep`, `read:profile`, `read:body_measurement`, `read:workout`, `offline`

---

## 5. Vérifier `whoop-config.js`

Déjà créé à la racine. Vérifie que `client_id` correspond à ton app Whoop et que
`redirect_uri` est l'URL de l'edge function. (Le `client_secret` n'y est **jamais** — il reste dans les secrets.)

---

## 6. Premier remplissage des données

Ouvre l'app (connecté à ton compte Coach IA) :

1. **Strava** → bouton « Connecter Strava » (bannière). L'import des activités se lance,
   puis le **backfill des streams + power profile** démarre automatiquement en arrière-plan.
   - ⚠️ Strava limite à ~100 requêtes / 15 min. Pour 2680 activités, le backfill se fait par
     vagues : quand la limite est atteinte, ça s'arrête et **reprend tout seul** au prochain
     chargement de l'app (ou via la console : `startStravaStreams()`).
   - Tu peux suivre l'avancement : `power_profile` se remplit au fur et à mesure.
2. **Whoop** → bouton « Connecter Whoop ». L'import (`whoop-ingest`) remplit `whoop_data`
   avec les vraies données (fini le simulé).

Pour forcer un recalcul du power profile sans re-télécharger les streams :

```js
// console navigateur
fetch(`${SUPABASE_CONFIG.url}/functions/v1/strava-streams`, {
  method:'POST',
  headers:{ Authorization:`Bearer ${(await sb.auth.getSession()).data.session.access_token}`,
            'Content-Type':'application/json' },
  body: JSON.stringify({ recompute_only: true })
}).then(r=>r.json()).then(console.log);
```

---

## 7. Nettoyage du circuit legacy (après validation)

Une fois que tout fonctionne en Supabase-only, ces fichiers ne servent plus :

```bash
git rm fetch_data.py serve.py strava.py whoop.py whoop_auth.py strava_auth.py \
       power_profile.py power_profile_cache.json migrate_to_supabase.py \
       data.js data.json streams.js \
       update_data.bat update_silent.vbs

# SÉCURITÉ : sortir les tokens du repo et les ignorer désormais
git rm --cached .strava_tokens.json .whoop_tokens.json
printf '\n.strava_tokens.json\n.whoop_tokens.json\n' >> .gitignore

git commit -m "Migration Supabase-only : suppression du circuit Python statique + sécurisation tokens"
```

> Les tokens Strava/Whoop encore présents dans l'historique git restent compromis :
> pense à les **révoquer/régénérer** côté portails Strava et Whoop après la bascule.
> Désormais les tokens ne vivent que dans Supabase et ne sont jamais servis au navigateur.

`index.html` / `dashboard.html` ne référencent déjà plus `data.js` / `streams.js`.
`js/data-loader.js` boote sur un dataset vide si `data.js` est absent — la suppression ne casse rien.

---

## 8. Checklist de validation

- [ ] Migration SQL passée sans erreur, tokens masqués (étape 1).
- [ ] 3 edge functions déployées.
- [ ] Connexion Strava → activités visibles, `power_profile` se remplit.
- [ ] `select count(*) from power_profile` > 0 après le backfill.
- [ ] Ouvrir une activité avec capteur de puissance → les graphes streams s'affichent
      (chargés à la demande depuis `streams_gz`).
- [ ] Connexion Whoop → `select count(*) from whoop_data where source='whoop'` > 0.
- [ ] Dans l'onglet réseau du navigateur, aucune requête ne renvoie `access_token`.
- [ ] App fonctionne après suppression de `data.js` / `streams.js`.

---

## Notes d'architecture

- **Streams** : stockés en `activities.streams_gz` = base64(gzip(JSON `[{type,data}]`)).
  Compression/décompression via `CompressionStream` (edge) et `DecompressionStream` (navigateur).
  Chargés **à la demande** par activité (jamais en masse) → léger.
- **Power profile** : `activities.power_curve` = MMP par activité ; `power_profile` = agrégat
  best alltime + best 90 j, recalculé à chaque passage de `strava-streams`.
- **Sécurité** : `access_token`/`refresh_token` lisibles uniquement par la `service_role`
  (edge functions). Le client lit des colonnes « safe » explicites.
