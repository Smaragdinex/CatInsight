# CatInsight Stock — AI 智慧股票分析與互動系統

CatInsight Stock 是一套結合機器學習與生成式 AI 的股票分析系統,包含三個部分:

- **手機 App**(iOS / Android):AI 精選排行、個股分析、AI 對話與語音助理、價格與技術指標警示
- **後端**(Python / FastAPI):行情與財報資料、每日 AI 選股排名、本機大型語言模型、語音合成、推播
- **網頁版**:3D 房間,以及練習投資觀念的「貓咪股市大富翁」遊戲(含三種難度的電腦對手和神經網路實驗)

完整的系統架構(7 張 UML 圖 + 1 張 ER 圖)在 [`docs/architecture.html`](docs/architecture.html),下載後用瀏覽器開啟。

## 資料夾

| 資料夾 | 內容 |
|---|---|
| `ios/` | iOS App,Swift · SwiftUI,沒有使用第三方套件 |
| `android/` | Android App,Kotlin · Jetpack Compose(依 iOS 版逐項功能移植) |
| `backend/` | FastAPI 主服務、AI 精選排名模型(XGBoost LambdaMART)、每日排程、推播、語音服務 |
| `game/web/` | 網頁版:3D 房間(`catinsight-3d/`)和大富翁遊戲(`catinsight-3d/board/`),Three.js,純 JavaScript 模組 |
| `game/worker/` | 遊戲的全球排行榜(Cloudflare Workers + D1)和多人連線房間(Durable Objects) |
| `game/tools/` | 電腦對手對戰工具、神經網路訓練(`nn/`)、實驗紀錄(`tournament-results.txt`) |
| `docs/` | 系統架構文件 |

## 怎麼執行

### 網頁版遊戲

```bash
cd game/web
python3 -m http.server 8000
# 打開 http://localhost:8000/catinsight-3d/board/
```

單機遊玩不需要後端。全球排行榜和多人連線要把 `game/worker/` 部署到 Cloudflare,並掛在遊戲網頁同一個網域的 `/api/board` 底下(見 `game/worker/README.md`)。

### 電腦對手對戰與神經網路實驗

```bash
cd game
node tools/tournament.mjs 100 20 120 3 lead "rule,ev,mc"   # 規則式 / 期望值 / 蒙地卡羅三方對戰 100 局
tools/ladder.sh 14 40 "rule,ev,mc"                         # 14 個行程平行,共 560 局
```

神經網路(需要 Python + PyTorch):

```bash
node tools/nn/gen-data.mjs 350 1 tools/nn/data/gen0/part1.bin   # 產生訓練資料
python3 tools/nn/train_az.py tools/nn/data/gen0                 # 訓練策略網路 + 價值網路
tools/nn/selfplay-loop.sh                                       # 多代自我對弈(多層 MCTS + 新舊網路對打才採用)
```

所有實驗結果和結論記錄在 `game/tools/tournament-results.txt`。

### 後端

```bash
cd backend
pip install -r requirements.txt
cp .env.example .env            # 填入自己的 API 金鑰(財報資料、即時報價、推播憑證)
python3 scripts/fetch_history_10y.py      # 下載十年日線(資料很大,沒有放進 repo)
python3 scripts/train_ranker_xgb.py       # 訓練 AI 精選排名模型
uvicorn main:app --port 8003
```

- 排程:`scripts/daily_ranking.sh` 每天美股收盤後更新股價、重算排名;`scripts/weekly_fundamentals.sh` 每週更新財報、季報、年報和分析師評等
- 股價歷史、財報快取、訓練好的模型檔都沒有放進 repo,用 `scripts/` 裡的腳本重新產生;`models/*.meta.json` 保留了每個模型的訓練設定和評估指標。
- 大型語言模型用本機的 Ollama(預設 `gemma4:31b`),語音合成服務是 `tts_server.py`。

### App

- iOS:用 Xcode 開 `ios/MyStockApp.xcodeproj`
- Android:用 Android Studio 開 `android/`
- 後端網址在 `ios/MyStockApp/StockAPIService.swift`、`ios/MyStockApp/ContentView.swift` 和 `android/app/src/main/java/com/catinsight/app/data/StockApiService.kt`,目前是 `https://api.example.com`,部署時改成自己的後端網址

## 用到的技術

| 部分 | 技術 |
|---|---|
| 機器學習選股 | XGBoost LambdaMART 排序學習,124 個特徵,5 折時間序列交叉驗證(NDCG@10 0.539) |
| 生成式 AI | 本機 Ollama 大型語言模型;Kokoro-82M、CosyVoice2-0.5B 語音合成 |
| 遊戲電腦對手 | 規則式、期望值、蒙地卡羅模擬(配對比較 + 顯著性門檻);不偷看對手持股,只用公開帳本推測 |
| 神經網路實驗 | 策略網路 + 價值網路(PyTorch 訓練、純 JavaScript 推論)、多層 open-loop MCTS、多代自我對弈 |
| 網頁 | Three.js、Web Worker、Web Audio、Cloudflare Workers / D1 / Durable Objects |
