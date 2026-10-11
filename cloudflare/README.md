# 💧 Waterball PTT 24H 雲端邊緣守護者 (Cloudflare Workers)

這是專為 **Waterball (水球 BBS)** 設計的個人專屬 24 小時 PTT 文章雲端追蹤服務。  
完全免費運行在 Cloudflare 全球邊緣網路上，電腦關機、休眠、外出也能在手機 Telegram 第一時間收到即時通報！

---

## ⚡ 2 分鐘極簡網頁部署教學（完全無需安裝任何工具）

### 步驟 1：建立 Cloudflare Worker
1. 登入 [Cloudflare 官網](https://dash.cloudflare.com/)（若無帳號可免費註冊）。
2. 在左側選單點選 **Workers & Pages** ➡️ **Create application** ➡️ **Create Worker**。
3. 名稱可自訂（例如 `waterball-tracker`），點擊 **Deploy**。
4. 部署後點擊 **Edit code**（編輯代碼）：
   - 清空預設代碼，將本專案的 [`cloudflare/worker.js`](worker.js) 內容**全部複製貼上**。
   - 點擊右上角 **Deploy** 儲存發布。

### 步驟 2：綁定免費 KV 資料庫（儲存規則與狀態）
1. 回到 Cloudflare 控制台，左側點選 **Workers & Pages** ➡️ **KV**。
2. 點擊 **Create namespace**，名稱輸入 `PTT_TRACKER_KV`，點擊 **Add**。
3. 回到您的 Worker 頁面，點選 **Settings** ➡️ **Variables**。
4. 滾動到 **KV Namespace Bindings** 區塊，點擊 **Add binding**：
   - Variable name（變數名稱）：填寫 `PTT_TRACKER_KV`
   - KV namespace：選擇剛才建立的 `PTT_TRACKER_KV`
5. 點擊 **Save and deploy**。

### 步驟 3：設定每 3 分鐘自動檢查排程 (Cron Trigger)
1. 在該 Worker 頁面點選 **Triggers**（觸發器）分頁。
2. 滾動到 **Cron Triggers**，點擊 **Add Cron Trigger**。
3. 輸入 `*/3 * * * *`（每 3 分鐘執行一次），點擊 **Save**。

### 步驟 4：在 Waterball 桌面端完成同步設定
1. 複製您的 Worker 網址（例如：`https://waterball-tracker.xxx.workers.dev`）。
2. 開啟 Waterball 桌面端，點擊工具列「📢 追蹤」按鈕（或按 `Alt+M`）。
3. 切換至 **「☁️ 雲端 24H 守護 (Cloudflare)」** 分頁：
   - 勾選 **「啟用 Cloudflare 雲端 24H 守護」**。
   - 貼上您的 **Worker 網址**。
   - 點擊「隨機產生金鑰」或輸入您自訂的密鑰。
   - 點擊 **「🔄 立即同步規則至雲端」**。
4. 完成！畫面顯示同步成功後，Cloudflare 雲端將 24 小時守護為您監測，有重大情報立即推播至您的手機 Telegram！
