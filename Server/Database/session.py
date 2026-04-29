from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, Session
from typing import Generator

from config import settings

# Cloud Run is serverless — instances scale to 0 and back, so keep the pool
# small to avoid exhausting Cloud SQL's connection limit.
# pool_pre_ping re-validates stale connections after scale-up pauses.
engine = create_engine(
    settings.DATABASE_URL,
    pool_pre_ping=True,
    pool_size=2,
    max_overflow=5,
    pool_recycle=300,  # recycle connections every 5 min (Cloud SQL drops idle ones)
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
