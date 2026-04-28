# MED — My Escrime Data

Application web PWA de suivi et d'analyse de performances en escrime. Conçue pour un usage personnel, elle permet de consigner chaque séance d'entraînement et chaque compétition avec le détail des assaults, scores et observations tactiques.

---

## Fonctionnalités

### Entraînement
- Saisie rapide d'assaults libres (date, heure, notes)
- Historique chronologique des séances
- Dictée vocale pour les notes (Web Speech API, langue française)

### Compétitions
- Gestion complète d'une compétition : arme, niveau, ville, état de forme
- **Poule** : saisie assault par assault avec scores et résultats, qualification
- **Tableau** : suivi tour par tour jusqu'à l'élimination ou la victoire
- Notes post-assault par dictée vocale ou saisie manuelle
- Analyse libre de la compétition (notes_analyse)
- Upload de photos (feuilles de poule, tableaux)

### PWA
- Installable sur mobile et desktop
- Service Worker pour un accès hors-ligne

---

## Stack technique

| Couche | Technologie |
|---|---|
| Backend | FastAPI + SQLAlchemy |
| Base de données | SQLite |
| Frontend | HTML5 / CSS3 / JavaScript vanilla |
| PWA | Web Speech API, Service Worker, Web App Manifest |
| Déploiement | Raspberry Pi, Tailscale, systemd, SSL |

---

## Structure du projet

```
ESCRIME/
├── app.py               # Backend FastAPI — routes REST
├── database.py          # Modèles SQLAlchemy + init BDD
├── requirements.txt
├── db/
│   ├── init_db.py       # Script d'initialisation manuelle
│   └── med.db           # Base SQLite (créée au démarrage)
├── templates/
│   └── index.html       # Interface principale (SPA)
└── static/
    ├── css/style.css
    ├── js/app.js
    ├── sw.js            # Service Worker
    ├── manifest.json    # Metadata PWA
    └── uploads/         # Photos uploadées
```

---

## Modèle de données

```
Assault          → séance d'entraînement libre
Competition      → compétition (arme, niveau, ville, format)
  └── Poule      → phase de poule (nb tireurs, qualification)
        └── AssaultPoule    → un assault de poule (adversaire, score, victoire)
  └── AssaultTableau        → un tour de tableau direct
  └── Photo                 → photo de feuille de poule ou de tableau
```

---

## Lancement en développement

```bash
pip install -r requirements.txt
uvicorn app:app --reload --port 8002
# → http://localhost:8002
```

---

## Déploiement Raspberry Pi

```bash
# 1. Sur Windows : pousser les modifications
git add <fichiers>
git commit -m "..."
git push origin master

# 2. Sur le Raspberry Pi
cd ~/med-escrime && git pull
sudo systemctl restart med-escrime

# 3. Accès via Tailscale
https://<hostname>.ts.net:8002
```

### Service systemd

```ini
[Unit]
Description=MED - My Escrime Data
After=network.target

[Service]
User=<user>
WorkingDirectory=/home/<user>/med-escrime
ExecStart=/home/<user>/.venv/bin/uvicorn app:app --host 0.0.0.0 --port 8002 \
  --ssl-certfile /home/<user>/<hostname>.ts.net.crt \
  --ssl-keyfile  /home/<user>/<hostname>.ts.net.key
Restart=always

[Install]
WantedBy=multi-user.target
```

---

## API — principales routes

| Méthode | Route | Description |
|---|---|---|
| `GET` | `/` | Interface principale |
| `POST` | `/api/assaults` | Créer un assault d'entraînement |
| `GET` | `/api/assaults` | Lister les assaults |
| `PATCH` | `/api/assaults/{id}` | Modifier un assault |
| `DELETE` | `/api/assaults/{id}` | Supprimer un assault |
| `POST` | `/api/competitions` | Créer une compétition |
| `GET` | `/api/competitions` | Lister les compétitions |
| `PATCH` | `/api/competitions/{id}` | Modifier une compétition |
| `POST` | `/api/competitions/{id}/poule` | Créer la poule |
| `POST` | `/api/poules/{id}/assaults` | Ajouter un assault de poule |
| `PATCH` | `/api/assaults_poule/{id}` | Modifier un assault de poule |
| `POST` | `/api/competitions/{id}/tableau` | Ajouter un tour de tableau |
| `PATCH` | `/api/assaults_tableau/{id}` | Modifier un assault de tableau |
| `POST` | `/api/competitions/{id}/photos` | Uploader une photo |

---

## Notes

- Aucune authentification — usage privé sur réseau Tailscale
- Interface entièrement en français
- Dictée vocale configurée en `fr-FR`
