# Waterball 0.1.5 同步重繪修正移植說明

這份文件供 Ubuntu 上的 AI agent 將目前 macOS 測試中的顯示修正，移植到 **`v0.1.5` 原始碼**。這不是新版發布說明；移植時維持版本號 `0.1.5`，不要建立 tag、Release 或改動打包設定。

## 基準與範圍

- 基準：Git tag `v0.1.5`。
- 修改檔案：`src/ansi_parser.js`、`src/term_buf.js`。
- 不修改：Rust 網路接收與 Big5 解碼、鍵盤送出佇列、`●` 小白點清理、DBCS 字格處理、字型、`README.md`、版本號。
- 本機的 `README.md` 另有未提交修改，**不屬於這次修正**。

## 問題與處理方式

PTT 會送出 `CSI ? 2026 h`（開始同步更新）與 `CSI ? 2026 l`（結束同步更新）。收到整批資料之前可以暫緩重繪，但之前的嚴格等待曾造成長按「上」鍵時畫面停住，直到放開才跳到最新頁。另一個問題是連續捲動時，每筆資料都重新設定延遲重繪計時器，造成持續輸入期間無法刷新。

現在的做法是：

1. 同步更新開始後，仍立即、依序解析所有 ANSI 與文字到 `TermBuf`，只暫緩畫面更新。
2. 如果 80ms 內沒有收到結束碼，就先顯示目前的 buffer，但**不結束同步模式**；後續資料繼續正常更新。
3. 收到真正的 `?2026l` 後，標記全畫面為髒並安排重繪。
4. 重複收到 `?2026h` 不累加等待層數，也不重設既有計時器。
5. `queueUpdate()` 已有排定的重繪時直接保留它，不因後續的 `delayedUpdate` 而一直取消重排。這使連續捲動期間仍能刷新。

80ms 是**顯示等待上限**，不是網路請求延遲；它不阻擋資料解析，也不會截斷資料批次。

## 精確程式差異

以下是相對 `v0.1.5` 的完整顯示修正 diff，可供直接核對或手動套用：

```diff
diff --git a/src/ansi_parser.js b/src/ansi_parser.js
--- a/src/ansi_parser.js
+++ b/src/ansi_parser.js
@@ -261,11 +261,13 @@ export class AnsiParser {
               case 'h':
                 if (firstChar === '?') {
                   if (params[0] === 25) term.showCursor(true);
+                  if (params[0] === 2026) term.beginSynchronizedOutput();
                 }
                 break;
               case 'l':
                 if (firstChar === '?') {
                   if (params[0] === 25) term.showCursor(false);
+                  if (params[0] === 2026) term.endSynchronizedOutput();
                 }
                 break;
diff --git a/src/term_buf.js b/src/term_buf.js
--- a/src/term_buf.js
+++ b/src/term_buf.js
@@ -129,6 +129,10 @@ export class TermBuf {
     this.onUpdate = null;
     this.timerUpdate = null;
     this.delayedUpdate = false;
+    this.synchronizedOutputActive = false;
+    this.synchronizedOutputFallback = false;
+    this.synchronizedOutputTimer = null;
+    this.synchronizedOutputMaxWait = 80;
 
     // Dirty Rows tracking for high-efficiency differential rendering
     this.dirtyRows = new Uint8Array(rows);
@@ -159,15 +163,33 @@ export class TermBuf {
     this.dirtyRows.fill(0);
   }
 
-  queueUpdate() {
-    if (this.timerUpdate) {
-      if (this.delayedUpdate) {
-        clearTimeout(this.timerUpdate);
-        this.timerUpdate = null;
-      } else {
-        return;
-      }
+  beginSynchronizedOutput() {
+    if (this.synchronizedOutputActive) return;
+    this.synchronizedOutputActive = true;
+    this.synchronizedOutputTimer = setTimeout(() => {
+      this.synchronizedOutputTimer = null;
+      this.synchronizedOutputFallback = true;
+      this.markAllDirty();
+      this.queueUpdate();
+    }, this.synchronizedOutputMaxWait);
+  }
+
+  endSynchronizedOutput() {
+    if (!this.synchronizedOutputActive) return;
+    this.synchronizedOutputActive = false;
+    this.synchronizedOutputFallback = false;
+    if (this.synchronizedOutputTimer) {
+      clearTimeout(this.synchronizedOutputTimer);
+      this.synchronizedOutputTimer = null;
     }
+    this.markAllDirty();
+    this.delayedUpdate = false;
+    this.queueUpdate();
+  }
+
+  queueUpdate() {
+    if (this.synchronizedOutputActive && !this.synchronizedOutputFallback) return;
+    if (this.timerUpdate) return;
     const delay = this.delayedUpdate ? 80 : 16;
     this.timerUpdate = setTimeout(() => {
       this.timerUpdate = null;
```

## Ubuntu 驗證

在 `bbsterm` 目錄執行：

```bash
npm run build
npm run tauri dev
```

連上 PTT 後，分別測試長按「上」鍵、長按 `PageUp`、在彩色 ANSI 圖與使用者列表之間切換。確認持續按鍵時畫面會持續刷新；停下時不會等很久才跳到最終畫面；留意標題、文章編號及使用者列表是否出現跨頁殘留。macOS 上這組修改經長時間手動測試暫未再重現問題，但不代表已證明所有殘留的根因，Linux 仍需獨立驗證。

若 Linux 分支與 `v0.1.5` 有其他修改，請只移植上述兩檔的對應邏輯，不覆蓋當地未提交的變更。
