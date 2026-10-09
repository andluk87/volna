import sys
import threading
import time
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'docker'))
from transcription_runtime import ModelRuntime, error_summary


def wait_until(predicate):
    deadline = time.monotonic() + 3
    while time.monotonic() < deadline:
        if predicate():
            return
        time.sleep(0.01)
    raise AssertionError('Timed out waiting for model state')


class RuntimeTest(unittest.TestCase):
    def test_slow_load_runs_once_in_background(self):
        release = threading.Event()
        started = threading.Event()
        model = object()
        calls = []
        def factory():
            calls.append(1)
            started.set()
            release.wait(3)
            return model
        runtime = ModelRuntime(factory)
        try:
            self.assertEqual(calls, [], 'constructing the service never loads weights')
            runtime.start()
            runtime.start()
            self.assertTrue(started.wait(2))
            self.assertEqual(runtime.snapshot()['state'], 'loading')
            self.assertIsNone(runtime.get_model())
            release.set()
            wait_until(lambda: runtime.snapshot()['ready'])
            self.assertIs(runtime.get_model(), model)
            self.assertEqual(calls, [1])
        finally:
            release.set()
            runtime.close()

    def test_failed_load_retries_and_recovers(self):
        calls = []
        model = object()
        def factory():
            calls.append(1)
            if len(calls) == 1:
                raise PermissionError(13, 'credentials must not appear in status')
            return model
        runtime = ModelRuntime(factory, retry_seconds=0.2)
        try:
            runtime.start()
            wait_until(lambda: runtime.snapshot()['state'] == 'failed')
            status = runtime.snapshot()
            self.assertFalse(status['ready'])
            self.assertEqual(status['error']['errno'], 13)
            self.assertNotIn('credentials', str(status))
            wait_until(lambda: runtime.snapshot()['ready'])
            self.assertIs(runtime.get_model(), model)
            self.assertEqual(len(calls), 2)
        finally:
            runtime.close()

    def test_shutdown_interrupts_retry_wait(self):
        def factory():
            raise ConnectionError('secret proxy URL')
        runtime = ModelRuntime(factory, retry_seconds=60)
        runtime.start()
        wait_until(lambda: runtime.snapshot()['state'] == 'failed')
        runtime.close()
        self.assertFalse(runtime._thread.is_alive())
        self.assertFalse(runtime.snapshot()['ready'])

    def test_error_summary_follows_causes_without_exception_text(self):
        try:
            try:
                raise OSError(28, 'private path')
            except OSError as cause:
                raise RuntimeError('private URL') from cause
        except RuntimeError as error:
            summary = error_summary(error)
        self.assertEqual(summary['errno'], 28)
        self.assertEqual(summary['causes'], ['RuntimeError', 'OSError'])
        self.assertNotIn('private', str(summary))


if __name__ == '__main__':
    unittest.main()
