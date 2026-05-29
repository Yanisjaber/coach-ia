/* ============================================================
   js/profile-modal.js — Page "Mon profil athlète" (vue plein écran)

   Page complète inspirée de Nolio / TrainingPeaks, avec 13 sections :
     1. Identité          2. Sports & niveau    3. Vélo
     4. Course            5. Natation           6. Cardiaque
     7. Zones             8. Objectifs saison   9. Disponibilité
    10. Équipement       11. Santé             12. Coaching
    13. Records personnels

   Stockage :
     - Colonnes existantes user_profiles : display_name, weight, ftp, hr_max, lthr
     - Tout le reste dans user_profiles.extras (jsonb, à ajouter via migration)

   Migration SQL nécessaire (1 ligne) :
     alter table user_profiles add column if not exists extras jsonb default '{}'::jsonb;

   Routage : hash #profil — clic Mon profil athlète (menu) → openProfileModal()

   Expose : window.openProfileModal(), window.closeProfileModal()
   ============================================================ */

const ROUTE_HASH = '#profil';
let _panel = null;
let _initialMain = null;
let _initialExtras = null;
let _activeSection = 'identity';
let _previousTabBtn = null;

// ============================================================
// CONFIG DES SECTIONS
// ============================================================
const SECTIONS = [
  { id: 'identity',     label: 'Identité',          group: 'Profil' },
  { id: 'sports',       label: 'Sports & niveau',   group: 'Profil' },
  { id: 'bike',         label: 'Vélo',              group: 'Physio' },
  { id: 'run',          label: 'Course',            group: 'Physio' },
  { id: 'swim',         label: 'Natation',          group: 'Physio' },
  { id: 'heart',        label: 'Cardiaque',         group: 'Physio' },
  { id: 'zones',        label: 'Zones d\'entraînement', group: 'Physio' },
  { id: 'goals',        label: 'Objectifs saison',  group: 'Plan' },
  { id: 'availability', label: 'Disponibilité',     group: 'Plan' },
  { id: 'equipment',    label: 'Équipement',        group: 'Plan' },
  { id: 'health',       label: 'Santé',             group: 'Bien-être' },
  { id: 'coaching',     label: 'Préférences coaching', group: 'Bien-être' },
  { id: 'records',      label: 'Records personnels', group: 'Performance' },
];

const SECTION_ICONS = {
  identity: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  sports: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
  bike: '<circle cx="5.5" cy="17.5" r="3.5"/><circle cx="18.5" cy="17.5" r="3.5"/><circle cx="15" cy="5" r="1"/><path d="M12 17.5V14l-3-3 4-3 2 3h2"/>',
  run: '<path d="M13 4v3l3 2 2 6 2 1m-9-6 4-2 1-3"/><circle cx="17" cy="4" r="1.5"/><path d="M4 22l4-5 3 4 3-7"/>',
  swim: '<path d="M2 12c2 0 2-2 4-2s2 2 4 2 2-2 4-2 2 2 4 2 2-2 4-2"/><path d="M2 17c2 0 2-2 4-2s2 2 4 2 2-2 4-2 2 2 4 2 2-2 4-2"/><circle cx="17" cy="6" r="2"/>',
  heart: '<path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>',
  zones: '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>',
  goals: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
  availability: '<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>',
  equipment: '<path d="M22 12l-4 4-4-4 4-4z"/><path d="M6 8l4-4 4 4-4 4z"/><path d="M2 12l4 4 4-4-4-4z"/>',
  health: '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>',
  coaching: '<path d="M14 9a2 2 0 0 1-2 2H6l-4 4V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2z"/><path d="M18 9h2a2 2 0 0 1 2 2v11l-4-4h-6a2 2 0 0 1-2-2v-1"/>',
  records: '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>',
};

// ============================================================
// BUILD HTML
// ============================================================
function buildPanel() {
  const section = document.createElement('section');
  section.className = 'panel profile-page';
  section.id = 'p-profile';
  section.innerHTML = `
    <!-- Header de page : retour + titre + barre de complétion -->
    <div class="profile-page-header">
      <button type="button" class="profile-back-btn" id="profile-back-btn">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
          <line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>
        </svg>
        Retour
      </button>
      <div class="profile-page-title-wrap">
        <div class="profile-page-icon">
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
        </div>
        <div class="profile-page-title-text">
          <h2>Mon profil athlète</h2>
          <p>Plus ton profil est complet, plus les calculs et recommandations sont précis.</p>
        </div>
        <div class="profile-completion">
          <div class="profile-completion-label">
            <span id="profile-completion-pct">0%</span>
            <span>complété</span>
          </div>
          <div class="profile-completion-bar">
            <div class="profile-completion-bar-fill" id="profile-completion-fill"></div>
          </div>
        </div>
      </div>
    </div>

    <!-- Body : sidebar nav + content -->
    <div class="profile-page-body">
      <aside class="profile-sidebar" id="profile-sidebar">
        ${buildSidebarHTML()}
      </aside>

      <form class="profile-page-form" id="profile-modal-form">
        <div class="profile-content" id="profile-content">
          ${buildAllSectionsHTML()}
        </div>

        <div class="profile-error" id="profile-error" hidden></div>

        <div class="profile-page-actions">
          <div class="profile-page-actions-status" id="profile-actions-status">Aucune modification</div>
          <button type="button" class="profile-btn profile-btn-secondary" id="profile-cancel">Annuler</button>
          <button type="submit" class="profile-btn profile-btn-primary" id="profile-save">Enregistrer</button>
        </div>
      </form>
    </div>
  `;
  return section;
}

function buildSidebarHTML() {
  const groups = {};
  for (const s of SECTIONS) {
    if (!groups[s.group]) groups[s.group] = [];
    groups[s.group].push(s);
  }
  return Object.entries(groups).map(([group, items]) => `
    <div class="profile-sidebar-group">
      <div class="profile-sidebar-group-label">${group}</div>
      ${items.map(s => `
        <button type="button" class="profile-sidebar-item" data-section="${s.id}">
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${SECTION_ICONS[s.id] || ''}</svg>
          <span>${s.label}</span>
        </button>
      `).join('')}
    </div>
  `).join('');
}

function buildAllSectionsHTML() {
  return SECTIONS.map(s => `
    <div class="profile-section-panel" data-section="${s.id}">
      ${renderSection(s.id)}
    </div>
  `).join('');
}

// ============================================================
// SECTIONS — rendu HTML
// ============================================================
function renderSection(id) {
  switch (id) {
    case 'identity': return renderIdentity();
    case 'sports': return renderSports();
    case 'bike': return renderBike();
    case 'run': return renderRun();
    case 'swim': return renderSwim();
    case 'heart': return renderHeart();
    case 'zones': return renderZones();
    case 'goals': return renderGoals();
    case 'availability': return renderAvailability();
    case 'equipment': return renderEquipment();
    case 'health': return renderHealth();
    case 'coaching': return renderCoaching();
    case 'records': return renderRecords();
    default: return '<p>Section inconnue</p>';
  }
}

