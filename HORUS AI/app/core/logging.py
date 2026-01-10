from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path
from typing import Any, Dict


class EventLogger:
    def __init__(self, base_dir: Path) -> None:
        self.base_dir = base_dir
        self.base_dir.mkdir(parents=True, exist_ok=True)

    def log(self, event: str, payload: Dict[str, Any]) -> None:
        ts = datetime.utcnow().isoformat()
        record = {"ts": ts, "event": event, **payload}
        log_path = self.base_dir / f"run-{datetime.utcnow().strftime('%Y%m%d')}.jsonl"
        with log_path.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(record, ensure_ascii=True) + "\n")
