use super::*;
use agents_crew_core::{ManagerCoding, ManagerIdentity, WorkspaceMode};
use tempfile::tempdir;

fn run(workspace: &Path) -> Run {
    Run::new(
        "x",
        workspace.into(),
        WorkspaceMode::Current,
        ManagerIdentity {
            host: "x".to_string(),
            coding: ManagerCoding::Never,
            small_fix_max_files: 0,
            small_fix_max_changed_lines: 0,
        },
        2,
    )
}

#[test]
fn events_are_monotonic() {
    let directory = tempdir().unwrap();
    let store = RunStore::new(directory.path());
    let run = run(directory.path());
    let id = run.id.clone();
    store.create(&run).unwrap();
    store
        .append_event(&id, EventKind::RunStarted, Value::Null)
        .unwrap();
    store
        .append_event(&id, EventKind::TaskAdded, Value::Null)
        .unwrap();
    assert_eq!(store.read_events(&id).unwrap()[1].sequence, 2);
}

#[test]
fn archived_runs_remain_loadable() {
    let directory = tempdir().unwrap();
    let store = RunStore::new(directory.path());
    let run = run(directory.path());
    let id = run.id.clone();
    store.create(&run).unwrap();
    store.archive(&id).unwrap();
    assert!(!store.active_run_dir(&id).exists());
    assert!(store.history_run_dir(&id).exists());
    assert_eq!(store.load(&id).unwrap().id, id);
}

#[test]
fn legacy_run_directories_remain_readable() {
    let directory = tempdir().unwrap();
    let store = RunStore::new(directory.path());
    let run = run(directory.path());
    let legacy = directory.path().join(".agents-crew/runs").join(&run.id);
    fs::create_dir_all(&legacy).unwrap();
    atomic_json(&legacy.join("run.json"), &run).unwrap();
    assert_eq!(store.load(&run.id).unwrap().id, run.id);
}
