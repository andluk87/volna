export function callCandidateSummary(sdp=''){
 const result={relay_count:0,host_count:0,srflx_count:0,prflx_count:0,udp_count:0,tcp_count:0};
 for(const line of String(sdp).split(/\r?\n/)){if(!/^a=candidate:/.test(line))continue;const p=line.trim().split(/\s+/),type=p[p.indexOf('typ')+1],protocol=p[2]?.toLowerCase();if(Object.hasOwn(result,type+'_count'))result[type+'_count']++;if(protocol==='udp'||protocol==='tcp')result[protocol+'_count']++;}return result;
}
export function callStats(report){
 const rows=[...report.values()],out={bytes_sent:0,bytes_received:0,packets_sent:0,packets_received:0,packets_lost:0};
 for(const r of rows){if(r.type==='outbound-rtp'&&!r.isRemote){out.bytes_sent+=Number(r.bytesSent)||0;out.packets_sent+=Number(r.packetsSent)||0;}if(r.type==='inbound-rtp'&&!r.isRemote){out.bytes_received+=Number(r.bytesReceived)||0;out.packets_received+=Number(r.packetsReceived)||0;out.packets_lost+=Number(r.packetsLost)||0;}}
 const transport=rows.find(r=>r.type==='transport'&&r.selectedCandidatePairId),pair=report.get(transport?.selectedCandidatePairId)||rows.find(r=>r.type==='candidate-pair'&&r.state==='succeeded'&&r.nominated);
 if(pair){const local=report.get(pair.localCandidateId);if(['relay','host','srflx','prflx'].includes(local?.candidateType))out.candidate_type=local.candidateType;if(['udp','tcp'].includes(local?.protocol))out.protocol=local.protocol;if(Number.isFinite(pair.currentRoundTripTime))out.rtt_ms=Math.round(pair.currentRoundTripTime*1000);}
 return out;
}
