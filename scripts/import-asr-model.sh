#!/bin/sh
# Import already downloaded public weights; no model network access is required.
set -eu
cd "$(dirname "$0")/.."
volna_asr_source=${1:-artifacts/gigaam-v3}
python3 - "$volna_asr_source" <<'PY'
from pathlib import Path
import json,sys
root=Path(sys.argv[1])
files=('config.json','v3_e2e_rnnt_encoder.onnx','v3_e2e_rnnt_decoder.onnx','v3_e2e_rnnt_joint.onnx','v3_e2e_rnnt_vocab.txt')
for name in files:
    path=root/name
    if not path.is_file() or not path.stat().st_size:
        raise SystemExit('Missing or empty file: '+name)
if json.loads((root/'config.json').read_text()).get('version')!='v3':
    raise SystemExit('GigaAM v3 config.json is required')
print('Local model files found.')
PY
volna_asr_container=$(docker compose ps -q transcription)
[ -n "$volna_asr_container" ] || { echo 'Start the transcription service first.' >&2; exit 1; }
volna_asr_target="/models/gigaam-v3-offline-$(date -u +%Y%m%dT%H%M%SZ)-$$"
docker compose exec -T --user root transcription mkdir -p "$volna_asr_target"
docker compose cp "$volna_asr_source/." "transcription:$volna_asr_target"
docker compose exec -T --user root transcription chown -R 10001:10001 "$volna_asr_target"
docker compose exec -T transcription python -u -c 'import sys; from transcription_gigaam import load_gigaam; load_gigaam(1,local_directory=sys.argv[1]); print("Offline CPU model validated.")' "$volna_asr_target"
python3 - "$volna_asr_target" <<'PY'
from pathlib import Path
import os,re,shutil,sys,tempfile
path=Path('.env');text=path.read_text();patches={'ASR_ENGINE':'gigaam','GIGAAM_MODEL_DIR':sys.argv[1],'WHISPER_LANGUAGE':'ru','WHISPER_FALLBACK_MODEL':'off'}
lines=text.splitlines()
for key,value in patches.items():
    indices=[i for i,line in enumerate(lines) if re.match(r'^\s*'+key+r'\s*=',line)]
    if indices:
        for i in indices:lines[i]=key+'='+value
    else:lines.append(key+'='+value)
Path('backups').mkdir(exist_ok=True)
fd,backup=tempfile.mkstemp(prefix='asr-offline-',suffix='.env',dir='backups');os.close(fd);shutil.copyfile(path,backup);os.chmod(backup,0o600)
fd,temporary=tempfile.mkstemp(prefix='.env-asr-',dir='.')
try:
    with os.fdopen(fd,'w') as out:out.write('\n'.join(lines)+'\n');out.flush();os.fsync(out.fileno())
    os.chmod(temporary,path.stat().st_mode&0o777);os.replace(temporary,path)
finally:Path(temporary).unlink(missing_ok=True)
print('Offline model selected. Previous .env saved privately in backups/.')
PY
docker compose up -d --no-deps transcription
docker compose exec -T transcription python -u -c '
import json,time,urllib.request
until=time.monotonic()+60
while time.monotonic()<until:
    try:
        with urllib.request.urlopen("http://127.0.0.1:8000/health",timeout=3) as response:state=json.load(response)
        if state.get("ready"):print(json.dumps(state,ensure_ascii=False));break
        if state.get("state")=="failed":print(json.dumps(state,ensure_ascii=False));raise SystemExit("Model failed to initialize; inspect transcription logs")
    except (OSError,ValueError):pass
    time.sleep(1)
else:raise SystemExit("Readiness is not confirmed; inspect transcription logs")
'
