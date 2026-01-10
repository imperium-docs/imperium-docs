from app.core.config import DegradeStep
from app.core.schemas import JobRequest
from app.orchestration.policies import DegradePlan


def test_degrade_plan_applies_updates():
    job = JobRequest(
        prompt="test",
        duration_s=16,
        aspect_ratio="16:9",
        resolution="1080p",
        fps=30,
        output_format="mp4",
        priority=0,
        metadata={},
    )
    plan = DegradePlan(
        [
            DegradeStep(resolution="1080p", fps=30, duration_s=16),
            DegradeStep(resolution="720p", fps=24, duration_s=8, steps=30, guidance=6.0),
        ]
    )
    degraded = plan.apply(job, 1)
    assert degraded.resolution == "720p"
    assert degraded.fps == 24
    assert degraded.duration_s == 8
    assert degraded.metadata.get("steps") == 30
    assert degraded.metadata.get("guidance") == 6.0
