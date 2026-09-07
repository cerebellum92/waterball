# Waterball（bbsterm）總體審查與修復計畫

本文件記錄 Waterball 的程式審查結果，涵蓋嚴重 bug、資安、跨平台、快捷鍵、效能、模組化，以及後續可交給子代理執行的任務。

## 一、總結

目前架構方向正確：Rust 負責 Telnet/SSH 與背景工作，JavaScript 負責終端畫面、多分頁與工具 UI。主要風險集中在：

1. 全域快捷鍵把作業系統快捷鍵與 BBS 控制字元混在一起。
2. 書籤密碼的 AES 金鑰與密文都放在 `localStorage`。
3. JavaScript 與 Rust 同時執行 keep-alive。
4. ANSI/DBCS 狀態處理及匯出功能有明確 bug。
5. `main.js` 過大，且存在未使用的舊渲染引擎。

建議先修 P0，再處理快捷鍵與 ANSI parser，最後才做大型重構和效能優化。

## 二、P0 嚴重問題

### 1. 匯出功能讀取錯誤欄位

位置：`src/exporter.js:43`、`src/exporter.js:83`

`TermChar` 的欄位是 `fg`、`bg`、`bright`、`blink`，但 exporter 讀取不存在的 `cell.attr.fg`、`cell.attr.bg`、`cell.attr.bold`。因此 ANSI/HTML 匯出會遺失顏色與亮度。

修正方式：統一使用 `cell.fg`、`cell.bg`、`cell.bright`、`cell.blink`，並加入彩色匯出測試。

### 2. 調色盤的 Ctrl+C 按鈕可能取消文章

位置：`src/palette.js:77`、`src/palette.js:184`

按鈕會送出 `\\x03`。在許多 BBS 編輯器中，Ctrl+C 代表取消目前文章或信件，誤觸可能導致內容遺失。

修正方式：移除這個按鈕；若保留，必須顯示明確警告並要求確認。

### 3. JavaScript 與 Rust 重複送 keep-alive

位置：`src/settings.js:209`、`src-tauri/src/lib.rs:170`

前端會送 NUL，Rust 背景 thread 也會送 NUL 或 Telnet NOP。兩套計時器可能讓站台收到多餘控制字元，甚至把它當成使用者輸入。

修正方式：保留 Rust 原生背景 keep-alive，刪除 JavaScript 的定時送出邏輯。`recordActivity()` 可以保留，但只能用來通知 Rust 或記錄 UI 活動。

## 三、書籤密碼保護

### 目前問題

位置：`src/crypto.js:3-22`

目前的隨機 seed 與加密後密文都放在 `localStorage`。因此任何能讀取該 WebView 儲存區的人，都能取得 seed 並解密帳密。AES-GCM 本身沒有問題，問題是金鑰保存位置。

這不代表密碼會透過網路明文傳送，而是代表「本機儲存區被讀取」時無法提供額外防護。README 中的安全描述應避免讓使用者誤以為這是 OS 級別的金鑰保護。

### 方案比較

| 方案 | 跨平台 | 使用者摩擦 | 防護能力 | 建議 |
|---|---:|---:|---:|---|
| OS Keyring | macOS/Windows 強，Linux 需處理 Secret Service | 低 | 高 | 可作第二階段 |
| 使用者主密碼 | 高 | 高 | 很高 | 適合高安全模式 |
| 原生設定檔 + 權限限制 | 高 | 低 | 中 | 可作 fallback |
| Non-extractable Web Crypto key | 高 | 低 | 中 | 第一階段採用 |
| 方案 D + 方案 C | 中 | 低 | 中高 | 長期建議 |

### 第一階段：方案 D（目前延後）

目前不採用方案 D。專案暫時保留可跨重啟、相容性較高的 `localStorage seed + enc:v1` 流程。原因是單獨使用不可匯出的程序內 key 無法在 WebView 重啟後解開 wrapped seed；若要正式採用，必須先完成方案 C 或其他持久化 key 來源。

