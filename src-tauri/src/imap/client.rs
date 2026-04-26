use async_imap::Session;
use futures::StreamExt;
use mail_parser::MessageParser;
use native_tls::TlsConnector;
use tokio::net::TcpStream;
use tokio_native_tls::TlsStream;

use super::types::{FlagMode, Folder, FolderStatus, ImapConfig, ImapSecurity, MessageBody, MessageSummary};
use crate::error::{Error, Result};

type TlsSession = Session<TlsStream<TcpStream>>;

pub async fn test_connection(config: &ImapConfig) -> Result<()> {
    let mut session = connect(config).await?;
    session
        .logout()
        .await
        .map_err(|e| Error::Imap(format!("logout: {e}")))?;
    Ok(())
}

pub async fn list_folders(config: &ImapConfig) -> Result<Vec<Folder>> {
    let mut session = connect(config).await?;
    let mut stream = session
        .list(Some(""), Some("*"))
        .await
        .map_err(|e| Error::Imap(format!("list: {e}")))?;

    let mut folders = Vec::new();
    while let Some(item) = stream.next().await {
        let entry = item.map_err(|e| Error::Imap(format!("list item: {e}")))?;
        folders.push(Folder {
            name: entry.name().to_string(),
            path: entry.name().to_string(),
            delimiter: entry.delimiter().map(str::to_string),
            flags: entry
                .attributes()
                .iter()
                .map(name_attribute_label)
                .collect(),
        });
    }
    drop(stream);

    session
        .logout()
        .await
        .map_err(|e| Error::Imap(format!("logout: {e}")))?;
    Ok(folders)
}

pub async fn folder_status(config: &ImapConfig, folder: &str) -> Result<FolderStatus> {
    let mut session = connect(config).await?;
    let mbox = session
        .status(folder, "(UNSEEN MESSAGES)")
        .await
        .map_err(|e| Error::Imap(format!("status {folder}: {e}")))?;
    let _ = session.logout().await;
    Ok(FolderStatus {
        unseen: mbox.unseen.unwrap_or(0),
        total: mbox.exists,
    })
}

pub async fn fetch_messages(
    config: &ImapConfig,
    folder: &str,
    limit: u32,
    offset: u32,
) -> Result<Vec<MessageSummary>> {
    let mut session = connect(config).await?;
    let mailbox = session
        .select(folder)
        .await
        .map_err(|e| Error::Imap(format!("select {folder}: {e}")))?;

    let exists = mailbox.exists;
    if exists == 0 || offset >= exists {
        let _ = session.logout().await;
        return Ok(Vec::new());
    }

    // `offset` skips the most-recent N messages — the inbox is fetched
    // newest-first in pages of `limit`. Pages further back than `exists`
    // bottom out at sequence 1.
    let end = exists.saturating_sub(offset);
    let start = end.saturating_sub(limit.saturating_sub(1)).max(1);
    let query = format!("{start}:{end}");

    let mut stream = session
        .fetch(&query, "(UID FLAGS INTERNALDATE RFC822.HEADER)")
        .await
        .map_err(|e| Error::Imap(format!("fetch: {e}")))?;

    let mut summaries: Vec<MessageSummary> = Vec::new();
    while let Some(item) = stream.next().await {
        let fetch = item.map_err(|e| Error::Imap(format!("fetch item: {e}")))?;
        summaries.push(summary_from(&fetch));
    }
    drop(stream);
    let _ = session.logout().await;

    summaries.sort_by(|a, b| b.date.cmp(&a.date));
    Ok(summaries)
}

