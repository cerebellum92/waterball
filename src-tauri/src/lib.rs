mod telnet;
pub mod uao;

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager, State, Window, WindowEvent};
use telnet::{BbsCharset, BbsConnection, ConnectionStatusPayload};

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct WindowState {
    pub width: f64,
    pub height: f64,
    pub x: Option<f64>,
    pub y: Option<f64>,
    pub is_maximized: bool,
}

impl WindowState {
    fn load(app: &AppHandle) -> Option<Self> {
        let path = app.path().app_config_dir().ok()?.join("window_state.json");
        let content = std::fs::read_to_string(path).ok()?;
        serde_json::from_str(&content).ok()
    }

    fn save(&self, app: &AppHandle) {
        if let Ok(config_dir) = app.path().app_config_dir() {
            let _ = std::fs::create_dir_all(&config_dir);
            let path = config_dir.join("window_state.json");
            if let Ok(json) = serde_json::to_string_pretty(self) {
                let _ = std::fs::write(path, json);
            }
        }
    }

    fn clear(app: &AppHandle) {
        if let Ok(config_dir) = app.path().app_config_dir() {
            let path = config_dir.join("window_state.json");
            let _ = std::fs::remove_file(path);
        }
    }

    fn apply_to(&self, _window: &tauri::WebviewWindow) {
        #[cfg(desktop)]
        {
            use tauri::{LogicalPosition, LogicalSize, Position, Size};
            if self.is_maximized {
                let _ = _window.maximize();
                return;
            }
            if self.width >= 400.0 && self.height >= 300.0 {
                let _ = _window.set_size(Size::Logical(LogicalSize {
                    width: self.width,
                    height: self.height,
                }));
            }
            if let (Some(x), Some(y)) = (self.x, self.y) {
                if x >= 0.0 && y >= 0.0 && x < 10000.0 && y < 10000.0 {
                    let _ = _window.set_position(Position::Logical(LogicalPosition { x, y }));
                }
            }
        }
    }
}

fn save_current_window_state(_window: &Window) {
    #[cfg(desktop)]
    {
        let scale = _window.scale_factor().unwrap_or(1.0);
        let size = match _window.outer_size() {
            Ok(size) => size,
            Err(_) => return,
        };
        let position = _window.outer_position().ok();
        let is_maximized = _window.is_maximized().unwrap_or(false);
        let state = WindowState {
            width: f64::from(size.width) / scale,
            height: f64::from(size.height) / scale,
            x: position.map(|pos| f64::from(pos.x) / scale),
            y: position.map(|pos| f64::from(pos.y) / scale),
            is_maximized,
        };
        if state.width >= 400.0 && state.height >= 300.0 {
            state.save(&_window.app_handle());
        }
    }
}

pub struct AntiIdleSettings {
    pub enabled: bool,
    pub interval_secs: u64,
}

pub struct AppState {
    pub connections: Arc<Mutex<HashMap<String, BbsConnection>>>,
    pub anti_idle: Arc<Mutex<AntiIdleSettings>>,
    pub remember_window_state: Arc<Mutex<bool>>,
}

