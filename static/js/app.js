/* ============================================================
   MED — My Escrime Data  |  app.js
   ============================================================ */

// ── État global ──────────────────────────────────────────────
const S = {
  tab:          'competitions',  // onglet actif
  comp:         null,            // competition en cours {id, a_poule, a_tableau, nom}
  poule:        null,            // {id, nb_tireurs, nb_assaults}
  pouleIndex:   1,               // assault courant dans la poule (1-based)
  tableauTour:  64,              // taille du tour courant
  recognition:  null,
  listening:    false,
  activeMic:    null,            // id de la textarea active pour le micro
  micBaseText:  '',
};

// ── Icône delete ─────────────────────────────────────────────
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
  initDate();
  initTabs();
  initMicAll();
  initCompForm();
  initPouleSetup();
  initPouleAssault();
  initPouleEnd();
  initTableauSetup();
  initTableauAssault();
  initCompEnd();
  initEntrainement();
  loadComps();
  loadAssaults();
  loadHistorique();
});

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
    startCompWorkflow(c);
  } catch (e) {
    setFeedback('feedbackComp', 'Erreur : ' + e.message, 'error');
  }
}

// Reprendre une compétition existante
async function resumeComp(id) {
  try {
    const c = await api(`/api/competitions/${id}`);
    S.comp = c;
    if (c.terminee) { alert('Cette compétition est terminée.'); return; }
    startCompWorkflow(c);
  } catch { alert('Impossible de charger la compétition.'); }
}

function startCompWorkflow(c) {
  if (c.a_poule) {
    document.getElementById('pouleSetupTitle').textContent = `Poule — ${esc(c.nom)}`;
    showScreen('comp', 'poule-setup');
  } else if (c.a_tableau) {
    document.getElementById('tableauSetupTitle').textContent = `Tableau — ${esc(c.nom)}`;
    showScreen('comp', 'tableau-setup');
  } else {
    showScreen('comp', 'end');
    finishComp(false);
  }
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
      S.poule      = p;
      S.pouleIndex = 1;
      showPouleAssault();
    } catch { alert('Erreur lors de la création de la poule.'); }
  });
}

// ─────────────────────────────────────────────────────────────
//  POULE — assault par assault
// ─────────────────────────────────────────────────────────────
function showPouleAssault() {
  const total = S.poule.nb_assaults;
  document.getElementById('pouleAssaultTitle').textContent =
    `Poule — Assault ${S.pouleIndex}/${total}`;
  document.getElementById('pouleProgress').style.width =
    `${((S.pouleIndex - 1) / total) * 100}%`;

  // Réinitialiser les champs
  document.getElementById('pouleAdv').value          = '';
  document.getElementById('pouleScoreMoi').value     = '';
  document.getElementById('pouleScoreAdv').value     = '';
  document.getElementById('pouleCommentaires').value = '';
  setFeedback('feedbackPoule', '', '');

  showScreen('comp', 'poule-assault');
}

function initPouleAssault() {
  document.getElementById('btnPouleSave').addEventListener('click', () => savePouleAssault(false));
  document.getElementById('btnPouleSkip').addEventListener('click', () => savePouleAssault(true));
}

async function savePouleAssault(skip) {
  const adv  = document.getElementById('pouleAdv').value.trim();
  const sm   = parseInt(document.getElementById('pouleScoreMoi').value);
  const sa   = parseInt(document.getElementById('pouleScoreAdv').value);
  const comm = document.getElementById('pouleCommentaires').value.trim();
  const vic  = (!isNaN(sm) && !isNaN(sa)) ? (sm > sa) : null;

  const payload = {
    numero:           S.pouleIndex,
    adversaire:       adv,
    score_moi:        isNaN(sm) ? null : sm,
    score_adversaire: isNaN(sa) ? null : sa,
    victoire:         vic,
    commentaires:     skip ? '' : comm,
  };

  try {
    await api(`/api/poules/${S.poule.id}/assaults`, { method: 'POST', body: payload });
    if (S.pouleIndex < S.poule.nb_assaults) {
      S.pouleIndex++;
      showPouleAssault();
    } else {
      // Fin de poule
      document.getElementById('pouleProgress').style.width = '100%';
      setActive('qualifToggle', null);  // pas de sélection par défaut
      showScreen('comp', 'poule-end');
    }
  } catch (e) {
    setFeedback('feedbackPoule', 'Erreur : ' + e.message, 'error');
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
    document.getElementById('notesArea').value = '';
    S.micBaseText = '';
    setFeedback('feedback', '', '');
    showScreen('entr', 'form');
  });

  document.getElementById('saveBtn').addEventListener('click', saveAssault);
}

