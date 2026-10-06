package com.catinsight.app.data

import androidx.compose.runtime.mutableStateListOf

/** 對應 iOS ContentView 內的 watchlist @State + UserDefaults("watchlist.items")。 */
object WatchlistStore {
    private const val KEY = "watchlist.items"
    val items = mutableStateListOf<WatchlistItem>()

    fun load() {
        items.clear()
        Prefs.getJson<List<WatchlistItem>>(KEY)?.let { items.addAll(it) }
    }

    private fun persist() = Prefs.putJson(KEY, items.toList())

    val symbols: List<String> get() = items.map { it.symbol }

    fun contains(symbol: String) = items.any { it.symbol == symbol }

    fun add(item: WatchlistItem) { if (!contains(item.symbol)) { items.add(item); persist() } }

    fun remove(symbol: String) { items.removeAll { it.symbol == symbol }; persist() }

    fun move(from: Int, to: Int) {
        if (from == to || from !in items.indices || to !in items.indices) return
        val it = items.removeAt(from); items.add(to, it); persist()
    }
}
