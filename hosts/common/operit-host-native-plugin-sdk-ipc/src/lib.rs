#![allow(non_snake_case)]

mod framing;
mod memory;
pub mod stream;
pub mod pipes;


pub use framing::{
    readPluginSdkIpcFrame, writePluginSdkIpcFrame, PLUGIN_SDK_IPC_MAX_FRAME_BYTES,
};
pub use memory::MemoryPluginSdkIpcHost;
