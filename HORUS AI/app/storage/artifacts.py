from __future__ import annotations

import json
import subprocess
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List

from app.core.schemas import JobRequest, JobStatus


class ArtifactStore:
    def __init__(self, base_dir: Path) -> None:
        self.base_dir = base_dir
        self.base_dir.mkdir(parents=True, exist_ok=True)

    def init_job(self, job_id: str, job: JobRequest) -> Path:
        job_dir = self.base_dir / job_id
        job_dir.mkdir(parents=True, exist_ok=True)
        self._write_json(job_dir / "job.json", job.model_dump())
        self._write_json(job_dir / "attempts.json", [])
        return job_dir

    def write_attempts(self, job_id: str, attempts: List[Dict[str, Any]]) -> None:
        job_dir = self.base_dir / job_id
        self._write_json(job_dir / "attempts.json", attempts)

    def write_final_prompt(self, job_id: str, prompt: str) -> str:
        path = self.base_dir / job_id / "final_prompt.txt"
        path.write_text(prompt, encoding="utf-8")
        return str(path)

    def write_scene_spec(self, job_id: str, spec: Dict[str, Any]) -> str:
        path = self.base_dir / job_id / "scene_spec.json"
        self._write_json(path, spec)
        return str(path)

    def write_output(self, job_id: str, data: bytes, output_format: str) -> str:
        filename = f"output.{output_format}"
        path = self.base_dir / job_id / filename
        path.write_bytes(data)
        return str(path)

    def write_output_url(self, job_id: str, url: str) -> str:
        path = self.base_dir / job_id / "output_url.txt"
        path.write_text(url, encoding="utf-8")
        return str(path)

    def write_provider_response(self, job_id: str, provider: str, payload: Dict[str, Any]) -> str:
        response_dir = self.base_dir / job_id / "provider_responses"
        response_dir.mkdir(parents=True, exist_ok=True)
        timestamp = datetime.utcnow().strftime("%Y%m%d%H%M%S")
        path = response_dir / f"{provider}-{timestamp}.json"
        self._write_json(path, payload)
        return str(path)

    def try_generate_thumbnail(self, job_id: str, output_path: str) -> str | None:
        thumb_path = self.base_dir / job_id / "thumbnail.jpg"
        try:
            subprocess.run(
                ["ffmpeg", "-y", "-i", output_path, "-ss", "00:00:01", "-vframes", "1", str(thumb_path)],
                check=True,
                capture_output=True,
            )
            return str(thumb_path)
        except Exception:
            return None

    def _write_json(self, path: Path, payload: Any) -> None:
        path.write_text(json.dumps(payload, ensure_ascii=True, indent=2), encoding="utf-8")
