use base64::{engine::general_purpose, Engine};
use serde::{Deserialize, Serialize};
use serde_json::json;

use super::types::{OutgoingMessage, SaveToSent, SendResult};
use crate::error::{Error, Result};

const BASE: &str = "https://api.resend.com";

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ResendSendResponse {
    id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResendTemplateSummary {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub subject: Option<String>,
}

pub async fn send(
    api_key: &str,
    outgoing: &OutgoingMessage,
    save_to_sent: Option<&SaveToSent>,
) -> Result<SendResult> {
    let client = reqwest::Client::new();
    let mut body = json!({
        "from": outgoing.from,
        "to": outgoing.to,
        "subject": outgoing.subject,
    });
    if !outgoing.cc.is_empty() {
        body["cc"] = json!(outgoing.cc);
    }
    if !outgoing.bcc.is_empty() {
        body["bcc"] = json!(outgoing.bcc);
    }
    if let Some(html) = &outgoing.html {
        body["html"] = json!(html);
    }
    if let Some(text) = &outgoing.text {
        body["text"] = json!(text);
    }
    if let Some(reply_to) = &outgoing.reply_to {
        body["reply_to"] = json!(reply_to);
    }
    if !outgoing.attachments.is_empty() {
        let mut items = Vec::with_capacity(outgoing.attachments.len());
        for a in &outgoing.attachments {
            let bytes = std::fs::read(&a.path)?;
            let content = general_purpose::STANDARD.encode(&bytes);
            let mut entry = json!({
                "filename": a.filename,
                "content": content,
            });
            if let Some(ct) = &a.content_type {
                entry["content_type"] = json!(ct);
            }
            items.push(entry);
        }
        body["attachments"] = json!(items);
    }

    let response = client
        .post(format!("{BASE}/emails"))
        .bearer_auth(api_key)
        .json(&body)
        .send()
        .await?;

    if !response.status().is_success() {
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        return Err(Error::Resend(format!("{status}: {text}")));
    }

    let parsed: ResendSendResponse = response.json().await?;

    let imap_appended = if let Some(sent) = save_to_sent {
        // Resend's API doesn't return the raw MIME, so re-build it locally via
        // lettre just for the IMAP APPEND. Best effort — don't fail the send.
        match super::lettre_transport::build_message(outgoing) {
            Ok(message) => {
                let raw = message.formatted();
                match crate::imap::client::append_message(
                    &sent.imap,
                    &sent.folder,
                    &raw,
                    &["\\Seen".to_string()],
                )
                .await
                {
                    Ok(()) => Some(true),
                    Err(e) => {
                        log::warn!("APPEND to Sent folder {} failed: {e}", sent.folder);
                        Some(false)
                    }
                }
            }
            Err(e) => {
                log::warn!("build_message for Sent copy failed: {e}");
                Some(false)
            }
        }
    } else {
        None
    };

    Ok(SendResult {
        message_id: Some(parsed.id),
        imap_appended,
    })
}

pub async fn send_template(
    api_key: &str,
    template_id: &str,
    from: &str,
    to: &[String],
    variables: &serde_json::Value,
) -> Result<SendResult> {
    let client = reqwest::Client::new();
    let body = json!({
        "from": from,
        "to": to,
        "template_id": template_id,
        "variables": variables,
    });

    let response = client
        .post(format!("{BASE}/emails"))
        .bearer_auth(api_key)
        .json(&body)
        .send()
        .await?;

    if !response.status().is_success() {
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        return Err(Error::Resend(format!("{status}: {text}")));
    }

    let parsed: ResendSendResponse = response.json().await?;
    Ok(SendResult {
        message_id: Some(parsed.id),
        imap_appended: None,
    })
}

pub async fn list_templates(api_key: &str) -> Result<Vec<ResendTemplateSummary>> {
    let client = reqwest::Client::new();
    let response = client
        .get(format!("{BASE}/templates"))
        .bearer_auth(api_key)
        .send()
        .await?;

    if !response.status().is_success() {
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        return Err(Error::Resend(format!("{status}: {text}")));
    }

    #[derive(Deserialize)]
    struct Wrapped {
        data: Vec<ResendTemplateSummary>,
    }

    let parsed: Wrapped = response.json().await?;
    Ok(parsed.data)
}
