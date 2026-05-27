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

// Bouton logout dans le header
function injectLogoutButton(user) {
  const headerInfo = document.querySelector('.header-info');
  if (!headerInfo) return;
  let btn = document.getElementById('auth-logout-btn');
  if (!btn) {
    btn = document.createElement('button');
    btn.id = 'auth-logout-btn';
    btn.className = 'auth-logout-btn';
    btn.type = 'button';
    btn.title = 'Se déconnecter';
    btn.innerHTML = `
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
        <polyline points="16 17 21 12 16 7"/>
        <line x1="21" y1="12" x2="9" y2="12"/>
      </svg>
      <span class="auth-logout-email"></span>
    `;
    btn.addEventListener('click', async () => {
      if (!window.sb) return;
      await window.sb.auth.signOut();
    });
    headerInfo.appendChild(btn);
  }
  const emailEl = btn.querySelector('.auth-logout-email');
  if (emailEl) emailEl.textContent = user.email.split('@')[0];
}

function removeLogoutButton() {
  const btn = document.getElementById('auth-logout-btn');
  if (btn) btn.remove();
}

async function init() {
  if (_initialized) return;
  _initialized = true;

  const sb = await window.sbReady;
  if (!sb) {
    // Pas de Supabase configuré : afficher la modal pour avertir
    showLoginModal();
    showError('Supabase non configuré. Crée supabase-config.js (voir SETUP_SUPABASE.md).');
    return;
  }

  // État initial
  const { data: { session } } = await sb.auth.getSession();
  if (session && session.user) {
    hideLoginModal();
    injectLogoutButton(session.user);
    window.dispatchEvent(new CustomEvent('coach-ia-auth', { detail: { user: session.user } }));
  } else {
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
      showLoginModal();
      window.dispatchEvent(new CustomEvent('coach-ia-auth', { detail: { user: null } }));
    }
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

window.coachIaAuth = { showLoginModal, hideLoginModal };
