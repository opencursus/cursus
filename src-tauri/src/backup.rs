// Account backup encryption/decryption.
//
// Format (JSON wrapper, then everything inside `ciphertext_b64` is opaque):
//
//   { "version": 1, "kdf": "argon2id",
//     "salt_b64": "...", "nonce_b64": "...", "ciphertext_b64": "..." }
//
// The plaintext payload is whatever the frontend serialised — we treat it as
// an opaque UTF-8 string. Currently the frontend sends a JSON object holding
// a list of accounts (with their secrets), but this module doesn't need to
// know that.
//
// Crypto: AES-256-GCM with a 96-bit nonce, key derived from the user's
// chosen password via Argon2id (19 MiB, 2 iters, parallelism 1).

use aes_gcm::aead::{rand_core::RngCore, Aead, KeyInit, OsRng};
use aes_gcm::{Aes256Gcm, Key, Nonce};
use argon2::{Algorithm, Argon2, Params, Version};
use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;
use serde::{Deserialize, Serialize};

const ARGON2_MEM_KIB: u32 = 19_456; // 19 MiB
const ARGON2_TIME: u32 = 2;
const ARGON2_PARALLELISM: u32 = 1;
const KEY_LEN: usize = 32;
const SALT_LEN: usize = 16;
const NONCE_LEN: usize = 12;

#[derive(Serialize, Deserialize)]
pub struct SealedBlob {
    pub version: u32,
    pub kdf: String,
    pub salt_b64: String,
    pub nonce_b64: String,
    pub ciphertext_b64: String,
}

fn derive_key(password: &str, salt: &[u8]) -> Result<[u8; KEY_LEN], String> {
    let params = Params::new(
        ARGON2_MEM_KIB,
        ARGON2_TIME,
        ARGON2_PARALLELISM,
        Some(KEY_LEN),
    )
    .map_err(|e| format!("argon2 params: {}", e))?;
    let argon2 = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);
    let mut out = [0u8; KEY_LEN];
    argon2
        .hash_password_into(password.as_bytes(), salt, &mut out)
        .map_err(|e| format!("argon2 derive: {}", e))?;
    Ok(out)
}

pub fn seal(password: &str, plaintext: &str) -> Result<String, String> {
    let mut salt = [0u8; SALT_LEN];
    let mut nonce_bytes = [0u8; NONCE_LEN];
    OsRng.fill_bytes(&mut salt);
    OsRng.fill_bytes(&mut nonce_bytes);

    let key_bytes = derive_key(password, &salt)?;
    let key = Key::<Aes256Gcm>::from_slice(&key_bytes);
    let cipher = Aes256Gcm::new(key);
    let nonce = Nonce::from_slice(&nonce_bytes);

    let ciphertext = cipher
        .encrypt(nonce, plaintext.as_bytes())
        .map_err(|e| format!("encrypt: {}", e))?;

    let blob = SealedBlob {
        version: 1,
        kdf: "argon2id".to_string(),
        salt_b64: B64.encode(salt),
        nonce_b64: B64.encode(nonce_bytes),
        ciphertext_b64: B64.encode(&ciphertext),
    };

    serde_json::to_string(&blob).map_err(|e| format!("serialize: {}", e))
}

pub fn unseal(password: &str, blob_json: &str) -> Result<String, String> {
    let blob: SealedBlob =
        serde_json::from_str(blob_json).map_err(|e| format!("parse blob: {}", e))?;

    if blob.version != 1 {
        return Err(format!("unsupported backup version: {}", blob.version));
    }
    if blob.kdf != "argon2id" {
        return Err(format!("unsupported kdf: {}", blob.kdf));
    }

    let salt = B64.decode(&blob.salt_b64).map_err(|e| format!("salt b64: {}", e))?;
    let nonce_bytes = B64
        .decode(&blob.nonce_b64)
        .map_err(|e| format!("nonce b64: {}", e))?;
    let ciphertext = B64
        .decode(&blob.ciphertext_b64)
        .map_err(|e| format!("ciphertext b64: {}", e))?;

    if nonce_bytes.len() != NONCE_LEN {
        return Err(format!("bad nonce length: {}", nonce_bytes.len()));
    }

    let key_bytes = derive_key(password, &salt)?;
    let key = Key::<Aes256Gcm>::from_slice(&key_bytes);
    let cipher = Aes256Gcm::new(key);
    let nonce = Nonce::from_slice(&nonce_bytes);

    let plaintext = cipher
        .decrypt(nonce, ciphertext.as_slice())
        .map_err(|_| "decrypt failed — wrong password or corrupted backup".to_string())?;

    String::from_utf8(plaintext).map_err(|e| format!("utf8: {}", e))
}
