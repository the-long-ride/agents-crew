use agents_crew_config::{PermissionRule, PermissionsConfig};
use agents_crew_core::ManagerCoding;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Operation {
    LocalRead,
    LocalEdit,
    TestCommand,
    Network,
    DestructiveCommand,
    CredentialedAction,
    Commit,
    Push,
    Deploy,
    ManagerWrite {
        files: usize,
        changed_lines: usize,
    },
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PolicyDecision {
    Allow,
    Ask,
    Deny,
}

#[derive(Debug, Clone)]
pub struct PolicyContext {
    pub manager_coding: ManagerCoding,
    pub small_fix_max_files: usize,
    pub small_fix_max_changed_lines: usize,
}

pub struct PolicyEngine {
    permissions: PermissionsConfig,
}

impl PolicyEngine {
    #[must_use]
    pub fn new(permissions: PermissionsConfig) -> Self {
        Self { permissions }
    }

    #[must_use]
    pub fn decide(&self, operation: &Operation, context: &PolicyContext) -> PolicyDecision {
        match operation {
            Operation::ManagerWrite {
                files,
                changed_lines,
            } => match context.manager_coding {
                ManagerCoding::Never => PolicyDecision::Deny,
                ManagerCoding::Full => map(self.permissions.local_edit),
                ManagerCoding::SmallFixes => {
                    if *files <= context.small_fix_max_files
                        && *changed_lines <= context.small_fix_max_changed_lines
                    {
                        map(self.permissions.local_edit)
                    } else {
                        PolicyDecision::Deny
                    }
                }
            },
            Operation::LocalRead => map(self.permissions.local_read),
            Operation::LocalEdit => map(self.permissions.local_edit),
            Operation::TestCommand => map(self.permissions.test_commands),
            Operation::Network => map(self.permissions.network),
            Operation::DestructiveCommand => map(self.permissions.destructive_commands),
            Operation::CredentialedAction => map(self.permissions.credentialed_actions),
            Operation::Commit => map(self.permissions.commit),
            Operation::Push => map(self.permissions.push),
            Operation::Deploy => map(self.permissions.deploy),
        }
    }
}

const fn map(rule: PermissionRule) -> PolicyDecision {
    match rule {
        PermissionRule::Allow => PolicyDecision::Allow,
        PermissionRule::Ask => PolicyDecision::Ask,
        PermissionRule::Deny => PolicyDecision::Deny,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn balanced_asks_push() {
        let config = agents_crew_config::CrewConfig::starter();
        let engine = PolicyEngine::new(config.permissions);
        let context = PolicyContext {
            manager_coding: ManagerCoding::SmallFixes,
            small_fix_max_files: 3,
            small_fix_max_changed_lines: 120,
        };

        assert_eq!(
            engine.decide(&Operation::LocalEdit, &context),
            PolicyDecision::Allow
        );
        assert_eq!(
            engine.decide(&Operation::Push, &context),
            PolicyDecision::Ask
        );
        assert_eq!(
            engine.decide(
                &Operation::ManagerWrite {
                    files: 4,
                    changed_lines: 20,
                },
                &context,
            ),
            PolicyDecision::Deny
        );
    }
}
