# Coach IA — Modèle de données (cible « niveau Nolio »)

Ce document décrit le modèle de données complet pour faire évoluer Coach IA
d'un dashboard mono-utilisateur vers une plateforme coach ↔ athlètes, façon
Nolio. Il part de l'existant (Supabase) et ajoute les briques manquantes.

## Principe directeur

Aujourd'hui chaque table est rattachée à `user_id` (→ `auth.users`). C'est un
modèle **mono-utilisateur** : un compte = ses propres données.

Pour le multi-utilisateur, on introduit un pivot : **`coach_athlete`**. Presque
toutes les données « appartiennent » à un athlète, et un coach y accède via ce
lien. Concrètement, on ne raisonne plus en `user_id` (le propriétaire du compte)
mais en `athlete_id` (de qui sont les données) — un coach pouvant lire/écrire
celles de plusieurs athlètes selon les permissions (Row Level Security).

---

## ① Identité & rôles

### profiles (nouveau)
Prolonge `auth.users` avec les infos applicatives.

| colonne | type | rôle |
|---|---|---|
| id | uuid (PK, = auth.users.id) | identité |
| role | text | `athlete` \| `coach` \| `both` |
| display_name | text | nom affiché |
| avatar_url | text | photo |
| locale | text | langue (`fr`) |
| created_at | timestamptz | |

### coach_athlete (nouveau — pivot central)
Relie un coach à ses athlètes (relation plusieurs-à-plusieurs).

| colonne | type | rôle |
|---|---|---|
| id | uuid (PK) | |
| coach_id | uuid → profiles.id | le coach |
| athlete_id | uuid → profiles.id | l'athlète |
| status | text | `pending` \| `active` \| `revoked` |
| invited_at / accepted_at | timestamptz | suivi de l'invitation |

> Un athlète sans coach a simplement une ligne où coach_id = athlete_id (il est
> son propre coach), ce qui garde une logique uniforme.

### user_profiles (EXISTANT — c'est la table de réglages)
> Décision (16/06/2026) : l'app a déjà `user_profiles`, plus riche qu'une table
> dédiée. On la **garde** comme table de réglages physiologiques plutôt que de
> créer un doublon `athlete_settings` (cette dernière, créée par erreur, a été
> supprimée par la migration `2026-06-16b`).

Colonnes directes : `ftp`, `hr_max`, `lthr`, `weight`, `display_name`,
`app_mode`. Tout le reste (FC repos `x_rhr`, VMA, allures, VO2max, date de
naissance, équipement…) est dans la colonne JSONB `extras`. Clé : `user_id`
(→ auth.users). Édité via `js/profile-modal.js` (upsert), lu dans
`window.DASHBOARD_DATA.athlete`. Les zones sont **recalculées à l'affichage**
(jamais stockées) depuis FTP/LTHR.

RLS : l'athlète gère ses lignes (`auth.uid() = user_id`) ; depuis l'étape 4, le
coach lié et actif peut les **lire** (`is_coach_of(user_id)`), sans écrire.

---

## ② Entraînement (déjà en place)

Tables existantes, à faire évoluer pour pointer vers `athlete_id` au lieu de
(ou en plus de) `user_id` :

- **activities** — séances réalisées (Strava + manuelles), avec `streams_gz`,
  `power_curve`, `tss`, `source`, `category`, `priority`, `target`.
- **activity_planned** — séances prévues (dont `created_by_ia`).
- **activity_template** — bibliothèque de séances réutilisables.
- **rest_day** — jours de repos.
- **training_phases** — périodisation (build, peak, taper…).
- **competitions** — objectifs avec priorité, GPX, temps cible.
- **day_notes** — annotations libres par jour.

---

## ③ Mesures & charge (déjà en place)

- **daily_metrics** — CTL / ATL / TSB calculés par jour.
- **power_profile** / **power_profile_sport** — records de puissance (MMP).
- **whoop_data** — récupération, HRV, sommeil, strain.

---

## ④ Ressenti (nouveau — le « subjectif », clé chez Nolio)

