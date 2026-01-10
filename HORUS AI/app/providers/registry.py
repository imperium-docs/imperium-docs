from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Dict, List

from app.core.config import ProvidersConfig, TimeoutPolicy
from app.core.schemas import ProviderHealth, ProviderStatus
from app.providers.base import ProviderBase
from app.providers.http_async import HttpAsyncProvider
from app.providers.spec_only import SpecOnlyProvider


@dataclass
class ProviderEntry:
    provider: ProviderBase
    cost_score: int
    headers: Dict[str, str]


class ProviderRegistry:
    def __init__(self, providers_cfg: ProvidersConfig, timeouts: TimeoutPolicy) -> None:
        self.providers_cfg = providers_cfg
        self.timeouts = timeouts
        self._providers: Dict[str, ProviderEntry] = {}
        self._health: Dict[str, ProviderStatus] = {}
        self._init_providers()

    def _init_providers(self) -> None:
        for name, cfg in self.providers_cfg.providers.items():
            if cfg.type == "http_async":
                provider = HttpAsyncProvider(name, cfg, self.timeouts)
            elif cfg.type == "spec_only":
                provider = SpecOnlyProvider(name, cfg.base_url)
            else:
                continue
            self._providers[name] = ProviderEntry(
                provider=provider, cost_score=cfg.cost_score, headers=cfg.headers
            )
            self._health[name] = ProviderStatus(
                provider=name,
                health=ProviderHealth.unknown,
                circuit_open=False,
                last_error=None,
                last_checked_at=None,
            )

    def get(self, name: str) -> ProviderBase:
        return self._providers[name].provider

    def exists(self, name: str) -> bool:
        return name in self._providers

    def cost_score(self, name: str) -> int:
        return self._providers[name].cost_score

    def headers(self, name: str) -> Dict[str, str]:
        return self._providers[name].headers

    def list(self) -> List[str]:
        return list(self._providers.keys())

    def update_health(self, name: str, health: ProviderHealth, error: str | None = None) -> None:
        status = self._health.get(name)
        if not status:
            return
        status.health = health
        status.last_error = error
        status.last_checked_at = datetime.utcnow()

    def set_circuit(self, name: str, open_state: bool) -> None:
        status = self._health.get(name)
        if not status:
            return
        status.circuit_open = open_state

    def health_snapshot(self) -> List[ProviderStatus]:
        return list(self._health.values())
