#!/usr/bin/env python3
"""Apply the Russian CPU ASR profile; retain explicit engine, model paths and language."""
import os
import re
import shutil
import tempfile
from pathlib import Path


def improve(text):
    values = {}
    for line in text.splitlines():
        match = re.match(r'^\s*(ASR_ENGINE|ASR_CPU_THREADS|WHISPER_MODEL|WHISPER_BEAM_SIZE|WHISPER_COMPUTE_TYPE|WHISPER_CPU_THREADS|WHISPER_LANGUAGE|WHISPER_FALLBACK_MODEL)\s*=\s*(.*?)\s*$', line)
        if match:
            values[match[1]] = match[2].split(' #', 1)[0].strip().strip('\"\'')
    patches = {}
    standard_models = ('', 'tiny', 'base', 'small', 'medium', 'large-v1', 'large-v2', 'large', 'large-v3')
    if not values.get('ASR_ENGINE'):
        patches['ASR_ENGINE'] = ('gigaam' if values.get('WHISPER_MODEL', '') in standard_models
                                 and values.get('WHISPER_LANGUAGE', 'ru') == 'ru' else 'whisper')
    if not values.get('ASR_CPU_THREADS'):
        patches['ASR_CPU_THREADS'] = 'auto'
    if values.get('WHISPER_FALLBACK_MODEL', '') in ('', 'base'):
        patches['WHISPER_FALLBACK_MODEL'] = 'off'
    if values.get('WHISPER_MODEL', '') in ('', 'tiny', 'base', 'small', 'medium', 'large-v1', 'large-v2', 'large'):
        patches['WHISPER_MODEL'] = 'large-v3'
    if values.get('WHISPER_BEAM_SIZE', '') in ('', '1', '5'):
        patches['WHISPER_BEAM_SIZE'] = '10'
    if values.get('WHISPER_COMPUTE_TYPE', '') in ('', 'int8', 'int8_float32'):
        patches['WHISPER_COMPUTE_TYPE'] = 'float32'
    if values.get('WHISPER_CPU_THREADS', '') in ('', '4'):
        patches['WHISPER_CPU_THREADS'] = '8'
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
        print('Local ASR custom quality settings preserved.')
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
    print('Local CPU ASR quality profile enabled; previous .env saved privately under backups/.')


if __name__ == '__main__':
    main()
