package dev.volna.messenger

import org.webrtc.PeerConnection

/** BUNDLE avoids separate TURN allocation/merging for the audio and video m-lines. */
internal fun nativeCallRtcConfig(servers:List<PeerConnection.IceServer>) = PeerConnection.RTCConfiguration(servers).apply {
    sdpSemantics=PeerConnection.SdpSemantics.UNIFIED_PLAN
    iceTransportsType=PeerConnection.IceTransportsType.RELAY
    bundlePolicy=PeerConnection.BundlePolicy.MAXBUNDLE
    rtcpMuxPolicy=PeerConnection.RtcpMuxPolicy.REQUIRE
    iceCandidatePoolSize=1
}
