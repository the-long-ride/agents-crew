use super::*;
use tempfile::tempdir;

fn template(id: &str, name: &str) -> CrewConfig {
    let mut config = CrewConfig::starter();
    config.template = Some(TemplateMetadata {
        id: id.to_string(),
        name: name.to_string(),
        description: String::new(),
        layout: std::collections::BTreeMap::new(),
    });
    config
}

#[test]
fn rejects_path_traversal_and_unsafe_ids() {
    for id in ["../crew", "Crew", "crew/name", "-crew", "crew-", ""] {
        assert!(validate_template_id(id).is_err(), "{id} should fail");
    }
    assert!(validate_template_id("fullstack-review-2").is_ok());
}

#[test]
fn workspace_template_overrides_global_template() {
    let workspace = tempdir().unwrap();
    let global = tempdir().unwrap();
    let registry =
        TemplateRegistry::with_global_root(workspace.path(), global.path().join("templates"));
    registry
        .save(TemplateScope::Global, &template("shared", "Global"))
        .unwrap();
    registry
        .save(
            TemplateScope::Workspace,
            &template("shared", "Workspace"),
        )
        .unwrap();
    let resolved = registry.resolve("shared").unwrap();
    assert_eq!(resolved.scope, TemplateScope::Workspace);
    assert_eq!(resolved.name, "Workspace");
}

#[test]
fn default_builtin_is_available_without_files() {
    let workspace = tempdir().unwrap();
    let global = tempdir().unwrap();
    let registry = TemplateRegistry::with_global_root(workspace.path(), global.path().into());
    let resolved = registry.resolve("default").unwrap();
    assert_eq!(resolved.scope, TemplateScope::Builtin);
}

#[test]
fn save_is_atomic_and_round_trips_aliases() {
    let workspace = tempdir().unwrap();
    let global = tempdir().unwrap();
    let registry = TemplateRegistry::with_global_root(workspace.path(), global.path().into());
    let mut config = template("aliased", "Aliased");
    config.manager.alias = Some("Lead".to_string());
    config.workers[0].alias = Some("Builder".to_string());
    registry.save(TemplateScope::Global, &config).unwrap();
    assert!(!global.path().join("aliased.toml.tmp").exists());
    let loaded = registry.resolve("aliased").unwrap();
    assert_eq!(loaded.config.manager.alias.as_deref(), Some("Lead"));
    assert_eq!(
        loaded.config.workers[0].alias.as_deref(),
        Some("Builder")
    );
}
