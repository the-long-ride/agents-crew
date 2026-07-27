use agents_crew_config::WorkerConfig;
use agents_crew_core::WorkerResult;
use agents_crew_workers::{
    Worker, WorkerDescriptor, WorkerError, WorkerProbe, WorkerRequest, WorkerTransport,
};
use async_trait::async_trait;
use std::{collections::BTreeMap, process::Stdio, time::Duration};
use tokio::{fs, process::Command, time::timeout};

pub struct CliWorker {
    descriptor: WorkerDescriptor,
    executable: String,
    args: Vec<String>,
    env_allowlist: Vec<String>,
    timeout_seconds: u64,
}

impl CliWorker {
    pub fn from_config(c: &WorkerConfig, default_timeout: u64) -> Result<Self, WorkerError> {
        let adapter = c.adapter.as_deref().unwrap_or("custom");
        let executable = c
            .command
            .clone()
            .unwrap_or_else(|| default_executable(adapter).to_string());
        let args = if c.args.is_empty() {
            default_args(adapter)
        } else {
            c.args.clone()
        };
        Ok(Self {
            descriptor: WorkerDescriptor {
                id: c.id.clone(),
                transport: WorkerTransport::Cli,
                roles: c.roles.clone(),
                capabilities: c.capabilities.clone(),
                priority: c.priority,
                enabled: c.enabled,
                supports_model_selection: true,
                configured_model: c.model.clone(),
                requires_network: c.requires_network.unwrap_or(true),
                requires_credentials: c.requires_credentials.unwrap_or(true),
            },
            executable,
            args,
            env_allowlist: c.env_allowlist.clone(),
            timeout_seconds: c.timeout_seconds.unwrap_or(default_timeout),
        })
    }

    fn interpolate(&self, request: &WorkerRequest) -> Result<Vec<String>, WorkerError> {
        let context = std::fs::read_to_string(&request.context_path)
            .map_err(|error| WorkerError::Execution(error.to_string()))?;
        let prompt = format!(
            "{}\n\nTASK:\n{}\n\nCONTEXT:\n{}\n\nWrite a WorkerResult JSON object for task {} to {}. Stay inside capabilities {:?} and write scope {:?}. Include criterion-linked evidence.",
            request.role_prompt,
            request.task.instructions,
            context,
            request.task.id,
            request.output_path.display(),
            request.task.capabilities,
            request.task.write_scope
        );
        let model = request
            .model
            .as_deref()
            .or(self.descriptor.configured_model.as_deref());
        let mut output: Vec<String> = Vec::new();
        for argument in &self.args {
            if argument == "{model}" && model.is_none() {
                if output
                    .last()
                    .is_some_and(|value| value == "--model" || value == "-m")
                {
                    output.pop();
                }
                continue;
            }
            let value = argument
                .replace("{model}", model.unwrap_or(""))
                .replace("{prompt}", &prompt)
                .replace("{workspace}", request.workspace.to_string_lossy().as_ref())
                .replace("{output}", request.output_path.to_string_lossy().as_ref());
            if !value.is_empty() {
                output.push(value);
            }
        }
        Ok(output)
    }

    async fn collect(
        &self,
        request: &WorkerRequest,
        stdout: &[u8],
    ) -> Result<WorkerResult, WorkerError> {
        let raw = if request.output_path.exists() {
            fs::read_to_string(&request.output_path)
                .await
                .map_err(|error| WorkerError::InvalidResult(error.to_string()))?
        } else {
            let text = String::from_utf8_lossy(stdout);
            extract_json(&text).ok_or_else(|| {
                WorkerError::InvalidResult("worker produced no result file or JSON object".into())
            })?
        };
        let result: WorkerResult = serde_json::from_str(raw.trim())
            .map_err(|error| WorkerError::InvalidResult(error.to_string()))?;
        if result.task_id != request.task.id {
            return Err(WorkerError::InvalidResult("task_id mismatch".into()));
        }
        Ok(result)
    }
}

#[async_trait]
impl Worker for CliWorker {
    fn descriptor(&self) -> &WorkerDescriptor {
        &self.descriptor
    }

