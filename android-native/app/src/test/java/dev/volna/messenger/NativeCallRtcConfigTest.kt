package dev.volna.messenger

import org.junit.Test
import org.junit.Assert.*
import org.webrtc.PeerConnection

class NativeCallRtcConfigTest {
    @Test fun audioAndVideoShareAPrefetchedRelayTransport(){
        val server=PeerConnection.IceServer.builder(listOf("turn:example.invalid:3478?transport=udp","turn:example.invalid:3478?transport=tcp")).setUsername("private-user").setPassword("private-password").createIceServer()
        val config=nativeCallRtcConfig(listOf(server))
        assertEquals(PeerConnection.BundlePolicy.MAXBUNDLE,config.bundlePolicy)
        assertEquals(PeerConnection.RtcpMuxPolicy.REQUIRE,config.rtcpMuxPolicy)
        assertEquals(PeerConnection.SdpSemantics.UNIFIED_PLAN,config.sdpSemantics)
        assertEquals(1,config.iceCandidatePoolSize)
        assertEquals(PeerConnection.IceTransportsType.RELAY,config.iceTransportsType)
        assertEquals(listOf(server),config.iceServers)
    }
}
