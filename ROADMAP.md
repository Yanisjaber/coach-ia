# Coach IA — Roadmap technique

Document de cadrage post-prototype. Définit les étapes pour passer du `dashboard.html` (données simulées) à une application Python connectée aux APIs réelles.

---

## Phase 0 — Prototype (terminé)

Validation visuelle des 4 axes analytiques sur `dashboard.html` avec données simulées. Sert de cahier des charges visuel pour la suite.

---

## Phase 1 — Connexion intervals.icu (1-2 jours)

**Objectif** : remplacer les données simulées d'entraînement par des données réelles.

Stack proposée :

- `httpx` pour les appels API
- `pandas` pour la manipulation des séries temporelles
- `pydantic` pour le typage des modèles (Activity, Wellness, Event)

Endpoints intervals.icu utiles :

- `GET /api/v1/athlete/{id}/activities` — séances réalisées (TSS, NP, FC, durée, fichier .fit)
- `GET /api/v1/athlete/{id}/events` — séances planifiées
- `GET /api/v1/athlete/{id}/wellness` — CTL, ATL, TSB calculés par intervals.icu
- `GET /api/v1/activity/{id}/streams` — flux haute résolution (puissance, FC, cadence, GPS)

Auth : Basic Auth avec `API_KEY:` (user_id = "API_KEY", password = clé API).

Livrable : module `coach_ia/sources/intervals.py` qui expose `fetch_activities(date_from, date_to)`, `fetch_wellness()`, `fetch_planned_events()`.

---

## Phase 2 — Backend Python + dashboard (3-5 jours)

**Objectif** : servir le dashboard depuis un backend Python avec données live.

Architecture :

```
coach_ia/
├── main.py              # FastAPI app
├── sources/
│   ├── intervals.py     # client intervals.icu
│   └── whoop.py         # client Whoop (stub en attendant accès)
├── domain/
│   ├── models.py        # Activity, Wellness, RecoveryDay, Session
│   ├── metrics.py       # calculs CTL/ATL/TSB, corrélations
│   └── insights.py      # détection patterns (surentraînement, alertes)
├── agent/
│   ├── coach.py         # logique d'adaptation des séances
│   └── prompts.py       # templates LLM pour recommandations
├── storage/
│   └── cache.py         # SQLite pour cache local + historique
└── web/
    └── static/          # dashboard.html (servi tel quel au début)
```

Choix techniques :

- **FastAPI** : endpoints JSON consommés par le HTML existant (`/api/today`, `/api/load-recovery`, `/api/sessions`, `/api/plan`)
- **SQLite** : cache local pour éviter de retaper les APIs à chaque refresh
- **APScheduler** ou tâche planifiée Cowork : sync nocturne des données

---

## Phase 3 — Intégration Whoop (1-2 jours, dépend de l'accès dev)

Pré-requis utilisateur : créer un compte développeur sur https://developer.whoop.com/ et obtenir un client_id/secret OAuth2.

Endpoints utiles :

- `GET /developer/v1/recovery` — score de récupération quotidien
- `GET /developer/v1/cycle` — cycle physiologique (strain, sommeil)
- `GET /developer/v1/sleep` — détail nuits

Livrable : `coach_ia/sources/whoop.py` symétrique au client intervals.icu.

---

## Phase 4 — Agent IA (3-5 jours)

**Objectif** : transformer les règles statiques du prototype (Coach IA pill) en agent capable de raisonner et de proposer des adaptations contextualisées.

Deux approches combinables :

1. **Règles déterministes** (déjà en place dans le prototype) : décisions claires, traçables, expliquables. Bonne base de référence.
2. **LLM (Claude API)** : enrichit les recommandations en langage naturel, gère les cas ambigus, peut justifier ses propositions en référence à l'historique. Appelé via prompt structuré incluant : état du jour, 14 derniers jours d'historique, séances planifiées, objectif de l'athlète.

Pattern recommandé : règles d'abord, LLM en surcouche pour la formulation et les arbitrages complexes.

**Capacités de modification** :

- Lire un plan depuis intervals.icu Events
- Proposer une version adaptée
- Pousser la modification vers intervals.icu (`POST /api/v1/athlete/{id}/events`) après validation utilisateur

---

## Phase 5 — Frontend évolution (1-2 semaines)

Options ordonnées par effort :

1. **Garder le HTML actuel + backend FastAPI** : itération rapide, suffisant pour un usage personnel.
2. **Migrer vers Streamlit** : si on veut multiplier rapidement les vues d'exploration.
3. **Réécrire en React/Vue + composants riches** : pour un produit destiné à plusieurs utilisateurs.

Recommandation : rester sur l'option 1 jusqu'à validation des cas d'usage.

---

## Sécurité & déploiement

- Stocker les credentials API dans variables d'environnement ou `.env` (jamais en dur)
- HTTPS obligatoire si déployé hors localhost
- Webhook intervals.icu pour mise à jour temps réel (optionnel)
- Hébergement initial : local Docker, puis Fly.io / Railway si besoin d'accès distant

---

## Prochaine action concrète

Ouvrir `dashboard.html`, parcourir les 4 onglets, identifier les écarts entre la vision et le prototype, puis on attaque la Phase 1 (connexion intervals.icu réelle) pour remplacer la moitié des données simulées par du vrai.
