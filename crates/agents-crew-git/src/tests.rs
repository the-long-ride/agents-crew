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
