/* ============================================================
   js/auth.js — UI d'authentification Supabase

   - Si pas connecté : affiche une modal bloquante (login + signup)
   - Si connecté : affiche un bouton "logout" dans le header
   - Émet des events :
       window.dispatchEvent(new CustomEvent('coach-ia-auth', {detail: {user}}))
     pour que les autres modules sachent quand recharger leurs données
   - Listen aussi sb.auth.onAuthStateChange (rafraîchit l'UI quand session change)
   ============================================================ */

let _modal = null;
let _initialized = false;

function buildLoginModal() {
  const overlay = document.createElement('div');
  overlay.id = 'auth-backdrop';
  overlay.className = 'auth-backdrop';
  overlay.innerHTML = `
    <div class="auth-modal">
      <div class="auth-logo">
        <div class="logo-icon" style="width:48px;height:48px;border-radius:12px;display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,#4ade80,#60a5fa);color:#0b0e14;font-weight:800;font-size:18px;">CI</div>
        <div>
          <h2 style="margin:0;font-size:20px;">Coach IA</h2>
          <p class="auth-subtitle">Connecte-toi pour synchroniser tes données</p>
        </div>
      </div>

      <div class="auth-tabs">
        <button class="auth-tab active" data-tab="login" type="button">Connexion</button>
        <button class="auth-tab" data-tab="signup" type="button">Créer un compte</button>
      </div>

      <form class="auth-form" id="auth-form" autocomplete="on">
        <label class="auth-field">
          <span>Email</span>
          <input type="email" id="auth-email" required autocomplete="email" placeholder="ton@email.com">
        </label>
        <label class="auth-field">
          <span>Mot de passe</span>
          <input type="password" id="auth-password" required autocomplete="current-password" placeholder="Min. 6 caractères" minlength="6">
        </label>
        <div class="auth-error" id="auth-error" hidden></div>
        <button class="auth-submit" id="auth-submit" type="submit">Se connecter</button>
      </form>

      <p class="auth-help" id="auth-help">
        Première fois ? Clique sur « Créer un compte » au-dessus.
      </p>
    </div>
  `;
  return overlay;
}

function showError(msg) {
  const el = document.getElementById('auth-error');
  if (!el) return;
  el.textContent = msg;
  el.hidden = !msg;
}

