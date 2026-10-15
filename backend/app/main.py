"""Athena OS API. Serves the REST API under /api and the built web app (if present) at /."""
import logging
import secrets
import time
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from . import models as m
from .database import SERVERLESS, Base, SessionLocal, engine
from .routers import admin, costs, orders, production, sales
from .seed import seed

log = logging.getLogger("athena")

app = FastAPI(title="Athena OS", version="1.0.0", docs_url="/api/docs", openapi_url="/api/openapi.json")
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
                   allow_methods=["*"], allow_headers=["*"])


@app.middleware("http")
async def server_timing(request: Request, call_next):
    """Server-Timing shows how long the API itself took, apart from network time (browser dev tools)."""
    t0 = time.perf_counter()
    response = await call_next(request)
    response.headers["Server-Timing"] = f"app;dur={(time.perf_counter() - t0) * 1000:.0f}"
    return response

for r in (orders, production, costs, sales, admin):
    app.include_router(r.router, prefix="/api")


def init_db():
    """Create the tables and load the sample data when the database is empty."""
    Base.metadata.create_all(engine)
    with SessionLocal() as db:
        if not db.query(m.Organisation).first():
            seed(db)


@app.on_event("startup")
def startup():
    if not SERVERLESS:  # hosted deployments are initialised once with `python -m app.initdb`
        init_db()


@app.exception_handler(Exception)
async def unexpected_error(request: Request, exc: Exception):
    """Server errors are logged with a reference number the user can quote to support (Section 8.9)."""
    ref = secrets.token_hex(4).upper()
    log.exception("Unhandled error %s on %s %s", ref, request.method, request.url.path)
    return JSONResponse(status_code=500, content={"detail": f"Something went wrong. Please try again or quote "
                                                            f"reference {ref} to support."})


@app.get("/api/health")
def health():
    return {"status": "ok", "product": "Athena OS"}


DIST = Path(__file__).resolve().parent.parent.parent / "frontend" / "dist"
if DIST.is_dir():
    app.mount("/assets", StaticFiles(directory=DIST / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str):
        if path.startswith("api/"):
            return JSONResponse(status_code=404, content={"detail": "Not found."})
        f = (DIST / path).resolve()
        if path and f.is_file() and DIST in f.parents:
            return FileResponse(f)
        return FileResponse(DIST / "index.html", headers={"Cache-Control": "no-cache"})
