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
    restriction_cols = {
        "restricted": "BOOLEAN DEFAULT 0",
        "restriction_type": "VARCHAR(64) DEFAULT ''",
        "photography_allowed": "BOOLEAN DEFAULT 1",
    }
    for table in ("projects", "aisle_rows", "racks"):
        if table not in tables:
            continue
        cols = {c["name"] for c in inspector.get_columns(table)}
        with engine.begin() as conn:
            for name, ddl in restriction_cols.items():
                if name not in cols:
                    conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {name} {ddl}"))
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
            if "power_draw_unit" not in dcols:
                conn.execute(text("ALTER TABLE devices ADD COLUMN power_draw_unit VARCHAR(8) DEFAULT 'W'"))
            if "dc_power_draw_amps" not in dcols:
                conn.execute(text("ALTER TABLE devices ADD COLUMN dc_power_draw_amps FLOAT"))
            if "pdu_a_id" not in dcols:
                conn.execute(text("ALTER TABLE devices ADD COLUMN pdu_a_id INTEGER"))
            if "pdu_b_id" not in dcols:
                conn.execute(text("ALTER TABLE devices ADD COLUMN pdu_b_id INTEGER"))
            if "owner" not in dcols:
                conn.execute(text("ALTER TABLE devices ADD COLUMN owner VARCHAR(255) DEFAULT ''"))
            if "parent_device_id" not in dcols:
                conn.execute(text("ALTER TABLE devices ADD COLUMN parent_device_id INTEGER"))
    if "vision_sessions" in tables:
        scols = {c["name"] for c in inspector.get_columns("vision_sessions")}
        if "layout_review_json" not in scols:
            with engine.begin() as conn:
                conn.execute(text("ALTER TABLE vision_sessions ADD COLUMN layout_review_json TEXT DEFAULT ''"))
    if "vision_proposals" in tables:
        pcols = {c["name"] for c in inspector.get_columns("vision_proposals")}
        with engine.begin() as conn:
            if "confirmed_fields_json" not in pcols:
                conn.execute(text("ALTER TABLE vision_proposals ADD COLUMN confirmed_fields_json TEXT DEFAULT '[]'"))
            if "skipped_fields_json" not in pcols:
                conn.execute(text("ALTER TABLE vision_proposals ADD COLUMN skipped_fields_json TEXT DEFAULT '[]'"))
