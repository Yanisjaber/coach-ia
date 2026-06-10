# Coach IA — App mobile (Capacitor)

L'app mobile est une coquille native (Capacitor) qui charge le site en ligne
`https://yanisjaber.github.io/coach-ia/`. Conséquence importante : **chaque
`git push` qui met à jour le site met à jour l'app instantanément**, sans
rebuilder ni réinstaller quoi que ce soit. On ne rebuild l'APK que si on touche
à la partie native (icône, config Capacitor, plugins).

## Android — obtenir et installer l'APK

1. Pousser le code sur GitHub (`git push`). Le workflow `Build APK Android`
   se lance automatiquement (ou manuellement : onglet **Actions** → *Build APK
   Android* → **Run workflow**).
2. Attendre ~5 min, ouvrir le run terminé, télécharger l'artifact
   **coach-ia-apk** (un zip contenant `app-debug.apk`).
3. Transférer l'APK sur le téléphone (mail, Drive, câble USB...), l'ouvrir,
   accepter « Installer des applications inconnues » quand Android le demande.
4. L'app « Coach IA » apparaît sur l'écran d'accueil.

C'est un APK *debug* : parfait pour un usage perso, aucun compte développeur
nécessaire. Pour publier sur le Play Store un jour, il faudra un APK signé
*release* + compte Google Play (25 $ une fois).

## iPhone

La compilation iOS exige un **Mac avec Xcode**. Le projet est prêt dans `ios/`.
Sur un Mac : `npm install && npx cap open ios`, brancher l'iPhone, sélectionner
son équipe de signature dans Xcode et appuyer sur Run.

- Compte Apple gratuit : installation possible mais l'app expire au bout de
  7 jours (à réinstaller).
- Compte Apple Developer (99 $/an) : installation 1 an ou publication App Store.

Sans Mac, l'alternative : ouvrir le site dans Safari → Partager → **Sur
l'écran d'accueil** (icône et plein écran, sans passer par l'App Store).

## Structure ajoutée au repo

- `capacitor.config.json` — config de l'app (id, nom, URL du site, couleurs)
- `android/`, `ios/` — projets natifs générés par Capacitor
- `www/` — page de secours affichée si pas de connexion internet
- `assets/` — icône et splash sources (générées depuis `coach_ia_logo.jpg`)
- `.github/workflows/build-apk.yml` — build automatique de l'APK
- `package.json` / `package-lock.json` — dépendances Capacitor

## Commandes utiles (PC, dans le dossier du projet)

- `npm install` — réinstaller les dépendances (après un clone)
- `npx cap sync` — resynchroniser la config vers android/ios (après
  modification de `capacitor.config.json`)

## Notes

- Les connexions Strava / Whoop / Supabase passent par le navigateur intégré
  de l'app (domaines autorisés dans `capacitor.config.json` →
  `server.allowNavigation`). Si un OAuth ouvre une page hors de l'app,
  ajouter son domaine à cette liste puis `npx cap sync` + rebuild.
- Icône / splash : régénérables depuis `assets/icon.png` (le script de
  génération est dans l'historique de session Claude, ou utiliser
  `npx @capacitor/assets generate`).
