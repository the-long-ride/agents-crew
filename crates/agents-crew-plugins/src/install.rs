use super::*;

impl HostPlugin {
    #[must_use]
    pub const fn new(host: Host) -> Self {
        Self { host }
    }

    #[must_use]
    pub fn plan_files(&self, workspace: &Path) -> Vec<(PathBuf, String)> {
        let mut files = COMMANDS
            .iter()
            .map(|(name, description)| {
                (
                    command_path(workspace, self.host, name),
                    command_content(self.host, name, description),
                )
            })
            .collect::<Vec<_>>();
        files.push((
            manager_path(workspace, self.host),
            manager_content(self.host),
        ));
        for role_kind in [
            Role::Planner,
            Role::Researcher,
            Role::Implementer,
            Role::Tester,
            Role::Reviewer,
            Role::Integrator,
        ] {
            files.push((
                role_agent_path(workspace, self.host, role_kind),
                role_agent_content(self.host, role_kind),
            ));
        }
        if self.host == Host::Antigravity {
            files.push((
                workspace.join(".agents/plugins/agents-crew/plugin.json"),
                "{\n  \"name\": \"agents-crew\",\n  \"version\": 1,\n  \"description\": \"Rust-enforced multi-agent loop manager\"\n}\n"
                    .to_string(),
            ));
        }
        files
    }

    pub fn install(&self, workspace: &Path, force: bool) -> Result<PluginReport, PluginError> {
        let manifest_path = manifest_path(workspace, self.host);
        let old_manifest = load_manifest(&manifest_path).ok();
        let mut report = Vec::new();
        let mut generated = Vec::new();

        for (path, content) in self.plan_files(workspace) {
            if path.exists() && !force {
                let relative_path = relative(workspace, &path);
                let owned = old_manifest.as_ref().is_some_and(|manifest| {
                    manifest.files.iter().any(|entry| {
                        entry.path == relative_path
                            && hash_file(&path).ok().as_ref() == Some(&entry.sha256)
                    })
                });
                if !owned {
                    return Err(PluginError::Unowned(path));
                }
            }
            if let Some(parent) = path.parent() {
                fs::create_dir_all(parent)?;
            }
            fs::write(&path, content.as_bytes())?;
            let relative_path = relative(workspace, &path);
            generated.push(GeneratedFile {
                path: relative_path.clone(),
                sha256: hash_bytes(content.as_bytes()),
            });
            report.push(FileReport {
                path: relative_path,
                action: "write".to_string(),
                message: "generated".to_string(),
            });
        }

        let manifest = PluginManifest {
            version: 1,
            host: self.host,
            generated_by: "agents-crew".to_string(),
            files: generated,
        };
        if let Some(parent) = manifest_path.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::write(&manifest_path, serde_json::to_vec_pretty(&manifest)?)?;
        Ok(PluginReport {
            host: self.host,
            files: report,
        })
    }

    pub fn doctor(&self, workspace: &Path) -> Result<PluginReport, PluginError> {
        let manifest = load_manifest(&manifest_path(workspace, self.host))?;
        let mut files = Vec::new();
        for entry in manifest.files {
            let path = workspace.join(&entry.path);
            let (action, message) = if !path.exists() {
                ("missing", "generated file is missing")
            } else if hash_file(&path)? == entry.sha256 {
                ("pass", "generated file matches manifest")
            } else {
                ("modified", "generated file was modified")
            };
            files.push(FileReport {
                path: entry.path,
                action: action.to_string(),
                message: message.to_string(),
            });
        }
        Ok(PluginReport {
            host: self.host,
            files,
        })
    }

    pub fn uninstall(&self, workspace: &Path) -> Result<PluginReport, PluginError> {
        let manifest_path = manifest_path(workspace, self.host);
        let manifest = load_manifest(&manifest_path)?;
        let mut files = Vec::new();
        for entry in manifest.files {
            let path = workspace.join(&entry.path);
            if !path.exists() {
                files.push(FileReport {
                    path: entry.path,
                    action: "missing".to_string(),
                    message: "already absent".to_string(),
                });
                continue;
            }
            if hash_file(&path)? == entry.sha256 {
                fs::remove_file(&path)?;
                files.push(FileReport {
                    path: entry.path,
                    action: "remove".to_string(),
                    message: "removed unchanged generated file".to_string(),
                });
            } else {
                files.push(FileReport {
                    path: entry.path,
                    action: "preserve".to_string(),
                    message: "preserved user-modified generated file".to_string(),
                });
            }
        }
        if manifest_path.exists() {
            fs::remove_file(manifest_path)?;
        }
        Ok(PluginReport {
            host: self.host,
            files,
        })
    }
}