async function loadAssaults() {
  const list = document.getElementById('listAssaults');
  try {
    const data = await api('/api/assaults');
    if (!data.length) { list.innerHTML = '<p class="empty-msg">Aucun assault enregistré.</p>'; return; }
    list.innerHTML = data.map(renderAssaultCard).join('');
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
    loadAssaults();
    showScreen('entr', 'list');
  } catch (e) {
    setFeedback('feedback', 'Erreur : ' + e.message, 'error');
  }
}

function renderAssaultCard(a) {
  const date  = new Date(a.date + 'T00:00:00').toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  const heure = a.heure.slice(0, 5);
  return `<div class="assault-card" id="assault-${a.id}">
    <div class="assault-meta">
      <span class="assault-time">${heure}</span>
      <span class="assault-badge badge-entrainement">Entraîn.</span>
    </div>
    <div class="assault-body">
      <div class="assault-date">${date}</div>
      <div class="assault-notes${a.notes ? '' : ' empty'}">${a.notes ? esc(a.notes) : 'Aucune note.'}</div>
    </div>
    <button class="del-btn" onclick="deleteAssault(${a.id})" title="Supprimer">${ICO_DEL}</button>
  </div>`;
}

async function deleteAssault(id) {
  if (!confirm('Supprimer cet assault ?')) return;
  await api(`/api/assaults/${id}`, { method: 'DELETE' });
  document.getElementById('assault-' + id)?.remove();
  const list = document.getElementById('listAssaults');
  if (!list.querySelector('.assault-card'))
    list.innerHTML = '<p class="empty-msg">Aucun assault enregistré.</p>';
}

// ─────────────────────────────────────────────────────────────
//  HISTORIQUE
// ─────────────────────────────────────────────────────────────
async function loadHistorique() {
  const list = document.getElementById('historyList');
  list.innerHTML = '<p class="empty-msg">Chargement…</p>';
  try {
    const [comps, assaults] = await Promise.all([
      api('/api/competitions'),
      api('/api/assaults'),
    ]);

    const items = [
      ...comps.map(c => ({ ...c, _type: 'comp', _date: c.date })),
      ...assaults.map(a => ({ ...a, _type: 'assault', _date: a.date })),
    ].sort((a, b) => b._date.localeCompare(a._date));

    if (!items.length) { list.innerHTML = '<p class="empty-msg">Aucun élément.</p>'; return; }
    list.innerHTML = items.map(it =>
      it._type === 'comp' ? renderHistoComp(it) : renderAssaultCard(it)
    ).join('');
  } catch { list.innerHTML = '<p class="empty-msg" style="color:var(--danger)">Erreur.</p>'; }
}

function renderHistoComp(c) {
  const d   = new Date(c.date + 'T00:00:00');
  const day = d.toLocaleDateString('fr-FR', { day: 'numeric' });
  const mon = d.toLocaleDateString('fr-FR', { month: 'short', year: 'numeric' });
  const arme = { epee: 'Épée', fleuret: 'Fleuret', sabre: 'Sabre' }[c.arme] || c.arme;
  return `<div class="assault-card" style="border-left-color:var(--accent)">
    <div class="assault-meta">
      <span class="assault-time">${day}</span>
      <span class="assault-badge badge-competition">Compét.</span>
    </div>
    <div class="assault-body">
      <div class="assault-date">${mon} · ${arme}</div>
      <div class="assault-notes">${esc(c.nom)}${c.ville ? ` — ${esc(c.ville)}` : ''}</div>
    </div>
  </div>`;
}

// ─────────────────────────────────────────────────────────────
//  HELPERS
// ─────────────────────────────────────────────────────────────

// Requête API JSON
async function api(url, options = {}) {
  const opts = { headers: { 'Content-Type': 'application/json' } };
  if (options.method) opts.method = options.method;
  if (options.body)   opts.body   = JSON.stringify(options.body);
  const res = await fetch(url, opts);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

// Upload multipart
async function uploadPhoto(compId, type, file) {
  const fd = new FormData();
  fd.append('type_photo', type);
  fd.append('file', file);
  const res = await fetch(`/api/competitions/${compId}/photos`, { method: 'POST', body: fd });
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
