use agents_crew_core::Role;

#[must_use]
pub fn role(role: Role) -> &'static str {
    match role {
        Role::Manager => include_str!("../../../roles/manager.md"),
        Role::Planner => include_str!("../../../roles/planner.md"),
        Role::Researcher => include_str!("../../../roles/researcher.md"),
        Role::Implementer => include_str!("../../../roles/implementer.md"),
        Role::Tester => include_str!("../../../roles/tester.md"),
        Role::Reviewer => include_str!("../../../roles/reviewer.md"),
        Role::Integrator => include_str!("../../../roles/integrator.md"),
    }
}

#[must_use]
pub fn manager_protocol() -> &'static str {
    include_str!("../../../roles/manager.md")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn all_roles_nonempty() {
        for kind in [
            Role::Manager,
            Role::Planner,
            Role::Researcher,
            Role::Implementer,
            Role::Tester,
            Role::Reviewer,
            Role::Integrator,
        ] {
            assert!(role(kind).len() > 40);
        }
    }
}
