import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'docker'))
from transcription_gigaam import GigaAMModel, FILES, SAMPLE_RATE, cpu_threads, model_directory, load_gigaam


class GigaAMTest(unittest.TestCase):
    def test_loader_uses_full_precision_cpu_and_explicit_thread_limit(self):
        with patch('transcription_gigaam.model_directory', return_value='/local/model'), \
                patch('onnx_asr.load_model') as load:
            load_gigaam(12)
            self.assertIsNone(load.call_args.kwargs['quantization'])
            self.assertEqual(load.call_args.kwargs['providers'], ['CPUExecutionProvider'])
            self.assertEqual(load.call_args.kwargs['sess_options'].intra_op_num_threads, 12)

    def test_long_audio_retains_tail_order_and_never_exceeds_model_window(self):
        audio = np.arange(61 * SAMPLE_RATE, dtype=np.float32)
        calls = []
        class Model:
            def recognize(self, chunk, sample_rate):
                calls.append(chunk)
                self_test.assertEqual(sample_rate, SAMPLE_RATE)
                self_test.assertLessEqual(len(chunk), 24 * SAMPLE_RATE)
                return f'Фраза {len(calls)}.'
        self_test = self
        def speech(waveform, options):
            self.assertIs(waveform, audio)
            self.assertEqual(options.max_speech_duration_s, 22)
            self.assertGreaterEqual(options.speech_pad_ms, 400)
            self.assertLess(options.threshold, 0.5)
            return [{'start': 0, 'end': len(audio)}]
        model = GigaAMModel(Model(), decode=lambda *a, **k: audio, speech=speech)
        result, _ = model.transcribe('ignored.ogg')
        self.assertEqual(''.join(s.text for s in result).strip(), 'Фраза 1. Фраза 2. Фраза 3.')
        np.testing.assert_array_equal(np.concatenate(calls), audio)

    def test_silence_is_not_sent_to_recognizer_and_short_speech_keeps_padding(self):
        class Model:
            def recognize(self, chunk, sample_rate):
                raise AssertionError('Silence must not be hallucinated into text')
        model = GigaAMModel(Model(), decode=lambda *a, **k: np.zeros(16000, dtype=np.float32),
                            speech=lambda *a: [])
        self.assertEqual(list(model.transcribe('silence.wav')[0]), [])

    def test_complete_persistent_cache_does_not_download_again(self):
        with tempfile.TemporaryDirectory() as directory:
            for name in FILES:
                (Path(directory) / name).write_bytes(b'weight')
            with patch('huggingface_hub.snapshot_download', return_value=directory) as download:
                self.assertEqual(model_directory(root='/cache'), directory)
                self.assertEqual(download.call_count, 1)
                self.assertTrue(download.call_args.kwargs['local_files_only'])
            self.assertEqual(model_directory(local_directory=directory), directory)
            (Path(directory) / FILES[1]).unlink()
            with self.assertRaises(FileNotFoundError):
                model_directory(local_directory=directory)
            with patch('huggingface_hub.snapshot_download', return_value=directory) as download:
                model_directory(root='/cache')
                self.assertEqual(download.call_count, 2)
                self.assertNotIn('local_files_only', download.call_args.kwargs)

    def test_auto_threads_respect_container_cpu_quota_and_explicit_setting(self):
        with patch('transcription_gigaam.os.sched_getaffinity', return_value=set(range(32))), \
                patch('transcription_gigaam.Path.read_text', return_value='400000 100000'):
            self.assertEqual(cpu_threads(), 4)
        self.assertEqual(cpu_threads('32'), 32)
        self.assertEqual(cpu_threads('999'), 64)


if __name__ == '__main__':
    unittest.main()
