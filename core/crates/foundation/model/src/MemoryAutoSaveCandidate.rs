use serde::{Deserialize, Serialize};

/// Stores one owner-scoped request for deferred memory extraction.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct MemoryAutoSaveCandidate {
    pub id: i64,
    pub chatId: String,
    pub triggerMessageTimestamp: i64,
    pub createdAt: i64,
    pub updatedAt: i64,
    pub status: String,
    pub attemptCount: i32,
    pub lastError: String,
    pub sourceType: String,
}

impl MemoryAutoSaveCandidate {
    pub const STATUS_PENDING: &'static str = "pending";
    pub const STATUS_PROCESSING: &'static str = "processing";
    pub const STATUS_FAILED: &'static str = "failed";
    pub const SOURCE_TYPE_REPLY_FINALIZED_AUTO: &'static str = "reply_finalized_auto";
    pub const SOURCE_TYPE_SELECTED_USER_MESSAGE: &'static str = "selected_user_message";

    /// Creates a candidate for one finalized assistant reply.
    pub fn replyFinalized(chatId: String, triggerMessageTimestamp: i64, now: i64) -> Self {
        Self {
            id: 0,
            chatId,
            triggerMessageTimestamp,
            createdAt: now,
            updatedAt: now,
            status: Self::STATUS_PENDING.to_string(),
            attemptCount: 0,
            lastError: String::new(),
            sourceType: Self::SOURCE_TYPE_REPLY_FINALIZED_AUTO.to_string(),
        }
    }

    /// Creates a candidate for one explicitly selected user message.
    pub fn selectedUserMessage(chatId: String, triggerMessageTimestamp: i64, now: i64) -> Self {
        Self {
            sourceType: Self::SOURCE_TYPE_SELECTED_USER_MESSAGE.to_string(),
            ..Self::replyFinalized(chatId, triggerMessageTimestamp, now)
        }
    }

    /// Returns whether this candidate refers to an explicitly selected user message.
    pub fn isSelectedUserMessage(&self) -> bool {
        self.sourceType == Self::SOURCE_TYPE_SELECTED_USER_MESSAGE
    }
}
