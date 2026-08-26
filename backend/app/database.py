from collections.abc import Generator

from sqlalchemy import create_engine, event, inspect, text
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.config import get_settings


class Base(DeclarativeBase):
    pass


def _engine():
    settings = get_settings()
    connect_args = {}
    if settings.database_url.startswith("sqlite"):
        connect_args = {"check_same_thread": False}
    engine = create_engine(
        settings.database_url,
        connect_args=connect_args,
        pool_pre_ping=True,
        future=True,
    )

    if settings.database_url.startswith("sqlite"):

        @event.listens_for(engine, "connect")
        def _sqlite_pragma(dbapi_connection, _connection_record):
            cursor = dbapi_connection.cursor()
            cursor.execute("PRAGMA journal_mode=WAL")
            cursor.execute("PRAGMA foreign_keys=ON")
            cursor.execute("PRAGMA busy_timeout=5000")
            cursor.close()

    return engine


engine = _engine()
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db() -> None:
    from app import models  # noqa: F401

    Base.metadata.create_all(bind=engine)
    _ensure_columns()
    if get_settings().database_url.startswith("sqlite"):
        with engine.connect() as conn:
            conn.execute(text("PRAGMA journal_mode=WAL"))
            conn.commit()


def _ensure_columns() -> None:
    inspector = inspect(engine)
    tables = set(inspector.get_table_names())
    if "racks" in tables:
        cols = {c["name"] for c in inspector.get_columns("racks")}
        if "row_id" not in cols:
            with engine.begin() as conn:
                conn.execute(text("ALTER TABLE racks ADD COLUMN row_id INTEGER"))
    if "devices" in tables:
        dcols = {c["name"] for c in inspector.get_columns("devices")}
        with engine.begin() as conn:
            if "indicator_type" not in dcols:
                conn.execute(text("ALTER TABLE devices ADD COLUMN indicator_type VARCHAR(32) DEFAULT 'unknown'"))
            if "indicator_color" not in dcols:
                conn.execute(text("ALTER TABLE devices ADD COLUMN indicator_color VARCHAR(32) DEFAULT 'unknown'"))
