from sqlalchemy import create_engine, Column, Integer, String, Date, Time, Text
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker

DATABASE_URL = "sqlite:///./db/med.db"

engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


class Assault(Base):
    __tablename__ = "assaults"

    id = Column(Integer, primary_key=True, index=True)
    date = Column(Date, nullable=False)
    heure = Column(Time, nullable=False)
    # "competition" | "entrainement"
    type_seance = Column(String(20), nullable=False, default="entrainement")
    notes = Column(Text, default="")


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db():
    Base.metadata.create_all(bind=engine)
