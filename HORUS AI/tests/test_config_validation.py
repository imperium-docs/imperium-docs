import pytest

from app.core.config import ConfigManager
from app.core.errors import ConfigError


def write_file(path, content: str) -> None:
    path.write_text(content, encoding="utf-8")


def test_config_validation_ok(tmp_path):
    write_file(
        tmp_path / "providers.yml",
        """
providers:
  spec_only:
    type: spec_only
    base_url: ""
    capabilities:
      txt2vid: true
      img2vid: true
    cost_score: 0
chain:
  - provider: "spec_only"
""",
    )
    write_file(
        tmp_path / "policies.yml",
        """
timeouts:
  submit_s: 10
  poll_s: 5
  fetch_s: 20
retry:
  max_attempts: 1
  backoff_s: 1
circuit_breaker:
  failure_threshold: 2
  recovery_time_s: 10
routing:
  strategy: "chain"
  cost_aware: false
health:
  check_interval_s: 30
  timeout_s: 5
  enabled: false
degrade_plan: []
""",
    )
    write_file(tmp_path / "accounts.yml", "pools: []\n")
    write_file(tmp_path / "job_templates.yml", "templates: {}\n")

    manager = ConfigManager(tmp_path)
    manager.validate()


def test_config_validation_missing_chain(tmp_path):
    write_file(
        tmp_path / "providers.yml",
        """
providers:
  spec_only:
    type: spec_only
    base_url: ""
    capabilities:
      txt2vid: true
      img2vid: true
    cost_score: 0
""",
    )
    write_file(
        tmp_path / "policies.yml",
        """
timeouts:
  submit_s: 10
  poll_s: 5
  fetch_s: 20
retry:
  max_attempts: 1
  backoff_s: 1
circuit_breaker:
  failure_threshold: 2
  recovery_time_s: 10
routing:
  strategy: "chain"
  cost_aware: false
health:
  check_interval_s: 30
  timeout_s: 5
  enabled: false
degrade_plan: []
""",
    )
    write_file(tmp_path / "accounts.yml", "pools: []\n")
    write_file(tmp_path / "job_templates.yml", "templates: {}\n")

    manager = ConfigManager(tmp_path)
    with pytest.raises(ConfigError):
        manager.validate()