#[tauri::command]
async fn connect(
    app: AppHandle,
    state: State<'_, AppState>,
    tab_id: String,
    address: String,
    port: u16,
    charset: Option<String>,
    transport: Option<String>,
) -> Result<String, String> {
    // Disconnect existing connection for this tab if any
    {
        let mut map = state.connections.lock().map_err(|e| e.to_string())?;
        if let Some(old) = map.remove(&tab_id) {
            old.disconnect();
        }
    }

    let transport = transport.unwrap_or_else(|| {
        if port == 22 || port == 8888 { "ssh".to_string() } else { "telnet".to_string() }
    });
    let app_handle = app.clone();
    let cs = charset
        .as_deref()
        .map(BbsCharset::from_str)
        .unwrap_or(BbsCharset::Big5);

    // Emit connecting status
    let _ = app.emit("connection-status", ConnectionStatusPayload {
        tab_id: tab_id.clone(),
        status: "connecting".to_string(),
    });

    if transport == "wss" {
        println!("[Rust] Connecting Tab {} via WSS to {} ({:?})", tab_id, address, cs);
        match BbsConnection::connect_wss(tab_id.clone(), &address, cs, app_handle).await {
            Ok(conn) => {
                println!("[Rust] Tab {} WSS Connected successfully", tab_id);
                let mut map = state.connections.lock().map_err(|e| e.to_string())?;
                map.insert(tab_id, conn);
                Ok("connected".to_string())
            }
            Err(e) => {
                println!("[Rust] Tab {} WSS Connection error: {}", tab_id, e);
                let _ = app.emit("connection-status", ConnectionStatusPayload {
                    tab_id,
                    status: "disconnected".to_string(),
                });
                Err(e)
            }
        }
    } else if transport == "ssh" {
        println!("[Rust] Connecting Tab {} via SSH to {}:{} ({:?})", tab_id, address, port, cs);
        match BbsConnection::connect_ssh(tab_id.clone(), &address, port, cs, app_handle).await {
            Ok(conn) => {
                println!("[Rust] Tab {} SSH Connected successfully", tab_id);
                let mut map = state.connections.lock().map_err(|e| e.to_string())?;
                map.insert(tab_id, conn);
                Ok("connected".to_string())
            }
            Err(e) => {
                println!("[Rust] Tab {} SSH Connection error: {}", tab_id, e);
                let _ = app.emit("connection-status", ConnectionStatusPayload {
                    tab_id,
                    status: "disconnected".to_string(),
                });
                Err(e)
            }
        }
    } else {
        println!("[Rust] Connecting Tab {} via Telnet to {}:{} ({:?})", tab_id, address, port, cs);
        match BbsConnection::connect_telnet(tab_id.clone(), &address, port, cs, app_handle).await {
            Ok(conn) => {
                println!("[Rust] Tab {} Telnet Connected successfully", tab_id);
                let mut map = state.connections.lock().map_err(|e| e.to_string())?;
                map.insert(tab_id, conn);
                Ok("connected".to_string())
            }
            Err(e) => {
                println!("[Rust] Tab {} Telnet Connection error: {}", tab_id, e);
                let _ = app.emit("connection-status", ConnectionStatusPayload {
                    tab_id,
                    status: "disconnected".to_string(),
                });
                Err(e)
            }
        }
    }
}

#[tauri::command]
async fn set_charset(
    state: State<'_, AppState>,
    tab_id: String,
    charset: String,
) -> Result<(), String> {
    let map = state.connections.lock().map_err(|e| e.to_string())?;
    if let Some(conn) = map.get(&tab_id) {
        conn.set_charset(BbsCharset::from_str(&charset));
        Ok(())
    } else {
        Err(format!("Tab {} not connected", tab_id))
    }
}

#[tauri::command]
async fn send_input(
    state: State<'_, AppState>,
    tab_id: String,
    data: String,
) -> Result<(), String> {
    let map = state.connections.lock().map_err(|e| e.to_string())?;
    if let Some(conn) = map.get(&tab_id) {
        conn.record_activity();
        conn.send(&data).map_err(|e| e.to_string())
    } else {
        Err(format!("Tab {} not connected", tab_id))
    }
}

#[tauri::command]
async fn send_bytes(
    state: State<'_, AppState>,
    tab_id: String,
    bytes: Vec<u8>,
) -> Result<(), String> {
    let map = state.connections.lock().map_err(|e| e.to_string())?;
    if let Some(conn) = map.get(&tab_id) {
        conn.record_activity();
        conn.send_raw(&bytes).map_err(|e| e.to_string())
    } else {
        Err(format!("Tab {} not connected", tab_id))
    }
}

#[tauri::command]
fn set_raw_terminal_capture(enabled: bool) -> Result<(), String> {
    #[cfg(debug_assertions)]
    telnet::set_raw_capture_enabled(enabled);
    #[cfg(not(debug_assertions))]
    let _ = enabled;
    Ok(())
}

#[tauri::command]
async fn record_activity(
    state: State<'_, AppState>,
    tab_id: Option<String>,
) -> Result<(), String> {
    let map = state.connections.lock().map_err(|e| e.to_string())?;
    if let Some(id) = tab_id {
        if let Some(conn) = map.get(&id) {
            conn.record_activity();
        }
    } else {
        for conn in map.values() {
            conn.record_activity();
        }
    }
    Ok(())
}

#[tauri::command]
async fn set_anti_idle(
    state: State<'_, AppState>,
    enabled: bool,
    interval_secs: u64,
) -> Result<(), String> {
    let mut config = state.anti_idle.lock().map_err(|e| e.to_string())?;
    config.enabled = enabled;
    config.interval_secs = interval_secs;
    println!("[Rust Anti-Idle] Config updated: enabled={}, interval={}s", enabled, interval_secs);
    Ok(())
}

