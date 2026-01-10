from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any, Dict, Literal, Optional

from pydantic import BaseModel, Field

AspectRatio = Literal["16:9", "9:16", "1:1"]
Resolution = Literal["1080p", "720p", "480p"]
OutputFormat = Literal["mp4", "webm"]


class JobStatus(str, Enum):
    queued = "queued"
    running = "running"
    succeeded = "succeeded"
    failed = "failed"
    spec_only = "spec_only"


class JobRequest(BaseModel):
    prompt: str
    negative_prompt: Optional[str] = None
    duration_s: int
    aspect_ratio: AspectRatio
    resolution: Resolution
    fps: int
    seed: Optional[int] = None
    style: Optional[str] = None
    input_image_url: Optional[str] = None
    output_format: OutputFormat
    priority: int = 0
    metadata: Dict[str, Any] = Field(default_factory=dict)


class JobRecord(BaseModel):
    job_id: str
    status: JobStatus
    created_at: datetime
    updated_at: datetime
    artifacts: Dict[str, str] = Field(default_factory=dict)
    error: Optional[str] = None


class ProviderHealth(str, Enum):
    healthy = "healthy"
    degraded = "degraded"
    down = "down"
    unknown = "unknown"


class ProviderStatus(BaseModel):
    provider: str
    health: ProviderHealth
    circuit_open: bool
    last_error: Optional[str] = None
    last_checked_at: Optional[datetime] = None


class AttemptRecord(BaseModel):
    provider: str
    account_key_id: Optional[str]
    degrade_step: int
    status: str
    error_type: Optional[str] = None
    reason: Optional[str] = None
    provider_job_id: Optional[str] = None
    started_at: datetime
    ended_at: datetime


class ArtifactIndex(BaseModel):
    job_id: str
    status: JobStatus
    artifacts: Dict[str, str]
