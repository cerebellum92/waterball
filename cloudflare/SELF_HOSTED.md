# 自架看板推播

桌面版可連接自己的 Cloudflare Worker 與 Telegram Bot。公開庫提供 `cloudflare/self-hosted-worker.js`、獨立 Durable Object 設定與必要共用模組；不包含官方後端。

1. 建立自己的 Telegram Bot、Chat ID 與 Cloudflare 帳號。
2. 在 `cloudflare/wrangler.self-hosted.toml` 設定自己的 Worker 名稱，保留 `TRACKER` binding 與 SQLite migration。
3. 執行 `npx wrangler deploy --dry-run --config cloudflare/wrangler.self-hosted.toml`，檢查可獨立打包。
4. 透過 `npx wrangler secret put SYNC_SECRET --config cloudflare/wrangler.self-hosted.toml` 設定至少 32 字元的獨立同步密鑰；同樣設定 `BOT_TOKEN` secret。
5. 確認後自行執行 `npx wrangler deploy --config cloudflare/wrangler.self-hosted.toml`，並在桌面版進階設定填入自己的 Worker HTTPS URL、同步密鑰與 Chat ID。

單一 owner 使用，持有同步密鑰者可以管理設定。請勿共用密鑰。預設最多啟用 10 個看板，採 alarm 排程，無須官方服務、KV 或 Cron。`npm test` 包含假 PTT／Telegram 的自架測試，不會發送真實訊息。傳輸採至少一次交付，網路與儲存中斷時仍可能重送。