使用 Web Crypto 產生不可匯出的 AES-GCM key：

```js
const masterKey = await crypto.subtle.generateKey(
  { name: 'AES-GCM', length: 256 },
  false,
  ['encrypt', 'decrypt']
);
```

設計如下：

1. 產生 32 bytes 隨機 seed。
2. 用不可匯出的 `masterKey` 包裝 seed。
3. 只把包裝後的 seed、IV、版本存入 `localStorage`。
4. 再以 seed 經 PBKDF2 派生書籤密碼使用的 AES-GCM key。
5. 保持 `encryptSecret()` 與 `decryptSecret()` 的公開介面不變。

重要限制：不可匯出的 Web Crypto key 只存在目前 WebView 程序中。程序重啟後 key 會消失，因此「只把 masterKey 放記憶體」無法讓應用程式重開後解密舊資料。方案 D 必須搭配下列其中一種持久化方式，不能單獨宣稱已解決重啟問題：

- 每次重啟重新產生 key 並重新包裝 seed，但第一次重啟時仍需要有可解開的 seed 來源。
- 將包裝用的 key 存在原生安全儲存區。
- 將方案 D 作為程序內層保護，方案 C 作為跨重啟的外層保護。

因此本專案建議：**第一階段先重構 crypto API 與版本格式，採用方案 D 作為程序內保護；第二階段加入方案 C，確保跨重啟可用。** 不應實作一個每次重啟都必然遺失 seed 的版本。

資料格式建議：

```text
enc:v2:<key-id>:<iv-base64>:<ciphertext-base64>
seed:v2:<iv-base64>:<wrapped-seed-base64>
```

舊版 `enc:v1:` 資料要能讀取並在成功解密後重新寫成 v2。若 seed 或密文無法解密，不能靜默退回明文；應顯示「書籤密碼需要重新輸入」並保留非密碼設定。

### 第二階段：方案 C（原生設定檔與裝置綁定）

方案 C 的目標是讓 seed 不再直接暴露於 `localStorage`，並在不要求使用者主密碼的情況下支援跨重啟。

建議優先順序：

1. macOS：使用 Keychain 或受限的應用程式資料檔案。
2. Windows：使用 Credential Manager 或 DPAPI；不要自行依賴可變的硬體序號。
3. Linux：優先使用 Secret Service（GNOME Keyring/KWallet）；若不存在，使用 XDG config 下的權限 600 檔案，並明確標示為較弱 fallback。

不要把 machine-id 當成秘密。machine-id 通常可被本機程式讀取，適合做裝置綁定或額外 salt，不適合單獨當作金鑰。

Rust 端可提供抽象命令，而不是把平台判斷散落在 JavaScript：

```text
secure_store_get(name) -> bytes | not_found
secure_store_set(name, bytes)
secure_store_delete(name)
secure_store_backend() -> keychain | secret-service | protected-file
```

JavaScript 只呼叫抽象 API。若 secure store 不可用，UI 應讓使用者選擇：使用主密碼模式、使用受限檔案 fallback，或不保存密碼。不要自動把密碼退回明文。

### 密碼方案的恢復策略

主密碼不應讓「整個程式打不開」。正確行為是：

- 程式可以正常啟動。
- 需要自動登入時才要求解鎖。
- 忘記主密碼時，使用者可以刪除已保存的密碼並重新輸入。
- 書籤名稱、地址、編碼等非秘密資料仍然保留。

這是「密碼保管庫被重置」，不是「應用程式無法啟動」。

## 四、跨平台快捷鍵

位置：`src/main.js:1284-1593`、`src/settings.js:52`

目前 `mapCommandToCtrl` 預設為 true，會把 `e.ctrlKey || e.metaKey` 都當成 BBS Ctrl 控制鍵。這會造成：

- macOS 的 Cmd+T、Cmd+W、Cmd+D 可能被送成 BBS 控制字元。
- Windows/Linux 的 Ctrl+T、Ctrl+W、Ctrl+R、Ctrl+X 與使用者熟悉的視窗或剪貼簿快捷鍵衝突。
- BBS 編輯器的 Ctrl+X、Ctrl+W 等本來就可能有破壞性功能。

