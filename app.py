import io
import os
import uuid
from fastapi import FastAPI, Depends, Request, HTTPException, UploadFile, File, Form, Header
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from openpyxl import Workbook
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional
from datetime import date as dt_date, time as dt_time, datetime

import database

app = FastAPI(title="MED - My Escrime Data")

UPLOAD_DIR = "static/uploads"

app.mount("/static", StaticFiles(directory="static"), name="static")
templates = Jinja2Templates(directory="templates")


@app.on_event("startup")
def startup_event():
    database.init_db()
    os.makedirs(UPLOAD_DIR, exist_ok=True)


# ─────────────────────────────────────────────────────────────────────────────
#  Auth
# ─────────────────────────────────────────────────────────────────────────────

def get_current_user(
    x_user_token: Optional[str] = Header(None),
    db: Session = Depends(database.get_db),
) -> database.User:
    if not x_user_token:
        raise HTTPException(status_code=403, detail="Token manquant")
    user = db.query(database.User).filter(database.User.token == x_user_token).first()
    if not user:
        raise HTTPException(status_code=403, detail="Token invalide")
    return user


def require_admin(request: Request):
    """Admin accessible uniquement via Tailscale ou réseau local (pas via Cloudflare)."""
    if request.headers.get("CF-Connecting-IP"):
        raise HTTPException(status_code=403, detail="Admin non accessible depuis internet")
    host = request.client.host if request.client else ""
    if not (host.startswith("100.") or host in ("127.0.0.1", "::1")):
        raise HTTPException(status_code=403, detail="Accès refusé")


# ─────────────────────────────────────────────────────────────────────────────
#  Pages
# ─────────────────────────────────────────────────────────────────────────────

@app.get("/")
def index(request: Request):
    return templates.TemplateResponse("index.html", {"request": request})


@app.get("/api/me")
def get_me(user: database.User = Depends(get_current_user)):
    return {"id": user.id, "name": user.name}


@app.get("/admin")
def admin_page(request: Request, db: Session = Depends(database.get_db)):
    require_admin(request)
    users = db.query(database.User).order_by(database.User.created_at).all()
    return templates.TemplateResponse("admin.html", {"request": request, "users": users})


@app.get("/admin/data")
def data_page(request: Request, db: Session = Depends(database.get_db)):
    require_admin(request)
    users = db.query(database.User).order_by(database.User.created_at).all()
    return templates.TemplateResponse("data.html", {"request": request, "users": users})


# ─────────────────────────────────────────────────────────────────────────────
#  Admin — gestion utilisateurs
# ─────────────────────────────────────────────────────────────────────────────

class UserPayload(BaseModel):
    name: str


@app.post("/api/admin/users")
def create_user(request: Request, payload: UserPayload, db: Session = Depends(database.get_db)):
    require_admin(request)
    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Nom obligatoire")
    user = database.User(name=name, token=str(uuid.uuid4()))
    db.add(user)
    db.commit()
    db.refresh(user)
    return _user_dict(user)


@app.get("/api/admin/users")
def list_users(request: Request, db: Session = Depends(database.get_db)):
    require_admin(request)
    users = db.query(database.User).order_by(database.User.created_at).all()
    return [_user_dict(u) for u in users]


@app.get("/api/admin/users/{user_id}/competitions")
def admin_list_competitions(user_id: int, request: Request, db: Session = Depends(database.get_db)):
    require_admin(request)
    rows = (
        db.query(database.Competition)
        .filter(database.Competition.user_id == user_id)
        .order_by(database.Competition.date.desc())
        .all()
    )
    return [_competition_dict(c) for c in rows]


@app.get("/api/admin/users/{user_id}/assaults")
def admin_list_assaults(user_id: int, request: Request, db: Session = Depends(database.get_db)):
    require_admin(request)
    rows = (
        db.query(database.Assault)
        .filter(database.Assault.user_id == user_id)
        .order_by(database.Assault.date.desc())
        .all()
    )
    return [_assault_dict(a) for a in rows]


