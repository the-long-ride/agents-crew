use agents_crew_config::{validate, CrewConfig, TemplateMetadata};
use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeMap,
    env,
    fs,
    io::Write,
    path::{Path, PathBuf},
};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum TemplateError {
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
    #[error("toml decode: {0}")]
    Decode(#[from] toml::de::Error),
    #[error("toml encode: {0}")]
    Encode(#[from] toml::ser::Error),
    #[error("config: {0}")]
    Config(#[from] agents_crew_config::ConfigError),
    #[error("invalid template id: {0}")]
    InvalidId(String),
    #[error("template metadata is required")]
    MissingMetadata,
    #[error("template not found: {0}")]
    NotFound(String),
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TemplateScope {
    Builtin,
    Global,
    Workspace,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TemplateRecord {
    pub id: String,
    pub name: String,
    pub description: String,
    pub scope: TemplateScope,
    pub path: Option<PathBuf>,
    pub config: CrewConfig,
}

#[derive(Debug, Clone)]
pub struct TemplateRegistry {
    workspace_root: PathBuf,
    global_root: PathBuf,
}

impl TemplateRegistry {
    #[must_use]
    pub fn new(workspace: &Path) -> Self {
        Self::with_global_root(workspace, default_global_root())
    }

    #[must_use]
    pub fn with_global_root(workspace: &Path, global_root: PathBuf) -> Self {
        Self {
            workspace_root: workspace.join(".agents-crew/templates"),
            global_root,
        }
    }

    #[must_use]
    pub fn workspace_root(&self) -> &Path {
        &self.workspace_root
    }

    #[must_use]
    pub fn global_root(&self) -> &Path {
        &self.global_root
    }

    pub fn list(&self) -> Result<Vec<TemplateRecord>, TemplateError> {
        let mut records = BTreeMap::new();
        let builtin = builtin_template();
        records.insert(builtin.id.clone(), builtin);
        for record in self.read_scope(TemplateScope::Global, &self.global_root)? {
            records.insert(record.id.clone(), record);
        }
        for record in self.read_scope(TemplateScope::Workspace, &self.workspace_root)? {
            records.insert(record.id.clone(), record);
        }
        Ok(records.into_values().collect())
    }

    pub fn resolve(&self, id: &str) -> Result<TemplateRecord, TemplateError> {
        validate_template_id(id)?;
        for (scope, root) in [
            (TemplateScope::Workspace, &self.workspace_root),
            (TemplateScope::Global, &self.global_root),
        ] {
            let path = root.join(format!("{id}.toml"));
            if path.exists() {
                return load_record(scope, &path);
            }
        }
        let builtin = builtin_template();
        if builtin.id == id {
            return Ok(builtin);
        }
        Err(TemplateError::NotFound(id.to_string()))
    }

    pub fn save(
        &self,
        scope: TemplateScope,
        config: &CrewConfig,
    ) -> Result<TemplateRecord, TemplateError> {
        let metadata = config.template.as_ref().ok_or(TemplateError::MissingMetadata)?;
        validate_template_id(&metadata.id)?;
        validate(config)?;
        let root = match scope {
            TemplateScope::Global => &self.global_root,
            TemplateScope::Workspace => &self.workspace_root,
            TemplateScope::Builtin => {
                return Err(TemplateError::InvalidId(
                    "built-in templates are read-only".to_string(),
                ));
            }
        };
        fs::create_dir_all(root)?;
        let path = root.join(format!("{}.toml", metadata.id));
        atomic_write(&path, toml::to_string_pretty(config)?.as_bytes())?;
        load_record(scope, &path)
    }

    pub fn delete(&self, scope: TemplateScope, id: &str) -> Result<(), TemplateError> {
        validate_template_id(id)?;
        let root = match scope {
            TemplateScope::Global => &self.global_root,
            TemplateScope::Workspace => &self.workspace_root,
            TemplateScope::Builtin => {
                return Err(TemplateError::InvalidId(
                    "built-in templates are read-only".to_string(),
                ));
            }
        };
        let path = root.join(format!("{id}.toml"));
        if !path.exists() {
            return Err(TemplateError::NotFound(id.to_string()));
        }
        fs::remove_file(path)?;
        Ok(())
    }

    fn read_scope(
        &self,
        scope: TemplateScope,
        root: &Path,
    ) -> Result<Vec<TemplateRecord>, TemplateError> {
        if !root.exists() {
            return Ok(Vec::new());
        }
        let mut records = Vec::new();
        for entry in fs::read_dir(root)? {
            let entry = entry?;
            let path = entry.path();
            if path.extension().and_then(|value| value.to_str()) == Some("toml") {
                records.push(load_record(scope, &path)?);
            }
        }
        records.sort_by(|left, right| left.id.cmp(&right.id));
        Ok(records)
    }
}

pub fn validate_template_id(id: &str) -> Result<(), TemplateError> {
    let valid = !id.is_empty()
        && id.len() <= 64
        && id
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
        && id.as_bytes().first().is_some_and(u8::is_ascii_alphanumeric)
        && id.as_bytes().last().is_some_and(u8::is_ascii_alphanumeric);
    if valid {
        Ok(())
    } else {
        Err(TemplateError::InvalidId(id.to_string()))
    }
}

#[must_use]
pub fn default_global_root() -> PathBuf {
    if let Some(root) = env::var_os("AGENTS_CREW_HOME") {
        return PathBuf::from(root).join("templates");
    }
    let home = env::var_os("HOME")
        .or_else(|| env::var_os("USERPROFILE"))
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."));
    home.join(".agents-crew/templates")
}

fn builtin_template() -> TemplateRecord {
    let mut config = CrewConfig::starter();
    config.template = Some(TemplateMetadata {
        id: "default".to_string(),
        name: "Default crew".to_string(),
        description: "Manager-native starter crew".to_string(),
        layout: BTreeMap::new(),
    });
    record_from_config(TemplateScope::Builtin, None, config)
        .expect("built-in template metadata is valid")
}

fn load_record(scope: TemplateScope, path: &Path) -> Result<TemplateRecord, TemplateError> {
    let raw = fs::read_to_string(path)?;
    let config: CrewConfig = toml::from_str(&raw)?;
    validate(&config)?;
    record_from_config(scope, Some(path.to_path_buf()), config)
}

fn record_from_config(
    scope: TemplateScope,
    path: Option<PathBuf>,
    config: CrewConfig,
) -> Result<TemplateRecord, TemplateError> {
    let metadata = config.template.as_ref().ok_or(TemplateError::MissingMetadata)?;
    validate_template_id(&metadata.id)?;
    Ok(TemplateRecord {
        id: metadata.id.clone(),
        name: metadata.name.clone(),
        description: metadata.description.clone(),
        scope,
        path,
        config,
    })
}

fn atomic_write(path: &Path, data: &[u8]) -> Result<(), TemplateError> {
    let temporary = path.with_extension("toml.tmp");
    {
        let mut file = fs::File::create(&temporary)?;
        file.write_all(data)?;
        file.sync_all()?;
    }
    #[cfg(windows)]
    if path.exists() {
        fs::remove_file(path)?;
    }
    fs::rename(&temporary, path)?;
    #[cfg(unix)]
    if let Some(parent) = path.parent() {
        fs::File::open(parent)?.sync_all()?;
    }
    Ok(())
}

#[cfg(test)]
mod tests;
