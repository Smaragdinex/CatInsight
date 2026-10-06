package com.catinsight.app

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import com.catinsight.app.data.AlertCenter
import com.catinsight.app.data.ChatStore
import com.catinsight.app.data.Prefs
import com.catinsight.app.data.WatchlistStore
import com.catinsight.app.ui.AppRoot
import com.catinsight.app.ui.theme.AppSettings

class MainActivity : ComponentActivity() {
    private val vm: DashboardViewModel by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        Prefs.init(this)
        WatchlistStore.load()
        ChatStore.load()
        AlertCenter.init(this)
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        val settings = AppSettings()
        // 測試鉤子(只在 DEBUG 生效):adb 帶 intent extras 直接開語音對話並把 AUTO_VOICE_TEXT 當使用者說的話送出
        val autoOpenSymbol = if (BuildConfig.DEBUG) intent?.getStringExtra("AUTO_OPEN_SYMBOL") else null
        val autoVoiceText = if (BuildConfig.DEBUG) intent?.getStringExtra("AUTO_VOICE_TEXT") else null
        setContent {
            AppRoot(settings = settings, vm = vm, autoOpenSymbol = autoOpenSymbol, autoVoiceText = autoVoiceText)
        }
    }
}
