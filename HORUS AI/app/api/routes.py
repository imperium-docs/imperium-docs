from __future__ import annotations

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

from app.core.errors import ConfigError
from app.core.schemas import JobRequest
from app.core.service import get_context

router = APIRouter()


@router.post("/jobs")
def create_job(job: JobRequest):
    ctx = get_context()
    job_id = ctx.submit_job(job)
    return {"job_id": job_id}


@router.get("/jobs/{job_id}")
def get_job(job_id: str):
    ctx = get_context()
    record = ctx.get_job(job_id)
    if not record:
        raise HTTPException(status_code=404, detail="Job not found")
    return record


@router.get("/jobs/{job_id}/artifact/{name}")
def get_artifact(job_id: str, name: str):
    ctx = get_context()
    record = ctx.get_job(job_id)
    if not record:
        raise HTTPException(status_code=404, detail="Job not found")
    path = record.artifacts.get(name)
    if not path:
        raise HTTPException(status_code=404, detail="Artifact not found")
    return FileResponse(path)


@router.post("/admin/reload-config")
def reload_config():
    ctx = get_context()
    try:
        ctx.reload_config()
    except ConfigError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"status": "reloaded"}


@router.get("/health")
def health():
    return {"status": "ok"}


@router.get("/health/providers")
def health_providers():
    ctx = get_context()
    return ctx.provider_statuses()