#[tauri::command]
async fn disconnect(
    app: AppHandle,
    state: State<'_, AppState>,
    tab_id: String,
) -> Result<(), String> {
    let mut map = state.connections.lock().map_err(|e| e.to_string())?;
    if let Some(old) = map.remove(&tab_id) {
        old.disconnect();
    }
    let _ = app.emit("connection-status", ConnectionStatusPayload {
        tab_id,
        status: "disconnected".to_string(),
    });
    Ok(())
}

#[tauri::command]
async fn open_browser_url(app: AppHandle, url: String) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    app.opener().open_url(&url, None::<&str>)
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn save_window_state(
    app: AppHandle,
    width: f64,
    height: f64,
    x: Option<f64>,
    y: Option<f64>,
    is_maximized: bool,
) -> Result<(), String> {
    let state = WindowState {
        width,
        height,
        x,
        y,
        is_maximized,
    };
    state.save(&app);
    Ok(())
}

#[tauri::command]
async fn get_saved_window_state(app: AppHandle) -> Result<Option<WindowState>, String> {
    Ok(WindowState::load(&app))
}

#[tauri::command]
async fn set_remember_window_state(
    app: AppHandle,
    state: State<'_, AppState>,
    enabled: bool,
) -> Result<(), String> {
    if let Ok(mut remember) = state.remember_window_state.lock() {
        *remember = enabled;
    }
    if !enabled {
        WindowState::clear(&app);
    }
    Ok(())
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
pub struct PttArticleItem {
    pub id: String,
    pub title: String,
    pub author: String,
    pub date: String,
    pub nrec: String,
    pub link: String,
    pub board: String,
}

pub fn parse_ptt_articles_html(html: &str, board: &str) -> Vec<PttArticleItem> {
    let mut articles = Vec::new();
    // Skip index 0 because everything before the first <div class="r-ent"> is the page header
    // which contains top navigation and Cloudflare honeypot trap links (<a href="/cdn-cgi/content?...">)
    for block in html.split("<div class=\"r-ent\">").skip(1) {
        let title_block_start = match block.find("class=\"title\"") {
            Some(idx) => idx,
            None => continue,
        };
        let title_block = &block[title_block_start..];
        let title_div_end = match title_block.find("</div>") {
            Some(idx) => idx,
            None => continue,
        };
        let title_section = &title_block[..title_div_end];

        let link_start = match title_section.find("<a href=\"") {
            Some(idx) => idx + "<a href=\"".len(),
            None => continue, // Deleted article or no link, skip
        };
        let link_end = match title_section[link_start..].find('"') {
            Some(idx) => link_start + idx,
            None => continue,
        };
        let raw_link = title_section[link_start..link_end].trim();

        // Must be a legitimate PTT article link; reject honeypots, search links, etc.
        if raw_link.contains("cdn-cgi")
            || raw_link.contains("search?")
            || raw_link.contains("javascript:")
            || !raw_link.contains("/bbs/")
        {
            continue;
        }

        // Normalize link to relative path e.g. /bbs/Stock/M.123456789.A.ABC.html
        let link = if let Some(pos) = raw_link.find("/bbs/") {
            raw_link[pos..].to_string()
        } else {
            raw_link.to_string()
        };

        if !link.ends_with(".html") {
            continue;
        }

        let id = link
            .rsplit('/')
            .next()
            .and_then(|file| file.strip_suffix(".html"))
            .unwrap_or(&link)
            .to_string();

        if !id.starts_with("M.") {
            continue;
        }

        let after_link = &title_section[link_end..];
        let title_tag_end = match after_link.find('>') {
            Some(idx) => idx + 1,
            None => continue,
        };
        let title_close = match after_link[title_tag_end..].find("</a>") {
            Some(idx) => title_tag_end + idx,
            None => continue,
        };
        let raw_title = &after_link[title_tag_end..title_close];
        let title = unescape_html(raw_title).trim().to_string();

        if title.is_empty() || title == "批踢踢實業坊" || is_deleted_article_title(&title) {
            continue;
        }

        let author = extract_tag_content(block, "class=\"author\">", "</div>").unwrap_or_default();
        if author.is_empty() || author == "-" {
            continue;
        }

        let date = extract_tag_content(block, "class=\"date\">", "</div>").unwrap_or_default();
        let raw_nrec = extract_tag_content(block, "class=\"nrec\">", "</div>").unwrap_or_default();
        let nrec = strip_tags(&raw_nrec).trim().to_string();

        articles.push(PttArticleItem {
            id,
            title,
            author,
            date,
            nrec,
            link,
            board: board.to_string(),
        });
    }
    articles
}

fn is_deleted_article_title(title: &str) -> bool {
    let clean = title.trim();
    if clean.is_empty() || clean == "-" || clean == "批踢踢實業坊" {
        return true;
    }
    if clean.contains("本文已被刪除")
        || clean.contains("本文已經被刪除")
        || clean.contains("本文已被版主刪除")
        || clean.contains("本文已被板主刪除")
    {
        return true;
    }
    let s = clean.trim_start_matches(|c| c == '(' || c == '[' || c == '<');
    if (s.starts_with("本文") || s.starts_with("此文") || s.starts_with("此篇"))
        && s.contains("刪除")
        && (s.contains("已被") || s.contains("已經被"))
    {
        return true;
    }
    if (s.starts_with("已被") || s.starts_with("已經被")) && s.contains("刪除") {
        return true;
    }
    false
}

fn extract_tag_content(text: &str, open: &str, close: &str) -> Option<String> {
    let start = text.find(open)? + open.len();
    let end = text[start..].find(close)? + start;
    Some(text[start..end].trim().to_string())
}

fn strip_tags(text: &str) -> String {
    let mut result = String::new();
    let mut in_tag = false;
    for ch in text.chars() {
        if ch == '<' {
            in_tag = true;
        } else if ch == '>' {
            in_tag = false;
        } else if !in_tag {
            result.push(ch);
        }
    }
    result
}

fn unescape_html(text: &str) -> String {
    text.replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&apos;", "'")
}

#[tauri::command]
async fn fetch_ptt_board_articles(board: String) -> Result<Vec<PttArticleItem>, String> {
    let clean_board = board.trim();
    if clean_board.is_empty() {
        return Err("看板名稱不能為空".to_string());
    }

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(8))
        .build()
        .map_err(|e| format!("無法建立 HTTP 客戶端: {}", e))?;

    let url = format!("https://www.ptt.cc/bbs/{}/index.html", clean_board);
    let resp = client
        .get(&url)
        .header("Cookie", "over18=1")
        .header(
            "User-Agent",
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        )
        .send()
        .await
        .map_err(|e| format!("連線 PTT 失敗: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("PTT 回應狀態碼異常: HTTP {}", resp.status()));
    }

    let html = resp.text().await.map_err(|e| format!("讀取內容失敗: {}", e))?;
    Ok(parse_ptt_articles_html(&html, clean_board))
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
pub struct TelegramSendResult {
    pub success: bool,
    pub message: String,
}

#[derive(serde::Serialize, serde::Deserialize, Debug, Clone)]
struct InlineKeyboardButton {
    text: String,
    url: String,
}

#[derive(serde::Serialize, serde::Deserialize, Debug, Clone)]
struct InlineKeyboardMarkup {
    inline_keyboard: Vec<Vec<InlineKeyboardButton>>,
}

#[derive(serde::Serialize)]
struct TelegramSendMessagePayload<'a> {
    chat_id: &'a str,
    text: &'a str,
    parse_mode: &'a str,
    disable_web_page_preview: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    disable_notification: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    reply_markup: Option<InlineKeyboardMarkup>,
}

#[tauri::command]
async fn send_telegram_message(
    bot_token: String,
    chat_id: String,
    text: String,
    silent: Option<bool>,
    button_url: Option<String>,
    button_text: Option<String>,
) -> Result<TelegramSendResult, String> {
    let mut clean_token = bot_token.trim().to_string();
    let clean_chat_id = chat_id.trim();

    // Strip URL prefix if user pasted full API endpoint
    if let Some(pos) = clean_token.find("/bot") {
        clean_token = clean_token[pos + 4..].to_string();
    }
    if let Some(pos) = clean_token.find("/sendMessage") {
        clean_token = clean_token[..pos].to_string();
    }

    // Strip leading "bot" prefix if user entered e.g. bot123456:ABC...
    if clean_token.to_lowercase().starts_with("bot") {
        let remainder = &clean_token[3..];
        if remainder.chars().next().map_or(false, |c| c.is_ascii_digit()) {
            clean_token = remainder.to_string();
        }
    }

    let clean_token = clean_token.trim().trim_matches('/').to_string();

    if clean_token.is_empty() {
        return Ok(TelegramSendResult {
            success: false,
            message: "Telegram Bot Token 未填寫".to_string(),
        });
    }
    if clean_chat_id.is_empty() {
        return Ok(TelegramSendResult {
            success: false,
            message: "Telegram Chat ID 未填寫".to_string(),
        });
    }

    // Proactive format diagnostics
    if clean_token.starts_with('@') || clean_token.starts_with("t.me/") {
        return Ok(TelegramSendResult {
            success: false,
            message: "Bot Token 填寫錯誤：您似乎填寫成了機器人帳號或連結（例如 @xxx_bot），請填寫 @BotFather 發給的「HTTP API Token」（格式應為 123456789:ABCdef...）".to_string(),
        });
    }

    if !clean_token.contains(':') {
        if clean_chat_id.contains(':') {
            return Ok(TelegramSendResult {
                success: false,
                message: "您似乎把「Bot Token」和「Chat ID」的位置填反了！Bot Token 應包含冒號（例如 123456789:ABC...），而 Chat ID 通常為純數字（例如 987654321）。".to_string(),
            });
        }
        return Ok(TelegramSendResult {
            success: false,
            message: "Bot Token 格式錯誤：有效的 Telegram Bot Token 必須包含冒號「:」（格式為 數字:英數代碼，例如 123456789:AA...）。請檢查是否複製不完整或誤填為 Chat ID。".to_string(),
        });
    }

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| format!("無法建立 HTTP 客戶端: {}", e))?;

    let url = format!("https://api.telegram.org/bot{}/sendMessage", clean_token);

    let reply_markup = button_url.and_then(|u| {
        let trimmed = u.trim().to_string();
        if trimmed.is_empty() {
            None
        } else {
            let label = button_text
                .unwrap_or_else(|| "📖 開啟 PTT 好讀版".to_string());
            Some(InlineKeyboardMarkup {
                inline_keyboard: vec![vec![InlineKeyboardButton {
                    text: label,
                    url: trimmed,
                }]],
            })
        }
    });

    let payload = TelegramSendMessagePayload {
        chat_id: clean_chat_id,
        text: &text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
        disable_notification: silent,
        reply_markup,
    };

    let json_body = serde_json::to_string(&payload)
        .map_err(|e| format!("序列化 Payload 失敗: {}", e))?;

    let resp = client
        .post(&url)
        .header("Content-Type", "application/json")
        .body(json_body)
        .send()
        .await
        .map_err(|e| format!("發送至 Telegram 失敗 (網路連線錯誤): {}", e))?;

    let status = resp.status();
    let body = resp.text().await.unwrap_or_default();

    if status.is_success() && serde_json::from_str::<serde_json::Value>(&body)
        .ok().and_then(|v| v["ok"].as_bool()) == Some(true) {
        Ok(TelegramSendResult {
            success: true,
            message: "訊息發送成功！".to_string(),
        })
    } else {
        let err_detail = if let Ok(v) = serde_json::from_str::<serde_json::Value>(&body) {
            v["description"].as_str().unwrap_or(&body).to_string()
        } else {
            body
        };

        let friendly_msg = if status.as_u16() == 404 {
            "Telegram 回應錯誤 (HTTP 404 Not Found)：Telegram 伺服器找不到此機器人。請確認 Bot Token 是否完整複製自 @BotFather（Token 格式應如 123456789:ABCdef...，不可有前後多餘字元）。".to_string()
        } else if status.as_u16() == 400 && err_detail.to_lowercase().contains("chat not found") {
            format!("Telegram 回應錯誤：找不到 Chat ID「{}」。請先在 Telegram 點入您的機器人對話框並點擊「Start」，否則機器人無法主動發送訊息給您！", clean_chat_id)
        } else if status.as_u16() == 401 {
            "Telegram 回應錯誤 (HTTP 401 Unauthorized)：Bot Token 無效或已被撤銷，請向 @BotFather 重新獲取 Token。".to_string()
        } else {
            format!("Telegram 回應錯誤 (HTTP {}): {}", status, err_detail)
        };

        Ok(TelegramSendResult {
            success: false,
            message: friendly_msg,
        })
    }
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
pub struct CloudflareSyncResult {
    pub success: bool,
    pub message: String,
    pub token: Option<String>,
    pub rule_count: Option<usize>,
    pub updated_at: Option<u64>,
}

#[tauri::command]
async fn cloud_push_request(
    worker_url: String,
    secret_key: String,
    method: String,
    payload_json: Option<String>,
) -> Result<serde_json::Value, String> {
    let mut url = reqwest::Url::parse(worker_url.trim())
        .map_err(|_| "推播網址格式不正確".to_string())?;
    let local = matches!(url.host_str(), Some("localhost" | "127.0.0.1" | "[::1]"));
    if url.scheme() != "https" && !(url.scheme() == "http" && local) {
        return Err("推播伺服器必須使用 HTTPS".to_string());
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err("推播網址不可包含帳密".to_string());
    }
    url.set_query(None);
    url.set_fragment(None);
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .redirect(reqwest::redirect::Policy::none())
        .build().map_err(|e| e.to_string())?;
    let mut request = match method.as_str() {
        "GET" => client.get(url),
        "POST" => client.post(url).header("Content-Type", "application/json")
            .body(payload_json.unwrap_or_else(|| "{}".to_string())),
        _ => return Err("不支援的推播請求方法".to_string()),
    };
    if !secret_key.is_empty() {
        request = request.header("Authorization", format!("Bearer {}", secret_key.trim()));
    }
    let mut response = request.send().await.map_err(|e| e.to_string())?;
    let status = response.status();
    if response.content_length().unwrap_or(0) > 1024 * 1024 {
        return Err("伺服器回應超過 1 MiB 上限".to_string());
    }
    let mut body = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|e| e.to_string())? {
        if body.len() + chunk.len() > 1024 * 1024 {
            return Err("伺服器回應超過 1 MiB 上限".to_string());
        }
        body.extend_from_slice(&chunk);
    }
    let mut value: serde_json::Value = serde_json::from_slice(&body)
        .map_err(|_| "伺服器未回傳合法 JSON".to_string())?;
    let object = value.as_object_mut().ok_or_else(|| "伺服器回應格式錯誤".to_string())?;
    if !status.is_success() || object.get("success").and_then(|v| v.as_bool()) != Some(true) {
        object.insert("success".to_string(), serde_json::Value::Bool(false));
    }
    object.insert("httpStatus".to_string(), serde_json::json!(status.as_u16()));
    Ok(value)
}

