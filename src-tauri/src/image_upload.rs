//! Bounded native image-host requests. Redirects are rejected, never replayed.
use std::collections::HashMap;

const MAX_IMAGE_BYTES: usize = 20 * 1024 * 1024;
const MAX_RESPONSE_BYTES: usize = 64 * 1024;

fn endpoint(value: &str) -> Result<reqwest::Url, String> {
    let text = value.trim();
    if text.chars().any(|c| c.is_control() || c.is_whitespace()) {
        return Err("圖床網址包含空白或控制字元".into());
    }
    let url = reqwest::Url::parse(text).map_err(|e| format!("網址格式錯誤: {e}"))?;
    if url.scheme() != "https"
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err("圖床 API 必須為不含帳密的 HTTPS 網址".into());
    }
    Ok(url)
}

fn client(seconds: u64) -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .https_only(true)
        .redirect(reqwest::redirect::Policy::none())
        .timeout(std::time::Duration::from_secs(seconds))
        .build()
        .map_err(|e| format!("無法建立 HTTP 客戶端: {e}"))
}

fn append_bounded(body: &mut Vec<u8>, chunk: &[u8]) -> Result<(), String> {
    if chunk.len() > MAX_RESPONSE_BYTES.saturating_sub(body.len()) {
        return Err("圖床回應超過 64KB 限制".into());
    }
    body.extend_from_slice(chunk);
    Ok(())
}

async fn response_text(mut response: reqwest::Response) -> Result<String, String> {
    let status = response.status();
    if response
        .content_length()
        .is_some_and(|size| size > MAX_RESPONSE_BYTES as u64)
    {
        return Err("圖床回應超過 64KB 限制".into());
    }
    let mut body = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|e| format!("讀取回應失敗: {e}"))?
    {
        append_bounded(&mut body, &chunk)?;
    }
    let text = String::from_utf8(body).map_err(|_| "圖床回應不是 UTF-8".to_string())?;
    if !status.is_success() {
        return Err(format!("HTTP {}: {}", status.as_u16(), text));
    }
    Ok(text)
}

fn valid_field(value: &str) -> bool {
    !value.is_empty()
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}

pub async fn upload(
    url: String,
    file_field: String,
    file_fields: Option<Vec<String>>,
    file_name: String,
    file_bytes: Vec<u8>,
    fields: Vec<(String, String)>,
    headers: Option<HashMap<String, String>>,
) -> Result<String, String> {
    if file_bytes.is_empty() || file_bytes.len() > MAX_IMAGE_BYTES {
        return Err("圖片內容為空或超過 20MB 限制".into());
    }
    let url = endpoint(&url)?;
    let names = file_fields.unwrap_or_else(|| vec![file_field]);
    if names.is_empty()
        || names.len() > 2
        || names.iter().any(|n| !valid_field(n))
        || fields.len() > 8
        || fields
            .iter()
            .any(|(k, v)| !valid_field(k) || v.len() > 4096)
        || file_name.is_empty()
        || file_name.len() > 128
        || file_name
            .chars()
            .any(|c| c.is_control() || c == '"' || c == '\\')
    {
        return Err("無效的圖片表單欄位".into());
    }
    let boundary = format!(
        "----WaterballBoundary{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos()
    );
    let mut body = Vec::new();
    for (key, value) in fields {
        body.extend_from_slice(
            format!(
                "--{boundary}\r\nContent-Disposition: form-data; name=\"{key}\"\r\n\r\n{value}\r\n"
            )
            .as_bytes(),
        );
    }
    for name in names {
        body.extend_from_slice(format!("--{boundary}\r\nContent-Disposition: form-data; name=\"{name}\"; filename=\"{file_name}\"\r\nContent-Type: image/png\r\n\r\n").as_bytes());
        body.extend_from_slice(&file_bytes);
        body.extend_from_slice(b"\r\n");
    }
    body.extend_from_slice(format!("--{boundary}--\r\n").as_bytes());
    let mut request = client(30)?
        .post(url)
        .header(
            "Content-Type",
            format!("multipart/form-data; boundary={boundary}"),
        )
        .body(body);
    if let Some(headers) = headers {
        for (key, value) in headers {
            request = request.header(key, value);
        }
    }
    response_text(request.send().await.map_err(|e| format!("連線失敗: {e}"))?).await
}

pub async fn delete(
    url: String,
    headers: Option<HashMap<String, String>>,
) -> Result<String, String> {
    let url = endpoint(&url)?;
    let hash = url.path().strip_prefix("/3/image/").unwrap_or("");
    if url.host_str() != Some("api.imgur.com")
        || url.port().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
        || !valid_field(hash)
    {
        return Err("僅允許 Imgur 圖片撤回端點".into());
    }
    let mut request = client(15)?.delete(url);
    if let Some(headers) = headers {
        for (key, value) in headers {
            request = request.header(key, value);
        }
    }
    response_text(request.send().await.map_err(|e| format!("連線失敗: {e}"))?).await
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn endpoints_reject_plaintext_credentials_and_controls() {
        for url in [
            "http://host/upload",
            "https://user:pass@host/upload",
            "https://host/up\nload",
            "file:///image.png",
        ] {
            assert!(endpoint(url).is_err(), "{url:?}");
        }
        assert!(endpoint("https://host/upload").is_ok());
    }
    #[test]
    fn response_limit_is_incremental_and_counts_bytes() {
        let mut body = vec![0; MAX_RESPONSE_BYTES - 1];
        assert!(append_bounded(&mut body, &[1]).is_ok());
        assert!(append_bounded(&mut body, &[2]).is_err());
        assert_eq!(body.len(), MAX_RESPONSE_BYTES);
    }
    #[test]
    fn multipart_names_cannot_inject_headers() {
        assert!(valid_field("fileToUpload"));
        for name in ["", "file\r\nX: yes", "file\"", "../image"] {
            assert!(!valid_field(name));
        }
    }
    #[tokio::test]
    async fn native_client_refuses_http_before_network() {
        assert!(client(1)
            .unwrap()
            .get("http://127.0.0.1:1/")
            .send()
            .await
            .is_err());
    }
}
