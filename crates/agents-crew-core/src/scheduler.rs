use crate::{Task, TaskGraph, WorkspaceMode};

#[derive(Debug, Clone)]
pub struct ScheduleBatch {
    pub read_task_ids: Vec<String>,
    pub write_task_ids: Vec<String>,
}

#[derive(Debug, Clone)]
pub struct Scheduler {
    pub workspace_mode: WorkspaceMode,
    pub max_parallel_readers: usize,
    pub max_parallel_writers: usize,
    pub max_tasks_per_iteration: usize,
}

impl Scheduler {
    #[must_use]
    pub fn next_batch(&self, graph: &TaskGraph) -> ScheduleBatch {
        let mut reads = Vec::new();
        let mut writes = Vec::new();
        let write_limit = if self.workspace_mode == WorkspaceMode::Current {
            1
        } else {
            self.max_parallel_writers.max(1)
        };
        let total_limit = self.max_tasks_per_iteration.max(1);
        for task in graph.ready_tasks() {
            if reads.len() + writes.len() >= total_limit {
                break;
            }
            if task.writes() {
                if writes.len() < write_limit {
                    writes.push(task.id.clone());
                }
            } else if reads.len() < self.max_parallel_readers.max(1) {
                reads.push(task.id.clone());
            }
        }
        ScheduleBatch {
            read_task_ids: reads,
            write_task_ids: writes,
        }
    }

    #[must_use]
    pub fn task_is_writer(task: &Task) -> bool {
        task.writes()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{Capability, Role, Task, TaskDraft};

    fn task(id: &str, write: bool) -> Task {
        Task::from_draft(
            id,
            TaskDraft {
                title: id.to_string(),
                instructions: id.to_string(),
                role: Role::Implementer,
                capabilities: if write {
                    [Capability::Read, Capability::Write].into()
                } else {
                    [Capability::Read].into()
                },
                write_scope: if write { vec!["src".into()] } else { vec![] },
                dependencies: vec![],
                preferred_workers: vec![],
                expected_output: "x".to_string(),
                max_attempts: 2,
            },
        )
    }

    #[test]
    fn current_serializes_writers() {
        let graph = TaskGraph::new(vec![
            task("r1", false),
            task("r2", false),
            task("w1", true),
            task("w2", true),
        ])
        .unwrap();
        let batch = Scheduler {
            workspace_mode: WorkspaceMode::Current,
            max_parallel_readers: 4,
            max_parallel_writers: 4,
            max_tasks_per_iteration: 8,
        }
        .next_batch(&graph);
        assert_eq!(batch.read_task_ids.len(), 2);
        assert_eq!(batch.write_task_ids.len(), 1);
    }

    #[test]
    fn respects_total_task_limit() {
        let graph = TaskGraph::new(vec![
            task("r1", false),
            task("r2", false),
            task("r3", false),
        ])
        .unwrap();
        let batch = Scheduler {
            workspace_mode: WorkspaceMode::Current,
            max_parallel_readers: 4,
            max_parallel_writers: 1,
            max_tasks_per_iteration: 2,
        }
        .next_batch(&graph);
        assert_eq!(batch.read_task_ids.len(), 2);
    }
}
