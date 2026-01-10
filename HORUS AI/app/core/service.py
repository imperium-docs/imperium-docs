from __future__ import annotations

import uuid
from pathlib import Path
from typing import Optional

from app.core.config import ConfigManager
from app.core.logging import EventLogger
from app.core.schemas import JobRequest, JobRecord, ProviderStatus
from app.orchestration.engine import Orchestrator
from app.orchestration.policies import AccountManager
from app.providers.health import ProviderHealthScheduler
from app.providers.registry import ProviderRegistry
from app.queue.in_memory import InMemoryQueue, JobTask
from app.storage.artifacts import ArtifactStore
from app.storage.job_store import JobStore


class ServiceContext:
    def __init__(self, base_dir: Path) -> None:
        self.base_dir = base_dir
        self.config_manager = ConfigManager(base_dir / "configs")
        self.artifacts = ArtifactStore(base_dir / "artifacts")
        self.jobs = JobStore()
        self.logger = EventLogger(base_dir / "logs")
        self.registry: Optional[ProviderRegistry] = None
        self.accounts: Optional[AccountManager] = None
        self.orchestrator: Optional[Orchestrator] = None
        self.queue: Optional[InMemoryQueue] = None
        self.health_scheduler: Optional[ProviderHealthScheduler] = None

    def load(self) -> None:
        snapshot = self.config_manager.reload()
        self.registry = ProviderRegistry(snapshot.providers, snapshot.policies.timeouts)
        self.accounts = AccountManager(snapshot.accounts)
        self.orchestrator = Orchestrator(
            snapshot, self.registry, self.accounts, self.artifacts, self.jobs, self.logger
        )
        if not self.queue:
            self.queue = InMemoryQueue(self._process_task)
            self.queue.start()
        if self.health_scheduler:
            self.health_scheduler.stop()
        self.health_scheduler = ProviderHealthScheduler(
            self.registry,
            self.accounts,
            snapshot.policies.health.check_interval_s,
            enabled=snapshot.policies.health.enabled,
        )
        self.health_scheduler.start()

    def reload_config(self) -> None:
        self.load()

    def submit_job(self, job: JobRequest) -> str:
        if not self.queue or not self.orchestrator:
            self.load()
        job_id = uuid.uuid4().hex
        self.jobs.create(job_id)
        if self.queue:
            self.queue.submit(job_id, job)
        return job_id

    def get_job(self, job_id: str) -> JobRecord | None:
        return self.jobs.get(job_id)

    def provider_statuses(self) -> list[ProviderStatus]:
        if not self.registry:
            return []
        return self.registry.health_snapshot()

    def _process_task(self, task: JobTask) -> None:
        orchestrator = self.orchestrator
        if not orchestrator:
            return
        orchestrator.run_job(task.job_id, task.job)


DEFAULT_CONTEXT: Optional[ServiceContext] = None


def get_context() -> ServiceContext:
    global DEFAULT_CONTEXT
    if DEFAULT_CONTEXT is None:
        DEFAULT_CONTEXT = ServiceContext(Path(__file__).resolve().parents[2])
        DEFAULT_CONTEXT.load()
    return DEFAULT_CONTEXT
