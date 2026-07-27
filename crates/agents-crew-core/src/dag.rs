use crate::{CoreError, Task, TaskStatus};
use std::collections::{BTreeMap, BTreeSet};

#[derive(Debug, Clone)]
pub struct TaskGraph {
    tasks: BTreeMap<String, Task>,
}

impl TaskGraph {
    pub fn new(tasks: Vec<Task>) -> Result<Self, CoreError> {
        let mut map = BTreeMap::new();
        for task in tasks {
            if map.insert(task.id.clone(), task).is_some() {
                return Err(CoreError::DuplicateTask("duplicate".into()));
            }
        }
        for task in map.values() {
            for dependency in &task.dependencies {
                if !map.contains_key(dependency) {
                    return Err(CoreError::MissingDependency {
                        task: task.id.clone(),
                        dependency: dependency.clone(),
                    });
                }
            }
        }
        let graph = Self { tasks: map };
        graph.detect_cycles()?;
        Ok(graph)
    }

    #[must_use]
    pub fn tasks(&self) -> &BTreeMap<String, Task> {
        &self.tasks
    }

    #[must_use]
    pub fn into_tasks(self) -> BTreeMap<String, Task> {
        self.tasks
    }

    #[must_use]
    pub fn ready_tasks(&self) -> Vec<&Task> {
        self.tasks
            .values()
            .filter(|task| {
                matches!(
                    task.status,
                    TaskStatus::Pending | TaskStatus::Ready | TaskStatus::Retryable
                ) && task.dependencies.iter().all(|id| {
                    self.tasks
                        .get(id)
                        .is_some_and(|dependency| dependency.status == TaskStatus::Completed)
                })
            })
            .collect()
    }

    pub fn transition(&mut self, id: &str, next: TaskStatus) -> Result<(), CoreError> {
        let task = self
            .tasks
            .get_mut(id)
            .ok_or_else(|| CoreError::TaskNotFound(id.to_string()))?;
        if !valid_transition(task.status, next) {
            return Err(CoreError::InvalidTransition {
                task: id.to_string(),
                from: task.status,
                to: next,
            });
        }
        task.status = next;
        Ok(())
    }

    fn detect_cycles(&self) -> Result<(), CoreError> {
        fn visit(
            id: &str,
            tasks: &BTreeMap<String, Task>,
            temporary: &mut BTreeSet<String>,
            complete: &mut BTreeSet<String>,
            stack: &mut Vec<String>,
        ) -> Result<(), CoreError> {
            if complete.contains(id) {
                return Ok(());
            }
            if !temporary.insert(id.to_string()) {
                stack.push(id.to_string());
                return Err(CoreError::DependencyCycle(stack.clone()));
            }
            stack.push(id.to_string());
            if let Some(task) = tasks.get(id) {
                for dependency in &task.dependencies {
                    visit(dependency, tasks, temporary, complete, stack)?;
                }
            }
            stack.pop();
            temporary.remove(id);
            complete.insert(id.to_string());
            Ok(())
        }

        let mut temporary = BTreeSet::new();
        let mut complete = BTreeSet::new();
        for id in self.tasks.keys() {
            visit(
                id,
                &self.tasks,
                &mut temporary,
                &mut complete,
                &mut Vec::new(),
            )?;
        }
        Ok(())
    }
}

const fn valid_transition(from: TaskStatus, to: TaskStatus) -> bool {
    use TaskStatus::{
        Blocked, Cancelled, Completed, Failed, Pending, Ready, Retryable, Running, Verifying,
    };
    matches!(
        (from, to),
        (Pending, Ready)
            | (Pending, Running)
            | (Pending, Cancelled)
            | (Ready, Running)
            | (Ready, Cancelled)
            | (Running, Verifying)
            | (Running, Blocked)
            | (Running, Retryable)
            | (Running, Failed)
            | (Running, Cancelled)
            | (Verifying, Completed)
            | (Verifying, Retryable)
            | (Verifying, Blocked)
            | (Verifying, Failed)
            | (Retryable, Running)
            | (Blocked, Retryable)
            | (Blocked, Failed)
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{Capability, Role, TaskDraft};

    fn task(id: &str, dependencies: &[&str]) -> Task {
        let mut task = Task::from_draft(
            id,
            TaskDraft {
                title: id.into(),
                instructions: id.into(),
                role: Role::Planner,
                capabilities: [Capability::Read].into(),
                write_scope: vec![],
                dependencies: dependencies.iter().map(|value| (*value).into()).collect(),
                preferred_workers: vec![],
                expected_output: "x".into(),
                max_attempts: 2,
            },
        );
        task.id = id.into();
        task
    }

    #[test]
    fn rejects_cycle() {
        assert!(matches!(
            TaskGraph::new(vec![task("a", &["b"]), task("b", &["a"])]),
            Err(CoreError::DependencyCycle(_))
        ));
    }

    #[test]
    fn unlocks_dependency() {
        let mut graph = TaskGraph::new(vec![task("a", &[]), task("b", &["a"])]).unwrap();
        assert_eq!(graph.ready_tasks()[0].id, "a");
        graph.transition("a", TaskStatus::Running).unwrap();
        graph.transition("a", TaskStatus::Verifying).unwrap();
        graph.transition("a", TaskStatus::Completed).unwrap();
        assert_eq!(graph.ready_tasks()[0].id, "b");
    }
}
