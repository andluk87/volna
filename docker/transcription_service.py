import asyncio
import os
import tempfile
import threading
import time
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, File, HTTPException, UploadFile
from transcription_runtime import ModelRuntime

MODEL_NAME = os.getenv("WHISPER_MODEL", "large-v3")
FALLBACK_MODEL = os.getenv("WHISPER_FALLBACK_MODEL", "base").strip()
THREADS = max(1, min(32, int(os.getenv("WHISPER_CPU_THREADS", "8"))))
COMPUTE_TYPE = os.getenv("WHISPER_COMPUTE_TYPE", "float32")
BEAM_SIZE = max(1, min(5, int(os.getenv("WHISPER_BEAM_SIZE", "5"))))
LANGUAGE = os.getenv("WHISPER_LANGUAGE", "ru").strip().lower()
if LANGUAGE in ("", "auto", "detect"):
    LANGUAGE = None
MAX_AUDIO_BYTES = 20 * 1024 * 1024
SUFFIXES = {
    "audio/webm": ".webm",
    "audio/ogg": ".ogg",
    "audio/mpeg": ".mp3",
    "audio/mp4": ".mp4",
    "audio/wav": ".wav",
}

def load_model(model_name=MODEL_NAME, local_only=False):
    # Import and model loading can be slow; both belong to the background loader.
    from faster_whisper import WhisperModel
    from faster_whisper.utils import download_model
    from huggingface_hub.errors import LocalEntryNotFoundError
    options = dict(device="cpu", compute_type=COMPUTE_TYPE, cpu_threads=THREADS,
                   num_workers=1, download_root="/models")
    print(f"[whisper] loading model={model_name}; compute_type={COMPUTE_TYPE} cpu_threads={THREADS}; checking persistent cache", flush=True)
    if Path(model_name).is_dir():
        model_path = model_name
    else:
        try:
            model_path = download_model(model_name, cache_dir="/models", local_files_only=True)
        except LocalEntryNotFoundError:
            model_path = None
        required = ("model.bin", "config.json", "tokenizer.json")
        if model_path is None or not all((Path(model_path) / name).is_file() and
                                        (Path(model_path) / name).stat().st_size > 0 for name in required):
            if local_only:
                raise FileNotFoundError("Cached fallback model is unavailable")
            print("[whisper] model cache incomplete; downloading weights", flush=True)
            model_path = download_model(model_name, cache_dir="/models")
    return WhisperModel(model_path, **options)


def transcribe(model, model_lock, path: str, active_model=MODEL_NAME) -> str:
    with model_lock:
        started = time.perf_counter()
        segments, _info = model.transcribe(
            path,
            language=LANGUAGE,
            beam_size=BEAM_SIZE,
            vad_filter=True,
            condition_on_previous_text=False,
            without_timestamps=True,
        )
        text = "".join(segment.text for segment in segments).strip()[:8000]
        print(f"[whisper] model={active_model} language={LANGUAGE or 'auto'} beam={BEAM_SIZE} elapsed_seconds={time.perf_counter()-started:.2f}", flush=True)
        return text


def create_app(model_factory=load_model, retry_seconds=60):
    fallback = None
    if model_factory is load_model and FALLBACK_MODEL and FALLBACK_MODEL not in (MODEL_NAME, "none", "off"):
        fallback = lambda: load_model(FALLBACK_MODEL, local_only=True)
    runtime = ModelRuntime(model_factory, retry_seconds=retry_seconds, fallback_factory=fallback,
                           primary_name=MODEL_NAME, fallback_name=FALLBACK_MODEL)
    model_lock = threading.Lock()

    @asynccontextmanager
    async def lifespan(app):
        runtime.start()
        try:
            yield
        finally:
            runtime.close()

    app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None, lifespan=lifespan)
    app.state.runtime = runtime

    @app.get("/health")
    async def health():
        # Docker checks HTTP service liveness, not completion of a model download.
        return {"ok": True, "model": MODEL_NAME, "beam_size": BEAM_SIZE, "language": LANGUAGE or "auto", "device": "cpu", "compute_type": COMPUTE_TYPE, "cpu_threads": THREADS, **runtime.snapshot()}

    @app.get("/ready")
    async def ready():
        status = runtime.snapshot()
        if not status["ready"]:
            raise HTTPException(status_code=503, detail=status)
        return {"ok": True, "model": MODEL_NAME, **status}

    @app.post("/transcribe")
    async def transcribe_audio(file: UploadFile = File(...)):
        suffix = SUFFIXES.get((file.content_type or "").split(";", 1)[0].strip().lower())
        if suffix is None:
            raise HTTPException(status_code=415, detail="Unsupported audio format")
        model, active_name = runtime.get_model_with_name()
        if model is None:
            raise HTTPException(status_code=503, detail=runtime.snapshot())
        payload = await file.read(MAX_AUDIO_BYTES + 1)
        if not payload:
            raise HTTPException(status_code=400, detail="Audio file is empty")
        if len(payload) > MAX_AUDIO_BYTES:
            raise HTTPException(status_code=413, detail="Audio file is too large")
        path = None
        try:
            with tempfile.NamedTemporaryFile(prefix="volna-", suffix=suffix, delete=False) as audio:
                audio.write(payload)
                path = audio.name
            try:
                text = await asyncio.to_thread(transcribe, model, model_lock, path, active_name or MODEL_NAME)
            except Exception as error:
                # PyAV decoder failures are bad recordings, not service outages.
                if type(error).__module__.startswith("av.") and type(error).__name__ in ("InvalidDataError", "EOFError"):
                    raise HTTPException(status_code=400, detail="Invalid audio recording") from None
                print(f"[whisper] transcription_failed type={type(error).__name__}", flush=True)
                raise HTTPException(status_code=500, detail="Transcription failed") from None
            if not text:
                raise HTTPException(status_code=422, detail="No speech recognized")
            return {"text": text}
        finally:
            if path:
                Path(path).unlink(missing_ok=True)
    return app


app = create_app()
