/* ============================================================
   js/supabase-client.js — Initialisation du client Supabase

   Charge le SDK Supabase via CDN (s'il n'est pas déjà chargé),
   crée une instance configurée avec window.SUPABASE_CONFIG
   (défini dans supabase-config.js).

   Expose :
     - window.sb : le client Supabase (méthodes .from, .auth, etc.)
     - window.sbReady : Promise résolue quand le client est prêt
     - window.sbCurrentUser() : retourne le user courant (ou null)

   Si supabase-config.js manque ou que le SDK n'arrive pas à charger,
   un message d'erreur est affiché à l'utilisateur.
   ============================================================ */

const SDK_URL = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

async function loadSdk() {
  // Le SDK est livré en ESM, on l'import dynamiquement
  const mod = await import(SDK_URL);
  return mod.createClient;
}

function configMissing() {
  console.error('[supabase] window.SUPABASE_CONFIG manquant. Crée supabase-config.js (voir supabase/SETUP_SUPABASE.md)');
  // Affiche un message dans le DOM
  const banner = document.createElement('div');
  banner.style.cssText = 'position:fixed;top:0;left:0;right:0;padding:14px 20px;background:#7f1d1d;color:white;font-size:13px;z-index:99999;text-align:center;';
  banner.innerHTML = `
    <strong>Supabase non configuré.</strong> Crée le fichier <code>supabase-config.js</code> à la racine du projet
    avec ton URL et ton anon key Supabase. Voir <code>supabase/SETUP_SUPABASE.md</code>.
  `;
  document.body && document.body.appendChild(banner);
}

window.sbReady = (async () => {
  const cfg = window.SUPABASE_CONFIG;
  if (!cfg || !cfg.url || !cfg.anonKey) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', configMissing);
    } else {
      configMissing();
    }
    return null;
  }
  try {
    const createClient = await loadSdk();
    window.sb = createClient(cfg.url, cfg.anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        storage: window.localStorage,
      },
    });
    return window.sb;
  } catch (e) {
    console.error('[supabase] Échec chargement SDK :', e);
    return null;
  }
})();

window.sbCurrentUser = async () => {
  await window.sbReady;
  if (!window.sb) return null;
  const { data: { user } } = await window.sb.auth.getUser();
  return user;
};
