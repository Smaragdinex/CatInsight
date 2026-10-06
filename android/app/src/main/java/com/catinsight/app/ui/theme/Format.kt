package com.catinsight.app.ui.theme

import java.util.Locale
import kotlin.math.abs

/** 共用數字格式(對應 ContentView 內的 formatted* 函式)。畫面專屬的格式化可自行加在該畫面。 */
object Fmt {
    fun number(v: Double?): String = v?.let { String.format(Locale.US, "%.2f", it) } ?: "-"
    fun currency(v: Double?): String = v?.let { "$" + String.format(Locale.US, "%.2f", it) } ?: "-"
    fun percent(v: Double?, digits: Int = 2): String = v?.let { String.format(Locale.US, "%.${digits}f%%", it) } ?: "-"
    fun signedPercent(v: Double?, digits: Int = 2): String = v?.let { String.format(Locale.US, "%+.${digits}f%%", it) } ?: "-"
    fun changeText(change: Double, percent: Double): String =
        String.format(Locale.US, "%+.2f (%+.2f%%)", change, percent)

    /** 列表價格:>=1000 不留小數,否則兩位。 */
    fun listPrice(v: Double?): String = when {
        v == null -> "-"
        abs(v) >= 1000 -> String.format(Locale.US, "%,.0f", v)
        else -> String.format(Locale.US, "%.2f", v)
    }

    /** 市值:T / B / M。 */
    fun marketCap(v: Double?): String {
        if (v == null || v <= 0) return "-"
        return when {
            v >= 1e12 -> String.format(Locale.US, "%.2fT", v / 1e12)
            v >= 1e9 -> String.format(Locale.US, "%.2fB", v / 1e9)
            v >= 1e6 -> String.format(Locale.US, "%.2fM", v / 1e6)
            else -> String.format(Locale.US, "%,.0f", v)
        }
    }

    /** 緊湊數字:1.2K / 3.4M / 5.6B。 */
    fun compact(v: Double?): String {
        if (v == null) return "-"
        val a = abs(v)
        return when {
            a >= 1e9 -> String.format(Locale.US, "%.1fB", v / 1e9)
            a >= 1e6 -> String.format(Locale.US, "%.1fM", v / 1e6)
            a >= 1e3 -> String.format(Locale.US, "%.1fK", v / 1e3)
            else -> String.format(Locale.US, "%.2f", v)
        }
    }
}
