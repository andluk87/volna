import {callCandidateSummary} from './call-stats.mjs';
/** Full gathering may wait for an unreachable alternate TURN route despite a ready relay. */
export function relayGatherDecision({complete,relays,quietMs,elapsedMs,timeoutMs=10000,settleMs=200}){
 if(complete)return 'complete';
 if(relays>0&&quietMs>=settleMs)return 'relay_ready';
 if(elapsedMs>=timeoutMs)return 'timeout';
 return null;
}
export async function gatherRelayCandidates(pc,{now=()=>performance.now(),sleep=ms=>new Promise(r=>setTimeout(r,ms)),timeoutMs=10000,settleMs=200,pollMs=40}={}){
 const started=now();let lastCount=0,changed=started;
 for(;;){
  const current=now(),summary=callCandidateSummary(pc.localDescription?.sdp);
  if(summary.relay_count!==lastCount){lastCount=summary.relay_count;changed=current;}
  const reason=pc.signalingState==='closed'?'peer_closed':relayGatherDecision({complete:pc.iceGatheringState==='complete',relays:lastCount,quietMs:current-changed,elapsedMs:current-started,timeoutMs,settleMs});
  if(reason)return {...summary,elapsed_ms:Math.round(current-started),gather_exit:reason};
  await sleep(pollMs);
 }
}