/// `UID SEARCH UNSEEN` + a single `UID FETCH` of the matched UIDs. Used by
/// the Unread tab to surface every server-side unread message in one round-
/// trip rather than paginating through cronological pages and discarding
/// the read ones.
pub async fn fetch_unread(
    config: &ImapConfig,
    folder: &str,
    limit: u32,
) -> Result<Vec<MessageSummary>> {
    let mut session = connect(config).await?;
    session
        .select(folder)
        .await
        .map_err(|e| Error::Imap(format!("select {folder}: {e}")))?;

    let uids = session
        .uid_search("UNSEEN")
        .await
        .map_err(|e| Error::Imap(format!("uid_search UNSEEN: {e}")))?;

    if uids.is_empty() {
        let _ = session.logout().await;
        return Ok(Vec::new());
    }

    // Cap at `limit` newest UIDs so we don't pull thousands at once for
    // accounts with massive unread counts. Sorted descending so the cap
    // keeps the most recent ones.
    let mut sorted: Vec<u32> = uids.into_iter().collect();
    sorted.sort_unstable_by(|a, b| b.cmp(a));
    let take = limit.min(sorted.len() as u32) as usize;
    let chosen: Vec<String> = sorted.into_iter().take(take).map(|u| u.to_string()).collect();
    let query = chosen.join(",");

    let mut stream = session
        .uid_fetch(&query, "(UID FLAGS INTERNALDATE RFC822.HEADER)")
        .await
        .map_err(|e| Error::Imap(format!("uid_fetch: {e}")))?;

    let mut summaries: Vec<MessageSummary> = Vec::new();
    while let Some(item) = stream.next().await {
        let fetch = item.map_err(|e| Error::Imap(format!("fetch item: {e}")))?;
        summaries.push(summary_from(&fetch));
    }
    drop(stream);
    let _ = session.logout().await;

    summaries.sort_by(|a, b| b.date.cmp(&a.date));
    Ok(summaries)
}

pub async fn set_flags(
    config: &ImapConfig,
    folder: &str,
    uid: u32,
    flags: &[String],
    mode: FlagMode,
) -> Result<()> {
    let mut session = connect(config).await?;
    session
        .select(folder)
        .await
        .map_err(|e| Error::Imap(format!("select {folder}: {e}")))?;

    let flag_list = flags.join(" ");
    let prefix = match mode {
        FlagMode::Add => "+FLAGS",
        FlagMode::Remove => "-FLAGS",
        FlagMode::Replace => "FLAGS",
    };
    let query = format!("{prefix} ({flag_list})");

    let mut stream = session
        .uid_store(uid.to_string(), &query)
        .await
        .map_err(|e| Error::Imap(format!("uid_store: {e}")))?;

    // Drain the stream so the command completes on the wire.
    while stream.next().await.is_some() {}
    drop(stream);

    let _ = session.logout().await;
    Ok(())
}

pub async fn move_uid(
    config: &ImapConfig,
    folder: &str,
    dest_folder: &str,
    uid: u32,
) -> Result<()> {
    let mut session = connect(config).await?;
    session
        .select(folder)
        .await
        .map_err(|e| Error::Imap(format!("select {folder}: {e}")))?;

    // Try RFC 6851 UID MOVE first (supported by Dovecot, Gmail, Cyrus, etc).
    match session.uid_mv(uid.to_string(), dest_folder).await {
        Ok(_) => {}
        Err(_move_err) => {
            // Fallback: COPY + STORE +FLAGS \Deleted + EXPUNGE.
            session
                .uid_copy(uid.to_string(), dest_folder)
                .await
                .map_err(|e| Error::Imap(format!("uid_copy: {e}")))?;

            let mut store = session
                .uid_store(uid.to_string(), "+FLAGS (\\Deleted)")
                .await
                .map_err(|e| Error::Imap(format!("uid_store: {e}")))?;
            while store.next().await.is_some() {}
            drop(store);

            let expunge = session
                .uid_expunge(uid.to_string())
                .await
                .map_err(|e| Error::Imap(format!("uid_expunge: {e}")))?;
            let mut expunge = Box::pin(expunge);
            while expunge.next().await.is_some() {}
        }
    }

    let _ = session.logout().await;
    Ok(())
}

pub async fn fetch_message_body(
    config: &ImapConfig,
    folder: &str,
    uid: u32,
) -> Result<MessageBody> {
    let bytes = fetch_raw_message(config, folder, uid).await?;
    crate::parser::parse_raw(&bytes, uid)
}

pub async fn save_attachment(
    config: &ImapConfig,
    folder: &str,
    uid: u32,
    index: u32,
    dest_path: &str,
) -> Result<()> {
    let bytes = fetch_raw_message(config, folder, uid).await?;
    let attachment = crate::parser::extract_attachment(&bytes, index)?;
    std::fs::write(dest_path, &attachment)?;
    Ok(())
}

pub async fn create_folder(config: &ImapConfig, name: &str) -> Result<()> {
    let mut session = connect(config).await?;
    session
        .create(name)
        .await
        .map_err(|e| Error::Imap(format!("create {name}: {e}")))?;
    let _ = session.logout().await;
    Ok(())
}

