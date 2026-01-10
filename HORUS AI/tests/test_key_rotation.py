from app.core.config import AccountKey, AccountPool, AccountsConfig
from app.orchestration.policies import AccountManager


def test_round_robin_rotation():
    accounts = AccountsConfig(
        pools=[
            AccountPool(
                provider="p1",
                pool_name="pool",
                strategy="round_robin",
                cooldown_after_fail_s=0,
                keys=[
                    AccountKey(key_id="k1", env_var_name="K1"),
                    AccountKey(key_id="k2", env_var_name="K2"),
                ],
            )
        ]
    )
    manager = AccountManager(accounts)
    k1 = manager.select_key("p1")
    k2 = manager.select_key("p1")
    k3 = manager.select_key("p1")
    assert k1.key_id == "k1"
    assert k2.key_id == "k2"
    assert k3.key_id == "k1"


def test_cooldown_skips_failed_key():
    accounts = AccountsConfig(
        pools=[
            AccountPool(
                provider="p2",
                pool_name="pool",
                strategy="round_robin",
                cooldown_after_fail_s=3600,
                keys=[
                    AccountKey(key_id="k1", env_var_name="K1"),
                    AccountKey(key_id="k2", env_var_name="K2"),
                ],
            )
        ]
    )
    manager = AccountManager(accounts)
    key = manager.select_key("p2")
    manager.mark_failure("p2", key.key_id)
    next_key = manager.select_key("p2")
    assert next_key.key_id != key.key_id
