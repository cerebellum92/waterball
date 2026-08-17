mod telnet;

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, State};
use telnet::{BbsCharset, BbsConnection, ConnectionStatusPayload};

pub struct AntiIdleSettings {
    pub enabled: bool,
    pub interval_secs: u64,
}

pub struct AppState {
    pub connections: Arc<Mutex<HashMap<String, BbsConnection>>>,
    pub anti_idle: Arc<Mutex<AntiIdleSettings>>,
}

#[tauri::command]
async fn connect(
    app: AppHandle,
    state: State<'_, AppState>,
    tab_id: String,
    address: String,
    port: u16,
    charset: Option<String>,
) -> Result<String, String> {
    // Disconnect existing connection for this tab if any
    {
        let mut map = state.connections.lock().map_err(|e| e.to_string())?;
        if let Some(old) = map.remove(&tab_id) {
            old.disconnect();
        }
    }

    let is_ssh = port == 22 || port == 8888;
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

    if is_ssh {
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let connections = Arc::new(Mutex::new(HashMap::<String, BbsConnection>::new()));
    let anti_idle = Arc::new(Mutex::new(AntiIdleSettings {
        enabled: true,
        interval_secs: 45, // default 45 seconds heartbeat
    }));

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
    };

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(app_state)
        .invoke_handler(tauri::generate_handler![
            connect,
            set_charset,
            send_input,
            send_bytes,
            record_activity,
            set_anti_idle,
            disconnect,
            open_browser_url,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
