# Lancer Coach IA dans l'émulateur Android (Windows)

## 0. Installer Node.js (une seule fois)

1. Télécharge la version **LTS** : https://nodejs.org/fr
2. Installe avec les options par défaut.
3. Ferme et rouvre PowerShell, puis vérifie : `npm --version`.

## 1. Installer Android Studio (une seule fois)

1. Télécharge Android Studio : https://developer.android.com/studio
2. Lance l'installeur, garde toutes les options par défaut (Android Virtual
   Device doit rester coché).
3. Au premier démarrage, l'assistant télécharge le SDK — accepte tout
   (~2-3 Go, compte 10-20 min).

## 2. Créer le téléphone virtuel (une seule fois)

1. Sur l'écran d'accueil d'Android Studio : **More Actions → Virtual Device
   Manager** (ou menu Tools → Device Manager).
2. **Create Virtual Device** → choisis **Pixel 7** → Next.
3. Image système : prends la plus récente proposée (API 34 ou 35) →
   **Download** si nécessaire → Next → Finish.
4. Clique sur ▶ à côté de l'appareil : un téléphone Android démarre dans une
   fenêtre. Laisse-le tourner.

## 2bis. Déclarer Java (une seule fois)

Gradle a besoin de Java ; Android Studio en embarque un. Dans PowerShell :

```powershell
[Environment]::SetEnvironmentVariable("JAVA_HOME", "C:\Program Files\Android\Android Studio\jbr", "User")
$env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
```

(La 1re ligne est permanente, la 2e active la variable dans la fenêtre courante.)

## 3. Ouvrir l'app dans l'émulateur

Dans un terminal (PowerShell), dans le dossier du projet :

```
npm install        # première fois seulement
npx cap run android
```

Sélectionne l'émulateur dans la liste → l'app se compile et s'ouvre dans le
téléphone virtuel. (Première compilation : quelques minutes, ensuite ~30 s.)

Alternative : `npx cap open android` ouvre le projet dans Android Studio,
puis bouton ▶ vert en haut.

## 4. Travailler en local (modifs en direct)

Par défaut l'app charge le site en ligne (GitHub Pages). Pour tester tes
modifs locales AVANT de pousser :

```
python serve.py          # ton serveur local habituel (port 8000)
npm run mode:dev         # l'app pointe vers ton PC (10.0.2.2:8000)
npx cap run android
```

Modifie ton code → recharge dans l'app (tire vers le bas ou relance l'app) →
tu vois tes changements immédiatement, sans push.

Quand tu as fini, **avant de commiter** :

```
npm run mode:prod        # l'app repointe vers le site en ligne
```

⚠️ Ne commite jamais `capacitor.config.json` en mode dev (l'APK GitHub
pointerait vers ton PC). En cas de doute : `npm run mode:prod`.

## 5. Inspecter / déboguer l'app

App ouverte dans l'émulateur → dans Chrome sur ton PC, va sur
`chrome://inspect` → ton app apparaît → **Inspect** : tu obtiens les DevTools
complets (console, éléments, réseau) sur l'app qui tourne dans l'émulateur.

## Récap des commandes

| Commande              | Effet                                            |
|-----------------------|--------------------------------------------------|
| `npx cap run android` | Compile et lance l'app dans l'émulateur          |
| `npm run mode:dev`    | App → ton serveur local (serve.py, port 8000)    |
| `npm run mode:prod`   | App → site en ligne (GitHub Pages)               |
| `npx cap sync`        | Resynchronise la config vers les projets natifs  |