建議：

1. 視窗功能與 BBS 輸入功能使用不同判斷路徑。
2. Cmd+T/W/1..9 只在 macOS 的 Meta 組合處理。
3. Ctrl+A..Z 預設交給 BBS；不要把 Ctrl+C 視為複製，除非目前有終端選取。
4. 在輸入框、搜尋框、設定視窗、IME composition 中，禁止全域 BBS keymap 攔截。
5. 將快捷鍵設計成可設定，而不是用 `mapCommandToCtrl` 一個布林值涵蓋所有平台。
6. README 和 UI 顯示目前平台實際快捷鍵，不要所有平台都顯示 Cmd。

建議資料結構：

```js
const shortcuts = {
  newTab: { meta: 'KeyT' },
  closeTab: { meta: 'KeyW' },
  search: { meta: 'KeyF', ctrl: 'KeyF' },
  commandPalette: { meta: 'KeyK', ctrl: 'Alt+KeyK' },
};
```

## 五、ANSI、DBCS 與匯入匯出

### ANSI parser

- `src/ansi_parser.js:38` 的 CSI 終止字元判斷應使用 `@` 到 `~` 的完整範圍。
- `STATE_C1` 對未知 ESC 序列的狀態清除邏輯需重寫，避免跨 packet 後錯位。
- `src/term_buf.js:546` 尚未支援 `38;5;n`、`38;2;r;g;b`、背景色對應格式。

### DBCS 清除

`clear(2)` 與 `eraseLine(2)` 直接 `copyFrom()`，可能留下 lead/trail byte 配對狀態。清除 DBCS cell 時應統一呼叫 `clearCellAt()`。

### Paste

`src/main.js:425` 將標準 `ESC[` 轉成 `\\x15[`，這是特定 BBS 的色彩協定，不應對所有站台套用。應改成站台或書籤設定，預設使用標準 ANSI。

## 六、效能與結構

### 效能

- `term_view.js` 每次 dirty row 都重新做作者 regex 與 URL regex，應加入 row metadata cache。
- `term_buf.js` 用 `Array.splice` 搬動整列，長期可改成 ring buffer。
- 搜尋每次輸入都掃完整個畫面，可用 requestAnimationFrame debounce。
- `scheduleNotificationScrape()` 會定時掃描完整畫面，應只掃描可能變動的底部列。

### 模組

- `src/bbs_engine.js` 的 `CleanBBSEngine` 未被引用，是舊渲染引擎；確認無外部使用後可移除。
- `src/bbscore.js`、`src/bbsview.js` 為空檔，可移除或明確作為 compatibility entrypoint。
- `main.js` 約 1,683 行，建議拆成 `keymap.js`、`ime_controller.js`、`connection_controller.js`、`focus_manager.js`、`bookmarks_ui.js`。
- `portable-pty` 若確認未使用，可從 Cargo dependencies 移除。

## 七、修復順序

### Phase 0：先修 P0

1. 修正 exporter 欄位。
2. 移除或保護 Ctrl+C 調色盤按鈕。
3. 保留 Rust keep-alive，移除 JavaScript 重複 keep-alive。
4. 暫緩 crypto.js v2 migration；目前保留 `enc:v1`，避免在沒有持久化 key 來源時造成跨重啟失效。
5. 更新 README 的安全說明，避免誇大方案 D 的保護能力。

### Phase 1：修平台與輸入

1. 重做快捷鍵分層。
2. 修正 paste 的站台色彩協定。
3. 修正 ANSI FSM、CSI 終止字元、DBCS 清除。
4. 加入通知與剪貼簿的原生 fallback。

### Phase 2：導入方案 C

1. 建立 Rust secure-store abstraction（目前暫緩，待明確決定 Linux fallback 與資料遷移策略）。
2. macOS/Windows 先接 OS secure store。
3. Linux 接 Secret Service，失敗時提供受限檔案或主密碼選項。
4. JavaScript 對所有平台只呼叫抽象 API。
5. 完成 v1 到 v2 migration，測試升級、降級失敗、備份還原與 secure store 不可用。

