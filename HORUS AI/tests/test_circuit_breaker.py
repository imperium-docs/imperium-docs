import time

from app.orchestration.circuit_breaker import CircuitBreaker


def test_circuit_breaker_opens_and_recovers():
    cb = CircuitBreaker(failure_threshold=2, recovery_time_s=1)
    assert not cb.is_open("provider")
    cb.record_failure("provider")
    assert not cb.is_open("provider")
    cb.record_failure("provider")
    assert cb.is_open("provider")
    time.sleep(1.1)
    assert not cb.is_open("provider")


def test_circuit_breaker_resets_on_success():
    cb = CircuitBreaker(failure_threshold=1, recovery_time_s=10)
    cb.record_failure("provider")
    assert cb.is_open("provider")
    cb.record_success("provider")
    assert not cb.is_open("provider")