function renderIdentity() {
  return `
    <header class="profile-section-header">
      <h3>Identité</h3>
      <p>Comment tu apparais dans Coach IA, et tes mensurations de base.</p>
    </header>

    <div class="profile-card">
      <div class="profile-avatar-row">
        <div class="profile-avatar-preview" id="profile-avatar-preview">?</div>
        <div class="profile-avatar-fields">
          <span class="profile-field-label">Photo de profil</span>
          <div class="profile-avatar-actions">
            <button type="button" class="profile-btn profile-btn-secondary profile-btn-sm" id="profile-avatar-pick">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
              Choisir une image
            </button>
            <button type="button" class="profile-btn profile-btn-ghost profile-btn-sm" id="profile-avatar-remove" hidden>
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
              Supprimer
            </button>
            <input type="file" id="profile-avatar-input" accept="image/*" hidden>
            <!-- Champ caché qui contient la data URL (sauvegardée dans extras.avatar_url) -->
            <input name="x_avatar_url" type="hidden">
          </div>
          <small class="profile-hint" id="profile-avatar-hint">PNG, JPG ou WebP. Compressée automatiquement à 256×256.</small>
        </div>
      </div>

      <div class="profile-grid profile-grid-2">
        <label class="profile-field">
          <span>Nom affiché *</span>
          <input name="display_name" type="text" maxlength="80" placeholder="Ton nom" required>
        </label>
        <label class="profile-field">
          <span>Nom complet</span>
          <input name="x_full_name" type="text" maxlength="120" placeholder="Prénom Nom">
        </label>
      </div>

      <div class="profile-grid profile-grid-3">
        <label class="profile-field">
          <span>Date de naissance</span>
          <input name="x_birth_date" type="date">
          <small class="profile-hint" id="x_age_display"></small>
        </label>
        <label class="profile-field">
          <span>Sexe</span>
          <select name="x_sex">
            <option value="">—</option>
            <option value="M">Homme</option>
            <option value="F">Femme</option>
            <option value="O">Autre / non précisé</option>
          </select>
        </label>
        <label class="profile-field">
          <span>Pays</span>
          <input name="x_country" type="text" maxlength="60" placeholder="France">
        </label>
      </div>

      <div class="profile-grid profile-grid-3">
        <label class="profile-field">
          <span>Ville</span>
          <input name="x_city" type="text" maxlength="80" placeholder="Paris">
        </label>
        <label class="profile-field">
          <span>Taille (cm)</span>
          <input name="x_height" type="number" min="120" max="230" step="1" placeholder="—">
        </label>
        <label class="profile-field">
          <span>Poids (kg) *</span>
          <input name="weight" type="number" min="20" max="250" step="0.1" placeholder="—">
        </label>
      </div>

      <label class="profile-field">
        <span>Bio courte</span>
        <textarea name="x_bio" rows="3" maxlength="500" placeholder="Quelques mots sur toi, ton parcours, tes envies sportives…"></textarea>
      </label>
    </div>
  `;
}

function renderSports() {
  return `
    <header class="profile-section-header">
      <h3>Sports & niveau</h3>
      <p>Quels sports tu pratiques, et à quel niveau tu te situes.</p>
    </header>

    <div class="profile-card">
      <div class="profile-grid profile-grid-2">
        <label class="profile-field">
          <span>Sport principal *</span>
          <select name="x_main_sport">
            <option value="">—</option>
            <option value="cycling_road">Cyclisme route</option>
            <option value="cycling_gravel">Gravel</option>
            <option value="cycling_mtb">VTT (XC / Enduro / DH)</option>
            <option value="cycling_tt">Contre-la-montre / Tri-bike</option>
            <option value="cycling_track">Piste</option>
            <option value="running_road">Course route</option>
            <option value="running_trail">Trail</option>
            <option value="ultra">Ultra-endurance</option>
            <option value="swimming">Natation</option>
            <option value="triathlon">Triathlon</option>
            <option value="duathlon">Duathlon</option>
            <option value="other">Autre</option>
          </select>
        </label>
        <label class="profile-field">
          <span>Discipline / Spécialité</span>
          <input name="x_speciality" type="text" maxlength="100" placeholder="Ex: grimpeur, sprinter, marathonien…">
        </label>
      </div>

      <fieldset class="profile-fieldset">
        <legend>Sports secondaires</legend>
        <div class="profile-checkbox-grid">
          ${[
            ['x_sec_cycling','Cyclisme'],
            ['x_sec_running','Course'],
            ['x_sec_swimming','Natation'],
            ['x_sec_mtb','VTT'],
            ['x_sec_trail','Trail'],
            ['x_sec_gym','Renforcement / muscu'],
            ['x_sec_yoga','Yoga / mobilité'],
            ['x_sec_ski','Ski / ski-alpinisme'],
          ].map(([n,l]) => `<label class="profile-checkbox"><input type="checkbox" name="${n}"><span>${l}</span></label>`).join('')}
        </div>
      </fieldset>

      <div class="profile-grid profile-grid-3">
        <label class="profile-field">
          <span>Années de pratique</span>
          <input name="x_years_practice" type="number" min="0" max="80" step="1" placeholder="—">
        </label>
        <label class="profile-field">
          <span>Niveau auto-évalué</span>
          <select name="x_level">
            <option value="">—</option>
            <option value="1">Débutant</option>
            <option value="2">Loisir confirmé</option>
            <option value="3">Compétiteur amateur</option>
            <option value="4">Compétiteur régional / national</option>
            <option value="5">Élite</option>
          </select>
        </label>
        <label class="profile-field">
          <span>Catégorie d'âge</span>
          <input name="x_age_category" type="text" maxlength="40" placeholder="Senior, Master 2…">
        </label>
      </div>

      <label class="profile-field">
        <span>Club / structure</span>
        <input name="x_club" type="text" maxlength="120" placeholder="Nom de ton club ou team">
      </label>
    </div>
  `;
}

function renderBike() {
  return `
    <header class="profile-section-header">
      <h3>Métriques vélo</h3>
      <p>Tes données de puissance servent à calculer TSS, zones et progression.</p>
    </header>

    <div class="profile-card">
      <div class="profile-grid profile-grid-3">
        <label class="profile-field">
          <span>FTP (W) *</span>
          <input name="ftp" type="number" min="50" max="600" step="1" placeholder="—">
          <small class="profile-hint">Puissance seuil ~ 1h max</small>
        </label>
        <label class="profile-field">
          <span>FTP / kg</span>
          <input id="x_wkg_display" type="text" readonly placeholder="auto" tabindex="-1">
          <small class="profile-hint">Calculé automatiquement</small>
        </label>
        <label class="profile-field">
          <span>VO2max estimé (ml/kg/min)</span>
          <input name="x_vo2max_bike" type="number" min="20" max="95" step="0.1" placeholder="—">
        </label>
      </div>

      <div class="profile-grid profile-grid-3">
        <label class="profile-field">
          <span>Puissance critique CP (W)</span>
          <input name="x_cp" type="number" min="50" max="600" step="1" placeholder="—">
          <small class="profile-hint">Souvent ≈ FTP</small>
        </label>
        <label class="profile-field">
          <span>W' — réserve anaérobie (kJ)</span>
          <input name="x_wprime" type="number" min="0" max="50" step="0.1" placeholder="—">
        </label>
        <label class="profile-field">
          <span>Puissance max sprint (W)</span>
          <input name="x_pmax" type="number" min="200" max="2500" step="1" placeholder="—">
        </label>
      </div>

      <div class="profile-grid profile-grid-2">
        <label class="profile-field">
          <span>Date du dernier test FTP</span>
          <input name="x_last_ftp_test" type="date">
        </label>
        <label class="profile-field">
          <span>Type de test</span>
          <select name="x_ftp_test_type">
            <option value="">—</option>
            <option value="20min">20 min × 0,95</option>
            <option value="8min">8 min × 0,90 (Carmichael)</option>
            <option value="ramp">Ramp test</option>
            <option value="2x8">2 × 8 min</option>
            <option value="cp">Critical Power (3/12 min)</option>
            <option value="record">Auto-déduit du record 60 min</option>
            <option value="estimate">Estimation à dire d'œil</option>
          </select>
        </label>
      </div>
    </div>
  `;
}

