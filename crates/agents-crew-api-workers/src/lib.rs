use agents_crew_config::WorkerConfig;
use agents_crew_core::{Capability, WorkerResult};
use agents_crew_workers::{
    Worker, WorkerDescriptor, WorkerError, WorkerProbe, WorkerRequest, WorkerTransport,
};
use async_trait::async_trait;
use reqwest::{
    header::{HeaderMap, HeaderName, HeaderValue, AUTHORIZATION, CONTENT_TYPE},
    Client,
};
use serde_json::{json, Value};
use std::{fs, time::Duration};

#[derive(Debug, Clone, Copy)]
enum Provider {
    OpenAiCompatible,
    Anthropic,
}

pub struct ApiWorker {
    descriptor: WorkerDescriptor,
    provider: Provider,
    base_url: String,
    api_key_env: String,
    headers: std::collections::BTreeMap<String, String>,
    client: Client,
}

impl ApiWorker {
    pub fn from_config(c: &WorkerConfig) -> Result<Self, WorkerError> {
        if c.capabilities.contains(&Capability::Write) {
            return Err(WorkerError::Unavailable("API workers are read-only".into()));
        }
        let provider = match c.provider.as_deref() {
            Some("openai-compatible") => Provider::OpenAiCompatible,
            Some("anthropic") => Provider::Anthropic,
            Some(other) => {
                return Err(WorkerError::Unavailable(format!(
                    "unsupported API provider {other}"
                )))
            }
            None => return Err(WorkerError::Unavailable("missing API provider".into())),
        };
        let base_url = c.api_base_url.clone().unwrap_or_else(|| match provider {
            Provider::OpenAiCompatible => "https://api.openai.com/v1".into(),
            Provider::Anthropic => "https://api.anthropic.com/v1".into(),
        });
        let timeout_seconds = c.timeout_seconds.unwrap_or(120);
        let client = Client::builder()
            .timeout(Duration::from_secs(timeout_seconds))
            .build()
            .map_err(|error| WorkerError::Unavailable(error.to_string()))?;
        Ok(Self {
            descriptor: WorkerDescriptor {
                id: c.id.clone(),
                transport: WorkerTransport::Api,
                roles: c.roles.clone(),
                capabilities: c.capabilities.clone(),
                priority: c.priority,
                enabled: c.enabled,
                supports_model_selection: true,
                configured_model: c.model.clone(),
                requires_network: true,
                requires_credentials: true,
            },
            provider,
            base_url: base_url.trim_end_matches('/').into(),
            api_key_env: c
                .api_key_env
                .clone()
                .ok_or_else(|| WorkerError::Unavailable("missing api_key_env".into()))?,
            headers: c.headers.clone(),
            client,
        })
    }

    fn headers(&self, key: &str) -> Result<HeaderMap, WorkerError> {
        let mut headers = HeaderMap::new();
        headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
        for (name, value) in &self.headers {
            headers.insert(
                HeaderName::from_bytes(name.as_bytes())
                    .map_err(|error| WorkerError::Execution(error.to_string()))?,
                HeaderValue::from_str(value)
                    .map_err(|error| WorkerError::Execution(error.to_string()))?,
            );
        }
        match self.provider {
            Provider::OpenAiCompatible => {
                headers.insert(
                    AUTHORIZATION,
                    HeaderValue::from_str(&format!("Bearer {key}"))
                        .map_err(|error| WorkerError::Execution(error.to_string()))?,
                );
            }
            Provider::Anthropic => {
                headers.insert(
                    "x-api-key",
                    HeaderValue::from_str(key)
                        .map_err(|error| WorkerError::Execution(error.to_string()))?,
                );
                headers.insert("anthropic-version", HeaderValue::from_static("2023-06-01"));
            }
        }
        Ok(headers)
    }

    fn prompt(request: &WorkerRequest) -> Result<String, WorkerError> {
        let context = fs::read_to_string(&request.context_path)
            .map_err(|error| WorkerError::Execution(error.to_string()))?;
        Ok(format!(
            "{}\n\nTask ID: {}\nRole: {:?}\nInstructions: {}\n\nRepository context:\n{}\n\nReturn only a JSON WorkerResult. API workers are read-only and must not claim local edits. Include criterion-linked evidence.",
            request.role_prompt,
            request.task.id,
            request.task.role,
            request.task.instructions,
            context
        ))
    }

