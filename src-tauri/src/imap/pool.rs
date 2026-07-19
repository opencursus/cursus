use std::collections::HashMap;
use std::sync::{Arc, OnceLock};

use futures::future::BoxFuture;
use tokio::sync::Mutex;

use super::client::{connect, TlsSession};
use super::types::ImapConfig;
use crate::error::Result;

/// One cached, authenticated IMAP session per account. Reusing the session
/// skips the TCP + TLS + LOGIN handshake that used to run on every single
/// operation; each op now pays only its own round-trips (SELECT included —
/// selection is not cached because ops like fetch_messages need the fresh
/// EXISTS count a SELECT returns).
///
/// The per-slot mutex serialises operations on one account: an IMAP session
/// is stateful and cannot interleave commands from concurrent tasks.
pub struct SessionPool {
    slots: Mutex<HashMap<String, Arc<Mutex<Option<TlsSession>>>>>,
}

fn pool() -> &'static SessionPool {
    static POOL: OnceLock<SessionPool> = OnceLock::new();
    POOL.get_or_init(|| SessionPool {
        slots: Mutex::new(HashMap::new()),
    })
}

/// Password intentionally excluded from the key: a changed password makes
/// the next reconnect fail with a login error the caller surfaces — keeping
/// it out avoids stranding a slot per stale credential.
fn key(config: &ImapConfig) -> String {
    format!(
        "{}:{}:{}:{:?}",
        config.host, config.port, config.username, config.security
    )
}

/// Run `op` against the pooled session for this account, transparently
/// reconnecting once when the cached session has gone stale (server idle
/// timeout, dropped NAT mapping, half-closed TLS). `op` may therefore run
/// twice and must be idempotent — every caller in client.rs is a read or an
/// idempotent UID-based store/copy/move (UID commands are no-ops on missing
/// UIDs per RFC 3501).
///
/// The fresh session is cached even when `op` fails on it: a NO/BAD reply
/// (e.g. folder does not exist) leaves the connection healthy, and caching
/// it prevents reconnect churn from periodic pollers hitting the same
/// error. A genuinely broken connection just fails once more on the next
/// call and is then replaced by this same retry path.
pub async fn with_session<T, F>(config: &ImapConfig, mut op: F) -> Result<T>
where
    F: for<'s> FnMut(&'s mut TlsSession) -> BoxFuture<'s, Result<T>>,
{
    let slot = {
        let mut slots = pool().slots.lock().await;
        slots
            .entry(key(config))
            .or_insert_with(|| Arc::new(Mutex::new(None)))
            .clone()
    };
    let mut guard = slot.lock().await;

    if let Some(session) = guard.as_mut() {
        match op(session).await {
            Ok(value) => return Ok(value),
            Err(err) => {
                log::info!("imap pool: cached session for {} failed ({err}); reconnecting", config.host);
                *guard = None;
            }
        }
    }

    let mut session = connect(config).await?;
    let result = op(&mut session).await;
    *guard = Some(session);
    result
}
