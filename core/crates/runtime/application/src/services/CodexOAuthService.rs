use operit_host_api::HostManager::defaultHostRuntimeTaskSchedulerHost;
use operit_providers::chat::llmprovider::CodexOAuth::{
    account_id_from_tokens, browser_authorization, ensure_fresh_tokens, exchange_browser_code,
    poll_device_authorization_once, start_device_authorization, CodexBrowserAuthorization,
    CodexDeviceAuthorization, CodexOAuthTokens,
};
use serde::{Deserialize, Serialize};

use crate::data::preferences::CodexAuthPreferences::CodexAuthPreferences;

/// Public result returned after a Codex login is stored.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[allow(non_snake_case)]
pub struct CodexLoginResult {
    pub email: String,
    pub accountId: String,
}

/// Public view of the saved ChatGPT Codex session.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[allow(non_snake_case)]
pub struct CodexSessionStatus {
    pub signedIn: bool,
    pub email: String,
    pub accountId: String,
}

/// Owns ChatGPT Codex login, refresh, and credential lookup.
pub struct CodexOAuthService;

impl CodexOAuthService {
    /// Creates the Codex authorization service.
    pub fn getInstance() -> Self {
        Self
    }

    /// Creates the browser authorization URL for the fixed Codex callback.
    pub fn startBrowserLogin(&self) -> Result<CodexBrowserAuthorization, String> {
        browser_authorization().map_err(|error| error.to_string())
    }

    /// Exchanges a browser callback and stores the resulting session.
    pub async fn completeBrowserLogin(
        &self,
        code: String,
        state: String,
        expectedState: String,
        codeVerifier: String,
    ) -> Result<CodexLoginResult, String> {
        if state != expectedState {
            return Err("Codex authorization state does not match".to_string());
        }
        let tokens = exchange_browser_code(&code, &codeVerifier)
            .await
            .map_err(|error| error.to_string())?;
        self.store(tokens).await
    }

    /// Requests a device code for a headless Codex login.
    pub async fn startDeviceLogin(&self) -> Result<CodexDeviceAuthorization, String> {
        start_device_authorization()
            .await
            .map_err(|error| error.to_string())
    }

    /// Waits for device approval, exchanges the code, and stores the session.
    pub async fn completeDeviceLogin(
        &self,
        authorization: CodexDeviceAuthorization,
    ) -> Result<CodexLoginResult, String> {
        let tokens = poll_codex_device(&authorization).await?;
        self.store(tokens).await
    }

    /// Returns whether a ChatGPT Codex session is stored, without exposing tokens.
    pub fn sessionStatus(&self) -> Result<CodexSessionStatus, String> {
        match CodexAuthPreferences::getInstance().load()? {
            Some(tokens) => Ok(CodexSessionStatus {
                signedIn: true,
                email: tokens.email,
                accountId: tokens.accountId,
            }),
            None => Ok(CodexSessionStatus {
                signedIn: false,
                email: String::new(),
                accountId: String::new(),
            }),
        }
    }

    /// Returns a fresh access token and the ChatGPT account id for inference.
    #[operit_route_macros::operit_core_internal]
    pub async fn accessForRequest(&self) -> Result<(String, String), String> {
        let stored = CodexAuthPreferences::getInstance()
            .load()?
            .ok_or_else(|| "Codex authorization is required".to_string())?;
        let previousExpiry = stored.expiresAtMillis;
        let tokens = ensure_fresh_tokens(stored)
            .await
            .map_err(|error| error.to_string())?;
        if tokens.expiresAtMillis != previousExpiry {
            CodexAuthPreferences::getInstance().save(&tokens)?;
        }
        let accountId = account_id_from_tokens(&tokens).map_err(|error| error.to_string())?;
        Ok((tokens.accessToken, accountId))
    }

    /// Removes the saved Codex session.
    pub fn logout(&self) -> Result<(), String> {
        CodexAuthPreferences::getInstance().clear()
    }

    async fn store(&self, tokens: CodexOAuthTokens) -> Result<CodexLoginResult, String> {
        let accountId = account_id_from_tokens(&tokens).map_err(|error| error.to_string())?;
        CodexAuthPreferences::getInstance().save(&tokens)?;
        Ok(CodexLoginResult {
            email: tokens.email,
            accountId,
        })
    }
}

/// Polls until the device login is approved or the Codex device timeout elapses.
async fn poll_codex_device(
    authorization: &CodexDeviceAuthorization,
) -> Result<CodexOAuthTokens, String> {
    let startedAtMillis = operit_host_api::TimeUtils::currentTimeMillisU128();
    let timeoutMillis = 15 * 60 * 1000;
    loop {
        if operit_host_api::TimeUtils::currentTimeMillisU128().saturating_sub(startedAtMillis)
            >= timeoutMillis
        {
            return Err("Codex device authorization timed out".to_string());
        }
        match poll_device_authorization_once(&authorization.deviceAuthId, &authorization.userCode)
            .await
            .map_err(|error| error.to_string())?
        {
            Some(tokens) => return Ok(tokens),
            None => {
                let delayMs = authorization.intervalSeconds.max(1).saturating_mul(1000) as u64;
                defaultHostRuntimeTaskSchedulerHost()
                    .waitForHostRuntimeDelay(delayMs)
                    .await
                    .map_err(|error| error.to_string())?;
            }
        }
    }
}

