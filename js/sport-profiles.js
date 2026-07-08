/* ============================================================
   js/sport-profiles.js — Profils d'AFFICHAGE par sport (architecture).

   Un profil définit, pour une catégorie de sport, ce que l'app affiche :
   - heroes(act, ctx)  : les grandes cartes (durée, distance, allure…)
   - tiles(act, ctx)   : les tuiles teintées (puissance, cardio, TSS…)
   - shortMeta(act)    : la ligne compacte des tuiles du calendrier

   Ajouter un sport (ex. triathlon) = ajouter une entrée dans PROFILES.
   Les unités s'adaptent : course → allure min/km, natation → distance en m
   et allure /100m, musculation → pas de distance/vitesse, etc.
   Consommé par app.js (modale jour, tuiles calendrier).
   ============================================================ */

(function () {
  'use strict';

  // ---- Icônes (SVG inline, stroke currentColor) ----
  var SVG = {
    clock: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
    route: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="19" r="2"/><circle cx="18" cy="5" r="2"/><path d="M8 19h7a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h7"/></svg>',
    speed: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="14" r="2"/><path d="M13.4 12.6 19 7"/><path d="M3.6 19a9 9 0 1 1 16.8 0"/></svg>',
    mtn: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 20 9 8l3.5 6 2.5-4.5L21 20Z"/></svg>',
    heart: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 14c1.5-1.5 2-3.2 2-5a5 5 0 0 0-9-3 5 5 0 0 0-9 3c0 1.8.5 3.5 2 5l7 7Z"/></svg>',
    zap: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>',
    dumbbell: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9v6M4 8v8M18 9v6M20 8v8M6 12h12"/></svg>',
    waves: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12c2-2 4-2 6 0s4 2 6 0 4-2 6 0M3 17c2-2 4-2 6 0s4 2 6 0 4-2 6 0"/></svg>',
    bike: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="17" r="3"/><circle cx="18" cy="17" r="3"/><path d="M6 17l5-9h3l-2 9"/><path d="M11 8h4l2 5"/></svg>',
    run: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="14" cy="5" r="1.6"/><path d="M6 21l3-5 2-3 2 2 1 4"/><path d="M11 13l-2-3 4-2 2 3 3 1"/></svg>',
  };

  var C = { blue: '#60a5fa', cyan: '#22d3ee', green: '#34d399', lime: '#84cc16', amber: '#f59e0b', yellow: '#fbbf24', red: '#f87171', purple: '#a78bfa', violet: '#c084fc', grey: '#9ca3af' };

  function fmtPace(secPer) {
    if (!isFinite(secPer) || secPer <= 0) return null;
    return Math.floor(secPer / 60) + ':' + String(Math.round(secPer % 60)).padStart(2, '0');
  }
  function fmtMinToTime(min) {
    min = Math.round(+min || 0);
    var hh = Math.floor(min / 60), mm = min % 60;
    return hh ? hh + 'h' + String(mm).padStart(2, '0') : mm + ' min';
  }
  function catOf(act) {
    var raw = act && (act.raw_type || act.sport_raw || act.sport) || '';
    return (typeof window.getSportCategory === 'function') ? window.getSportCategory(raw) : 'autre';
  }

  // ---- Briques réutilisables (chaque brique renvoie un descripteur ou null) ----
  var H = {
    duree: function (act, ctx) { return { svg: SVG.clock, val: ctx.durStr, unit: '', lab: ctx.elapsedSub ? ('Durée · ' + ctx.elapsedSub) : 'Durée', color: C.blue }; },
    distanceKm: function (act, ctx) { return ctx.distKm ? { svg: SVG.route, val: ctx.distKm, unit: 'km', lab: 'Distance', color: C.cyan } : null; },
    distanceM: function (act, ctx) { return ctx.distKm ? { svg: SVG.waves, val: Math.round(ctx.distKm * 1000), unit: 'm', lab: 'Distance', color: C.cyan } : null; },
    vitesse: function (act, ctx) {
      if (act.avg_speed_kmh) return { svg: SVG.speed, val: act.avg_speed_kmh, unit: 'km/h', lab: 'Vitesse moy', color: C.green };
      if (ctx.distKm && ctx.durMin) return { svg: SVG.speed, val: +(ctx.distKm / (ctx.durMin / 60)).toFixed(1), unit: 'km/h', lab: 'Vitesse moy', color: C.green };
      return null;
    },
    allureKm: function (act, ctx) {
      if (!ctx.distKm || !ctx.durMin) return null;
      var p = fmtPace((ctx.durMin * 60) / ctx.distKm);
      return p ? { svg: SVG.speed, val: p, unit: '/km', lab: 'Allure', color: C.green } : null;
    },
    allure100m: function (act, ctx) {
      if (!ctx.distKm || !ctx.durMin) return null;
      var p = fmtPace((ctx.durMin * 60) / (ctx.distKm * 10));
      return p ? { svg: SVG.speed, val: p, unit: '/100m', lab: 'Allure', color: C.green } : null;
    },
    deniv: function (act, ctx) { return ctx.dplusM ? { svg: SVG.mtn, val: ctx.dplusM, unit: 'm D+', lab: 'Dénivelé', color: C.lime } : null; },
    np: function (act) { return act.np ? { svg: SVG.zap, val: act.np, unit: 'W', lab: 'NP', color: C.yellow } : null; },
    cardio: function (act) { return act.hr ? { svg: SVG.heart, val: act.hr, unit: 'bpm', lab: 'FC moy', color: C.red } : null; },
    charge: function (act) { return act.tss ? { svg: SVG.zap, val: act.tss, unit: 'TSS', lab: 'Charge', color: C.yellow } : null; },
    energie: function (act) { return act.calories ? { svg: SVG.dumbbell, val: act.calories, unit: 'kcal', lab: 'Énergie', color: C.grey } : null; },
  };

  var T = {
    cible: function (act) { return (act.category === 'competition' && act.target != null && act.target !== '') ? { lab: 'Temps cible', val: fmtMinToTime(act.target), color: C.violet } : null; },
    puissance: function (act) { return act.avg_watts ? { lab: 'Puissance · W', val: act.avg_watts + ' moy' + (act.max_watts ? ' · ' + act.max_watts + ' max' : ''), color: C.amber } : null; },
    np: function (act) { return act.np ? { lab: 'NP' + (act.ftpPct ? ' · ' + act.ftpPct + '% FTP' : ''), val: act.np + ' W' + (act.intensity ? ' · IF ' + act.intensity : ''), color: C.yellow } : null; },
    cardio: function (act) { return act.hr ? { lab: 'Cardio · bpm', val: act.hr + ' moy' + (act.max_hr ? ' · ' + act.max_hr + ' max' : ''), color: C.red } : null; },
    cadenceRpm: function (act) { return act.cadence ? { lab: 'Cadence · rpm', val: '' + act.cadence + (act.max_cadence ? ' · ' + act.max_cadence + ' max' : ''), color: C.purple } : null; },
    cadencePas: function (act) { return act.cadence ? { lab: 'Cadence · ppm', val: '' + act.cadence + (act.max_cadence ? ' · ' + act.max_cadence + ' max' : ''), color: C.purple } : null; },
    tss: function (act) { return act.tss ? { lab: 'TSS', val: '' + act.tss, color: C.grey } : null; },
    energie: function (act) { return act.kj ? { lab: 'Énergie', val: act.kj + ' kJ' + (act.calories ? ' · ' + act.calories + ' kcal' : ''), color: C.grey } : (act.calories ? { lab: 'Énergie', val: act.calories + ' kcal', color: C.grey } : null); },
    rpe: function (act) { return act.rpe ? { lab: 'RPE', val: act.rpe + '/10', color: C.grey } : null; },
    tours: function (act) { return act.laps ? { lab: 'Tours', val: '' + act.laps, color: C.grey } : null; },
    longueurs: function (act) { return act.laps ? { lab: 'Longueurs', val: '' + act.laps, color: C.grey } : null; },
  };

  // ---- Profils par catégorie de sport ----
  // heroes : max 4 affichés (les null sont filtrés, ordre = priorité)
  var PROFILES = {
    cyclisme: {
      heroes: [H.duree, H.distanceKm, H.vitesse, H.deniv, H.np],
      tiles: [T.cible, T.puissance, T.np, T.cardio, T.cadenceRpm, T.tss, T.energie, T.rpe, T.tours],
      shortMeta: function (act, ctx) { return [ctx.durShort, ctx.distKm ? Math.round(ctx.distKm) + ' km' : null]; },
    },
    course: {
      heroes: [H.duree, H.distanceKm, H.allureKm, H.deniv, H.cardio],
      tiles: [T.cible, T.cardio, T.cadencePas, T.tss, T.energie, T.rpe, T.tours],
      shortMeta: function (act, ctx) {
        var p = (ctx.distKm && ctx.durMin) ? fmtPace((ctx.durMin * 60) / ctx.distKm) : null;
        return [ctx.durShort, ctx.distKm ? (+ctx.distKm).toFixed(1) + ' km' : null, p ? p + '/km' : null];
      },
    },
    natation: {
      heroes: [H.duree, H.distanceM, H.allure100m, H.cardio, H.charge],
      tiles: [T.cible, T.cardio, T.tss, T.energie, T.rpe, T.longueurs],
      shortMeta: function (act, ctx) { return [ctx.durShort, ctx.distKm ? Math.round(ctx.distKm * 1000) + ' m' : null]; },
    },
    musculation: {
      heroes: [H.duree, H.charge, H.cardio, H.energie],
      tiles: [T.cardio, T.tss, T.energie, T.rpe, T.tours],
      shortMeta: function (act, ctx) { return [ctx.durShort, act.tss ? act.tss + ' TSS' : null]; },
    },
    // Triathlon : profil d'événement combiné. L'affichage groupé (natation +
    // vélo + course reliés) viendra avec le chantier de regroupement ; en
    // attendant chaque segment garde le profil de SA discipline.
    triathlon: {
      heroes: [H.duree, H.distanceKm, H.vitesse, H.cardio],
      tiles: [T.cible, T.cardio, T.tss, T.energie, T.rpe],
      shortMeta: function (act, ctx) { return [ctx.durShort, ctx.distKm ? Math.round(ctx.distKm) + ' km' : null]; },
    },
    autre: {
      heroes: [H.duree, H.distanceKm, H.vitesse, H.deniv, H.cardio],
      tiles: [T.cible, T.puissance, T.np, T.cardio, T.cadenceRpm, T.tss, T.energie, T.rpe, T.tours],
      shortMeta: function (act, ctx) { return [ctx.durShort, ctx.distKm ? Math.round(ctx.distKm) + ' km' : null]; },
    },
  };

  function profileFor(act) {
    var cat = catOf(act);
    return PROFILES[cat] || PROFILES.autre;
  }
  function build(list, act, ctx) {
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var d = null;
      try { d = list[i](act, ctx); } catch (e) { /* brique indisponible */ }
      if (d) out.push(d);
    }
    return out;
  }

  // ============================================================
  // MULTISPORT : détecte un enchaînement type triathlon dans les
  // activités d'un jour (catégories différentes, chronologiquement
  // consécutives, transitions <= 45 min). Renvoie null sinon.
  // ============================================================
  var MS_CATS = { natation: 1, cyclisme: 1, course: 1 };
  var MS_GLYPH = { natation: SVG.waves, cyclisme: SVG.bike, course: SVG.run };
  var MS_COLOR = { natation: '#06b6d4', cyclisme: '#3b82f6', course: '#fc4c02' };

  function startMinOf(act) {
    var m = act && act.start_date_local && String(act.start_date_local).match(/T(\d{2}):(\d{2})/);
    return m ? (+m[1]) * 60 + (+m[2]) : null;
  }

  function detectMultisport(acts) {
    if (!Array.isArray(acts) || acts.length < 2) return null;
    var legs = acts
      .map(function (a, i) { return { act: a, idx: i, cat: catOf(a), start: startMinOf(a), dur: +a.duration || 0 }; })
      .filter(function (l) { return MS_CATS[l.cat] && l.start != null && l.dur > 0; });
    if (legs.length < 2) return null;
    legs.sort(function (a, b) { return a.start - b.start; });
    // Chaîne consécutive : catégorie différente de la précédente, transition <= 45 min
    var chain = [legs[0]];
    for (var i = 1; i < legs.length; i++) {
      var prev = chain[chain.length - 1];
      var gap = legs[i].start - (prev.start + prev.dur);
      if (legs[i].cat !== prev.cat && gap >= -5 && gap <= 45) chain.push(legs[i]);
    }
    if (chain.length < 2) return null;
    var cats = chain.map(function (l) { return l.cat; });
    var uniq = {}; cats.forEach(function (c) { uniq[c] = 1; });
    var nCats = Object.keys(uniq).length;
    var kind = 'Multisport';
    var seq = cats.join('>');
    if (nCats === 3) kind = 'Triathlon';
    else if (seq === 'course>cyclisme>course') kind = 'Duathlon';
    else if (seq === 'natation>course') kind = 'Aquathlon';
    else if (seq === 'natation>cyclisme') kind = 'Aquabike';
    else if (seq === 'cyclisme>course') kind = 'Brick vélo-course';
    var transitions = [];
    for (var t = 1; t < chain.length; t++) {
      transitions.push(Math.max(0, Math.round((chain[t].start - (chain[t - 1].start + chain[t - 1].dur)) * 60))); // secondes
    }
    var totals = {
      durMin: chain.reduce(function (x, l) { return x + l.dur; }, 0),
      tss: chain.reduce(function (x, l) { return x + (+l.act.tss || 0); }, 0),
      kcal: chain.reduce(function (x, l) { return x + (+l.act.calories || 0); }, 0),
    };
    return { kind: kind, legs: chain, transitions: transitions, totals: totals, sport: 'Triathlon', category: 'triathlon' };
  }

  function fmtDurShort(min) {
    var hh = Math.floor(min / 60), mm = Math.round(min % 60);
    return hh > 0 ? hh + 'h' + String(mm).padStart(2, '0') : mm + ' min';
  }
  function fmtSec(sec) {
    var m = Math.floor(sec / 60), s2 = sec % 60;
    return m + ':' + String(s2).padStart(2, '0');
  }

  // HTML du bandeau groupé (segments cliquables -> data-leg-idx = index activité)
  // comp (optionnel) : compétition planifiée rapprochée { name, target (min), priority }
  function renderMultisportHTML(group, activeIdx, comp) {
    var head = '<div class="msg-head">'
      + '<span class="msg-kind">' + group.kind + (comp && comp.name ? ' · ' + comp.name : '') + '</span>'
      + '<span class="msg-totals">' + fmtDurShort(group.totals.durMin)
      + (group.totals.tss ? ' · ' + Math.round(group.totals.tss) + ' TSS' : '')
      + (group.totals.kcal ? ' · ' + Math.round(group.totals.kcal) + ' kcal' : '') + '</span>'
      + '</div>';
    // Comparaison au temps cible de la compétition
    if (comp && comp.target > 0) {
      var delta = group.totals.durMin - comp.target;
      var ok = delta <= comp.target * 0.02;
      var col = ok ? 'var(--accent)' : (delta <= comp.target * 0.08 ? 'var(--warn)' : 'var(--danger)');
      head += '<div class="msg-comp-target">Cible ' + fmtDurShort(comp.target) + ' · réalisé '
        + fmtDurShort(group.totals.durMin)
        + ' <b style="color:' + col + '">(' + (delta > 0 ? '+' : '−') + fmtDurShort(Math.abs(delta)) + ')</b></div>';
    }
    var rows = [];
    for (var i = 0; i < group.legs.length; i++) {
      var l = group.legs[i];
      var meta = (window.SportProfiles ? window.SportProfiles.shortMeta(l.act) : []).join(' · ');
      rows.push('<button type="button" class="msg-seg' + (l.idx === activeIdx ? ' active' : '') + '" data-leg-idx="' + l.idx + '" style="--seg-c:' + (MS_COLOR[l.cat] || '#9ca3af') + '">'
        + '<span class="msg-seg-ico">' + (MS_GLYPH[l.cat] || '') + '</span>'
        + '<span class="msg-seg-name">' + (l.cat.charAt(0).toUpperCase() + l.cat.slice(1)) + '</span>'
        + '<span class="msg-seg-meta">' + meta + '</span>'
        + '</button>');
      if (i < group.legs.length - 1) {
        rows.push('<div class="msg-trans">T' + (i + 1) + ' · ' + fmtSec(group.transitions[i]) + '</div>');
      }
    }
    return '<div class="modal-section msg-group">' + head + '<div class="msg-segs">' + rows.join('') + '</div></div>';
  }

  // ---- Config des FORMULAIRES de création (entraînement / compétition / bibliothèque) ----
  // dist : 'km' | 'm' | null (champ masqué) ; dplus/gpx : bool ; laps : libellé custom
  var FORM = {
    cyclisme: { dist: 'km', dplus: true, gpx: true, laps: 'Nombre de tours' },
    course: { dist: 'km', dplus: true, gpx: true, laps: 'Nombre de tours' },
    natation: { dist: 'm', dplus: false, gpx: false, laps: 'Longueurs' },
    musculation: { dist: null, dplus: false, gpx: false, laps: 'Séries' },
    triathlon: { dist: 'km', dplus: true, gpx: true, laps: 'Nombre de tours' },
    autre: { dist: 'km', dplus: true, gpx: true, laps: 'Nombre de tours' },
  };

  window.SportProfiles = {
    categoryOf: catOf,
    detectMultisport: detectMultisport,
    renderMultisportHTML: renderMultisportHTML,
    formConfig: function (sportVal) {
      var cat = (typeof window.getSportCategory === 'function') ? window.getSportCategory(sportVal || '') : 'autre';
      return FORM[cat] || FORM.autre;
    },
    profiles: PROFILES,   // extensible : SportProfiles.profiles.escalade = {...}
    bricks: { heroes: H, tiles: T, svg: SVG, colors: C },
    heroes: function (act, ctx) { return build(profileFor(act).heroes, act, ctx); },
    tiles: function (act, ctx) { return build(profileFor(act).tiles, act, ctx); },
    // Ligne compacte pour les tuiles du calendrier — renvoie un tableau de strings
    shortMeta: function (act) {
      var durMin = act.duration || 0;
      var hh = Math.floor(durMin / 60), mm = Math.round(durMin % 60);
      var ctx = {
        durMin: durMin,
        durShort: durMin ? (hh > 0 ? hh + 'h' + (mm ? String(mm).padStart(2, '0') : '') : mm + ' min') : null,
        distKm: act.distance_km || act.km || 0,
      };
      var fn = profileFor(act).shortMeta;
      var parts = fn ? fn(act, ctx) : [ctx.durShort];
      return (parts || []).filter(Boolean);
    },
  };
})();
