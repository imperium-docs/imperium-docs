from __future__ import annotations

import threading
from dataclasses import dataclass
from queue import Queue, Empty
from typing import Callable

from app.core.schemas import JobRequest


@dataclass
class JobTask:
    job_id: str
    job: JobRequest


class InMemoryQueue:
    def __init__(self, worker: Callable[[JobTask], None]) -> None:
        self.worker = worker
        self._queue: Queue[JobTask] = Queue()
        self._thread: threading.Thread | None = None
        self._stop_event = threading.Event()

    def start(self) -> None:
        if self._thread and self._thread.is_alive():
            return
        self._thread = threading.Thread(target=self._run, daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop_event.set()
        if self._thread:
            self._thread.join(timeout=2)

    def submit(self, job_id: str, job: JobRequest) -> None:
        self._queue.put(JobTask(job_id=job_id, job=job))

    def _run(self) -> None:
        while not self._stop_event.is_set():
            try:
                task = self._queue.get(timeout=0.5)
            except Empty:
                continue
            try:
                self.worker(task)
            finally:
                self._queue.task_done()
