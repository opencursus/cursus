use crate::error::{Error, Result};

const SERVICE: &str = "flow-mail";

pub fn save(key: &str, value: &str) -> Result<()> {
    let entry = keyring::Entry::new(SERVICE, key)
        .map_err(|e| Error::Config(format!("keyring new: {e}")))?;
    entry
        .set_password(value)
        .map_err(|e| Error::Config(format!("keyring set: {e}")))?;
    Ok(())
}

pub fn load(key: &str) -> Result<Option<String>> {
    let entry = keyring::Entry::new(SERVICE, key)
        .map_err(|e| Error::Config(format!("keyring new: {e}")))?;
    match entry.get_password() {
        Ok(v) => Ok(Some(v)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(Error::Config(format!("keyring get: {e}"))),
    }
}

pub fn delete(key: &str) -> Result<()> {
    let entry = keyring::Entry::new(SERVICE, key)
        .map_err(|e| Error::Config(format!("keyring new: {e}")))?;
    match entry.delete_credential() {
        Ok(_) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(Error::Config(format!("keyring delete: {e}"))),
    }
}
