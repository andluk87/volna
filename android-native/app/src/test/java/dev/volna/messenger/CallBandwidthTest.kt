package dev.volna.messenger
import org.junit.Assert.*
import org.junit.Test
class CallBandwidthTest {
    @Test fun opusSavingsPreserveVideoAndAreIdempotent() {
        val video = "m=video 9 UDP/TLS/RTP/SAVPF 96\r\na=rtpmap:96 VP8/90000\r\na=fmtp:96 max-fr=30\r\n"
        val source = "v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111 0\r\na=rtpmap:111 opus/48000/2\r\na=fmtp:111 minptime=10;stereo=1\r\na=rtpmap:0 PCMU/8000\r\n" + video
        val output = economicalAudioSdp(source)
        assertTrue(output.contains("maxaveragebitrate=24000"))
        assertTrue(output.contains("usedtx=1"))
        assertTrue(output.contains("stereo=0"))
        assertTrue(output.endsWith(video))
        assertTrue(output.contains("a=rtpmap:0 PCMU/8000"))
        assertEquals(output, economicalAudioSdp(output))
        assertEquals(video, economicalAudioSdp(video))
    }
}
