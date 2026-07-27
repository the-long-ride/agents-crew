use super::*;

#[derive(Debug, Serialize, Deserialize)]
struct LockMetadata {
    run_id: String,
    task_id: String,
    pid: u32,
    created_at: DateTime<Utc>,
}

pub struct RepositoryWriteLock {
    path: PathBuf,
}

impl RepositoryWriteLock {
    pub fn acquire(root: &Path, run_id: &str, task_id: &str) -> Result<Self, GitError> {
        let path = root.join(".agents-crew/locks/repository-write.lock");
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)
            .map_err(|error| {
                if error.kind() == std::io::ErrorKind::AlreadyExists {
                    GitError::Locked
                } else {
                    GitError::Io(error)
                }
            })?;
        serde_json::to_writer_pretty(
            &mut file,
            &LockMetadata {
                run_id: run_id.to_string(),
                task_id: task_id.to_string(),
                pid: std::process::id(),
                created_at: Utc::now(),
            },
        )?;
        file.write_all(b"\n")?;
        file.sync_all()?;
        Ok(Self { path })
    }
}

impl Drop for RepositoryWriteLock {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.path);
    }
}
