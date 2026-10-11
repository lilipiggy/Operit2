use operit_link::{
    decodeLink, encodeLink, CoreCallRequest, CoreCallResponse, CoreEvent, CoreLinkError,
    CorePushItem, CorePushRequest, CoreWatchRequest,
};
use serde::{Deserialize, Serialize};

/// Carries one canonical Core Link operation over the host-owned IPC carrier.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", content = "body")]
pub enum PluginSdkIpcMessage {
    /// Sends one Core call request from the SDK to the running application.
    Call(CoreCallRequest),
    /// Returns one Core call response to the SDK.
    CallResponse(CoreCallResponse),
    /// Opens one Core watch stream.
    WatchOpen {
        subscriptionId: String,
        request: CoreWatchRequest,
    },
    /// Acknowledges one watch-open request.
    WatchOpened {
        subscriptionId: String,
        result: Result<(), CoreLinkError>,
    },
    /// Reads one Core watch snapshot.
    WatchSnapshot { request: CoreWatchRequest },
    /// Forwards one Core watch event to the SDK.
    WatchEvent {
        subscriptionId: String,
        event: CoreEvent,
    },
    /// Closes one Core watch stream.
    WatchClose {
        subscriptionId: String,
        error: Option<CoreLinkError>,
    },
    /// Opens one caller-owned Core push stream.
    PushOpen(CorePushRequest),
    /// Acknowledges one push open request.
    PushOpened {
        pushId: String,
        result: Result<(), CoreLinkError>,
    },
    /// Sends one ordered item into an opened Core push stream.
    PushItem(CorePushItem),
    /// Acknowledges one push item.
    PushItemResult {
        pushId: String,
        sequence: u64,
        result: Result<(), CoreLinkError>,
    },
    /// Closes one caller-owned Core push stream.
    PushClose { pushId: String },
    /// Acknowledges one push close request.
    PushClosed {
        pushId: String,
        result: Result<(), CoreLinkError>,
    },
    /// Reports a protocol/carrier error that has no request response.
    ProtocolError { error: CoreLinkError },
}

/// Encodes one Plugin SDK IPC frame with the existing Link codec.
#[allow(non_snake_case)]
pub fn encodePluginSdkIpcMessage(message: &PluginSdkIpcMessage) -> Result<Vec<u8>, CoreLinkError> {
    encodeLink(message).map_err(|error| CoreLinkError::internal(error.to_string()))
}

/// Decodes one Plugin SDK IPC frame with the existing Link codec.
#[allow(non_snake_case)]
pub fn decodePluginSdkIpcMessage(bytes: &[u8]) -> Result<PluginSdkIpcMessage, CoreLinkError> {
    decodeLink(bytes).map_err(|error| CoreLinkError::internal(error.to_string()))
}
