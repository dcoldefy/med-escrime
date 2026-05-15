/* ============================================================
   MED — My Escrime Data  |  app.js
   ============================================================ */

// ── État global ──────────────────────────────────────────────
const S = {
  tab:               'competitions',  // onglet actif
  comp:              null,            // competition en cours {id, a_poule, a_tableau, nom}
  poule:             null,            // {id, nb_tireurs, nb_assaults}
  pouleIndex:        1,               // assault courant dans la poule (1-based)
  pouleAssaultData:  {},              // cache des assaults saisis : numero → objet assault
  tableauTour:       64,              // taille du tour courant
  fromHisto:         false,           // true quand on ouvre un détail depuis l'onglet Historique
  recognition:       null,
  listening:         false,
  activeMic:         null,            // id de la textarea active pour le micro
  micBaseText:       '',
};

// ── Icône delete ─────────────────────────────────────────────
const MIC_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" width="16" height="16">
  <rect x="9" y="2" width="6" height="11" rx="3"/>
  <path d="M19 10a7 7 0 0 1-14 0"/>
  <line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/>
</svg>`;

const ICO_DEL = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"
  stroke-linecap="round" stroke-linejoin="round">
  <polyline points="3,6 5,6 21,6"/>
  <path d="M19 6l-1 14H6L5 6"/>
  <path d="M9 6V4h6v2"/>
</svg>`;

// ─────────────────────────────────────────────────────────────
//  INIT
// ─────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  // Récupère le token depuis l'URL (?u=TOKEN) et le stocke
  const params = new URLSearchParams(window.location.search);
  const urlToken = params.get('u');
  if (urlToken) {
    localStorage.setItem('med_token', urlToken);
    window.history.replaceState({}, '', '/');
  }

  if (!localStorage.getItem('med_token')) {
    document.getElementById('invalid-token-screen').classList.remove('hidden');
    return;
  }

  initDate();
  initUserName();
  initTabs();
  initMicAll();
  initCompForm();
  initCompDetail();
  initPouleSetup();
  initPouleAssault();
  initPouleEnd();
  initTableauSetup();
  initTableauAssault();
  initCompEnd();
  initEntrainement();
  initEntrDetail();
  initLeconForm();
  initLeconDetail();
  initExport();
  loadComps();
  loadEntrainement();
  loadHistorique();
});

// ── User name header ──────────────────────────────────────────
async function initUserName() {
  try {
    const me = await api('/api/me');
    const el = document.getElementById('headerUser');
    if (el && me.name) el.textContent = '· ' + me.name;
  } catch (_) {}
}

// ── Date header ───────────────────────────────────────────────
function initDate() {
  document.getElementById('headerDate').textContent =
    new Date().toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'long' });
}

// ─────────────────────────────────────────────────────────────
//  NAVIGATION : onglets & écrans
// ─────────────────────────────────────────────────────────────
function initTabs() {
  document.querySelectorAll('.tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(s => s.classList.add('hidden'));
      btn.classList.add('active');
      const tab = btn.dataset.tab;
      document.getElementById('tab-' + tab).classList.remove('hidden');
      S.tab = tab;
      if (tab === 'historique') loadHistorique();
    });
  });
}

// Affiche un écran dans la section courante, cache les autres du même groupe
function showScreen(section, name) {
  const prefix = `screen-${section}`;
  document.querySelectorAll(`[id^="${prefix}-"]`).forEach(el => el.classList.add('hidden'));
  document.getElementById(`${prefix}-${name}`)?.classList.remove('hidden');
}

// ─────────────────────────────────────────────────────────────
//  MICROPHONE (Web Speech API)
// ─────────────────────────────────────────────────────────────
function initMicAll() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { document.querySelectorAll('.mic-btn').forEach(b => b.style.display = 'none'); return; }

  S.recognition = new SR();
  S.recognition.lang = 'fr-FR';
  S.recognition.interimResults = true;
  S.recognition.continuous = false;

  S.recognition.onresult = (event) => {
    let final = '', interim = '';
    for (let i = 0; i < event.results.length; i++) {
      const t = event.results[i][0].transcript;
      if (event.results[i].isFinal) final += t; else interim += t;
    }
    const area = document.getElementById(S.activeMic);
    if (!area) return;
    const sep = S.micBaseText.trim() && (final || interim) ? ' ' : '';
    area.value = S.micBaseText + sep + final + interim;
    if (final) S.micBaseText = area.value.trimStart();
  };

  S.recognition.onspeechend = () => { try { S.recognition.stop(); } catch (_) {} };
  S.recognition.onend  = () => stopMic();
  S.recognition.onerror = () => stopMic();

  document.querySelectorAll('.mic-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const areaId = btn.id.replace('mic', '').replace(/^B/, 'b').toLowerCase();
      const map = {
        'micForme':        'compForme',
        'micPoule':        'pouleCommentaires',
        'micTableau':      'tableauCommentaires',
        'micBtn':          'notesArea',
        'micAnalyse':      'dCompNotes',
        'micEntrDetail':   'eEntrNotes',
        'micLecon':        'leconNotes',
        'micLeconDetail':  'eLeconNotes',
      };
      const targetId = map[btn.id];
      if (!targetId) return;
      if (S.listening && S.activeMic === targetId) { stopMic(); return; }
      startMic(targetId, btn);
    });
  });
}

function startMic(areaId, btn) {
  stopMic();
  S.activeMic   = areaId;
  S.micBaseText = document.getElementById(areaId)?.value || '';
  S.listening   = true;
  document.querySelectorAll('.mic-btn').forEach(b => b.classList.remove('listening'));
  btn.classList.add('listening');
  try { S.recognition.start(); } catch (_) {}
}

function stopMic() {
  S.listening = false;
  document.querySelectorAll('.mic-btn').forEach(b => b.classList.remove('listening'));
  try { S.recognition.stop(); } catch (_) {}
}

// ─────────────────────────────────────────────────────────────
//  COMPÉTITIONS — liste
// ─────────────────────────────────────────────────────────────
async function loadComps() {
  const list = document.getElementById('listComps');
  try {
    const data = await api('/api/competitions');
    if (!data.length) { list.innerHTML = '<p class="empty-msg">Aucune compétition.</p>'; return; }
    list.innerHTML = data.map(renderCompCard).join('');
  } catch { list.innerHTML = '<p class="empty-msg" style="color:var(--danger)">Erreur de chargement.</p>'; }
}

function renderCompCard(c) {
  const d    = new Date(c.date + 'T00:00:00');
  const day  = d.toLocaleDateString('fr-FR', { day: 'numeric' });
  const mon  = d.toLocaleDateString('fr-FR', { month: 'short' });
  const stat = c.terminee ? 'terminee' : 'en-cours';
  const lbl  = c.terminee ? 'Terminée' : 'En cours';
  const arme = { epee: 'Épée', fleuret: 'Fleuret', sabre: 'Sabre' }[c.arme] || c.arme;
  const niv  = { regional: 'Régional', national: 'National', international: 'International', olympique: 'Olympique' }[c.niveau] || c.niveau;

  return `<div class="comp-card ${c.terminee ? 'terminee' : ''}" onclick="resumeComp(${c.id})">
    <div class="comp-date-col">
      <div class="comp-day">${day}</div>
      <div class="comp-month">${mon}</div>
    </div>
    <div class="comp-body">
      <div class="comp-nom">${esc(c.nom)}</div>
      <div class="comp-meta">
        <span>${arme}</span><span>·</span><span>${niv}</span>
        ${c.ville ? `<span>·</span><span>${esc(c.ville)}</span>` : ''}
      </div>
    </div>
    <span class="comp-badge ${stat}">${lbl}</span>
  </div>`;
}

// ─────────────────────────────────────────────────────────────
//  COMPÉTITION — formulaire de création
// ─────────────────────────────────────────────────────────────
function initCompForm() {
  document.getElementById('btnNouvelleComp').addEventListener('click', () => {
    resetCompForm();
    showScreen('comp', 'form');
  });

  // Sélecteur niveau
  initRadioGroup('compNiveau');
  // Toggles poule / tableau
  initRadioGroup('compPoule');
  initRadioGroup('compTableau');

  document.getElementById('btnSaveComp').addEventListener('click', saveComp);
}

function resetCompForm() {
  document.getElementById('compNom').value   = '';
  document.getElementById('compDate').value  = new Date().toLocaleDateString('fr-CA');
  document.getElementById('compArme').value  = 'epee';
  document.getElementById('compVille').value = '';
  document.getElementById('compLieu').value  = '';
  document.getElementById('compForme').value = '';
  setActive('compNiveau', 'regional');
  setActive('compPoule',  'true');
  setActive('compTableau','true');
  setFeedback('feedbackComp', '', '');
}

