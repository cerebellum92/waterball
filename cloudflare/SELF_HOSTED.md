# 獨立自架 Cloudflare 推播

此部署使用您自己的 Worker、SQLite-backed Durable Object、同步密鑰和 Telegram Bot，**不連官方 Waterball 伺服器、不兌換官方 WB2、不使用官方 Bot Token**。官方代理檔是 `worker.js`；自架入口是 `self-hosted-worker.js`，兩者不可混用。共用檔只有純解析及 HTTP 大小限制工具。

## 建置與設定

1. 用自己的 BotFather 建立 Bot，先向自己的 Bot 按 Start，取得自己的數字 Chat ID。
2. 在專案根目錄執行 `npm run build:workers`；產生 `cloudflare/dist/self-hosted-worker.js` 單檔 bundle，可供檢視或編輯器部署。來源版由 Wrangler 自動打包。
3. 使用自己的 Cloudflare 帳號，配置 `cloudflare/wrangler.self-hosted.toml` 中的獨立 Worker 名稱及 `TRACKER` binding。**必須建立 SQLite Durable Object migration**；只貼 JavaScript、沒有 binding，不會運作。
4. 以 Wrangler secrets 設定 `SYNC_SECRET`（至少 32 字元，建議用 App 的骰子按鈕產生 64 位 hex）及自己的 `BOT_TOKEN`。每個部署使用不同密鑰，不重用官方裝置 Token。

```sh
npx wrangler secret put SYNC_SECRET --config cloudflare/wrangler.self-hosted.toml
npx wrangler secret put BOT_TOKEN --config cloudflare/wrangler.self-hosted.toml
npx wrangler deploy --config cloudflare/wrangler.self-hosted.toml
```

上述命令是自行部署操作，本次修正沒有執行它們。`BOT_TOKEN` 也可從 App 進階欄位提供；會保存在自己的 Durable Object，查詢 API 不回傳。同步密鑰只放在環境 secret，不保存在設定回應。

5. App 進階設定填自己的 Worker HTTPS 網址、相同 `SYNC_SECRET`、自己的數字 Chat ID。個人 Bot Token 若已設於 Worker secret，可留空。按「儲存並同步」會明確啟用；取消勾選會獨立暫停。

自架版由 alarm 自行排程，**不需要 Cron Trigger、PTT_TRACKER_KV、BACKEND_URL、官方 webhook 或官方配對碼**。設定 `BACKEND_URL` 不會把自架流量轉到官方服務。

## 行為與限制

- 單一 owner：持有 `SYNC_SECRET` 就能管理此部署，不提供多租戶共用與官方 Freemium 權益。
- 自架沒有官方 30 天租約；是否保留自己的服務由 owner 決定。`pause` 停止 alarm／待送文章；`resume` 建立新基準線，不補發暫停期間文章。
- 預設最多 10 個啟用看板、100 條生效規則；本地未啟用備用規則不送至雲端。環境上限可設至 50 板，但目前 App 勾選介面仍維持 10 板，且大量看板須另評估自己的平台用量。
- 自適應目標 3／6／15／30 分鐘；同板新輪首頁開始至少 180 秒，全域 HTTP 間隔 1.2～2.2 秒。排隊、WAF 冷卻及平台 alarm 延遲可能加長通知時間。
- 每輪回溯最多 5 個總頁面；未找到重疊邊界會保存續抓位置及原 cursor。回溯緩衝最多 1000 篇，達限保留游標並顯示錯誤，不偷偷跳過缺口。
- 推數候選最多 100 篇、24 小時有效；超量汰除最舊候選。每輪補查最多 2 篇離開首頁的候選，不承諾每篇文章都有相同的推數觀測延遲。
- 待送最多 500 筆、TTL 30 分鐘、最多 5 次實際發送嘗試；滿載會保留文章分發進度，容量釋放後續送。429 的期限由收到回應後計算。
- 所有出站 HTTP 包含 body 都有 10 秒 deadline；不跟隨重新導向。403／429／challenge 使 PTT 全域冷卻 15 分鐘。Telegram 403 會暫停，修好 Bot 後須明確恢復。
- SQLite 單一設定快照限制 1.5 MiB，低於 SQLite-backed DO 的每個 key/value 2 MB 限制；容量或交易失敗回 503，設定不假回成功。[Cloudflare 儲存限制](https://developers.cloudflare.com/durable-objects/platform/limits/)
- 採 at-least-once 交付：Telegram 已接受但儲存結果前中斷，仍可能重送；不宣稱 exactly-once。

SQLite Durable Object 提供交易與 alarm；alarm 自身可能重試或延遲，因此程式仍保留 cooldown、epoch、去重與有界重試。免費方案的 SQLite DO 可用性及額度以您的帳號與平台文件為準，不承諾無限制免費。[儲存 API](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/)、[alarm](https://developers.cloudflare.com/durable-objects/api/alarms/)

## 驗證

```sh
npm test
npm run build:workers
npx wrangler deploy --dry-run --config cloudflare/wrangler.self-hosted.toml
```

另提供 `scripts/verify-worker-runtime.mjs`，在 Miniflare／workerd 真正的 SQLite 與 alarm 執行環境驗證。可在暫存目錄安裝 Wrangler，設定 `WATERBALL_MINIFLARE_MODULE` 指向其 Miniflare module 後執行；所有出站流量由測試假的 PTT／Telegram 回應攔截，不聯絡正式服務。

舊的純 KV worker 不再當成可靠的備用節點。遷移時停用舊 Cron，建立此獨立 namespace，再從 App 同步生效規則；重新建立基準線，勿將官方 Token 或舊 KV 密鑰默默當成官方配對授權。
