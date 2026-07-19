use base64::{engine::general_purpose, Engine};
use mail_parser::{Message, MessageParser, MimeHeaders};

use crate::error::{Error, Result};
use crate::imap::types::{Attachment, MessageBody, UnsubscribeInfo};

pub fn parse_raw(bytes: &[u8], uid: u32) -> Result<MessageBody> {
    let parsed = MessageParser::default()
        .parse(bytes)
        .ok_or_else(|| Error::Parse("mail-parser returned None".into()))?;

    let html = parsed
        .body_html(0)
        .map(|b| b.into_owned())
        .map(|h| inline_cid_images(&parsed, h));
    let text = parsed.body_text(0).map(|b| b.into_owned());

    let mut attachments = Vec::new();
    for (idx, part) in parsed.attachments().enumerate() {
        let filename = part.attachment_name().map(str::to_string);
        let content_type = part
            .content_type()
            .map(|ct| match ct.subtype() {
                Some(sub) => format!("{}/{}", ct.ctype(), sub),
                None => ct.ctype().to_string(),
            })
            .unwrap_or_else(|| "application/octet-stream".to_string());
        attachments.push(Attachment {
            index: idx as u32,
            filename,
            content_type,
            size: part.contents().len() as u64,
        });
    }

    // `header_raw` returns the unparsed header value — important here because
    // mail-parser may try to structure List-Unsubscribe as addresses or as a
    // URI list, and `.as_text()` would return None in that case. The raw
    // bytes are what we need to parse against RFC 2369 / 8058 ourselves.
    let lu = parsed.header_raw("List-Unsubscribe").unwrap_or("");
    let lup = parsed.header_raw("List-Unsubscribe-Post").unwrap_or("");
    let unsubscribe = extract_unsubscribe(lu, lup);

    Ok(MessageBody {
        uid,
        html,
        text,
        headers: Vec::new(),
        attachments,
        unsubscribe,
    })
}

/// Replace `cid:` image references with data: URIs built from the message
/// parts carrying a matching Content-ID, so inline images render instead of
/// showing as broken. The Content-ID header value is conventionally wrapped
/// in angle brackets while the html references it bare — strip them.
fn inline_cid_images(parsed: &Message, mut html: String) -> String {
    if !html.contains("cid:") {
        return html;
    }
    for part in &parsed.parts {
        let Some(cid) = part.content_id() else {
            continue;
        };
        let cid = cid.trim().trim_start_matches('<').trim_end_matches('>');
        if cid.is_empty() {
            continue;
        }
        let needle = format!("cid:{cid}");
        if !html.contains(&needle) {
            continue;
        }
        let mime = part
            .content_type()
            .map(|ct| match ct.subtype() {
                Some(sub) => format!("{}/{}", ct.ctype(), sub),
                None => ct.ctype().to_string(),
            })
            .unwrap_or_else(|| "application/octet-stream".to_string());
        let b64 = general_purpose::STANDARD.encode(part.contents());
        html = html.replace(&needle, &format!("data:{mime};base64,{b64}"));
    }
    html
}

/// Parse a `List-Unsubscribe` header into mailto / https URIs. Per RFC 2369
/// the header value is one or more angle-bracketed URIs separated by commas.
/// Order matters — the left-most URI is the sender's preferred method — but
/// we surface both so the UI can pick the path with the best UX.
fn extract_unsubscribe(
    list_unsubscribe: &str,
    list_unsubscribe_post: &str,
) -> Option<UnsubscribeInfo> {
    let header = list_unsubscribe.trim();
    if header.is_empty() {
        return None;
    }

    let mut mailto: Option<String> = None;
    let mut http: Option<String> = None;

    // Split on commas outside `<...>` groups. The grammar is simple enough
    // that a state machine is overkill — angle brackets never nest in this
    // header.
    let mut depth = 0usize;
    let mut start = 0usize;
    let bytes = header.as_bytes();
    for (i, &b) in bytes.iter().enumerate() {
        match b {
            b'<' => depth += 1,
            b'>' => depth = depth.saturating_sub(1),
            b',' if depth == 0 => {
                take_uri(&header[start..i], &mut mailto, &mut http);
                start = i + 1;
            }
            _ => {}
        }
    }
    take_uri(&header[start..], &mut mailto, &mut http);

    if mailto.is_none() && http.is_none() {
        return None;
    }

    // One-click per RFC 8058 §3.1: header must contain the literal
    // `List-Unsubscribe=One-Click`. Only valid when an https URI exists —
    // mailto one-click isn't a thing.
    let one_click = http.is_some()
        && list_unsubscribe_post
            .split(',')
            .any(|p| p.trim().eq_ignore_ascii_case("List-Unsubscribe=One-Click"));

    Some(UnsubscribeInfo {
        mailto,
        http,
        one_click,
    })
}