async function saveComp() {
  const nom = document.getElementById('compNom').value.trim();
  if (!nom) { setFeedback('feedbackComp', 'Le nom est obligatoire.', 'error'); return; }

  const payload = {
    nom,
    date:          document.getElementById('compDate').value,
    arme:          document.getElementById('compArme').value,
    niveau:        getActive('compNiveau'),
    ville:         document.getElementById('compVille').value,
    lieu:          document.getElementById('compLieu').value,
    etat_de_forme: document.getElementById('compForme').value,
    a_poule:       getActive('compPoule')   === 'true',
    a_tableau:     getActive('compTableau') === 'true',
  };

  try {
    const c = await api('/api/competitions', { method: 'POST', body: payload });
    S.comp = c;
    loadComps();
    await startCompWorkflow(c);
  } catch (e) {
    setFeedback('feedbackComp', 'Erreur : ' + e.message, 'error');
  }
}

// Reprendre une compétition ou ouvrir son détail
async function resumeComp(id) {
  try {
    const c = await api(`/api/competitions/${id}`);
    S.comp = c;
    if (c.terminee) { openCompDetail(id); return; }
    await startCompWorkflow(c);
  } catch { alert('Impossible de charger la compétition.'); }
}

async function startCompWorkflow(c) {
  if (c.a_poule) {
    // Vérifie si une poule existe déjà pour ne pas en créer une nouvelle par erreur
    let poule = null;
    try { poule = await api(`/api/competitions/${c.id}/poule`); } catch {}

    if (!poule) {
      document.getElementById('pouleSetupTitle').textContent = `Poule — ${esc(c.nom)}`;
      showScreen('comp', 'poule-setup');
      return;
    }

    S.poule = poule;

    if (poule.terminee) {
      if (!poule.qualifie) { finishComp(false); return; }
      if (c.a_tableau) {
        document.getElementById('tableauSetupTitle').textContent = `Tableau — ${esc(c.nom)}`;
        showScreen('comp', 'tableau-setup');
      } else {
        finishComp(true);
      }
      return;
    }

    // Poule en cours : reprendre à l'assault suivant
    let existingAssaults = [];
    try { existingAssaults = await api(`/api/poules/${poule.id}/assaults`); } catch {}
    S.pouleAssaultData = {};
    existingAssaults.forEach(a => { S.pouleAssaultData[a.numero] = a; });
    S.pouleIndex = existingAssaults.length + 1;
    if (S.pouleIndex > poule.nb_assaults) {
      setActive('qualifToggle', null);
      showScreen('comp', 'poule-end');
    } else {
      showPouleAssault();
    }
    return;
  }

  if (c.a_tableau) {
    document.getElementById('tableauSetupTitle').textContent = `Tableau — ${esc(c.nom)}`;
    showScreen('comp', 'tableau-setup');
    return;
  }

  showScreen('comp', 'end');
  finishComp(false);
}

// ─────────────────────────────────────────────────────────────
//  POULE — setup
// ─────────────────────────────────────────────────────────────
function initPouleSetup() {
  let n = 6;
  const valEl  = document.getElementById('pouleNbTireurs');
  const hint   = document.getElementById('pouleHint');

  function update() {
    valEl.textContent = n;
    hint.textContent  = `${n - 1} assault${n - 1 > 1 ? 's' : ''} à enregistrer`;
  }

  document.getElementById('btnPouleMin').addEventListener('click', () => { if (n > 2) { n--; update(); } });
  document.getElementById('btnPouleMax').addEventListener('click', () => { if (n < 12) { n++; update(); } });

  document.getElementById('btnStartPoule').addEventListener('click', async () => {
    try {
      const p = await api(`/api/competitions/${S.comp.id}/poule`, {
        method: 'POST', body: { nb_tireurs: n }
      });
      S.poule             = p;
      S.pouleIndex        = 1;
      S.pouleAssaultData  = {};
      showPouleAssault();
    } catch { alert('Erreur lors de la création de la poule.'); }
  });
}

// ─────────────────────────────────────────────────────────────
//  POULE — assault par assault
// ─────────────────────────────────────────────────────────────
function showPouleAssault() {
  const total    = S.poule.nb_assaults;
  const existing = S.pouleAssaultData[S.pouleIndex];
  document.getElementById('pouleAssaultTitle').textContent =
    `Poule — Assault ${S.pouleIndex}/${total}`;
  document.getElementById('pouleProgress').style.width =
    `${((S.pouleIndex - 1) / total) * 100}%`;

  document.getElementById('pouleAdv').value          = existing?.adversaire || '';
  document.getElementById('pouleScoreMoi').value     = existing?.score_moi != null ? existing.score_moi : '';
  document.getElementById('pouleScoreAdv').value     = existing?.score_adversaire != null ? existing.score_adversaire : '';
  document.getElementById('pouleCommentaires').value = existing?.commentaires || '';
  setFeedback('feedbackPoule', '', '');

  document.getElementById('btnPouleBack').classList.toggle('hidden', S.pouleIndex <= 1);
  document.getElementById('btnPouleSkip').textContent = existing ? 'Garder' : 'Passer';

  showScreen('comp', 'poule-assault');
}

function initPouleAssault() {
  document.getElementById('btnPouleSave').addEventListener('click', () => savePouleAssault(false));
  document.getElementById('btnPouleSkip').addEventListener('click', () => savePouleAssault(true));
  document.getElementById('btnPouleBack').addEventListener('click', () => {
    S.pouleIndex--;
    showPouleAssault();
  });
}

async function savePouleAssault(skip) {
  const existing = S.pouleAssaultData[S.pouleIndex];

  // "Garder/Passer" sur un assault déjà enregistré → avancer sans sauvegarder
  if (skip && existing) {
    advancePoule();
    return;
  }

  const adv  = document.getElementById('pouleAdv').value.trim();
  const sm   = parseInt(document.getElementById('pouleScoreMoi').value);
  const sa   = parseInt(document.getElementById('pouleScoreAdv').value);
  const comm = document.getElementById('pouleCommentaires').value.trim();
  const vic  = (!isNaN(sm) && !isNaN(sa)) ? (sm > sa) : null;

  const payload = {
    numero:           S.pouleIndex,
    adversaire:       skip ? '' : adv,
    score_moi:        skip ? null : (isNaN(sm) ? null : sm),
    score_adversaire: skip ? null : (isNaN(sa) ? null : sa),
    victoire:         skip ? null : vic,
    commentaires:     skip ? '' : comm,
  };

  try {
    let saved;
    if (existing) {
      saved = await api(`/api/assaults_poule/${existing.id}`, { method: 'PATCH', body: payload });
    } else {
      saved = await api(`/api/poules/${S.poule.id}/assaults`, { method: 'POST', body: payload });
    }
    S.pouleAssaultData[S.pouleIndex] = saved;
    advancePoule();
  } catch (e) {
    setFeedback('feedbackPoule', 'Erreur : ' + e.message, 'error');
  }
}

function advancePoule() {
  if (S.pouleIndex < S.poule.nb_assaults) {
    S.pouleIndex++;
    showPouleAssault();
  } else {
    document.getElementById('pouleProgress').style.width = '100%';
    setActive('qualifToggle', null);
    showScreen('comp', 'poule-end');
  }
}

// ─────────────────────────────────────────────────────────────
//  POULE — fin (photo + qualification)
// ─────────────────────────────────────────────────────────────
function initPouleEnd() {
  initRadioGroup('qualifToggle');

  // Upload photo poule
  document.getElementById('photoPouleInput').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const status = document.getElementById('photoPouleStatus');
    status.textContent = 'Envoi en cours…';
    status.className   = 'photo-status';
    try {
      await uploadPhoto(S.comp.id, 'poule', file);
      status.textContent = '✓ Photo enregistrée';
      status.className   = 'photo-status ok';
    } catch {
      status.textContent = 'Erreur lors de l\'envoi.';
      status.className   = 'photo-status error';
    }
  });

  document.getElementById('btnPouleEndConfirm').addEventListener('click', async () => {
    const qualifStr = getActive('qualifToggle');
    if (qualifStr === null) { alert('Indiquez si vous êtes qualifié.'); return; }
    const qualifie = qualifStr === 'true';

    await api(`/api/poules/${S.poule.id}`, {
      method: 'PATCH', body: { qualifie, terminee: true }
    });

    if (!qualifie) {
      finishComp(false);
    } else if (S.comp.a_tableau) {
      document.getElementById('tableauSetupTitle').textContent = `Tableau — ${esc(S.comp.nom)}`;
      showScreen('comp', 'tableau-setup');
    } else {
      finishComp(true);
    }
  });
}

// ─────────────────────────────────────────────────────────────
//  TABLEAU — setup
// ─────────────────────────────────────────────────────────────
function initTableauSetup() {
  initRadioGroup('tableauSizeSelect');
  document.getElementById('btnStartTableau').addEventListener('click', () => {
    const val = getActive('tableauSizeSelect');
    S.tableauTour = parseInt(val) || 64;
    showTableauAssault();
  });
}

// ─────────────────────────────────────────────────────────────
//  TABLEAU — assault par assault
// ─────────────────────────────────────────────────────────────
function showTableauAssault() {
  const label = tourLabel(S.tableauTour);
  document.getElementById('tableauAssaultTitle').textContent = `Tableau — ${label}`;
  document.getElementById('tourBadge').textContent           = label;
  document.getElementById('tableauAdv').value          = '';
  document.getElementById('tableauScoreMoi').value     = '';
  document.getElementById('tableauScoreAdv').value     = '';
  document.getElementById('tableauCommentaires').value = '';
  setFeedback('feedbackTableau', '', '');
  showScreen('comp', 'tableau-assault');
}

