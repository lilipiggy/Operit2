#![allow(non_snake_case)]

mod client;
mod frame;
mod handler;
mod server;
mod surface;

pub use client::PluginSdkClient;
pub use frame::{
    decodePluginSdkIpcMessage, encodePluginSdkIpcMessage, PluginSdkIpcMessage,
};
pub use handler::{
    PluginSdkLinkTarget, SharedPluginSdkLinkTarget,
};
pub use server::PluginSdkIpcServer;
pub use surface::PluginSdkSurface;
