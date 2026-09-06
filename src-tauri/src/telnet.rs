use encoding_rs::{BIG5, GBK};
use std::io::{Read, Write};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, RwLock};
use tauri::{AppHandle, Emitter};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum BbsCharset {
    Big5,
    Utf8,
    Gbk,
}

impl BbsCharset {
    pub fn from_str(s: &str) -> Self {
        match s.to_lowercase().as_str() {
            "utf8" | "utf-8" => BbsCharset::Utf8,
            "gbk" | "gb2312" | "gb18030" => BbsCharset::Gbk,
            _ => BbsCharset::Big5,
        }
    }
}

#[derive(Clone, serde::Serialize)]
pub struct TerminalDataPayload {
    pub tab_id: String,
    pub data: String,
}

#[derive(Clone, serde::Serialize)]
pub struct ConnectionStatusPayload {
    pub tab_id: String,
    pub status: String,
}

pub struct BbsConnection {
    writer: Arc<std::sync::Mutex<Box<dyn Write + Send>>>,
    alive: Arc<AtomicBool>,
    charset: Arc<RwLock<BbsCharset>>,
    is_ssh: bool,
    last_activity: Arc<std::sync::Mutex<std::time::Instant>>,
}

impl BbsConnection {
    /// Connect via raw TCP (Telnet) to a BBS server
    pub async fn connect_telnet(
        tab_id: String,
        address: &str,
        port: u16,
        charset: BbsCharset,
        app: AppHandle,
    ) -> Result<Self, String> {
        use std::net::ToSocketAddrs;
        let socket_addr = format!("{}:{}", address, port)
            .to_socket_addrs()
            .map_err(|e| format!("DNS resolution failed: {}", e))?
            .next()
            .ok_or_else(|| "No addresses found".to_string())?;

        let stream = std::net::TcpStream::connect_timeout(
            &socket_addr,
            std::time::Duration::from_secs(10),
        ).map_err(|e| format!("Connection failed: {}", e))?;

        stream.set_nonblocking(false).ok();
        stream.set_nodelay(true).ok();
        stream.set_read_timeout(Some(std::time::Duration::from_millis(100))).ok();

        let mut writer_stream = stream.try_clone()
            .map_err(|e| format!("Failed to clone stream: {}", e))?;
        writer_stream.set_nodelay(true).ok();
        let reader_stream = stream;

        // Send initial Telnet terminal type negotiation: IAC WILL TTYPE, IAC WILL NAWS
        let init_naws = [
            0xFF, 0xFB, 0x1F, // IAC WILL NAWS
            0xFF, 0xFA, 0x1F, 0x00, 0x50, 0x00, 0x18, 0xFF, 0xF0, // NAWS 80x24
            0xFF, 0xFB, 0x18, // IAC WILL TTYPE
        ];
        let _ = writer_stream.write_all(&init_naws);
        let _ = writer_stream.flush();

        let writer: Box<dyn Write + Send> = Box::new(writer_stream);
        let writer = Arc::new(std::sync::Mutex::new(writer));
        let alive = Arc::new(AtomicBool::new(true));
        let charset = Arc::new(RwLock::new(charset));

        let _ = app.emit("connection-status", ConnectionStatusPayload {
            tab_id: tab_id.clone(),
            status: "connected".to_string(),
        });

        // Spawn reader thread
        let alive_clone = alive.clone();
        let charset_clone = charset.clone();
        let app_clone = app.clone();
        let tab_id_clone = tab_id.clone();
        std::thread::spawn(move || {
            Self::read_loop_telnet(tab_id_clone, reader_stream, alive_clone, charset_clone, app_clone);
        });

        let last_activity = Arc::new(std::sync::Mutex::new(std::time::Instant::now()));

        Ok(BbsConnection {
            writer,
            alive,
            charset,
            is_ssh: false,
            last_activity,
        })
    }

