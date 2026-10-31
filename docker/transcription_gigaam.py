"""Russian speech recognition on CPU. Only model weights are downloaded, never audio."""
import os
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


def model_directory(root="/models", local_directory=""):
    if local_directory:
        path = Path(local_directory)
        if not all((path / name).is_file() and (path / name).stat().st_size for name in FILES[:-1]):
            raise FileNotFoundError("Incomplete local GigaAM model")
        return str(path)
    from huggingface_hub import snapshot_download
    from huggingface_hub.errors import LocalEntryNotFoundError
    options = dict(repo_id=REPOSITORY, revision=REVISION, allow_patterns=list(FILES),
                   cache_dir=str(Path(root) / "huggingface" / "hub"), max_workers=2)
    try:
        path = snapshot_download(**options, local_files_only=True)
        if all((Path(path) / name).is_file() and (Path(path) / name).stat().st_size for name in FILES[:-1]):
            return path
    except LocalEntryNotFoundError:
        pass
    print("[asr] downloading GigaAM full-precision weights into persistent cache", flush=True)
    return snapshot_download(**options)


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
    print(f"[asr] loading model={MODEL} precision=float32 device=cpu cpu_threads={threads}", flush=True)
    model = onnx_asr.load_model(MODEL, directory, quantization=None,
                               providers=["CPUExecutionProvider"], sess_options=options)
    return GigaAMModel(model)
