from enum import Enum


class ErrorType(str, Enum):
    timeout = "timeout"
    quota = "quota"
    auth = "auth"
    transient = "transient"
    unsupported = "unsupported"
    server_down = "server_down"
    unknown = "unknown"


class OrchestratorError(Exception):
    pass


class ProviderError(OrchestratorError):
    def __init__(self, message: str, error_type: ErrorType = ErrorType.unknown) -> None:
        super().__init__(message)
        self.error_type = error_type


class ConfigError(OrchestratorError):
    pass
