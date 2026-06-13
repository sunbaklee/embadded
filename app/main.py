from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app.config import settings
from app.database import (
    Base,
    engine,
    ensure_alert_columns,
    ensure_device_columns,
    ensure_sensor_log_columns,
)
from app.routers import alerts, devices, reports, sensor
from app.routers import simulation, status


STATIC_DIR = Path(__file__).resolve().parent / "static"


@asynccontextmanager
async def lifespan(_: FastAPI):
    Base.metadata.create_all(bind=engine)
    ensure_device_columns()
    ensure_sensor_log_columns()
    ensure_alert_columns()
    yield


app = FastAPI(title=settings.app_name, version="1.0.0", lifespan=lifespan)
app.include_router(sensor.router)
app.include_router(status.router)
app.include_router(alerts.router)
app.include_router(devices.router)
app.include_router(reports.router)
app.include_router(simulation.router)
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


@app.get("/", include_in_schema=False)
def dashboard():
    return FileResponse(STATIC_DIR / "index.html")


@app.get("/devices", include_in_schema=False)
def device_management():
    return FileResponse(STATIC_DIR / "devices.html")


@app.get("/resolutions", include_in_schema=False)
def resolution_history():
    return FileResponse(STATIC_DIR / "resolutions.html")


@app.get("/health")
def health():
    return {"status": "ok", "environment": settings.app_env}
