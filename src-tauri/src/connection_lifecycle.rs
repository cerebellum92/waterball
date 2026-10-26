//! Cancellation shared by the command, handshake workers and event producers.
use std::net::{Shutdown, TcpStream};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter};

pub struct ConnectionAttempt {
    pub id: String,
    cancelled: tokio::sync::watch::Sender<bool>,
    socket: Mutex<Option<TcpStream>>,
}

impl ConnectionAttempt {
    pub fn new(id: String) -> Arc<Self> {
        Arc::new(Self {
            id,
            cancelled: tokio::sync::watch::channel(false).0,
            socket: Mutex::new(None),
        })
    }

    pub fn is_cancelled(&self) -> bool {
        *self.cancelled.borrow()
    }

    pub fn cancel(&self) {
        self.cancelled.send_replace(true);
        if let Ok(mut socket) = self.socket.lock() {
            if let Some(socket) = socket.take() {
                let _ = socket.shutdown(Shutdown::Both);
            }
        }
    }

    pub async fn cancelled(&self) {
        let mut receiver = self.cancelled.subscribe();
        while !*receiver.borrow_and_update() {
            if receiver.changed().await.is_err() {
                break;
            }
        }
    }

    pub fn track_socket(&self, socket: &TcpStream) -> Result<(), String> {
        let mut tracked = self.socket.lock().map_err(|e| e.to_string())?;
        if self.is_cancelled() {
            let _ = socket.shutdown(Shutdown::Both);
            return Err("CONNECTION_CANCELLED".into());
        }
        *tracked = Some(socket.try_clone().map_err(|e| e.to_string())?);
        Ok(())
    }

    pub fn is_current(self: &Arc<Self>, registered: Option<&Arc<Self>>) -> bool {
        !self.is_cancelled() && registered.is_some_and(|current| Arc::ptr_eq(current, self))
    }

    pub fn ensure_current(&self) -> Result<(), String> {
        if self.is_cancelled() {
            Err("CONNECTION_CANCELLED".into())
        } else {
            Ok(())
        }
    }
}

#[derive(Clone)]
pub struct ConnectionEvents {
    app: AppHandle,
    pub attempt: Arc<ConnectionAttempt>,
}

impl ConnectionEvents {
    pub fn new(app: AppHandle, attempt: Arc<ConnectionAttempt>) -> Self {
        Self { app, attempt }
    }

    pub fn emit<S: serde::Serialize>(&self, event: &str, payload: S) -> Result<(), tauri::Error> {
        if self.attempt.is_cancelled() {
            return Ok(());
        }
        let mut payload = serde_json::to_value(payload)?;
        if let Some(object) = payload.as_object_mut() {
            object.insert("attempt_id".into(), self.attempt.id.clone().into());
        }
        self.app.emit(event, payload)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn cancellation_wakes_existing_and_late_waiters() {
        let attempt = ConnectionAttempt::new("old".into());
        let pending = attempt.clone();
        let waiter = tokio::spawn(async move { pending.cancelled().await });
        attempt.cancel();
        tokio::time::timeout(std::time::Duration::from_secs(1), waiter)
            .await
            .unwrap()
            .unwrap();
        tokio::time::timeout(std::time::Duration::from_secs(1), attempt.cancelled())
            .await
            .unwrap();
        assert!(attempt.ensure_current().is_err());
    }

    #[test]
    fn late_handshake_cannot_commit_after_close_or_replacement() {
        let old = ConnectionAttempt::new("old".into());
        let new = ConnectionAttempt::new("new".into());
        assert!(old.is_current(Some(&old)));
        assert!(!old.is_current(Some(&new)));
        old.cancel();
        assert!(!old.is_current(Some(&old)));
        assert!(!old.is_current(None));
        assert!(new.is_current(Some(&new)));
    }

    #[test]
    fn cancellation_closes_tracked_socket_and_rejects_late_sockets() {
        use std::io::Read;
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let socket = TcpStream::connect(listener.local_addr().unwrap()).unwrap();
        let (mut peer, _) = listener.accept().unwrap();
        peer.set_read_timeout(Some(std::time::Duration::from_secs(1)))
            .unwrap();
        let attempt = ConnectionAttempt::new("old".into());
        attempt.track_socket(&socket).unwrap();
        attempt.cancel();
        assert_eq!(peer.read(&mut [0; 1]).unwrap(), 0);
        assert!(attempt.track_socket(&socket).is_err());
        assert!(!ConnectionAttempt::new("new".into()).is_cancelled());
    }
}
