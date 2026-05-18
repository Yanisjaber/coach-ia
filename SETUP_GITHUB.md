# Coach IA — Mise en ligne sur GitHub Pages + domaine OVH

Guide pas à pas pour passer du dashboard local au dashboard 24/7 accessible depuis n'importe quel device via ton propre domaine.

## Architecture cible

```
[Whoop API]         [GitHub Actions]        [GitHub Pages]       [Ton domaine OVH]
[intervals.icu]  →  fetch_data.py     →    dashboard.html   →    coachia.fr
                    (toutes les 15 min)     + data.js
```

## Étape 1 — Créer le repo GitHub privé

1. Va sur https://github.com/new
2. Repository name : `coach-ia` (ou autre, à toi)
3. **IMPORTANT : coche "Private"** (le repo contient tes tokens API)
4. NE PAS cocher "Add a README" (on a déjà des fichiers à pousser)
5. Clique "Create repository"

GitHub t'affiche une page avec des commandes. Garde-la ouverte, on l'utilisera dans une minute.

## Étape 2 — Ajouter les secrets

Dans ton nouveau repo :

1. **Settings** (onglet en haut à droite du repo)
2. Menu de gauche : **Secrets and variables** → **Actions**
3. Clique **"New repository secret"** et ajoute les 4 secrets suivants un par un :

| Name | Value |
|---|---|
| `INTERVALS_ATHLETE_ID` | `i115086` |
| `INTERVALS_API_KEY` | `4r97pewlipxiqblvgzbc62l2o` |
| `WHOOP_CLIENT_ID` | `7e159226-403f-41a2-8dc6-10f06c81671e` |
| `WHOOP_CLIENT_SECRET` | `c2bfa911a9d375d353318fb579afda16db4cd76b50b3be07eb8dfc47e81c698f` |

## Étape 3 — Pousser le code

Ouvre PowerShell dans le dossier Coach IA :

```powershell
cd "$env:USERPROFILE\Documents\Claude\Projects\Coach IA"

# Init Git
git init
git branch -M main
git add .
git commit -m "Initial commit"

# Lier au repo GitHub (remplace TON-USERNAME et coach-ia par tes valeurs)
git remote add origin https://github.com/TON-USERNAME/coach-ia.git

# Pousser
git push -u origin main
```

Si Git te demande des identifiants, utilise ton username GitHub + un **personal access token** (pas ton mot de passe). Créer un token : https://github.com/settings/tokens → Generate new token (classic) → coche "repo" → Generate.

## Étape 4 — Activer GitHub Pages

Dans le repo GitHub :

1. **Settings** → **Pages** (menu de gauche)
2. **Source** : `Deploy from a branch`
3. **Branch** : `main` / `/ (root)` → Save
4. Patiente 1-2 min, GitHub affiche l'URL : `https://TON-USERNAME.github.io/coach-ia/dashboard.html`

Visite l'URL → ton dashboard devrait s'afficher.

## Étape 5 — Vérifier que le cron tourne

1. Onglet **Actions** du repo
2. Tu verras le workflow "Update Coach IA data"
3. Clique sur **"Run workflow"** (manuel) pour lancer immédiatement, sinon le prochain run automatique est dans les 15 min
4. Patiente 30 sec, le workflow doit passer ✅ vert. Sinon clique dessus pour voir le log

Une fois validé, tu peux désactiver la tâche Windows locale (Planificateur de tâches → clic droit sur "Coach IA - Update" → Désactiver). GitHub prend le relais.

## Étape 6 — Brancher ton domaine OVH

Dans le **manager OVH** :

1. **Web Cloud** → **Noms de domaine** → ton domaine
2. Onglet **Zone DNS** → **Ajouter une entrée**
3. Crée ces entrées (remplace `TON-USERNAME` par ton username GitHub) :

| Type | Sous-domaine | Cible |
|---|---|---|
| CNAME | `www` | `TON-USERNAME.github.io.` |
| A | `@` (racine) | `185.199.108.153` |
| A | `@` (racine) | `185.199.109.153` |
| A | `@` (racine) | `185.199.110.153` |
| A | `@` (racine) | `185.199.111.153` |

(Les 4 IPs A sont celles de GitHub Pages, officielles et stables.)

4. Dans le repo GitHub : **Settings** → **Pages** → **Custom domain** → tape `coachia.fr` (ou ton domaine), Save.
5. Coche **"Enforce HTTPS"** (peut prendre 10 min à apparaître après propagation DNS).

La propagation DNS peut prendre 5 min à quelques heures. Une fois propagé, ton dashboard est sur `https://coachia.fr/dashboard.html`.

## Étape 7 — Bonus : page d'accueil par défaut

Pour que `https://coachia.fr/` (sans `/dashboard.html`) charge directement le dashboard, renomme `dashboard.html` en `index.html` côté repo (ou ajoute une redirection).

## Sécurité

- Le repo est **privé**, donc seul toi vois le code et les tokens
- `.env` est dans `.gitignore`, ne sera jamais commité
- Les secrets passent par GitHub Secrets (chiffrés, jamais visibles en clair dans les logs)
- L'URL `https://coachia.fr/dashboard.html` est techniquement publique (n'importe qui qui la trouve peut voir tes données). Si tu veux ajouter un mot de passe, dis-le moi, on rajoutera Cloudflare Access ou un .htaccess équivalent.

## Si le token Whoop expire

Le refresh_token Whoop dure longtemps (mois/années) tant que tu ne révoques pas l'app. Si un jour le refresh échoue (visible dans les logs GitHub Actions) :

1. Sur ton PC : `python whoop_auth.py` → ré-autorise
2. Commit et push le nouveau `.whoop_tokens.json` :
   ```
   git add .whoop_tokens.json
   git commit -m "Refresh Whoop tokens"
   git push
   ```