function setMode(mode) {
  document.querySelectorAll('.auth-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === mode));
  const submit = document.getElementById('auth-submit');
  const help = document.getElementById('auth-help');
  const pwd = document.getElementById('auth-password');
  if (mode === 'login') {
    submit.textContent = 'Se connecter';
    pwd.autocomplete = 'current-password';
    help.innerHTML = 'Première fois ? Clique sur « Créer un compte » au-dessus.';
  } else {
    submit.textContent = 'Créer mon compte';
    pwd.autocomplete = 'new-password';
    help.innerHTML = 'En créant ton compte, tes données seront sauvegardées dans le cloud et synchronisées sur tous tes appareils.';
  }
  showError('');
}

async function handleSubmit(e) {
  e.preventDefault();
  const sb = window.sb;
  if (!sb) { showError('Supabase non configuré.'); return; }
  const mode = document.querySelector('.auth-tab.active').dataset.tab;
  const email = document.getElementById('auth-email').value.trim();
  const password = document.getElementById('auth-password').value;
  if (!email || !password) return;

  const submit = document.getElementById('auth-submit');
  submit.disabled = true;
  submit.textContent = mode === 'login' ? 'Connexion...' : 'Création...';
  showError('');

  try {
    let result;
    if (mode === 'login') {
      result = await sb.auth.signInWithPassword({ email, password });
    } else {
      result = await sb.auth.signUp({ email, password });
    }
    if (result.error) {
      throw result.error;
    }
    // Succès → onAuthStateChange va fermer la modal
  } catch (err) {
    const msg = err.message || String(err);
    // Messages plus parlants en français
    let friendly = msg;
    if (msg.includes('Invalid login credentials')) friendly = 'Email ou mot de passe incorrect.';
    if (msg.includes('User already registered')) friendly = 'Un compte existe déjà avec cet email. Utilise « Connexion ».';
    if (msg.includes('Password should be at least')) friendly = 'Le mot de passe doit faire au moins 6 caractères.';
    if (msg.includes('Email not confirmed')) friendly = 'Email non confirmé. Vérifie ta boîte mail (ou désactive "Confirm email" dans Supabase).';
    showError(friendly);
    submit.disabled = false;
    submit.textContent = mode === 'login' ? 'Se connecter' : 'Créer mon compte';
  }
}

function showLoginModal() {
  if (!_modal) {
    _modal = buildLoginModal();
    document.body.appendChild(_modal);
    // Wire tabs
    _modal.querySelectorAll('.auth-tab').forEach(tab => {
      tab.addEventListener('click', () => setMode(tab.dataset.tab));
    });
    // Wire form
    _modal.querySelector('#auth-form').addEventListener('submit', handleSubmit);
  }
  _modal.classList.add('active');
}

function hideLoginModal() {
  if (_modal) _modal.classList.remove('active');
}

// Menu utilisateur dans le header : avatar + dropdown (profil, sync, déconnexion)
function injectUserMenu(user) {
  const headerInfo = document.querySelector('.header-info');
  if (!headerInfo) return;
  let wrap = document.getElementById('auth-user-menu-wrap');
  if (!wrap) {
    wrap = document.createElement('div');
    wrap.id = 'auth-user-menu-wrap';
    wrap.className = 'auth-user-menu-wrap';
    wrap.innerHTML = `
      <button id="auth-user-btn" class="auth-user-btn" type="button" title="Mon compte">
        <span class="auth-user-avatar"></span>
        <span class="auth-user-name"></span>
        <svg class="auth-user-chevron" viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </button>
      <div id="auth-user-menu" class="auth-user-menu" hidden>
        <div class="auth-user-menu-header">
          <span class="auth-user-menu-email"></span>
        </div>
        <button class="auth-user-menu-item" data-action="profile" type="button">
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
          Mon profil athlète
        </button>
        <button class="auth-user-menu-item" data-action="settings" type="button">
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
          Paramètres
        </button>
        <button class="auth-user-menu-item" data-action="connections" type="button">
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
          Connexions
        </button>
        <button class="auth-user-menu-item" data-action="help" type="button">
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
          Aide &amp; support
        </button>
        <div class="auth-user-menu-sep"></div>
        <button class="auth-user-menu-item danger" data-action="logout" type="button">
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
          Se déconnecter
        </button>
      </div>
    `;
    headerInfo.appendChild(wrap);

    const btn = wrap.querySelector('#auth-user-btn');
    const menu = wrap.querySelector('#auth-user-menu');

    // Toggle au clic
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      menu.hidden = !menu.hidden;
    });
    // Click ailleurs → ferme
    document.addEventListener('click', (e) => {
      if (!wrap.contains(e.target)) menu.hidden = true;
    });
    // Escape → ferme
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') menu.hidden = true;
    });

    // Actions
    menu.querySelectorAll('.auth-user-menu-item').forEach(item => {
      item.addEventListener('click', async (e) => {
        e.stopPropagation();
        menu.hidden = true;
        const action = item.dataset.action;
        if (action === 'logout') {
          const ok = window.appConfirm
            ? await window.appConfirm({
                title: 'Déconnexion',
                message: 'Te déconnecter de Coach IA ?',
                confirmLabel: 'Se déconnecter',
                cancelLabel: 'Annuler',
              })
            : confirm('Te déconnecter ?');
          if (ok && window.sb) await window.sb.auth.signOut();
        } else if (action === 'profile') {
          if (window.openProfileModal) window.openProfileModal();
          else if (window.appAlert) {
            window.appAlert({ title: 'Bientôt', message: 'La modal "Profil athlète" arrive prochainement (FTP, HRmax, poids, etc.).' });
          } else {
            alert('Profil athlète bientôt disponible');
          }
        } else if (action === 'settings') {
          if (window.openSettingsModal) window.openSettingsModal();
          else if (window.appAlert) {
            window.appAlert({ title: 'Paramètres', message: 'La page Paramètres arrive bientôt (thème, unités, notifications, langue, etc.).' });
          }
        } else if (action === 'connections') {
          if (window.openConnectionsModal) window.openConnectionsModal();
          else if (window.appAlert) {
            window.appAlert({ title: 'Connexions', message: 'La page Connexions arrive bientôt (Strava, Whoop, Intervals.icu, etc. avec re-synchro et déconnexion).' });
          }
        } else if (action === 'help') {
          if (window.openHelpModal) window.openHelpModal();
          else if (window.appAlert) {
            window.appAlert({
              title: 'Aide & support',
              message: 'Coach IA — dashboard d\'entraînement.\n\nPour toute question, contacte yanisjaber23@gmail.com.',
            });
          }
        }
      });
    });
  }

  // Mise à jour des infos utilisateur (à chaque appel)
  const avatar = wrap.querySelector('.auth-user-avatar');
  const nameEl = wrap.querySelector('.auth-user-name');
  const emailEl = wrap.querySelector('.auth-user-menu-email');
  const email = user.email || 'utilisateur';
  const username = email.split('@')[0];
  const initial = (username || 'A')[0].toUpperCase();
  if (avatar) avatar.textContent = initial;
  if (nameEl) nameEl.textContent = username;
  if (emailEl) emailEl.textContent = email;
}

