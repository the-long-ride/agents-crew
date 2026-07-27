use crate::{CrewConfig, WorkerKind};
use agents_crew_core::Capability;
use std::collections::BTreeSet;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum ConfigError {
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
    #[error("toml decode: {0}")]
    Decode(#[from] toml::de::Error),
    #[error("toml encode: {0}")]
    Encode(#[from] toml::ser::Error),
    #[error("invalid config: {0}")]
    Invalid(String),
}

pub fn validate(config: &CrewConfig) -> Result<(), ConfigError> {
    if config.version != 1 {
        return Err(ConfigError::Invalid("version must be 1".into()));
    }

    let run = &config.run;
    if run.max_iterations == 0
        || run.max_parallel_readers == 0
        || run.max_parallel_writers == 0
        || run.max_tasks_per_iteration == 0
        || run.default_task_timeout_seconds == 0
    {
        return Err(ConfigError::Invalid(
            "run limits and timeouts must be nonzero".into(),
        ));
    }

    let mut ids = BTreeSet::new();
    for worker in &config.workers {
        if !ids.insert(&worker.id) {
            return Err(ConfigError::Invalid(format!(
                "duplicate worker id {}",
                worker.id
            )));
        }
        if worker.enabled && worker.roles.is_empty() {
            return Err(ConfigError::Invalid(format!(
                "worker {} has no roles",
                worker.id
            )));
        }
        if worker.kind == WorkerKind::Api && worker.capabilities.contains(&Capability::Write) {
            return Err(ConfigError::Invalid(format!(
                "api worker {} cannot write",
                worker.id
            )));
        }
        if let Some(environment) = &worker.api_key_env {
            let valid = environment
                .chars()
                .all(|character| character == '_' || character.is_ascii_uppercase() || character.is_ascii_digit());
            if !valid {
                return Err(ConfigError::Invalid(format!(
                    "invalid api key env {environment}"
                )));
            }
        }
        if worker.kind == WorkerKind::Cli && worker.adapter.is_none() && worker.command.is_none() {
            return Err(ConfigError::Invalid(format!(
                "cli worker {} needs adapter or command",
                worker.id
            )));
        }
        if worker.kind == WorkerKind::Api
            && (worker.provider.is_none()
                || worker.model.is_none()
                || worker.api_key_env.is_none())
        {
            return Err(ConfigError::Invalid(format!(
                "api worker {} needs provider, model, api_key_env",
                worker.id
            )));
        }
        if worker.timeout_seconds == Some(0) {
            return Err(ConfigError::Invalid(format!(
                "worker {} timeout must be nonzero",
                worker.id
            )));
        }
    }

    if !config.workers.iter().any(|worker| worker.enabled) {
        return Err(ConfigError::Invalid(
            "at least one worker must be enabled".into(),
        ));
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn starter_valid() {
        validate(&crate::CrewConfig::starter()).unwrap();
    }

    #[test]
    fn api_write_rejected() {
        let mut config = crate::CrewConfig::starter();
        let mut worker = config.workers[0].clone();
        worker.id = "api".into();
        worker.kind = WorkerKind::Api;
        worker.provider = Some("openai-compatible".into());
        worker.model = Some("m".into());
        worker.api_key_env = Some("KEY".into());
        worker.capabilities.insert(Capability::Write);
        config.workers.push(worker);

        assert!(validate(&config).is_err());
    }
}
