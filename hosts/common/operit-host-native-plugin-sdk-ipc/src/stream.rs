use std::io::{Read, Write};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;

use operit_host_api::{HostError, HostResult, PluginSdkIpcSessionCallbacks, PluginSdkIpcSessionId};

use crate::framing::{readPluginSdkIpcFrame, writePluginSdkIpcFrame};

/// Owns one connected Plugin SDK byte stream.
pub struct PluginSdkIpcStreamSession {
    pub sessionId: PluginSdkIpcSessionId,
    pub writer: Mutex<Option<Box<dyn Write + Send>>>,
    pub closed: Arc<AtomicBool>,
    pub listenerOwned: bool,
}

impl PluginSdkIpcStreamSession {
    /// Creates a connected stream session.
    pub fn new(
        sessionId: PluginSdkIpcSessionId,
        writer: Box<dyn Write + Send>,
        listenerOwned: bool,
    ) -> Self {
        Self {
            sessionId,
            writer: Mutex::new(Some(writer)),
            closed: Arc::new(AtomicBool::new(false)),
            listenerOwned,
        }
    }
}

/// Starts the read loop that forwards framed payloads into session callbacks.
#[allow(non_snake_case)]
pub fn spawnPluginSdkIpcReadLoop(
    sessionId: PluginSdkIpcSessionId,
    mut reader: impl Read + Send + 'static,
    callbacks: PluginSdkIpcSessionCallbacks,
    onReaderExit: impl FnOnce() + Send + 'static,
) -> HostResult<JoinHandle<()>> {
    std::thread::Builder::new()
        .name(format!("operit-plugin-sdk-ipc-{}", sessionId.0))
        .spawn(move || {
            loop {
                match readPluginSdkIpcFrame(&mut reader) {
                    Ok(payload) => (callbacks.onMessage)(sessionId.clone(), payload),
                    Err(_) => break,
                }
            }
            onReaderExit();
            (callbacks.onClosed)(sessionId);
        })
        .map_err(|error| HostError::new(error.to_string()))
}

/// Writes one frame through a connected session writer.
#[allow(non_snake_case)]
pub fn sendPluginSdkIpcStream(
    session: &PluginSdkIpcStreamSession,
    bytes: Vec<u8>,
) -> HostResult<()> {
    if session.closed.load(Ordering::SeqCst) {
        return Err(HostError::new(format!(
            "Plugin SDK IPC session is closed: {}",
            session.sessionId.0
        )));
    }
    let mut writer = session
        .writer
        .lock()
        .map_err(|error| HostError::new(format!("Plugin SDK IPC writer lock poisoned: {error}")))?;
    let writer = writer
        .as_mut()
        .ok_or_else(|| HostError::new("Plugin SDK IPC writer is closed"))?;
    writePluginSdkIpcFrame(writer, &bytes)
}

/// Marks a stream session closed.
#[allow(non_snake_case)]
pub fn closePluginSdkIpcStream(session: &PluginSdkIpcStreamSession) {
    session.closed.store(true, Ordering::SeqCst);
    session
        .writer
        .lock()
        .expect("Plugin SDK IPC writer lock poisoned")
        .take();
}

/// Shared session table used by stream-backed Plugin SDK IPC hosts.
pub type PluginSdkIpcSessionTable =
    Arc<Mutex<std::collections::HashMap<String, Arc<PluginSdkIpcStreamSession>>>>;
