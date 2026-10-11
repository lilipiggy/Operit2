//! Generated external Plugin SDK client wrappers.

pub use operit_plugin_sdk_ipc::PluginSdkClient;
pub use operit_plugin_sdk_host::registerAndroidClient as register_android_client;

mod generated;

pub use generated::*;

/// Activates the installed Operit application and connects through its platform IPC carrier.
pub fn connect() -> Result<PluginSdkClient, operit_link::CoreLinkError> {
    PluginSdkClient::connect(operit_plugin_sdk_host::createPluginSdkHost(), operit_host_api::PluginSdkIpcEndpoint::standard())
}

/// Decodes one Core MessagePack value into a Rust SDK model.
pub fn decode_messagepack_value<T: serde::de::DeserializeOwned>(value: &operit_link::CoreValue) -> Result<T, operit_link::CoreLinkError> {
    let bytes = rmp_serde::to_vec(value).map_err(|error| operit_link::CoreLinkError::internal(error.to_string()))?;
    rmp_serde::from_slice(&bytes).map_err(|error| operit_link::CoreLinkError::internal(error.to_string()))
}

/// Typed wrapper over the Core watch event stream.
pub struct OperitPluginSdkTypedEventStream<T> {
    stream: operit_link::CoreEventStream,
    marker: std::marker::PhantomData<T>,
}

impl<T> OperitPluginSdkTypedEventStream<T> {
    /// Creates a typed stream over one Core event stream.
    pub fn new(stream: operit_link::CoreEventStream) -> Self { Self { stream, marker: std::marker::PhantomData } }
}

impl<T: serde::de::DeserializeOwned> OperitPluginSdkTypedEventStream<T> {
    /// Receives and decodes the next MessagePack event value.
    pub async fn recv(&mut self) -> Option<Result<T, operit_link::CoreLinkError>> {
        self.stream.recv().await.map(|event| decode_messagepack_value(&event.value))
    }
}
