import json
import socket
import sys
import threading
import tempfile
import time
import unittest
import urllib.error
import urllib.request
from contextlib import contextmanager
from pathlib import Path
from types import SimpleNamespace
from types import ModuleType
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'docker'))
import uvicorn
from transcription_service import create_app, load_model


@contextmanager
def running_app(factory):
    sock = socket.socket()
    sock.bind(('127.0.0.1', 0))
    port = sock.getsockname()[1]
    app = create_app(factory, retry_seconds=60)
    server = uvicorn.Server(uvicorn.Config(app, log_level='critical', lifespan='on'))
    thread = threading.Thread(target=lambda: server.run(sockets=[sock]), daemon=True)
    thread.start()
    try:
        deadline = time.monotonic() + 5
        while not server.started and thread.is_alive() and time.monotonic() < deadline:
            time.sleep(0.01)
        if not server.started:
            raise AssertionError('HTTP startup was blocked by the model loader')
        yield f'http://127.0.0.1:{port}', app.state.runtime
    finally:
        server.should_exit = True
        thread.join(5)
        sock.close()
        if thread.is_alive():
            raise AssertionError('HTTP shutdown did not complete')


def request(base, path, audio=None, mime='audio/ogg'):
    headers = {}
    data = None
    if audio is not None:
        boundary = 'volna-test-boundary'
        headers['Content-Type'] = f'multipart/form-data; boundary={boundary}'
        data = (f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="voice.ogg"\r\n'
                f'Content-Type: {mime}\r\n\r\n').encode() + audio + f'\r\n--{boundary}--\r\n'.encode()
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    try:
        response = opener.open(urllib.request.Request(base+path, data=data, headers=headers), timeout=2)
    except urllib.error.HTTPError as error:
        response = error
    with response:
        return response.status, json.load(response)


class HTTPTest(unittest.TestCase):
    def test_complete_cache_avoids_network_and_partial_cache_resumes_download(self):
        for complete in (True, False):
            with self.subTest(complete=complete), tempfile.TemporaryDirectory() as directory:
                cached = Path(directory)
                for name in ('model.bin', 'config.json', 'tokenizer.json'):
                    (cached / name).write_bytes(b'cached content')
                if not complete:
                    (cached / 'model.bin').unlink()
                downloads = []
                models = []
                def download(name, **options):
                    downloads.append(options)
                    if not options.get('local_files_only'):
                        (cached / 'model.bin').write_bytes(b'downloaded weights')
                    return str(cached)
                def model(path, **options):
                    self.assertTrue((Path(path) / 'model.bin').is_file())
                    models.append(path)
                    return object()
                fw = ModuleType('faster_whisper'); fw.__path__ = []; fw.WhisperModel = model
                utils = ModuleType('faster_whisper.utils'); utils.download_model = download
                hub = ModuleType('huggingface_hub'); hub.__path__ = []
                errors = ModuleType('huggingface_hub.errors')
                errors.LocalEntryNotFoundError = type('LocalEntryNotFoundError', (Exception,), {})
                with patch.dict(sys.modules, {'faster_whisper':fw,'faster_whisper.utils':utils,
                                             'huggingface_hub':hub,'huggingface_hub.errors':errors}):
                    self.assertIsNotNone(load_model())
                self.assertEqual(len(models), 1)
                self.assertEqual(len(downloads), 1 if complete else 2)
                self.assertTrue(downloads[0]['local_files_only'])
                self.assertEqual(downloads[0]['cache_dir'], '/models')

    def test_http_is_live_while_model_download_blocks_and_returns_503_for_audio(self):
        release = threading.Event()
        def factory():
            release.wait(10)
            return object()
        try:
            with running_app(factory) as (base, runtime):
                status, body = request(base, '/health')
                self.assertEqual(status, 200)
                self.assertTrue(body['ok'])
                self.assertFalse(body['ready'])
                self.assertEqual(request(base, '/ready')[0], 503)
                status, body = request(base, '/transcribe', b'audio')
                self.assertEqual(status, 503)
                self.assertEqual(body['detail']['state'], 'loading')
                release.set()
        finally:
            release.set()

    def test_failed_model_is_reported_without_disabling_http(self):
        def factory():
            raise PermissionError(13, 'private filesystem path and credentials')
        with running_app(factory) as (base, runtime):
            deadline = time.monotonic() + 3
            while runtime.snapshot()['state'] != 'failed' and time.monotonic() < deadline:
                time.sleep(0.01)
            status, body = request(base, '/health')
            self.assertEqual(status, 200)
            self.assertEqual(body['state'], 'failed')
            self.assertEqual(body['error']['errno'], 13)
            self.assertNotIn('credentials', str(body))
            self.assertEqual(request(base, '/ready')[0], 503)
            status, body = request(base, '/transcribe', b'audio')
            self.assertEqual(status, 503)
            self.assertEqual(body['detail']['state'], 'failed')

    def test_ready_model_transcribes_and_temporary_file_is_removed(self):
        paths = []
        class FakeModel:
            def transcribe(self, path, **options):
                paths.append(path)
                self_test.assertEqual(Path(path).read_bytes(), b'voice data')
                self_test.assertTrue(options['vad_filter'])
                self_test.assertFalse(options['condition_on_previous_text'])
                return iter([SimpleNamespace(text=' Привет.')]), None
        self_test = self
        with running_app(FakeModel) as (base, runtime):
            self.assertEqual(request(base, '/ready')[0], 200)
            status, body = request(base, '/transcribe', b'voice data')
            self.assertEqual(status, 200)
            self.assertEqual(body, {'text': 'Привет.'})
            self.assertEqual(len(paths), 1)
            self.assertFalse(Path(paths[0]).exists())
            self.assertEqual(request(base, '/transcribe', b'')[0], 400)
            self.assertEqual(request(base, '/transcribe', b'file', mime='text/plain')[0], 415)


if __name__ == '__main__':
    unittest.main()
