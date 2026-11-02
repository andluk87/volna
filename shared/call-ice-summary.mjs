/** Aggregate only. Never return addresses, ICE passwords, fingerprints or SDP. */
export function callCandidateSummary(sdp=''){
 const result={relay_count:0,host_count:0,srflx_count:0,prflx_count:0,udp_count:0,tcp_count:0};
 for(const line of String(sdp).split(/\r?\n/)){if(!/^a=candidate:/.test(line))continue;const p=line.trim().split(/\s+/),index=p.indexOf('typ'),type=index>=0?p[index+1]:null,protocol=p[2]?.toLowerCase();if(Object.hasOwn(result,type+'_count'))result[type+'_count']++;if(protocol==='udp'||protocol==='tcp')result[protocol+'_count']++;}return result;
}
/** In non-trickle, relay-only calls a complete SDP with no relay cannot connect. */
export function initialRelayGap(offer,answer){
 const negotiated=sdp=>typeof sdp==='string'&&/^a=ice-ufrag:[^\r\n]+/m.test(sdp)&&/^a=ice-pwd:[^\r\n]+/m.test(sdp);
 if(!negotiated(offer?.sdp)||!negotiated(answer?.sdp))return null;
 const caller=callCandidateSummary(offer.sdp).relay_count,callee=callCandidateSummary(answer.sdp).relay_count;
 return caller&&callee?null:{caller_relay_count:caller,callee_relay_count:callee};
}
