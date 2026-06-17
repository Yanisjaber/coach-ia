/* ============================================================
   js/coach-overview.js - Vue d'ensemble coach (par athlete)
   Panneau #p-overview : header readiness + alertes + charge/forme +
   conformite plan + monitoring + dernieres seances + notes coach.
   Branche sur window.DASHBOARD_DATA (charge via viewAsAthlete) + localStorage.
   ============================================================ */

window.coachEnsureOverview = function () {
  if (document.getElementById('p-overview')) return;
  const container = document.querySelector('.container');
  const nav = document.querySelector('.sidebar-nav');
  if (!container || !nav) return;

  const panel = document.createElement('section');
  panel.className = 'panel'; panel.id = 'p-overview';
  panel.innerHTML = '<div id="co-body"></div>';
  container.appendChild(panel);

  const tab = document.createElement('button');
  tab.className = 'tab'; tab.dataset.panel = 'p-overview'; tab.id = 'coach-overview-tab';
  tab.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><path d="M18.7 8l-5.1 5.2-2.8-2.7L7 14.3"/></svg><span>Vue d’ensemble</span>';
  tab.addEventListener('click', window.coachShowOverview);
  // inserer juste apres l'onglet Athletes
  const athTab = document.getElementById('coach-athletes-tab');
  if (athTab && athTab.nextSibling) nav.insertBefore(tab, athTab.nextSibling);
  else nav.appendChild(tab);
};

window.coachShowOverview = function () {
  document.querySelectorAll('.tab').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  const tab = document.getElementById('coach-overview-tab');
  const panel = document.getElementById('p-overview');
  if (tab) tab.classList.add('active');
  if (panel) panel.classList.add('active');
  const title = document.getElementById('topbar-title');
  if (title) title.textContent = 'Vue d’ensemble';
  renderOverview();
};

// Re-render quand les donnees de l'athlete arrivent
window.addEventListener('dashboardDataReplaced', () => {
  if (document.body.classList.contains('coach-has-athlete') && document.getElementById('p-overview')) {
    renderOverview();
  }
});

