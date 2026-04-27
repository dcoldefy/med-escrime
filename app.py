from fastapi import FastAPI, Depends, Request, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional
from datetime import date as dt_date, time as dt_time

import database

app = FastAPI(title="MED - My Escrime Data")

app.mount("/static", StaticFiles(directory="static"), name="static")
templates = Jinja2Templates(directory="templates")


@app.on_event("startup")
def startup_event():
    database.init_db()


# --------------------------------------------------------------------------- #
#  Pages                                                                        #
# --------------------------------------------------------------------------- #

@app.get("/")
def index(request: Request):
    return templates.TemplateResponse("index.html", {"request": request})


# --------------------------------------------------------------------------- #
#  Schémas Pydantic                                                             #
# --------------------------------------------------------------------------- #

class AssaultPayload(BaseModel):
    date: str
    heure: str
    type_seance: str          # "competition" | "entrainement"
    notes: Optional[str] = ""


# --------------------------------------------------------------------------- #
#  API Assaults                                                                 #
# --------------------------------------------------------------------------- #

@app.post("/api/assaults")
def create_assault(payload: AssaultPayload, db: Session = Depends(database.get_db)):
    assault = database.Assault(
        date=dt_date.fromisoformat(payload.date),
        heure=dt_time.fromisoformat(payload.heure),
        type_seance=payload.type_seance,
        notes=payload.notes.strip() if payload.notes else "",
    )
    db.add(assault)
    db.commit()
    db.refresh(assault)
    return _assault_dict(assault)


@app.get("/api/assaults")
def list_assaults(db: Session = Depends(database.get_db)):
    assaults = (
        db.query(database.Assault)
        .order_by(database.Assault.date.desc(), database.Assault.heure.desc())
        .all()
    )
    return [_assault_dict(a) for a in assaults]


@app.delete("/api/assaults/{assault_id}")
def delete_assault(assault_id: int, db: Session = Depends(database.get_db)):
    assault = db.query(database.Assault).filter(database.Assault.id == assault_id).first()
    if not assault:
        raise HTTPException(status_code=404, detail="Assault introuvable")
    db.delete(assault)
    db.commit()
    return {"ok": True}


# --------------------------------------------------------------------------- #
#  Helpers                                                                      #
# --------------------------------------------------------------------------- #

def _assault_dict(a: database.Assault) -> dict:
    return {
        "id": a.id,
        "date": str(a.date),
        "heure": str(a.heure),
        "type_seance": a.type_seance,
        "notes": a.notes,
    }
