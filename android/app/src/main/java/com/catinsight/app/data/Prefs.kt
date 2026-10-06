package com.catinsight.app.data

import android.content.Context
import android.content.SharedPreferences
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

/** 對應 iOS UserDefaults + Codable 的簡易封裝。App 啟動時先呼叫 init(context)。 */
object Prefs {
    private lateinit var sp: SharedPreferences
    val json = Json { ignoreUnknownKeys = true; encodeDefaults = true; explicitNulls = false }

    fun init(context: Context) {
        if (!::sp.isInitialized) sp = context.applicationContext.getSharedPreferences("catinsight", Context.MODE_PRIVATE)
    }

    fun getString(key: String, default: String): String = sp.getString(key, default) ?: default
    fun putString(key: String, value: String) = sp.edit().putString(key, value).apply()
    fun getBoolean(key: String, default: Boolean): Boolean = sp.getBoolean(key, default)
    fun putBoolean(key: String, value: Boolean) = sp.edit().putBoolean(key, value).apply()

    inline fun <reified T> getJson(key: String): T? {
        val raw = getString(key, "")
        if (raw.isEmpty()) return null
        return runCatching { json.decodeFromString<T>(raw) }.getOrNull()
    }

    inline fun <reified T> putJson(key: String, value: T) = putString(key, json.encodeToString(value))
}
