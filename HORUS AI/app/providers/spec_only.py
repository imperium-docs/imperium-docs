from __future__ import annotations

from typing import Any, Dict

from app.providers.base import ProviderBase, ProviderResult
from app.core.schemas import JobRequest


class SpecOnlyProvider(ProviderBase):
    def submit(self, job: JobRequest, headers: Dict[str, str]) -> str:
        return f"spec-{job.prompt[:8].replace(' ', '_')}"

    def poll(self, provider_job_id: str, headers: Dict[str, str]) -> Dict[str, Any]:
        return {"status": "succeeded", "progress": 1.0}

    def fetch(self, provider_job_id: str, headers: Dict[str, str]) -> ProviderResult:
        return ProviderResult(
            provider_job_id=provider_job_id,
            status="succeeded",
            metadata={"spec_only": True},
        )

    def build_scene_spec(self, job: JobRequest) -> Dict[str, Any]:
        return {
            "prompt": job.prompt,
            "negative_prompt": job.negative_prompt,
            "duration_s": job.duration_s,
            "aspect_ratio": job.aspect_ratio,
            "resolution": job.resolution,
            "fps": job.fps,
            "seed": job.seed,
            "style": job.style,
            "input_image_url": job.input_image_url,
            "output_format": job.output_format,
            "metadata": job.metadata,
        }

    def build_final_prompt(self, job: JobRequest) -> str:
        parts = [job.prompt]
        if job.style:
            parts.append(f"style: {job.style}")
        if job.negative_prompt:
            parts.append(f"negative: {job.negative_prompt}")
        return " | ".join(parts)
