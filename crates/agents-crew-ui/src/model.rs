use agents_crew_config::CrewConfig;
use agents_crew_templates::TemplateScope;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{collections::BTreeMap, io, net::SocketAddr};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum UiError {
    #[error("io: {0}")]
    Io(#[from] io::Error),
    #[error("json: {0}")]
    Json(#[from] serde_json::Error),
    #[error("template: {0}")]
    Template(#[from] agents_crew_templates::TemplateError),
    #[error("state: {0}")]
    State(#[from] agents_crew_state::StateError),
    #[error("protocol: {0}")]
    Protocol(#[from] agents_crew_protocol::ProtocolError),
    #[error("bad request: {0}")]
    BadRequest(String),
}

#[derive(Debug, Clone, Copy)]
pub struct UiOptions {
    pub port: u16,
    pub open_browser: bool,
}

impl Default for UiOptions {
    fn default() -> Self {
        Self {
            port: 0,
            open_browser: true,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UiAddress {
    pub socket: SocketAddr,
    pub url: String,
}

#[derive(Debug, Clone)]
pub struct HttpRequest {
    pub method: String,
    pub path: String,
    pub body: Vec<u8>,
}

#[derive(Debug, Clone)]
pub struct HttpResponse {
    pub status: u16,
    pub content_type: &'static str,
    pub body: Vec<u8>,
    pub headers: BTreeMap<String, String>,
}

impl HttpResponse {
    pub(crate) fn json(status: u16, value: Value) -> Result<Self, UiError> {
        Ok(Self {
            status,
            content_type: "application/json; charset=utf-8",
            body: serde_json::to_vec(&value)?,
            headers: BTreeMap::new(),
        })
    }

    pub(crate) fn text(status: u16, content_type: &'static str, value: &str) -> Self {
        Self {
            status,
            content_type,
            body: value.as_bytes().to_vec(),
            headers: BTreeMap::new(),
        }
    }
}

#[derive(Debug, Deserialize)]
pub(crate) struct SaveTemplateRequest {
    pub scope: TemplateScope,
    pub config: CrewConfig,
}

#[derive(Debug, Serialize)]
pub(crate) struct RunSummary {
    pub id: String,
    pub goal: String,
    pub status: agents_crew_core::RunStatus,
    pub manager: String,
    pub updated_at: chrono::DateTime<chrono::Utc>,
    pub archived: bool,
    pub completed_tasks: usize,
    pub total_tasks: usize,
}
