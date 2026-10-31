#!/bin/sh
# Download weights in a temporary host-network container into the existing model volume.
# The actual transcription service keeps its private Compose network and ports.
set -eu
cd "$(dirname "$0")/.."
volna_asr_container=$(docker compose ps -q transcription)
[ -n "$volna_asr_container" ] || { echo 'Start the transcription service first.' >&2; exit 1; }
volna_asr_image=$(docker inspect --format '{{.Image}}' "$volna_asr_container")
docker run --rm --network host --volumes-from "$volna_asr_container" \
 -e HTTP_PROXY -e HTTPS_PROXY -e NO_PROXY \
 -e HF_HUB_DISABLE_XET=1 -e HF_HUB_ETAG_TIMEOUT=10 -e HF_HUB_DOWNLOAD_TIMEOUT=30 \
 --entrypoint python "$volna_asr_image" -u -c '
from pathlib import Path
from huggingface_hub import hf_hub_download
from transcription_gigaam import FILES,REPOSITORY,REVISION
for name in FILES:
    print("Downloading:",name,flush=True)
    path=hf_hub_download(REPOSITORY,name,revision=REVISION,cache_dir="/models/huggingface/hub",etag_timeout=10)
    if not Path(path).is_file() or not Path(path).stat().st_size:
        raise SystemExit("Incomplete model file")
    print("Cached:",name,Path(path).stat().st_size,"bytes",flush=True)
print("Model files cached. No audio left this server.",flush=True)
'
docker compose restart transcription
docker compose exec -T transcription python -u -c '
import json,time,urllib.request
until=time.monotonic()+60
while time.monotonic()<until:
    try:
        with urllib.request.urlopen("http://127.0.0.1:8000/health",timeout=3) as response:
            state=json.load(response)
        if state.get("ready"):
            print(json.dumps(state,ensure_ascii=False));break
        if state.get("state")=="failed":
            print(json.dumps(state,ensure_ascii=False));raise SystemExit("Model initialization failed; inspect transcription logs")
    except (OSError,ValueError):
        pass
    time.sleep(1)
else:
    raise SystemExit("Readiness is not confirmed; inspect transcription logs")
'