function renderRun() {
  return `
    <header class="profile-section-header">
      <h3>Métriques course</h3>
      <p>Allures de référence pour calculer les zones et l'intensité des séances.</p>
    </header>

    <div class="profile-card">
      <div class="profile-grid profile-grid-3">
        <label class="profile-field">
          <span>VMA (km/h)</span>
          <input name="x_vma" type="number" min="6" max="25" step="0.1" placeholder="—">
          <small class="profile-hint">Vitesse maximale aérobie</small>
        </label>
        <label class="profile-field">
          <span>Vitesse seuil (km/h)</span>
          <input name="x_threshold_speed" type="number" min="6" max="22" step="0.1" placeholder="—">
        </label>
        <label class="profile-field">
          <span>VO2max course (ml/kg/min)</span>
          <input name="x_vo2max_run" type="number" min="20" max="95" step="0.1" placeholder="—">
        </label>
      </div>

      <fieldset class="profile-fieldset">
        <legend>Allures de référence (min/km)</legend>
        <div class="profile-grid profile-grid-4">
          <label class="profile-field">
            <span>5 km</span>
            <input name="x_pace_5k" type="text" placeholder="4:30">
          </label>
          <label class="profile-field">
            <span>10 km</span>
            <input name="x_pace_10k" type="text" placeholder="4:45">
          </label>
          <label class="profile-field">
            <span>Semi</span>
            <input name="x_pace_half" type="text" placeholder="5:00">
          </label>
          <label class="profile-field">
            <span>Marathon</span>
            <input name="x_pace_marathon" type="text" placeholder="5:20">
          </label>
        </div>
      </fieldset>
    </div>
  `;
}

function renderSwim() {
  return `
    <header class="profile-section-header">
      <h3>Métriques natation</h3>
      <p>Tes vitesses seuil et performances de référence en bassin.</p>
    </header>

    <div class="profile-card">
      <div class="profile-grid profile-grid-3">
        <label class="profile-field">
          <span>CSS (mm:ss / 100m)</span>
          <input name="x_css" type="text" placeholder="1:30">
          <small class="profile-hint">Vitesse seuil natation</small>
        </label>
        <label class="profile-field">
          <span>SWOLF moyen</span>
          <input name="x_swolf" type="number" min="20" max="80" step="1" placeholder="—">
        </label>
        <label class="profile-field">
          <span>Niveau technique</span>
          <select name="x_swim_level">
            <option value="">—</option>
            <option value="beginner">Débutant</option>
            <option value="intermediate">Intermédiaire</option>
            <option value="advanced">Avancé</option>
            <option value="expert">Expert</option>
          </select>
        </label>
      </div>

      <fieldset class="profile-fieldset">
        <legend>Records (mm:ss)</legend>
        <div class="profile-grid profile-grid-4">
          <label class="profile-field"><span>100 m</span><input name="x_swim_100" type="text" placeholder="1:25"></label>
          <label class="profile-field"><span>400 m</span><input name="x_swim_400" type="text" placeholder="6:30"></label>
          <label class="profile-field"><span>1500 m</span><input name="x_swim_1500" type="text" placeholder="25:00"></label>
          <label class="profile-field"><span>3800 m (IM)</span><input name="x_swim_3800" type="text" placeholder="1:08:00"></label>
        </div>
      </fieldset>
    </div>
  `;
}

function renderHeart() {
  return `
    <header class="profile-section-header">
      <h3>Cardiaque</h3>
      <p>Fréquences cardiaques de référence pour le calcul des zones et de la charge.</p>
    </header>

    <div class="profile-card">
      <div class="profile-grid profile-grid-3">
        <label class="profile-field">
          <span>HRmax (bpm) *</span>
          <input name="hr_max" type="number" min="100" max="230" step="1" placeholder="—">
          <small class="profile-hint">FC maximale observée</small>
        </label>
        <label class="profile-field">
          <span>FC repos / RHR (bpm)</span>
          <input name="x_rhr" type="number" min="30" max="100" step="1" placeholder="—">
          <small class="profile-hint">Au réveil</small>
        </label>
        <label class="profile-field">
          <span>LTHR (bpm) *</span>
          <input name="lthr" type="number" min="100" max="220" step="1" placeholder="—">
          <small class="profile-hint">~90% HRmax</small>
        </label>
      </div>

      <div class="profile-grid profile-grid-3">
        <label class="profile-field">
          <span>HRV baseline (ms)</span>
          <input name="x_hrv_baseline" type="number" min="10" max="200" step="1" placeholder="—">
          <small class="profile-hint">HRV moyenne récente</small>
        </label>
        <label class="profile-field">
          <span>Méthode HRmax</span>
          <select name="x_hrmax_method">
            <option value="">—</option>
            <option value="observed">Observée en activité</option>
            <option value="test">Test maximal</option>
            <option value="age">Formule âge (220-âge)</option>
            <option value="tanaka">Formule Tanaka (208-0,7×âge)</option>
          </select>
        </label>
        <label class="profile-field">
          <span>Dérive cardiaque tolérée (%)</span>
          <input name="x_cardiac_drift" type="number" min="0" max="20" step="0.5" placeholder="—">
        </label>
      </div>
    </div>
  `;
}

function renderZones() {
  return `
    <header class="profile-section-header">
      <h3>Zones d'entraînement</h3>
      <p>Calculées automatiquement à partir de ta FTP et LTHR (modèle Coggan / Friel).</p>
    </header>

    <div class="profile-card">
      <h4 class="profile-subhead">Zones puissance vélo (% FTP)</h4>
      <div class="profile-zones-table" id="profile-zones-power"></div>
      <p class="profile-info" style="margin-top:14px;">
        <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
        Renseigne ta FTP dans la section <b>Vélo</b> pour afficher les zones.
      </p>
    </div>

    <div class="profile-card">
      <h4 class="profile-subhead">Zones cardiaques (% LTHR — Friel)</h4>
      <div class="profile-zones-table" id="profile-zones-hr"></div>
      <p class="profile-info" style="margin-top:14px;">
        <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
        Renseigne LTHR dans la section <b>Cardiaque</b> pour afficher les zones.
      </p>
    </div>

    <div class="profile-card">
      <h4 class="profile-subhead">Zones allure course (% vitesse seuil)</h4>
      <div class="profile-zones-table" id="profile-zones-pace"></div>
      <p class="profile-info" style="margin-top:14px;">
        <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
        Renseigne la vitesse seuil dans la section <b>Course</b> pour afficher les zones.
      </p>
    </div>
  `;
}

