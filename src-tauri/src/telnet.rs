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
    _child: Option<Box<dyn portable_pty::Child + Send>>,
    _master: Option<Box<dyn portable_pty::MasterPty + Send>>,
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
        stream.set_read_timeout(Some(std::time::Duration::from_millis(100))).ok();

        let mut writer_stream = stream.try_clone()
            .map_err(|e| format!("Failed to clone stream: {}", e))?;
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
            _child: None,
            _master: None,
        })
    }

    /// Connect via SSH using external ssh program with PTY
    pub async fn connect_ssh(
        tab_id: String,
        address: &str,
        port: u16,
        charset: BbsCharset,
        app: AppHandle,
    ) -> Result<Self, String> {
        use portable_pty::{CommandBuilder, PtySize, native_pty_system};

        let pty_system = native_pty_system();
        let pair = pty_system.openpty(PtySize {
            rows: 24,
            cols: 80,
            pixel_width: 0,
            pixel_height: 0,
        }).map_err(|e| format!("Failed to open PTY: {}", e))?;

        // Build SSH command
        let target = if address.contains('@') {
            address.to_string()
        } else {
            format!("bbs@{}", address)
        };

        let mut cmd = CommandBuilder::new("ssh");
        cmd.arg("-tt");
        cmd.arg("-o");
        cmd.arg("StrictHostKeyChecking=no");
        cmd.arg("-o");
        cmd.arg("UserKnownHostsFile=/dev/null");
        cmd.arg("-o");
        cmd.arg("GlobalKnownHostsFile=/dev/null");
        cmd.arg("-o");
        cmd.arg("LogLevel=ERROR");
        cmd.arg("-o");
        cmd.arg("HostKeyAlgorithms=+ssh-rsa");
        cmd.arg("-o");
        cmd.arg("PubkeyAcceptedAlgorithms=+ssh-rsa");
        cmd.arg("-o");
        cmd.arg("ServerAliveInterval=30");
        cmd.arg("-o");
        cmd.arg("ServerAliveCountMax=3");
        if port != 22 {
            cmd.arg("-p");
            cmd.arg(port.to_string());
        }
        cmd.arg(&target);
        cmd.env("TERM", "vt100");

        let child = pair.slave.spawn_command(cmd)
            .map_err(|e| format!("Failed to spawn ssh: {}", e))?;

        drop(pair.slave);

        let reader = pair.master.try_clone_reader()
            .map_err(|e| format!("Failed to clone reader: {}", e))?;

        let pty_writer = pair.master.take_writer()
            .map_err(|e| format!("Failed to take writer: {}", e))?;

        let writer: Box<dyn Write + Send> = Box::new(pty_writer);
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
            Self::read_loop_ssh(tab_id_clone, reader, alive_clone, charset_clone, app_clone);
        });

        let last_activity = Arc::new(std::sync::Mutex::new(std::time::Instant::now()));

        Ok(BbsConnection {
            writer,
            alive,
            charset,
            is_ssh: true,
            last_activity,
            _child: Some(child),
            _master: Some(pair.master),
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
        let mut pending = Vec::new();
        let mut pending_lead = Vec::new();

        while alive.load(Ordering::Relaxed) {
            match reader.read(&mut buf) {
                Ok(0) => {
                    if !pending_lead.is_empty() {
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
                    let mut data_to_process = Vec::with_capacity(pending_lead.len() + pending.len() + n);
                    if !pending_lead.is_empty() {
                        data_to_process.extend_from_slice(&pending_lead);
                        pending_lead.clear();
                    }
                    if !pending.is_empty() {
                        data_to_process.extend_from_slice(&pending);
                        pending.clear();
                    }
                    data_to_process.extend_from_slice(&buf[..n]);

                    let clean = Self::strip_telnet_commands(&mut data_to_process);
                    pending.extend_from_slice(&data_to_process);

                    if !clean.is_empty() {
                        let cs = charset.read().map(|g| *g).unwrap_or(BbsCharset::Big5);
                        let decoded = Self::decode_ansi_stream(&clean, cs, &mut pending_lead);
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

    /// Read loop for SSH connections
    fn read_loop_ssh(
        tab_id: String,
        mut reader: Box<dyn Read + Send>,
        alive: Arc<AtomicBool>,
        charset: Arc<RwLock<BbsCharset>>,
        app: AppHandle,
    ) {
        let mut buf = [0u8; 4096];
        let mut pending_lead = Vec::new();

        while alive.load(Ordering::Relaxed) {
            match reader.read(&mut buf) {
                Ok(0) => {
                    if !pending_lead.is_empty() {
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
                    let mut data_to_process = Vec::with_capacity(pending_lead.len() + n);
                    if !pending_lead.is_empty() {
                        data_to_process.extend_from_slice(&pending_lead);
                        pending_lead.clear();
                    }
                    data_to_process.extend_from_slice(&buf[..n]);

                    let cs = charset.read().map(|g| *g).unwrap_or(BbsCharset::Big5);
                    let decoded = Self::decode_ansi_stream(&data_to_process, cs, &mut pending_lead);
                    if !decoded.is_empty() {
                        let _ = app.emit("terminal-data", TerminalDataPayload {
                            tab_id: tab_id.clone(),
                            data: decoded,
                        });
                    }
                }
                Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock
                    || e.kind() == std::io::ErrorKind::TimedOut => {
                    std::thread::sleep(std::time::Duration::from_millis(10));
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

    /// MapleBBS / PCMan ANSI Big5 byte-level decoder:
    /// - High bytes (0x80..=0xFF) at the very end of raw stream are held in `pending_bytes` for the next chunk
    /// - Partial Big5 lead bytes right before ESC are turned to a single space, preserving exact 80-column alignment
    /// - Valid Big5 pairs are decoded into UTF-8 Chinese/special characters
    fn decode_ansi_big5(raw: &[u8], pending_bytes: &mut Vec<u8>) -> String {
        let mut out = String::with_capacity(raw.len());
        let mut i = 0;
        while i < raw.len() {
            let b = raw[i];
            if b < 0x80 {
                out.push(b as char);
                i += 1;
                continue;
            }
            if i + 1 < raw.len() {
                if raw[i + 1] == 0x1B {
                    // Standalone lead byte right before ESC => emit single space to maintain 1-cell width
                    out.push(' ');
                    i += 1;
                } else {
                    let pair = &raw[i..i + 2];
                    let (decoded, _, malformed) = BIG5.decode(pair);
                    if !malformed {
                        out.push_str(&decoded);
                        i += 2;
                    } else {
                        out.push(' ');
                        i += 1;
                    }
                }
            } else {
                // b is the last byte in raw buffer. Hold for next packet to determine if followed by ESC or trail byte
                pending_bytes.push(b);
                i += 1;
            }
        }
        out
    }

    /// GBK byte-level decoder with ANSI lead byte handling
    fn decode_ansi_gbk(raw: &[u8], pending_bytes: &mut Vec<u8>) -> String {
        let mut out = String::with_capacity(raw.len());
        let mut i = 0;
        while i < raw.len() {
            let b = raw[i];
            if b < 0x80 {
                out.push(b as char);
                i += 1;
                continue;
            }
            if i + 1 < raw.len() {
                if raw[i + 1] == 0x1B {
                    out.push(' ');
                    i += 1;
                } else {
                    let pair = &raw[i..i + 2];
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
                let (encoded, _, _) = BIG5.encode(data);
                writer.write_all(&encoded)?;
            }
            BbsCharset::Gbk => {
                let (encoded, _, _) = GBK.encode(data);
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

