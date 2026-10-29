#!/usr/bin/env python3
"""Upgrade the old fast Whisper defaults; retain custom model/language settings."""
import os
import re
import shutil
import tempfile
from pathlib import Path


def improve(text):
    values = {}
    for line in text.splitlines():
        match = re.match(r'^\s*(WHISPER_MODEL|WHISPER_BEAM_SIZE)\s*=\s*(.*?)\s*$', line)
        if match:
            values[match[1]] = match[2].split(' #', 1)[0].strip().strip('\"\'')
    patches = {}
    if values.get('WHISPER_MODEL', '') in ('', 'tiny', 'base'):
        patches['WHISPER_MODEL'] = 'small'
    if values.get('WHISPER_BEAM_SIZE', '') in ('', '1'):
        patches['WHISPER_BEAM_SIZE'] = '5'
    lines = text.splitlines()
    for key, value in patches.items():
        found = False
        for index, line in enumerate(lines):
            if re.match(r'^\s*' + key + r'\s*=', line):
                lines[index] = f'{key}={value}'
                found = True
        if not found:
            lines.append(f'{key}={value}')
    return '\n'.join(lines) + '\n', bool(patches)


def main():
    path = Path('.env')
    text = path.read_text()
    updated, changed = improve(text)
    if not changed:
        print('Whisper custom quality settings preserved.')
        return
    backup_dir = Path('backups'); backup_dir.mkdir(exist_ok=True)
    fd, backup_name = tempfile.mkstemp(prefix='whisper-settings-', suffix='.env', dir=backup_dir)
    os.close(fd); shutil.copyfile(path, backup_name); os.chmod(backup_name, 0o600)
    fd, temporary = tempfile.mkstemp(prefix='.env-whisper-', dir=path.parent)
    try:
        with os.fdopen(fd, 'w') as stream:
            stream.write(updated); stream.flush(); os.fsync(stream.fileno())
        os.chmod(temporary, path.stat().st_mode & 0o777)
        os.replace(temporary, path)
    finally:
        Path(temporary).unlink(missing_ok=True)
    print('Whisper quality profile enabled; previous .env saved privately under backups/.')


if __name__ == '__main__':
    main()
