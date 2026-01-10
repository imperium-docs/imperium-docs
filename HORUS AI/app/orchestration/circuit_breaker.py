from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Dict


@dataclass
class CircuitState:
    failure_count: int = 0
    open_until: float = 0.0
    last_error: str | None = None


class CircuitBreaker:
    def __init__(self, failure_threshold: int, recovery_time_s: int) -> None:
        self.failure_threshold = max(1, failure_threshold)
        self.recovery_time_s = max(1, recovery_time_s)
        self._states: Dict[str, CircuitState] = {}

    def is_open(self, key: str) -> bool:
        state = self._states.get(key)
        if not state:
            return False
        if state.open_until <= time.time():
            return False
        return True

    def record_failure(self, key: str, error: str | None = None) -> None:
        state = self._states.setdefault(key, CircuitState())
        state.failure_count += 1
        state.last_error = error
        if state.failure_count >= self.failure_threshold:
            state.open_until = time.time() + self.recovery_time_s

    def record_success(self, key: str) -> None:
        state = self._states.setdefault(key, CircuitState())
        state.failure_count = 0
        state.open_until = 0.0
        state.last_error = None

    def status(self, key: str) -> CircuitState:
        return self._states.get(key, CircuitState())
