mod telnet;

use std::collections::HashMap;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, State};
use telnet::{BbsCharset, BbsConnection, ConnectionStatusPayload};

struct ConnectionState(Mutex<HashMap<String, BbsConnection>>);

#[tauri::command]
async fn connect(
    app: AppHandle,
    state: State<'_, ConnectionState>,
    tab_id: String,
    address: String,
    port: u16,
    charset: Option<String>,
) -> Result<String, String> {
    // Disconnect existing connection for this tab if any
    {
        let mut map = state.0.lock().map_err(|e| e.to_string())?;
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
                let mut map = state.0.lock().map_err(|e| e.to_string())?;
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
                let mut map = state.0.lock().map_err(|e| e.to_string())?;
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
    state: State<'_, ConnectionState>,
    tab_id: String,
    charset: String,
) -> Result<(), String> {
    let map = state.0.lock().map_err(|e| e.to_string())?;
    if let Some(conn) = map.get(&tab_id) {
        conn.set_charset(BbsCharset::from_str(&charset));
        Ok(())
    } else {
        Err(format!("Tab {} not connected", tab_id))
    }
}

#[tauri::command]
async fn send_input(
    state: State<'_, ConnectionState>,
    tab_id: String,
    data: String,
) -> Result<(), String> {
    let map = state.0.lock().map_err(|e| e.to_string())?;
    if let Some(conn) = map.get(&tab_id) {
        conn.send(&data).map_err(|e| e.to_string())
    } else {
        Err(format!("Tab {} not connected", tab_id))
    }
}

#[tauri::command]
async fn send_bytes(
    state: State<'_, ConnectionState>,
    tab_id: String,
    bytes: Vec<u8>,
) -> Result<(), String> {
    let map = state.0.lock().map_err(|e| e.to_string())?;
    if let Some(conn) = map.get(&tab_id) {
        conn.send_raw(&bytes).map_err(|e| e.to_string())
    } else {
        Err(format!("Tab {} not connected", tab_id))
    }
}

#[tauri::command]
async fn disconnect(
    app: AppHandle,
    state: State<'_, ConnectionState>,
    tab_id: String,
) -> Result<(), String> {
    let mut map = state.0.lock().map_err(|e| e.to_string())?;
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
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(ConnectionState(Mutex::new(HashMap::new())))
        .invoke_handler(tauri::generate_handler![
            connect,
            set_charset,
            send_input,
            send_bytes,
            disconnect,
            open_browser_url,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
