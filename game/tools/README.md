# tools

- `tournament.mjs` — 讓三種電腦對手(rule 規則式 / ev 期望值 / mc 蒙地卡羅)在 `sim.mjs` 裡互打,算勝率和平均資產。
  `node tools/tournament.mjs [局數] [回合] [mc 模擬次數] [mc 深度] [評分 lead|own|mix] ["ev,mc;rule,ev,mc"]`
  `SLIP=0` 切回舊規則(先用舊價成交再推價)做對照。
- `sweep-ev.mjs` / `eval-ev.mjs` — 掃期望值策略的參數(和規則式對打)。
- `bench.mjs` — 量一次蒙地卡羅決策要幾毫秒。
- `tournament-results.txt` — 最近一次 100 局的結果。
- `checksum.mjs` — 重構驗證:固定種子跑幾局,印出資產 / 現金 / 股價總和,改規則前後必須完全一樣。
- `refactor-equiv.mjs` — 回合流程搬進遊戲引擎時,舊版規則 vs engine.mjs 的隨機對照測試(55,500 次比對)。
