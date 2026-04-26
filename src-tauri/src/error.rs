use serde::{Serialize, Serializer};

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("io: {0}")]
    Io(#[from] std::io::Error),

    #[error("tls: {0}")]
    Tls(#[from] native_tls::Error),

    #[error("imap: {0}")]
    Imap(String),

    #[error("smtp: {0}")]
    Smtp(String),

    #[error("resend: {0}")]
    Resend(String),

    #[error("parse: {0}")]
    Parse(String),

    #[error("config: {0}")]
    Config(String),

    #[error("http: {0}")]
    Http(#[from] reqwest::Error),

    #[error("json: {0}")]
    Json(#[from] serde_json::Error),
}

impl Serialize for Error {
    fn serialize<S: Serializer>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.to_string())
    }
}

pub type Result<T> = std::result::Result<T, Error>;
