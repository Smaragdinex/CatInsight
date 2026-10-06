# 全球排行榜 API

Cloudflare Workers + D1(SQLite)。免費額度:每天 10 萬次請求、D1 每天 500 萬次讀取,排行榜用不到 1%。

## 第一次部署(需要登入 Cloudflare 帳號,只有你能做)
```bash
cd worker
npx wrangler login                      # 會開瀏覽器,用你的 Cloudflare 帳號授權
npx wrangler d1 create catstreet-board  # 建資料庫,把印出來的 database_id 貼進 wrangler.toml
npx wrangler d1 execute catstreet-board --remote --file=schema.sql   # 建表
npx wrangler deploy                     # 上線,掛在 https://your-domain.com/api/board/
```
之後改程式只要再 `npx wrangler deploy`。

## 測試
```bash
curl https://your-domain.com/api/board/top
```
