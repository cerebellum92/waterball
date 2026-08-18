# 💧 Waterball (水球)

> 新世代跨平台 BBS 終端連線客戶端 (macOS / Windows / Linux / Chromebook)  
> 基於 **Tauri 2 + Rust + 現代 HTML5 Canvas** 打造，輕量、極速、無損高畫質。

![Waterball](https://img.shields.io/badge/License-GPL%20v3-blue.svg)
![Platform](https://img.shields.io/badge/Platform-macOS%20%7C%20Windows%20%7C%20Linux-brightgreen.svg)
![Memory](https://img.shields.io/badge/RAM-%7E30MB-orange.svg)

---

## 📥 安裝與下載指南 (Installation)

請前往 **[Releases 最新發布頁面](../../releases)** 下載適合您作業系統的安裝檔案：

### 🍏 macOS (Apple Silicon / Intel)
1. 下載 **`Waterball_0.1.0_macOS.dmg`** 並點兩下開啟掛載。
2. 將 `Waterball.app` 拖曳至「應用程式 (Applications)」資料夾。
3. **首次啟動與 Gatekeeper 安全授權說明**：
   > 💡 **小提示**：Waterball 是非營利社群開源軟體，未向 Apple 每年支付商業開發者憑證年費。首次開啟時若出現「無法確認開發者」的安全提示，可透過以下方式輕鬆解鎖（只需設定一次，之後即可直接秒開）：
   - **方法 A（推薦・最快速）**：在 `Waterball.app` 圖示上 **按住鍵盤 `Control` 鍵（或按滑鼠右鍵），點選「打開」**，接著在確認對話框中點選 **「打開」** 即可。
   - **方法 B**：前往 Mac **「系統設定」➔「隱私權與安全性」**，向下滑動至安全性區塊，點擊 **「仍要打開 (Open Anyway)」**。
   - **方法 C（終端機指令）**：直接在終端機輸入：
     ```bash
     xattr -cr /Applications/Waterball.app
     ```

---

### 🐧 Linux (Ubuntu / Debian / Fedora / Arch)
- **Ubuntu / Debian 使用者**：
  下載 **`Waterball_0.1.0_amd64.deb`**，並在終端機執行安裝：
  ```bash
  sudo dpkg -i Waterball_0.1.0_amd64.deb
  sudo apt-get install -f -y
  ```
- **其他 Linux 發行版（免安裝隨身版）**：
  下載 **`Waterball_0.1.0_amd64.AppImage`**，賦予執行權限後即可點開使用：
  ```bash
  chmod +x Waterball_0.1.0_amd64.AppImage
  ./Waterball_0.1.0_amd64.AppImage
  ```

---

### 🪟 Windows (Windows 10 / 11)
- **免安裝綠色版（推薦）**：
  下載 **`Waterball_windows_x64_portable.zip`**，解壓縮後直接點擊 `Waterball.exe` 即可使用！
- **標準安裝版**：
  下載 **`Waterball_0.1.0_x64.msi`** 或 `setup.exe` 進行安裝。
  > 💡 首次啟動若出現 Windows Defender SmartScreen 藍色保護畫面，點擊 **「其他資訊」➔「仍要執行」** 即可。

---

## 🌟 核心特色 (Key Features)

- **⚡ 看板極速直達 (`⌘ + K` / `Ctrl + K`)**：Command Palette 雙向中英文模糊搜尋，直達 30+ 熱門看板與自訂看板。
- **📖 圖文好讀版 (`⌘ + D` / `Ctrl + D`)**：事件驅動無損長文採集，內建推噓文統計、即時大圖展開與燈箱預覽。
- **🎨 懸浮 ANSI 彩色發文調色盤 (`⌘ + P` / `Ctrl + P`)**：16 色雙色支援、智慧選取文字上色、自動加上 `*[m` 收尾代碼與鄉民顏文字庫。
- **📋 完整 ANSI 色彩碼複製 (`⌘ + Shift + C` / `Ctrl + Shift + C`)**：一鍵複製反白區域色彩碼，並提供浮動 Toast 通知。
- **🛡️ 24/7 原生 Rust 底層防閒置心跳**：完全免疫瀏覽器背景休眠與節流，即使視窗最小化也絕不被 BBS 站台踢除。
- **💬 水球與新信件「系統原生推播」**：OS 原生橫幅推播通知、分頁呼吸燈紅點指示與清脆音效。
- **📷 一鍵 2x Retina 高畫質截圖 (`⌘ + Shift + S`)**：直接複製 PNG 圖片至剪貼簿（可在 LINE / Discord 直接貼上），支援 ANSI 彩色碼與深色 HTML 匯出。
- **🔍 終端即時搜尋 (`⌘ + F` / `Ctrl + F`)**：畫面文字即時雙層高亮、上下比對跳轉與大小寫切換。
- **🔐 智慧帳密自動登入**：書籤原地展開編輯，PTT / MapleBBS 智慧通行狀態機。
- **📐 像素對齊無縫渲染與防切邊**：動態整數邊界錨定與安全內縮，徹底消除黑邊、接縫與切字。
- **🔠 全域介面縮放**：提供標準、適中、舒適大字體切換，設定與工具列同步放大。
- **🪶 極致輕量與節能**：安裝檔僅約 3~6MB，記憶體佔用僅約 30MB，原生硬體加速。

---

## 🚀 快速開始 (Getting Started)

### 前置需求 (Prerequisites)
- [Node.js](https://nodejs.org/) (v18+)
- [Rust & Cargo](https://www.rust-lang.org/) (最新穩定版)

### 開發與執行 (Development)
```bash
# 安裝前端依賴
npm install

# 啟動開發伺服器與桌面應用程式
npm run tauri dev
```

### 打包發布 (Build Production)
```bash
# 編譯發布安裝檔 (macOS .dmg / Windows .msi / Linux .deb)
npm run tauri build
```

---

## 🏆 歷史傳承與特別致謝 (Lineage & Acknowledgements)

本專案深深受益於台灣三十年來蓬勃發展的 BBS 開源文化與前輩開發者的無私貢獻：

1. **洪任諭醫師 (Hzysoft) & PCMan / PCManX-BBS 開源團隊**：
   - 台灣 BBS 連線軟體的先驅與靈魂。洪任諭醫師創造的 PCMan 與開源團隊（Kanru, Mat, Jim Huang 等）奠定了台灣 BBS 軟體的經典操作與雙格 DBCS 刪除標準。
2. **robertabcd (Robert Chen) & PttChrome 團隊**：
   - 卓越的 Web ANSI 終端狀態機與 BBS 封包解析架構，為現代跨平台終端提供了扎實的基石。
3. **Welly / MacBBS 開發團隊**：
   - 在 macOS 平台上樹立了優雅、美觀與流暢的 BBS 用戶端典範。
4. **批踢踢實業坊 (PTT) 站方與全體鄉民社群**：
   - 感謝三十年來為台灣保留最自由、溫暖、熱鬧的文字社群殿堂。
5. **Tauri & Rust 社群**：
   - 感謝現代開源社群提供的高效能、極輕量跨平台底層框架支持。

---

## 📄 開源授權 (License)

本專案遵循 **GNU General Public License v3.0 (GPLv3)** 開源授權。  
詳情請參閱專案中的 [LICENSE](./LICENSE) 檔案。
