"""Database engine and session.

SQLite by default. Set DATABASE_URL for MySQL (mysql+pymysql://...) or PostgreSQL (postgres://...).
"""
import os
import ssl
from pathlib import Path

from sqlalchemy import create_engine, event
from sqlalchemy.orm import DeclarativeBase, sessionmaker

BASE_DIR = Path(__file__).resolve().parent.parent
SERVERLESS = bool(os.getenv("VERCEL"))

# ATHENA_DATABASE_URL is the Singapore database (close to the users in Bangladesh); DATABASE_URL is the earlier
# US database, kept as a fallback and backup
DATABASE_URL = (os.getenv("ATHENA_DATABASE_URL") or os.getenv("DATABASE_URL") or os.getenv("POSTGRES_URL")
                or f"sqlite:///{(BASE_DIR / 'athena.db').as_posix()}")

_is_sqlite = DATABASE_URL.startswith("sqlite")
_kwargs: dict = {"pool_pre_ping": True}
if _is_sqlite:
    _kwargs["connect_args"] = {"check_same_thread": False}
elif DATABASE_URL.startswith(("postgres://", "postgresql://")):
    # hosted PostgreSQL: pure-Python driver over TLS; connection options in the URL are dropped
    DATABASE_URL = "postgresql+pg8000://" + DATABASE_URL.split("://", 1)[1].split("?", 1)[0]
    _kwargs["connect_args"] = {"ssl_context": ssl.create_default_context()}
if SERVERLESS and not _is_sqlite:
    # keep a few TLS connections open across requests on a warm function instance instead of a new
    # connection (TLS handshake + sign-in) per request; pre-ping replaces any dropped while idle
    _kwargs.update(pool_size=2, max_overflow=3, pool_recycle=240, pool_timeout=10)

engine = create_engine(DATABASE_URL, **_kwargs)

if _is_sqlite:
    @event.listens_for(engine, "connect")
    def _sqlite_pragmas(dbapi_conn, _):
        cur = dbapi_conn.cursor()
        cur.execute("PRAGMA foreign_keys=ON")
        cur.execute("PRAGMA journal_mode=WAL")
        cur.close()

SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
