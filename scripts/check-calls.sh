#!/bin/sh
# Read the actual server container settings and test its TCP route to TURN.
set -eu
cd "$(dirname "$0")/.."
docker compose exec -T server node --input-type=module -e '
import net from "node:net";
const host=(process.env.TURN_HOST||"").trim(),secret=process.env.TURN_SECRET||"";
console.log("TURN_HOST:",host||"не задан");
console.log("TURN_SECRET:",secret?"задан (значение скрыто)":"не задан");
if(!host||!secret){console.error("API не выдаёт TURN. Выполните sh scripts/enable-calls.sh.");process.exit(1)}
let done=false;
const socket=net.connect({host,port:3478});
const finish=(error)=>{if(done)return;done=true;socket.destroy();if(error){console.error("TCP 3478:",error);process.exitCode=1}else console.log("TCP 3478: доступен. UDP и передачу звука проверьте звонком между разными сетями.")};
socket.setTimeout(8000,()=>finish("TIMEOUT"));
socket.once("connect",()=>finish());socket.once("error",error=>finish(error.code||error.message));
'
docker compose --profile calls ps turn
