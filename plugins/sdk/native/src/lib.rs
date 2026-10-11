use operit_host_api::{
    PluginSdkIpcEndpoint, PluginSdkIpcHost, PluginSdkIpcSessionCallbacks, PluginSdkIpcSessionId,
};
use std::cell::RefCell;
use std::collections::HashMap;
use std::ffi::{c_char, CString};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{mpsc, Arc, Mutex, OnceLock};
use std::time::Duration;

struct Session {
    host: Arc<dyn PluginSdkIpcHost>,
    id: PluginSdkIpcSessionId,
    events: Mutex<mpsc::Receiver<Option<Vec<u8>>>>,
}

thread_local! { static LAST_ERROR: RefCell<CString> = RefCell::new(CString::new("").unwrap()); }

/// Returns the process-wide foreign-language session registry.
fn sessions() -> &'static Mutex<HashMap<u64, Arc<Session>>> {
    static SESSIONS: OnceLock<Mutex<HashMap<u64, Arc<Session>>>> = OnceLock::new();
    SESSIONS.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Stores the current thread's ABI error message.
fn error(value: impl ToString) {
    LAST_ERROR.with(|slot| {
        *slot.borrow_mut() = CString::new(value.to_string().replace('\0', " ")).unwrap()
    });
}

/// Resolves an open SDK session without retaining the registry lock.
fn session(handle: u64) -> Result<Arc<Session>, String> {
    sessions()
        .lock()
        .map_err(|e| e.to_string())?
        .get(&handle)
        .cloned()
        .ok_or_else(|| "Plugin SDK session is closed".to_string())
}

/// Returns the last ABI error, valid until this thread's next failed SDK operation.
#[no_mangle]
pub extern "C" fn operit_sdk_error() -> *const c_char {
    LAST_ERROR.with(|slot| slot.borrow().as_ptr())
}

/// Activates Operit and creates a platform-owned SDK session; zero reports failure.
#[no_mangle]
pub extern "C" fn operit_sdk_connect() -> u64 {
    let host = operit_plugin_sdk_host::createPluginSdkHost();
    let (sender, receiver) = mpsc::channel();
    let closed = sender.clone();
    let callbacks = PluginSdkIpcSessionCallbacks::new(
        Arc::new(|_| {}),
        Arc::new(move |_, bytes| {
            let _ = sender.send(Some(bytes));
        }),
        Arc::new(move |_| {
            let _ = closed.send(None);
        }),
    );
    let id = match host.connect(PluginSdkIpcEndpoint::standard(), callbacks) {
        Ok(id) => id,
        Err(e) => {
            error(e);
            return 0;
        }
    };
    static NEXT: AtomicU64 = AtomicU64::new(1);
    let handle = NEXT.fetch_add(1, Ordering::Relaxed);
    sessions()
        .lock()
        .expect("SDK session registry poisoned")
        .insert(
            handle,
            Arc::new(Session {
                host,
                id,
                events: Mutex::new(receiver),
            }),
        );
    handle
}

/// Sends one unframed MessagePack envelope through the selected host.
#[no_mangle]
pub unsafe extern "C" fn operit_sdk_send(handle: u64, bytes: *const u8, length: usize) -> i32 {
    if bytes.is_null() || length > 32 * 1024 * 1024 {
        error("Invalid SDK message buffer");
        return -1;
    }
    let result = session(handle).and_then(|s| {
        s.host
            .send(&s.id, std::slice::from_raw_parts(bytes, length).to_vec())
            .map_err(|e| e.to_string())
    });
    match result {
        Ok(()) => 0,
        Err(e) => {
            error(e);
            -1
        }
    }
}

