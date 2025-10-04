from sqlalchemy import Column, Integer, String, Boolean
from sqlalchemy.ext.declarative import declarative_base

Base = declarative_base()

class Guest(Base):
    __tablename__ = "guest"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String, nullable=False)
    essenswunsch = Column(String)
    dabei = Column(Boolean)
    email = Column(String)
    anreise = Column(String)
    essen_fr = Column(Boolean)
    essen_sa = Column(Boolean)
    essen_so = Column(Boolean)
    essen_mitbringsel = Column(String)
    unterkunft = Column(String)