function tourLabel(n) {
  if (n === 2)  return 'Finale';
  if (n === 4)  return 'Demi-finale';
  if (n === 8)  return 'Quart de finale';
  return `Tour de ${n}`;
}

function initTableauAssault() {
  document.getElementById('btnVictoire').addEventListener('click', () => saveTableauAssault(true));
  document.getElementById('btnDefaite').addEventListener('click', () => saveTableauAssault(false));

  document.getElementById('btnCorrigerTour').addEventListener('click', () => {
    showScreen('comp', 'tableau-setup');
  });
}

async function saveTableauAssault(victoire) {
  const adv  = document.getElementById('tableauAdv').value.trim();
  const sm   = parseInt(document.getElementById('tableauScoreMoi').value);
  const sa   = parseInt(document.getElementById('tableauScoreAdv').value);
  const comm = document.getElementById('tableauCommentaires').value.trim();

  try {
    await api(`/api/competitions/${S.comp.id}/tableau`, {
      method: 'POST',
      body: {
        tour:             S.tableauTour,
        adversaire:       adv,
        score_moi:        isNaN(sm) ? null : sm,
        score_adversaire: isNaN(sa) ? null : sa,
        victoire,
        commentaires:     comm,
      }
    });

    if (!victoire) {
      finishComp(false);
      return;
    }

    // Victoire — tour suivant ou finale gagnée
    if (S.tableauTour === 2) {
      finishComp(true);
    } else {
      S.tableauTour = S.tableauTour / 2;
      showTableauAssault();
    }
  } catch (e) {
    setFeedback('feedbackTableau', 'Erreur : ' + e.message, 'error');
  }
}

// ─────────────────────────────────────────────────────────────
//  FIN DE COMPÉTITION
// ─────────────────────────────────────────────────────────────
function finishComp(victoire) {
  const icon = document.getElementById('compEndIcon');
  const msg  = document.getElementById('compEndMsg');

  if (victoire && S.tableauTour === 1) {
    icon.style.color = 'var(--accent)';
    msg.textContent  = '🥇 Victoire finale ! Félicitations !';
  } else if (victoire) {
    icon.style.color = 'var(--success)';
    msg.textContent  = 'Compétition terminée — bonne performance !';
  } else {
    icon.style.color = 'var(--muted)';
    msg.textContent  = 'Compétition terminée.';
  }

  showScreen('comp', 'end');
}

function initCompEnd() {
  // Upload photo tableau
  document.getElementById('photoTableauInput').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const status = document.getElementById('photoTableauStatus');
    status.textContent = 'Envoi en cours…';
    status.className   = 'photo-status';
    try {
      await uploadPhoto(S.comp.id, 'tableau', file);
      status.textContent = '✓ Photo enregistrée';
      status.className   = 'photo-status ok';
    } catch {
      status.textContent = 'Erreur lors de l\'envoi.';
      status.className   = 'photo-status error';
    }
  });

  document.getElementById('btnCompEndDone').addEventListener('click', async () => {
    if (S.comp) {
      await api(`/api/competitions/${S.comp.id}`, {
        method: 'PATCH', body: { terminee: true }
      });
      S.comp = null;
    }
    loadComps();
    showScreen('comp', 'list');
  });
}

// ─────────────────────────────────────────────────────────────
//  ENTRAÎNEMENT
// ─────────────────────────────────────────────────────────────
function initEntrainement() {
  document.getElementById('btnNouvelEntr').addEventListener('click', () => {
    const now = new Date();
    const dd = String(now.getDate()).padStart(2, '0');
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const hh = String(now.getHours()).padStart(2, '0');
    const min = String(now.getMinutes()).padStart(2, '0');
    document.getElementById('notesArea').value = `${dd}/${mm} ${hh}:${min} — `;
    S.micBaseText = document.getElementById('notesArea').value;
    setFeedback('feedback', '', '');
    showScreen('entr', 'form');
  });

  document.getElementById('saveBtn').addEventListener('click', saveAssault);
}

async function loadEntrainement() {
  const list = document.getElementById('listAssaults');
  try {
    const [assaults, lecons] = await Promise.all([
      api('/api/assaults'),
      api('/api/lecons'),
    ]);
    const items = [
      ...assaults.map(a => ({ ...a, _type: 'assault' })),
      ...lecons.map(l => ({ ...l, _type: 'lecon' })),
    ].sort((a, b) => {
      const ka = a.date + 'T' + a.heure;
      const kb = b.date + 'T' + b.heure;
      return kb.localeCompare(ka);
    });
    if (!items.length) { list.innerHTML = '<p class="empty-msg">Aucun élément enregistré.</p>'; return; }
    list.innerHTML = items.map(it =>
      it._type === 'assault' ? renderAssaultCard(it) : renderLeconCard(it)
    ).join('');
  } catch { list.innerHTML = '<p class="empty-msg" style="color:var(--danger)">Erreur.</p>'; }
}

async function saveAssault() {
  const notes = document.getElementById('notesArea').value.trim();
  const now   = new Date();
  setFeedback('feedback', '', '');
  try {
    await api('/api/assaults', {
      method: 'POST',
      body: { date: now.toLocaleDateString('fr-CA'), heure: now.toTimeString().slice(0, 8), notes }
    });
    document.getElementById('notesArea').value = '';
    S.micBaseText = '';
    setFeedback('feedback', 'Assault enregistré !', 'ok');
    setTimeout(() => setFeedback('feedback', '', ''), 3000);
    loadEntrainement();
    showScreen('entr', 'list');
  } catch (e) {
    setFeedback('feedback', 'Erreur : ' + e.message, 'error');
  }
}

function renderAssaultCard(a, fromHisto = false) {
  const date    = new Date(a.date + 'T00:00:00').toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  const heure   = a.heure.slice(0, 5);
  const cardId  = fromHisto ? `h-assault-${a.id}` : `assault-${a.id}`;
  const clickFn = fromHisto ? `openFromHisto('assault',${a.id})` : `openEntrDetail(${a.id})`;
  const delFn   = fromHisto ? `deleteFromHisto('assault',${a.id})` : `deleteAssault(${a.id})`;
  return `<div class="assault-card" id="${cardId}" onclick="${clickFn}" style="cursor:pointer">
    <div class="assault-meta">
      <span class="assault-time">${heure}</span>
      <span class="assault-badge badge-entrainement">Entraîn.</span>
    </div>
    <div class="assault-body">
      <div class="assault-date">${date}</div>
      <div class="assault-notes${a.notes ? '' : ' empty'}">${a.notes ? esc(a.notes) : 'Aucune note.'}</div>
    </div>
    <button class="del-btn" onclick="event.stopPropagation(); ${delFn}" title="Supprimer">${ICO_DEL}</button>
  </div>`;
}

async function deleteAssault(id) {
  if (!confirm('Supprimer cet assault ?')) return;
  await api(`/api/assaults/${id}`, { method: 'DELETE' });
  document.getElementById('assault-' + id)?.remove();
  const list = document.getElementById('listAssaults');
  if (!list.querySelector('.assault-card'))
    list.innerHTML = '<p class="empty-msg">Aucun élément enregistré.</p>';
}

// ─────────────────────────────────────────────────────────────
//  LEÇONS
// ─────────────────────────────────────────────────────────────
function initLeconForm() {
  document.getElementById('btnNouvelleLecon').addEventListener('click', () => {
    const now = new Date();
    document.getElementById('leconDate').value  = now.toLocaleDateString('fr-CA');
    document.getElementById('leconHeure').value = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
    document.getElementById('leconMaitre').value = '';
    document.getElementById('leconTheme').value  = '';
    document.getElementById('leconNotes').value  = '';
    S.micBaseText = '';
    setFeedback('feedbackLecon', '', '');
    showScreen('entr', 'lecon-form');
  });
  document.getElementById('btnSaveLecon').addEventListener('click', saveLecon);
}

async function saveLecon() {
  const date   = document.getElementById('leconDate').value;
  const heure  = document.getElementById('leconHeure').value;
  const maitre = document.getElementById('leconMaitre').value.trim();
  const theme  = document.getElementById('leconTheme').value.trim();
  const notes  = document.getElementById('leconNotes').value.trim();
  setFeedback('feedbackLecon', '', '');
  try {
    await api('/api/lecons', {
      method: 'POST',
      body: { date, heure: heure + ':00', maitre, theme, notes }
    });
    setFeedback('feedbackLecon', 'Leçon enregistrée !', 'ok');
    setTimeout(() => setFeedback('feedbackLecon', '', ''), 3000);
    loadEntrainement();
    showScreen('entr', 'list');
  } catch (e) {
    setFeedback('feedbackLecon', 'Erreur : ' + e.message, 'error');
  }
}

