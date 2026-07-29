use crate::model::{HttpRequest, HttpResponse, RunSummary, SaveTemplateRequest, UiError};
use agents_crew_protocol::RunProtocol;
use agents_crew_state::RunStore;
use agents_crew_templates::{TemplateRegistry, TemplateScope};
use serde_json::json;
use std::{io, path::Path};

const INDEX_HTML: &str = include_str!("../web/index.html");
const APP_CSS: &str = include_str!("../web/app.css");
const APP_JS: &str = include_str!("../web/app.js");
const APP_MODEL_JS: &str = include_str!("../web/app-model.js");

pub fn handle_request(workspace: &Path, request: HttpRequest) -> Result<HttpResponse, UiError> {
    let path = request.path.split('?').next().unwrap_or(&request.path);
    match (request.method.as_str(), path) {
        ("GET", "/") | ("GET", "/index.html") => Ok(HttpResponse::text(
            200,
            "text/html; charset=utf-8",
            INDEX_HTML,
        )),
        ("GET", "/app.css") => Ok(HttpResponse::text(
            200,
            "text/css; charset=utf-8",
            APP_CSS,
        )),
        ("GET", "/app.js") => Ok(HttpResponse::text(
            200,
            "text/javascript; charset=utf-8",
            APP_JS,
        )),
        ("GET", "/app-model.js") => Ok(HttpResponse::text(
            200,
            "text/javascript; charset=utf-8",
            APP_MODEL_JS,
        )),
        ("GET", "/api/bootstrap") => bootstrap(workspace),
        ("GET", "/api/templates") => templates(workspace),
        ("GET", "/api/runs") => runs(workspace),
        _ if path.starts_with("/api/templates/") => {
            template_route(workspace, &request, path.trim_start_matches("/api/templates/"))
        }
        _ if path.starts_with("/api/runs/") => {
            run_route(workspace, &request, path.trim_start_matches("/api/runs/"))
        }
        _ => HttpResponse::json(404, json!({ "error": "not found" })),
    }
}

fn bootstrap(workspace: &Path) -> Result<HttpResponse, UiError> {
    HttpResponse::json(
        200,
        json!({
            "templates": TemplateRegistry::new(workspace).list()?,
            "runs": run_summaries(workspace)?,
            "model_presets": [
                "configured-by-user",
                "configured-by-host",
                "openai/gpt-5",
                "anthropic/claude-sonnet-4",
                "google/gemini-2.5-pro"
            ],
            "roles": ["planner", "researcher", "implementer", "tester", "reviewer", "integrator"],
            "capabilities": ["read", "write", "shell", "network", "commit", "push", "deploy", "destructive"]
        }),
    )
}

fn templates(workspace: &Path) -> Result<HttpResponse, UiError> {
    HttpResponse::json(
        200,
        serde_json::to_value(TemplateRegistry::new(workspace).list()?)?,
    )
}

fn template_route(
    workspace: &Path,
    request: &HttpRequest,
    id: &str,
) -> Result<HttpResponse, UiError> {
    let registry = TemplateRegistry::new(workspace);
    match request.method.as_str() {
        "GET" => HttpResponse::json(200, serde_json::to_value(registry.resolve(id)?)?),
        "PUT" => {
            let payload: SaveTemplateRequest = serde_json::from_slice(&request.body)?;
            let metadata = payload
                .config
                .template
                .as_ref()
                .ok_or_else(|| UiError::BadRequest("template metadata is required".to_string()))?;
            if metadata.id != id {
                return Err(UiError::BadRequest(
                    "path id must match template metadata id".to_string(),
                ));
            }
            HttpResponse::json(
                200,
                serde_json::to_value(registry.save(payload.scope, &payload.config)?)?,
            )
        }
        "DELETE" => delete_template(&registry, request, id),
        _ => HttpResponse::json(405, json!({ "error": "method not allowed" })),
    }
}

fn delete_template(
    registry: &TemplateRegistry,
    request: &HttpRequest,
    id: &str,
) -> Result<HttpResponse, UiError> {
    let scope = query_value(&request.path, "scope")
        .ok_or_else(|| UiError::BadRequest("scope query is required".to_string()))?;
    let scope = match scope.as_str() {
        "global" => TemplateScope::Global,
        "workspace" => TemplateScope::Workspace,
        _ => {
            return Err(UiError::BadRequest(
                "scope must be global or workspace".to_string(),
            ));
        }
    };
    registry.delete(scope, id)?;
    HttpResponse::json(200, json!({ "deleted": id, "scope": scope }))
}

fn runs(workspace: &Path) -> Result<HttpResponse, UiError> {
    HttpResponse::json(200, serde_json::to_value(run_summaries(workspace)?)?)
}

fn run_summaries(workspace: &Path) -> Result<Vec<RunSummary>, UiError> {
    let store = RunStore::new(workspace);
    let mut summaries = Vec::new();
    for id in store.list_runs()? {
        let run = store.load(&id)?;
        summaries.push(RunSummary {
            id: run.id.clone(),
            goal: run.original_goal.clone(),
            status: run.status,
            manager: run.manager.host.clone(),
            updated_at: run.updated_at,
            archived: store.history_run_dir(&run.id).exists(),
            completed_tasks: run
                .tasks
                .values()
                .filter(|task| task.status == agents_crew_core::TaskStatus::Completed)
                .count(),
            total_tasks: run.tasks.len(),
        });
    }
    summaries.sort_by(|left, right| right.updated_at.cmp(&left.updated_at));
    Ok(summaries)
}

fn run_route(workspace: &Path, request: &HttpRequest, id: &str) -> Result<HttpResponse, UiError> {
    validate_run_id(id)?;
    if request.method != "GET" {
        return HttpResponse::json(405, json!({ "error": "method not allowed" }));
    }
    let store = RunStore::new(workspace);
    let run = store.load(id)?;
    let root = store.run_dir(id);
    HttpResponse::json(
        200,
        json!({
            "run": run,
            "events": store.read_events(id)?,
            "intent": RunProtocol::new(workspace).load_intent(id).ok(),
            "files": safe_file_list(&root)?,
            "archived": store.history_run_dir(id).exists()
        }),
    )
}

fn safe_file_list(root: &Path) -> Result<Vec<String>, UiError> {
    fn walk(root: &Path, current: &Path, files: &mut Vec<String>) -> io::Result<()> {
        for entry in std::fs::read_dir(current)? {
            let entry = entry?;
            let path = entry.path();
            if path.is_dir() {
                walk(root, &path, files)?;
            } else if let Ok(relative) = path.strip_prefix(root) {
                files.push(relative.to_string_lossy().replace('\\', "/"));
            }
        }
        Ok(())
    }
    if !root.exists() {
        return Ok(Vec::new());
    }
    let mut files = Vec::new();
    walk(root, root, &mut files)?;
    files.sort();
    Ok(files)
}

fn query_value(path: &str, name: &str) -> Option<String> {
    let query = path.split_once('?')?.1;
    query.split('&').find_map(|pair| {
        let (key, value) = pair.split_once('=')?;
        (key == name).then(|| value.to_string())
    })
}

fn validate_run_id(id: &str) -> Result<(), UiError> {
    let valid = !id.is_empty()
        && id.len() <= 128
        && id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-');
    if valid {
        Ok(())
    } else {
        Err(UiError::BadRequest("invalid run id".to_string()))
    }
}
