use super::*;

pub(super) fn load_manifest(path: &Path) -> Result<PluginManifest, PluginError> {
    Ok(serde_json::from_slice(&fs::read(path)?)?)
}

pub(super) fn hash_bytes(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    hex::encode(hasher.finalize())
}

pub(super) fn hash_file(path: &Path) -> Result<String, PluginError> {
    Ok(hash_bytes(&fs::read(path)?))
}
