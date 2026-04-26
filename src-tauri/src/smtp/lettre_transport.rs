use lettre::{
    message::{header::ContentType, Attachment, Mailbox, Message, MessageBuilder, MultiPart, SinglePart},
    transport::smtp::{authentication::Credentials, client::Tls, AsyncSmtpTransport},
    AsyncTransport, Tokio1Executor,
};

use super::types::{
    OutgoingAttachment, OutgoingMessage, SaveToSent, SendResult, SmtpConfig, SmtpSecurity,
};
use crate::error::{Error, Result};

pub async fn test_connection(config: &SmtpConfig) -> Result<()> {
    let transport = build_transport(config)?;
    let ok = transport
        .test_connection()
        .await
        .map_err(|e| Error::Smtp(format!("test: {e}")))?;
    if !ok {
        return Err(Error::Smtp("server rejected test connection".into()));
    }
    Ok(())
}

pub async fn send(
    config: &SmtpConfig,
    outgoing: &OutgoingMessage,
    save_to_sent: Option<&SaveToSent>,
) -> Result<SendResult> {
    let transport = build_transport(config)?;
    let message = build_message(outgoing)?;
    // `formatted()` materialises the full RFC822 message once. We reuse the
    // same bytes for the IMAP APPEND below, so the Sent copy is byte-identical
    // to what went out via SMTP.
    let raw = message.formatted();

    let response = transport
        .send(message)
        .await
        .map_err(|e| Error::Smtp(format!("send: {e}")))?;

    let message_id = response
        .message()
        .next()
        .map(str::to_string);

    let imap_appended = if let Some(sent) = save_to_sent {
        // Best effort — never fail the send because the Sent copy couldn't be
        // appended. The mail is already out the door by this point.
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
    } else {
        None
    };

    Ok(SendResult {
        message_id,
        imap_appended,
    })
}

fn build_transport(config: &SmtpConfig) -> Result<AsyncSmtpTransport<Tokio1Executor>> {
    let builder = match config.security {
        SmtpSecurity::Ssl => {
            AsyncSmtpTransport::<Tokio1Executor>::relay(&config.host)
                .map_err(|e| Error::Smtp(format!("relay: {e}")))?
        }
        SmtpSecurity::StartTls => {
            AsyncSmtpTransport::<Tokio1Executor>::starttls_relay(&config.host)
                .map_err(|e| Error::Smtp(format!("starttls relay: {e}")))?
        }
        SmtpSecurity::None => AsyncSmtpTransport::<Tokio1Executor>::builder_dangerous(&config.host)
            .tls(Tls::None),
    };

    let creds = Credentials::new(config.username.clone(), config.password.clone());

    Ok(builder.port(config.port).credentials(creds).build())
}

pub fn build_message(outgoing: &OutgoingMessage) -> Result<Message> {
    let from: Mailbox = outgoing
        .from
        .parse()
        .map_err(|e| Error::Smtp(format!("parse from: {e}")))?;

    let mut builder: MessageBuilder = Message::builder().from(from).subject(&outgoing.subject);

    for to in &outgoing.to {
        let addr: Mailbox = to
            .parse()
            .map_err(|e| Error::Smtp(format!("parse to: {e}")))?;
        builder = builder.to(addr);
    }
    for cc in &outgoing.cc {
        let addr: Mailbox = cc
            .parse()
            .map_err(|e| Error::Smtp(format!("parse cc: {e}")))?;
        builder = builder.cc(addr);
    }
    for bcc in &outgoing.bcc {
        let addr: Mailbox = bcc
            .parse()
            .map_err(|e| Error::Smtp(format!("parse bcc: {e}")))?;
        builder = builder.bcc(addr);
    }
    if let Some(reply_to) = &outgoing.reply_to {
        let addr: Mailbox = reply_to
            .parse()
            .map_err(|e| Error::Smtp(format!("parse reply-to: {e}")))?;
        builder = builder.reply_to(addr);
    }

    let body = build_body(&outgoing.html, &outgoing.text)?;

    let message = if outgoing.attachments.is_empty() {
        match body {
            MessageBody::Multi(mp) => builder.multipart(mp),
            MessageBody::Single(sp) => builder.singlepart(sp),
        }
    } else {
        let mut mixed = match body {
            MessageBody::Multi(mp) => MultiPart::mixed().multipart(mp),
            MessageBody::Single(sp) => MultiPart::mixed().singlepart(sp),
        };
        for a in &outgoing.attachments {
            mixed = mixed.singlepart(build_attachment_part(a)?);
        }
        builder.multipart(mixed)
    };

    message.map_err(|e| Error::Smtp(format!("build message: {e}")))
}

enum MessageBody {
    Multi(MultiPart),
    Single(SinglePart),
}

fn build_body(html: &Option<String>, text: &Option<String>) -> Result<MessageBody> {
    match (html, text) {
        (Some(h), Some(t)) => Ok(MessageBody::Multi(
            MultiPart::alternative()
                .singlepart(
                    SinglePart::builder()
                        .header(ContentType::TEXT_PLAIN)
                        .body(t.clone()),
                )
                .singlepart(
                    SinglePart::builder()
                        .header(ContentType::TEXT_HTML)
                        .body(h.clone()),
                ),
        )),
        (Some(h), None) => Ok(MessageBody::Single(
            SinglePart::builder()
                .header(ContentType::TEXT_HTML)
                .body(h.clone()),
        )),
        (None, Some(t)) => Ok(MessageBody::Single(
            SinglePart::builder()
                .header(ContentType::TEXT_PLAIN)
                .body(t.clone()),
        )),
        (None, None) => Err(Error::Smtp("message must have html or text body".into())),
    }
}

fn build_attachment_part(a: &OutgoingAttachment) -> Result<SinglePart> {
    let bytes = std::fs::read(&a.path)?;
    let ct_str = a.content_type.as_deref().unwrap_or("application/octet-stream");
    let content_type = ContentType::parse(ct_str)
        .map_err(|e| Error::Smtp(format!("parse content-type {ct_str}: {e}")))?;
    Ok(Attachment::new(a.filename.clone()).body(bytes, content_type))
}
