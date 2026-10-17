#!/usr/bin/env python3
"""Minimal external Volna echo bot (Python 3 standard library)."""
import hashlib
import json
import os
from pathlib import Path
import time
import urllib.error
import urllib.request

BASE = os.environ['VOLNA_URL'].rstrip('/') + '/api/bot/v1'
TOKEN = os.environ['BOT_TOKEN']
STATE = Path(os.environ.get('BOT_OFFSET_PATH', './echo-offset.json'))

def call(path, data=None, key=None):
    headers = {'Authorization': 'Bearer ' + TOKEN}
    if data is not None:
        headers['Content-Type'] = 'application/json'
    if key:
        headers['Idempotency-Key'] = key
    request = urllib.request.Request(BASE + path, data=None if data is None else json.dumps(data).encode(), headers=headers)
    with urllib.request.urlopen(request, timeout=45) as response:
        return json.load(response)

def remember(offset):
    STATE.parent.mkdir(parents=True, exist_ok=True)
    temporary = STATE.with_name(STATE.name + '.tmp')
    temporary.write_text(json.dumps({'offset': offset}), encoding='utf-8')
    temporary.replace(STATE)

def main():
    offset = json.loads(STATE.read_text(encoding='utf-8'))['offset'] if STATE.exists() else 1
    print('Volna echo bot started. Stop with Ctrl+C.', flush=True)
    while True:
        try:
            updates = call('/updates?timeout=30&offset=' + str(offset))['updates']
            for update in updates:
                message = update['data']
                if update['event_type'] == 'message.created' and message.get('text'):
                    key = hashlib.sha256(('echo:' + update['event_id']).encode()).hexdigest()
                    call('/messages', {'chat_id': update['chat_id'], 'type': 'text', 'text': message['text'], 'reply_to_message_id': message['id']}, key)
                # Save only after the reply was accepted. Stable keys prevent a second
                # send when a process or connection dies between acceptance and save.
                offset = update['update_id'] + 1
                remember(offset)
        except urllib.error.HTTPError as error:
            if error.code in (401, 403, 409):
                raise SystemExit('Bot stopped: check token, bot/chat permissions, or another polling instance (HTTP %s).' % error.code) from None
            if error.code != 429 and error.code < 500:
                raise SystemExit('Bot API rejected a request (HTTP %s).' % error.code) from None
            print('Temporary Bot API error; retrying with the same idempotency key.', flush=True)
            time.sleep(min(60, max(1, int(error.headers.get('Retry-After', '5')))))
        except (urllib.error.URLError, TimeoutError):
            print('Connection interrupted; retrying safely.', flush=True)
            time.sleep(5)

if __name__ == '__main__':
    try:
        main()
    except KeyboardInterrupt:
        pass