pub async fn rename_folder(config: &ImapConfig, from: &str, to: &str) -> Result<()> {
    let mut session = connect(config).await?;
    session
        .rename(from, to)
        .await
        .map_err(|e| Error::Imap(format!("rename {from} -> {to}: {e}")))?;
    let _ = session.logout().await;
    Ok(())
}

pub async fn delete_folder(config: &ImapConfig, path: &str) -> Result<()> {
    let mut session = connect(config).await?;
    session
        .delete(path)
        .await
        .map_err(|e| Error::Imap(format!("delete {path}: {e}")))?;
    let _ = session.logout().await;
    Ok(())
}

pub async fn append_message(
    config: &ImapConfig,
    folder: &str,
    bytes: &[u8],
    flags: &[String],
) -> Result<()> {
    let mut session = connect(config).await?;

    // async-imap 0.10 expects flags as a raw parenthesised IMAP list
    // (e.g. `(\Seen)`), not a slice. Build it only when we actually have
    // flags to avoid sending an empty `()` which some servers reject.
    let flags_str: Option<String> = if flags.is_empty() {
        None
    } else {
        Some(format!("({})", flags.join(" ")))
    };

    session
        .append(folder, flags_str.as_deref(), None, bytes)
        .await
        .map_err(|e| Error::Imap(format!("append to {folder}: {e}")))?;

    let _ = session.logout().await;
    Ok(())
}

async fn fetch_raw_message(config: &ImapConfig, folder: &str, uid: u32) -> Result<Vec<u8>> {
    let mut session = connect(config).await?;
    session
        .select(folder)
        .await
        .map_err(|e| Error::Imap(format!("select {folder}: {e}")))?;

    let mut stream = session
        .uid_fetch(uid.to_string(), "BODY.PEEK[]")
        .await
        .map_err(|e| Error::Imap(format!("uid_fetch: {e}")))?;

    let mut raw: Option<Vec<u8>> = None;
    while let Some(item) = stream.next().await {
        let fetch = item.map_err(|e| Error::Imap(format!("fetch item: {e}")))?;
        if let Some(body) = fetch.body() {
            raw = Some(body.to_vec());
            break;
        }
    }
    drop(stream);
    let _ = session.logout().await;

    raw.ok_or_else(|| Error::Imap(format!("no body for UID {uid}")))
}

fn summary_from(fetch: &async_imap::types::Fetch) -> MessageSummary {
    let uid = fetch.uid.unwrap_or(0);
    let flags: Vec<String> = fetch.flags().map(|f| format!("{f:?}")).collect();
    let internal_date = fetch.internal_date().map(|d| d.timestamp());

    // Parse the raw RFC822.HEADER bytes with mail-parser — this handles
    // RFC 2047 encoded-words (`=?utf-8?Q?...?=`) automatically so subject
    // and names come out human-readable.
    let header_bytes = fetch.header().unwrap_or(&[]);
    let parsed = MessageParser::default().parse(header_bytes);

    let subject = parsed
        .as_ref()
        .and_then(|p| p.subject())
        .map(String::from);

    let from = parsed
        .as_ref()
        .and_then(|p| p.from())
        .and_then(|a| a.first())
        .map(format_mp_addr);

    let to = parsed
        .as_ref()
        .and_then(|p| p.to())
        .map(|a| a.iter().map(format_mp_addr).collect::<Vec<_>>())
        .unwrap_or_default();

    let header_date = parsed
        .as_ref()
        .and_then(|p| p.date())
        .map(|d| d.to_timestamp());

    let is_bulk = parsed.as_ref().is_some_and(|p| {
        p.header("List-Unsubscribe").is_some()
            || p.header("List-Id").is_some()
            || header_text(p, "Precedence").is_some_and(|v| {
                let lv = v.to_ascii_lowercase();
                lv.contains("bulk") || lv.contains("list")
            })
    });

    let is_auto = parsed.as_ref().is_some_and(|p| {
        header_text(p, "Auto-Submitted").is_some_and(|v| !v.eq_ignore_ascii_case("no"))
    });

    let message_id = parsed
        .as_ref()
        .and_then(|p| header_text(p, "Message-ID").or_else(|| header_text(p, "Message-Id")))
        .map(normalise_message_id)
        .unwrap_or_default();

    let in_reply_to = parsed
        .as_ref()
        .and_then(|p| header_text(p, "In-Reply-To"))
        .map(normalise_message_id)
        .unwrap_or_default();

    let references = parsed
        .as_ref()
        .and_then(|p| header_text(p, "References"))
        .map(extract_references)
        .unwrap_or_default();

    MessageSummary {
        uid,
        subject,
        from,
        to,
        date: header_date.or(internal_date),
        snippet: None,
        flags,
        has_attachments: false,
        is_bulk,
        is_auto,
        message_id,
        in_reply_to,
        references,
    }
}