    async fn call(&self, request: &WorkerRequest) -> Result<Value, WorkerError> {
        let key = std::env::var(&self.api_key_env).map_err(|_| {
            WorkerError::Unavailable(format!("missing environment variable {}", self.api_key_env))
        })?;
        let model = request
            .model
            .as_ref()
            .or(self.descriptor.configured_model.as_ref())
            .ok_or_else(|| WorkerError::Unavailable("missing model".into()))?;
        let prompt = Self::prompt(request)?;
        let (url, body) = match self.provider {
            Provider::OpenAiCompatible => (
                format!("{}/chat/completions", self.base_url),
                json!({
                    "model": model,
                    "messages": [{"role": "user", "content": prompt}],
                    "temperature": 0,
                    "response_format": {"type": "json_object"}
                }),
            ),
            Provider::Anthropic => (
                format!("{}/messages", self.base_url),
                json!({
                    "model": model,
                    "max_tokens": 4096,
                    "temperature": 0,
                    "messages": [{"role": "user", "content": prompt}]
                }),
            ),
        };
        let response = self
            .client
            .post(url)
            .headers(self.headers(&key)?)
            .json(&body)
            .send()
            .await
            .map_err(|error| WorkerError::Execution(redact(&error.to_string(), &key)))?;
        let status = response.status();
        let text = response
            .text()
            .await
            .map_err(|error| WorkerError::Execution(redact(&error.to_string(), &key)))?;
        if !status.is_success() {
            return Err(WorkerError::Execution(redact(
                &format!("HTTP {status}: {text}"),
                &key,
            )));
        }
        serde_json::from_str(&text).map_err(|error| WorkerError::InvalidResult(error.to_string()))
    }

    fn extract(&self, value: &Value) -> Result<String, WorkerError> {
        match self.provider {
            Provider::OpenAiCompatible => value
                .pointer("/choices/0/message/content")
                .and_then(Value::as_str)
                .map(str::to_owned),
            Provider::Anthropic => value
                .get("content")
                .and_then(Value::as_array)
                .and_then(|blocks| {
                    blocks
                        .iter()
                        .find_map(|block| block.get("text").and_then(Value::as_str))
                })
                .map(str::to_owned),
        }
        .ok_or_else(|| WorkerError::InvalidResult("provider response has no text content".into()))
    }
}

#[async_trait]
impl Worker for ApiWorker {
    fn descriptor(&self) -> &WorkerDescriptor {
        &self.descriptor
    }

    async fn probe(&self) -> Result<WorkerProbe, WorkerError> {
        let available = std::env::var_os(&self.api_key_env).is_some();
        Ok(WorkerProbe {
            available,
            version: None,
            capabilities: self.descriptor.capabilities.clone(),
            message: format!(
                "credential env {} {}",
                self.api_key_env,
                if available { "present" } else { "missing" }
            ),
        })
    }

    async fn execute(&self, request: WorkerRequest) -> Result<WorkerResult, WorkerError> {
        if request.task.writes() {
            return Err(WorkerError::Unavailable(
                "API workers cannot execute write tasks".into(),
            ));
        }
        let value = self.call(&request).await?;
        let raw = strip_fence(&self.extract(&value)?);
        let result: WorkerResult = serde_json::from_str(&raw)
            .map_err(|error| WorkerError::InvalidResult(error.to_string()))?;
        if result.task_id != request.task.id {
            return Err(WorkerError::InvalidResult("task_id mismatch".into()));
        }
        if !result.files_changed.is_empty() {
            return Err(WorkerError::InvalidResult(
                "API worker claimed local file changes".into(),
            ));
        }
        Ok(result)
    }
}

fn strip_fence(value: &str) -> String {
    let trimmed = value.trim();
    if trimmed.starts_with("```json") && trimmed.ends_with("```") {
        trimmed
            .trim_start_matches("```json")
            .trim_end_matches("```")
            .trim()
            .into()
    } else if trimmed.starts_with("```") && trimmed.ends_with("```") {
        trimmed
            .trim_start_matches("```")
            .trim_end_matches("```")
            .trim()
            .into()
    } else {
        trimmed.into()
    }
}

fn redact(text: &str, key: &str) -> String {
    if key.is_empty() {
        text.into()
    } else {
        text.replace(key, "[REDACTED]")
    }
}
