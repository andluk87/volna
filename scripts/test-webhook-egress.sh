#!/bin/sh
# CI/runtime smoke: start only the egress boundary, never the production app.
set -eu
: "${POSTGRES_PASSWORD:=egress-ci-placeholder}"
export POSTGRES_PASSWORD
project="volna-egress-ci-$$"
compose() { docker compose -p "$project" -f compose.yaml "$@"; }
fixture="${project}-private-fixture"
cleanup() { docker rm -f "$fixture" >/dev/null 2>&1 || true; compose down -v >/dev/null 2>&1 || true; }
trap cleanup EXIT
compose build webhook-egress
compose up -d --wait --wait-timeout 90 webhook-egress
container=$(compose ps -q webhook-egress)
image=$(docker inspect --format '{{.Config.Image}}' "$container")
network=$(docker inspect --format '{{range $name,$value := .NetworkSettings.Networks}}{{$name}}{{end}}' "$container")
docker run -d --name "$fixture" --network "$network" --entrypoint node "$image" -e "require('node:http').createServer((q,s)=>s.end('private')).listen(443,'0.0.0.0')" >/dev/null
private_ip=$(docker inspect --format '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' "$fixture")
# Prove the private target really listens before checking the egress firewall.
docker exec "$fixture" node -e "fetch('http://127.0.0.1:443').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
compose exec -T --user node webhook-egress node --input-type=module - "$private_ip" <<'JS'
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import net from 'node:net';
import {egressClient} from './server/webhook-egress.mjs';
const pid1=readFileSync('/proc/1/status','utf8');
// init owns PID1; check the actual Node egress process via /proc status below.
const self=readFileSync('/proc/self/status','utf8');assert.match(self,/Uid:\s+1000\s+1000/);assert.match(self,/CapEff:\s+0+\n/);
const client=egressClient('/run/volna-webhook/egress.sock');
assert.equal((await client({op:'validate',url:'https://example.com/'})).ok,true);
await assert.rejects(client({op:'validate',url:'https://127.0.0.1/'}));
await new Promise((resolve,reject)=>{const s=net.connect({host:process.argv[2],port:443});s.setTimeout(2000,()=>{s.destroy();resolve();});s.on('connect',()=>{s.destroy();reject(Error('Firewall allowed private network'));});s.on('error',()=>resolve());});
console.log('Egress: healthy, public DNS works, private socket and HTTP registration denied.');
JS
# PID1 may be Docker init; all executable children must have dropped effective caps.
compose exec -T webhook-egress sh -ec 'for p in /proc/[0-9]*/comm; do if [ "$(cat "$p" 2>/dev/null || true)" = node ]; then status="${p%comm}status"; grep -Eq "^CapEff:[[:space:]]+0+$" "$status"; grep -Eq "^Uid:[[:space:]]+1000[[:space:]]+1000" "$status"; fi; done'