/// Receives an envelope: one means a message, zero means timeout, minus one means closed/error.
#[no_mangle]
pub unsafe extern "C" fn operit_sdk_next(
    handle: u64,
    timeout_ms: u32,
    output: *mut *mut u8,
    length: *mut usize,
) -> i32 {
    if output.is_null() || length.is_null() {
        error("Invalid SDK output buffer");
        return -1;
    }
    *output = std::ptr::null_mut();
    *length = 0;
    let result = session(handle).and_then(|s| {
        let receiver = s.events.lock().map_err(|e| e.to_string())?;
        match receiver.recv_timeout(Duration::from_millis(timeout_ms as u64)) {
            Ok(Some(bytes)) => Ok(Some(bytes)),
            Err(mpsc::RecvTimeoutError::Timeout) => Ok(None),
            _ => Err("Plugin SDK IPC connection closed".to_string()),
        }
    });
    match result {
        Ok(Some(bytes)) => {
            let bytes = bytes.into_boxed_slice();
            *length = bytes.len();
            *output = Box::into_raw(bytes) as *mut u8;
            1
        }
        Ok(None) => 0,
        Err(e) => {
            error(e);
            -1
        }
    }
}

/// Releases an envelope allocated by operit_sdk_next.
#[no_mangle]
pub unsafe extern "C" fn operit_sdk_free(bytes: *mut u8, length: usize) {
    if !bytes.is_null() {
        drop(Box::from_raw(std::ptr::slice_from_raw_parts_mut(
            bytes, length,
        )));
    }
}

/// Closes a foreign-language SDK session and removes it from the registry.
#[no_mangle]
pub extern "C" fn operit_sdk_close(handle: u64) -> i32 {
    let session = sessions()
        .lock()
        .expect("SDK session registry poisoned")
        .remove(&handle);
    match session {
        Some(session) => match session.host.closeSession(&session.id) {
            Ok(()) => 0,
            Err(e) => {
                error(e);
                -1
            }
        },
        None => {
            error("Plugin SDK session is closed");
            -1
        }
    }
}

mod jni_bridge;

#[cfg(test)]
mod tests {
    use super::*;
    use operit_host_native_plugin_sdk_ipc::MemoryPluginSdkIpcHost;

    /// Verifies foreign buffer ownership, envelope round trips, timeout and closed handles.
    #[test]
    fn abi_message_lifecycle() {
        let host = Arc::new(MemoryPluginSdkIpcHost::new());
        let echo = host.clone();
        host.startListener(
            PluginSdkIpcEndpoint::standard(),
            PluginSdkIpcSessionCallbacks::new(
                Arc::new(|_| {}),
                Arc::new(move |id, bytes| {
                    echo.send(&id, bytes).unwrap();
                }),
                Arc::new(|_| {}),
            ),
        )
        .unwrap();
        let (tx, rx) = mpsc::channel();
        let closed = tx.clone();
        let id = host
            .connect(
                PluginSdkIpcEndpoint::standard(),
                PluginSdkIpcSessionCallbacks::new(
                    Arc::new(|_| {}),
                    Arc::new(move |_, bytes| {
                        tx.send(Some(bytes)).unwrap();
                    }),
                    Arc::new(move |_| {
                        closed.send(None).unwrap();
                    }),
                ),
            )
            .unwrap();
        let handle = u64::MAX;
        sessions().lock().unwrap().insert(
            handle,
            Arc::new(Session {
                host: host.clone(),
                id,
                events: Mutex::new(rx),
            }),
        );
        let mut output = std::ptr::null_mut();
        let mut length = 0;
        unsafe {
            assert_eq!(operit_sdk_next(handle, 0, &mut output, &mut length), 0);
            let message = [0x81, 0xa1, b'a', 1];
            assert_eq!(operit_sdk_send(handle, message.as_ptr(), message.len()), 0);
            assert_eq!(operit_sdk_next(handle, 100, &mut output, &mut length), 1);
            assert_eq!(std::slice::from_raw_parts(output, length), message);
            operit_sdk_free(output, length);
            assert_eq!(operit_sdk_close(handle), 0);
            assert_eq!(operit_sdk_next(handle, 0, &mut output, &mut length), -1);
            assert!(output.is_null());
            assert_eq!(length, 0);
        }
        host.stopListener().unwrap();
    }
}
