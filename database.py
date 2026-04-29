import uuid as _uuid
from sqlalchemy import create_engine, Column, Integer, String, Date, Time, Text, Boolean, DateTime, ForeignKey
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
from datetime import datetime

DATABASE_URL = "sqlite:///./db/med.db"

engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


# ── Utilisateurs ─────────────────────────────────────────────────────────────

class User(Base):
    __tablename__ = "users"

    id         = Column(Integer, primary_key=True, index=True)
    name       = Column(String(100), nullable=False)
    token      = Column(String(36), unique=True, nullable=False, default=lambda: str(_uuid.uuid4()))
    created_at = Column(DateTime, default=datetime.utcnow)


# ── Entraînement ─────────────────────────────────────────────────────────────

class Assault(Base):
    __tablename__ = "assaults"

    id            = Column(Integer, primary_key=True, index=True)
    user_id       = Column(Integer, ForeignKey("users.id"), nullable=False)
    date          = Column(Date, nullable=False)
    heure         = Column(Time, nullable=False)
    type_seance   = Column(String(20), nullable=False, default="entrainement")
    notes         = Column(Text, default="")


# ── Compétitions ─────────────────────────────────────────────────────────────

class Competition(Base):
    __tablename__ = "competitions"

    id            = Column(Integer, primary_key=True, index=True)
    user_id       = Column(Integer, ForeignKey("users.id"), nullable=False)
    nom           = Column(String(200), nullable=False)
    date          = Column(Date, nullable=False)
    arme          = Column(String(20), nullable=False, default="epee")
    niveau        = Column(String(20), nullable=False)
    ville         = Column(String(100), default="")
    lieu          = Column(String(200), default="")
    etat_de_forme = Column(Text, default="")
    a_poule       = Column(Boolean, nullable=False, default=True)
    a_tableau     = Column(Boolean, nullable=False, default=True)
    terminee      = Column(Boolean, nullable=False, default=False)
    notes_analyse = Column(Text, default="")
    created_at    = Column(DateTime, default=datetime.utcnow)


class Poule(Base):
    __tablename__ = "poules"

    id             = Column(Integer, primary_key=True, index=True)
    competition_id = Column(Integer, ForeignKey("competitions.id"), nullable=False)
    nb_tireurs     = Column(Integer, nullable=False)
    qualifie       = Column(Boolean, nullable=True)
    terminee       = Column(Boolean, nullable=False, default=False)


class AssaultPoule(Base):
    __tablename__ = "assaults_poule"

    id                = Column(Integer, primary_key=True, index=True)
    poule_id          = Column(Integer, ForeignKey("poules.id"), nullable=False)
    numero            = Column(Integer, nullable=False)
    adversaire        = Column(String(100), default="")
    score_moi         = Column(Integer, nullable=True)
    score_adversaire  = Column(Integer, nullable=True)
    victoire          = Column(Boolean, nullable=True)
    commentaires      = Column(Text, default="")
    notes_post        = Column(Text, default="")
    created_at        = Column(DateTime, default=datetime.utcnow)


class AssaultTableau(Base):
    __tablename__ = "assaults_tableau"

    id                = Column(Integer, primary_key=True, index=True)
    competition_id    = Column(Integer, ForeignKey("competitions.id"), nullable=False)
    tour              = Column(Integer, nullable=False)
    adversaire        = Column(String(100), default="")
    score_moi         = Column(Integer, nullable=True)
    score_adversaire  = Column(Integer, nullable=True)
    victoire          = Column(Boolean, nullable=True)
    commentaires      = Column(Text, default="")
    notes_post        = Column(Text, default="")
    created_at        = Column(DateTime, default=datetime.utcnow)


class Photo(Base):
    __tablename__ = "photos"

    id             = Column(Integer, primary_key=True, index=True)
    competition_id = Column(Integer, ForeignKey("competitions.id"), nullable=False)
    type_photo     = Column(String(20), nullable=False)
    filename       = Column(String(200), nullable=False)
    created_at     = Column(DateTime, default=datetime.utcnow)


# ── Helpers ──────────────────────────────────────────────────────────────────

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db():
    Base.metadata.create_all(bind=engine)
