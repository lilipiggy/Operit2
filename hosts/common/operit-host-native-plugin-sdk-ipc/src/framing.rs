use std::io::{Read, Write};

use operit_host_api::{HostError, HostResult};

/// Maximum Plugin SDK IPC frame payload size in bytes.
pub const PLUGIN_SDK_IPC_MAX_FRAME_BYTES: usize = 32 * 1024 * 1024;

/// Writes one length-prefixed IPC frame.
#[allow(non_snake_case)]
pub fn writePluginSdkIpcFrame(writer: &mut impl Write, payload: &[u8]) -> HostResult<()> {
    if payload.len() > PLUGIN_SDK_IPC_MAX_FRAME_BYTES {
        return Err(HostError::new(format!(
            "Plugin SDK IPC frame exceeds {} bytes",
            PLUGIN_SDK_IPC_MAX_FRAME_BYTES
        )));
    }
    writer
        .write_all(&(payload.len() as u32).to_be_bytes())
        .map_err(|error| HostError::new(error.to_string()))?;
    writer
        .write_all(payload)
        .map_err(|error| HostError::new(error.to_string()))?;
    writer
        .flush()
        .map_err(|error| HostError::new(error.to_string()))
}

/// Reads one length-prefixed IPC frame.
#[allow(non_snake_case)]
pub fn readPluginSdkIpcFrame(reader: &mut impl Read) -> HostResult<Vec<u8>> {
    let mut lengthBytes = [0u8; 4];
    reader
        .read_exact(&mut lengthBytes)
        .map_err(|error| HostError::new(error.to_string()))?;
    let length = u32::from_be_bytes(lengthBytes) as usize;
    if length > PLUGIN_SDK_IPC_MAX_FRAME_BYTES {
        return Err(HostError::new(format!(
            "Plugin SDK IPC frame exceeds {} bytes",
            PLUGIN_SDK_IPC_MAX_FRAME_BYTES
        )));
    }
    let mut payload = vec![0u8; length];
    reader
        .read_exact(&mut payload)
        .map_err(|error| HostError::new(error.to_string()))?;
    Ok(payload)
}
