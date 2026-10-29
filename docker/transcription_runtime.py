"""Load one model in the background without blocking the private HTTP service."""
import json
import threading
import time


def error_summary(error):
    # Report useful diagnostics without logging URLs, credentials or exception text.
    result = {"type": type(error).__name__}
    causes = []
    seen = set()
    current = error
    while current is not None and id(current) not in seen and len(causes) < 5:
        seen.add(id(current))
        causes.append(type(current).__name__)
        errno = getattr(current, "errno", None)
        if isinstance(errno, int):
            result["errno"] = errno
        status = getattr(getattr(current, "response", None), "status_code", None)
        if isinstance(status, int):
            result["http_status"] = status
        current = current.__cause__ or current.__context__
    result["causes"] = causes
    return result


class ModelRuntime:
    def __init__(self, factory, retry_seconds=60, fallback_factory=None, primary_name=None, fallback_name=None):
        self.factory = factory
        self.fallback_factory = fallback_factory
        self.primary_name = primary_name
        self.fallback_name = fallback_name
        self._active_name = None
        self._fallback_thread = None
        self._loading_started = time.monotonic()
        self.retry_seconds = retry_seconds
        self._lock = threading.Lock()
        self._stop = threading.Event()
        self._thread = None
        self._model = None
        self._state = "loading"
        self._error = None
        self._attempts = 0

    def start(self):
        with self._lock:
            if self._thread is not None:
                return
            self._thread = threading.Thread(target=self._load, name="whisper-loader", daemon=True)
            if self.fallback_factory:
                self._fallback_thread = threading.Thread(target=self._load_fallback, name="whisper-cached-fallback", daemon=True)
                self._fallback_thread.start()
            self._thread.start()

    def _load_fallback(self):
        try:
            model = self.fallback_factory()
            if model is None:
                return
            with self._lock:
                if self._stop.is_set() or self._model is not None:
                    return
                self._model = model
                self._active_name = self.fallback_name
            print("[whisper] cached_fallback_ready", flush=True)
        except Exception as error:
            print(f"[whisper] cached_fallback_unavailable type={type(error).__name__}", flush=True)

    def _load(self):
        while not self._stop.is_set():
            with self._lock:
                self._state = "loading"
                self._error = None
                self._attempts += 1
                self._loading_started = time.monotonic()
            try:
                model = self.factory()
                if model is None:
                    raise RuntimeError("Model factory returned no model")
            except Exception as error:
                summary = error_summary(error)
                with self._lock:
                    self._state = "failed"
                    self._error = summary
                print(f"[whisper] model_load_failed {json.dumps(summary)} retry_seconds={self.retry_seconds}", flush=True)
                if self._stop.wait(self.retry_seconds):
                    return
            else:
                with self._lock:
                    if self._stop.is_set():
                        return
                    self._model = model
                    self._active_name = self.primary_name
                    self._state = "ready"
                    self._error = None
                print("[whisper] model_ready", flush=True)
                return

    def snapshot(self):
        with self._lock:
            return {"ready": self._model is not None, "state": "degraded" if self._model is not None and self._state != "ready" else self._state,
                    "primary_state": self._state, "active_model": self._active_name,
                    "loading_seconds": round(time.monotonic()-self._loading_started, 1) if self._state == "loading" else 0,
                    "attempts": self._attempts, "error": self._error}

    def get_model(self):
        with self._lock:
            return self._model

    def get_model_with_name(self):
        with self._lock:
            return self._model, self._active_name

    def close(self):
        self._stop.set()
        if self._thread is not None:
            self._thread.join(timeout=0.2)
        if self._fallback_thread is not None:
            self._fallback_thread.join(timeout=0.2)
