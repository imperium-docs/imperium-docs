from __future__ import annotations

from typing import Any, Dict

import httpx

from app.core.config import ProviderConfig, TimeoutPolicy
from app.core.errors import ProviderError
from app.providers.base import ProviderBase, ProviderResult


class HttpAsyncProvider(ProviderBase):
    def __init__(self, name: str, config: ProviderConfig, timeouts: TimeoutPolicy) -> None:
        super().__init__(name=name, base_url=config.base_url)
        if not config.endpoints:
            raise ProviderError(f"Provider {name} missing endpoints")
        self.endpoints = config.endpoints
        self.health_endpoint = config.health_endpoint
        self.timeouts = timeouts

    def submit(self, job, headers: Dict[str, str]) -> str:
        url = self.base_url + self.endpoints.submit
        payload = job.model_dump()
        response = httpx.post(url, json=payload, headers=headers, timeout=self.timeouts.submit_s)
        response.raise_for_status()
        data = response.json()
        provider_job_id = data.get("job_id") or data.get("id")
        if not provider_job_id:
            raise ProviderError("Missing provider job id")
        return str(provider_job_id)

    def poll(self, provider_job_id: str, headers: Dict[str, str]) -> Dict[str, Any]:
        url = self.base_url + self.endpoints.poll.format(job_id=provider_job_id)
        response = httpx.get(url, headers=headers, timeout=self.timeouts.poll_s)
        response.raise_for_status()
        return response.json()

    def fetch(self, provider_job_id: str, headers: Dict[str, str]) -> ProviderResult:
        url = self.base_url + self.endpoints.fetch.format(job_id=provider_job_id)
        response = httpx.get(url, headers=headers, timeout=self.timeouts.fetch_s)
        response.raise_for_status()
        content_type = response.headers.get("content-type", "")
        if "application/json" in content_type:
            data = response.json()
            output_url = data.get("output_url") or data.get("url")
            return ProviderResult(provider_job_id=provider_job_id, status="succeeded", output_url=output_url, metadata=data)
        return ProviderResult(provider_job_id=provider_job_id, status="succeeded", output_bytes=response.content)

    def healthcheck(self, headers: Dict[str, str]) -> bool:
        if not self.health_endpoint:
            return True
        url = self.base_url + self.health_endpoint
        try:
            response = httpx.get(url, headers=headers, timeout=5)
            return response.status_code == 200
        except httpx.RequestError:
            return False