function renderGoals() {
  return `
    <header class="profile-section-header">
      <h3>Objectifs de saison</h3>
      <p>Ta course principale (A) et tes objectifs secondaires.</p>
    </header>

    <div class="profile-card">
      <h4 class="profile-subhead">Course objectif principale (A)</h4>
      <div class="profile-grid profile-grid-2">
        <label class="profile-field">
          <span>Nom de l'épreuve</span>
          <input name="x_race_a_name" type="text" maxlength="120" placeholder="Ex: Marmotte, Ironman Nice…">
        </label>
        <label class="profile-field">
          <span>Date</span>
          <input name="x_race_a_date" type="date">
        </label>
      </div>
      <div class="profile-grid profile-grid-3">
        <label class="profile-field">
          <span>Discipline</span>
          <input name="x_race_a_discipline" type="text" maxlength="60" placeholder="Vélo, marathon…">
        </label>
        <label class="profile-field">
          <span>Distance / format</span>
          <input name="x_race_a_distance" type="text" maxlength="60" placeholder="Ex: 175 km / 5000 D+">
        </label>
        <label class="profile-field">
          <span>Objectif chrono</span>
          <input name="x_race_a_target" type="text" maxlength="40" placeholder="Ex: sub 9h, top 20…">
        </label>
      </div>
      <label class="profile-field">
        <span>Notes / contexte</span>
        <textarea name="x_race_a_notes" rows="2" placeholder="Pourquoi cet objectif, contraintes, qualifs…"></textarea>
      </label>
    </div>

    <div class="profile-card">
      <h4 class="profile-subhead">Objectifs secondaires (B)</h4>
      <label class="profile-field">
        <span>Liste des courses B (1 par ligne)</span>
        <textarea name="x_races_b" rows="4" placeholder="Ex:
2026-06-12 — Triathlon de Nice (M)
2026-07-04 — Étape du Tour
2026-08-30 — Trail Mont Blanc 30 km"></textarea>
      </label>
    </div>

    <div class="profile-card">
      <h4 class="profile-subhead">Saison & volume</h4>
      <div class="profile-grid profile-grid-3">
        <label class="profile-field">
          <span>Début de saison</span>
          <input name="x_season_start" type="date">
        </label>
        <label class="profile-field">
          <span>Fin de saison</span>
          <input name="x_season_end" type="date">
        </label>
        <label class="profile-field">
          <span>Volume hebdo cible (h)</span>
          <input name="x_weekly_volume_target" type="number" min="0" max="40" step="0.5" placeholder="—">
        </label>
      </div>
    </div>
  `;
}

function renderAvailability() {
  return `
    <header class="profile-section-header">
      <h3>Disponibilité</h3>
      <p>Tes contraintes de temps et préférences de planning hebdo.</p>
    </header>

    <div class="profile-card">
      <div class="profile-grid profile-grid-3">
        <label class="profile-field">
          <span>Heures par semaine moyennes</span>
          <input name="x_weekly_hours" type="number" min="0" max="40" step="0.5" placeholder="—">
        </label>
        <label class="profile-field">
          <span>Heures max sur une semaine</span>
          <input name="x_max_weekly_hours" type="number" min="0" max="40" step="0.5" placeholder="—">
        </label>
        <label class="profile-field">
          <span>Jours d'entraînement / semaine</span>
          <input name="x_training_days" type="number" min="1" max="14" step="1" placeholder="—">
        </label>
      </div>

      <fieldset class="profile-fieldset">
        <legend>Jours d'entraînement préférés</legend>
        <div class="profile-checkbox-grid profile-day-grid">
          ${['Lun','Mar','Mer','Jeu','Ven','Sam','Dim'].map((d,i) => `
            <label class="profile-checkbox profile-day-check"><input type="checkbox" name="x_day_${i}"><span>${d}</span></label>
          `).join('')}
        </div>
      </fieldset>

      <fieldset class="profile-fieldset">
        <legend>Jour(s) de repos préférés</legend>
        <div class="profile-checkbox-grid profile-day-grid">
          ${['Lun','Mar','Mer','Jeu','Ven','Sam','Dim'].map((d,i) => `
            <label class="profile-checkbox profile-day-check"><input type="checkbox" name="x_rest_${i}"><span>${d}</span></label>
          `).join('')}
        </div>
      </fieldset>

      <fieldset class="profile-fieldset">
        <legend>Créneaux préférés</legend>
        <div class="profile-checkbox-grid">
          ${[
            ['x_slot_morning','Tôt matin (5-8h)'],
            ['x_slot_morning_late','Matinée (8-12h)'],
            ['x_slot_lunch','Pause déj (12-14h)'],
            ['x_slot_afternoon','Après-midi (14-18h)'],
            ['x_slot_evening','Soir (18-21h)'],
            ['x_slot_night','Nuit (21h+)'],
          ].map(([n,l]) => `<label class="profile-checkbox"><input type="checkbox" name="${n}"><span>${l}</span></label>`).join('')}
        </div>
      </fieldset>

      <fieldset class="profile-fieldset">
        <legend>Capacité indoor</legend>
        <div class="profile-checkbox-grid">
          ${[
            ['x_indoor_trainer','Home-trainer vélo'],
            ['x_indoor_smart','Home-trainer connecté (Zwift, Rouvy…)'],
            ['x_indoor_treadmill','Tapis de course'],
            ['x_indoor_pool','Accès piscine'],
            ['x_indoor_gym','Salle de muscu'],
          ].map(([n,l]) => `<label class="profile-checkbox"><input type="checkbox" name="${n}"><span>${l}</span></label>`).join('')}
        </div>
      </fieldset>

      <label class="profile-field">
        <span>Contraintes particulières</span>
        <textarea name="x_constraints" rows="3" placeholder="Trajets boulot, enfants, voyages réguliers, autre…"></textarea>
      </label>
    </div>
  `;
}

function renderEquipment() {
  return `
    <header class="profile-section-header">
      <h3>Équipement</h3>
      <p>Tes vélos, capteurs et outils de mesure.</p>
    </header>

    <div class="profile-card">
      <h4 class="profile-subhead">Vélos</h4>
      <div class="profile-grid profile-grid-2">
        <label class="profile-field">
          <span>Vélo principal</span>
          <input name="x_bike_main" type="text" maxlength="120" placeholder="Ex: Specialized Tarmac SL7">
        </label>
        <label class="profile-field">
          <span>Vélo secondaire</span>
          <input name="x_bike_secondary" type="text" maxlength="120" placeholder="Ex: Trek Checkpoint (gravel)">
        </label>
      </div>
      <div class="profile-grid profile-grid-2">
        <label class="profile-field">
          <span>VTT</span>
          <input name="x_bike_mtb" type="text" maxlength="120" placeholder="—">
        </label>
        <label class="profile-field">
          <span>Vélo TT / contre-la-montre</span>
          <input name="x_bike_tt" type="text" maxlength="120" placeholder="—">
        </label>
      </div>
    </div>

    <div class="profile-card">
      <h4 class="profile-subhead">Capteurs</h4>
      <div class="profile-grid profile-grid-3">
        <label class="profile-field">
          <span>Capteur de puissance</span>
          <input name="x_power_meter" type="text" maxlength="120" placeholder="Ex: Quarq DZero, Favero Assioma…">
        </label>
        <label class="profile-field">
          <span>Compteur / GPS vélo</span>
          <input name="x_bike_gps" type="text" maxlength="120" placeholder="Ex: Garmin Edge 1040">
        </label>
        <label class="profile-field">
          <span>Cardio-fréquencemètre</span>
          <input name="x_hr_strap" type="text" maxlength="120" placeholder="Ex: Polar H10">
        </label>
      </div>
      <div class="profile-grid profile-grid-3">
        <label class="profile-field">
          <span>Montre GPS</span>
          <input name="x_watch" type="text" maxlength="120" placeholder="Ex: Garmin Fenix 7">
        </label>
        <label class="profile-field">
          <span>Bracelet / capteur recovery</span>
          <input name="x_recovery_device" type="text" maxlength="120" placeholder="Ex: Whoop, Oura…">
        </label>
        <label class="profile-field">
          <span>Capteur natation</span>
          <input name="x_swim_sensor" type="text" maxlength="120" placeholder="Ex: Form Smart Goggles">
        </label>
      </div>
    </div>

    <div class="profile-card">
      <h4 class="profile-subhead">Home-trainer / app</h4>
      <div class="profile-grid profile-grid-2">
        <label class="profile-field">
          <span>Home-trainer (modèle)</span>
          <input name="x_trainer_model" type="text" maxlength="120" placeholder="Ex: Wahoo Kickr V6">
        </label>
        <label class="profile-field">
          <span>Plateforme indoor</span>
          <input name="x_indoor_platform" type="text" maxlength="120" placeholder="Ex: Zwift, Rouvy, TrainerRoad">
        </label>
      </div>
    </div>
  `;
}