fn take_uri(raw: &str, mailto: &mut Option<String>, http: &mut Option<String>) {
    let trimmed = raw.trim().trim_start_matches('<').trim_end_matches('>').trim();
    if trimmed.is_empty() {
        return;
    }
    let lower = trimmed.to_ascii_lowercase();
    if lower.starts_with("mailto:") && mailto.is_none() {
        *mailto = Some(trimmed.to_string());
    } else if (lower.starts_with("https://") || lower.starts_with("http://"))
        && http.is_none()
    {
        *http = Some(trimmed.to_string());
    }
}

pub fn extract_attachment(bytes: &[u8], index: u32) -> Result<Vec<u8>> {
    let parsed = MessageParser::default()
        .parse(bytes)
        .ok_or_else(|| Error::Parse("mail-parser returned None".into()))?;
    let part = parsed
        .attachment(index as usize)
        .ok_or_else(|| Error::Parse(format!("attachment index {index} out of range")))?;
    Ok(part.contents().to_vec())
}

#[cfg(test)]
mod tests {
    use super::*;

    const PLAIN: &str = "From: Alice <alice@example.com>\r\n\
        To: bob@example.com\r\n\
        Subject: Hello\r\n\
        Content-Type: text/plain; charset=utf-8\r\n\
        \r\n\
        Hi Bob, just checking in.\r\n";

    const MULTIPART_ALT: &str = "From: a@example.com\r\n\
        To: b@example.com\r\n\
        Subject: Multi\r\n\
        MIME-Version: 1.0\r\n\
        Content-Type: multipart/alternative; boundary=\"XYZ\"\r\n\
        \r\n\
        --XYZ\r\n\
        Content-Type: text/plain\r\n\
        \r\n\
        plain body\r\n\
        --XYZ\r\n\
        Content-Type: text/html\r\n\
        \r\n\
        <p>html body</p>\r\n\
        --XYZ--\r\n";

    // Attachment payload is base64 of "id,value\n1,2\n" (13 bytes).
    const WITH_ATTACHMENT: &str = "From: a@example.com\r\n\
        To: b@example.com\r\n\
        Subject: Data\r\n\
        MIME-Version: 1.0\r\n\
        Content-Type: multipart/mixed; boundary=\"AAA\"\r\n\
        \r\n\
        --AAA\r\n\
        Content-Type: text/plain\r\n\
        \r\n\
        see attached\r\n\
        --AAA\r\n\
        Content-Type: text/csv; name=\"data.csv\"\r\n\
        Content-Disposition: attachment; filename=\"data.csv\"\r\n\
        Content-Transfer-Encoding: base64\r\n\
        \r\n\
        aWQsdmFsdWUKMSwyCg==\r\n\
        --AAA--\r\n";

    // Inline image payload is a 1x1 transparent PNG referenced by Content-ID.
    const MULTIPART_RELATED: &str = "From: a@example.com\r\n\
        To: b@example.com\r\n\
        Subject: Inline\r\n\
        MIME-Version: 1.0\r\n\
        Content-Type: multipart/related; boundary=\"REL\"\r\n\
        \r\n\
        --REL\r\n\
        Content-Type: text/html\r\n\
        \r\n\
        <p>pic: <img src=\"cid:img1@cursus\"></p>\r\n\
        --REL\r\n\
        Content-Type: image/png\r\n\
        Content-ID: <img1@cursus>\r\n\
        Content-Transfer-Encoding: base64\r\n\
        \r\n\
        iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==\r\n\
        --REL--\r\n";

    #[test]
    fn parse_raw_inlines_cid_images_as_data_uris() {
        let body = parse_raw(MULTIPART_RELATED.as_bytes(), 7).unwrap();
        let html = body.html.expect("html body");
        assert!(html.contains("data:image/png;base64,"), "html: {html}");
        assert!(!html.contains("cid:"), "html: {html}");
    }

    #[test]
    fn parse_raw_plain_text_body() {
        let body = parse_raw(PLAIN.as_bytes(), 42).unwrap();
        assert_eq!(body.uid, 42);
        assert_eq!(body.text.as_deref(), Some("Hi Bob, just checking in.\r\n"));
        // mail-parser synthesises an HTML view from the text part when the
        // message has no HTML body, so `html` is Some even for plain text.
        assert!(body.html.expect("synthesised html").contains("Hi Bob"));
        assert!(body.attachments.is_empty());
        assert!(body.unsubscribe.is_none());
    }