    /// Connect via pure Rust native SSH (libssh2) with zero ConPTY / CodePage interference
    pub async fn connect_ssh(
        tab_id: String,
        address: &str,
        port: u16,
        charset: BbsCharset,
        app: AppHandle,
    ) -> Result<Self, String> {
        let (user, host) = if let Some(idx) = address.find('@') {
            (&address[..idx], &address[idx + 1..])
        } else {
            ("bbs", address)
        };

        let target_host = host.to_string();
        let target_user = user.to_string();
        let target_port = port;

        let (tx, rx) = tokio::sync::oneshot::channel();

        std::thread::spawn(move || {
            let res = (|| -> Result<(Arc<std::sync::Mutex<ssh2::Channel>>, Arc<std::sync::Mutex<ssh2::Session>>), String> {
                let addr = format!("{}:{}", target_host, target_port);
                let tcp = std::net::TcpStream::connect(&addr)
                    .map_err(|e| format!("無法連線到 {}: {}", addr, e))?;
                tcp.set_nodelay(true).ok();

                let mut sess = ssh2::Session::new()
                    .map_err(|e| format!("建立 SSH Session 失敗: {}", e))?;
                sess.set_tcp_stream(tcp);
                sess.set_blocking(true);
                sess.set_timeout(15000);
                sess.handshake()
                    .map_err(|e| format!("SSH 握手失敗: {}", e))?;

                // Query supported auth methods (this also sends userauth_none which authenticates some BBS servers automatically)
                let auth_methods = sess.auth_methods(&target_user).unwrap_or("");
                println!("[SSH] Supported auth methods for {}: {}", target_user, auth_methods);

                if !sess.authenticated() {
                    let _ = sess.userauth_password(&target_user, "");
                }
                if !sess.authenticated() {
                    let _ = sess.userauth_password(&target_user, "bbs");
                }
                if !sess.authenticated() {
                    let _ = sess.userauth_password(&target_user, &target_user);
                }
                if !sess.authenticated() {
                    struct EmptyPromptHandler;
                    impl ssh2::KeyboardInteractivePrompt for EmptyPromptHandler {
                        fn prompt<'a>(
                            &mut self,
                            _username: &str,
                            _instructions: &str,
                            prompts: &[ssh2::Prompt<'a>],
                        ) -> Vec<String> {
                            prompts.iter().map(|_| "".to_string()).collect()
                        }
                    }
                    let mut handler = EmptyPromptHandler;
                    let _ = sess.userauth_keyboard_interactive(&target_user, &mut handler);
                }

                if !sess.authenticated() {
                    return Err(format!("SSH 認證失敗 (伺服器要求方式: {})", auth_methods));
                }

                let mut channel = sess.channel_session()
                    .map_err(|e| format!("開啟 SSH 通道失敗: {}", e))?;

                channel.request_pty("vt100", None, Some((80, 24, 0, 0)))
                    .map_err(|e| format!("請求 PTY 失敗: {}", e))?;

                channel.shell()
                    .map_err(|e| format!("啟動 Shell 失敗: {}", e))?;

                // Switch SSH session to non-blocking mode for full-duplex non-blocking IO and instant user key writing
                sess.set_blocking(false);

                Ok((Arc::new(std::sync::Mutex::new(channel)), Arc::new(std::sync::Mutex::new(sess))))
            })();

            let _ = tx.send(res);
        });

        let (channel, _sess) = rx.await
            .map_err(|_| "SSH 連線被取消".to_string())??;

        let alive = Arc::new(AtomicBool::new(true));
        let charset = Arc::new(RwLock::new(charset));

        let _ = app.emit("connection-status", ConnectionStatusPayload {
            tab_id: tab_id.clone(),
            status: "connected".to_string(),
        });

        // Spawn reader thread
        let alive_clone = alive.clone();
        let charset_clone = charset.clone();
        let app_clone = app.clone();
        let tab_id_clone = tab_id.clone();
        let channel_clone = channel.clone();

        std::thread::spawn(move || {
            Self::read_loop_ssh2(tab_id_clone, channel_clone, alive_clone, charset_clone, app_clone);
        });

        struct SshChannelWriter(Arc<std::sync::Mutex<ssh2::Channel>>);
        impl Write for SshChannelWriter {
            fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
                let mut ch = self.0.lock().map_err(|_| std::io::Error::new(std::io::ErrorKind::Other, "Lock error"))?;
                ch.write(buf)
            }
            fn flush(&mut self) -> std::io::Result<()> {
                let mut ch = self.0.lock().map_err(|_| std::io::Error::new(std::io::ErrorKind::Other, "Lock error"))?;
                ch.flush()
            }
        }

        let writer: Box<dyn Write + Send> = Box::new(SshChannelWriter(channel));
        let writer = Arc::new(std::sync::Mutex::new(writer));
        let last_activity = Arc::new(std::sync::Mutex::new(std::time::Instant::now()));

