use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, BTreeSet},
    fs::{self, OpenOptions},
    io::Write,
    path::{Component, Path, PathBuf},
    process::Command,
};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum GitError {
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
    #[error("git command failed: {0}")]
    Command(String),
    #[error("path escapes repository: {0}")]
    PathEscape(PathBuf),
    #[error("write outside scope: {0:?}")]
    WriteScope(Vec<PathBuf>),
    #[error("repository write lock already held")]
    Locked,
    #[error("json: {0}")]
    Json(#[from] serde_json::Error),
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct RepositorySnapshot {
    pub head: String,
    pub status_porcelain: String,
    pub diff_hash: String,
    pub changed_files: Vec<PathBuf>,
    pub file_hashes: BTreeMap<PathBuf, String>,
}

#[derive(Debug, Clone)]
pub struct GitRepository {
    root: PathBuf,
}

mod lock;
mod path;
mod repository;

pub use lock::RepositoryWriteLock;
pub use path::canonical_scoped_path;
use path::*;

#[cfg(test)]
mod tests;