    async fn probe(&self) -> Result<WorkerProbe, WorkerError> {
        let result = Command::new(&self.executable)
            .arg("--version")
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .output()
            .await;
        match result {
            Ok(output) => Ok(WorkerProbe {
                available: output.status.success(),
                version: Some(String::from_utf8_lossy(&output.stdout).trim().to_string()),
                capabilities: self.descriptor.capabilities.clone(),
                message: if output.status.success() {
                    "available".into()
                } else {
                    String::from_utf8_lossy(&output.stderr).trim().into()
                },
            }),
            Err(error) => Ok(WorkerProbe {
                available: false,
                version: None,
                capabilities: self.descriptor.capabilities.clone(),
                message: error.to_string(),
            }),
        }
    }

    async fn execute(&self, request: WorkerRequest) -> Result<WorkerResult, WorkerError> {
        if let Some(parent) = request.output_path.parent() {
            fs::create_dir_all(parent)
                .await
                .map_err(|error| WorkerError::Execution(error.to_string()))?;
        }
        let mut command = Command::new(&self.executable);
        command
            .args(self.interpolate(&request)?)
            .current_dir(&request.workspace)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        command.env_clear();
        for (key, value) in safe_environment() {
            command.env(key, value);
        }
        for key in &self.env_allowlist {
            if let Ok(value) = std::env::var(key) {
                command.env(key, value);
            }
        }
        let output = timeout(
            Duration::from_secs(request.timeout_seconds.min(self.timeout_seconds)),
            command.output(),
        )
        .await
        .map_err(|_| WorkerError::Execution("worker timed out".into()))?
        .map_err(|error| WorkerError::Execution(error.to_string()))?;
        if !output.status.success() {
            return Err(WorkerError::Execution(redact(
                &String::from_utf8_lossy(&output.stderr),
                &self.env_allowlist,
            )));
        }
        self.collect(&request, &output.stdout).await
    }
}

fn default_executable(adapter: &str) -> &str {
    match adapter {
        "codex" => "codex",
        "claude-code" | "claude" => "claude",
        "opencode" => "opencode",
        "antigravity" => "antigravity",
        _ => adapter,
    }
}

fn default_args(adapter: &str) -> Vec<String> {
    match adapter {
        "codex" => vec![
            "exec".into(),
            "--model".into(),
            "{model}".into(),
            "--sandbox".into(),
            "workspace-write".into(),
            "-C".into(),
            "{workspace}".into(),
            "{prompt}".into(),
        ],
        "claude-code" | "claude" => vec![
            "-p".into(),
            "--output-format".into(),
            "json".into(),
            "--model".into(),
            "{model}".into(),
            "{prompt}".into(),
        ],
        "opencode" | "antigravity" => vec![
            "run".into(),
            "--model".into(),
            "{model}".into(),
            "{prompt}".into(),
        ],
        _ => vec!["{prompt}".into()],
    }
}

fn safe_environment() -> BTreeMap<String, String> {
    [
        "PATH",
        "HOME",
        "USER",
        "LOGNAME",
        "TMPDIR",
        "TEMP",
        "TMP",
        "SystemRoot",
        "COMSPEC",
    ]
    .into_iter()
    .filter_map(|key| {
        std::env::var(key)
            .ok()
            .map(|value| (key.to_string(), value))
    })
    .collect()
}

fn redact(text: &str, keys: &[String]) -> String {
    keys.iter()
        .filter_map(|key| std::env::var(key).ok())
        .filter(|value| !value.is_empty())
        .fold(text.to_string(), |output, value| {
            output.replace(&value, "[REDACTED]")
        })
}

fn extract_json(text: &str) -> Option<String> {
    let trimmed = text.trim();
    if trimmed.starts_with('{') && trimmed.ends_with('}') {
        return Some(trimmed.to_string());
    }
    let start = trimmed.rfind('\n').map_or(0, |index| index + 1);
    let last = trimmed[start..].trim();
    (last.starts_with('{') && last.ends_with('}')).then(|| last.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn placeholders_expand() {
        let cfg = agents_crew_config::CrewConfig::starter();
        assert_eq!(default_executable("codex"), "codex");
        assert!(default_args("opencode").contains(&"{prompt}".to_string()));
        assert!(!cfg.workers.is_empty());
    }
}