        Ok(BbsConnection {
            writer,
            alive,
            charset,
            is_ssh: true,
            last_activity,
        })
    }

    /// Read loop for Telnet connections
    fn read_loop_telnet(
        tab_id: String,
        mut reader: std::net::TcpStream,
        alive: Arc<AtomicBool>,
        charset: Arc<RwLock<BbsCharset>>,
        app: AppHandle,
    ) {
        let mut buf = [0u8; 4096];
        let mut pending_iac = Vec::new();
        let mut pending_charset = Vec::new();

        while alive.load(Ordering::Relaxed) {
            match reader.read(&mut buf) {
                Ok(0) => {
                    if !pending_charset.is_empty() {
                        let _ = app.emit("terminal-data", TerminalDataPayload {
                            tab_id: tab_id.clone(),
                            data: " ".to_string(),
                        });
                    }
                    alive.store(false, Ordering::Relaxed);
                    let _ = app.emit("connection-status", ConnectionStatusPayload {
                        tab_id: tab_id.clone(),
                        status: "disconnected".to_string(),
                    });
                    break;
                }
                Ok(n) => {
                    // 1. Telnet Protocol IAC Stripping
                    let mut iac_input = Vec::with_capacity(pending_iac.len() + n);
                    if !pending_iac.is_empty() {
                        iac_input.extend_from_slice(&pending_iac);
                        pending_iac.clear();
                    }
                    iac_input.extend_from_slice(&buf[..n]);

                    let clean = Self::strip_telnet_commands(&mut iac_input);
                    pending_iac.extend_from_slice(&iac_input);

                    // 2. Charset & ANSI Decoding
                    if !clean.is_empty() {
                        let cs = charset.read().map(|g| *g).unwrap_or(BbsCharset::Big5);
                        let decoded = Self::decode_ansi_stream(&clean, cs, &mut pending_charset);
                        if !decoded.is_empty() {
                            let _ = app.emit("terminal-data", TerminalDataPayload {
                                tab_id: tab_id.clone(),
                                data: decoded,
                            });
                        }
                    }
                }
                Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock
                    || e.kind() == std::io::ErrorKind::TimedOut => {
                    continue;
                }
                Err(_) => {
                    alive.store(false, Ordering::Relaxed);
                    let _ = app.emit("connection-status", ConnectionStatusPayload {
                        tab_id: tab_id.clone(),
                        status: "disconnected".to_string(),
                    });
                    break;
                }
            }
        }
    }

    /// Read loop for pure Rust native SSH connections
    fn read_loop_ssh2(
        tab_id: String,
        channel: Arc<std::sync::Mutex<ssh2::Channel>>,
        alive: Arc<AtomicBool>,
        charset: Arc<RwLock<BbsCharset>>,
        app: AppHandle,
    ) {
        let mut buf = [0u8; 4096];
        let mut pending_charset = Vec::new();

        while alive.load(Ordering::Relaxed) {
            let read_res = {
                let mut ch = match channel.lock() {
                    Ok(guard) => guard,
                    Err(_) => break,
                };
                ch.read(&mut buf)
            };

            match read_res {
                Ok(0) => {
                    let is_eof = {
                        let ch = match channel.lock() {
                            Ok(g) => g,
                            Err(_) => break,
                        };
                        ch.eof()
                    };
                    if is_eof {
                        if !pending_charset.is_empty() {
                            let _ = app.emit("terminal-data", TerminalDataPayload {
                                tab_id: tab_id.clone(),
                                data: " ".to_string(),
                            });
                        }
                        alive.store(false, Ordering::Relaxed);
                        let _ = app.emit("connection-status", ConnectionStatusPayload {
                            tab_id: tab_id.clone(),
                            status: "disconnected".to_string(),
                        });
                        break;
                    }
                    std::thread::sleep(std::time::Duration::from_millis(5));
                }
                Ok(n) => {
                    let cs = charset.read().map(|g| *g).unwrap_or(BbsCharset::Big5);
                    let decoded = Self::decode_ansi_stream(&buf[..n], cs, &mut pending_charset);
                    if !decoded.is_empty() {
                        let _ = app.emit("terminal-data", TerminalDataPayload {
                            tab_id: tab_id.clone(),
                            data: decoded,
                        });
                    }
                }
                Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock
                    || e.kind() == std::io::ErrorKind::TimedOut => {
                    std::thread::sleep(std::time::Duration::from_millis(5));
                    continue;
                }
                Err(_) => {
                    alive.store(false, Ordering::Relaxed);
                    let _ = app.emit("connection-status", ConnectionStatusPayload {
                        tab_id: tab_id.clone(),
                        status: "disconnected".to_string(),
                    });
                    break;
                }
            }
        }
    }

    /// Dispatch stream decoding based on current charset
    fn decode_ansi_stream(
        raw: &[u8],
        charset: BbsCharset,
        pending_bytes: &mut Vec<u8>,
    ) -> String {
        match charset {
            BbsCharset::Big5 => Self::decode_ansi_big5(raw, pending_bytes),
            BbsCharset::Gbk => Self::decode_ansi_gbk(raw, pending_bytes),
            BbsCharset::Utf8 => Self::decode_ansi_utf8(raw, pending_bytes),
        }
    }

    /// MapleBBS / PCMan ANSI Big5-UAO 2.50 byte-level decoder:
    /// - Full Big5-UAO 2.50 Unicode-At-On table lookup (19,782 mappings including Taiwanese romanization, Japanese Kana, Cyrillic, Greek, symbols)
    /// - Multi-byte UTF-8 passthrough fallback for pasted Unicode text
    /// - High bytes at the very end of raw stream held in pending_bytes for the next chunk
    /// - Standalone Big5 lead bytes right before ESC turned to single space, preserving exact 80-column alignment
    fn decode_ansi_big5(raw: &[u8], pending_bytes: &mut Vec<u8>) -> String {
        let mut buffer = Vec::with_capacity(pending_bytes.len() + raw.len());
        buffer.extend_from_slice(pending_bytes);
        buffer.extend_from_slice(raw);
        pending_bytes.clear();

        let mut out = String::with_capacity(buffer.len());
        let mut i = 0;
        while i < buffer.len() {
            let b = buffer[i];
            if b < 0x80 {
                out.push(b as char);
                i += 1;
                continue;
            }

            // 1. 4-byte UTF-8 Passthrough (Emoji & Supplemental Symbols): 0xF0..=0xF4
            if (0xF0..=0xF4).contains(&b) && i + 3 < buffer.len() {
                let b2 = buffer[i + 1];
                let b3 = buffer[i + 2];
                let b4 = buffer[i + 3];
                if (0x80..=0xBF).contains(&b2) && (0x80..=0xBF).contains(&b3) && (0x80..=0xBF).contains(&b4) {
                    if let Ok(s) = std::str::from_utf8(&buffer[i..i + 4]) {
                        out.push_str(s);
                        i += 4;
                        continue;
                    }
                }
            }

            // 2. 3-byte UTF-8 Passthrough: 0xE0..=0xEF
            // If the 2nd byte is in 0x80..=0x9F, it is NOT a valid Big5 trail byte (Big5 trails are 0x40..=0x7E, 0xA1..=0xFE)
            if (0xE0..=0xEF).contains(&b) && i + 2 < buffer.len() {
                let b2 = buffer[i + 1];
                let b3 = buffer[i + 2];
                if (0x80..=0xBF).contains(&b2) && (0x80..=0xBF).contains(&b3) {
                    if let Ok(s) = std::str::from_utf8(&buffer[i..i + 3]) {
                        if b2 < 0xA1 || crate::uao::decode_uao_char(b, b2).is_none() {
                            out.push_str(s);
                            i += 3;
                            continue;
                        }
                    }
                }
            }

            // 3. Big5 / Big5-UAO 2.50 2-Byte Decoding
            if i + 1 < buffer.len() {
                if buffer[i + 1] == 0x1B {
                    // Standalone lead byte right before ESC => emit single space to maintain 1-cell width
                    out.push(' ');
                    i += 1;
                } else {
                    let hi = b;
                    let lo = buffer[i + 1];
                    if let Some(ch) = crate::uao::decode_uao_char(hi, lo) {
                        out.push(ch);
                        i += 2;
                    } else {
                        // Fallback: Check if this is a 2-byte UTF-8 sequence (0xC2..=0xDF, 0x80..=0xBF)
                        if (0xC2..=0xDF).contains(&hi) && (0x80..=0xBF).contains(&lo) {
                            if let Ok(s) = std::str::from_utf8(&buffer[i..i + 2]) {
                                out.push_str(s);
                                i += 2;
                                continue;
                            }
                        }
                        // Truly invalid byte: emit space without skipping next byte if next byte is ASCII
                        out.push(' ');
                        i += 1;
                    }
                }
            } else {
                // b is the last byte in raw buffer. Hold for next packet
                pending_bytes.push(b);
                i += 1;
            }
        }
        out
    }

    /// GBK byte-level decoder with ANSI lead byte handling
    fn decode_ansi_gbk(raw: &[u8], pending_bytes: &mut Vec<u8>) -> String {
        let mut buffer = Vec::with_capacity(pending_bytes.len() + raw.len());
        buffer.extend_from_slice(pending_bytes);
        buffer.extend_from_slice(raw);
        pending_bytes.clear();

        let mut out = String::with_capacity(buffer.len());
        let mut i = 0;
        while i < buffer.len() {
            let b = buffer[i];
            if b < 0x80 {
                out.push(b as char);
                i += 1;
                continue;
            }

            if i + 1 < buffer.len() {
                if buffer[i + 1] == 0x1B {
                    out.push(' ');
                    i += 1;
                } else {
                    let pair = &buffer[i..i + 2];
                    let (decoded, _, malformed) = GBK.decode(pair);
                    if !malformed {
                        out.push_str(&decoded);
                        i += 2;
                    } else {
                        out.push(' ');
                        i += 1;
                    }
                }
            } else {
                pending_bytes.push(b);
                i += 1;
            }
        }
        out
    }

    /// UTF-8 streaming decoder
    fn decode_ansi_utf8(raw: &[u8], pending_bytes: &mut Vec<u8>) -> String {
        pending_bytes.extend_from_slice(raw);
        match std::str::from_utf8(pending_bytes) {
            Ok(valid_str) => {
                let out = valid_str.to_string();
                pending_bytes.clear();
                out
            }
            Err(err) => {
                let valid_up_to = err.valid_up_to();
                let out = if valid_up_to > 0 {
                    std::str::from_utf8(&pending_bytes[..valid_up_to]).unwrap_or("").to_string()
                } else {
                    String::new()
                };
                let remaining = pending_bytes[valid_up_to..].to_vec();
                *pending_bytes = remaining;
                if let Some(err_len) = err.error_len() {
                    pending_bytes.drain(..err_len);
                }
                out
            }
        }
    }

    /// Strip Telnet IAC commands from data stream
    fn strip_telnet_commands(data: &mut Vec<u8>) -> Vec<u8> {
        let mut clean = Vec::with_capacity(data.len());
        let mut i = 0;
        while i < data.len() {
            if data[i] == 0xFF {
                // IAC
                if i + 1 >= data.len() {
                    *data = data[i..].to_vec();
                    return clean;
                }
                match data[i + 1] {
                    0xFB | 0xFC | 0xFD | 0xFE => {
                        if i + 2 >= data.len() {
                            *data = data[i..].to_vec();
                            return clean;
                        }
                        i += 3;
                    }
                    0xFA => {
                        let mut j = i + 2;
                        while j + 1 < data.len() {
                            if data[j] == 0xFF && data[j + 1] == 0xF0 {
                                j += 2;
                                break;
                            }
                            j += 1;
                        }
                        if j + 1 >= data.len() && !(data[j - 2] == 0xFF && data[j - 1] == 0xF0) {
                            *data = data[i..].to_vec();
                            return clean;
                        }
                        i = j;
                    }
                    0xFF => {
                        clean.push(0xFF);
                        i += 2;
                    }
                    _ => {
                        i += 2;
                    }
                }
            } else {
                clean.push(data[i]);
                i += 1;
            }
        }
        data.clear();
        clean
    }

    /// Set dynamic charset during active connection
    pub fn set_charset(&self, cs: BbsCharset) {
        if let Ok(mut lock) = self.charset.write() {
            *lock = cs;
        }
    }

    /// Send string data (UTF-8 / Big5 / GBK encoded)
    pub fn send(&self, data: &str) -> Result<(), std::io::Error> {
        let mut writer = self.writer.lock().unwrap();
        let cs = self.charset.read().map(|g| *g).unwrap_or(BbsCharset::Big5);
        match cs {
            BbsCharset::Utf8 => {
                writer.write_all(data.as_bytes())?;
            }
            BbsCharset::Big5 => {
                let mut encoded = Vec::with_capacity(data.len() * 2);
                for ch in data.chars() {
                    if ch.is_ascii() {
                        encoded.push(ch as u8);
                    } else if ch == '\u{00a0}' || ('\u{2000}'..='\u{200b}').contains(&ch) || ch == '\u{202f}' || ch == '\u{205f}' || ch == '\u{feff}' {
                        // Normalize non-breaking and various Unicode spaces to standard ASCII space (0x20)
                        encoded.push(b' ');
                    } else if ch == '\u{3000}' {
                        // Fullwidth ideographic space -> Big5 A140 (UAO encode handles this, but fallback explicitly)
                        if let Some(bytes) = crate::uao::encode_uao_char(ch) {
                            encoded.extend_from_slice(&bytes);
                        } else {
                            encoded.extend_from_slice(&[0xA1, 0x40]);
                        }
                    } else if let Some(bytes) = crate::uao::encode_uao_char(ch) {
                        encoded.extend_from_slice(&bytes);
                    } else {
                        let ch_str = ch.to_string();
                        let (res, _, had_errors) = BIG5.encode(&ch_str);
                        if had_errors {
                            // Do NOT emit &#12345; HTML NCR entities into BBS terminal! Replace with '?' (0x3F)
                            encoded.push(b'?');
                        } else {
                            encoded.extend_from_slice(&res);
                        }
                    }
                }
                writer.write_all(&encoded)?;
            }
            BbsCharset::Gbk => {
                let mut encoded = Vec::with_capacity(data.len() * 2);
                for ch in data.chars() {
                    if ch.is_ascii() {
                        encoded.push(ch as u8);
                    } else if ch == '\u{00a0}' || ('\u{2000}'..='\u{200b}').contains(&ch) || ch == '\u{202f}' || ch == '\u{205f}' || ch == '\u{feff}' {
                        encoded.push(b' ');
                    } else {
                        let ch_str = ch.to_string();
                        let (res, _, had_errors) = GBK.encode(&ch_str);
                        if had_errors {
                            encoded.push(b'?');
                        } else {
                            encoded.extend_from_slice(&res);
                        }
                    }
                }
                writer.write_all(&encoded)?;
            }
        }
        writer.flush()
    }

    /// Send raw bytes
    pub fn send_raw(&self, data: &[u8]) -> Result<(), std::io::Error> {
        let mut writer = self.writer.lock().unwrap();
        writer.write_all(data)?;
        writer.flush()
    }

    /// Record user keyboard/mouse activity to reset idle timer
    pub fn record_activity(&self) {
        if let Ok(mut lock) = self.last_activity.lock() {
            *lock = std::time::Instant::now();
        }
    }

    /// Check idle duration and send heartbeat packet if needed (Runs in native Rust background thread)
    pub fn check_and_send_keepalive(&self, interval_secs: u64) -> bool {
        if !self.alive.load(Ordering::Relaxed) {
            return false;
        }
        let mut last = match self.last_activity.lock() {
            Ok(l) => l,
            Err(_) => return false,
        };

        if last.elapsed() >= std::time::Duration::from_secs(interval_secs) {
            if self.is_ssh {
                // For SSH (PTT SSH, etc.), send NUL byte
                let _ = self.send_raw(&[0x00]);
            } else {
                // For Telnet (MapleBBS, Golden Island, PTT Telnet, Bahamut):
                // Send Telnet IAC NOP (0xFF, 0xF1) - RFC 854 official heartbeat
                let _ = self.send_raw(&[0xFF, 0xF1]);
            }
            *last = std::time::Instant::now();
            true
        } else {
            false
        }
    }

    /// Disconnect
    pub fn disconnect(self) {
        self.alive.store(false, Ordering::Relaxed);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_big5_uao_decoding() {
        let mut pending = Vec::new();
        // Big5 UAO bytes for "tông-tsê lâi"
        // t=0x74, ô=0xA0F3, n=0x6E, g=0x67, -=0x2D, t=0x74, s=0x73, ê=0xA0F1, ' '=0x20, l=0x6C, â=0xA0F0, i=0x69
        let bytes = [
            0x74, 0xA0, 0xF3, 0x6E, 0x67, 0x2D, 0x74, 0x73, 0xA0, 0xF1, 0x20, 0x6C, 0xA0, 0xF0, 0x69
        ];
        let decoded = BbsConnection::decode_ansi_big5(&bytes, &mut pending);
        assert_eq!(decoded, "tông-tsê lâi");
        assert!(pending.is_empty());
    }

    #[test]
    fn test_utf8_emoji_passthrough() {
        let mut pending = Vec::new();
        // 4-byte UTF-8 emoji "😀" (0xF0 0x9F 0x98 0x80)
        let bytes = [0xF0, 0x9F, 0x98, 0x80];
        let decoded = BbsConnection::decode_ansi_big5(&bytes, &mut pending);
        assert_eq!(decoded, "😀");
        assert!(pending.is_empty());
    }
}