function renderHealth() {
  return `
    <header class="profile-section-header">
      <h3>Santé</h3>
      <p>Pour adapter la charge et éviter les zones à risque.</p>
    </header>

    <div class="profile-card">
      <label class="profile-field">
        <span>Blessures actives</span>
        <textarea name="x_active_injuries" rows="2" placeholder="Décris brièvement (zone, intensité, depuis quand)…"></textarea>
      </label>
      <label class="profile-field">
        <span>Antécédents de blessures</span>
        <textarea name="x_injury_history" rows="3" placeholder="Listes des blessures passées importantes…"></textarea>
      </label>

      <div class="profile-grid profile-grid-2">
        <label class="profile-field">
          <span>Allergies</span>
          <textarea name="x_allergies" rows="2" placeholder="Pollens, médicaments, alimentaires…"></textarea>
        </label>
        <label class="profile-field">
          <span>Médicaments / traitements</span>
          <textarea name="x_medications" rows="2" placeholder="Traitements en cours susceptibles d'influer sur la perf…"></textarea>
        </label>
      </div>

      <div class="profile-grid profile-grid-2">
        <label class="profile-field">
          <span>Régime alimentaire</span>
          <select name="x_diet">
            <option value="">—</option>
            <option value="omni">Omnivore</option>
            <option value="flexi">Flexitarien</option>
            <option value="vegetarian">Végétarien</option>
            <option value="vegan">Végan</option>
            <option value="pescatarian">Pescetarien</option>
            <option value="gluten_free">Sans gluten</option>
            <option value="lactose_free">Sans lactose</option>
            <option value="lowcarb">Low-carb / kéto</option>
            <option value="other">Autre</option>
          </select>
        </label>
        <label class="profile-field">
          <span>Heures de sommeil moy. /nuit</span>
          <input name="x_sleep_hours" type="number" min="3" max="14" step="0.25" placeholder="—">
        </label>
      </div>

      <fieldset class="profile-fieldset">
        <legend>Contact d'urgence</legend>
        <div class="profile-grid profile-grid-3">
          <label class="profile-field"><span>Nom</span><input name="x_emergency_name" type="text" maxlength="120" placeholder="—"></label>
          <label class="profile-field"><span>Lien</span><input name="x_emergency_relation" type="text" maxlength="60" placeholder="Conjoint, parent…"></label>
          <label class="profile-field"><span>Téléphone</span><input name="x_emergency_phone" type="tel" maxlength="40" placeholder="+33…"></label>
        </div>
      </fieldset>
    </div>
  `;
}

function renderCoaching() {
  return `
    <header class="profile-section-header">
      <h3>Préférences coaching</h3>
      <p>Pour adapter le ton et la structure des recommandations IA.</p>
    </header>

    <div class="profile-card">
      <div class="profile-grid profile-grid-2">
        <label class="profile-field">
          <span>Style de coaching préféré</span>
          <select name="x_coaching_style">
            <option value="">—</option>
            <option value="autonomous">Très autonome (peu d'instructions)</option>
            <option value="hybrid">Hybride (plan + libre d'adapter)</option>
            <option value="structured">Structuré (plan détaillé chaque semaine)</option>
            <option value="strict">Strict (séances chronométrées au pas)</option>
          </select>
        </label>
        <label class="profile-field">
          <span>Ton préféré du coach</span>
          <select name="x_coaching_tone">
            <option value="">—</option>
            <option value="firm">Cadrant / exigeant</option>
            <option value="balanced">Équilibré</option>
            <option value="supportive">Bienveillant / encourageant</option>
            <option value="data">Très data / factuel</option>
          </select>
        </label>
      </div>

      <div class="profile-grid profile-grid-3">
        <label class="profile-field">
          <span>Tolérance à la fatigue (1-5)</span>
          <input name="x_fatigue_tolerance" type="number" min="1" max="5" step="1" placeholder="—">
        </label>
        <label class="profile-field">
          <span>Récupération rapide (1-5)</span>
          <input name="x_recovery_rate" type="number" min="1" max="5" step="1" placeholder="—">
        </label>
        <label class="profile-field">
          <span>Tolérance volume élevé (1-5)</span>
          <input name="x_volume_tolerance" type="number" min="1" max="5" step="1" placeholder="—">
        </label>
      </div>

      <label class="profile-field">
        <span>Motivations principales</span>
        <textarea name="x_motivations" rows="3" placeholder="Pourquoi tu t'entraînes ? Objectifs personnels, valeurs…"></textarea>
      </label>
      <label class="profile-field">
        <span>Tes forces auto-identifiées</span>
        <textarea name="x_strengths" rows="2" placeholder="Endurance longue, sprint, montée…"></textarea>
      </label>
      <label class="profile-field">
        <span>Axes de progression</span>
        <textarea name="x_weaknesses" rows="2" placeholder="Ce que tu veux travailler en priorité…"></textarea>
      </label>
      <label class="profile-field">
        <span>Choses à éviter / contre-indications</span>
        <textarea name="x_avoid" rows="2" placeholder="Ex: pas de double séance, pas de course en descente, allergies au HIIT le matin…"></textarea>
      </label>
    </div>
  `;
}

function renderRecords() {
  return `
    <header class="profile-section-header">
      <h3>Records personnels</h3>
      <p>Tes meilleures performances de référence. Servent à valider la progression.</p>
    </header>

    <div class="profile-card">
      <h4 class="profile-subhead">Puissance vélo (W)</h4>
      <div class="profile-grid profile-grid-4">
        <label class="profile-field"><span>5 s</span><input name="x_pr_p_5s" type="number" min="0" max="2500" step="1" placeholder="—"></label>
        <label class="profile-field"><span>30 s</span><input name="x_pr_p_30s" type="number" min="0" max="2000" step="1" placeholder="—"></label>
        <label class="profile-field"><span>1 min</span><input name="x_pr_p_1m" type="number" min="0" max="1500" step="1" placeholder="—"></label>
        <label class="profile-field"><span>5 min</span><input name="x_pr_p_5m" type="number" min="0" max="800" step="1" placeholder="—"></label>
        <label class="profile-field"><span>8 min</span><input name="x_pr_p_8m" type="number" min="0" max="700" step="1" placeholder="—"></label>
        <label class="profile-field"><span>20 min</span><input name="x_pr_p_20m" type="number" min="0" max="600" step="1" placeholder="—"></label>
        <label class="profile-field"><span>60 min</span><input name="x_pr_p_60m" type="number" min="0" max="500" step="1" placeholder="—"></label>
        <label class="profile-field"><span>Sprint max</span><input name="x_pr_p_max" type="number" min="0" max="2500" step="1" placeholder="—"></label>
      </div>
    </div>

    <div class="profile-card">
      <h4 class="profile-subhead">Vélo — distance & dénivelé</h4>
      <div class="profile-grid profile-grid-3">
        <label class="profile-field"><span>Plus longue sortie (km)</span><input name="x_pr_longest_ride" type="number" min="0" max="2000" step="1" placeholder="—"></label>
        <label class="profile-field"><span>Plus gros dénivelé (m+)</span><input name="x_pr_max_elev" type="number" min="0" max="20000" step="50" placeholder="—"></label>
        <label class="profile-field"><span>Vitesse max (km/h)</span><input name="x_pr_max_speed" type="number" min="0" max="150" step="0.1" placeholder="—"></label>
      </div>
    </div>

    <div class="profile-card">
      <h4 class="profile-subhead">Course (chrono)</h4>
      <div class="profile-grid profile-grid-4">
        <label class="profile-field"><span>5 km</span><input name="x_pr_r_5k" type="text" placeholder="22:30"></label>
        <label class="profile-field"><span>10 km</span><input name="x_pr_r_10k" type="text" placeholder="46:00"></label>
        <label class="profile-field"><span>Semi</span><input name="x_pr_r_half" type="text" placeholder="1:42:00"></label>
        <label class="profile-field"><span>Marathon</span><input name="x_pr_r_marathon" type="text" placeholder="3:35:00"></label>
        <label class="profile-field"><span>50 km</span><input name="x_pr_r_50k" type="text" placeholder="—"></label>
        <label class="profile-field"><span>100 km</span><input name="x_pr_r_100k" type="text" placeholder="—"></label>
        <label class="profile-field"><span>D+ max trail</span><input name="x_pr_r_trail_d" type="number" min="0" max="20000" step="50" placeholder="—"></label>
        <label class="profile-field"><span>Plus longue course (km)</span><input name="x_pr_r_longest" type="number" min="0" max="500" step="0.5" placeholder="—"></label>
      </div>
    </div>

    <div class="profile-card">
      <h4 class="profile-subhead">Triathlon</h4>
      <div class="profile-grid profile-grid-4">
        <label class="profile-field"><span>Sprint (chrono)</span><input name="x_pr_tri_sprint" type="text" placeholder="1:10:00"></label>
        <label class="profile-field"><span>Olympique (M)</span><input name="x_pr_tri_m" type="text" placeholder="2:25:00"></label>
        <label class="profile-field"><span>Half (70.3)</span><input name="x_pr_tri_half" type="text" placeholder="5:30:00"></label>
        <label class="profile-field"><span>Full (140.6)</span><input name="x_pr_tri_full" type="text" placeholder="11:00:00"></label>
      </div>
    </div>
  `;
}

