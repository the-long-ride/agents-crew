mod model;
mod validate;

pub use model::*;
pub use validate::{validate, ConfigError};

use std::{fs, path::Path};

impl CrewConfig {
    pub fn load(path: &Path) -> Result<Self, ConfigError> {
        let raw = fs::read_to_string(path)?;
        let config = toml::from_str(&raw)?;
        validate(&config)?;
        Ok(config)
    }

    pub fn save(&self, path: &Path) -> Result<(), ConfigError> {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::write(path, toml::to_string_pretty(self)?)?;
        Ok(())
    }

    #[must_use]
    pub fn starter() -> Self {
        model::starter()
    }
}
