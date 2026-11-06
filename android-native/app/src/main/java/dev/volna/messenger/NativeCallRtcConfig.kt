package dev.volna.messenger

import org.webrtc.PeerConnection

/** BUNDLE avoids separate TURN allocation/merging for the audio and video m-lines. */
internal fun nativeCallRtcConfig(servers:List<PeerConnection.IceServer>,incoming:Boolean=false) = PeerConnection.RTCConfiguration(servers).apply {
    sdpSemantics=PeerConnection.SdpSemantics.UNIFIED_PLAN
    iceTransportsType=PeerConnection.IceTransportsType.RELAY
    bundlePolicy=PeerConnection.BundlePolicy.MAXBUNDLE
    rtcpMuxPolicy=PeerConnection.RtcpMuxPolicy.REQUIRE
    // Some Android WebRTC builds finish a speculative answerer pool before the
    // remote offer exists, then report COMPLETE with an empty first answer.
    // Keep factory/config prewarming; gather the answerer transport after SDP.
    iceCandidatePoolSize=if(incoming)0 else 1
}
