# Waterball 部署與發布指南

## 專案概況

- **框架**：Tauri（Rust 後端 + Vite/JS 前端）
- **前端核心**：`src/term_view.js`、`src/main.js`、`src/term_buf.js`
- **CI/CD**：GitHub Actions（`.github/workflows/release.yml`）
- **目前版本**：`v0.1.1`

---

## 日常修改後推送（最常用）

每次修改程式碼後，只需要這三步：

```bash
cd /Volumes/External_HD/PCmanX_project/bbsterm

git add .
git commit -m "說明這次改了什麼"
git push origin main
```

**push 之後 GitHub 會自動：**
1. 同時在 macOS、Ubuntu、Windows 三個平台編譯
2. 把編譯好的執行檔（.dmg、.deb、.AppImage、.msi、.exe）**覆蓋**到目前最新 tag（例如 v0.1.1）的 Release 頁面

---

## 情境 A：覆蓋現有 tag（推送後發現有問題，要重新發布）

> 適用時機：版本號不變，只是修正了 bug，想把 Release 的執行檔換掉

**方法一（推薦）：只 push main，自動覆蓋**

```bash
git add .
git commit -m "fix: 修正某某問題"
git push origin main
```

GitHub Actions 完成後，Release 頁面的檔案就會自動更新，不需要動 tag。

---

**方法二：強制移動 tag（需要 tag 本身指向新 commit 時使用）**

```bash
# 把本地 tag 強制移到最新 commit
git tag -f v0.1.1

# 強制 push 覆蓋遠端 tag
git push origin v0.1.1 --force
```

這會讓 GitHub Actions 重新跑一次編譯並更新 Release。

---

## 情境 B：推送全新版本號

> 適用時機：功能有重大更新，要建立新的 Release（例如從 v0.1.1 升到 v0.1.2）

```bash
# 確保目前 main 是最新的
git add .
git commit -m "feat: 新增某某功能"
git push origin main

# 在目前 commit 上打新 tag
git tag v0.1.2

# push 新 tag
git push origin v0.1.2
```

GitHub Actions 偵測到新 tag 後，會編譯三個平台並建立一個新的 v0.1.2 Release 頁面。

---

## 流程總覽

```
修改程式碼
    │
    ▼
git add . && git commit && git push origin main
    │
    ├─── 只是修 bug？──► 自動覆蓋現有 Release（不用動 tag）
    │
    └─── 版本升級？─────► git tag v0.x.x && git push origin v0.x.x
                                   │
                                   ▼
                           建立全新 Release 頁面
```

---

## 注意事項

- 每次 push main 都會觸發三平台編譯（約需 10–20 分鐘），可在 GitHub → Actions 頁面查看進度
- 若 Actions 跑到一半失敗，修正後重新 `git push origin main` 即可重跑
- Release 的版本號由**最新的 git tag** 自動決定，不需要手動改 workflow

---

## 常用指令速查

```bash
# 查看目前所有本地 tag
git tag -l

# 查看目前最近幾個 commit
git log --oneline -5

# 強制把 tag 移到目前 commit 並覆蓋遠端
git tag -f v0.x.x
git push origin v0.x.x --force

# 刪除本地 tag
git tag -d v0.x.x

# 刪除遠端 tag（謹慎使用）
git push origin :refs/tags/v0.x.x
```
