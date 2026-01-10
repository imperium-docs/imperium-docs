from __future__ import annotations

import json
import uuid
from pathlib import Path
from typing import Optional

import httpx
import typer

from app.core.config import ConfigManager
from app.core.schemas import JobRequest
from app.core.service import ServiceContext

app = typer.Typer(help="HORUS AI Video Generation CLI")
configs_app = typer.Typer()
providers_app = typer.Typer()


def _base_dir() -> Path:
    return Path(__file__).resolve().parents[1]


def _api_url(api: Optional[str]) -> str:
    return api or "http://127.0.0.1:8000"


def _local_context() -> ServiceContext:
    ctx = ServiceContext(_base_dir())
    ctx.load()
    return ctx


@app.command()
def submit(
    prompt: str = typer.Option(..., "--prompt"),
    duration: int = typer.Option(..., "--duration"),
    ratio: str = typer.Option(..., "--ratio"),
    res: str = typer.Option(..., "--res"),
    fps: int = typer.Option(..., "--fps"),
    output_format: str = typer.Option("mp4", "--format"),
    priority: int = typer.Option(0, "--priority"),
    template: Optional[str] = typer.Option(None, "--template"),
    api: Optional[str] = typer.Option(None, "--api"),
    local: bool = typer.Option(False, "--local"),
) -> None:
    metadata = {}
    if template:
        metadata["template"] = template
    job = JobRequest(
        prompt=prompt,
        duration_s=duration,
        aspect_ratio=ratio,  # type: ignore[arg-type]
        resolution=res,  # type: ignore[arg-type]
        fps=fps,
        output_format=output_format,  # type: ignore[arg-type]
        priority=priority,
        metadata=metadata,
    )
    if local:
        ctx = _local_context()
        job_id = uuid.uuid4().hex
        ctx.jobs.create(job_id)
        if ctx.orchestrator:
            ctx.orchestrator.run_job(job_id, job)
        typer.echo(job_id)
        return
    url = _api_url(api) + "/jobs"
    response = httpx.post(url, json=job.model_dump())
    response.raise_for_status()
    typer.echo(response.json()["job_id"])


@app.command()
def status(
    job_id: str,
    api: Optional[str] = typer.Option(None, "--api"),
    local: bool = typer.Option(False, "--local"),
) -> None:
    if local:
        artifacts_dir = _base_dir() / "artifacts" / job_id
        if not artifacts_dir.exists():
            raise typer.Exit(code=1)
        output = next(artifacts_dir.glob("output.*"), None)
        spec = artifacts_dir / "scene_spec.json"
        status = "unknown"
        if output and output.exists():
            status = "succeeded"
        elif spec.exists():
            status = "spec_only"
        typer.echo(json.dumps({"job_id": job_id, "status": status}, ensure_ascii=True))
        return
    url = _api_url(api) + f"/jobs/{job_id}"
    response = httpx.get(url)
    response.raise_for_status()
    typer.echo(json.dumps(response.json(), ensure_ascii=True))


@app.command()
def fetch(
    job_id: str,
    out: Path = typer.Option(..., "--out"),
    api: Optional[str] = typer.Option(None, "--api"),
    local: bool = typer.Option(False, "--local"),
) -> None:
    if local:
        artifacts_dir = _base_dir() / "artifacts" / job_id
        output = next(artifacts_dir.glob("output.*"), None)
        if not output:
            raise typer.Exit(code=1)
        out.write_bytes(output.read_bytes())
        return
    url = _api_url(api) + f"/jobs/{job_id}/artifact/output"
    response = httpx.get(url)
    response.raise_for_status()
    out.write_bytes(response.content)


@configs_app.command("validate")
def configs_validate() -> None:
    manager = ConfigManager(_base_dir() / "configs")
    manager.validate()
    typer.echo("configs_ok")

@providers_app.command("health")
def providers_health(api: Optional[str] = typer.Option(None, "--api")) -> None:
    url = _api_url(api) + "/health/providers"
    response = httpx.get(url)
    response.raise_for_status()
    typer.echo(json.dumps(response.json(), ensure_ascii=True))


app.add_typer(configs_app, name="configs")
app.add_typer(providers_app, name="providers")
