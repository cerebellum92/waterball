# Waterball Cloudflare 邊緣爬蟲部署指南 (自架版)

本目錄提供 Waterball 專屬的開源 Cloudflare Worker 部署代碼，讓您可以將文章追蹤與 Telegram 爬蟲推播完全架設在您自己的 Cloudflare 帳號中。

## 獨立自架模式 (Self-Hosted)

- **核心檔案**：[`self-hosted-worker.js`](self-hosted-worker.js)
- **設定檔範本**：[`wrangler.self-hosted.toml`](wrangler.self-hosted.toml)
- **完整手把手架設指南**：請參閱 [**SELF_HOSTED.md**](SELF_HOSTED.md)

### 架構特色

1. **獨立自治**：使用您自己的 Telegram Bot Token 與 Chat ID，資料儲存於您自己 Cloudflare 的 SQLite Durable Object，絕不經過任何第三方或官方伺服器。
2. **精準排程**：透過 Cloudflare Worker Alarms 自動輪詢 PTT，符合安全退避與頻率限制規範。
3. **安全同步**：桌面客戶端可直接設定您的 Worker 網址與專屬 `SYNC_SECRET`，即時同步追蹤看板與推播規則。

詳細建立 Worker、綁定 Durable Object 與部署步驟，請見 [SELF_HOSTED.md](SELF_HOSTED.md)。
