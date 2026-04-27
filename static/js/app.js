/* ============================================================
   MED — My Escrime Data  |  app.js
   ============================================================ */

// ── État global ──────────────────────────────────────────────
let currentType = 'entrainement';
let isListening  = false;
let recognition  = null;
let baseText     = '';

// ── Init ─────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  initDate();
  initTabs();
  initTypeSelector();
  initMic();
  initSave();
  loadHistory();
});

// ── Date dans le header ───────────────────────────────────────
function initDate() {
  const el = document.getElementById('headerDate');
  const now = new Date();
  el.textContent = now.toLocaleDateString('fr-FR', {
    weekday: 'long', day: 'numeric', month: 'long'
  });
}

// ── Onglets ───────────────────────────────────────────────────
function initTabs() {
  document.querySelectorAll('.tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(s => s.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
      if (btn.dataset.tab === 'historique') loadHistory();
    });
  });
}

// ── Sélecteur type ────────────────────────────────────────────
function initTypeSelector() {
  document.querySelectorAll('.type-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.type-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentType = btn.dataset.type;
    });
  });
}

// ── Dictée vocale ─────────────────────────────────────────────
function initMic() {
  const micBtn   = document.getElementById('micBtn');
  const SpeechRecognition =
    window.SpeechRecognition || window.webkitSpeechRecognition;

  if (!SpeechRecognition) {
    micBtn.style.display = 'none';
    return;
  }

  recognition = new SpeechRecognition();
  recognition.lang = 'fr-FR';
  recognition.interimResults = true;
  recognition.continuous = false;

  recognition.onresult = (event) => {
    const area = document.getElementById('notesArea');
    let interim = '';
    let final   = '';
    for (let i = 0; i < event.results.length; i++) {
      const t = event.results[i][0].transcript;
      if (event.results[i].isFinal) final += t;
      else interim += t;
    }
    const sep = baseText.trim() && (final || interim) ? ' ' : '';
    area.value = baseText + sep + final + interim;
    if (final) baseText = area.value.trimStart();
  };

  recognition.onend = () => stopListening();
  recognition.onerror = () => stopListening();

  micBtn.addEventListener('click', () => {
    if (isListening) stopListening();
    else startListening();
  });
}

function startListening() {
  const area = document.getElementById('notesArea');
  baseText = area.value;
  isListening = true;
  document.getElementById('micBtn').classList.add('listening');
  recognition.start();
}

function stopListening() {
  isListening = false;
  document.getElementById('micBtn').classList.remove('listening');
  try { recognition.stop(); } catch (_) {}
}

// ── Enregistrement ────────────────────────────────────────────
function initSave() {
  document.getElementById('saveBtn').addEventListener('click', saveAssault);
}

async function saveAssault() {
  const notes = document.getElementById('notesArea').value.trim();
  const now   = new Date();
  const date  = now.toLocaleDateString('fr-CA');        // YYYY-MM-DD
  const heure = now.toTimeString().slice(0, 8);         // HH:MM:SS

  setFeedback('', '');

  try {
    const res = await fetch('/api/assaults', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date, heure, type_seance: currentType, notes }),
    });
    if (!res.ok) throw new Error(await res.text());

    document.getElementById('notesArea').value = '';
    baseText = '';
    setFeedback('Assault enregistré !', 'ok');
    setTimeout(() => setFeedback('', ''), 3000);
  } catch (err) {
    setFeedback('Erreur : ' + err.message, 'error');
  }
}

// ── Historique ────────────────────────────────────────────────
async function loadHistory() {
  const list = document.getElementById('historyList');
  list.innerHTML = '<p class="empty-msg">Chargement…</p>';
  try {
    const res  = await fetch('/api/assaults');
    const data = await res.json();
    if (!data.length) {
      list.innerHTML = '<p class="empty-msg">Aucun assault enregistré.</p>';
      return;
    }
    list.innerHTML = data.map(renderAssault).join('');
  } catch {
    list.innerHTML = '<p class="empty-msg" style="color:#c0392b">Erreur de chargement.</p>';
  }
}

// Icône supprimer — trait fin
const ICO_DELETE = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"
  stroke-linecap="round" stroke-linejoin="round">
  <polyline points="3,6 5,6 21,6"/>
  <path d="M19 6l-1 14H6L5 6"/>
  <path d="M9 6V4h6v2"/>
</svg>`;

function renderAssault(a) {
  const date  = new Date(a.date).toLocaleDateString('fr-FR', {
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric'
  });
  const heure = a.heure.slice(0, 5);
  const isComp = a.type_seance === 'competition';
  const badge  = isComp
    ? '<span class="assault-badge badge-competition">Compétition</span>'
    : '<span class="assault-badge badge-entrainement">Entraînement</span>';
  const notes  = a.notes
    ? `<div class="assault-notes">${esc(a.notes)}</div>`
    : '<div class="assault-notes empty">Aucune note.</div>';

  return `
    <div class="assault-card${isComp ? ' competition' : ''}" id="assault-${a.id}">
      <div class="assault-meta">
        <span class="assault-time">${heure}</span>
        ${badge}
      </div>
      <div class="assault-body">
        <div class="assault-date">${date}</div>
        ${notes}
      </div>
      <button class="del-btn" onclick="deleteAssault(${a.id})" title="Supprimer">
        ${ICO_DELETE}
      </button>
    </div>`;
}

async function deleteAssault(id) {
  if (!confirm('Supprimer cet assault ?')) return;
  try {
    const res = await fetch(`/api/assaults/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error();
    document.getElementById('assault-' + id)?.remove();
    const list = document.getElementById('historyList');
    if (!list.querySelector('.assault-card')) {
      list.innerHTML = '<p class="empty-msg">Aucun assault enregistré.</p>';
    }
  } catch {
    alert('Erreur lors de la suppression.');
  }
}

// ── Helpers ───────────────────────────────────────────────────
function setFeedback(msg, type) {
  const el = document.getElementById('feedback');
  el.textContent = msg;
  el.className   = 'feedback' + (type ? ' ' + type : '');
}

function esc(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
