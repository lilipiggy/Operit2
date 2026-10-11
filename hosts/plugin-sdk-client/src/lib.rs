#![allow(non_snake_case)]

use operit_host_api::{HostResult, PluginSdkIpcHost};
use std::sync::Arc;

#[cfg(target_os = "windows")]
#[path = "../../windows/src/plugin_sdk_ipc.rs"]
mod platform;
#[cfg(target_os = "windows")]
use platform::WindowsPluginSdkIpcHost as PlatformHost;
#[cfg(target_os = "linux")]
#[path = "../../linux/src/plugin_sdk_ipc.rs"]
mod platform;
#[cfg(target_os = "linux")]
use platform::LinuxPluginSdkIpcHost as PlatformHost;
#[cfg(target_os = "android")]
#[path = "../../android/src/plugin_sdk_ipc.rs"]
mod platform;
#[cfg(target_os = "android")]
use platform::AndroidPluginSdkIpcHost as PlatformHost;
#[cfg(any(target_os = "macos", target_os = "ios"))]
#[path = "../../apple/src/plugin_sdk_ipc.rs"]
mod platform;
#[cfg(any(target_os = "macos", target_os = "ios"))]
use platform::UnixPluginSdkIpcHost as PlatformHost;

/// Creates the SDK-owned carrier selected by the platform host dispatcher.
pub fn createPluginSdkHost() -> Arc<dyn PluginSdkIpcHost> {
    Arc::new(PlatformHost::new())
}

/// Registers the Android activation client supplied by the SDK Android entry point.
#[cfg(target_os = "android")]
pub fn registerAndroidClient(vm: jni::JavaVM, client: jni::objects::GlobalRef) -> HostResult<()> {
    platform::setAndroidPluginSdkBridge(vm, client)
}

/// Rejects Android context registration on a non-Android host.
#[cfg(not(target_os = "android"))]
pub fn registerAndroidClient(_vm: jni::JavaVM, _client: jni::objects::GlobalRef) -> HostResult<()> {
    Err(operit_host_api::HostError::new(
        "Android SDK context registration requires Android",
    ))
}
