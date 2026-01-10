from __future__ import annotations

import time
from datetime import datetime
from typing import Dict, List, Optional

import httpx

from app.core.config import ConfigSnapshot
from app.core.errors import ErrorType
from app.core.logging import EventLogger
from app.core.schemas import AttemptRecord, JobRequest, JobStatus
from app.orchestration.circuit_breaker import CircuitBreaker
from app.orchestration.errors import classify_exception, classify_message
from app.orchestration.policies import AccountManager, DegradePlan, apply_template
from app.providers.registry import ProviderRegistry
from app.providers.spec_only import SpecOnlyProvider
from app.storage.artifacts import ArtifactStore
from app.storage.job_store import JobStore


class Orchestrator:
    def __init__(
        self,
        snapshot: ConfigSnapshot,
        registry: ProviderRegistry,
        accounts: AccountManager,
        artifact_store: ArtifactStore,
        job_store: JobStore,
        event_logger: EventLogger,
    ) -> None:
        self.snapshot = snapshot
        self.registry = registry
        self.accounts = accounts
        self.artifacts = artifact_store
        self.jobs = job_store
        self.event_logger = event_logger
        self.circuit_breaker = CircuitBreaker(
            snapshot.policies.circuit_breaker.failure_threshold,
            snapshot.policies.circuit_breaker.recovery_time_s,
        )

    def run_job(self, job_id: str, job: JobRequest) -> None:
        self.jobs.update_status(job_id, JobStatus.running)
        self.artifacts.init_job(job_id, job)
        attempts: List[Dict[str, object]] = []
        degrade_plan = DegradePlan(self.snapshot.policies.degrade_plan)
        provider_chain = self._resolve_provider_chain()
        success = False
        spec_only_hit = False
        last_job = job
        template_name = job.metadata.get("template")
        if template_name and template_name in self.snapshot.templates.templates:
            job = apply_template(job, self.snapshot.templates.templates[template_name])
            last_job = job

        for provider_name in provider_chain:
            if not self.registry.exists(provider_name):
                continue
            if self.circuit_breaker.is_open(provider_name):
                self.registry.set_circuit(provider_name, True)
                attempts.append(
                    self._attempt_record(
                        provider_name,
                        None,
                        "skipped",
                        "circuit_open",
                        reason="circuit_open",
                    )
                )
                continue
            provider = self.registry.get(provider_name)
            for step_index in degrade_plan.indices():
                degraded_job = degrade_plan.apply(job, step_index)
                last_job = degraded_job
                result = self._attempt_provider(job_id, provider_name, provider, degraded_job, step_index)
                attempts.extend(result["attempts"])
                if result.get("spec_only"):
                    spec_only_hit = True
                    break
                if result["success"]:
                    success = True
                    self.circuit_breaker.record_success(provider_name)
                    self.registry.set_circuit(provider_name, False)
                    output_path = result.get("output_path")
                    if output_path:
                        self.jobs.add_artifact(job_id, "output", output_path)
                    break
                if result.get("structural_failure"):
                    self.circuit_breaker.record_failure(provider_name, result.get("error", "failure"))
                    self.registry.set_circuit(provider_name, self.circuit_breaker.is_open(provider_name))
                    break
            if success:
                break
            if spec_only_hit:
                break

        scene_spec_path, final_prompt_path = self._write_spec(job_id, last_job)
        self.jobs.add_artifact(job_id, "scene_spec", scene_spec_path)
        self.jobs.add_artifact(job_id, "final_prompt", final_prompt_path)
        self.artifacts.write_attempts(job_id, attempts)

        if success:
            self.jobs.update_status(job_id, JobStatus.succeeded)
        else:
            self.jobs.update_status(job_id, JobStatus.spec_only)

    def _attempt_provider(self, job_id: str, provider_name, provider, job, step_index: int) -> Dict[str, object]:
        attempts: List[Dict[str, object]] = []
        max_retries = self.snapshot.policies.retry.max_attempts
        backoff_s = self.snapshot.policies.retry.backoff_s
        pool_size = self.accounts.pool_size(provider_name)
        key_attempts = max(1, pool_size)

        for _ in range(key_attempts):
            key = self.accounts.select_key(provider_name)
            headers = dict(self.registry.headers(provider_name))
            if key:
                headers.update(key.headers)
            for attempt_index in range(max_retries):
                started_at = datetime.utcnow()
                try:
                    if isinstance(provider, SpecOnlyProvider):
                        attempts.append(
                            self._attempt_record(
                                provider_name,
                                key.key_id if key else None,
                                "succeeded",
                                None,
                                None,
                                started_at,
                                datetime.utcnow(),
                                step_index,
                            )
                        )
                        return {"success": False, "spec_only": True, "attempts": attempts}
                    provider_job_id = provider.submit(job, headers)
                    self.event_logger.log("submit", {
                        "job_id": job_id,
                        "provider": provider_name,
                        "provider_job_id": provider_job_id,
                    })
                    status_payload = provider.poll(provider_job_id, headers)
                    self.artifacts.write_provider_response(job_id, provider_name, status_payload)
                    if status_payload.get("status") in {"running", "queued"}:
                        time.sleep(1)
                        status_payload = provider.poll(provider_job_id, headers)
                    result = provider.fetch(provider_job_id, headers)
                    output_path = None
                    output_url = None
                    if result.output_bytes:
                        output_path = self.artifacts.write_output(
                            job_id,
                            result.output_bytes,
                            job.output_format,
                        )
                        thumb = self.artifacts.try_generate_thumbnail(job_id, output_path)
                        if thumb:
                            self.jobs.add_artifact(job_id, "thumbnail", thumb)
                    if result.output_url:
                        output_url = result.output_url
                        output_path = self._fetch_output_url(
                            job_id, output_url, job.output_format
                        )
                        if output_path:
                            self.jobs.add_artifact(job_id, "output", output_path)
                        else:
                            url_path = self.artifacts.write_output_url(job_id, output_url)
                            self.jobs.add_artifact(job_id, "output_url", url_path)
                    attempts.append(
                        self._attempt_record(
                            provider_name,
                            key.key_id if key else None,
                            "succeeded",
                            None,
                            provider_job_id,
                            started_at,
                            datetime.utcnow(),
                            step_index,
                        )
                    )
                    return {"success": True, "attempts": attempts, "output_path": output_path, "output_url": output_url}
                except Exception as exc:  # noqa: BLE001
                    error = classify_exception(exc)
                    error_type = error.error_type
                    if error_type == ErrorType.unknown:
                        error_type = classify_message(str(error))
                    ended_at = datetime.utcnow()
                    attempts.append(
                        self._attempt_record(
                            provider_name,
                            key.key_id if key else None,
                            "failed",
                            error_type.value,
                            reason=str(error),
                            None,
                            started_at,
                            ended_at,
                            step_index,
                        )
                    )
                    self.event_logger.log("attempt_failed", {
                        "job_id": job_id,
                        "provider": provider_name,
                        "error_type": error_type.value,
                        "error": str(error),
                    })
                    if error_type in {ErrorType.quota, ErrorType.auth} and key:
                        self.accounts.mark_failure(provider_name, key.key_id)
                        break
                    if error_type == ErrorType.transient and attempt_index < max_retries - 1:
                        time.sleep(backoff_s * (attempt_index + 1))
                        continue
                    return {
                        "success": False,
                        "attempts": attempts,
                        "structural_failure": error_type in {ErrorType.server_down, ErrorType.unsupported},
                        "error": str(error),
                    }
        return {"success": False, "attempts": attempts, "structural_failure": True, "error": "Exhausted keys"}

    def _resolve_provider_chain(self) -> List[str]:
        chain = [item.provider for item in self.snapshot.providers.chain if self.registry.exists(item.provider)]
        if not chain:
            return [name for name in self.registry.list()]
        if self.snapshot.policies.routing.strategy == "cost_aware":
            chain = sorted(chain, key=self.registry.cost_score)
        if "spec_only" in chain:
            chain = [name for name in chain if name != "spec_only"] + ["spec_only"]
        return chain

    def _write_spec(self, job_id: str, job: JobRequest) -> tuple[str, str]:
        spec_provider = SpecOnlyProvider("spec_only", "")
        scene_spec = spec_provider.build_scene_spec(job)
        final_prompt = spec_provider.build_final_prompt(job)
        scene_spec_path = self.artifacts.write_scene_spec(job_id, scene_spec)
        final_prompt_path = self.artifacts.write_final_prompt(job_id, final_prompt)
        return scene_spec_path, final_prompt_path

    def _attempt_record(
        self,
        provider: str,
        key_id: Optional[str],
        status: str,
        error_type: Optional[str] = None,
        reason: Optional[str] = None,
        provider_job_id: Optional[str] = None,
        started_at: Optional[datetime] = None,
        ended_at: Optional[datetime] = None,
        degrade_step: int = 0,
    ) -> Dict[str, object]:
        started = started_at or datetime.utcnow()
        ended = ended_at or datetime.utcnow()
        return AttemptRecord(
            provider=provider,
            account_key_id=key_id,
            degrade_step=degrade_step,
            status=status,
            error_type=error_type,
            reason=reason,
            provider_job_id=provider_job_id,
            started_at=started,
            ended_at=ended,
        ).model_dump()

    def _fetch_output_url(self, job_id: str, url: str, output_format: str) -> Optional[str]:
        try:
            response = httpx.get(url, timeout=30)
            response.raise_for_status()
            return self.artifacts.write_output(job_id, response.content, output_format)
        except Exception:
            return None
