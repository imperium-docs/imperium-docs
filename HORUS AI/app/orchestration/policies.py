from __future__ import annotations

import random
import time
from dataclasses import dataclass, field
from typing import Dict, Iterable, List, Optional

from app.core.config import AccountPool, AccountsConfig, DegradeStep, JobTemplate, expand_env_vars
from app.core.schemas import JobRequest


@dataclass
class AccountKeyState:
    key_id: str
    headers: Dict[str, str]
    last_used: float = 0.0
    last_failed: float = 0.0


@dataclass
class AccountPoolState:
    provider: str
    strategy: str
    cooldown_after_fail_s: int
    keys: List[AccountKeyState] = field(default_factory=list)
    round_robin_index: int = 0


class AccountManager:
    def __init__(self, accounts: AccountsConfig) -> None:
        self._pools: Dict[str, AccountPoolState] = {}
        for pool in accounts.pools:
            self._pools[pool.provider] = self._init_pool(pool)

    def _init_pool(self, pool: AccountPool) -> AccountPoolState:
        keys = []
        for key in pool.keys:
            headers = {name: expand_env_vars(value) for name, value in key.headers.items()}
            keys.append(AccountKeyState(key_id=key.key_id, headers=headers))
        return AccountPoolState(
            provider=pool.provider,
            strategy=pool.strategy,
            cooldown_after_fail_s=pool.cooldown_after_fail_s,
            keys=keys,
        )

    def select_key(self, provider: str) -> Optional[AccountKeyState]:
        pool = self._pools.get(provider)
        if not pool or not pool.keys:
            return None
        now = time.time()
        available = [
            key for key in pool.keys if now - key.last_failed >= pool.cooldown_after_fail_s
        ]
        if not available:
            available = pool.keys
        if pool.strategy == "random":
            choice = random.choice(available)
        elif pool.strategy == "least_recent":
            choice = min(available, key=lambda k: k.last_used)
        else:
            choice = available[pool.round_robin_index % len(available)]
            pool.round_robin_index = (pool.round_robin_index + 1) % len(available)
        choice.last_used = now
        return choice

    def mark_failure(self, provider: str, key_id: str) -> None:
        pool = self._pools.get(provider)
        if not pool:
            return
        for key in pool.keys:
            if key.key_id == key_id:
                key.last_failed = time.time()
                return

    def pool_size(self, provider: str) -> int:
        pool = self._pools.get(provider)
        if not pool:
            return 0
        return len(pool.keys)


class DegradePlan:
    def __init__(self, steps: Iterable[DegradeStep]) -> None:
        self.steps = list(steps)

    def apply(self, job: JobRequest, step_index: int) -> JobRequest:
        if not self.steps:
            return job
        step = self.steps[min(step_index, len(self.steps) - 1)]
        updates = {}
        metadata = dict(job.metadata)
        if step.resolution:
            updates["resolution"] = step.resolution
        if step.fps:
            updates["fps"] = step.fps
        if step.duration_s:
            updates["duration_s"] = step.duration_s
        if step.steps is not None:
            metadata["steps"] = step.steps
        if step.guidance is not None:
            metadata["guidance"] = step.guidance
        if metadata != job.metadata:
            updates["metadata"] = metadata
        if updates:
            return job.model_copy(update=updates)
        return job

    def indices(self) -> List[int]:
        if not self.steps:
            return [0]
        return list(range(len(self.steps)))


def apply_template(job: JobRequest, template: JobTemplate) -> JobRequest:
    updates: Dict[str, object] = {}
    if template.resolution:
        updates["resolution"] = template.resolution
    if template.fps:
        updates["fps"] = template.fps
    if template.duration_s:
        updates["duration_s"] = template.duration_s
    if template.output_format:
        updates["output_format"] = template.output_format
    if template.aspect_ratio:
        updates["aspect_ratio"] = template.aspect_ratio
    if updates:
        return job.model_copy(update=updates)
    return job