function removeUserMenu() {
  const wrap = document.getElementById('auth-user-menu-wrap');
  if (wrap) wrap.remove();
}

// Compat avec ancien nom
function injectLogoutButton(user) { injectUserMenu(user); }
function removeLogoutButton() { removeUserMenu(); }

function hideBootOverlay() {
  const el = document.getElementById('boot-overlay');
  if (el) {
    el.classList.add('hidden');
    setTimeout(() => el.remove(), 350);
  }
  document.documentElement.classList.remove('sb-booting');
}

// Sécurité : si pour une raison quelconque rien ne retire l'overlay,
// on le retire après 10s pour ne pas bloquer l'app indéfiniment.
setTimeout(() => {
  const el = document.getElementById('boot-overlay');
  if (el && !el.classList.contains('hidden')) {
    console.warn('[auth] Boot overlay forcé à se cacher après 10s timeout');
    hideBootOverlay();
  }
}, 10000);

async function init() {
  if (_initialized) return;
  _initialized = true;

  const sb = await window.sbReady;
  if (!sb) {
    // Pas de Supabase configuré : on retire le boot overlay et on affiche la modal d'erreur
    hideBootOverlay();
    showLoginModal();
    showError('Supabase non configuré. Crée supabase-config.js (voir SETUP_SUPABASE.md).');
    return;
  }

  // État initial
  const { data: { session } } = await sb.auth.getSession();
  if (session && session.user) {
    // User connecté : on garde le boot overlay jusqu'à ce que les données soient chargées
    // (c'est supabase-data-loader.js qui le retirera après le load complet)
    injectLogoutButton(session.user);
    window.dispatchEvent(new CustomEvent('coach-ia-auth', { detail: { user: session.user } }));
  } else {
    // Pas connecté : on retire le boot overlay et on affiche la modal de login
    hideBootOverlay();
    showLoginModal();
  }

  // Listener changements d'état
  sb.auth.onAuthStateChange((event, session) => {
    if (session && session.user) {
      hideLoginModal();
      injectLogoutButton(session.user);
      window.dispatchEvent(new CustomEvent('coach-ia-auth', { detail: { user: session.user } }));
    } else {
      removeLogoutButton();
      hideBootOverlay(); // si on se déconnecte, retirer l'overlay
      showLoginModal();
      window.dispatchEvent(new CustomEvent('coach-ia-auth', { detail: { user: null } }));
    }
  });
}

// Expose pour que d'autres modules puissent retirer l'overlay
window.hideBootOverlay = hideBootOverlay;

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

window.coachIaAuth = { showLoginModal, hideLoginModal };
