from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Literal, Optional

import yaml
from pydantic import BaseModel, Field

from app.core.errors import ConfigError
from app.core.schemas import AspectRatio, OutputFormat, Resolution


class ProviderCapabilities(BaseModel):
    txt2vid: bool = True
    img2vid: bool = False


class ProviderEndpoints(BaseModel):
    submit: str
    poll: str
    fetch: str


class ProviderConfig(BaseModel):
    type: Literal["http_async", "spec_only"]
    base_url: str
    capabilities: ProviderCapabilities
    endpoints: Optional[ProviderEndpoints] = None
    headers: Dict[str, str] = Field(default_factory=dict)
    cost_score: int = 0
    health_endpoint: Optional[str] = None


class ProviderChainItem(BaseModel):
    provider: str


class ProvidersConfig(BaseModel):
    providers: Dict[str, ProviderConfig]
    chain: List[ProviderChainItem]


class RetryPolicy(BaseModel):
    max_attempts: int = 1
    backoff_s: int = 1


class TimeoutPolicy(BaseModel):
    submit_s: int = 30
    poll_s: int = 15
    fetch_s: int = 60


class CircuitBreakerPolicy(BaseModel):
    failure_threshold: int = 3
    recovery_time_s: int = 60


class DegradeStep(BaseModel):
    resolution: Optional[Resolution] = None
    fps: Optional[int] = None
    duration_s: Optional[int] = None
    steps: Optional[int] = None
    guidance: Optional[float] = None


class RoutingPolicy(BaseModel):
    strategy: Literal["chain", "cost_aware"] = "cost_aware"
    cost_aware: bool = True


class HealthPolicy(BaseModel):
    enabled: bool = True
    check_interval_s: int = 30
    timeout_s: int = 5


class PoliciesConfig(BaseModel):
    timeouts: TimeoutPolicy
    retry: RetryPolicy
    circuit_breaker: CircuitBreakerPolicy
    routing: RoutingPolicy = Field(default_factory=RoutingPolicy)
    health: HealthPolicy = Field(default_factory=HealthPolicy)
    degrade_plan: List[DegradeStep] = Field(default_factory=list)


class AccountKey(BaseModel):
    key_id: str
    env_var_name: str
    headers: Dict[str, str] = Field(default_factory=dict)


class AccountPool(BaseModel):
    provider: str
    pool_name: str
    strategy: Literal["round_robin", "least_recent", "random"] = "round_robin"
    cooldown_after_fail_s: int = 0
    keys: List[AccountKey]


class AccountsConfig(BaseModel):
    pools: List[AccountPool]


class JobTemplate(BaseModel):
    resolution: Optional[Resolution] = None
    fps: Optional[int] = None
    duration_s: Optional[int] = None
    output_format: Optional[OutputFormat] = None
    aspect_ratio: Optional[AspectRatio] = None


class JobTemplatesConfig(BaseModel):
    templates: Dict[str, JobTemplate]


@dataclass
class ConfigSnapshot:
    providers: ProvidersConfig
    policies: PoliciesConfig
    accounts: AccountsConfig
    templates: JobTemplatesConfig


class ConfigManager:
    def __init__(self, base_dir: Path) -> None:
        self.base_dir = base_dir
        self._snapshot: Optional[ConfigSnapshot] = None

    def snapshot(self) -> ConfigSnapshot:
        if self._snapshot is None:
            self.reload()
        if self._snapshot is None:
            raise ConfigError("Config snapshot not loaded")
        return self._snapshot

    def reload(self) -> ConfigSnapshot:
        providers = self._load_yaml(self.base_dir / "providers.yml", ProvidersConfig)
        policies = self._load_yaml(self.base_dir / "policies.yml", PoliciesConfig)
        accounts = self._load_yaml(self.base_dir / "accounts.yml", AccountsConfig)
        templates = self._load_yaml(self.base_dir / "job_templates.yml", JobTemplatesConfig)
        self._snapshot = ConfigSnapshot(
            providers=providers, policies=policies, accounts=accounts, templates=templates
        )
        return self._snapshot

    def validate(self) -> None:
        self.reload()

    @staticmethod
    def _load_yaml(path: Path, model: type[BaseModel]) -> BaseModel:
        if not path.exists():
            raise ConfigError(f"Missing config file: {path}")
        try:
            data = yaml.safe_load(path.read_text(encoding="utf-8"))
        except Exception as exc:  # noqa: BLE001
            raise ConfigError(f"Invalid YAML: {path}: {exc}") from exc
        try:
            return model.model_validate(data)
        except Exception as exc:  # noqa: BLE001
            raise ConfigError(f"Schema validation failed for {path}: {exc}") from exc


def expand_env_vars(value: str) -> str:
    if "${" not in value:
        return value
    for key, env_value in os.environ.items():
        value = value.replace(f"${{{key}}}", env_value)
    return value
