use tauri::{AppHandle, Runtime, Url};
use tauri_plugin_notification::{ActionPerformed, NotificationBuilder, NotificationExt};
use tauri_plugin_opener::OpenerExt;

// Match the article-only URL policy used by the native macOS implementation.
fn article_url(value: &str) -> Option<Url> {
    let url = Url::parse(value).ok()?;
    if url.scheme() != "https"
        || !matches!(url.host_str(), Some("www.ptt.cc" | "ptt.cc"))
        || !url.username().is_empty()
        || url.password().is_some()
        || url.port().is_some()
    {
        return None;
    }
    let parts: Vec<_> = url.path_segments()?.collect();
    if parts.len() != 3 || parts[0] != "bbs" {
        return None;
    }
    let board = parts[1];
    let file = parts[2];
    if board.is_empty()
        || !board
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || b"_-".contains(&c))
        || !file.ends_with(".html")
        || file.len() <= ".html".len()
        || !file
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || b"_.-".contains(&c))
    {
        return None;
    }
    Some(url)
}

pub fn attach_article_url<R: Runtime>(
    builder: NotificationBuilder<R>,
    url: Option<String>,
) -> NotificationBuilder<R> {
    match url.as_deref().and_then(article_url) {
        Some(url) => builder.extra("url", url.as_str()),
        None => builder,
    }
}

fn clicked_article_url(action: &ActionPerformed) -> Option<Url> {
    if action.action_id() != "tap" {
        return None;
    }
    article_url(action.notification()?.extra().get("url")?.as_str()?)
}

pub fn register_click_handler<R: Runtime>(
    app: &AppHandle<R>,
) -> Result<(), tauri_plugin_notification::Error> {
    let handle = app.clone();
    app.notification().on_action(move |action| {
        if let Some(url) = clicked_article_url(action) {
            let handle = handle.clone();
            tauri::async_runtime::spawn_blocking(move || {
                if let Err(error) = handle.opener().open_url(url.as_str(), None::<&str>) {
                    eprintln!("[notification] Failed to open article: {error}");
                }
            });
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn action(kind: &str, url: serde_json::Value) -> ActionPerformed {
        serde_json::from_value(json!({
            "actionId": kind,
            "notification": { "id": 1, "extra": { "url": url } }
        }))
        .unwrap()
    }

    #[test]
    fn notification_click_accepts_ptt_article_urls() {
        for url in [
            "https://www.ptt.cc/bbs/Stock/M.1234567890.A.ABC.html",
            "https://ptt.cc/bbs/C_Chat/M.123.html",
        ] {
            assert_eq!(
                clicked_article_url(&action("tap", json!(url)))
                    .unwrap()
                    .as_str(),
                url
            );
        }
    }

    #[test]
    fn test_notifications_and_dismissals_do_not_open_a_browser() {
        assert!(clicked_article_url(&action("tap", json!(null))).is_none());
        assert!(clicked_article_url(&action("tap", json!(""))).is_none());
        assert!(clicked_article_url(&action(
            "dismiss",
            json!("https://www.ptt.cc/bbs/Stock/M.123.html")
        ))
        .is_none());
        let action =
            serde_json::from_value(json!({ "actionId": "tap", "notification": null })).unwrap();
        assert!(clicked_article_url(&action).is_none());
    }

    #[test]
    fn notification_click_rejects_non_article_destinations() {
        for url in [
            "http://www.ptt.cc/bbs/Stock/M.123.html",
            "https://www.ptt.cc.evil.test/bbs/Stock/M.123.html",
            "https://www.ptt.cc@evil.test/bbs/Stock/M.123.html",
            "https://name@www.ptt.cc/bbs/Stock/M.123.html",
            "https://www.ptt.cc:8443/bbs/Stock/M.123.html",
            "file:///tmp/M.123.html",
            "https://www.ptt.cc/bbs/Stock/",
            "https://www.ptt.cc/bbs/Stock/M.123.html/extra",
            "https://www.ptt.cc/bbs/Stock/M.%2F.html",
        ] {
            assert!(
                clicked_article_url(&action("tap", json!(url))).is_none(),
                "{url}"
            );
        }
    }
}