// ============================================================
// CALCULS AUTO (W/kg, zones)
// ============================================================
function updateDerivedFields() {
  const form = document.getElementById('profile-modal-form');
  if (!form) return;
  const ftp = parseFloat(form.elements['ftp']?.value || '0');
  const weight = parseFloat(form.elements['weight']?.value || '0');
  const lthr = parseFloat(form.elements['lthr']?.value || '0');
  const vThr = parseFloat(form.elements['x_threshold_speed']?.value || '0');

  // W/kg
  const wkgEl = document.getElementById('x_wkg_display');
  if (wkgEl) {
    wkgEl.value = (ftp > 0 && weight > 0) ? `${(ftp / weight).toFixed(2)} W/kg` : '';
  }

  // Âge auto
  const birth = form.elements['x_birth_date']?.value;
  const ageEl = document.getElementById('x_age_display');
  if (ageEl) {
    if (birth) {
      const b = new Date(birth);
      const now = new Date();
      let age = now.getFullYear() - b.getFullYear();
      if (now.getMonth() < b.getMonth() || (now.getMonth() === b.getMonth() && now.getDate() < b.getDate())) age--;
      ageEl.textContent = `${age} ans`;
    } else {
      ageEl.textContent = '';
    }
  }

  // Tables de zones
  renderZoneTables({ ftp, lthr, vThr });
}

function renderZoneTables({ ftp, lthr, vThr }) {
  // Coggan power zones (% FTP)
  const powerZones = [
    { z: 'Z1 — Recovery',  lo: 0,   hi: 55,  color: '#9ca3af' },
    { z: 'Z2 — Endurance', lo: 56,  hi: 75,  color: '#60a5fa' },
    { z: 'Z3 — Tempo',     lo: 76,  hi: 90,  color: '#4ade80' },
    { z: 'Z4 — Threshold', lo: 91,  hi: 105, color: '#fbbf24' },
    { z: 'Z5 — VO2max',    lo: 106, hi: 120, color: '#fb923c' },
    { z: 'Z6 — Anaerobic', lo: 121, hi: 150, color: '#f87171' },
    { z: 'Z7 — Sprint',    lo: 151, hi: 200, color: '#c084fc' },
  ];
  const elP = document.getElementById('profile-zones-power');
  if (elP) elP.innerHTML = buildZoneTableHTML(powerZones, ftp, 'W', v => Math.round(v));

  // Friel HR zones (% LTHR)
  const hrZones = [
    { z: 'Z1 — Recovery',     lo: 0,   hi: 80,  color: '#9ca3af' },
    { z: 'Z2 — Aerobic',      lo: 81,  hi: 89,  color: '#60a5fa' },
    { z: 'Z3 — Tempo',        lo: 90,  hi: 93,  color: '#4ade80' },
    { z: 'Z4 — Sub-threshold',lo: 94,  hi: 99,  color: '#fbbf24' },
    { z: 'Z5a — Threshold',   lo: 100, hi: 102, color: '#fb923c' },
    { z: 'Z5b — VO2max',      lo: 103, hi: 106, color: '#f87171' },
    { z: 'Z5c — Anaerobic',   lo: 107, hi: 120, color: '#c084fc' },
  ];
  const elH = document.getElementById('profile-zones-hr');
  if (elH) elH.innerHTML = buildZoneTableHTML(hrZones, lthr, 'bpm', v => Math.round(v));

  // Pace zones (% threshold speed) — affichage en km/h
  const paceZones = [
    { z: 'Z1 — Recovery',  lo: 0,   hi: 80,  color: '#9ca3af' },
    { z: 'Z2 — Endurance', lo: 81,  hi: 88,  color: '#60a5fa' },
    { z: 'Z3 — Tempo',     lo: 89,  hi: 94,  color: '#4ade80' },
    { z: 'Z4 — Threshold', lo: 95,  hi: 102, color: '#fbbf24' },
    { z: 'Z5 — VO2max',    lo: 103, hi: 110, color: '#f87171' },
  ];
  const elPA = document.getElementById('profile-zones-pace');
  if (elPA) elPA.innerHTML = buildZoneTableHTML(paceZones, vThr, 'km/h', v => v.toFixed(1));
}

