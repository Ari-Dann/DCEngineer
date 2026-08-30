from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app.backup import backup_loop
from app.config import get_settings
from app.database import SessionLocal, init_db
from app.routers.auth import router as auth_router
from app.routers.auth import users_router
from app.routers.files import files_router, meta_router
from app.routers.inventory import ops_router, projects_router
from app.routers.vision import router as vision_router
from app.seed import bootstrap_admin, bootstrap_sidecar, seed_templates

log = logging.getLogger("dcengineer")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")


@asynccontextmanager
async def lifespan(_app: FastAPI):
    settings = get_settings()
    Path(settings.storage_local_path).mkdir(parents=True, exist_ok=True)
    Path(settings.backup_path).mkdir(parents=True, exist_ok=True)
    sqlite_path = settings.sqlite_path
    if sqlite_path:
        Path(sqlite_path).parent.mkdir(parents=True, exist_ok=True)
    init_db()
    db = SessionLocal()
    try:
        seed_templates(db)
        bootstrap_admin(db)
        bootstrap_sidecar(db)
    finally:
        db.close()
    task = asyncio.create_task(backup_loop())
    try:
        yield
    finally:
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass


settings = get_settings()
app = FastAPI(
    title="DCEngineer",
    version="1.0.0",
    description="Datacenter engineer assistant — RBI capture, ops, JWTAuth.",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router)
app.include_router(users_router)
app.include_router(projects_router)
app.include_router(ops_router)
app.include_router(files_router)
app.include_router(meta_router)
app.include_router(vision_router)

static_dir = Path(settings.static_dir)
if static_dir.exists():
    assets = static_dir / "assets"
    if assets.exists():
        app.mount("/assets", StaticFiles(directory=assets), name="assets")

    @app.get("/{full_path:path}")
    async def spa(full_path: str):
        if full_path.startswith("api/"):
            return {"detail": "Not Found"}
        candidate = static_dir / full_path
        if full_path and candidate.is_file():
            return FileResponse(candidate)
        index = static_dir / "index.html"
        if index.exists():
            return FileResponse(index)
        return {"app": "DCEngineer", "ui": "not built"}
else:

    @app.get("/")
    async def root():
        return {"app": "DCEngineer", "ui": "not built", "docs": "/docs"}