@app.get("/api/admin/competitions/{comp_id}/detail")
def admin_competition_detail(comp_id: int, request: Request, db: Session = Depends(database.get_db)):
    require_admin(request)
    c = _get_or_404(db, database.Competition, comp_id)
    result = _competition_dict(c)

    p = db.query(database.Poule).filter(database.Poule.competition_id == comp_id).first()
    if p:
        assaults_poule = (
            db.query(database.AssaultPoule)
            .filter(database.AssaultPoule.poule_id == p.id)
            .order_by(database.AssaultPoule.numero)
            .all()
        )
        result["poule"] = {**_poule_dict(p), "assaults": [_assault_poule_dict(a) for a in assaults_poule]}
    else:
        result["poule"] = None

    tableau = (
        db.query(database.AssaultTableau)
        .filter(database.AssaultTableau.competition_id == comp_id)
        .order_by(database.AssaultTableau.tour)
        .all()
    )
    result["tableau"] = [_assault_tableau_dict(a) for a in tableau]
    return result


@app.delete("/api/admin/users/{user_id}")
def delete_user(user_id: int, request: Request, db: Session = Depends(database.get_db)):
    require_admin(request)
    user = db.query(database.User).filter(database.User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Utilisateur introuvable")
    db.delete(user)
    db.commit()
    return {"ok": True}


# ─────────────────────────────────────────────────────────────────────────────
#  Entraînement — assaults libres
# ─────────────────────────────────────────────────────────────────────────────

class AssaultPayload(BaseModel):
    date: str
    heure: str
    notes: Optional[str] = ""


@app.post("/api/assaults")
def create_assault(
    payload: AssaultPayload,
    db: Session = Depends(database.get_db),
    user: database.User = Depends(get_current_user),
):
    a = database.Assault(
        user_id=user.id,
        date=dt_date.fromisoformat(payload.date),
        heure=dt_time.fromisoformat(payload.heure),
        type_seance="entrainement",
        notes=payload.notes.strip() if payload.notes else "",
    )
    db.add(a)
    db.commit()
    db.refresh(a)
    return _assault_dict(a)


@app.get("/api/assaults")
def list_assaults(
    db: Session = Depends(database.get_db),
    user: database.User = Depends(get_current_user),
):
    rows = (
        db.query(database.Assault)
        .filter(database.Assault.user_id == user.id)
        .order_by(database.Assault.date.desc(), database.Assault.heure.desc())
        .all()
    )
    return [_assault_dict(a) for a in rows]


@app.get("/api/assaults/{assault_id}")
def get_assault(
    assault_id: int,
    db: Session = Depends(database.get_db),
    user: database.User = Depends(get_current_user),
):
    a = _get_or_404(db, database.Assault, assault_id)
    _check_owner(a.user_id, user.id)
    return _assault_dict(a)


@app.patch("/api/assaults/{assault_id}")
def patch_assault(
    assault_id: int,
    data: dict,
    db: Session = Depends(database.get_db),
    user: database.User = Depends(get_current_user),
):
    a = _get_or_404(db, database.Assault, assault_id)
    _check_owner(a.user_id, user.id)
    for k, v in data.items():
        if k == "date":
            a.date = dt_date.fromisoformat(v)
        elif k == "heure":
            a.heure = dt_time.fromisoformat(v)
        elif k == "notes":
            a.notes = v
    db.commit()
    db.refresh(a)
    return _assault_dict(a)


@app.delete("/api/assaults/{assault_id}")
def delete_assault(
    assault_id: int,
    db: Session = Depends(database.get_db),
    user: database.User = Depends(get_current_user),
):
    a = _get_or_404(db, database.Assault, assault_id)
    _check_owner(a.user_id, user.id)
    db.delete(a)
    db.commit()
    return {"ok": True}


# ─────────────────────────────────────────────────────────────────────────────
#  Leçons
# ─────────────────────────────────────────────────────────────────────────────

class LeconPayload(BaseModel):
    date: str
    heure: str
    maitre: Optional[str] = ""
    theme: Optional[str] = ""
    notes: Optional[str] = ""


@app.post("/api/lecons")
def create_lecon(
    payload: LeconPayload,
    db: Session = Depends(database.get_db),
    user: database.User = Depends(get_current_user),
):
    l = database.Lecon(
        user_id=user.id,
        date=dt_date.fromisoformat(payload.date),
        heure=dt_time.fromisoformat(payload.heure),
        maitre=payload.maitre.strip() if payload.maitre else "",
        theme=payload.theme.strip() if payload.theme else "",
        notes=payload.notes.strip() if payload.notes else "",
    )
    db.add(l)
    db.commit()
    db.refresh(l)
    return _lecon_dict(l)


@app.get("/api/lecons")
def list_lecons(
    db: Session = Depends(database.get_db),
    user: database.User = Depends(get_current_user),
):
    rows = (
        db.query(database.Lecon)
        .filter(database.Lecon.user_id == user.id)
        .order_by(database.Lecon.date.desc(), database.Lecon.heure.desc())
        .all()
    )
    return [_lecon_dict(l) for l in rows]


@app.get("/api/lecons/{lecon_id}")
def get_lecon(
    lecon_id: int,
    db: Session = Depends(database.get_db),
    user: database.User = Depends(get_current_user),
):
    l = _get_or_404(db, database.Lecon, lecon_id)
    _check_owner(l.user_id, user.id)
    return _lecon_dict(l)


@app.patch("/api/lecons/{lecon_id}")
def patch_lecon(
    lecon_id: int,
    data: dict,
    db: Session = Depends(database.get_db),
    user: database.User = Depends(get_current_user),
):
    l = _get_or_404(db, database.Lecon, lecon_id)
    _check_owner(l.user_id, user.id)
    for k, v in data.items():
        if k == "date":
            l.date = dt_date.fromisoformat(v)
        elif k == "heure":
            l.heure = dt_time.fromisoformat(v)
        elif k in {"maitre", "theme", "notes"}:
            setattr(l, k, v)
    db.commit()
    db.refresh(l)
    return _lecon_dict(l)


@app.delete("/api/lecons/{lecon_id}")
def delete_lecon(
    lecon_id: int,
    db: Session = Depends(database.get_db),
    user: database.User = Depends(get_current_user),
):
    l = _get_or_404(db, database.Lecon, lecon_id)
    _check_owner(l.user_id, user.id)
    db.delete(l)
    db.commit()
    return {"ok": True}


# ─────────────────────────────────────────────────────────────────────────────
#  Compétitions
# ─────────────────────────────────────────────────────────────────────────────

class CompetitionPayload(BaseModel):
    nom: str
    date: str
    arme: Optional[str] = "epee"
    niveau: str
    ville: Optional[str] = ""
    lieu: Optional[str] = ""
    etat_de_forme: Optional[str] = ""
    a_poule: bool
    a_tableau: bool


@app.post("/api/competitions")
def create_competition(
    payload: CompetitionPayload,
    db: Session = Depends(database.get_db),
    user: database.User = Depends(get_current_user),
):
    c = database.Competition(
        user_id=user.id,
        nom=payload.nom.strip(),
        date=dt_date.fromisoformat(payload.date),
        arme=payload.arme or "epee",
        niveau=payload.niveau,
        ville=payload.ville.strip() if payload.ville else "",
        lieu=payload.lieu.strip() if payload.lieu else "",
        etat_de_forme=payload.etat_de_forme.strip() if payload.etat_de_forme else "",
        a_poule=payload.a_poule,
        a_tableau=payload.a_tableau,
    )
    db.add(c)
    db.commit()
    db.refresh(c)
    return _competition_dict(c)


@app.get("/api/competitions")
def list_competitions(
    db: Session = Depends(database.get_db),
    user: database.User = Depends(get_current_user),
):
    rows = (
        db.query(database.Competition)
        .filter(database.Competition.user_id == user.id)
        .order_by(database.Competition.date.desc())
        .all()
    )
    return [_competition_dict(c) for c in rows]


@app.get("/api/competitions/{comp_id}")
def get_competition(
    comp_id: int,
    db: Session = Depends(database.get_db),
    user: database.User = Depends(get_current_user),
):
    c = _get_or_404(db, database.Competition, comp_id)
    _check_owner(c.user_id, user.id)
    return _competition_dict(c)


@app.patch("/api/competitions/{comp_id}")
def patch_competition(
    comp_id: int,
    data: dict,
    db: Session = Depends(database.get_db),
    user: database.User = Depends(get_current_user),
):
    c = _get_or_404(db, database.Competition, comp_id)
    _check_owner(c.user_id, user.id)
    allowed = {"terminee", "nom", "arme", "niveau", "ville", "lieu", "etat_de_forme", "notes_analyse"}
    for k, v in data.items():
        if k == "date":
            c.date = dt_date.fromisoformat(v)
        elif k in allowed:
            setattr(c, k, v)
    db.commit()
    db.refresh(c)
    return _competition_dict(c)


# ─────────────────────────────────────────────────────────────────────────────
#  Poules
# ─────────────────────────────────────────────────────────────────────────────

class PoulePayload(BaseModel):
    nb_tireurs: int


@app.post("/api/competitions/{comp_id}/poule")
def create_poule(
    comp_id: int,
    payload: PoulePayload,
    db: Session = Depends(database.get_db),
    user: database.User = Depends(get_current_user),
):
    c = _get_or_404(db, database.Competition, comp_id)
    _check_owner(c.user_id, user.id)
    p = database.Poule(competition_id=comp_id, nb_tireurs=payload.nb_tireurs)
    db.add(p)
    db.commit()
    db.refresh(p)
    return _poule_dict(p)


@app.get("/api/competitions/{comp_id}/poule")
def get_poule(
    comp_id: int,
    db: Session = Depends(database.get_db),
    user: database.User = Depends(get_current_user),
):
    c = _get_or_404(db, database.Competition, comp_id)
    _check_owner(c.user_id, user.id)
    p = db.query(database.Poule).filter(database.Poule.competition_id == comp_id).first()
    if not p:
        raise HTTPException(status_code=404, detail="Poule introuvable")
    return _poule_dict(p)


@app.patch("/api/poules/{poule_id}")
def patch_poule(
    poule_id: int,
    data: dict,
    db: Session = Depends(database.get_db),
    user: database.User = Depends(get_current_user),
):
    p = _get_or_404(db, database.Poule, poule_id)
    c = _get_or_404(db, database.Competition, p.competition_id)
    _check_owner(c.user_id, user.id)
    allowed = {"qualifie", "terminee"}
    for k, v in data.items():
        if k in allowed:
            setattr(p, k, v)
    db.commit()
    db.refresh(p)
    return _poule_dict(p)


# ─────────────────────────────────────────────────────────────────────────────
#  Assaults de poule
# ─────────────────────────────────────────────────────────────────────────────

class AssaultPoulePayload(BaseModel):
    numero: int
    adversaire: Optional[str] = ""
    score_moi: Optional[int] = None
    score_adversaire: Optional[int] = None
    victoire: Optional[bool] = None
    commentaires: Optional[str] = ""


@app.post("/api/poules/{poule_id}/assaults")
def create_assault_poule(
    poule_id: int,
    payload: AssaultPoulePayload,
    db: Session = Depends(database.get_db),
    user: database.User = Depends(get_current_user),
):
    p = _get_or_404(db, database.Poule, poule_id)
    c = _get_or_404(db, database.Competition, p.competition_id)
    _check_owner(c.user_id, user.id)
    a = database.AssaultPoule(
        poule_id=poule_id,
        numero=payload.numero,
        adversaire=payload.adversaire.strip() if payload.adversaire else "",
        score_moi=payload.score_moi,
        score_adversaire=payload.score_adversaire,
        victoire=payload.victoire,
        commentaires=payload.commentaires.strip() if payload.commentaires else "",
    )
    db.add(a)
    db.commit()
    db.refresh(a)
    return _assault_poule_dict(a)


@app.patch("/api/assaults_poule/{assault_id}")
def patch_assault_poule(
    assault_id: int,
    data: dict,
    db: Session = Depends(database.get_db),
    user: database.User = Depends(get_current_user),
):
    a = _get_or_404(db, database.AssaultPoule, assault_id)
    p = _get_or_404(db, database.Poule, a.poule_id)
    c = _get_or_404(db, database.Competition, p.competition_id)
    _check_owner(c.user_id, user.id)
    allowed = {"adversaire", "score_moi", "score_adversaire", "victoire", "commentaires", "notes_post"}
    for k, v in data.items():
        if k in allowed:
            setattr(a, k, v)
    db.commit()
    db.refresh(a)
    return _assault_poule_dict(a)


@app.get("/api/poules/{poule_id}/assaults")
def list_assaults_poule(
    poule_id: int,
    db: Session = Depends(database.get_db),
    user: database.User = Depends(get_current_user),
):
    p = _get_or_404(db, database.Poule, poule_id)
    c = _get_or_404(db, database.Competition, p.competition_id)
    _check_owner(c.user_id, user.id)
    rows = (
        db.query(database.AssaultPoule)
        .filter(database.AssaultPoule.poule_id == poule_id)
        .order_by(database.AssaultPoule.numero)
        .all()
    )
    return [_assault_poule_dict(a) for a in rows]


# ─────────────────────────────────────────────────────────────────────────────
#  Assaults de tableau
# ─────────────────────────────────────────────────────────────────────────────

class AssaultTableauPayload(BaseModel):
    tour: int
    adversaire: Optional[str] = ""
    score_moi: Optional[int] = None
    score_adversaire: Optional[int] = None
    victoire: bool
    commentaires: Optional[str] = ""


@app.post("/api/competitions/{comp_id}/tableau")
def create_assault_tableau(
    comp_id: int,
    payload: AssaultTableauPayload,
    db: Session = Depends(database.get_db),
    user: database.User = Depends(get_current_user),
):
    c = _get_or_404(db, database.Competition, comp_id)
    _check_owner(c.user_id, user.id)
    a = database.AssaultTableau(
        competition_id=comp_id,
        tour=payload.tour,
        adversaire=payload.adversaire.strip() if payload.adversaire else "",
        score_moi=payload.score_moi,
        score_adversaire=payload.score_adversaire,
        victoire=payload.victoire,
        commentaires=payload.commentaires.strip() if payload.commentaires else "",
    )
    db.add(a)
    db.commit()
    db.refresh(a)
    return _assault_tableau_dict(a)


@app.patch("/api/assaults_tableau/{assault_id}")
def patch_assault_tableau(
    assault_id: int,
    data: dict,
    db: Session = Depends(database.get_db),
    user: database.User = Depends(get_current_user),
):
    a = _get_or_404(db, database.AssaultTableau, assault_id)
    c = _get_or_404(db, database.Competition, a.competition_id)
    _check_owner(c.user_id, user.id)
    allowed = {"adversaire", "score_moi", "score_adversaire", "victoire", "commentaires", "notes_post"}
    for k, v in data.items():
        if k in allowed:
            setattr(a, k, v)
    db.commit()
    db.refresh(a)
    return _assault_tableau_dict(a)


@app.get("/api/competitions/{comp_id}/tableau")
def list_assaults_tableau(
    comp_id: int,
    db: Session = Depends(database.get_db),
    user: database.User = Depends(get_current_user),
):
    c = _get_or_404(db, database.Competition, comp_id)
    _check_owner(c.user_id, user.id)
    rows = (
        db.query(database.AssaultTableau)
        .filter(database.AssaultTableau.competition_id == comp_id)
        .order_by(database.AssaultTableau.created_at)
        .all()
    )
    return [_assault_tableau_dict(a) for a in rows]


# ─────────────────────────────────────────────────────────────────────────────
#  Export XLSX
# ─────────────────────────────────────────────────────────────────────────────

def _tour_label_py(n: int) -> str:
    if n == 2:  return "Finale"
    if n == 4:  return "Demi-finale"
    if n == 8:  return "Quart de finale"
    return f"Tour de {n}"


def _xlsx_competitions(user_id: int, db: Session) -> io.BytesIO:
    wb = Workbook()
    ws1 = wb.active
    ws1.title = "Compétitions"
    ws1.append([
        "ID", "Nom", "Date", "Arme", "Niveau", "Ville", "Lieu",
        "Etat_de_forme", "A_poule", "A_tableau", "Terminée", "Notes_analyse",
    ])
    comps = (
        db.query(database.Competition)
        .filter(database.Competition.user_id == user_id)
        .order_by(database.Competition.date)
        .all()
    )
    for c in comps:
        ws1.append([
            c.id, c.nom, str(c.date), c.arme, c.niveau,
            c.ville or "", c.lieu or "", c.etat_de_forme or "",
            c.a_poule, c.a_tableau, c.terminee, c.notes_analyse or "",
        ])

    ws2 = wb.create_sheet("Assaults_Poule")
    ws2.append([
        "Competition_ID", "Competition_Nom", "Competition_Date",
        "Poule_ID", "Numero", "Adversaire",
        "Score_moi", "Score_adversaire", "Victoire",
        "Commentaires", "Notes_post",
    ])
    for c in comps:
        poule = db.query(database.Poule).filter(database.Poule.competition_id == c.id).first()
        if not poule:
            continue
        for a in (
            db.query(database.AssaultPoule)
            .filter(database.AssaultPoule.poule_id == poule.id)
            .order_by(database.AssaultPoule.numero)
            .all()
        ):
            ws2.append([
                c.id, c.nom, str(c.date),
                poule.id, a.numero, a.adversaire or "",
                a.score_moi, a.score_adversaire, a.victoire,
                a.commentaires or "", a.notes_post or "",
            ])

    ws3 = wb.create_sheet("Assaults_Tableau")
    ws3.append([
        "Competition_ID", "Competition_Nom", "Competition_Date",
        "Tour_label", "Tour_num", "Adversaire",
        "Score_moi", "Score_adversaire", "Victoire",
        "Commentaires", "Notes_post",
    ])
    for c in comps:
        for a in (
            db.query(database.AssaultTableau)
            .filter(database.AssaultTableau.competition_id == c.id)
            .order_by(database.AssaultTableau.created_at)
            .all()
        ):
            ws3.append([
                c.id, c.nom, str(c.date),
                _tour_label_py(a.tour), a.tour, a.adversaire or "",
                a.score_moi, a.score_adversaire, a.victoire,
                a.commentaires or "", a.notes_post or "",
            ])

    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return buf


def _xlsx_entrainement(user_id: int, db: Session) -> io.BytesIO:
    wb = Workbook()
    ws1 = wb.active
    ws1.title = "Assaults_libres"
    ws1.append(["ID", "Date", "Heure", "Notes"])
    for a in (
        db.query(database.Assault)
        .filter(database.Assault.user_id == user_id)
        .order_by(database.Assault.date, database.Assault.heure)
        .all()
    ):
        ws1.append([a.id, str(a.date), str(a.heure), a.notes or ""])

    ws2 = wb.create_sheet("Leçons")
    ws2.append(["ID", "Date", "Heure", "Maitre", "Theme", "Notes"])
    for l in (
        db.query(database.Lecon)
        .filter(database.Lecon.user_id == user_id)
        .order_by(database.Lecon.date, database.Lecon.heure)
        .all()
    ):
        ws2.append([l.id, str(l.date), str(l.heure), l.maitre or "", l.theme or "", l.notes or ""])

    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return buf


XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


@app.get("/api/export/competitions")
def export_competitions_xlsx(
    db: Session = Depends(database.get_db),
    user: database.User = Depends(get_current_user),
):
    buf = _xlsx_competitions(user.id, db)
    return StreamingResponse(buf, media_type=XLSX_MIME,
        headers={"Content-Disposition": "attachment; filename=med_competitions.xlsx"})


@app.get("/api/export/entrainement")
def export_entrainement_xlsx(
    db: Session = Depends(database.get_db),
    user: database.User = Depends(get_current_user),
):
    buf = _xlsx_entrainement(user.id, db)
    return StreamingResponse(buf, media_type=XLSX_MIME,
        headers={"Content-Disposition": "attachment; filename=med_entrainement.xlsx"})


@app.get("/api/admin/users/{user_id}/export/competitions")
def admin_export_competitions(
    user_id: int,
    request: Request,
    db: Session = Depends(database.get_db),
):
    require_admin(request)
    user = db.query(database.User).filter(database.User.id == user_id).first()
    name = (user.name if user else str(user_id)).replace(" ", "_")
    buf = _xlsx_competitions(user_id, db)
    return StreamingResponse(buf, media_type=XLSX_MIME,
        headers={"Content-Disposition": f"attachment; filename=med_competitions_{name}.xlsx"})


@app.get("/api/admin/users/{user_id}/export/entrainement")
def admin_export_entrainement(
    user_id: int,
    request: Request,
    db: Session = Depends(database.get_db),
):
    require_admin(request)
    user = db.query(database.User).filter(database.User.id == user_id).first()
    name = (user.name if user else str(user_id)).replace(" ", "_")
    buf = _xlsx_entrainement(user_id, db)
    return StreamingResponse(buf, media_type=XLSX_MIME,
        headers={"Content-Disposition": f"attachment; filename=med_entrainement_{name}.xlsx"})


# ─────────────────────────────────────────────────────────────────────────────
#  Photos
# ─────────────────────────────────────────────────────────────────────────────

@app.post("/api/competitions/{comp_id}/photos")
async def upload_photo(
    comp_id: int,
    type_photo: str = Form(...),
    file: UploadFile = File(...),
    db: Session = Depends(database.get_db),
    user: database.User = Depends(get_current_user),
):
    c = _get_or_404(db, database.Competition, comp_id)
    _check_owner(c.user_id, user.id)
    ext = os.path.splitext(file.filename)[1].lower() or ".jpg"
    filename = f"{comp_id}_{type_photo}_{uuid.uuid4().hex[:8]}{ext}"
    path = os.path.join(UPLOAD_DIR, filename)
    with open(path, "wb") as f:
        f.write(await file.read())
    photo = database.Photo(competition_id=comp_id, type_photo=type_photo, filename=filename)
    db.add(photo)
    db.commit()
    db.refresh(photo)
    return {"id": photo.id, "filename": filename, "url": f"/static/uploads/{filename}"}


@app.get("/api/competitions/{comp_id}/photos")
def list_photos(
    comp_id: int,
    db: Session = Depends(database.get_db),
    user: database.User = Depends(get_current_user),
):
    c = _get_or_404(db, database.Competition, comp_id)
    _check_owner(c.user_id, user.id)
    rows = db.query(database.Photo).filter(database.Photo.competition_id == comp_id).all()
    return [
        {"id": p.id, "type_photo": p.type_photo, "filename": p.filename,
         "url": f"/static/uploads/{p.filename}"}
        for p in rows
    ]


# ─────────────────────────────────────────────────────────────────────────────
#  Helpers
# ─────────────────────────────────────────────────────────────────────────────

def _get_or_404(db, model, pk):
    obj = db.query(model).filter(model.id == pk).first()
    if not obj:
        raise HTTPException(status_code=404, detail=f"{model.__name__} introuvable")
    return obj


def _check_owner(resource_user_id: int, current_user_id: int):
    if resource_user_id != current_user_id:
        raise HTTPException(status_code=403, detail="Accès refusé")


def _user_dict(u: database.User) -> dict:
    return {"id": u.id, "name": u.name, "token": u.token,
            "created_at": u.created_at.isoformat() if u.created_at else None}


def _lecon_dict(l: database.Lecon) -> dict:
    return {
        "id": l.id, "date": str(l.date), "heure": str(l.heure),
        "maitre": l.maitre or "", "theme": l.theme or "", "notes": l.notes or "",
    }


def _assault_dict(a: database.Assault) -> dict:
    return {
        "id": a.id, "date": str(a.date), "heure": str(a.heure),
        "type_seance": a.type_seance, "notes": a.notes,
    }


def _competition_dict(c: database.Competition) -> dict:
    return {
        "id": c.id, "nom": c.nom, "date": str(c.date), "arme": c.arme,
        "niveau": c.niveau, "ville": c.ville, "lieu": c.lieu,
        "etat_de_forme": c.etat_de_forme, "a_poule": c.a_poule,
        "a_tableau": c.a_tableau, "terminee": c.terminee,
        "notes_analyse": c.notes_analyse or "",
        "created_at": c.created_at.isoformat() if c.created_at else None,
    }


def _poule_dict(p: database.Poule) -> dict:
    return {
        "id": p.id, "competition_id": p.competition_id,
        "nb_tireurs": p.nb_tireurs, "nb_assaults": p.nb_tireurs - 1,
        "qualifie": p.qualifie, "terminee": p.terminee,
    }


def _assault_poule_dict(a: database.AssaultPoule) -> dict:
    return {
        "id": a.id, "poule_id": a.poule_id, "numero": a.numero,
        "adversaire": a.adversaire, "score_moi": a.score_moi,
        "score_adversaire": a.score_adversaire, "victoire": a.victoire,
        "commentaires": a.commentaires, "notes_post": a.notes_post or "",
    }


def _assault_tableau_dict(a: database.AssaultTableau) -> dict:
    return {
        "id": a.id, "competition_id": a.competition_id, "tour": a.tour,
        "adversaire": a.adversaire, "score_moi": a.score_moi,
        "score_adversaire": a.score_adversaire, "victoire": a.victoire,
        "commentaires": a.commentaires, "notes_post": a.notes_post or "",
    }
