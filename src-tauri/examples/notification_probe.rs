//! Send one native notification without opening the BBS client or contacting a server.
//! Run with `cargo run --example notification_probe` from `src-tauri/`.
use tauri_plugin_notification::NotificationExt;

fn main() {
    let title = std::env::args()
        .nth(1)
        .unwrap_or_else(|| "Waterball Linux 通知測試".to_string());
    let mut context = tauri::generate_context!();
    context.config_mut().app.windows.clear();

    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .setup(move |app| {
            app.notification()
                .builder()
                .title(title)
                .body("請確認這則通知會持續顯示，並保留在通知中心。")
                .show()?;
            eprintln!("Notification queued; keeping the sender alive for 60 seconds.");
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_secs(60));
                handle.exit(0);
            });
            Ok(())
        })
        .run(context)
        .expect("notification probe failed");
}
