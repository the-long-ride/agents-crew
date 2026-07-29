use crate::{OutstandingAction, RunStore, StateError};
use agents_crew_core::Capability;
use chrono::Utc;
use std::{collections::BTreeSet, fs};

impl RunStore {
    pub fn save_action(&self, action: &OutstandingAction) -> Result<(), StateError> {
        crate::store::atomic_json(
            &self
                .run_dir(&action.run_id)
                .join("actions")
                .join(format!("{}.json", action.id)),
            action,
        )
    }

    pub fn load_action(&self, run_id: &str, id: &str) -> Result<OutstandingAction, StateError> {
        let path = self
            .run_dir(run_id)
            .join("actions")
            .join(format!("{id}.json"));
        if !path.exists() {
            return Err(StateError::UnknownAction(id.to_string()));
        }
        Ok(serde_json::from_slice(&fs::read(path)?)?)
    }

    pub fn consume_action(
        &self,
        run_id: &str,
        id: &str,
        claimed: &BTreeSet<Capability>,
    ) -> Result<OutstandingAction, StateError> {
        let mut action = self.load_action(run_id, id)?;
        if action.consumed {
            return Err(StateError::ActionConsumed(id.to_string()));
        }
        if action
            .expires_at
            .is_some_and(|expires| expires <= Utc::now())
        {
            return Err(StateError::ActionExpired(id.to_string()));
        }
        if !claimed.is_subset(&action.capability_envelope) {
            return Err(StateError::CapabilityMismatch);
        }
        action.consumed = true;
        self.save_action(&action)?;
        Ok(action)
    }

    pub fn expired_actions(&self, run_id: &str) -> Result<Vec<OutstandingAction>, StateError> {
        self.filtered_actions(run_id, |action| {
            !action.consumed
                && action
                    .expires_at
                    .is_some_and(|expires| expires <= Utc::now())
        })
    }

    pub fn pending_actions(&self, run_id: &str) -> Result<Vec<OutstandingAction>, StateError> {
        self.filtered_actions(run_id, |action| {
            !action.consumed && action.expires_at.is_none_or(|expires| expires > Utc::now())
        })
    }

    fn filtered_actions(
        &self,
        run_id: &str,
        predicate: impl Fn(&OutstandingAction) -> bool,
    ) -> Result<Vec<OutstandingAction>, StateError> {
        let directory = self.run_dir(run_id).join("actions");
        if !directory.exists() {
            return Ok(Vec::new());
        }
        let mut actions = Vec::new();
        for entry in fs::read_dir(directory)?.filter_map(Result::ok) {
            let action: OutstandingAction = serde_json::from_slice(&fs::read(entry.path())?)?;
            if predicate(&action) {
                actions.push(action);
            }
        }
        actions.sort_by_key(|action| action.issued_at);
        Ok(actions)
    }
}
