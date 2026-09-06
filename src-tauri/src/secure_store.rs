// OS Native Keyring (macOS Keychain / Windows Credential Manager / Linux Secret Service)
// with Restricted Permissions File Fallback (0600) for Waterball BBS

use keyring::Entry;
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

const SERVICE_NAME: &str = "com.waterball.bbsterm";
static FILE_VAULT_LOCK: Mutex<()> = Mutex::new(());

fn get_vault_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data directory: {}", e))?;
    if !dir.exists() {
        fs::create_dir_all(&dir)
            .map_err(|e| format!("Failed to create app data directory: {}", e))?;
    }
    Ok(dir.join("credentials.vault"))
}

fn read_fallback_vault(app: &AppHandle) -> Result<HashMap<String, String>, String> {
    let _lock = FILE_VAULT_LOCK.lock().map_err(|e| e.to_string())?;
    let path = get_vault_path(app)?;
    if !path.exists() {
        return Ok(HashMap::new());
    }
    let data = fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read credentials vault: {}", e))?;
    let map: HashMap<String, String> = serde_json::from_str(&data).unwrap_or_default();
    Ok(map)
}

fn write_fallback_vault(app: &AppHandle, map: &HashMap<String, String>) -> Result<(), String> {
    let _lock = FILE_VAULT_LOCK.lock().map_err(|e| e.to_string())?;
    let path = get_vault_path(app)?;
    let data = serde_json::to_string_pretty(map)
        .map_err(|e| format!("Failed to serialize credentials vault: {}", e))?;
    
    fs::write(&path, data)
        .map_err(|e| format!("Failed to write credentials vault: {}", e))?;

    // Restrict file permission to 0600 (read/write only by owner) on Unix systems
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(&path, fs::Permissions::from_mode(0o600));
    }

    Ok(())
}

#[tauri::command]
pub async fn secure_save_credential(
    app: AppHandle,
    key: String,
    secret: String,
) -> Result<(), String> {
    // 1. Try OS Native Keyring first (macOS Keychain, Windows Credential Manager, Linux Secret Service)
    match Entry::new(SERVICE_NAME, &key) {
        Ok(entry) => {
            if let Ok(()) = entry.set_password(&secret) {
                // Successfully saved in OS Keyring; remove from fallback vault if it was there
                if let Ok(mut vault) = read_fallback_vault(&app) {
                    if vault.remove(&key).is_some() {
                        let _ = write_fallback_vault(&app, &vault);
                    }
                }
                return Ok(());
            }
        }
        Err(err) => {
            log::warn!("[SecureStore] Keyring entry creation failed: {}", err);
        }
    }

    // 2. Fallback to restricted 0600 vault file
    log::info!("[SecureStore] Falling back to restricted file vault for key: {}", key);
    let mut vault = read_fallback_vault(&app)?;
    vault.insert(key, secret);
    write_fallback_vault(&app, &vault)?;
    Ok(())
}

#[tauri::command]
pub async fn secure_get_credential(
    app: AppHandle,
    key: String,
) -> Result<Option<String>, String> {
    // 1. Try OS Native Keyring first
    if let Ok(entry) = Entry::new(SERVICE_NAME, &key) {
        if let Ok(password) = entry.get_password() {
            return Ok(Some(password));
        }
    }

    // 2. Try Fallback vault
    let vault = read_fallback_vault(&app)?;
    Ok(vault.get(&key).cloned())
}

#[tauri::command]
pub async fn secure_delete_credential(
    app: AppHandle,
    key: String,
) -> Result<(), String> {
    // Delete from OS Native Keyring
    if let Ok(entry) = Entry::new(SERVICE_NAME, &key) {
        let _ = entry.delete_credential();
    }

    // Also delete from Fallback vault
    if let Ok(mut vault) = read_fallback_vault(&app) {
        if vault.remove(&key).is_some() {
            let _ = write_fallback_vault(&app, &vault);
        }
    }

    Ok(())
}

#[tauri::command]
pub async fn secure_store_backend() -> Result<String, String> {
    // Test if OS Native Keyring is functional
    let test_key = "__waterball_keyring_probe__";
    if let Ok(entry) = Entry::new(SERVICE_NAME, test_key) {
        if entry.set_password("probe").is_ok() {
            let _ = entry.delete_credential();
            #[cfg(target_os = "macos")]
            return Ok("macOS Keychain".to_string());
            #[cfg(target_os = "windows")]
            return Ok("Windows Credential Manager".to_string());
            #[cfg(target_os = "linux")]
            return Ok("Linux Secret Service".to_string());
            #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
            return Ok("OS Native Keyring".to_string());
        }
    }
    Ok("Restricted File Vault (chmod 0600)".to_string())
}
