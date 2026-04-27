# MED — My Escrime Data

Application web PWA de suivi et analyse d'assaults d'escrime.

## Stack technique

- **Backend** : FastAPI + SQLAlchemy + SQLite
- **Frontend** : HTML5 / CSS3 / JavaScript vanilla (PWA)
- **Dictée vocale** : Web Speech API (`lang = 'fr-FR'`)
- **Port** : 8002
- **Déploiement** : Raspberry Pi via Tailscale + systemd + SSL

## Structure du projet

```
ESCRIME/
├── app.py               Backend FastAPI
├── database.py          Modèles SQLAlchemy + init BDD
├── requirements.txt
├── CLAUDE.md
├── .gitignore
├── db/
│   ├── init_db.py       Script d'initialisation manuelle
│   └── med.db           Base SQLite (créée au démarrage)
├── templates/
│   └── index.html       Interface principale (journal + historique)
└── static/
    ├── css/style.css
    ├── js/app.js
    ├── sw.js            Service Worker (PWA offline)
    └── manifest.json    Metadata PWA
```

## Développement local

```bash
# Installer les dépendances
pip install -r requirements.txt

# Lancer le serveur
uvicorn app:app --reload --port 8002

# Accès local
http://localhost:8002
```

## Déploiement Raspberry Pi

```bash
# 1. Sur Windows : modifier + commiter
git add <fichiers>
git commit -m "..."
git push origin main

# 2. Sur le Raspberry Pi
cd ~/med-escrime && git pull
sudo systemctl restart med-escrime

# 3. Accès via Tailscale
https://survalerte.tail57ebcb.ts.net:8002
```

## Service systemd (Raspberry Pi)

Fichier : `/etc/systemd/system/med-escrime.service`

```ini
[Unit]
Description=MED - My Escrime Data
After=network.target

[Service]
User=david
WorkingDirectory=/home/david/med-escrime
ExecStart=/home/david/.venv/bin/uvicorn app:app --host 0.0.0.0 --port 8002 \
  --ssl-certfile /home/david/survalerte.tail57ebcb.ts.net.crt \
  --ssl-keyfile /home/david/survalerte.tail57ebcb.ts.net.key
Restart=always

[Install]
WantedBy=multi-user.target
```

## Base de données

SQLite : `db/med.db` (créée automatiquement au démarrage via `database.init_db()`).

## Notes

- Pas d'authentification (usage privé sur réseau Tailscale)
- Modèle de données assault à étendre selon les besoins
- Module d'analyse à développer ultérieurement
