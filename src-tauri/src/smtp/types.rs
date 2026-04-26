use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SmtpConfig {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub password: String,
    #[serde(default = "default_security")]
    pub security: SmtpSecurity,
}

fn default_security() -> SmtpSecurity {
    SmtpSecurity::StartTls
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum SmtpSecurity {
    Ssl,
    StartTls,
    None,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OutgoingMessage {
    pub from: String,
    pub to: Vec<String>,
    #[serde(default)]
    pub cc: Vec<String>,
    #[serde(default)]
    pub bcc: Vec<String>,
    pub subject: String,
    pub html: Option<String>,
    pub text: Option<String>,
    #[serde(default)]
    pub reply_to: Option<String>,
    #[serde(default)]
    pub attachments: Vec<OutgoingAttachment>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OutgoingAttachment {
    pub filename: String,
    pub path: String,
    #[serde(default)]
    pub content_type: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SendResult {
    pub message_id: Option<String>,
    /// Present only when `save_to_sent` was requested:
    ///   `Some(true)`  — APPEND to IMAP Sent succeeded.
    ///   `Some(false)` — APPEND attempted and failed (sent_log is the only
    ///                   local copy).
    ///   `None`        — no APPEND was requested.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub imap_appended: Option<bool>,
}

/// Instructions for the Rust side to APPEND the sent message to the
/// sender's IMAP Sent folder immediately after a successful send. Without
/// this, SMTP-sent mail never appears in Sent because SMTP only transmits —
/// it's the client's job to save a copy to IMAP.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveToSent {
    pub imap: crate::imap::types::ImapConfig,
    pub folder: String,
}