    #[test]
    fn parse_raw_multipart_alternative_bodies() {
        // The CRLF preceding a MIME boundary belongs to the delimiter, so
        // part bodies come back without a trailing newline.
        let body = parse_raw(MULTIPART_ALT.as_bytes(), 1).unwrap();
        assert_eq!(body.text.as_deref(), Some("plain body"));
        assert_eq!(body.html.as_deref(), Some("<p>html body</p>"));
    }

    #[test]
    fn parse_raw_collects_attachment_metadata() {
        let body = parse_raw(WITH_ATTACHMENT.as_bytes(), 1).unwrap();
        assert_eq!(body.attachments.len(), 1);
        let att = &body.attachments[0];
        assert_eq!(att.index, 0);
        assert_eq!(att.filename.as_deref(), Some("data.csv"));
        assert_eq!(att.content_type, "text/csv");
        assert_eq!(att.size, 13); // decoded size, not base64 length
    }

    #[test]
    fn parse_raw_reads_unsubscribe_headers() {
        let msg = format!(
            "List-Unsubscribe: <mailto:unsub@example.com>, <https://example.com/u/1>\r\n\
             List-Unsubscribe-Post: List-Unsubscribe=One-Click\r\n\
             {PLAIN}"
        );
        let body = parse_raw(msg.as_bytes(), 1).unwrap();
        let info = body.unsubscribe.expect("unsubscribe info");
        assert_eq!(info.mailto.as_deref(), Some("mailto:unsub@example.com"));
        assert_eq!(info.http.as_deref(), Some("https://example.com/u/1"));
        assert!(info.one_click);
    }

    #[test]
    fn extract_attachment_returns_decoded_bytes() {
        let bytes = extract_attachment(WITH_ATTACHMENT.as_bytes(), 0).unwrap();
        assert_eq!(bytes, b"id,value\n1,2\n");
    }

    #[test]
    fn extract_attachment_out_of_range_errors() {
        assert!(extract_attachment(WITH_ATTACHMENT.as_bytes(), 5).is_err());
    }

    #[test]
    fn unsubscribe_none_when_header_empty() {
        assert!(extract_unsubscribe("", "").is_none());
        assert!(extract_unsubscribe("   ", "").is_none());
    }

    #[test]
    fn unsubscribe_parses_mailto_and_http() {
        let info =
            extract_unsubscribe("<mailto:u@example.com>, <https://example.com/u>", "").unwrap();
        assert_eq!(info.mailto.as_deref(), Some("mailto:u@example.com"));
        assert_eq!(info.http.as_deref(), Some("https://example.com/u"));
        assert!(!info.one_click);
    }

    #[test]
    fn unsubscribe_ignores_comma_inside_brackets() {
        let info = extract_unsubscribe(
            "<mailto:u@example.com?subject=stop,please>, <https://example.com/u>",
            "",
        )
        .unwrap();
        assert_eq!(
            info.mailto.as_deref(),
            Some("mailto:u@example.com?subject=stop,please")
        );
        assert_eq!(info.http.as_deref(), Some("https://example.com/u"));
    }

    #[test]
    fn unsubscribe_first_uri_of_each_kind_wins() {
        let info = extract_unsubscribe(
            "<https://first.example/u>, <https://second.example/u>, \
             <mailto:first@example.com>, <mailto:second@example.com>",
            "",
        )
        .unwrap();
        assert_eq!(info.http.as_deref(), Some("https://first.example/u"));
        assert_eq!(info.mailto.as_deref(), Some("mailto:first@example.com"));
    }

    #[test]
    fn unsubscribe_one_click_requires_http_and_post_token() {
        // mailto-only: the post header alone must not enable one-click.
        let mailto_only =
            extract_unsubscribe("<mailto:u@example.com>", "List-Unsubscribe=One-Click").unwrap();
        assert!(!mailto_only.one_click);

        // Token match is case-insensitive and may sit in a comma list.
        let http = extract_unsubscribe(
            "<https://example.com/u>",
            "x=y, list-unsubscribe=one-click",
        )
        .unwrap();
        assert!(http.one_click);

        // A different post value must not enable one-click.
        let other = extract_unsubscribe("<https://example.com/u>", "x=y").unwrap();
        assert!(!other.one_click);
    }

    #[test]
    fn unsubscribe_unknown_schemes_yield_none() {
        assert!(extract_unsubscribe("<tel:+15551234567>", "").is_none());
    }
}
