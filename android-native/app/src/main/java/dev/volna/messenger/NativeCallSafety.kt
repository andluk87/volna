package dev.volna.messenger
internal fun nativeCallSafetyCode(id: String, local: String?, remote: String?): String {
 fun fingerprint(sdp: String?): String? { val values=Regex("^a=fingerprint:sha-256\\s+([A-Fa-f0-9:]+)\\s*$",RegexOption.MULTILINE).findAll(sdp.orEmpty()).map{it.groupValues[1].replace(":","").lowercase()}.distinct().toList();return values.singleOrNull()?.takeIf{it.matches(Regex("[a-f0-9]{64}"))} }
 if(!id.matches(Regex("[a-f0-9]{32}")))return ""
 val left=fingerprint(local)?:return "";val right=fingerprint(remote)?:return ""
 val material="volna-call-safety-v1\n$id\n"+listOf(left,right).sorted().joinToString("\n")
 return java.security.MessageDigest.getInstance("SHA-256").digest(material.toByteArray(Charsets.UTF_8)).take(8).joinToString(""){"%02X".format(it.toInt() and 255)}.chunked(4).joinToString(" · ")
}