### wellness_checkin (nouveau)
Questionnaire quotidien rempli par l'athlète.

| colonne | type | rôle |
|---|---|---|
| athlete_id | uuid → profiles.id | |
| date | date | |
| sleep_quality | int (1-5) | qualité de sommeil ressentie |
| fatigue / stress / soreness / mood | int (1-5) | ressentis |
| motivation | int (1-5) | |
| comment | text | |

### session_feedback (nouveau)
Ressenti rattaché à **une séance réalisée**.

| colonne | type | rôle |
|---|---|---|
| activity_id | uuid → activities.id | |
| rpe | int (1-10) | effort perçu (Borg) |
| feeling | int (1-5) | sensation |
| comment | text | retour de l'athlète |

> Croiser RPE (interne) et TSS (externe) est exactement le genre d'analyse qui
> distingue un vrai outil de coaching d'un simple tracker.

---

## ⑤ Collaboration (nouveau)

### messages (nouveau)
Fil de discussion coach ↔ athlète, et commentaires sur une séance.

| colonne | type | rôle |
|---|---|---|
| id | uuid (PK) | |
| athlete_id | uuid → profiles.id | de quel athlète relève le fil |
| author_id | uuid → profiles.id | coach ou athlète |
| activity_id | uuid → activities.id (nullable) | si commentaire de séance |
| body | text | |
| created_at | timestamptz | |
| read_at | timestamptz | |

### notifications (nouveau)
Alertes : nouvelle séance assignée, message reçu, surcharge détectée…

| colonne | type | rôle |
|---|---|---|
| recipient_id | uuid → profiles.id | |
| kind | text | type d'alerte |
| payload | jsonb | données contextuelles |
| read_at | timestamptz | |

---

## ⑥ Intégrations

- **strava_connections** / **whoop_connections** — OAuth (existant).
- **integrations** (nouveau) — table générique pour ajouter Garmin, Apple
  Health, Coros… sans recréer une table par service :
  `athlete_id, provider, access_token, refresh_token, expires_at, scope`.
- **webhook_events** (nouveau) — journal des notifications entrantes des
  services (ex : Garmin signale une nouvelle activité → import auto) :
  `provider, external_id, payload jsonb, processed_at`.

---

## Sécurité (Row Level Security)

Le multi-utilisateur impose des règles d'accès strictes côté base :

- un **athlète** lit/écrit uniquement ses propres lignes (`athlete_id = auth.uid()`) ;
- un **coach** accède aux lignes d'un athlète **s'il existe** une ligne
  `coach_athlete(coach_id = auth.uid(), athlete_id = X, status = 'active')`.

C'est le point le plus sensible : une règle RLS oubliée = fuite de données
entre athlètes. À tester méthodiquement.

---

## Chemin de migration recommandé (incrémental, sans tout casser)

1. **Créer `profiles`** et le remplir depuis `auth.users` (1 ligne par compte
   existant, role = `both`).
2. **Créer `coach_athlete`** et y insérer, pour chaque utilisateur actuel, une
   ligne où coach_id = athlete_id (chacun reste son propre coach → rien ne change
   pour toi aujourd'hui).
3. **Ajouter `athlete_id`** sur les tables de données, le remplir = `user_id`,
   puis mettre à jour les politiques RLS pour raisonner sur `coach_athlete`.
4. **Sortir les réglages** (FTP, FC, poids) vers `athlete_settings`.
5. **Ajouter le ressenti** (`wellness_checkin`, `session_feedback`) — gros gain
   fonctionnel pour un faible coût.
6. **Collaboration** (`messages`, `notifications`) quand un vrai 2ᵉ utilisateur
   (coach ou athlète testeur) entre en jeu.
7. **Intégrations génériques + webhooks** en dernier (le plus technique).

Les étapes 1-3 sont invisibles pour l'utilisateur actuel : elles préparent le
terrain sans rien changer à ton usage solo. C'est seulement à partir de
l'étape 5 que de nouvelles fonctionnalités apparaissent.
