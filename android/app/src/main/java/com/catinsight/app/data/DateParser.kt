package com.catinsight.app.data

import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

/** 對應 iOS StockDateParser:依序嘗試 ISO8601、yyyy-MM-dd HH:mm:ssZ、無時區、到分、只有日期。 */
object StockDateParser {
    private fun fmt(pattern: String, utc: Boolean = false) = SimpleDateFormat(pattern, Locale.US).apply {
        isLenient = false
        if (utc) timeZone = TimeZone.getTimeZone("UTC")
    }

    fun parse(raw: String): Date? {
        if (raw.isBlank()) return null
        val iso = raw.replace(Regex("Z$"), "+0000").replace(Regex("([+-]\\d{2}):(\\d{2})$"), "$1$2")
        for (p in listOf("yyyy-MM-dd'T'HH:mm:ss.SSSZ", "yyyy-MM-dd'T'HH:mm:ssZ")) {
            runCatching { fmt(p).parse(iso) }.getOrNull()?.let { return it }
        }
        val normalized = iso.replace("T", " ")
        for (p in listOf("yyyy-MM-dd HH:mm:ssZ", "yyyy-MM-dd HH:mm:ss", "yyyy-MM-dd HH:mm")) {
            runCatching { fmt(p).parse(normalized) }.getOrNull()?.let { return it }
        }
        val dateOnly = raw.take(10)
        return runCatching { fmt("yyyy-MM-dd").parse(dateOnly) }.getOrNull()
    }
}
