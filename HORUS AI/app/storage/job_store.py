from __future__ import annotations

import threading
from datetime import datetime
from typing import Dict, Optional

from app.core.schemas import JobRecord, JobRequest, JobStatus


class JobStore:
    def __init__(self) -> None:
        self._jobs: Dict[str, JobRecord] = {}
        self._lock = threading.Lock()

    def create(self, job_id: str) -> JobRecord:
        now = datetime.utcnow()
        record = JobRecord(
            job_id=job_id,
            status=JobStatus.queued,
            created_at=now,
            updated_at=now,
        )
        with self._lock:
            self._jobs[job_id] = record
        return record

    def update_status(self, job_id: str, status: JobStatus, error: Optional[str] = None) -> None:
        with self._lock:
            record = self._jobs[job_id]
            record.status = status
            record.updated_at = datetime.utcnow()
            if error:
                record.error = error

    def add_artifact(self, job_id: str, name: str, path: str) -> None:
        with self._lock:
            record = self._jobs[job_id]
            record.artifacts[name] = path
            record.updated_at = datetime.utcnow()

    def get(self, job_id: str) -> Optional[JobRecord]:
        with self._lock:
            return self._jobs.get(job_id)

    def all(self) -> Dict[str, JobRecord]:
        with self._lock:
            return dict(self._jobs)
