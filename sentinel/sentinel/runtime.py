"""Process runtime: a dedicated asyncio loop thread for the orchestrator, one worker thread that runs long
jobs one at a time (replay, advisory, restore, reset), the LISTEN loop and the periodic re-scan."""

from __future__ import annotations

import asyncio
import logging
import queue
import threading
from collections.abc import Callable, Coroutine
from dataclasses import dataclass, field
from typing import Any

import psycopg

from . import db, feed, orchestrator, scanner
from .config import get_settings

log = logging.getLogger("sentinel.runtime")


@dataclass
class Job:
    name: str
    fn: Callable[[], Any]
    done: threading.Event = field(default_factory=threading.Event)
    result: Any = None
    error: BaseException | None = None

    def wait(self, timeout: float | None = None) -> Any:
        if not self.done.wait(timeout):
            raise TimeoutError(f"{self.name} is still running")
        if self.error is not None:
            raise self.error
        return self.result


class Runtime:
    def __init__(self) -> None:
        self.loop = asyncio.new_event_loop()
        self.listener_alive = threading.Event()
        self.scan_lock = threading.Lock()
        self.current: str | None = None
        self._jobs: queue.Queue[Job] = queue.Queue()
        self._pending: list[str] = []
        self._lock = threading.Lock()
        self._stop = threading.Event()

    def start(self) -> None:
        for target, name in ((self.loop.run_forever, "loop"), (self._work, "worker"),
                             (self._listen, "listen"), (self._rescan, "rescan")):
            threading.Thread(target=target, name=f"sentinel-{name}", daemon=True).start()

    def stop(self) -> None:
        self._stop.set()
        self.loop.call_soon_threadsafe(self.loop.stop)

    # --- jobs -------------------------------------------------------------------------------------

    def run_async(self, coro: Coroutine[Any, Any, Any]) -> Any:
        return asyncio.run_coroutine_threadsafe(coro, self.loop).result()

    def submit(self, name: str, fn: Callable[[], Any]) -> Job:
        job = Job(name, fn)
        with self._lock:
            self._pending.append(name)
        self._jobs.put(job)
        return job

    def active(self) -> list[str]:
        with self._lock:
            return ([self.current] if self.current else []) + list(self._pending)

    def busy_with(self, *names: str) -> bool:
        return any(job in names for job in self.active())

    def _work(self) -> None:
        while not self._stop.is_set():
            job = self._jobs.get()
            with self._lock:
                self._pending.remove(job.name)
                self.current = job.name
            try:
                job.result = job.fn()
            except BaseException as exc:
                job.error = exc
                log.exception("job %s failed", job.name)
                db.log_line(f"Guard: {job.name} failed: {exc}", "error")
            finally:
                with self._lock:
                    self.current = None
                job.done.set()

    def replay_job(self) -> dict[str, int]:
        def after_chunk() -> None:
            if not self.listener_alive.is_set():
                orchestrator.catch_up_stage1()

        result = feed.replay(after_chunk=after_chunk)
        if not self.listener_alive.is_set():
            log.warning("LISTEN loop is down: dispatching feed_done directly")
            self.submit("advisory", self.advisory_job)
        return result

    def advisory_job(self) -> None:
        self.run_async(orchestrator.handle_feed_done())

    # --- LISTEN cve_batch / feed_done -------------------------------------------------------------

    def _listen(self) -> None:
        backoff = 1.0
        warned = False
        while not self._stop.is_set():
            url = get_settings().database_url
            if not url:
                if not warned:
                    log.warning("DATABASE_URL is not set: the LISTEN loop is idle")
                    warned = True
                self._stop.wait(5)
                continue
            try:
                with psycopg.connect(url, autocommit=True, connect_timeout=10, application_name="sentinel-listen") as conn:
                    conn.execute("LISTEN cve_batch")
                    conn.execute("LISTEN feed_done")
                    self.listener_alive.set()
                    backoff = 1.0
                    log.info("LISTEN cve_batch, feed_done")
                    while not self._stop.is_set():
                        for note in conn.notifies(timeout=5.0):
                            self._dispatch(note.channel, note.payload)
                        conn.execute("SELECT 1")
            except Exception as exc:
                self.listener_alive.clear()
                log.warning("LISTEN loop: %s (retrying in %.0fs)", exc, backoff)
                self._stop.wait(backoff)
                backoff = min(backoff * 2, 30.0)
        self.listener_alive.clear()

    def _dispatch(self, channel: str, payload: str) -> None:
        if channel == "cve_batch":
            try:
                first, last = (int(part) for part in payload.split(":", 1))
                orchestrator.stage1_batch(first, last)
            except Exception:
                log.exception("stage 1 failed for batch %s", payload)
        elif channel == "feed_done" and not self.busy_with("advisory"):
            self.submit("advisory", self.advisory_job)

    # --- periodic re-scan (only once a system is connected) ---------------------------------------

    def _rescan(self) -> None:
        while not self._stop.wait(get_settings().rescan_seconds):
            if self.busy_with("reset") or not get_settings().database_url:
                continue
            try:
                with self.scan_lock:
                    scanner.scan(periodic=True)
            except Exception as exc:
                log.debug("periodic re-scan failed: %s", exc)
