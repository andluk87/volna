package dev.volna.messenger

import org.junit.Assert.*
import org.junit.Test
import okio.Buffer
import okio.buffer

class NativeUploadTest {
    @Test fun countedBodyPreservesBytesAndReportsRealByteCounts() {
        val bytes=ByteArray(230_001){(it%251).toByte()};val samples=mutableListOf<Pair<Long,Long>>()
        val body=NativeUploadBody(bytes,null){sent,total->samples.add(sent to total)};val sink=Buffer();body.writeTo(sink)
        assertArrayEquals(bytes,sink.readByteArray());assertEquals(bytes.size.toLong(),body.contentLength())
        assertEquals(0L,samples.first().first);assertEquals(bytes.size.toLong(),samples.last().first)
        assertTrue(samples.all{it.second==bytes.size.toLong()&&it.first in 0..it.second});assertTrue(samples.zipWithNext().all{it.first.first<=it.second.first})
    }
    @Test fun bodyDoesNotPretendFailureIsComplete() {
        val bytes=ByteArray(2*1024*1024);val samples=mutableListOf<Long>();val body=NativeUploadBody(bytes,null){sent,_->samples.add(sent)}
        val sink=object:okio.ForwardingSink(okio.blackholeSink()){var count=0L;override fun write(source:Buffer,byteCount:Long){count+=byteCount;if(count>100_000)throw java.io.IOException("offline");super.write(source,byteCount)}}
        try { body.writeTo(sink.buffer());fail("expected I/O failure") }catch(_:java.io.IOException){}
        assertTrue(samples.last()<bytes.size)
    }
    @Test fun readableByteCountsUseStableUnits(){assertEquals("0 Б",uploadBytesLabel(0));assertEquals("1.0 КБ",uploadBytesLabel(1024));assertEquals("16.2 МБ",uploadBytesLabel((16.2*1048576).toLong()))}
}
