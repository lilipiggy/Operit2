//! Speech configuration selection exposed to plugins.
use super::JsFuture;
use super::results::{TtsListConfigsResultData, TtsGetCurrentConfigIdResultData, TtsSetCurrentConfigIdResultData};
use serde::{Deserialize, Serialize};

/// Preserves one configured speech request or response-pipeline header.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct TtsHeader {
    pub name: String,
    pub value: String,
}
/// Preserves every configured speech response-pipeline field.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[allow(non_snake_case)]
pub struct TtsResponseStep {
    pub stepType: String,
    pub path: String,
    pub headers: Vec<TtsHeader>,
}
/// Preserves the complete speech configuration returned by the host manager.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[allow(non_snake_case)]
pub struct TtsConfig {
    pub id: String,
    pub name: String,
    pub providerType: String,
    pub endpoint: String,
    pub apiKey: String,
    pub model: String,
    pub voice: String,
    pub responseFormat: String,
    pub speed: f64,
    pub httpMethod: String,
    pub requestBody: String,
    pub contentType: String,
    pub headers: Vec<TtsHeader>,
    pub responsePipeline: Vec<TtsResponseStep>,
    pub createdAt: i64,
    pub updatedAt: i64,
}
/// Reads and selects speech configurations through the canonical host manager.
pub trait TtsHost: Send + Sync {
    /// Returns complete configured speech records.
    fn listConfigs(&self) -> JsFuture<TtsListConfigsResultData>;
    /// Reads the current application-wide speech configuration ID.
    fn getCurrentConfigId(&self) -> JsFuture<TtsGetCurrentConfigIdResultData>;
    /// Selects an exact existing speech configuration ID.
    fn setCurrentConfigId(&self, id: String) -> JsFuture<TtsSetCurrentConfigIdResultData>;
}
