use super::*;

pub(super) fn path_to_str(path: &Path) -> Result<&str, GitError> {
    path.to_str()
        .ok_or_else(|| GitError::PathEscape(path.to_path_buf()))
}

pub(super) fn sanitize_ref(value: &str) -> String {
    value
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || matches!(character, '-' | '_') {
                character
            } else {
                '-'
            }
        })
        .collect()
}

pub(super) fn hash_worktree_path(root: &Path, relative: &Path) -> String {
    let path = root.join(relative);
    let mut hasher = Sha256::new();
    match fs::read(path) {
        Ok(bytes) => hasher.update(bytes),
        Err(_) => hasher.update(b"<missing>"),
    }
    hex::encode(hasher.finalize())
}

pub(super) fn parse_status_path(line: &str) -> Option<PathBuf> {
    let raw = line.get(3..)?.trim();
    let raw = raw.rsplit(" -> ").next().unwrap_or(raw);
    Some(PathBuf::from(raw.trim_matches('"')))
}

pub fn canonical_scoped_path(root: &Path, relative: &Path) -> Result<PathBuf, GitError> {
    if relative.components().any(|component| {
        matches!(
            component,
            Component::ParentDir | Component::RootDir | Component::Prefix(_)
        )
    }) {
        return Err(GitError::PathEscape(relative.to_path_buf()));
    }
    let joined = root.join(relative);
    if joined.exists() {
        let canonical = joined.canonicalize()?;
        if !canonical.starts_with(root) {
            return Err(GitError::PathEscape(relative.to_path_buf()));
        }
        return Ok(canonical);
    }
    let parent = joined
        .parent()
        .unwrap_or(root)
        .canonicalize()
        .unwrap_or_else(|_| root.to_path_buf());
    if !parent.starts_with(root) {
        return Err(GitError::PathEscape(relative.to_path_buf()));
    }
    Ok(joined)
}
