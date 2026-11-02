/** Aggregate only. Never return addresses, ICE passwords, fingerprints or SDP. */
export function callCandidateSummary(sdp=''){
 const result={relay_count:0,host_count:0,srflx_count:0,prflx_count:0,udp_count:0,tcp_count:0};
 for(const line of String(sdp).split(/\r?\n/)){if(!/^a=candidate:/.test(line))continue;const p=line.trim().split(/\s+/),index=p.indexOf('typ'),type=index>=0?p[index+1]:null,protocol=p[2]?.toLowerCase();if(Object.hasOwn(result,type+'_count'))result[type+'_count']++;if(protocol==='udp'||protocol==='tcp')result[protocol+'_count']++;}return result;
}
