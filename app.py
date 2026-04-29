import os
import uuid
from fastapi import FastAPI, Depends, Request, HTTPException, UploadFile, File, Form, Header
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
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


@app.get("/admin")
def admin_page(request: Request, db: Session = Depends(database.get_db)):
    require_admin(request)
    users = db.query(database.User).order_by(database.User.created_at).all()
    return templates.TemplateResponse("admin.html", {"request": request, "users": users})


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