function renderLeconCard(l, fromHisto = false) {
  const date     = new Date(l.date + 'T00:00:00').toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  const heure    = l.heure.slice(0, 5);
  const subtitle = [l.maitre, l.theme].filter(Boolean).join(' · ');
  const body     = subtitle || l.notes.slice(0, 80);
  const cardId   = fromHisto ? `h-lecon-${l.id}` : `lecon-${l.id}`;
  const clickFn  = fromHisto ? `openFromHisto('lecon',${l.id})` : `openLeconDetail(${l.id})`;
  const delFn    = fromHisto ? `deleteFromHisto('lecon',${l.id})` : `deleteLecon(${l.id})`;
  return `<div class="assault-card lecon-card" id="${cardId}" onclick="${clickFn}" style="cursor:pointer; border-left-color:#2d6a4f">
    <div class="assault-meta">
      <span class="assault-time">${heure}</span>
      <span class="assault-badge badge-lecon">Leçon</span>
    </div>
    <div class="assault-body">
      <div class="assault-date">${date}</div>
      <div class="assault-notes${body ? '' : ' empty'}">${body ? esc(body) : 'Aucune note.'}</div>
    </div>
    <button class="del-btn" onclick="event.stopPropagation(); ${delFn}" title="Supprimer">${ICO_DEL}</button>
  </div>`;
}

async function deleteLecon(id) {
  if (!confirm('Supprimer cette leçon ?')) return;
  await api(`/api/lecons/${id}`, { method: 'DELETE' });
  document.getElementById('lecon-' + id)?.remove();
  const list = document.getElementById('listAssaults');
  if (!list.querySelector('.assault-card'))
    list.innerHTML = '<p class="empty-msg">Aucun élément enregistré.</p>';
}

function initLeconDetail() {
  document.getElementById('btnSaveLeconDetail').addEventListener('click', saveLeconDetail);
}

async function openLeconDetail(id) {
  try {
    const l = await api(`/api/lecons/${id}`);
    S.detailLecon = l;
    document.getElementById('eLeconDate').value  = l.date;
    document.getElementById('eLeconHeure').value = l.heure.slice(0, 5);
    document.getElementById('eLeconMaitre').value = l.maitre;
    document.getElementById('eLeconTheme').value  = l.theme;
    document.getElementById('eLeconNotes').value  = l.notes;
    S.micBaseText = l.notes;
    setFeedback('feedbackLeconDetail', '', '');
    showScreen('entr', 'lecon-detail');
  } catch { alert('Impossible de charger la leçon.'); }
}

async function saveLeconDetail() {
  const id     = S.detailLecon.id;
  const date   = document.getElementById('eLeconDate').value;
  const heure  = document.getElementById('eLeconHeure').value;
  const maitre = document.getElementById('eLeconMaitre').value.trim();
  const theme  = document.getElementById('eLeconTheme').value.trim();
  const notes  = document.getElementById('eLeconNotes').value.trim();
  try {
    await api(`/api/lecons/${id}`, {
      method: 'PATCH', body: { date, heure: heure + ':00', maitre, theme, notes }
    });
    setFeedback('feedbackLeconDetail', 'Enregistré !', 'ok');
    setTimeout(() => { setFeedback('feedbackLeconDetail', '', ''); goBackFromEntrDetail(); }, 1500);
    loadEntrainement();
    if (S.fromHisto) loadHistorique();
  } catch { setFeedback('feedbackLeconDetail', 'Erreur.', 'error'); }
}

// ─────────────────────────────────────────────────────────────
//  HISTORIQUE
// ─────────────────────────────────────────────────────────────
async function loadHistorique() {
  const list = document.getElementById('historyList');
  list.innerHTML = '<p class="empty-msg">Chargement…</p>';
  try {
    const [comps, assaults, lecons] = await Promise.all([
      api('/api/competitions'),
      api('/api/assaults'),
      api('/api/lecons'),
    ]);

    const items = [
      ...comps.map(c => ({ ...c, _type: 'comp', _date: c.date })),
      ...assaults.map(a => ({ ...a, _type: 'assault', _date: a.date })),
      ...lecons.map(l => ({ ...l, _type: 'lecon', _date: l.date })),
    ].sort((a, b) => {
      const ka = b._date + 'T' + (b.heure || '00:00:00');
      const kb = a._date + 'T' + (a.heure || '00:00:00');
      return ka.localeCompare(kb);
    });

    if (!items.length) { list.innerHTML = '<p class="empty-msg">Aucun élément.</p>'; return; }
    list.innerHTML = items.map(it => {
      if (it._type === 'comp')   return renderHistoComp(it);
      if (it._type === 'lecon')  return renderLeconCard(it, true);
      return renderAssaultCard(it, true);
    }).join('');
  } catch { list.innerHTML = '<p class="empty-msg" style="color:var(--danger)">Erreur.</p>'; }
}

function renderHistoComp(c) {
  const d   = new Date(c.date + 'T00:00:00');
  const day = d.toLocaleDateString('fr-FR', { day: 'numeric' });
  const mon = d.toLocaleDateString('fr-FR', { month: 'short', year: 'numeric' });
  const arme = { epee: 'Épée', fleuret: 'Fleuret', sabre: 'Sabre' }[c.arme] || c.arme;
  return `<div class="assault-card" id="h-comp-${c.id}" style="border-left-color:var(--accent); cursor:pointer"
      onclick="openFromHisto('comp', ${c.id})">
    <div class="assault-meta">
      <span class="assault-time">${day}</span>
      <span class="assault-badge badge-competition">Compét.</span>
    </div>
    <div class="assault-body">
      <div class="assault-date">${mon} · ${arme}</div>
      <div class="assault-notes">${esc(c.nom)}${c.ville ? ` — ${esc(c.ville)}` : ''}</div>
    </div>
    <button class="del-btn" onclick="event.stopPropagation(); deleteHistoComp(${c.id})" title="Supprimer">${ICO_DEL}</button>
  </div>`;
}

async function deleteHistoComp(id) {
  if (!confirm('Supprimer cette compétition et toutes ses données (assaults, photos) ?')) return;
  try {
    await api(`/api/competitions/${id}`, { method: 'DELETE' });
    document.getElementById(`h-comp-${id}`)?.remove();
    loadComps();
    const list = document.getElementById('historyList');
    if (!list.querySelector('.assault-card'))
      list.innerHTML = '<p class="empty-msg">Aucun élément.</p>';
  } catch { alert('Erreur lors de la suppression.'); }
}

