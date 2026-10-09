#!/usr/bin/env python3
"""Read-only space check before pulling a builder or starting npm/packaging."""
import os
from pathlib import Path
import subprocess
import sys


def main():
    raw = os.environ.get('WINDOWS_BUILD_MIN_FREE_MB', '4096')
    if not raw.isdecimal() or not 512 <= int(raw) <= 2_147_483_647:
        raise RuntimeError('WINDOWS_BUILD_MIN_FREE_MB must be an integer of at least 512 (default: 4096).')
    minimum = int(raw)
    result = subprocess.run(['docker', 'info', '--format', '{{.DockerRootDir}}'],
                            text=True, capture_output=True, timeout=15)
    if result.returncode:
        raise RuntimeError('Cannot inspect Docker. Check that the daemon is running and accessible.')
    candidates = [Path.cwd(), Path.cwd() / 'artifacts']
    docker_root = result.stdout.strip()
    if docker_root:
        candidates.append(Path(docker_root))
    # Docker with the containerd image store may use a different filesystem.
    candidates.append(Path('/var/lib/containerd'))
    checked = set()
    insufficient = []
    for location in candidates:
        if not location.is_dir():
            continue
        device = location.stat().st_dev
        if device in checked:
            continue
        checked.add(device)
        stat = os.statvfs(location)
        free = stat.f_bavail * stat.f_frsize // (1024 * 1024)
        print(f'Windows build disk: {location}: {free} MiB free; require {minimum} MiB.', flush=True)
        if free < minimum:
            insufficient.append(str(location))
    if insufficient:
        raise RuntimeError('Insufficient free disk space on ' + ', '.join(insufficient) +
                           '. Free unused Docker build cache with docker builder prune -af, '
                           'or expand the disk. Preserve .env, artifacts and Docker data volumes. '
                           'Nothing was deleted; the build has not started.')


if __name__ == '__main__':
    try:
        main()
    except (OSError, subprocess.SubprocessError, RuntimeError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
