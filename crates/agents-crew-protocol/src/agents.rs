use crate::{atomic_json, ProtocolError};
use agents_crew_core::Run;
use serde::Serialize;
use serde_json::Value;
use std::{collections::BTreeMap, fs, path::Path};

#[derive(Debug, Serialize)]
struct AgentSession<'a> {
    agent_id: &'a str,
    task_ids: Vec<&'a str>,
    active_task_ids: Vec<&'a str>,
    conversation_id: Option<&'a str>,
    updated_at: chrono::DateTime<chrono::Utc>,
}

pub(crate) fn sync_agents(root: &Path, run: &Run) -> Result<(), ProtocolError> {
    let mut agents: BTreeMap<&str, Vec<_>> = BTreeMap::new();
    for task in run.tasks.values() {
        if let Some(worker) = task.assigned_worker.as_deref() {
            agents.entry(worker).or_default().push(task);
        }
    }
    let mut index = Vec::new();
    for (agent_id, tasks) in agents {
        let conversation_id = tasks.iter().find_map(|task| {
            task.result.as_ref().and_then(|result| {
                string_metadata(&result.metadata, "conversation_id")
                    .or_else(|| string_metadata(&result.metadata, "session_id"))
            })
        });
        let session = AgentSession {
            agent_id,
            task_ids: tasks.iter().map(|task| task.id.as_str()).collect(),
            active_task_ids: tasks
                .iter()
                .filter(|task| {
                    matches!(
                        task.status,
                        agents_crew_core::TaskStatus::Running
                            | agents_crew_core::TaskStatus::Verifying
                    )
                })
                .map(|task| task.id.as_str())
                .collect(),
            conversation_id,
            updated_at: run.updated_at,
        };
        let directory = root.join("agents").join(safe_component(agent_id));
        fs::create_dir_all(&directory)?;
        atomic_json(&directory.join("session.json"), &session)?;
        index.push(session);
    }
    atomic_json(&root.join("agents.json"), &index)
}

fn string_metadata<'a>(
    metadata: &'a BTreeMap<String, Value>,
    key: &str,
) -> Option<&'a str> {
    metadata.get(key).and_then(Value::as_str)
}

fn safe_component(value: &str) -> String {
    let mut result = value
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || matches!(character, '-' | '_') {
                character
            } else {
                '-'
            }
        })
        .collect::<String>();
    if result.is_empty() {
        result.push_str("agent");
    }
    result.truncate(80);
    result
}
