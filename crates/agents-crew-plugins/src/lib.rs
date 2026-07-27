use agents_crew_core::Role;
use agents_crew_prompts::role;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs,
    path::{Path, PathBuf},
};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum PluginError {
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
    #[error("json: {0}")]
    Json(#[from] serde_json::Error),
    #[error("unknown host: {0}")]
    UnknownHost(String),
    #[error("refusing to overwrite unowned file: {0}")]
    Unowned(PathBuf),
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum Host {
    Codex,
    ClaudeCode,
    Opencode,
    Antigravity,
}

impl Host {
    pub const ALL: [Self; 4] = [
        Self::Codex,
        Self::ClaudeCode,
        Self::Opencode,
        Self::Antigravity,
    ];

    pub fn parse(value: &str) -> Result<Self, PluginError> {
        match value {
            "codex" => Ok(Self::Codex),
            "claude-code" | "claude" => Ok(Self::ClaudeCode),
            "opencode" => Ok(Self::Opencode),
            "antigravity" => Ok(Self::Antigravity),
            _ => Err(PluginError::UnknownHost(value.to_string())),
        }
    }

    #[must_use]
    pub const fn name(self) -> &'static str {
        match self {
            Self::Codex => "codex",
            Self::ClaudeCode => "claude-code",
            Self::Opencode => "opencode",
            Self::Antigravity => "antigravity",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GeneratedFile {
    pub path: PathBuf,
    pub sha256: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginManifest {
    pub version: u32,
    pub host: Host,
    pub generated_by: String,
    pub files: Vec<GeneratedFile>,
}

#[derive(Debug, Clone, Serialize)]
pub struct FileReport {
    pub path: PathBuf,
    pub action: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct PluginReport {
    pub host: Host,
    pub files: Vec<FileReport>,
}

pub(super) const COMMANDS: [(&str, &str); 11] = [
    ("crew-init", "Create Agents Crew configuration and role files."),
    ("crew-run", "Run one goal through the complete managed crew loop."),
    ("crew-plan", "Create a bounded plan without implementation writes."),
    ("crew-status", "Show run, task, approval, and pending-action state."),
    ("crew-resume", "Resume a paused or interrupted run."),
    ("crew-pause", "Pause scheduling new tasks."),
    ("crew-approve", "Approve one pending guarded action."),
    ("crew-reject", "Reject one pending guarded action."),
    ("crew-cancel", "Cancel the selected run."),
    ("crew-doctor", "Probe config, workers, credentials, plugins, and Git."),
    ("crew-config", "Show and validate configuration."),
];

pub struct HostPlugin {
    host: Host,
}

mod content;
mod install;
mod layout;
mod manifest;

use content::*;
use layout::*;
use manifest::*;

#[cfg(test)]
mod tests;
