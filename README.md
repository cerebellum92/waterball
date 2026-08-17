# 💧 Waterball (水球)

> 新世代跨平台 BBS 終端連線客戶端 (macOS / Windows / Linux / Chromebook)  
> 基於 **Tauri 2 + Rust + 現代 HTML5 Canvas** 打造，輕量、極速、無損高畫質。

![Waterball](https://img.shields.io/badge/License-GPL%20v3-blue.svg)
![Platform](https://img.shields.io/badge/Platform-macOS%20%7C%20Windows%20%7C%20Linux-brightgreen.svg)
![Memory](https://img.shields.io/badge/RAM-%7E30MB-orange.svg)

---

## 🌟 核心特色 (Key Features)

- **⚡ 看板極速直達 (`⌘ + K`)**：Command Palette 雙向中英文模糊搜尋，直達 30+ 熱門看板與自訂看板。
- **📖 圖文好讀版 (`⌘ + D`)**：事件驅動無損長文採集，內建推噓文統計、即時大圖展開與燈箱預覽。
- **🎨 懸浮 ANSI 彩色發文調色盤 (`⌘ + P`)**：16 色前景/背景雙色、文字屬性控制、製表框線、特殊符號與鄉民顏文字庫。
- **💬 水球與新信件「系統原生推播」**：macOS / OS 原生橫幅推播通知、分頁呼吸燈紅點指示與清脆雙音階音效。
- **📷 一鍵 2x Retina 高畫質截圖 (`⌘ + Shift + S`)**：直接複製 PNG 圖片至剪貼簿（可在 LINE / Discord 直接貼上），支援 ANSI 彩色碼與深色 HTML 匯出。
- **🔍 終端即時搜尋 (`⌘ + F`)**：畫面文字即時雙層高亮、上下比對跳轉與大小寫切換。
- **🔐 智慧帳密自動登入**：書籤原地展開編輯，PTT / MapleBBS 智慧通行狀態機。
- **📐 像素對齊無縫渲染**：動態整數邊界錨定，徹底消除所有次像素黑邊與接縫。
- **🪶 極致輕量與節能**：安裝檔僅約 6MB，記憶體佔用僅約 30MB，Apple Silicon 原生加速。

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
