use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use operit_host_api::{
    HostError, HostResult, PluginSdkIpcEndpoint, PluginSdkIpcHost, PluginSdkIpcSessionCallbacks,
    PluginSdkIpcSessionId,
};

struct MemorySession {
    peerId: PluginSdkIpcSessionId,
    callbacks: PluginSdkIpcSessionCallbacks,
    listenerOwned: bool,
}

struct MemoryInner {
    listener: Option<(String, PluginSdkIpcSessionCallbacks)>,
    sessions: HashMap<String, MemorySession>,
}

/// In-process Plugin SDK IPC carrier used by Operit tests and same-process clients.
#[derive(Clone)]
pub struct MemoryPluginSdkIpcHost {
    inner: Arc<Mutex<MemoryInner>>,
    nextSession: Arc<AtomicU64>,
}

impl MemoryPluginSdkIpcHost {
    /// Creates an empty in-process Plugin SDK IPC carrier.
    pub fn new() -> Self {
        Self {
            inner: Arc::new(Mutex::new(MemoryInner {
                listener: None,
                sessions: HashMap::new(),
            })),
            nextSession: Arc::new(AtomicU64::new(1)),
        }
    }

    /// Allocates the next session identifier.
    fn nextSessionId(&self) -> PluginSdkIpcSessionId {
        PluginSdkIpcSessionId::new(format!(
            "plugin-sdk-memory-{}",
            self.nextSession.fetch_add(1, Ordering::Relaxed)
        ))
    }

    /// Locks the in-process session table.
    fn lock(&self) -> HostResult<std::sync::MutexGuard<'_, MemoryInner>> {
        self.inner
            .lock()
            .map_err(|error| HostError::new(format!("Plugin SDK memory IPC lock poisoned: {error}")))
    }
}

impl Default for MemoryPluginSdkIpcHost {
    /// Creates an empty in-process Plugin SDK IPC carrier.
    fn default() -> Self {
        Self::new()
    }
}

impl PluginSdkIpcHost for MemoryPluginSdkIpcHost {
    /// Reports that the in-process Operit runtime is already this process.
    fn activate(&self, _endpoint: PluginSdkIpcEndpoint) -> HostResult<()> {
        Ok(())
    }

    /// Starts the in-process listener for third-party Plugin SDK sessions.
    fn startListener(
        &self,
        endpoint: PluginSdkIpcEndpoint,
        callbacks: PluginSdkIpcSessionCallbacks,
    ) -> HostResult<()> {
        let mut inner = self.lock()?;
        if inner.listener.is_some() {
            return Err(HostError::new(
                "Plugin SDK IPC listener is already started",
            ));
        }
        inner.listener = Some((endpoint.name, callbacks));
        Ok(())
    }

    /// Connects a client session to the in-process listener.
    fn connect(
        &self,
        endpoint: PluginSdkIpcEndpoint,
        callbacks: PluginSdkIpcSessionCallbacks,
    ) -> HostResult<PluginSdkIpcSessionId> {
        let serverSessionId = self.nextSessionId();
        let clientSessionId = self.nextSessionId();
        let listenerCallbacks;
        {
            let mut inner = self.lock()?;
            let Some((listenerName, listener)) = inner.listener.clone() else {
                return Err(HostError::new(
                    "Plugin SDK IPC listener is not started",
                ));
            };
            if listenerName != endpoint.name {
                return Err(HostError::new(format!(
                    "Plugin SDK IPC endpoint mismatch: {listenerName} != {}",
                    endpoint.name
                )));
            }
            listenerCallbacks = listener.clone();
            inner.sessions.insert(
                serverSessionId.0.clone(),
                MemorySession {
                    peerId: clientSessionId.clone(),
                    callbacks: listener,
                    listenerOwned: true,
                },
            );
            inner.sessions.insert(
                clientSessionId.0.clone(),
                MemorySession {
                    peerId: serverSessionId.clone(),
                    callbacks: callbacks.clone(),
                    listenerOwned: false,
                },
            );
        }
        (listenerCallbacks.onConnected)(serverSessionId);
        (callbacks.onConnected)(clientSessionId.clone());
        Ok(clientSessionId)
    }

    /// Delivers one framed payload to the paired session.
    fn send(&self, sessionId: &PluginSdkIpcSessionId, bytes: Vec<u8>) -> HostResult<()> {
        let peerId;
        let callbacks;
        {
            let inner = self.lock()?;
            let session = inner.sessions.get(&sessionId.0).ok_or_else(|| {
                HostError::new(format!("Plugin SDK IPC session is closed: {}", sessionId.0))
            })?;
            peerId = session.peerId.clone();
            let peer = inner.sessions.get(&peerId.0).ok_or_else(|| {
                HostError::new(format!(
                    "Plugin SDK IPC peer session is closed: {}",
                    peerId.0
                ))
            })?;
            callbacks = peer.callbacks.clone();
        }
        (callbacks.onMessage)(peerId, bytes);
        Ok(())
    }

    /// Closes one in-process session and its peer.
    fn closeSession(&self, sessionId: &PluginSdkIpcSessionId) -> HostResult<()> {
        let mut closed = Vec::new();
        {
            let mut inner = self.lock()?;
            if let Some(session) = inner.sessions.remove(&sessionId.0) {
                closed.push((sessionId.clone(), session.callbacks.clone()));
                if let Some(peer) = inner.sessions.remove(&session.peerId.0) {
                    closed.push((session.peerId, peer.callbacks));
                }
            }
        }
        if closed.is_empty() {
            return Err(HostError::new(format!(
                "Plugin SDK IPC session is closed: {}",
                sessionId.0
            )));
        }
        for (id, callbacks) in closed {
            (callbacks.onClosed)(id);
        }
        Ok(())
    }

    /// Stops the in-process listener and closes listener-owned sessions.
    fn stopListener(&self) -> HostResult<()> {
        let mut closed = Vec::new();
        {
            let mut inner = self.lock()?;
            if inner.listener.take().is_none() {
                return Err(HostError::new("Plugin SDK IPC listener is not started"));
            }
            let listenerOwned = inner
                .sessions
                .iter()
                .filter(|(_, session)| session.listenerOwned)
                .map(|(id, _)| id.clone())
                .collect::<Vec<_>>();
            for id in listenerOwned {
                if let Some(session) = inner.sessions.remove(&id) {
                    closed.push((PluginSdkIpcSessionId(id), session.callbacks.clone()));
                    if let Some(peer) = inner.sessions.remove(&session.peerId.0) {
                        closed.push((session.peerId, peer.callbacks));
                    }
                }
            }
        }
        for (id, callbacks) in closed {
            (callbacks.onClosed)(id);
        }
        Ok(())
    }
}
