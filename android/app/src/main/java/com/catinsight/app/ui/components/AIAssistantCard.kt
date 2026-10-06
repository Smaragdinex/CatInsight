package com.catinsight.app.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material.icons.filled.ChevronRight
import androidx.compose.material.icons.filled.Forum
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.catinsight.app.ui.LocalAppSettings
import com.catinsight.app.ui.theme.AppColors

/**
 * 對應 iOS AIChatView.swift 的 AIAssistantCard:
 * 詳情頁上的精簡入口卡:直接讓使用者問 AI(不產生簡報)。
 * 標題列(sparkles + 標題)、說明句、「問 AI 問題」按鈕。
 *
 * @param onAsk 按「問 AI 問題」時呼叫(股票代碼)→ 由外層切到「對話」分頁開新對話。
 */
@Composable
fun AIAssistantCard(symbol: String, onAsk: (String) -> Unit) {
    val s = LocalAppSettings.current
    val theme = s.theme
    val isZh = s.isZh

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(16.dp))
            .background(theme.cardBackground)
            .border(1.dp, theme.divider, RoundedCornerShape(16.dp))
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        // 標題列:sparkles(藍)+ AI 研究助理
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth()) {
            Icon(Icons.Filled.AutoAwesome, contentDescription = null, tint = AppColors.blue, modifier = Modifier.size(18.dp))
            Text(
                text = if (isZh) "AI 研究助理" else "AI Research Assistant",
                fontSize = 17.sp, fontWeight = FontWeight.SemiBold, color = theme.primaryText,
            )
            Spacer(Modifier.weight(1f))
        }

        // 說明句
        Text(
            text = if (isZh) "對 $symbol 有任何問題,直接問 AI。" else "Ask AI anything about $symbol.",
            fontSize = 15.sp, color = theme.secondaryText,
        )

        // 問 AI 問題(藍底白字,圓角 12)
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(12.dp))
                .background(AppColors.blue)
                .clickable { onAsk(symbol) }
                .padding(horizontal = 14.dp, vertical = 11.dp),
            horizontalArrangement = Arrangement.spacedBy(6.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(Icons.Filled.Forum, contentDescription = null, tint = Color.White, modifier = Modifier.size(18.dp))
            Text(
                text = if (isZh) "問 AI 問題" else "Ask AI a question",
                fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = Color.White,
            )
            Spacer(Modifier.weight(1f))
            Icon(Icons.Filled.ChevronRight, contentDescription = null, tint = Color.White, modifier = Modifier.size(14.dp))
        }
    }
}
