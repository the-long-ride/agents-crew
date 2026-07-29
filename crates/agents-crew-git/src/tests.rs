use super::*;

#[test]
fn rejects_parent_escape() {
    let root = std::env::current_dir().unwrap();
    assert!(canonical_scoped_path(&root, Path::new("../x")).is_err());
}

#[test]
fn dot_scope_allows_repository_paths() {
    let repository = GitRepository {
        root: PathBuf::from("."),
    };
    assert!(repository
        .validate_write_scope(&[PathBuf::from(".")], &[PathBuf::from("README.md")])
        .is_ok());
}

#[test]
fn scope_rejects_other_file() {
    let repository = GitRepository {
        root: PathBuf::from("."),
    };
    assert!(repository
        .validate_write_scope(&[PathBuf::from("src")], &[PathBuf::from("README.md")])
        .is_err());
}

#[test]
fn terminal_cleanup_removes_every_worktree_for_run() {
    let directory = tempfile::tempdir().unwrap();
    let root = directory.path();
    for args in [
        ["init", "--quiet"].as_slice(),
        ["config", "user.email", "crew@example.invalid"].as_slice(),
        ["config", "user.name", "Agents Crew Test"].as_slice(),
    ] {
        assert!(Command::new("git")
            .args(args)
            .current_dir(root)
            .status()
            .unwrap()
            .success());
    }
    fs::write(root.join("README.md"), "test").unwrap();
    assert!(Command::new("git")
        .args(["add", "README.md"])
        .current_dir(root)
        .status()
        .unwrap()
        .success());
    assert!(Command::new("git")
        .args(["commit", "--quiet", "-m", "initial"])
        .current_dir(root)
        .status()
        .unwrap()
        .success());

    let repository = GitRepository::discover(root).unwrap();
    let first = repository.create_task_worktree("run-one", "task-a").unwrap();
    let second = repository.create_task_worktree("run-one", "task-b").unwrap();
    assert!(first.exists());
    assert!(second.exists());

    repository.cleanup_run_worktrees("run-one").unwrap();

    assert!(!root.join(".agents-crew/worktrees/run-one").exists());
    let worktree_list = Command::new("git")
        .args(["worktree", "list", "--porcelain"])
        .current_dir(root)
        .output()
        .unwrap();
    let output = String::from_utf8_lossy(&worktree_list.stdout);
    assert!(!output.contains("task-a"));
    assert!(!output.contains("task-b"));
}
