/** One relay transport for audio/video, with a single prefetched candidate session. */
export function callRtcConfig(config){return {iceServers:config.iceServers,iceTransportPolicy:'relay',bundlePolicy:'max-bundle',rtcpMuxPolicy:'require',iceCandidatePoolSize:1};}
export function callIceEvent(candidate=''){
 const parts=String(candidate).trim().split(/\s+/),type=parts[parts.indexOf('typ')+1],protocol=parts[2]?.toLowerCase();
 return {...(['relay','host','srflx','prflx'].includes(type)?{candidate_type:type}:{}),...(['udp','tcp'].includes(protocol)?{protocol}:{})};
}