function buildZoneTableHTML(zones, ref, unit, fmt) {
  if (!ref || ref <= 0) {
    return `<div class="profile-zones-empty">— Valeur de référence manquante —</div>`;
  }
  return `
    <table class="profile-zones-grid">
      <thead>
        <tr><th>Zone</th><th>%</th><th>Valeur</th></tr>
      </thead>
      <tbody>
        ${zones.map(z => `
          <tr>
            <td><span class="profile-zone-dot" style="background:${z.color}"></span>${z.z}</td>
            <td><span class="profile-zone-range">${z.lo}-${z.hi}%</span></td>
            <td><b>${fmt(ref * z.lo / 100)} - ${fmt(ref * z.hi / 100)} ${unit}</b></td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

// ============================================================
// SIDEBAR / NAV INTERNE
// ============================================================
function switchSection(id) {
  _activeSection = id;
  _panel.querySelectorAll('.profile-sidebar-item').forEach(b => {
    b.classList.toggle('active', b.dataset.section === id);
  });
  _panel.querySelectorAll('.profile-section-panel').forEach(p => {
    p.classList.toggle('active', p.dataset.section === id);
  });
  // Recompute (zones depend on FTP/LTHR which may have been set elsewhere)
  if (id === 'zones') updateDerivedFields();
  // Scroll en haut du contenu
  const content = document.getElementById('profile-content');
  if (content) content.scrollTo({ top: 0, behavior: 'instant' });
}

// ============================================================
// COMPLÉTION (% du profil rempli)
// ============================================================
function computeCompletion() {
  const form = document.getElementById('profile-modal-form');
  if (!form) return 0;
  const fields = Array.from(form.querySelectorAll('input[name], select[name], textarea[name]'));
  // On exclut les boutons et radios sans valeur ; on garde tout le reste
  let total = 0, filled = 0;
  for (const f of fields) {
    if (f.type === 'submit' || f.type === 'button') continue;
    total++;
    if (f.type === 'checkbox') {
      if (f.checked) filled++;
      continue;
    }
    if (f.value && String(f.value).trim() !== '') filled++;
  }
  if (total === 0) return 0;
  return Math.round((filled / total) * 100);
}

function updateCompletion() {
  const pct = computeCompletion();
  const pctEl = document.getElementById('profile-completion-pct');
  const fillEl = document.getElementById('profile-completion-fill');
  if (pctEl) pctEl.textContent = `${pct}%`;
  if (fillEl) fillEl.style.width = `${pct}%`;
}

function updateDirtyState() {
  const status = document.getElementById('profile-actions-status');
  if (!status) return;
  const v = valuesFromForm();
  const dirty = JSON.stringify(v.main) !== JSON.stringify(_initialMain)
             || JSON.stringify(v.extras) !== JSON.stringify(_initialExtras);
  status.textContent = dirty ? 'Modifications non enregistrées' : 'Aucune modification';
  status.classList.toggle('dirty', dirty);
}

// ============================================================
// FORM I/O
// ============================================================
function valuesFromForm() {
  const form = document.getElementById('profile-modal-form');
  if (!form) return { main: {}, extras: {} };
  const main = {};
  const extras = {};
  for (const el of form.elements) {
    if (!el.name) continue;
    let val;
    if (el.type === 'checkbox') val = el.checked;
    else if (el.type === 'number') {
      const v = el.value;
      val = (v === '' || v === null) ? null : (parseFloat(v) || null);
    } else {
      val = el.value === '' ? null : el.value;
    }
    if (el.name.startsWith('x_')) {
      extras[el.name.slice(2)] = val;
    } else {
      main[el.name] = val;
    }
  }
  return { main, extras };
}

function populateForm({ main = {}, extras = {} }) {
  const form = document.getElementById('profile-modal-form');
  if (!form) return;
  for (const el of form.elements) {
    if (!el.name) continue;
    let val;
    if (el.name.startsWith('x_')) val = extras[el.name.slice(2)];
    else val = main[el.name];
    if (val === undefined || val === null) {
      if (el.type === 'checkbox') el.checked = false;
      else el.value = '';
    } else {
      if (el.type === 'checkbox') el.checked = !!val;
      else el.value = val;
    }
  }
  updateDerivedFields();
  updateCompletion();
  updateDirtyState();
}

async function loadProfile() {
  const sb = window.sb;
  if (!sb) return { main: {}, extras: {} };
  const { data: { session } } = await sb.auth.getSession();
  if (!session) return { main: {}, extras: {} };
  // On tente de récupérer extras ; si la colonne n'existe pas, fallback gracieux
  let data = null, error = null;
  try {
    const res = await sb
      .from('user_profiles')
      .select('display_name, weight, ftp, hr_max, lthr, extras')
      .eq('user_id', session.user.id)
      .maybeSingle();
    data = res.data; error = res.error;
  } catch (e) { error = e; }

  if (error && /extras/i.test(error.message || '')) {
    // Colonne extras manquante : on requote sans
    const res2 = await sb
      .from('user_profiles')
      .select('display_name, weight, ftp, hr_max, lthr')
      .eq('user_id', session.user.id)
      .maybeSingle();
    data = res2.data;
  } else if (error) {
    console.error('[profile] load error:', error);
  }
  return {
    main: {
      display_name: data?.display_name || '',
      weight: data?.weight,
      ftp: data?.ftp,
      hr_max: data?.hr_max,
      lthr: data?.lthr,
    },
    extras: data?.extras || {},
  };
}

function showError(msg) {
  const el = document.getElementById('profile-error');
  if (!el) return;
  el.textContent = msg || '';
  el.hidden = !msg;
  if (msg) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
}
function setSaving(saving) {
  const btn = document.getElementById('profile-save');
  if (!btn) return;
  btn.disabled = saving;
  btn.textContent = saving ? 'Enregistrement…' : 'Enregistrer';
}

async function saveProfile(e) {
  if (e) e.preventDefault();
  showError('');
  const sb = window.sb;
  if (!sb) { showError('Supabase non initialisé.'); return; }
  const { data: { session } } = await sb.auth.getSession();
  if (!session) { showError('Tu n\'es pas connecté.'); return; }

  const { main, extras } = valuesFromForm();
  setSaving(true);
  try {
    const payload = {
      user_id: session.user.id,
      display_name: main.display_name,
      weight: main.weight,
      ftp: main.ftp,
      hr_max: main.hr_max,
      lthr: main.lthr,
      extras,
      updated_at: new Date().toISOString(),
    };
    let { error } = await sb.from('user_profiles').upsert(payload, { onConflict: 'user_id' });
    if (error && /extras/i.test(error.message || '')) {
      // Colonne extras manquante : on retente sans, et on prévient
      delete payload.extras;
      const r2 = await sb.from('user_profiles').upsert(payload, { onConflict: 'user_id' });
      if (r2.error) throw r2.error;
      showSavedToast({ partial: true });
    } else if (error) {
      throw error;
    } else {
      showSavedToast({ partial: false });
    }

    // Détecter changement de zone pour re-sync Strava
    const zoneChanged = _initialMain && (
      Number(_initialMain.ftp || 0) !== Number(main.ftp || 0) ||
      Number(_initialMain.hr_max || 0) !== Number(main.hr_max || 0) ||
      Number(_initialMain.lthr || 0) !== Number(main.lthr || 0)
    );

    _initialMain = { ...main };
    _initialExtras = JSON.parse(JSON.stringify(extras));
    updateDirtyState();

    if (window.DASHBOARD_DATA?.athlete) {
      Object.assign(window.DASHBOARD_DATA.athlete, {
        name: main.display_name || window.DASHBOARD_DATA.athlete.name,
        ftp: main.ftp || 0,
        hr_max: main.hr_max || 0,
        lthr: main.lthr || 0,
        weight: main.weight || 0,
      });
    }

    if (zoneChanged) {
      setTimeout(async () => {
        const wantSync = window.appConfirm
          ? await window.appConfirm({
              title: 'Recalculer les TSS passés',
              message: 'Tu as modifié FTP, HRmax ou LTHR. Veux-tu relancer une re-synchro Strava maintenant pour recalculer les TSS des activités passées avec les nouvelles valeurs ?',
              confirmLabel: 'Re-synchroniser',
              cancelLabel: 'Plus tard',
            })
          : confirm('Recalculer les TSS passés ?');
        if (wantSync && window.startStravaIngest) window.startStravaIngest();
      }, 400);
    }
  } catch (err) {
    console.error('[profile] save error:', err);
    showError(err.message || 'Erreur d\'enregistrement.');
  } finally {
    setSaving(false);
  }
}

function showSavedToast({ partial = false } = {}) {
  const toast = document.createElement('div');
  toast.className = 'profile-saved-toast' + (partial ? ' partial' : '');
  toast.innerHTML = `
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
    ${partial ? 'Profil partiellement enregistré (colonne extras manquante)' : 'Profil enregistré'}
  `;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), partial ? 5000 : 2500);
}

// ============================================================
// AVATAR : preview + upload + compression
// ============================================================
function updateAvatarPreview() {
  const form = document.getElementById('profile-modal-form');
  const prev = document.getElementById('profile-avatar-preview');
  if (!form || !prev) return;
  const url = form.elements['x_avatar_url']?.value;
  const name = form.elements['display_name']?.value || form.elements['x_full_name']?.value || '?';
  const removeBtn = document.getElementById('profile-avatar-remove');
  if (url) {
    prev.innerHTML = `<img src="${url}" alt="">`;
    if (removeBtn) removeBtn.hidden = false;
  } else {
    prev.textContent = (name[0] || '?').toUpperCase();
    if (removeBtn) removeBtn.hidden = true;
  }
}

