package dev.volna.messenger

import org.webrtc.SoftwareVideoDecoderFactory
import org.webrtc.SoftwareVideoEncoderFactory
import org.webrtc.VideoCodecInfo

// Negotiate screen sharing without enumerating device MediaCodec drivers.
internal class CallVideoEncoderFactory : SoftwareVideoEncoderFactory() {
    override fun getSupportedCodecs(): Array<VideoCodecInfo> =
        super.getSupportedCodecs().filter { it.name.equals("VP8", ignoreCase = true) }.toTypedArray()
}

internal class CallVideoDecoderFactory : SoftwareVideoDecoderFactory() {
    override fun getSupportedCodecs(): Array<VideoCodecInfo> =
        super.getSupportedCodecs().filter { it.name.equals("VP8", ignoreCase = true) }.toTypedArray()
}
