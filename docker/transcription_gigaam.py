"""Russian speech recognition on CPU. Only model weights are downloaded, never audio."""
import os
import threading
from pathlib import Path
from types import SimpleNamespace

MODEL = "gigaam-v3-e2e-rnnt"
REPOSITORY = "istupakov/gigaam-v3-onnx"
REVISION = "322c3b29492673eb7d0b434bfa9dfb8653e34d02"
FILES = ("config.json", "v3_e2e_rnnt_encoder.onnx", "v3_e2e_rnnt_decoder.onnx",
         "v3_e2e_rnnt_joint.onnx", "v3_e2e_rnnt_vocab.txt", "LICENSE.txt")
SAMPLE_RATE = 16000


def cpu_threads(value="auto"):
    if value != "auto":
        return max(1, min(64, int(value)))
    count = len(os.sched_getaffinity(0)) if hasattr(os, "sched_getaffinity") else os.cpu_count() or 1
    try:
        quota, period = Path("/sys/fs/cgroup/cpu.max").read_text().split()
        if quota != "max":
            count = min(count, max(1, int(quota) // int(period)))
    except (OSError, ValueError):
        pass
    return max(1, min(16, count))


_download_lock = threading.Lock()
_download = {"stage": "starting", "current_file": None}
_download_root = Path("/models/huggingface/hub")


def download_status():
    with _download_lock:
        status = dict(_download)
        root = _download_root / "models--istupakov--gigaam-v3-onnx"
    cached = root / "snapshots" / REVISION
    complete = sum((cached / name).is_file() for name in FILES)
    written = 0
    for path in (root / "blobs").glob("*"):
        try:
            if path.is_file():
                stat = path.stat()
                written += stat.st_blocks * 512
        except OSError:
            pass
    return {**status, "completed_files": complete, "total_files": len(FILES),
            "bytes_on_disk": written}


def _stage(stage, filename=None):
    with _download_lock:
        _download.update(stage=stage, current_file=filename)


def model_directory(root="/models", local_directory=""):
    global _download_root
    if local_directory:
        path = Path(local_directory)
        if not all((path / name).is_file() and (path / name).stat().st_size for name in FILES[:-1]):
            raise FileNotFoundError("Incomplete local GigaAM model")
        return str(path)
    from huggingface_hub import hf_hub_download
    from huggingface_hub.errors import LocalEntryNotFoundError
    with _download_lock:
        _download_root = Path(root) / "huggingface" / "hub"
    options = dict(repo_id=REPOSITORY, revision=REVISION, cache_dir=str(_download_root))
    paths = []
    # Exact filenames avoid the repository-listing API and its metadata request.
    # Each finished file is immediately reusable after a connection failure.
    for name in FILES:
        _stage("checking-cache", name)
        try:
            path = hf_hub_download(filename=name, **options, local_files_only=True)
        except LocalEntryNotFoundError:
            path = None
        if path is None or not Path(path).is_file() or Path(path).stat().st_size == 0:
            _stage("downloading", name)
            print(f"[asr] downloading_file name={name}", flush=True)
            path = hf_hub_download(filename=name, **options, etag_timeout=10)
        if not Path(path).is_file() or Path(path).stat().st_size == 0:
            raise FileNotFoundError("Incomplete downloaded GigaAM file")
        paths.append(Path(path))
        print(f"[asr] cached_file name={name} bytes={paths[-1].stat().st_size}", flush=True)
    return str(paths[0].parent)


class GigaAMModel:
    def __init__(self, model, decode=None, speech=None):
        self.model = model
        self.decode = decode
        self.speech = speech

    def transcribe(self, path, **_options):
        from faster_whisper.audio import decode_audio
        from faster_whisper.vad import get_speech_timestamps, VadOptions
        import numpy as np
        audio = (self.decode or decode_audio)(path, sampling_rate=SAMPLE_RATE)
        if not audio.size:
            return iter(()), None
        # VAD retains quiet/short speech and word edges. Never send an entire long
        # voice message to GigaAM, whose supported input window is <=25 seconds.
        spans = (self.speech or get_speech_timestamps)(audio, VadOptions(
            threshold=0.35, min_speech_duration_ms=120, min_silence_duration_ms=700,
            max_speech_duration_s=22, speech_pad_ms=450))

        def segments():
            for span in spans:
                start, end = max(0, int(span["start"])), min(len(audio), int(span["end"]))
                for offset in range(start, end, 24 * SAMPLE_RATE):
                    chunk = np.ascontiguousarray(audio[offset:min(offset + 24 * SAMPLE_RATE, end)], dtype=np.float32)
                    text = self.model.recognize(chunk, sample_rate=SAMPLE_RATE)
                    if isinstance(text, str) and text.strip():
                        yield SimpleNamespace(text=" " + text.strip())
        return segments(), None


def load_gigaam(threads, root="/models", local_directory=""):
    import onnx_asr
    import onnxruntime as ort
    options = ort.SessionOptions()
    options.intra_op_num_threads = threads
    options.inter_op_num_threads = 1
    options.add_session_config_entry("session.intra_op.allow_spinning", "0")
    directory = model_directory(root, local_directory)
    _stage("initializing")
    print(f"[asr] loading model={MODEL} precision=float32 device=cpu cpu_threads={threads}", flush=True)
    model = onnx_asr.load_model(MODEL, directory, quantization=None,
                               providers=["CPUExecutionProvider"], sess_options=options)
    _stage("ready")
    return GigaAMModel(model)
