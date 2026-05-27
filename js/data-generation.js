/* ============================================================
   js/data-generation.js — Générateur de données simulées (fallback dev)

   ATTENTION : code mort actuellement. Le pipeline utilise systématiquement
   data.js généré par fetch_data.py. Ce module est conservé comme fallback
   de développement si jamais on veut tester l'UI sans data.js réelle.

   Pour réactiver, importer { generateData } dans app.js et utiliser
   l'output au lieu de loadData() en mode dev.
   ============================================================ */

import { rand, randInt, clamp } from './utils.js';

export function generateData(today) {
  const days = 90;
  const data = [];
  let ctl = 55, atl = 55;
  let baseHRV = 62;

  // Pattern d'entraînement : 2 semaines build, 1 semaine récup
  for (let i = days - 1; i >= 0; i--) {
    const date = new Date(today);
    date.setDate(today.getDate() - i);
    const dow = date.getDay();
    const weekIndex = Math.floor((days - i) / 7);
    const isRecoveryWeek = (weekIndex % 4 === 3);

    // TSS du jour selon type de séance
    let tss = 0, sessionType = null, sessionName = null, duration = 0;
    if (dow === 1) { tss = 0; sessionName = "Repos"; } // lundi off
    else if (dow === 2) {
      tss = isRecoveryWeek ? rand(40, 55) : rand(70, 90);
      sessionType = "tempo"; sessionName = "Tempo / sweet spot";
      duration = randInt(60, 90);
    }
    else if (dow === 3) {
      tss = isRecoveryWeek ? rand(30, 45) : rand(55, 75);
      sessionType = "endurance"; sessionName = "Endurance Z2";
      duration = randInt(75, 120);
    }
    else if (dow === 4) {
      tss = isRecoveryWeek ? 0 : rand(85, 120);
      sessionType = "seuil"; sessionName = "Intervalles seuil";
      duration = randInt(70, 95);
      if (isRecoveryWeek) sessionName = "Repos";
    }
    else if (dow === 5) {
      tss = rand(25, 40);
      sessionType = "recup"; sessionName = "Récup active";
      duration = randInt(40, 60);
    }
    else if (dow === 6) {
      tss = isRecoveryWeek ? rand(60, 80) : rand(110, 160);
      sessionType = "vo2"; sessionName = "VO2max / blocs";
      duration = randInt(90, 130);
    }
    else if (dow === 0) {
      tss = isRecoveryWeek ? rand(80, 110) : rand(140, 200);
      sessionType = "endurance"; sessionName = "Sortie longue";
      duration = randInt(150, 240);
    }
    tss = Math.round(tss);

    // CTL / ATL
    ctl = ctl + (tss - ctl) / 42;
    atl = atl + (tss - atl) / 7;
    const tsb = ctl - atl;

    // Whoop simulé : récupération corrélée négativement à ATL+TSS
    const stressBase = (atl - 50) * 0.8 + tss * 0.15;
    let recovery = clamp(85 - stressBase + rand(-12, 12), 15, 99);
    recovery = Math.round(recovery);

    // HRV corrélé à recovery
    const hrv = Math.round(baseHRV + (recovery - 60) * 0.4 + rand(-4, 4));

    // Sommeil
    const sleepH = clamp(rand(6.5, 8.8) - (tss > 100 ? 0.3 : 0), 5, 9.5);
    const sleepQ = clamp(recovery + rand(-10, 10), 30, 100);

    data.push({
      date, tss, ctl: +ctl.toFixed(1), atl: +atl.toFixed(1), tsb: +tsb.toFixed(1),
      recovery, hrv, sleepH: +sleepH.toFixed(1), sleepQ: Math.round(sleepQ),
      sessionType, sessionName, duration,
      // Détails séance
      np: sessionType ? randInt(180, 280) : 0,
      hr: sessionType ? randInt(135, 168) : 0,
      ftpPct: sessionType ? randInt(72, 95) : 0,
      compliance: sessionType ? randInt(82, 102) : 0,
      // Zones de FC (% temps)
      zones: sessionType ? [
        randInt(5, 20), randInt(20, 45), randInt(15, 30), randInt(8, 20), randInt(2, 12)
      ] : null
    });
  }
  // Normaliser zones à 100%
  data.forEach(d => {
    if (d.zones) {
      const s = d.zones.reduce((a,b)=>a+b,0);
      d.zones = d.zones.map(z => Math.round(z * 100 / s));
    }
  });
  return data;
}
