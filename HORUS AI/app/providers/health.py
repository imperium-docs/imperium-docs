from __future__ import annotations

import threading
import time
from typing import Dict

from app.core.schemas import ProviderHealth
from app.orchestration.policies import AccountManager
from app.providers.registry import ProviderRegistry


class ProviderHealthScheduler:
    def __init__(
        self,
        registry: ProviderRegistry,
        account_manager: AccountManager,
        interval_s: int,
        enabled: bool = True,
    ) -> None:
        self.registry = registry
        self.account_manager = account_manager
        self.interval_s = max(5, interval_s)
        self.enabled = enabled
        self._thread: threading.Thread | None = None
        self._stop_event = threading.Event()

    def start(self) -> None:
        if not self.enabled:
            return
        if self._thread and self._thread.is_alive():
            return
        self._thread = threading.Thread(target=self._run, daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop_event.set()
        if self._thread:
            self._thread.join(timeout=2)

    def _run(self) -> None:
        while not self._stop_event.is_set():
            for name in self.registry.list():
                headers = self._headers_for(name)
                provider = self.registry.get(name)
                try:
                    ok = provider.healthcheck(headers)
                    status = ProviderHealth.healthy if ok else ProviderHealth.degraded
                    self.registry.update_health(name, status)
                except Exception as exc:  # noqa: BLE001
                    self.registry.update_health(name, ProviderHealth.down, error=str(exc))
            time.sleep(self.interval_s)

    def _headers_for(self, provider: str) -> Dict[str, str]:
        headers = dict(self.registry.headers(provider))
        key = self.account_manager.select_key(provider)
        if key:
            headers.update(key.headers)
        return headers
