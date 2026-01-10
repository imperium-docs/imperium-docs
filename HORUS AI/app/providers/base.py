from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Any, Dict, Optional

from app.core.schemas import JobRequest


@dataclass
class ProviderResult:
    provider_job_id: str
    status: str
    output_url: Optional[str] = None
    output_bytes: Optional[bytes] = None
    metadata: Dict[str, Any] | None = None


class ProviderBase(ABC):
    def __init__(self, name: str, base_url: str) -> None:
        self.name = name
        self.base_url = base_url

    @abstractmethod
    def submit(self, job: JobRequest, headers: Dict[str, str]) -> str:
        raise NotImplementedError

    @abstractmethod
    def poll(self, provider_job_id: str, headers: Dict[str, str]) -> Dict[str, Any]:
        raise NotImplementedError

    @abstractmethod
    def fetch(self, provider_job_id: str, headers: Dict[str, str]) -> ProviderResult:
        raise NotImplementedError

    def healthcheck(self, headers: Dict[str, str]) -> bool:
        return True