#[tauri::command]
async fn sync_to_cloudflare_worker(worker_url: String, secret_key: String, payload_json: String) -> Result<CloudflareSyncResult, String> {
    let base = worker_url.trim().trim_end_matches('/');
    let target = if base.ends_with("/sync") { base.to_string() } else { format!("{}/sync", base) };
    let value = cloud_push_request(target, secret_key, "POST".to_string(), Some(payload_json)).await?;
    Ok(CloudflareSyncResult {
        success: value["success"].as_bool() == Some(true),
        message: value["message"].as_str().unwrap_or("同步回應未確認成功").to_string(),
        token: value["token"].as_str().map(str::to_string),
        rule_count: value["rule_count"].as_u64().or_else(|| value["ruleCount"].as_u64()).map(|n| n as usize),
        updated_at: value["updated_at"].as_u64().or_else(|| value["updatedAt"].as_u64()),
    })
}

#[tauri::command]
async fn test_cloudflare_worker(worker_url: String, secret_key: String) -> Result<CloudflareSyncResult, String> {
    let base = worker_url.trim().trim_end_matches('/');
    let target = if base.ends_with("/sync") { base.to_string() } else { format!("{}/sync", base) };
    let value = cloud_push_request(target, secret_key, "GET".to_string(), None).await?;
    let success = value["success"].as_bool() == Some(true) && value.get("config").is_some();
    Ok(CloudflareSyncResult {
        success,
        message: if success { "連線與身份驗證成功".to_string() } else { value["message"].as_str().unwrap_or("連線未確認成功").to_string() },
        token: None,
        rule_count: None,
        updated_at: None,
    })
}

