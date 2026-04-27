from sqlalchemy import create_engine, Column, Integer, String, Date, Time, Text, Boolean, DateTime
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
from datetime import datetime

DATABASE_URL = "sqlite:///./db/med.db"

engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


# ── Entraînement ────────────────────────────────────────────────────────────

class Assault(Base):
    """Assault d'entraînement libre."""
    __tablename__ = "assaults"

    id            = Column(Integer, primary_key=True, index=True)
    date          = Column(Date, nullable=False)
    heure         = Column(Time, nullable=False)
    type_seance   = Column(String(20), nullable=False, default="entrainement")
    notes         = Column(Text, default="")


# ── Compétitions ────────────────────────────────────────────────────────────

class Competition(Base):
    __tablename__ = "competitions"

    id            = Column(Integer, primary_key=True, index=True)
    nom           = Column(String(200), nullable=False)
    date          = Column(Date, nullable=False)
    arme          = Column(String(20), nullable=False, default="epee")   # epee / fleuret / sabre
    niveau        = Column(String(20), nullable=False)                   # regional / national / international / olympique
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
    competition_id = Column(Integer, nullable=False)
    nb_tireurs     = Column(Integer, nullable=False)
    # nb_assaults = nb_tireurs - 1 (calculé côté applicatif)
    qualifie       = Column(Boolean, nullable=True)   # None = pas encore déterminé
    terminee       = Column(Boolean, nullable=False, default=False)


class AssaultPoule(Base):
    __tablename__ = "assaults_poule"

    id                = Column(Integer, primary_key=True, index=True)
    poule_id          = Column(Integer, nullable=False)
    numero            = Column(Integer, nullable=False)   # 1 à nb_tireurs-1
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
    competition_id    = Column(Integer, nullable=False)
    tour              = Column(Integer, nullable=False)   # tableau de X : 64, 32, 16, 8, 4, 2
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
    competition_id = Column(Integer, nullable=False)
    type_photo     = Column(String(20), nullable=False)   # "poule" / "tableau"
    filename       = Column(String(200), nullable=False)
    created_at     = Column(DateTime, default=datetime.utcnow)


# ── Helpers ─────────────────────────────────────────────────────────────────

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db():
    Base.metadata.create_all(bind=engine)