### Phase 3：重構與效能

1. 拆 `main.js`。
2. 加 row metadata cache。
3. 改 ring buffer 前先寫 TermBuf 行為測試。
4. 最後移除死代碼與未使用依賴。

## 八、子代理分工

每個子代理都應只修改指定檔案，完成後回報：修改檔案、測試命令、已知限制。不要讓兩個代理同時修改同一個檔案。

### Agent A：P0 UI 修復

範圍：`src/exporter.js`、`src/palette.js`

任務：修正 `TermChar` 欄位使用；移除或確認 Ctrl+C 按鈕。加入最小測試或提供手動驗證步驟。

### Agent B：Keep-alive

範圍：`src/settings.js`、`src/main.js`

任務：移除前端重複計時器，保留活動記錄與 Rust IPC，不改 Rust 協定。

### Agent C：Crypto 方案 D

範圍：`src/crypto.js`、測試檔、必要的 `settings.js` 呼叫介面

任務：保留 `encryptSecret`/`decryptSecret` API；新增不可匯出 Web Crypto key 的程序內保護、v2 格式、v1 migration、失敗時不退回明文。必須明確記錄「程序重啟後仍需持久化 key 來源」，不可交付會永久遺失 seed 的實作。

### Agent D：方案 C Rust secure store

範圍：`src-tauri/src/lib.rs`、新 secure-store module、`Cargo.toml`

任務：設計跨平台 abstraction；先完成 interface 與 backend capability 回報，再分別實作 macOS、Windows、Linux fallback。不要讓 JavaScript 讀 machine-id 當秘密。

### Agent E：快捷鍵

範圍：`src/main.js`、新 `src/keymap.js`、`src/settings.js`

任務：分離 Meta/Ctrl、輸入框/IME/modal guard、平台預設值、快捷鍵文件。先寫事件矩陣，再修改程式。

### Agent F：ANSI/DBCS

範圍：`src/ansi_parser.js`、`src/term_buf.js`

任務：修正 FSM、CSI 範圍、清除 DBCS；256 色支援另開獨立任務，避免一次改太多。

### Agent G：效能與清理

範圍：`src/term_view.js`、`src/term_buf.js`、死檔案與文件

任務：先加 cache，再評估 ring buffer；確認 `bbs_engine.js`、空 entrypoint 與 `portable-pty` 的引用後才刪除。

## 九、驗證清單

- [ ] 彩色 ANSI/HTML 匯出保留前景、背景、bright、blink。
- [ ] 調色盤不會無確認送出 Ctrl+C。
- [ ] 每個連線只有一套 keep-alive。
- [ ] 舊版密碼可 migration；失敗不會默默保存明文。
- [ ] 方案 D 的限制已寫入文件。
- [ ] 方案 C 在 macOS、Windows、Linux 各有 backend 或明確 fallback。
- [ ] macOS Cmd+T/W 不會被送成 BBS 控制字元。
- [ ] Windows/Linux Ctrl+T/W/X 的行為已明確且可設定。
- [ ] Big5 跨 packet、ANSI 跨 packet、DBCS 清除都有測試。
- [ ] 快速畫面更新不會因 regex cache 缺失明顯掉幀。
- [ ] `npm run build` 成功；Rust `cargo check` 成功。

## 十、重要安全結論

方案 D 可以改善「localStorage 直接拿到 seed」的問題，但單獨使用時無法在程序重啟後提供持久秘密保存。真正完整的無主密碼方案應是：

```text
JavaScript AES-GCM
        +
不可匯出的 Web Crypto key（程序內層）
        +
方案 C 的 OS secure store / 受限檔案 fallback（跨重啟外層）
```

若使用者追求最高安全性，再提供主密碼模式；忘記主密碼不應阻止應用程式啟動，只應使已保存的密碼需要重設。