#[cfg(target_os = "macos")]
fn escape_applescript_string(s: &str) -> String {
    s.replace('\\', "\\\\")
        .replace('"', "\\\"")
        .replace('\r', "")
}

#[tauri::command]
async fn send_system_notification(
    title: String,
    body: String,
    subtitle: Option<String>,
    url: Option<String>,
    sound: Option<bool>,
    app_handle: AppHandle,
) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        #[cfg(target_os = "macos")]
        {
            let _ = &app_handle;
            use std::process::Command;

            // 1. If terminal-notifier is available, use it (native support for -open <url> on click!)
            let tn_path = ["/opt/homebrew/bin/terminal-notifier", "/usr/local/bin/terminal-notifier"]
                .into_iter()
                .find(|p| std::path::Path::new(p).exists())
                .map(|s| s.to_string())
                .or_else(|| {
                    Command::new("which")
                        .arg("terminal-notifier")
                        .output()
                        .ok()
                        .and_then(|out| {
                            if out.status.success() {
                                let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
                                if !s.is_empty() { Some(s) } else { None }
                            } else {
                                None
                            }
                        })
                });

            if let Some(path) = tn_path {
                let mut cmd = Command::new(path);
                cmd.arg("-title").arg(&title);
                if let Some(ref sub) = subtitle {
                    let trimmed = sub.trim();
                    if !trimmed.is_empty() {
                        cmd.arg("-subtitle").arg(trimmed);
                    }
                }
                cmd.arg("-message").arg(&body);
                if sound.unwrap_or(true) {
                    cmd.arg("-sound").arg("default");
                }
                if let Some(ref target_url) = url {
                    let trimmed = target_url.trim();
                    if !trimmed.is_empty() {
                        cmd.arg("-open").arg(trimmed);
                    }
                }
                if let Ok(out) = cmd.output() {
                    if out.status.success() {
                        return Ok(());
                    }
                }
            }

            // 2. Fallback to standard AppleScript display notification via System Events
            // Wrapping inside System Events prevents macOS from attributing the notification
            // to Script Editor (which caused clicking "Show" to launch Script Editor.app).
            let mut script = format!(
                r#"tell application "System Events" to display notification "{}" with title "{}""#,
                escape_applescript_string(&body),
                escape_applescript_string(&title)
            );
            if let Some(sub) = subtitle {
                let trimmed = sub.trim();
                if !trimmed.is_empty() {
                    script.push_str(&format!(
                        r#" subtitle "{}""#,
                        escape_applescript_string(trimmed)
                    ));
                }
            }
            if sound.unwrap_or(true) {
                script.push_str(r#" sound name "default""#);
            }

            let output = Command::new("osascript")
                .arg("-e")
                .arg(&script)
                .output();

            match output {
                Ok(out) if out.status.success() => Ok(()),
                Ok(out) => Err(format!(
                    "osascript failed: {}",
                    String::from_utf8_lossy(&out.stderr)
                )),
                Err(e) => Err(format!("Failed to run osascript: {}", e)),
            }
        }

        #[cfg(not(target_os = "macos"))]
        {
            let _ = subtitle;
            let _ = url;
            let _ = sound;
            use tauri_plugin_notification::NotificationExt;
            let mut builder = app_handle.notification().builder();
            builder = builder.title(title).body(body);
            builder.show().map_err(|e| e.to_string())
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let connections = Arc::new(Mutex::new(HashMap::<String, BbsConnection>::new()));
    let anti_idle = Arc::new(Mutex::new(AntiIdleSettings {
        enabled: true,
        interval_secs: 45, // default 45 seconds heartbeat
    }));
    let remember_window_state = Arc::new(Mutex::new(true));

    // Start dedicated native OS background thread for Keep-Alive
    // (100% immune to browser/webview background throttling!)
    let connections_bg = connections.clone();
    let anti_idle_bg = anti_idle.clone();
    std::thread::spawn(move || {
        loop {
            std::thread::sleep(std::time::Duration::from_secs(10));
            let (enabled, interval) = {
                let s = anti_idle_bg.lock().unwrap();
                (s.enabled, s.interval_secs)
            };
            if !enabled {
                continue;
            }
            let map = match connections_bg.lock() {
                Ok(m) => m,
                Err(_) => continue,
            };
            for (tab_id, conn) in map.iter() {
                if conn.check_and_send_keepalive(interval) {
                    println!("[Rust Anti-Idle] Heartbeat sent to Tab {} (24/7 background protected)", tab_id);
                }
            }
        }
    });

    let app_state = AppState {
        connections,
        anti_idle,
        remember_window_state: remember_window_state.clone(),
    };

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_notification::init())
        .manage(app_state)
        .on_window_event(move |window, event| {
            if window.label() == "main" && matches!(event, WindowEvent::CloseRequested { .. }) {
                if let Ok(remember) = remember_window_state.lock() {
                    if *remember {
                        save_current_window_state(window);
                    }
                }
            }
        })
        .setup(|app| {
            #[cfg(all(desktop, debug_assertions))]
            if std::env::var_os("WATERBALL_OPEN_DEVTOOLS").is_some() {
                if let Some(window) = app.get_webview_window("main") {
                    window.open_devtools();
                }
            }

            if let Some(window) = app.get_webview_window("main") {
                if let Some(state) = WindowState::load(app.handle()) {
                    state.apply_to(&window);
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            connect,
            set_charset,
            send_input,
            send_bytes,
            set_raw_terminal_capture,
            record_activity,
            set_anti_idle,
            disconnect,
            open_browser_url,
            save_window_state,
            get_saved_window_state,
            set_remember_window_state,
            fetch_ptt_board_articles,
            send_telegram_message,
            sync_to_cloudflare_worker,
            cloud_push_request,
            test_cloudflare_worker,
            send_system_notification,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::parse_ptt_articles_html;

    #[test]
    fn test_parse_ptt_articles_html() {
        let sample_html = r#"
        <!DOCTYPE html>
        <html>
        <head><title>Stock</title></head>
        <body>
        <a href="https://www.ptt.cc/cdn-cgi/content?id=trap123" style="display:none !important"></a>
        <div id="topbar"><a id="logo" href="/bbs/">批踢踢實業坊</a></div>
        <div class="r-ent">
            <div class="nrec"><span class="hl f2">9</span></div>
            <div class="title">
                <a href="/bbs/Stock/M.1791535001.A.2E5.html">[情報] 4938 和碩 9月營收 &amp; 獲利</a>
            </div>
            <div class="meta">
                <div class="author">q1a1</div>
                <div class="date"> 10/09</div>
            </div>
        </div>
        <div class="r-ent">
            <div class="nrec"><span class="hl f1">爆</span></div>
            <div class="title">
                <a href="/bbs/Stock/M.1791536586.A.177.html">[新聞] 台積電最新法說會資訊整理</a>
            </div>
            <div class="meta">
                <div class="author">analyst</div>
                <div class="date"> 10/09</div>
            </div>
        </div>
        <div class="r-ent">
            <div class="nrec"></div>
            <div class="title">
                (本文已被刪除) [spammer]
            </div>
            <div class="meta">
                <div class="author">-</div>
                <div class="article-menu">
                    <div class="dropdown">
                        <div class="item"><a href="/bbs/Stock/search?q=author%3Aspammer">搜尋看板內文章</a></div>
                    </div>
                </div>
                <div class="date"> 10/09</div>
            </div>
        </div>
        "#;

        let articles = parse_ptt_articles_html(sample_html, "Stock");
        assert_eq!(articles.len(), 2);

        assert_eq!(articles[0].id, "M.1791535001.A.2E5");
        assert_eq!(articles[0].title, "[情報] 4938 和碩 9月營收 & 獲利");
        assert_eq!(articles[0].author, "q1a1");
        assert_eq!(articles[0].nrec, "9");
        assert_eq!(articles[0].date, "10/09");
        assert_eq!(articles[0].link, "/bbs/Stock/M.1791535001.A.2E5.html");
        assert_eq!(articles[0].board, "Stock");

        assert_eq!(articles[1].id, "M.1791536586.A.177");
        assert_eq!(articles[1].title, "[新聞] 台積電最新法說會資訊整理");
        assert_eq!(articles[1].author, "analyst");
        assert_eq!(articles[1].nrec, "爆");
    }

    #[test]
    fn test_telegram_payload_serialization() {
        let payload = super::TelegramSendMessagePayload {
            chat_id: "12345678",
            text: "Hello <b>PTT</b>",
            parse_mode: "HTML",
            disable_web_page_preview: true,
            disable_notification: Some(true),
            reply_markup: Some(super::InlineKeyboardMarkup {
                inline_keyboard: vec![vec![super::InlineKeyboardButton {
                    text: "📖 開啟 PTT 好讀版".to_string(),
                    url: "https://www.ptt.cc/bbs/Stock/M.123.html".to_string(),
                }]],
            }),
        };
        let json = serde_json::to_string(&payload).unwrap();
        assert!(json.contains("\"chat_id\":\"12345678\""));
        assert!(json.contains("\"parse_mode\":\"HTML\""));
        assert!(json.contains("\"disable_web_page_preview\":true"));
        assert!(json.contains("\"disable_notification\":true"));
        assert!(json.contains("\"inline_keyboard\""));
        assert!(json.contains("開啟 PTT 好讀版"));
    }

    #[test]
    #[cfg(target_os = "macos")]
    fn test_escape_applescript_string() {
        use super::escape_applescript_string;
        assert_eq!(
            escape_applescript_string(r#"Hello "World" \ test"#),
            r#"Hello \"World\" \\ test"#
        );
        assert_eq!(
            escape_applescript_string("Line 1\r\nLine 2"),
            "Line 1\nLine 2"
        );
    }
}



