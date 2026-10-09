package dev.volna.messenger

import java.io.ByteArrayOutputStream
import java.io.InputStream

/** Bounded reader for Android tombstone.proto. Memory dumps and log buffers are skipped. */
internal object NativeCrashTrace {
    private const val MAX_BYTES = 2 * 1024 * 1024
    private const val MAX_FRAMES = 32

    // Field numbers: platform/system/core/debuggerd/proto/tombstone.proto (Android 12+).
    fun read(input: InputStream): String {
        val output = ByteArrayOutputStream()
        val buffer = ByteArray(8_192)
        while (true) {
            val count = input.read(buffer, 0, minOf(buffer.size, MAX_BYTES + 1 - output.size()))
            if (count < 0) break
            require(count > 0) { "Не удалось прочитать нативный отчёт" }
            output.write(buffer, 0, count)
            require(output.size() <= MAX_BYTES) { "Нативный отчёт превышает 2 МиБ" }
        }
        return parse(output.toByteArray())
    }

    fun parse(bytes: ByteArray): String {
        require(bytes.size <= MAX_BYTES) { "Нативный отчёт превышает 2 МиБ" }
        val top = Proto(bytes)
        var tid = 0L
        var signalInfo = ""
        var abort = ""
        val threads = mutableListOf<Proto>()
        while (top.hasNext()) {
            val key = top.key()
            when (key) {
                6 * 8 -> tid = top.varint()
                10 * 8 + 2 -> signalInfo = signal(top.message())
                14 * 8 + 2 -> abort = top.text(2_000)
                16 * 8 + 2 -> {
                    val entry = top.message()
                    if (threads.size < 256) threads.add(entry)
                }
                else -> top.skip(key)
            }
        }
        require(tid > 0) { "В нативном отчёте нет потока сбоя" }
        val crashed = threads.firstNotNullOfOrNull { entry ->
            var id = 0L
            var value: Proto? = null
            while (entry.hasNext()) {
                val key = entry.key()
                when (key) {
                    1 * 8 -> id = entry.varint()
                    2 * 8 + 2 -> value = entry.message()
                    else -> entry.skip(key)
                }
            }
            if (id == tid) value else null
        }
        return buildString {
            if (signalInfo.isNotBlank()) appendLine("Сигнал: $signalInfo")
            if (abort.isNotBlank()) appendLine("Abort: $abort")
            appendLine("Поток сбоя: $tid")
            if (crashed != null) append(thread(crashed)) else append("Стек потока отсутствует в отчёте Android.")
        }.trim()
    }

    private fun signal(message: Proto): String {
        var number = 0L
        var name = ""
        var code = 0L
        var codeName = ""
        while (message.hasNext()) {
            val key = message.key()
            when (key) {
                1 * 8 -> number = message.varint()
                2 * 8 + 2 -> name = message.text(64)
                3 * 8 -> code = message.varint()
                4 * 8 + 2 -> codeName = message.text(64)
                else -> message.skip(key)
            }
        }
        return "$name ($number), $codeName (${code.toInt()})"
    }

    private fun thread(message: Proto): String = buildString {
        var frames = 0
        while (message.hasNext()) {
            val key = message.key()
            when (key) {
                2 * 8 + 2 -> appendLine("Имя потока: ${message.text(128)}")
                4 * 8 + 2 -> {
                    val value = message.message()
                    if (frames < MAX_FRAMES) appendLine("#${frames++} ${frame(value)}")
                }
                else -> message.skip(key)
            }
        }
    }

    private fun frame(message: Proto): String {
        var pc = 0L
        var function = ""
        var offset = 0L
        var library = ""
        var buildId = ""
        while (message.hasNext()) {
            val key = message.key()
            when (key) {
                1 * 8 -> pc = message.varint()
                4 * 8 + 2 -> function = message.text(512)
                5 * 8 -> offset = message.varint()
                6 * 8 + 2 -> library = message.text(1_024).substringAfterLast('/')
                8 * 8 + 2 -> buildId = message.text(128)
                else -> message.skip(key)
            }
        }
        return buildString {
            append("pc ${pc.toULong().toString(16).padStart(16, '0')} $library")
            if (function.isNotBlank()) append(" ($function+$offset)")
            if (buildId.isNotBlank()) append(" [BuildId: $buildId]")
        }
    }

    private class Proto(private val data: ByteArray, private var position: Int = 0, private val end: Int = data.size) {
        fun hasNext() = position < end
        fun key(): Int {
            val key = varint()
            require(key in 8L..Int.MAX_VALUE.toLong()) { "Повреждён тег нативного отчёта" }
            return key.toInt()
        }
        fun varint(): Long {
            var value = 0L
            for (index in 0..9) {
                require(position < end) { "Оборвано число нативного отчёта" }
                val byte = data[position++].toInt() and 255
                require(index < 9 || byte <= 1) { "Некорректное число нативного отчёта" }
                value = value or ((byte and 127).toLong() shl (index * 7))
                if ((byte and 128) == 0) return value
            }
            error("Некорректное число нативного отчёта")
        }
        fun message(): Proto {
            val size = varint()
            require(size >= 0 && size <= end - position) { "Оборвано поле нативного отчёта" }
            return Proto(data, position, position + size.toInt()).also { position += size.toInt() }
        }
        fun text(limit: Int): String {
            val value = message()
            return String(data, value.position, minOf(value.end - value.position, limit * 4), Charsets.UTF_8).take(limit)
        }
        fun skip(key: Int) {
            when (key and 7) {
                0 -> varint()
                1 -> advance(8)
                2 -> message()
                5 -> advance(4)
                else -> error("Неизвестный формат нативного отчёта")
            }
        }
        private fun advance(count: Int) {
            require(count <= end - position) { "Оборвано поле нативного отчёта" }
            position += count
        }
    }
}