// ─────────────────────────────────────────────────────────────
//  EXPORT XLSX
// ─────────────────────────────────────────────────────────────
function initExport() {
  document.getElementById('btnExportComps').addEventListener('click', () => {
    const d = new Date().toLocaleDateString('fr-CA');
    downloadExport('/api/export/competitions', `med_competitions_${d}.xlsx`);
  });
  document.getElementById('btnExportEntr').addEventListener('click', () => {
    const d = new Date().toLocaleDateString('fr-CA');
    downloadExport('/api/export/entrainement', `med_entrainement_${d}.xlsx`);
  });
  document.getElementById('btnExportDashboard').addEventListener('click', async () => {
    const btn = document.getElementById('btnExportDashboard');
    btn.disabled = true;
    try {
      const token = localStorage.getItem('med_token');
      const res = await fetch('/api/export/dashboard', { headers: { 'X-User-Token': token } });
      if (!res.ok) throw new Error(await res.text());
      const html = await res.text();
      const blob = new Blob([html], { type: 'text/html' });
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch (e) {
      alert('Erreur tableau de bord : ' + e.message);
    } finally {
      btn.disabled = false;
    }
  });
}

async function downloadExport(endpoint, filename) {
  try {
    const token = localStorage.getItem('med_token');
    const res = await fetch(endpoint, { headers: { 'X-User-Token': token } });
    if (!res.ok) throw new Error(await res.text());
    const blob = await res.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(a.href);
  } catch (e) {
    alert('Erreur export : ' + e.message);
  }
}

// ─────────────────────────────────────────────────────────────
//  HELPERS
// ─────────────────────────────────────────────────────────────

// Requête API JSON
async function api(url, options = {}) {
  const token = localStorage.getItem('med_token');
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['X-User-Token'] = token;
  const opts = { headers };
  if (options.method) opts.method = options.method;
  if (options.body)   opts.body   = JSON.stringify(options.body);
  const res = await fetch(url, opts);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

// Upload multipart
async function uploadPhoto(compId, type, file) {
  const token = localStorage.getItem('med_token');
  const fd = new FormData();
  fd.append('type_photo', type);
  fd.append('file', file);
  const headers = {};
  if (token) headers['X-User-Token'] = token;
  const res = await fetch(`/api/competitions/${compId}/photos`, { method: 'POST', body: fd, headers });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

// Radio group : un seul bouton actif à la fois
function initRadioGroup(groupId) {
  document.getElementById(groupId)?.querySelectorAll('[data-val]').forEach(btn => {
    btn.addEventListener('click', () => setActive(groupId, btn.dataset.val));
  });
}

function setActive(groupId, val) {
  document.getElementById(groupId)?.querySelectorAll('[data-val]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.val === val);
  });
}

function getActive(groupId) {
  const btn = document.getElementById(groupId)?.querySelector('.active');
  return btn ? btn.dataset.val : null;
}

// Feedback
function setFeedback(id, msg, type) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = msg;
  el.className   = 'feedback' + (type ? ' ' + type : '');
}

// Échappement XSS
function esc(str) {
  if (!str) return '';
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ─────────────────────────────────────────────────────────────
//  NAVIGATION PROGRAMMATIQUE
// ─────────────────────────────────────────────────────────────
function switchTab(name) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(s => s.classList.add('hidden'));
  document.querySelector(`.tab[data-tab="${name}"]`)?.classList.add('active');
  document.getElementById('tab-' + name)?.classList.remove('hidden');
  S.tab = name;
}

function openFromHisto(type, id) {
  S.fromHisto = true;
  if (type === 'comp') {
    S.fromHisto = false; // comp detail a son propre bouton retour vers la liste comp
    switchTab('competitions');
    openCompDetail(id);
  } else if (type === 'lecon') {
    switchTab('entrainement');
    openLeconDetail(id);
  } else {
    switchTab('entrainement');
    openEntrDetail(id);
  }
}

function goBackFromEntrDetail() {
  if (S.fromHisto) {
    S.fromHisto = false;
    switchTab('historique');
    loadHistorique();
  } else {
    showScreen('entr', 'list');
  }
}

async function deleteFromHisto(type, id) {
  const label = type === 'assault' ? 'cet assault' : 'cette leçon';
  if (!confirm(`Supprimer ${label} ?`)) return;
  const url = type === 'assault' ? `/api/assaults/${id}` : `/api/lecons/${id}`;
  try {
    await api(url, { method: 'DELETE' });
    document.getElementById(`h-${type}-${id}`)?.remove();
    loadEntrainement();
    const list = document.getElementById('historyList');
    if (!list.querySelector('.assault-card'))
      list.innerHTML = '<p class="empty-msg">Aucun élément.</p>';
  } catch { alert('Erreur lors de la suppression.'); }
}

// ─────────────────────────────────────────────────────────────
//  DÉTAIL COMPÉTITION
// ─────────────────────────────────────────────────────────────
function initCompDetail() {
  initRadioGroup('dCompNiveau');
  document.getElementById('btnDetailBack').addEventListener('click', () => showScreen('comp', 'list'));
  document.getElementById('btnSaveCompInfo').addEventListener('click', saveCompInfo);
  document.getElementById('btnSaveCompNotes').addEventListener('click', saveCompNotes);
}

async function openCompDetail(id) {
  try {
    const comp = await api(`/api/competitions/${id}`);
    S.detailComp = comp;

    document.getElementById('detailCompNom').textContent = comp.nom;
    document.getElementById('dCompNom').value   = comp.nom;
    document.getElementById('dCompDate').value  = comp.date;
    document.getElementById('dCompArme').value  = comp.arme;
    setActive('dCompNiveau', comp.niveau);
    document.getElementById('dCompVille').value = comp.ville || '';
    document.getElementById('dCompLieu').value  = comp.lieu || '';
    document.getElementById('dCompForme').value = comp.etat_de_forme || '';
    document.getElementById('dCompNotes').value = comp.notes_analyse || '';
    setFeedback('feedbackDetail', '', '');

    S.detailPouleAssaults   = [];
    S.detailTableauAssaults = [];

    // Poule
    if (comp.a_poule) {
      try {
        const poule  = await api(`/api/competitions/${id}/poule`);
        const assaults = await api(`/api/poules/${poule.id}/assaults`);
        S.detailPouleAssaults = assaults;
        document.getElementById('dPouleSection').classList.remove('hidden');
        document.getElementById('dPouleAssaults').innerHTML =
          assaults.length ? assaults.map(renderPouleRow).join('') : '<p class="empty-msg">Aucun assault.</p>';
      } catch { document.getElementById('dPouleSection').classList.add('hidden'); }
    } else {
      document.getElementById('dPouleSection').classList.add('hidden');
    }

    // Tableau
    if (comp.a_tableau) {
      try {
        const assaults = await api(`/api/competitions/${id}/tableau`);
        S.detailTableauAssaults = assaults;
        if (assaults.length) {
          document.getElementById('dTableauSection').classList.remove('hidden');
          document.getElementById('dTableauAssaults').innerHTML = assaults.map(renderTableauRow).join('');
        } else {
          document.getElementById('dTableauSection').classList.add('hidden');
        }
      } catch { document.getElementById('dTableauSection').classList.add('hidden'); }
    } else {
      document.getElementById('dTableauSection').classList.add('hidden');
    }

    // Photos
    document.getElementById('dPhotosSection').classList.remove('hidden');
    await refreshDetailPhotos(id);

    // Handlers upload photo poule
    const inputPoule = document.getElementById('dPhotoPouleInput');
    inputPoule.value = '';
    inputPoule.onchange = async (e) => {
      const file = e.target.files[0]; if (!file) return;
      const st = document.getElementById('dPhotoPouleStatus');
      st.textContent = 'Envoi…'; st.className = 'photo-status';
      try {
        await uploadPhoto(id, 'poule', file);
        st.textContent = '✓ Photo enregistrée'; st.className = 'photo-status ok';
        await refreshDetailPhotos(id);
      } catch { st.textContent = 'Erreur.'; st.className = 'photo-status error'; }
      inputPoule.value = '';
    };

    // Handlers upload photo tableau
    const inputTableau = document.getElementById('dPhotoTableauInput');
    inputTableau.value = '';
    inputTableau.onchange = async (e) => {
      const file = e.target.files[0]; if (!file) return;
      const st = document.getElementById('dPhotoTableauStatus');
      st.textContent = 'Envoi…'; st.className = 'photo-status';
      try {
        await uploadPhoto(id, 'tableau', file);
        st.textContent = '✓ Photo enregistrée'; st.className = 'photo-status ok';
        await refreshDetailPhotos(id);
      } catch { st.textContent = 'Erreur.'; st.className = 'photo-status error'; }
      inputTableau.value = '';
    };

    // Handler upload photo générale
    const inputGen = document.getElementById('dPhotoGeneraleInput');
    inputGen.value = '';
    inputGen.onchange = async (e) => {
      const file = e.target.files[0]; if (!file) return;
      const st = document.getElementById('dPhotoGeneraleStatus');
      st.textContent = 'Envoi…'; st.className = 'photo-status';
      try {
        await uploadPhoto(id, 'generale', file);
        st.textContent = '✓ Photo enregistrée'; st.className = 'photo-status ok';
        await refreshDetailPhotos(id);
      } catch { st.textContent = 'Erreur.'; st.className = 'photo-status error'; }
      inputGen.value = '';
    };

    showScreen('comp', 'detail');
  } catch { alert('Impossible de charger la compétition.'); }
}

async function refreshDetailPhotos(compId) {
  try {
    const photos = await api(`/api/competitions/${compId}/photos`);
    const typeLabel = { poule: 'Poule', tableau: 'Tableau', generale: 'Générale' };
    document.getElementById('dPhotos').innerHTML = photos.length
      ? photos.map(p =>
          `<div class="photo-thumb-wrap">
            <a href="${p.url}" target="_blank" class="photo-thumb">
              <img src="${p.url}" alt="${p.type_photo}" loading="lazy"/>
              <span>${typeLabel[p.type_photo] || p.type_photo}</span>
            </a>
            <button class="photo-del-btn" onclick="deletePhoto(${p.id}, ${compId})" title="Supprimer">${ICO_DEL}</button>
          </div>`
        ).join('')
      : '<p class="empty-msg" style="font-size:.85rem">Aucune photo.</p>';
    _updateSectionPhotoBadge('Poule',   photos.filter(p => p.type_photo === 'poule'));
    _updateSectionPhotoBadge('Tableau', photos.filter(p => p.type_photo === 'tableau'));
  } catch {}
}

function _updateSectionPhotoBadge(cap, photos) {
  const badge = document.getElementById(`d${cap}PhotoBadge`);
  const btn   = document.getElementById(`btnAnalyze${cap}`);
  if (!badge) return;
  if (!photos.length) {
    badge.classList.add('hidden');
    if (btn) btn.classList.add('hidden');
    return;
  }
  badge.classList.remove('hidden');
  const thumb = document.getElementById(`d${cap}PhotoThumb`);
  if (thumb) thumb.src = photos[0].url;
  const cnt = document.getElementById(`d${cap}PhotoCount`);
  if (cnt) cnt.textContent = photos.length === 1 ? '1 photo' : `${photos.length} photos`;
  if (btn) btn.classList.remove('hidden');
}

async function deletePhoto(photoId, compId) {
  if (!confirm('Supprimer cette photo ?')) return;
  try {
    await api(`/api/photos/${photoId}`, { method: 'DELETE' });
    await refreshDetailPhotos(compId);
  } catch { alert('Erreur lors de la suppression.'); }
}

// ─────────────────────────────────────────────────────────────
//  ANALYSE PHOTO AVEC CLAUDE
// ─────────────────────────────────────────────────────────────

const _ANALYZE_STAR = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26"/></svg>`;

async function analyzeWithClaude(compId, type) {
  const cap   = type === 'poule' ? 'Poule' : 'Tableau';
  const btn   = document.getElementById(`btnAnalyze${cap}`);
  const panel = document.getElementById(`d${cap}AnalyzePanel`);
  const assaults = type === 'poule' ? S.detailPouleAssaults : S.detailTableauAssaults;

  btn.disabled = true;
  btn.innerHTML = `<span style="opacity:.6">Analyse en cours…</span>`;
  panel.classList.add('hidden');

  try {
    const token = localStorage.getItem('med_token');
    const fd = new FormData();
    fd.append('type_photo', type);
    const res = await fetch(`/api/competitions/${compId}/analyze-photo`, {
      method: 'POST',
      headers: token ? { 'X-User-Token': token } : {},
      body: fd,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || `Erreur ${res.status}`);
    }
    const data = await res.json();
    panel.innerHTML = type === 'poule'
      ? _renderPouleAnalysis(data, assaults)
      : _renderTableauAnalysis(data, assaults);
    panel.classList.remove('hidden');
    panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    // Stocker pour les callbacks
    panel._analyzeData     = data;
    panel._analyzeAssaults = assaults;
  } catch (e) {
    panel.innerHTML = `<div class="analyze-panel-head"><span class="analyze-panel-title">Analyse Claude</span><button class="analyze-panel-close" onclick="document.getElementById('d${cap}AnalyzePanel').classList.add('hidden')">×</button></div><div class="analyze-panel-body"><p style="color:var(--danger);font-size:.85rem">Erreur : ${esc(e.message)}</p></div>`;
    panel.classList.remove('hidden');
  } finally {
    btn.disabled = false;
    btn.innerHTML = `${_ANALYZE_STAR} Analyser avec Claude`;
  }
}

function _renderPouleAnalysis(data, assaults) {
  const tireurs    = data.tireurs    || [];
  const combats    = data.combats    || [];
  const classement = data.classement || [];

  const opts = tireurs.map(t => `<option value="${t.num}">${t.num}. ${esc(t.nom)}</option>`).join('');

  let rankHTML = '';
  if (classement.length) {
    rankHTML = `<div class="analyze-classement"><div class="analyze-classement-title">Classement de poule</div>`;
    classement.forEach(r => {
      const gold = r.rang === 1 ? 'color:#c8960a;font-weight:800' : '';
      rankHTML += `<div class="analyze-rank-row"><span class="analyze-rank-num" style="${gold}">${r.rang}</span><span style="flex:1">${esc(r.nom)}</span><span style="font-size:.75rem;color:var(--muted)">${r.V ?? '?'}V / ${r.D ?? '?'}D &nbsp;·&nbsp; ${r.TS ?? '?'}T / ${r.TR ?? '?'}T</span></div>`;
    });
    rankHTML += `</div>`;
  }

  return `<div class="analyze-panel-head">
    <span class="analyze-panel-title">✦ Analyse Claude — Poule</span>
    <button class="analyze-panel-close" onclick="document.getElementById('dPouleAnalyzePanel').classList.add('hidden')">×</button>
  </div>
  <div class="analyze-panel-body">
    ${data.notes ? `<div class="analyze-notes">⚠ ${esc(data.notes)}</div>` : ''}
    ${tireurs.length ? `<div class="analyze-tireur-select">
      <label>Je suis :</label>
      <select id="analyzePouleMeSelect" onchange="_renderPouleAnalysisCombats()">
        <option value="">— sélectionner —</option>${opts}
      </select>
    </div>` : ''}
    <div id="analyzePouleCombats"></div>
    ${rankHTML}
  </div>`;
}

function _renderPouleAnalysisCombats() {
  const panel = document.getElementById('dPouleAnalyzePanel');
  const data  = panel._analyzeData     || {};
  const assaults = panel._analyzeAssaults || [];
  const meNum = parseInt(document.getElementById('analyzePouleMeSelect')?.value || '0');
  const container = document.getElementById('analyzePouleCombats');
  if (!container) return;
  if (!meNum) { container.innerHTML = ''; return; }

  const tireurs = data.tireurs || [];
  const combats = (data.combats || []).filter(c => c.num1 === meNum || c.num2 === meNum);

  if (!combats.length) { container.innerHTML = '<p class="empty-msg" style="font-size:.82rem;padding:12px 0">Aucun combat trouvé pour ce tireur.</p>'; return; }

  let html = '<div class="analyze-combats">';
  combats.forEach(c => {
    const isMeNum1 = c.num1 === meNum;
    const advNum  = isMeNum1 ? c.num2 : c.num1;
    const advObj  = tireurs.find(t => t.num === advNum);
    const advName = advObj ? advObj.nom : `Tireur ${advNum}`;
    const sm = isMeNum1 ? c.score1 : c.score2;
    const sa = isMeNum1 ? c.score2 : c.score1;
    const vic = (sm != null && sa != null) ? sm > sa : null;
    const score = (sm != null && sa != null) ? `${sm} – ${sa}` : '—';
    const rc = vic === true ? 'victory' : vic === false ? 'defeat' : 'unknown';
    const rl = vic === true ? 'V' : vic === false ? 'D' : '?';

    // Tentative de correspondance avec un assault existant (par nom d'adversaire)
    const firstWord = advName.split(' ')[0].toUpperCase();
    const match = assaults.find(a => a.adversaire && a.adversaire.toUpperCase().includes(firstWord));
    const matchNote = match
      ? `<span class="analyze-match-note">→ A${match.numero}</span>`
      : `<span class="analyze-match-note" style="color:var(--muted)">non apparié</span>`;

    const smJS = sm != null ? sm : 'null';
    const saJS = sa != null ? sa : 'null';
    const vicJS = vic != null ? vic : 'null';
    const applyBtn = match
      ? `<button class="analyze-apply-btn" onclick="applyPouleAnalysis(${match.id},${smJS},${saJS},${vicJS},'${esc(advName).replace(/'/g,"\\'")}')">Appliquer</button>`
      : '';

    html += `<div class="analyze-combat-row">
      <span class="analyze-adv">${esc(advName)}</span>
      <span class="analyze-score">${score}</span>
      <span class="analyze-result ${rc}">${rl}</span>
      ${matchNote}
      ${applyBtn}
    </div>`;
  });
  html += '</div>';
  container.innerHTML = html;
}

async function applyPouleAnalysis(assaultId, sm, sa, vic, adv) {
  try {
    const saved = await api(`/api/assaults_poule/${assaultId}`, {
      method: 'PATCH',
      body: { adversaire: adv, score_moi: sm, score_adversaire: sa, victoire: vic },
    });
    // Mise à jour DOM de la ligne
    const head = document.querySelector(`#pRow${assaultId} .assault-row-head`);
    if (head) {
      head.querySelector('.row-adv').innerHTML = esc(saved.adversaire) || '<em style="color:var(--muted)">—</em>';
      const s = (saved.score_moi != null && saved.score_adversaire != null) ? `${saved.score_moi}–${saved.score_adversaire}` : '—';
      head.querySelector('.row-score').textContent = s;
      const b = head.querySelector('.result-badge');
      const v = saved.victoire;
      b.className = `result-badge ${v === true ? 'victory' : v === false ? 'defeat' : 'unknown'}`;
      b.textContent = v === true ? 'V' : v === false ? 'D' : '?';
    }
    const advEl = document.getElementById(`pAdv${assaultId}`);
    const smEl  = document.getElementById(`pSm${assaultId}`);
    const saEl  = document.getElementById(`pSa${assaultId}`);
    if (advEl) advEl.value = adv;
    if (smEl) smEl.value = sm ?? '';
    if (saEl) saEl.value = sa ?? '';
    setFeedback('feedbackDetail', '✓ Assault mis à jour depuis la photo', 'ok');
    setTimeout(() => setFeedback('feedbackDetail', '', ''), 2500);
  } catch { alert('Erreur lors de l\'application.'); }
}

function _renderTableauAnalysis(data, assaults) {
  const combats = data.combats || [];

  let rows = '';
  if (!combats.length) {
    rows = '<p class="empty-msg" style="font-size:.82rem;padding:12px 0">Aucun combat extrait.</p>';
  } else {
    // Rassembler les noms uniques pour le sélecteur "Je suis..."
    const namesSet = new Set();
    combats.forEach(c => { if (c.tireur1) namesSet.add(c.tireur1); if (c.tireur2) namesSet.add(c.tireur2); });
    const names = [...namesSet];
    const opts = names.map(n => `<option value="${esc(n)}">${esc(n)}</option>`).join('');

    rows = `<div class="analyze-tireur-select">
      <label>Je suis :</label>
      <select id="analyzeTableauMeSelect" onchange="_renderTableauAnalysisCombats()">
        <option value="">— sélectionner —</option>${opts}
      </select>
    </div>
    <div id="analyzeTableauCombats"></div>`;
  }

  return `<div class="analyze-panel-head">
    <span class="analyze-panel-title">✦ Analyse Claude — Tableau</span>
    <button class="analyze-panel-close" onclick="document.getElementById('dTableauAnalyzePanel').classList.add('hidden')">×</button>
  </div>
  <div class="analyze-panel-body">
    ${data.notes ? `<div class="analyze-notes">⚠ ${esc(data.notes)}</div>` : ''}
    ${rows}
  </div>`;
}

function _renderTableauAnalysisCombats() {
  const panel    = document.getElementById('dTableauAnalyzePanel');
  const data     = panel._analyzeData     || {};
  const assaults = panel._analyzeAssaults || [];
  const me       = document.getElementById('analyzeTableauMeSelect')?.value || '';
  const container = document.getElementById('analyzeTableauCombats');
  if (!container) return;
  if (!me) { container.innerHTML = ''; return; }

  const combats = (data.combats || []).filter(c => c.tireur1 === me || c.tireur2 === me);
  if (!combats.length) { container.innerHTML = '<p class="empty-msg" style="font-size:.82rem;padding:12px 0">Aucun combat trouvé pour ce tireur.</p>'; return; }

  let html = '<div class="analyze-combats">';
  combats.forEach(c => {
    const isMeT1 = c.tireur1 === me;
    const adv  = isMeT1 ? c.tireur2 : c.tireur1;
    const sm   = isMeT1 ? c.score1 : c.score2;
    const sa   = isMeT1 ? c.score2 : c.score1;
    const vic  = c.vainqueur ? c.vainqueur === me : (sm != null && sa != null ? sm > sa : null);
    const score = (sm != null && sa != null) ? `${sm} – ${sa}` : '—';
    const rc   = vic === true ? 'victory' : vic === false ? 'defeat' : 'unknown';
    const rl   = vic === true ? 'V' : vic === false ? 'D' : '?';
    const label = tourLabel(c.tour);

    const match = assaults.find(a => a.tour === c.tour);
    const matchNote = match
      ? `<span class="analyze-match-note">→ ${label}</span>`
      : `<span class="analyze-match-note" style="color:var(--muted)">tour non trouvé</span>`;

    const smJS  = sm  != null ? sm  : 'null';
    const saJS  = sa  != null ? sa  : 'null';
    const vicJS = vic != null ? vic : 'null';
    const advSafe = (adv || '').replace(/'/g, "\\'");
    const applyBtn = match
      ? `<button class="analyze-apply-btn" onclick="applyTableauAnalysis(${match.id},${smJS},${saJS},${vicJS},'${advSafe}')">Appliquer</button>`
      : '';

    html += `<div class="analyze-combat-row">
      <span style="font-size:.72rem;font-weight:800;color:var(--primary);min-width:72px;flex-shrink:0">${label}</span>
      <span class="analyze-adv">${esc(adv) || '—'}</span>
      <span class="analyze-score">${score}</span>
      <span class="analyze-result ${rc}">${rl}</span>
      ${matchNote}
      ${applyBtn}
    </div>`;
  });
  html += '</div>';
  container.innerHTML = html;
}

async function applyTableauAnalysis(assaultId, sm, sa, vic, adv) {
  try {
    const saved = await api(`/api/assaults_tableau/${assaultId}`, {
      method: 'PATCH',
      body: { adversaire: adv, score_moi: sm, score_adversaire: sa, victoire: vic },
    });
    const head = document.querySelector(`#tRow${assaultId} .assault-row-head`);
    if (head) {
      head.querySelector('.row-adv').innerHTML = esc(saved.adversaire) || '<em style="color:var(--muted)">—</em>';
      const s = (saved.score_moi != null && saved.score_adversaire != null) ? `${saved.score_moi}–${saved.score_adversaire}` : '—';
      head.querySelector('.row-score').textContent = s;
      const b = head.querySelector('.result-badge');
      b.className = `result-badge ${saved.victoire ? 'victory' : 'defeat'}`;
      b.textContent = saved.victoire ? 'V' : 'D';
    }
    const advEl = document.getElementById(`tAdv${assaultId}`);
    const smEl  = document.getElementById(`tSm${assaultId}`);
    const saEl  = document.getElementById(`tSa${assaultId}`);
    if (advEl) advEl.value = adv;
    if (smEl) smEl.value = sm ?? '';
    if (saEl) saEl.value = sa ?? '';
    setFeedback('feedbackDetail', '✓ Assault tableau mis à jour depuis la photo', 'ok');
    setTimeout(() => setFeedback('feedbackDetail', '', ''), 2500);
  } catch { alert('Erreur lors de l\'application.'); }
}

async function saveCompInfo() {
  const id = S.detailComp.id;
  const payload = {
    nom:           document.getElementById('dCompNom').value.trim(),
    date:          document.getElementById('dCompDate').value,
    arme:          document.getElementById('dCompArme').value,
    niveau:        getActive('dCompNiveau'),
    ville:         document.getElementById('dCompVille').value.trim(),
    lieu:          document.getElementById('dCompLieu').value.trim(),
    etat_de_forme: document.getElementById('dCompForme').value.trim(),
  };
  try {
    const c = await api(`/api/competitions/${id}`, { method: 'PATCH', body: payload });
    S.detailComp = c;
    document.getElementById('detailCompNom').textContent = c.nom;
    setFeedback('feedbackDetail', 'Infos enregistrées !', 'ok');
    setTimeout(() => setFeedback('feedbackDetail', '', ''), 3000);
    loadComps();
  } catch { setFeedback('feedbackDetail', 'Erreur.', 'error'); }
}

async function saveCompNotes() {
  const id    = S.detailComp.id;
  const notes = document.getElementById('dCompNotes').value.trim();
  try {
    await api(`/api/competitions/${id}`, { method: 'PATCH', body: { notes_analyse: notes } });
    setFeedback('feedbackDetail', 'Notes enregistrées !', 'ok');
    setTimeout(() => setFeedback('feedbackDetail', '', ''), 3000);
  } catch { setFeedback('feedbackDetail', 'Erreur.', 'error'); }
}

// ── Assault rows collapsibles ─────────────────────────────
function toggleRow(editId) {
  const body = document.getElementById(editId);
  if (!body) return;
  const opening = body.classList.contains('hidden');
  body.classList.toggle('hidden');
  body.previousElementSibling?.querySelector('.row-chevron')?.classList.toggle('rotated', opening);
}

const CHEVRON_SVG = `<svg class="row-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><polyline points="6,9 12,15 18,9"/></svg>`;

function renderPouleRow(a) {
  const score = (a.score_moi != null && a.score_adversaire != null)
    ? `${a.score_moi}–${a.score_adversaire}` : '—';
  const vic = a.victoire;
  const rc  = vic === true ? 'victory' : vic === false ? 'defeat' : 'unknown';
  const rl  = vic === true ? 'V' : vic === false ? 'D' : '?';
  return `<div class="assault-row" id="pRow${a.id}">
    <div class="assault-row-head" onclick="toggleRow('pEdit${a.id}')">
      <span class="row-num">A${a.numero}</span>
      <span class="row-adv">${esc(a.adversaire) || '<em style="color:var(--muted)">—</em>'}</span>
      <span class="row-score">${score}</span>
      <span class="result-badge ${rc}">${rl}</span>
      ${CHEVRON_SVG}
    </div>
    <div class="assault-row-body hidden" id="pEdit${a.id}">
      ${a.commentaires ? `<p class="row-comment">${esc(a.commentaires)}</p>` : ''}
      <div class="field-group">
        <label class="field-label">Adversaire</label>
        <input type="text" class="field-input" id="pAdv${a.id}" value="${esc(a.adversaire)}" />
      </div>
      <div class="score-row">
        <div class="field-group score-field">
          <label class="field-label">Moi</label>
          <input type="number" class="field-input score-input" id="pSm${a.id}" value="${a.score_moi ?? ''}" min="0" max="15" placeholder="—" />
        </div>
        <div class="score-sep">–</div>
        <div class="field-group score-field">
          <label class="field-label">Adv.</label>
          <input type="number" class="field-input score-input" id="pSa${a.id}" value="${a.score_adversaire ?? ''}" min="0" max="15" placeholder="—" />
        </div>
      </div>
      <div class="field-group">
        <label class="field-label">Commentaires <span class="opt">(pendant la compét.)</span></label>
        <textarea class="field-textarea" id="pComm${a.id}" style="min-height:60px" placeholder="Notes…">${esc(a.commentaires)}</textarea>
      </div>
      <div class="field-group">
        <label class="field-label">Note complémentaire</label>
        <div class="notes-area">
          <textarea class="field-textarea" id="pPost${a.id}" style="min-height:60px;padding-right:50px" placeholder="Analyse, retour maître d'arme…">${esc(a.notes_post)}</textarea>
          <button class="mic-btn" onclick="startMic('pPost${a.id}', this)" title="Dicter">${MIC_SVG}</button>
        </div>
      </div>
      <div class="btn-row" style="margin-top:4px">
        <button class="btn-danger-sm" onclick="deletePouleRow(${a.id})">Supprimer</button>
        <button class="save-btn flex-1" onclick="savePouleRow(${a.id})">Enregistrer</button>
      </div>
    </div>
  </div>`;
}

function renderTableauRow(a) {
  const score = (a.score_moi != null && a.score_adversaire != null)
    ? `${a.score_moi}–${a.score_adversaire}` : '—';
  const rc = a.victoire ? 'victory' : 'defeat';
  const rl = a.victoire ? 'V' : 'D';
  return `<div class="assault-row" id="tRow${a.id}">
    <div class="assault-row-head" onclick="toggleRow('tEdit${a.id}')">
      <span class="row-num">${tourLabel(a.tour)}</span>
      <span class="row-adv">${esc(a.adversaire) || '<em style="color:var(--muted)">—</em>'}</span>
      <span class="row-score">${score}</span>
      <span class="result-badge ${rc}">${rl}</span>
      ${CHEVRON_SVG}
    </div>
    <div class="assault-row-body hidden" id="tEdit${a.id}">
      ${a.commentaires ? `<p class="row-comment">${esc(a.commentaires)}</p>` : ''}
      <div class="field-group">
        <label class="field-label">Adversaire</label>
        <input type="text" class="field-input" id="tAdv${a.id}" value="${esc(a.adversaire)}" />
      </div>
      <div class="score-row">
        <div class="field-group score-field">
          <label class="field-label">Moi</label>
          <input type="number" class="field-input score-input" id="tSm${a.id}" value="${a.score_moi ?? ''}" min="0" max="15" placeholder="—" />
        </div>
        <div class="score-sep">–</div>
        <div class="field-group score-field">
          <label class="field-label">Adv.</label>
          <input type="number" class="field-input score-input" id="tSa${a.id}" value="${a.score_adversaire ?? ''}" min="0" max="15" placeholder="—" />
        </div>
      </div>
      <div class="field-group">
        <label class="field-label">Résultat</label>
        <div class="toggle-row" id="tVic${a.id}">
          <button class="toggle-btn ${a.victoire ? 'active' : ''}" data-val="true"
            onclick="setActive('tVic${a.id}','true')">Victoire</button>
          <button class="toggle-btn ${!a.victoire ? 'active' : ''}" data-val="false"
            onclick="setActive('tVic${a.id}','false')">Défaite</button>
        </div>
      </div>
      <div class="field-group">
        <label class="field-label">Commentaires <span class="opt">(pendant la compét.)</span></label>
        <textarea class="field-textarea" id="tComm${a.id}" style="min-height:60px" placeholder="Notes…">${esc(a.commentaires)}</textarea>
      </div>
      <div class="field-group">
        <label class="field-label">Note complémentaire</label>
        <div class="notes-area">
          <textarea class="field-textarea" id="tPost${a.id}" style="min-height:60px;padding-right:50px" placeholder="Analyse, retour maître d'arme…">${esc(a.notes_post)}</textarea>
          <button class="mic-btn" onclick="startMic('tPost${a.id}', this)" title="Dicter">${MIC_SVG}</button>
        </div>
      </div>
      <div class="btn-row" style="margin-top:4px">
        <button class="btn-danger-sm" onclick="deleteTableauRow(${a.id})">Supprimer</button>
        <button class="save-btn flex-1" onclick="saveTableauRow(${a.id})">Enregistrer</button>
      </div>
    </div>
  </div>`;
}

async function savePouleRow(id) {
  const adv  = document.getElementById(`pAdv${id}`).value.trim();
  const sm   = parseInt(document.getElementById(`pSm${id}`).value);
  const sa   = parseInt(document.getElementById(`pSa${id}`).value);
  const comm = document.getElementById(`pComm${id}`).value.trim();
  const post = document.getElementById(`pPost${id}`).value.trim();
  const vic  = (!isNaN(sm) && !isNaN(sa)) ? (sm > sa) : null;
  try {
    const saved = await api(`/api/assaults_poule/${id}`, {
      method: 'PATCH',
      body: { adversaire: adv, score_moi: isNaN(sm) ? null : sm,
              score_adversaire: isNaN(sa) ? null : sa, victoire: vic,
              commentaires: comm, notes_post: post }
    });
    const head = document.querySelector(`#pRow${id} .assault-row-head`);
    if (head) {
      head.querySelector('.row-adv').innerHTML = esc(saved.adversaire) || '<em style="color:var(--muted)">—</em>';
      const s = (saved.score_moi != null && saved.score_adversaire != null) ? `${saved.score_moi}–${saved.score_adversaire}` : '—';
      head.querySelector('.row-score').textContent = s;
      const b = head.querySelector('.result-badge');
      const v = saved.victoire;
      b.className = `result-badge ${v === true ? 'victory' : v === false ? 'defeat' : 'unknown'}`;
      b.textContent = v === true ? 'V' : v === false ? 'D' : '?';
    }
    const body = document.getElementById(`pEdit${id}`);
    const cp = body?.querySelector('.row-comment');
    if (comm) { if (cp) cp.textContent = comm; else if (body) { const p = document.createElement('p'); p.className = 'row-comment'; p.textContent = comm; body.insertBefore(p, body.firstChild); } }
    else if (cp) cp.remove();
    toggleRow(`pEdit${id}`);
  } catch { alert('Erreur lors de la sauvegarde.'); }
}

async function saveTableauRow(id) {
  const adv  = document.getElementById(`tAdv${id}`).value.trim();
  const sm   = parseInt(document.getElementById(`tSm${id}`).value);
  const sa   = parseInt(document.getElementById(`tSa${id}`).value);
  const comm = document.getElementById(`tComm${id}`).value.trim();
  const post = document.getElementById(`tPost${id}`).value.trim();
  const vic  = getActive(`tVic${id}`) === 'true';
  try {
    const saved = await api(`/api/assaults_tableau/${id}`, {
      method: 'PATCH',
      body: { adversaire: adv, score_moi: isNaN(sm) ? null : sm,
              score_adversaire: isNaN(sa) ? null : sa, victoire: vic,
              commentaires: comm, notes_post: post }
    });
    const head = document.querySelector(`#tRow${id} .assault-row-head`);
    if (head) {
      head.querySelector('.row-adv').innerHTML = esc(saved.adversaire) || '<em style="color:var(--muted)">—</em>';
      const s = (saved.score_moi != null && saved.score_adversaire != null) ? `${saved.score_moi}–${saved.score_adversaire}` : '—';
      head.querySelector('.row-score').textContent = s;
      const b = head.querySelector('.result-badge');
      b.className = `result-badge ${saved.victoire ? 'victory' : 'defeat'}`;
      b.textContent = saved.victoire ? 'V' : 'D';
    }
    const body = document.getElementById(`tEdit${id}`);
    const cp = body?.querySelector('.row-comment');
    if (comm) { if (cp) cp.textContent = comm; else if (body) { const p = document.createElement('p'); p.className = 'row-comment'; p.textContent = comm; body.insertBefore(p, body.firstChild); } }
    else if (cp) cp.remove();
    toggleRow(`tEdit${id}`);
  } catch { alert('Erreur lors de la sauvegarde.'); }
}

async function deletePouleRow(id) {
  if (!confirm('Supprimer cet assault de poule ?')) return;
  try {
    await api(`/api/assaults_poule/${id}`, { method: 'DELETE' });
    document.getElementById(`pRow${id}`)?.remove();
  } catch { alert('Erreur lors de la suppression.'); }
}

async function deleteTableauRow(id) {
  if (!confirm('Supprimer cet assault de tableau ?')) return;
  try {
    await api(`/api/assaults_tableau/${id}`, { method: 'DELETE' });
    document.getElementById(`tRow${id}`)?.remove();
  } catch { alert('Erreur lors de la suppression.'); }
}

// ─────────────────────────────────────────────────────────────
//  DÉTAIL ASSAULT D'ENTRAÎNEMENT
// ─────────────────────────────────────────────────────────────
function initEntrDetail() {
  document.getElementById('btnSaveEntrDetail').addEventListener('click', saveEntrDetail);
}

async function openEntrDetail(id) {
  try {
    const a = await api(`/api/assaults/${id}`);
    S.detailEntr = a;
    document.getElementById('eEntrDate').value  = a.date;
    document.getElementById('eEntrHeure').value = a.heure.slice(0, 5);
    document.getElementById('eEntrNotes').value = a.notes;
    S.micBaseText = a.notes;
    setFeedback('feedbackEntrDetail', '', '');
    showScreen('entr', 'detail');
  } catch { alert('Impossible de charger l\'assault.'); }
}

async function saveEntrDetail() {
  const id    = S.detailEntr.id;
  const date  = document.getElementById('eEntrDate').value;
  const heure = document.getElementById('eEntrHeure').value;
  const notes = document.getElementById('eEntrNotes').value.trim();
  try {
    await api(`/api/assaults/${id}`, {
      method: 'PATCH', body: { date, heure: heure + ':00', notes }
    });
    setFeedback('feedbackEntrDetail', 'Enregistré !', 'ok');
    setTimeout(() => { setFeedback('feedbackEntrDetail', '', ''); goBackFromEntrDetail(); }, 1500);
    loadEntrainement();
    if (S.fromHisto) loadHistorique();
  } catch { setFeedback('feedbackEntrDetail', 'Erreur.', 'error'); }
}
