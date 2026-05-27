# Setup Supabase pour Coach IA

5 étapes (15 min max). Pendant ce temps je code le reste.

## 1. Créer le projet Supabase

1. Va sur https://supabase.com et crée un compte (Github / Google / email)
2. Clique **New Project**
3. Remplis :
   - **Name** : `coach-ia`
   - **Database password** : génère-le et **garde-le** quelque part en sécurité (tu en auras besoin si tu veux te connecter à la DB directement plus tard)
   - **Region** : `Europe West (Frankfurt)` ou `Europe West (London)` (le plus proche de toi)
   - **Pricing plan** : Free
4. Clique **Create new project** — patiente 1-2 min, le temps que le projet provisioning

## 2. Exécuter le schema SQL

1. Dans le menu de gauche, clique **SQL Editor**
2. Clique **+ New query**
3. Ouvre le fichier `supabase/schema.sql` de ton projet local (créé par moi), copie tout son contenu
4. Colle dans l'éditeur Supabase
5. Clique **Run** (en bas à droite, ou Cmd+Enter)
6. Tu dois voir `Success. No rows returned.`
7. Vérifie : dans le menu de gauche → **Database** → **Tables**. Tu dois voir 11 tables : `user_profiles`, `competitions`, `trainings`, `wellness_days`, `day_notes`, `training_phases`, `yearly_goals`, `plan_snapshots`, `template_rest_days`, `strava_ignored`, `preferences`.

## 3. Configurer l'authentification

1. Menu de gauche : **Authentication** → **Providers**
2. **Email** est activé par défaut — c'est OK
3. **IMPORTANT** : descends jusqu'à "Confirm email" et décoche-le (pour ne pas avoir à confirmer ton email à chaque création de compte test). Tu pourras le réactiver plus tard si tu mets l'app en prod multi-user.
4. Sauvegarder

## 4. Récupérer les clés d'API

1. Menu de gauche : **Project Settings** (l'icône engrenage tout en bas)
2. Section **API**
3. Note 2 valeurs :
   - **Project URL** (format `https://xxxxxxxxxxxx.supabase.co`)
   - **anon public key** (longue chaîne `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...`) — c'est la clé publique, OK de l'exposer dans le frontend
4. **NE COPIE JAMAIS** la `service_role` key dans le frontend (elle bypass RLS !)

## 5. Donner les clés à l'app

Crée un fichier `supabase-config.js` à la racine de ton projet (à côté de `dashboard.html`) avec ce contenu :

```javascript
// supabase-config.js — Configuration Supabase (clé publique, OK exposée)
window.SUPABASE_CONFIG = {
  url: 'https://XXXXXXXXXXXX.supabase.co',
  anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.XXXXXXXXXXXX...',
};
```

Remplace `XXX` par tes vraies valeurs.

**Important** : ce fichier sera commit dans Git puisque la `anon key` est publique (et protégée par RLS côté Supabase). Pas besoin de le mettre dans `.gitignore`.

## 6. Créer ton compte utilisateur

Deux options :

**Option A** — depuis l'app (le plus simple, après le redéploiement)
- Recharge l'app
- Une modal de connexion s'affichera
- Clique "Créer un compte", entre ton email + mot de passe
- Tu es connecté

**Option B** — depuis Supabase Dashboard
- Menu de gauche : **Authentication** → **Users**
- Clique **Invite user** ou **Add user → Create new user**
- Email + mot de passe
- Auto Confirm User : ON

## 7. Vérifier que ça marche

Une fois l'app rechargée et que tu es connecté :
- Va saisir une wellness, une compétition, un objectif
- Va dans Supabase Dashboard → **Table Editor** → choisis `wellness_days` (ou la table concernée)
- Tu dois voir ta ligne avec ton `user_id`

C'est bon, multi-device est désormais actif. Connecte-toi sur ton iPhone avec le même email/mot de passe, tu verras les mêmes données.

---

## Limites du tier gratuit

- 500 Mo de DB (largement suffisant pour 1-10 utilisateurs)
- 5 Go de bande passante / mois
- 50 000 utilisateurs auth max
- 2 projets max par compte gratuit
- Le projet est mis en pause après 7 jours d'inactivité (mais re-active automatiquement quand tu reviens)

## Sécurité

- La `anon key` est publique et c'est OK. Toute la sécurité passe par les politiques RLS qu'on a créées dans `schema.sql`.
- Chaque utilisateur ne voit QUE ses propres données grâce à `auth.uid() = user_id`.
- Si tu veux ajouter d'autres users (un coach par exemple), il pourra avoir son propre compte avec ses propres données isolées.