// Compresse une image (File) à max 256x256 en JPEG qualité 0.85 → data URL
async function compressImage(file, maxSize = 256, quality = 0.85) {
  if (!file || !file.type.startsWith('image/')) throw new Error('Fichier non valide');
  const dataUrl = await new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(new Error('Lecture du fichier impossible'));
    r.readAsDataURL(file);
  });
  const img = await new Promise((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error('Image illisible'));
    i.src = dataUrl;
  });
  // Carré centré
  const side = Math.min(img.width, img.height);
  const sx = (img.width - side) / 2;
  const sy = (img.height - side) / 2;
  const out = Math.min(maxSize, side);
  const canvas = document.createElement('canvas');
  canvas.width = out;
  canvas.height = out;
  const ctx = canvas.getContext('2d');
  // Lissage
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, sx, sy, side, side, 0, 0, out, out);
  // Toujours JPEG pour la taille (sauf PNG transparent → on garde PNG)
  // Pour simplicité on force JPEG
  return canvas.toDataURL('image/jpeg', quality);
}

async function handleAvatarFile(file) {
  const hint = document.getElementById('profile-avatar-hint');
  const form = document.getElementById('profile-modal-form');
  if (!form || !file) return;
  try {
    if (hint) hint.textContent = 'Compression…';
    const dataUrl = await compressImage(file, 256, 0.85);
    // Garde-fou taille (au cas où le JPEG fait quand même + de 200 Ko)
    const sizeKo = Math.round(dataUrl.length * 0.75 / 1024);
    if (sizeKo > 250) {
      // Re-essai avec une qualité plus basse
      const dataUrl2 = await compressImage(file, 200, 0.7);
      form.elements['x_avatar_url'].value = dataUrl2;
    } else {
      form.elements['x_avatar_url'].value = dataUrl;
    }
    if (hint) hint.textContent = `Image compressée (~${Math.round(form.elements['x_avatar_url'].value.length * 0.75 / 1024)} Ko).`;
    updateAvatarPreview();
    updateCompletion();
    updateDirtyState();
  } catch (e) {
    console.error('[profile-avatar]', e);
    if (hint) hint.textContent = 'Erreur : ' + (e.message || e);
  }
}

function clearAvatar() {
  const form = document.getElementById('profile-modal-form');
  if (!form) return;
  form.elements['x_avatar_url'].value = '';
  const fileInput = document.getElementById('profile-avatar-input');
  if (fileInput) fileInput.value = '';
  const hint = document.getElementById('profile-avatar-hint');
  if (hint) hint.textContent = 'PNG, JPG ou WebP. Compressée automatiquement à 256×256.';
  updateAvatarPreview();
  updateCompletion();
  updateDirtyState();
}

// ============================================================
// ROUTAGE / OPEN / CLOSE
// ============================================================
function ensurePanel() {
  if (_panel && document.body.contains(_panel)) return _panel;
  _panel = buildPanel();
  const container = document.querySelector('.container') || document.body;
  container.appendChild(_panel);

  _panel.querySelector('#profile-back-btn').addEventListener('click', closeProfilePage);
  _panel.querySelector('#profile-cancel').addEventListener('click', closeProfilePage);
  _panel.querySelector('#profile-modal-form').addEventListener('submit', saveProfile);

  // Sidebar nav
  _panel.querySelectorAll('.profile-sidebar-item').forEach(b => {
    b.addEventListener('click', () => switchSection(b.dataset.section));
  });

  // Avatar : upload depuis fichier
  const pickBtn = _panel.querySelector('#profile-avatar-pick');
  const removeBtn = _panel.querySelector('#profile-avatar-remove');
  const fileInput = _panel.querySelector('#profile-avatar-input');
  if (pickBtn && fileInput) {
    pickBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', () => {
      const f = fileInput.files && fileInput.files[0];
      if (f) handleAvatarFile(f);
    });
  }
  if (removeBtn) removeBtn.addEventListener('click', clearAvatar);
  // Drag & drop sur la preview
  const prev = _panel.querySelector('#profile-avatar-preview');
  if (prev) {
    prev.addEventListener('dragover', (e) => { e.preventDefault(); prev.classList.add('drag-over'); });
    prev.addEventListener('dragleave', () => prev.classList.remove('drag-over'));
    prev.addEventListener('drop', (e) => {
      e.preventDefault();
      prev.classList.remove('drag-over');
      const f = e.dataTransfer?.files && e.dataTransfer.files[0];
      if (f) handleAvatarFile(f);
    });
    prev.addEventListener('click', () => fileInput && fileInput.click());
    prev.style.cursor = 'pointer';
    prev.title = 'Cliquer ou glisser une image';
  }

  // Listeners pour calculs auto
  _panel.addEventListener('input', (e) => {
    updateDerivedFields();
    updateCompletion();
    updateDirtyState();
    if (e.target && (e.target.name === 'x_avatar_url' || e.target.name === 'display_name' || e.target.name === 'x_full_name')) {
      updateAvatarPreview();
    }
  });
  _panel.addEventListener('change', () => {
    updateDerivedFields();
    updateCompletion();
    updateDirtyState();
  });

  return _panel;
}

async function openProfilePage(skipHash = false) {
  ensurePanel();

  const activeTab = document.querySelector('.tabs .tab.active');
  if (activeTab && activeTab !== _previousTabBtn) _previousTabBtn = activeTab;

  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.tabs .tab').forEach(b => b.classList.remove('active'));

  _panel.classList.add('active');
  const tabsBar = document.querySelector('.tabs');
  if (tabsBar) tabsBar.classList.add('profile-hidden');

  if (!skipHash && window.location.hash !== ROUTE_HASH) {
    history.pushState(null, '', ROUTE_HASH);
  }
  window.scrollTo({ top: 0, behavior: 'instant' });

  showError('');
  setSaving(false);
  switchSection(_activeSection || 'identity');

  populateForm({});
  const loaded = await loadProfile();
  _initialMain = { ...loaded.main };
  _initialExtras = JSON.parse(JSON.stringify(loaded.extras || {}));
  populateForm(loaded);
  updateAvatarPreview();
}

function closeProfilePage() {
  if (_panel) _panel.classList.remove('active');
  const tabsBar = document.querySelector('.tabs');
  if (tabsBar) tabsBar.classList.remove('profile-hidden');

  const target = _previousTabBtn && document.body.contains(_previousTabBtn)
    ? _previousTabBtn
    : document.querySelector('.tabs .tab');
  if (target) {
    document.querySelectorAll('.tabs .tab').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    target.classList.add('active');
    const panel = document.getElementById(target.dataset.panel);
    if (panel) panel.classList.add('active');
  }
  if (window.location.hash === ROUTE_HASH) {
    history.pushState(null, '', window.location.pathname + window.location.search);
  }
}

function handleHashChange() {
  if (window.location.hash === ROUTE_HASH) {
    openProfilePage(true);
  } else if (_panel && _panel.classList.contains('active')) {
    closeProfilePage();
  }
}

window.addEventListener('hashchange', handleHashChange);
window.addEventListener('popstate', handleHashChange);

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    if (window.location.hash === ROUTE_HASH) {
      setTimeout(() => openProfilePage(true), 200);
    }
  });
} else {
  if (window.location.hash === ROUTE_HASH) {
    setTimeout(() => openProfilePage(true), 200);
  }
}

export async function openProfileModal() {
  await openProfilePage(false);
}

window.openProfileModal = openProfileModal;
window.closeProfileModal = closeProfilePage;
