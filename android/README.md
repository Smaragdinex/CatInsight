# CatInsight Stock — Android 版

iOS 版(`ios/`,SwiftUI)一比一移植到 Kotlin + Jetpack Compose。
後端用 `backend/`(和 iOS 版共用同一個 API),網址在 `data/StockApiService.kt` 設定。

## 開發環境
- Android Studio 2026.1,AGP 8.13.2,Gradle 8.13,Kotlin 2.0.21,Compose BOM 2024.09.00
- minSdk 26(Android 8),targetSdk / compileSdk 36
- 命令列編譯要用 JDK 21(系統預設 JDK 23 不相容 Gradle 8.13):
  `JAVA_HOME=/Library/Java/JavaVirtualMachines/jdk-21.jdk/Contents/Home ./gradlew :app:assembleDebug`
- 模擬器:`Medium_Phone_API_36.1`

## 程式結構(package `com.catinsight.app`)
| 路徑 | 對應 iOS |
|---|---|
| `data/Models.kt` | Models.swift(所有 API 回應) |
| `data/StockApiService.kt` | StockAPIService.swift(OkHttp + kotlinx.serialization) |
| `data/WatchlistStore.kt` / `ChatStore.kt` / `AlertCenter.kt` | 自選清單 / 對話紀錄 / 價格提醒(SharedPreferences) |
| `DashboardViewModel.kt` | DashboardViewModel.swift + ContentView 的首頁狀態 |
| `ui/AppRoot.kt` | ContentView 外殼:搜尋/自選/個股/對話 四模式 + 底部列 + 兩個 bottom sheet |
| `ui/theme/` | AppTheme / AppLanguage / MarketColorMode / CopySet 文案 |
| `ui/screens/SearchScreen.kt` | 搜尋列、AI 精選排名、漲幅榜(1Y/YTD)、市場指標 |
| `ui/screens/WatchlistScreen.kt` | 自選清單(滑動刪除、長按排序、分析) |
| `ui/screens/DetailScreen.kt` + `detail/` | 個股頁:摘要、K線/折線(Canvas)、指標、歷史、新聞、評等、財報 |
| `ui/components/` | AIAssistantCard、ValuationCard、MiniSparkline、PulseDot |
| `ui/screens/ConversationsScreen.kt` | AI 對話 + 歷史側欄 |
| `ui/sheets/` | 價格提醒面板、設定面板 |

## 尚未做的事
- 正式簽章(release keystore)與 Google Play 上架設定
- App icon 目前是暫用向量圖,要換成跟 iOS 一樣的圖
