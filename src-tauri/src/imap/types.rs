use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum FlagMode {
    Add,
    Remove,
    Replace,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImapConfig {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub password: String,
    #[serde(default = "default_security")]
    pub security: ImapSecurity,
}

fn default_security() -> ImapSecurity {
    ImapSecurity::Ssl
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ImapSecurity {
    Ssl,
    StartTls,
    None,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderStatus {
    pub unseen: u32,
    pub total: u32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Folder {
    pub name: String,
    pub path: String,
    pub delimiter: Option<String>,
    pub flags: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MessageSummary {
    pub uid: u32,
    pub subject: Option<String>,
    pub from: Option<String>,
    pub to: Vec<String>,
    pub date: Option<i64>,
    pub snippet: Option<String>,
    pub flags: Vec<String>,
    pub has_attachments: bool,
    /// Newsletter-like signals: List-Unsubscribe / List-Id header present,
    /// or Precedence is bulk/list. Strongest categorisation signal.
    pub is_bulk: bool,
    /// RFC 3834 Auto-Submitted header set to anything other than "no" —
    /// indicates the message came from an automated transactional system.
    pub is_auto: bool,
    /// RFC 5322 `Message-ID` of this message, normalised to lowercase with
    /// surrounding angle brackets stripped. Empty string when missing.
    pub message_id: String,
    /// Single parent ID from `In-Reply-To`, same normalisation as above.
    pub in_reply_to: String,
    /// Full chain from `References`, in order, same normalisation.
    pub references: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MessageBody {
    pub uid: u32,
    pub html: Option<String>,
    pub text: Option<String>,
    pub headers: Vec<(String, String)>,
    pub attachments: Vec<Attachment>,
    /// Populated when the message carries RFC 2369 `List-Unsubscribe` (and
    /// optionally RFC 8058 `List-Unsubscribe-Post`). Used by the UI to show
    /// a one-click Unsubscribe button.
    pub unsubscribe: Option<UnsubscribeInfo>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UnsubscribeInfo {
    pub mailto: Option<String>,
    pub http: Option<String>,
    /// True when `List-Unsubscribe-Post: List-Unsubscribe=One-Click` is
    /// present AND an `https://` URI exists — signals the sender accepts the
    /// RFC 8058 silent POST.
    pub one_click: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Attachment {
    pub index: u32,
    pub filename: Option<String>,
    pub content_type: String,
    pub size: u64,
}
