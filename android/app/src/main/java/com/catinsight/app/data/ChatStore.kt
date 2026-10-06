package com.catinsight.app.data

import androidx.compose.runtime.mutableStateListOf

/** 本機儲存 AI 對話(對應 iOS ChatStore)。每位使用者的對話只存在自己手機上。 */
object ChatStore {
    private const val KEY = "ai.chats.v1"
    val chats = mutableStateListOf<SavedChat>()

    fun load() {
        chats.clear()
        Prefs.getJson<List<SavedChat>>(KEY)?.sortedByDescending { it.date }?.let { chats.addAll(it) }
    }

    private fun persist() = Prefs.putJson(KEY, chats.toList())

    /** 新增或更新一段對話(以 id 為準),最新的排在最前。 */
    fun upsert(chat: SavedChat) {
        val idx = chats.indexOfFirst { it.id == chat.id }
        if (idx >= 0) chats[idx] = chat else chats.add(chat)
        val sorted = chats.sortedByDescending { it.date }
        chats.clear(); chats.addAll(sorted)
        persist()
    }

    fun delete(chat: SavedChat) { chats.removeAll { it.id == chat.id }; persist() }

    fun clearAll() { chats.clear(); persist() }
}
