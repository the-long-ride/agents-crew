use agents_crew_core::{Capability, ManagerCoding, ModelFallback, Role, WorkspaceMode};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CrewConfig {
    pub version: u32,
    pub run: RunConfig,
    pub manager: ManagerConfig,
    pub autonomy: AutonomyConfig,
    pub permissions: PermissionsConfig,
    #[serde(default)]
    pub verification: VerificationConfig,
    #[serde(default)]
    pub workers: Vec<WorkerConfig>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RunConfig {
    pub workspace_mode: WorkspaceMode,
    pub max_iterations: u32,
    pub max_parallel_readers: usize,
    pub max_parallel_writers: usize,
    pub max_tasks_per_iteration: usize,
    pub default_task_timeout_seconds: u64,
    #[serde(default)]
    pub retain_failed_worktrees: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ManagerConfig {
    pub host: String,
    pub coding: ManagerCoding,
    pub small_fix_max_files: usize,
    pub small_fix_max_changed_lines: usize,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AutonomyMode {
    Safe,
    Balanced,
    FullAuto,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AutonomyConfig {
    pub mode: AutonomyMode,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PermissionRule {
    Allow,
    Ask,
    Deny,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PermissionsConfig {
    pub local_read: PermissionRule,
    pub local_edit: PermissionRule,
    pub test_commands: PermissionRule,
    pub network: PermissionRule,
    pub destructive_commands: PermissionRule,
    pub credentialed_actions: PermissionRule,
    pub commit: PermissionRule,
    pub push: PermissionRule,
    pub deploy: PermissionRule,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct VerificationConfig {
    #[serde(default)]
    pub commands: Vec<Vec<String>>,
    #[serde(default)]
    pub require_independent_review: bool,
    #[serde(default)]
    pub allow_same_agent_review: bool,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum WorkerKind {
    Native,
    Cli,
    Api,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkerConfig {
    pub id: String,
    pub kind: WorkerKind,
    #[serde(default = "yes")]
    pub enabled: bool,
    pub adapter: Option<String>,
    pub provider: Option<String>,
    pub host: Option<String>,
    pub model: Option<String>,
    #[serde(default)]
    pub model_fallback: Option<ModelFallback>,
    #[serde(default)]
    pub roles: BTreeSet<Role>,
    #[serde(default)]
    pub capabilities: BTreeSet<Capability>,
    #[serde(default)]
    pub priority: i32,
    #[serde(default)]
    pub command: Option<String>,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub env_allowlist: Vec<String>,
    #[serde(default)]
    pub api_base_url: Option<String>,
    #[serde(default)]
    pub api_key_env: Option<String>,
    #[serde(default)]
    pub headers: BTreeMap<String, String>,
    #[serde(default)]
    pub timeout_seconds: Option<u64>,
    #[serde(default)]
    pub requires_network: Option<bool>,
    #[serde(default)]
    pub requires_credentials: Option<bool>,
}

const fn yes() -> bool {
    true
}

#[must_use]
pub fn starter() -> CrewConfig {
    CrewConfig {
        version: 1,
        run: RunConfig {
            workspace_mode: WorkspaceMode::Current,
            max_iterations: 8,
            max_parallel_readers: 4,
            max_parallel_writers: 2,
            max_tasks_per_iteration: 8,
            default_task_timeout_seconds: 900,
            retain_failed_worktrees: true,
        },
        manager: ManagerConfig {
            host: "claude-code".into(),
            coding: ManagerCoding::SmallFixes,
            small_fix_max_files: 3,
            small_fix_max_changed_lines: 120,
        },
        autonomy: AutonomyConfig {
            mode: AutonomyMode::Balanced,
        },
        permissions: PermissionsConfig {
            local_read: PermissionRule::Allow,
            local_edit: PermissionRule::Allow,
            test_commands: PermissionRule::Allow,
            network: PermissionRule::Ask,
            destructive_commands: PermissionRule::Ask,
            credentialed_actions: PermissionRule::Ask,
            commit: PermissionRule::Ask,
            push: PermissionRule::Ask,
            deploy: PermissionRule::Ask,
        },
        verification: VerificationConfig {
            commands: vec![],
            require_independent_review: true,
            allow_same_agent_review: true,
        },
        workers: vec![WorkerConfig {
            id: "manager-native".into(),
            kind: WorkerKind::Native,
            enabled: true,
            adapter: None,
            provider: None,
            host: Some("manager".into()),
            model: None,
            model_fallback: Some(ModelFallback::AllowHostDefault),
            roles: [
                Role::Planner,
                Role::Researcher,
                Role::Implementer,
                Role::Tester,
                Role::Reviewer,
            ]
            .into(),
            capabilities: [Capability::Read, Capability::Write, Capability::Shell].into(),
            priority: 100,
            command: None,
            args: vec![],
            env_allowlist: vec![],
            api_base_url: None,
            api_key_env: None,
            headers: BTreeMap::new(),
            timeout_seconds: None,
            requires_network: Some(false),
            requires_credentials: Some(false),
        }],
    }
}
