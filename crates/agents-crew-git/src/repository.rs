use super::*;

impl GitRepository {
    pub fn discover(start: &Path) -> Result<Self, GitError> {
        let output = run(start, &["rev-parse", "--show-toplevel"])?;
        Ok(Self {
            root: PathBuf::from(output.trim()).canonicalize()?,
        })
    }

    #[must_use]
    pub fn root(&self) -> &Path {
        &self.root
    }

    pub fn snapshot(&self) -> Result<RepositorySnapshot, GitError> {
        let head = run(&self.root, &["rev-parse", "HEAD"]).unwrap_or_else(|_| "unborn".to_string());
        let status = run(
            &self.root,
            &["status", "--porcelain=v1", "--untracked-files=all"],
        )?;
        let diff = run(&self.root, &["diff", "--binary", "HEAD"]).unwrap_or_default();
        let changed_files: Vec<PathBuf> = status.lines().filter_map(parse_status_path).collect();
        let file_hashes = changed_files
            .iter()
            .map(|path| (path.clone(), hash_worktree_path(&self.root, path)))
            .collect();
        let mut hasher = Sha256::new();
        hasher.update(status.as_bytes());
        hasher.update(diff.as_bytes());
        Ok(RepositorySnapshot {
            head: head.trim().to_string(),
            status_porcelain: status,
            diff_hash: hex::encode(hasher.finalize()),
            changed_files,
            file_hashes,
        })
    }

    pub fn changed_files_since(
        &self,
        before: &RepositorySnapshot,
    ) -> Result<Vec<PathBuf>, GitError> {
        let after = self.snapshot()?;
        let previous: BTreeSet<_> = before.changed_files.iter().cloned().collect();
        let mut changed = after
            .changed_files
            .iter()
            .filter(|path| {
                !previous.contains(*path)
                    || before.file_hashes.get(*path) != after.file_hashes.get(*path)
            })
            .cloned()
            .collect::<BTreeSet<_>>();
        for path in previous {
            if !after.file_hashes.contains_key(&path) {
                changed.insert(path);
            }
        }
        Ok(changed.into_iter().collect())
    }

    pub fn validate_write_scope(
        &self,
        scope: &[PathBuf],
        changed: &[PathBuf],
    ) -> Result<(), GitError> {
        let allows_all = scope.iter().any(|path| path == Path::new("."));
        let invalid = changed
            .iter()
            .filter(|path| {
                !allows_all
                    && !scope
                        .iter()
                        .any(|allowed| path == &allowed || path.starts_with(allowed))
            })
            .cloned()
            .collect::<Vec<_>>();
        if invalid.is_empty() {
            Ok(())
        } else {
            Err(GitError::WriteScope(invalid))
        }
    }

    pub fn tracked_files(&self) -> Result<Vec<PathBuf>, GitError> {
        let output = Command::new("git")
            .args(["ls-files", "-z"])
            .current_dir(&self.root)
            .output()?;
        if !output.status.success() {
            return Err(GitError::Command(
                String::from_utf8_lossy(&output.stderr).trim().to_string(),
            ));
        }
        let mut files = output
            .stdout
            .split(|byte| *byte == 0)
            .filter(|part| !part.is_empty())
            .map(|part| PathBuf::from(String::from_utf8_lossy(part).into_owned()))
            .collect::<Vec<_>>();
        files.sort();
        Ok(files)
    }

    pub fn create_task_worktree(&self, run_id: &str, task_id: &str) -> Result<PathBuf, GitError> {
        let safe_run = sanitize_ref(run_id);
        let safe_task = sanitize_ref(task_id);
        let branch = format!("agents-crew/{safe_run}/{safe_task}");
        let path = self
            .root
            .join(".agents-crew/worktrees")
            .join(&safe_run)
            .join(&safe_task);
        if path.exists() {
            let _ = run(
                &self.root,
                &["worktree", "remove", "--force", path_to_str(&path)?],
            );
        }
        let _ = run(&self.root, &["branch", "-D", &branch]);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        run(
            &self.root,
            &["worktree", "add", "-b", &branch, path_to_str(&path)?],
        )?;
        Ok(path)
    }

    pub fn export_patch(&self, worktree: &Path, destination: &Path) -> Result<(), GitError> {
        // Intent-to-add makes new files appear in `git diff` without staging content.
        run(worktree, &["add", "-N", "."])?;
        let patch = run(worktree, &["diff", "--binary", "HEAD"])?;
        if let Some(parent) = destination.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::write(destination, patch)?;
        Ok(())
    }

    pub fn export_paths_patch(
        &self,
        paths: &[PathBuf],
        destination: &Path,
    ) -> Result<(), GitError> {
        let mut patch = String::new();
        for path in paths {
            let relative = path_to_str(path)?;
            let tracked = Command::new("git")
                .args(["ls-files", "--error-unmatch", "--", relative])
                .current_dir(&self.root)
                .output()?
                .status
                .success();
            if tracked {
                patch.push_str(&run(
                    &self.root,
                    &["diff", "--binary", "HEAD", "--", relative],
                )?);
            } else if self.root.join(path).is_file() {
                let output = Command::new("git")
                    .args([
                        "diff",
                        "--no-index",
                        "--binary",
                        "--",
                        "/dev/null",
                        relative,
                    ])
                    .current_dir(&self.root)
                    .output()?;
                if !matches!(output.status.code(), Some(0) | Some(1)) {
                    return Err(GitError::Command(
                        String::from_utf8_lossy(&output.stderr).trim().to_string(),
                    ));
                }
                patch.push_str(&String::from_utf8_lossy(&output.stdout));
            }
        }
        if let Some(parent) = destination.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::write(destination, patch)?;
        Ok(())
    }

    pub fn apply_patch(&self, patch: &Path) -> Result<(), GitError> {
        run(
            &self.root,
            &[
                "apply",
                "--binary",
                "--whitespace=nowarn",
                path_to_str(patch)?,
            ],
        )?;
        Ok(())
    }

    pub fn cleanup_task_worktree(&self, path: &Path) -> Result<(), GitError> {
        let branch = run(path, &["branch", "--show-current"])
            .unwrap_or_default()
            .trim()
            .to_string();
        run(
            &self.root,
            &["worktree", "remove", "--force", path_to_str(path)?],
        )?;
        if !branch.is_empty() {
            let _ = run(&self.root, &["branch", "-D", &branch]);
        }
        Ok(())
    }

    pub fn cleanup_run_worktrees(&self, run_id: &str) -> Result<(), GitError> {
        let root = self
            .root
            .join(".agents-crew/worktrees")
            .join(sanitize_ref(run_id));
        if !root.exists() {
            return Ok(());
        }
        let worktrees = fs::read_dir(&root)?
            .filter_map(Result::ok)
            .map(|entry| entry.path())
            .filter(|path| path.is_dir())
            .collect::<Vec<_>>();
        for worktree in worktrees {
            self.cleanup_task_worktree(&worktree)?;
        }
        if root.exists() {
            fs::remove_dir_all(root)?;
        }
        Ok(())
    }
}

fn run(cwd: &Path, args: &[&str]) -> Result<String, GitError> {
    let output = Command::new("git").args(args).current_dir(cwd).output()?;
    if !output.status.success() {
        return Err(GitError::Command(
            String::from_utf8_lossy(&output.stderr).trim().to_string(),
        ));
    }
    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}
