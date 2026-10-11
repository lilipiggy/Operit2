use crate::stream::{
    closePluginSdkIpcStream, sendPluginSdkIpcStream, spawnPluginSdkIpcReadLoop,
    PluginSdkIpcStreamSession,
};
use operit_host_api::{HostError, HostResult, PluginSdkIpcSessionCallbacks, PluginSdkIpcSessionId};
use std::collections::HashMap;
use std::fs::File;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

/// Owns sessions whose pipe handles are supplied by a platform activation service.
#[derive(Clone, Default)]
pub struct PluginSdkPipeSessions {
    sessions: Arc<Mutex<HashMap<String, Arc<PluginSdkIpcStreamSession>>>>,
    next: Arc<AtomicU64>,
}

impl PluginSdkPipeSessions {
    /// Attaches the two directions of an OS pipe pair to the Link frame protocol.
    pub fn attach(
        &self,
        reader: File,
        writer: File,
        callbacks: PluginSdkIpcSessionCallbacks,
        listenerOwned: bool,
    ) -> HostResult<PluginSdkIpcSessionId> {
        let id = PluginSdkIpcSessionId::new(format!(
            "pipe-{}",
            self.next.fetch_add(1, Ordering::Relaxed)
        ));
        let session = Arc::new(PluginSdkIpcStreamSession::new(
            id.clone(),
            Box::new(writer),
            listenerOwned,
        ));
        self.sessions
            .lock()
            .map_err(|e| HostError::new(e.to_string()))?
            .insert(id.0.clone(), session);
        (callbacks.onConnected)(id.clone());
        let sessions = self.sessions.clone();
        let closed = id.clone();
        if let Err(error) =
            spawnPluginSdkIpcReadLoop(id.clone(), reader, callbacks.clone(), move || {
                let session = sessions
                    .lock()
                    .expect("pipe session lock poisoned")
                    .remove(&closed.0);
                if let Some(session) = session {
                    closePluginSdkIpcStream(&session);
                }
            })
        {
            self.close(&id)?;
            (callbacks.onClosed)(id);
            return Err(error);
        }
        Ok(id)
    }

    /// Writes a Link frame to a pipe session.
    pub fn send(&self, id: &PluginSdkIpcSessionId, bytes: Vec<u8>) -> HostResult<()> {
        let session = self
            .sessions
            .lock()
            .map_err(|e| HostError::new(e.to_string()))?
            .get(&id.0)
            .cloned()
            .ok_or_else(|| HostError::new("Pipe session is closed"))?;
        sendPluginSdkIpcStream(&session, bytes)
    }

    /// Closes the write direction so the peer observes EOF and closes its direction.
    pub fn close(&self, id: &PluginSdkIpcSessionId) -> HostResult<()> {
        let session = self
            .sessions
            .lock()
            .map_err(|e| HostError::new(e.to_string()))?
            .remove(&id.0)
            .ok_or_else(|| HostError::new("Pipe session is closed"))?;
        closePluginSdkIpcStream(&session);
        Ok(())
    }

    /// Closes pipe writers accepted by this activation endpoint.
    pub fn closeAll(&self) -> HostResult<()> {
        let mut sessions = self
            .sessions
            .lock()
            .map_err(|e| HostError::new(e.to_string()))?;
        sessions.retain(|_, session| {
            if session.listenerOwned {
                closePluginSdkIpcStream(session);
            }
            !session.listenerOwned
        });
        Ok(())
    }
}