/// Strip outer angle brackets and lowercase. The wire form is typically
/// `<abc.123@host.com>`; we want `abc.123@host.com`. Some senders include
/// surrounding whitespace or quotes — those are also trimmed.
fn normalise_message_id(raw: &str) -> String {
    let trimmed = raw.trim().trim_matches(|c: char| c == '<' || c == '>' || c == '"' || c.is_whitespace());
    trimmed.to_ascii_lowercase()
}

/// `References:` is whitespace-separated. We split on whitespace, then
/// normalise each token. Empty tokens are skipped.
fn extract_references(raw: &str) -> Vec<String> {
    raw.split_whitespace()
        .map(normalise_message_id)
        .filter(|s| !s.is_empty())
        .collect()
}

fn header_text<'a>(msg: &'a mail_parser::Message<'_>, name: &'a str) -> Option<&'a str> {
    msg.header(name).and_then(|v| v.as_text())
}

fn format_mp_addr(a: &mail_parser::Addr<'_>) -> String {
    let name = a.name.as_deref().map(|s| s.trim()).filter(|s| !s.is_empty());
    let address = a.address.as_deref().map(|s| s.trim());
    match (name, address) {
        (Some(n), Some(addr)) => format!("{n} <{addr}>"),
        (None, Some(addr)) => addr.to_string(),
        (Some(n), None) => n.to_string(),
        _ => String::new(),
    }
}

fn name_attribute_label(attr: &async_imap::imap_proto::NameAttribute<'_>) -> String {
    use async_imap::imap_proto::NameAttribute;
    match attr {
        NameAttribute::NoInferiors => "\\NoInferiors".into(),
        NameAttribute::NoSelect => "\\NoSelect".into(),
        NameAttribute::Marked => "\\Marked".into(),
        NameAttribute::Unmarked => "\\Unmarked".into(),
        NameAttribute::Extension(s) => s.to_string(),
        // The enum is marked non_exhaustive; any newer variant falls back
        // to its debug form so the frontend at least sees something.
        other => format!("{other:?}"),
    }
}

pub(crate) async fn connect(config: &ImapConfig) -> Result<TlsSession> {
    match config.security {
        ImapSecurity::Ssl => connect_ssl(config).await,
        ImapSecurity::StartTls => connect_starttls(config).await,
        ImapSecurity::None => Err(Error::Config(
            "Plain IMAP is not supported — choose SSL or STARTTLS".into(),
        )),
    }
}

async fn connect_ssl(config: &ImapConfig) -> Result<TlsSession> {
    let tcp = TcpStream::connect((config.host.as_str(), config.port)).await?;
    let tls_stream = tls_handshake(&config.host, tcp).await?;
    finish_login(tls_stream, config).await
}

async fn connect_starttls(config: &ImapConfig) -> Result<TlsSession> {
    let tcp = TcpStream::connect((config.host.as_str(), config.port)).await?;
    let mut plain = async_imap::Client::new(tcp);
    plain
        .run_command_and_check_ok("STARTTLS", None)
        .await
        .map_err(|e| Error::Imap(format!("starttls: {e}")))?;
    let tcp = plain.into_inner();
    let tls_stream = tls_handshake(&config.host, tcp).await?;
    finish_login(tls_stream, config).await
}

async fn tls_handshake(host: &str, tcp: TcpStream) -> Result<TlsStream<TcpStream>> {
    let tls = TlsConnector::builder().build()?;
    let tls = tokio_native_tls::TlsConnector::from(tls);
    tls.connect(host, tcp)
        .await
        .map_err(|e| Error::Imap(format!("tls handshake: {e}")))
}

async fn finish_login(
    stream: TlsStream<TcpStream>,
    config: &ImapConfig,
) -> Result<TlsSession> {
    let client = async_imap::Client::new(stream);
    let session = client
        .login(&config.username, &config.password)
        .await
        .map_err(|(e, _)| Error::Imap(format!("login: {e}")))?;
    Ok(session)
}
