use crate::error::{Error, Result};

const SERVICE: &str = "cursus";
/// Pre-rename service name. We still read from it on `load` and migrate
/// the value over to the new service the first time it's needed, so users
/// upgrading from a "flow-mail"-era build don't lose their stored secrets.
const LEGACY_SERVICE: &str = "flow-mail";

pub fn save(key: &str, value: &str) -> Result<()> {
    let entry = keyring::Entry::new(SERVICE, key)
        .map_err(|e| Error::Config(format!("keyring new: {e}")))?;
    entry
        .set_password(value)
        .map_err(|e| Error::Config(format!("keyring set: {e}")))?;
    // Best-effort cleanup of any value left in the legacy service so the
    // password isn't stored twice.
    if let Ok(legacy) = keyring::Entry::new(LEGACY_SERVICE, key) {
        let _ = legacy.delete_credential();
    }
    Ok(())
}

pub fn load(key: &str) -> Result<Option<String>> {
    let entry = keyring::Entry::new(SERVICE, key)
        .map_err(|e| Error::Config(format!("keyring new: {e}")))?;
    match entry.get_password() {
        Ok(v) => Ok(Some(v)),
        Err(keyring::Error::NoEntry) => load_legacy_and_migrate(key),
        Err(e) => Err(Error::Config(format!("keyring get: {e}"))),
    }
}

fn load_legacy_and_migrate(key: &str) -> Result<Option<String>> {
    let legacy = keyring::Entry::new(LEGACY_SERVICE, key)
        .map_err(|e| Error::Config(format!("keyring new (legacy): {e}")))?;
    let value = match legacy.get_password() {
        Ok(v) => v,
        Err(keyring::Error::NoEntry) => return Ok(None),
        Err(e) => return Err(Error::Config(format!("keyring get (legacy): {e}"))),
    };
    // Promote into the new service. If either side fails, return the value
    // anyway — losing the secret would be worse than a dangling legacy entry.
    if let Ok(new_entry) = keyring::Entry::new(SERVICE, key) {
        let _ = new_entry.set_password(&value);
    }
    let _ = legacy.delete_credential();
    Ok(Some(value))
}

pub fn delete(key: &str) -> Result<()> {
    if let Ok(entry) = keyring::Entry::new(SERVICE, key) {
        match entry.delete_credential() {
            Ok(_) | Err(keyring::Error::NoEntry) => {}
            Err(e) => return Err(Error::Config(format!("keyring delete: {e}"))),
        }
    }
    // Also clean the legacy service so old credentials don't linger.
    if let Ok(legacy) = keyring::Entry::new(LEGACY_SERVICE, key) {
        let _ = legacy.delete_credential();
    }
    Ok(())
}