/* ---- Utils ---- */
function ls(key) { try { return JSON.parse(localStorage.getItem(key) || '[]'); } catch (e) { return []; } }
function esc(s){ return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function fmtDur(min){ return (window.fmtDur ? window.fmtDur(min) : (min + ' min')); }
function dStr(iso){ try{ return new Date(iso+'T12:00:00').toLocaleDateString('fr-FR',{day:'numeric',month:'short'});}catch(e){return iso;} }

function synthesize(o) {
  // o : { tsb, ctl, atl, acwr, rec, conf, planned, hasWhoop, sleepAvg }
  let status='ok', text='';
  if (o.rec != null && o.rec <= 33) { status='bad'; text='Recuperation tres basse aujourd\'hui : privilegier le repos ou une seance tres legere.'; }
  else if (o.acwr > 1.5) { status='bad'; text='Charge aigue tres elevee (ratio '+o.acwr.toFixed(2)+') : risque de blessure, une decharge s\'impose.'; }
  else if (o.acwr > 1.3) { status='warn'; text='Charge en forte hausse : surveiller la fatigue et eviter d\'empiler les seances dures.'; }
  else if (o.tsb > 22 && o.acwr && o.acwr < 0.8) { status='warn'; text='Tres frais mais la charge a fortement baisse : l\'athlete se desentraine, c\'est le moment de relancer le volume.'; }
  else if (o.tsb > 12) { status='ok'; text='Frais et disponible : bon moment pour une seance cle ou une competition.'; }
  else if (o.tsb < -25) { status='warn'; text='Fatigue marquee : prevoir de la recuperation avant de recharger.'; }
  else { status='ok'; text='Charge et forme equilibrees : poursuivre le plan en cours.'; }

  const actions=[];
  if (o.planned === 0) actions.push({t:'Planifier sa semaine d\'entrainement', go:'cal'});
  if (o.acwr > 1.3) actions.push({t:'Prevoir une journee de decharge', go:null});
  if (o.tsb > 22 && o.acwr && o.acwr < 0.8) actions.push({t:'Relancer le volume progressivement (endurance Z2)', go:'cal'});
  if (o.conf != null && o.conf < 70) actions.push({t:'Faire le point sur les seances manquees', go:'msg'});
  if (!o.hasWhoop) actions.push({t:'Demander a l\'athlete de connecter Whoop (suivi recup/sommeil)', go:'msg'});
  if (o.sleepAvg != null && o.sleepAvg < 7) actions.push({t:'Aborder le sommeil avec l\'athlete (<7h en moyenne)', go:'msg'});
  if (!actions.length) actions.push({t:'Rien d\'urgent : continuer le suivi', go:null});
  return { status, text, actions };
}

function renderOverview() {
  const body = document.getElementById('co-body');
  const D = window.DASHBOARD_DATA;
  if (!body) return;
  if (!D || !D.days || !D.days.length) { body.innerHTML = '<div class="co-empty">Aucune donnee pour cet athlete.</div>'; return; }

  const days = D.days;
  const last = days[days.length - 1];
  const ath = D.athlete || {};
  const name = (window.coachState && window.coachState.athleteName) || ath.name || 'Athlete';
  const today = new Date(last.date + 'T12:00:00');

  // ---- Sport principal (derniere activite) ----
  let sport = '';
  for (let i = days.length - 1; i >= 0 && !sport; i--) {
    const a = (days[i].activities || [])[0];
    if (a && a.sport) sport = window.getSportCategory ? window.getSportCategory(a.sport) : a.sport;
  }

  // ---- Compet a venir + phase ----
  const comps = ls('coach_ia_competitions_v1').map(c => ({ ...c, dObj: new Date((c.date||'')+'T12:00:00') }))
    .filter(c => c.date).sort((a,b)=>a.dObj-b.dObj);
  const nextComp = comps.find(c => c.dObj >= today);
  let phaseLabel = '', compChip = '';
  if (nextComp) {
    const dj = Math.ceil((nextComp.dObj - today)/86400000);
    let ph = 'Build';
    if (dj <= 7) ph = 'Race week'; else if (dj <= 28) ph = 'Affutage'; else if (dj <= 56) ph = 'Pic';
    phaseLabel = ph;
    compChip = '<span class="co-chip comp">'+esc(nextComp.name)+' · J-'+dj+'</span>';
  } else {
    phaseLabel = (last.tsb < -25) ? 'Recuperation' : 'Build';
  }

  // ---- Readiness ----
  const tsb = Math.round(last.tsb||0), ctl = Math.round(last.ctl||0), atl = Math.round(last.atl||0);
  const acwr = ctl > 0 ? (atl/ctl) : 0;
  const rec = (last.recovery!=null) ? Math.round(last.recovery) : null;

  // conformite 7j : TSS realise / TSS prevu (7 derniers jours)
  const wk = ls('coach_ia_trainings_v1');
  const d7 = new Date(today); d7.setDate(today.getDate()-6);
  const plannedTss7 = wk.filter(t=>{const d=new Date(t.date+'T12:00:00');return d>=d7&&d<=today;}).reduce((s,t)=>s+(+t.tss||0),0);
  const realTss7 = days.slice(-7).reduce((s,d)=>s+(+d.tss||0),0);
  const conf = plannedTss7 > 0 ? Math.round(Math.min(realTss7/plannedTss7,1.5)*100) : null;

  const tsbCls = tsb >= -10 ? 'ok' : (tsb >= -30 ? 'warn' : 'bad');
  const recCls = rec==null ? '' : (rec>=66?'ok':(rec<=33?'bad':'warn'));
  const acwrCls = acwr===0 ? '' : (acwr>1.5?'bad':(acwr>1.3||acwr<0.8?'warn':'ok'));
  const confCls = conf==null ? '' : (conf>=90?'ok':(conf>=70?'warn':'bad'));

  // ---- Alertes ----
  const alerts = [];
  if (acwr>1.3) alerts.push(['bad','▲','Ratio de charge a '+acwr.toFixed(2)+' (zone sure 0.8-1.3) — risque accru, envisager une decharge.']);
  if (rec!=null && rec<=33) alerts.push(['bad','▲','Recuperation tres basse ('+rec+'%) — seance intense deconseillee aujourd’hui.']);
  const sl = days.slice(-5).map(d=>d.sleepH).filter(v=>v!=null);
  if (sl.length>=3 && (sl.filter(v=>v<7).length>=3)) alerts.push(['warn','●','Sommeil < 7h sur plusieurs nuits recentes — vigilance fatigue.']);
  if (conf!=null && conf<70) alerts.push(['warn','●','Conformite au plan basse ('+conf+'%) — des seances prevues n’ont pas ete realisees.']);

  // ---- Graphe CTL/ATL/TSB (84 derniers jours) ----
  const series = days.slice(-84);
  const chart = buildChart(series);

  // ---- Conformite plan (semaine en cours) ----
  const monday = new Date(today); const dow=(monday.getDay()+6)%7; monday.setDate(monday.getDate()-dow);
  const sun = new Date(monday); sun.setDate(monday.getDate()+6);
  const weekPrevus = wk.map(t=>({...t,dObj:new Date(t.date+'T12:00:00')}))
    .filter(t=>t.dObj>=monday && t.dObj<=sun).sort((a,b)=>a.dObj-b.dObj);
  const planRows = weekPrevus.map(t=>{
    const dayRec = days.find(d=>d.date===t.date);
    const realAct = dayRec && (dayRec.activities||[]).find(a=>+a.tss>0);
    let st, tss;
    if (realAct){ st=['done','Realise']; tss=(+t.tss||0)+' → '+Math.round(realAct.tss)+' TSS'; }
    else if (t.dObj < new Date(today.toDateString())){ st=['miss','Manquee']; tss=(+t.tss||0)+' TSS'; }
    else { st=['todo','A venir']; tss=(+t.tss||0)+' TSS'; }
    const wd=['Lun','Mar','Mer','Jeu','Ven','Sam','Dim'][(t.dObj.getDay()+6)%7];
    return '<div class="prow"><span class="day">'+wd+'</span><span class="nm">'+esc(t.name||'Seance')+'</span><span class="tss">'+tss+'</span><span class="st '+st[0]+'">'+st[1]+'</span></div>';
  }).join('');
  const planHead = (plannedTss7>=0)
    ? 'Prevu '+Math.round(weekPrevus.reduce((s,t)=>s+(+t.tss||0),0))+' / realise '+Math.round(realTss7)+' TSS'
    : '';

  // ---- Monitoring ----
  const lastVal = (f)=>{ for(let i=days.length-1;i>=0;i--) if(days[i][f]!=null) return days[i][f]; return null; };
  const avgN = (f,n)=>{ const v=days.slice(-n).map(d=>d[f]).filter(x=>x!=null); return v.length? v.reduce((a,b)=>a+b,0)/v.length : null; };
  const hrv = lastVal('hrv'), rhr = lastVal('rhr');
  const slAvg = avgN('sleepH',7);
  const monHtml =
    monTile('HRV', hrv!=null? Math.round(hrv)+' ms':'—') +
    monTile('Sommeil moy 7j', slAvg!=null? fmtSleep(slAvg):'—') +
    monTile('FC repos', rhr!=null? Math.round(rhr)+' bpm':'—') +
    monTile('Recup moy 7j', avgN('recovery',7)!=null? Math.round(avgN('recovery',7))+'%':'—');

  // ---- Dernieres seances ----
  const recent = [];
  for (let i=days.length-1;i>=0 && recent.length<5;i--){
    for (const a of (days[i].activities||[])){ if(recent.length<5 && +a.tss>0) recent.push({date:days[i].date,a}); }
  }
  const recentHtml = recent.map(r=>'<div class="prow"><span class="day">'+dStr(r.date)+'</span><span class="nm">'+esc(r.a.name||r.a.sport||'Seance')+'</span><span class="tss">'+Math.round(r.a.tss)+' TSS</span><span class="st done">✓</span></div>').join('')
    || '<div class="co-mini">Aucune seance recente.</div>';

  // ---- Notes coach (localStorage par athlete) ----
  const aid = (window.coachState && window.coachState.athleteId) || 'x';
  const noteKey = 'coach_notes_'+aid;
  const noteVal = localStorage.getItem(noteKey) || '';

  const hasWhoop = days.some(d=>d.recovery!=null);
  const read = synthesize({ tsb, ctl, atl, acwr, rec, conf, planned: weekPrevus.length, hasWhoop, sleepAvg: slAvg });
  const verdict = '<div class="co-quote '+read.status+'">'+esc(read.text)+'</div>';

  const wkg = (ath.ftp>0 && ath.weight>0) ? ' ('+(ath.ftp/ath.weight).toFixed(1)+' W/kg)' : '';
  const initial = (name[0]||'A').toUpperCase();

  const metaLine = (sport?esc(sport)+' · ':'')+(ath.age?ath.age+' ans · ':'')+(ath.ftp>0?'FTP '+ath.ftp+' W'+wkg:'FTP non renseigne')
      + (phaseLabel?' · <span class="co-hl-info">'+esc(phaseLabel)+'</span>':'')
      + (nextComp?' · <span class="co-hl-warn">'+esc(nextComp.name)+' J-'+Math.ceil((nextComp.dObj-today)/86400000)+'</span>':'');
  body.innerHTML =
    '<div class="co-hero">'
      + '<div class="co-hero-top">'
        + '<span class="co-hero-av">'+esc(initial)+'</span>'
        + '<div class="co-hero-id"><div class="co-hero-name">'+esc(name)+'</div><div class="co-hero-meta">'+metaLine+'</div></div>'
        + '<div class="co-hero-acts"><button class="btn" id="co-msg" type="button">Message</button><button class="btn green" id="co-plan" type="button">Calendrier</button></div>'
      + '</div>'
    + '</div>'
    + '<div class="co-kpis">'
      + kpi(tsbCls,'Forme (TSB)',(tsb>0?'+':'')+tsb,'CTL '+ctl+' / ATL '+atl)
      + kpi(recCls,'Recuperation',rec!=null?rec+'%':'—',hrv!=null?'HRV '+Math.round(hrv)+' ms':'Whoop non connecte')
      + kpi(acwrCls,'Risque (ACWR)',acwr? acwr.toFixed(2):'—',acwr>1.3?'Eleve':(acwr?'Sous controle':'—'))
      + kpi(confCls,'Conformite 7j',conf!=null?conf+'%':'—',plannedTss7>0?'plan suivi':'aucun plan')
    + '</div>'
    + (alerts.length? '<div class="co-alerts">'+alerts.map(a=>'<div class="co-alert '+a[0]+'"><span class="ico">'+a[1]+'</span>'+esc(a[2])+'</div>').join('')+'</div>' : '')
    + '<div class="co-cols">'
      + '<div>'
        + '<div class="co-card"><h3>Charge &amp; forme <span class="small">12 dernieres semaines</span></h3>'+chart+'<div class="co-legend"><span style="color:#60a5fa">■</span> CTL &nbsp; <span style="color:#fbbf24">■</span> ATL &nbsp; <span style="color:#a78bfa">■</span> TSB</div></div>'
        + '<div class="co-card"><h3>Conformite au plan <span class="small">'+planHead+'</span></h3>'+(planRows||'<div class="co-mini">Aucune seance planifiee cette semaine.</div>')+'</div>'
      + '</div>'
      + '<div>'
        + '<div class="co-card"><h3>Monitoring <span class="small">recent</span></h3><div class="co-mons">'+monHtml+'</div></div>'
        + '<div class="co-card"><h3>Dernieres seances</h3>'+recentHtml+'</div>'
      + '</div>'
    + '</div>';

  // wire actions
  const msg = document.getElementById('co-msg');
  if (msg) msg.addEventListener('click', ()=>{ const t=document.getElementById('coach-chat-tab'); if(t) t.click(); });
  const pl = document.getElementById('co-plan');
  if (pl) pl.addEventListener('click', ()=>{ const t=document.querySelector('.tab[data-panel="p2"]'); if(t) t.click(); });
}

function kpi(cls,lab,val,sub){
  return '<div class="co-kpi '+cls+'"><div class="co-lab">'+lab+'</div><div class="co-val '+cls+'">'+val+'</div><div class="co-sub">'+sub+'</div></div>';
}
function monTile(lab,val){ return '<div class="co-mon"><div class="co-mlab">'+lab+'</div><div class="co-mval">'+val+'</div></div>'; }
function fmtSleep(h){ const H=Math.floor(h); const M=Math.round((h-H)*60); return H+'h'+String(M).padStart(2,'0'); }

function buildChart(series){
  if (!series.length) return '<div class="co-mini">Pas assez de donnees.</div>';
  const W=640,H=170;
  const vals=[]; series.forEach(d=>{ vals.push(d.ctl||0,d.atl||0); });
  const maxV=Math.max(40,...vals); const minT=Math.min(0,...series.map(d=>d.tsb||0));
  const maxT=Math.max(...series.map(d=>d.tsb||0),10);
  const n=series.length;
  const x=i=> (n<=1?0:(i/(n-1))*W);
  const yLoad=v=> H-8 - (v/maxV)*(H-24);
  const yTsb=v=> H-8 - ((v-minT)/((maxT-minT)||1))*(H-24);
  const line=(f,col,dash)=>{ const pts=series.map((d,i)=>x(i).toFixed(0)+','+ (f==='tsb'?yTsb(d.tsb||0):yLoad(d[f]||0)).toFixed(0)).join(' '); return '<polyline fill="none" stroke="'+col+'" stroke-width="2.2"'+(dash?' stroke-dasharray="4 3"':'')+' points="'+pts+'"/>'; };
  return '<svg viewBox="0 0 '+W+' '+H+'" width="100%" height="'+H+'" style="display:block">'+line('ctl','#60a5fa')+line('atl','#fbbf24')+line('tsb','#a78bfa',true)+'</svg>';
}
